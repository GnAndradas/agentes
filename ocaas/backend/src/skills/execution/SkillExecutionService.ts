/**
 * Skill Execution Service
 *
 * Orchestrates the sequential execution of tools within a skill.
 * Implements the pipeline pattern with input/output chaining.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import { NotFoundError } from '../../utils/errors.js';
import type { SkillService } from '../../services/SkillService.js';
import type { ToolService } from '../../services/ToolService.js';
import type { EventService } from '../../services/EventService.js';
import { EVENT_TYPE } from '../../config/constants.js';
import { getToolInvoker, type ToolInvoker } from './ToolInvoker.js';
import {
  EXECUTION_MODE,
  EXECUTION_STATUS,
  type ExecutionMode,
  type SkillExecutionInput,
  type SkillExecutionResult,
  type SkillExecutionPreview,
  type SkillValidationResult,
  type ToolExecutionResult,
  type PipelineContext,
  type ExecutionLogEntry,
  type ValidationError,
  type ValidationWarning,
} from './SkillExecutionTypes.js';
import type { SkillToolExpanded } from '../../types/domain.js';

const logger = createLogger('SkillExecutionService');

// Default timeout for entire skill execution (5 minutes)
const DEFAULT_SKILL_TIMEOUT_MS = 5 * 60 * 1000;
// Default timeout per tool (30 seconds)
const DEFAULT_TOOL_TIMEOUT_MS = 30 * 1000;

// =============================================================================
// SKILL EXECUTION SERVICE
// =============================================================================

export class SkillExecutionService {
  private toolInvoker: ToolInvoker;

  constructor(
    private skillService: SkillService,
    private toolService: ToolService,
    private eventService: EventService
  ) {
    this.toolInvoker = getToolInvoker();
  }

  // ===========================================================================
  // MAIN EXECUTION
  // ===========================================================================

  /**
   * Execute a skill with the given input
   */
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const executionId = nanoid();
    const startedAt = nowTimestamp();

    logger.info({
      executionId,
      skillId: input.skillId,
      mode: input.mode,
      caller: input.caller,
    }, 'Starting skill execution');

    // Get skill with tools
    const skill = await this.skillService.getById(input.skillId);
    const linkedTools = await this.skillService.getSkillToolsExpanded(input.skillId);

    // Sort by orderIndex
    const sortedTools = [...linkedTools].sort((a, b) => a.orderIndex - b.orderIndex);

    // Initialize context
    const ctx: PipelineContext = {
      executionId,
      skill,
      mode: input.mode,
      initialInput: input.input,
      userContext: input.context || {},
      previousResults: [],
      currentOutput: input.input,
      log: [],
      startedAt,
      timeoutMs: input.timeoutMs || DEFAULT_SKILL_TIMEOUT_MS,
      stopOnError: input.stopOnError ?? true,
      caller: input.caller,
    };

    // Log initialization
    this.addLog(ctx, 'info', 'init', `Starting execution of skill '${skill.name}'`);

    // Emit start event
    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'skill_execution',
      severity: 'info',
      message: `Skill execution started: ${skill.name}`,
      resourceType: 'skill',
      resourceId: input.skillId,
      data: {
        executionId,
        mode: input.mode,
        toolCount: sortedTools.length,
        caller: input.caller,
      },
    });

    // Execute pipeline
    const result = await this.executePipeline(ctx, sortedTools);

    // Emit completion event
    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'skill_execution',
      severity: result.status === EXECUTION_STATUS.SUCCESS ? 'info' : 'warning',
      message: `Skill execution ${result.status}: ${skill.name}`,
      resourceType: 'skill',
      resourceId: input.skillId,
      data: {
        executionId,
        status: result.status,
        totalDurationMs: result.totalDurationMs,
        toolsSucceeded: result.toolsSucceeded,
        toolsFailed: result.toolsFailed,
      },
    });

    logger.info({
      executionId,
      skillId: input.skillId,
      status: result.status,
      durationMs: result.totalDurationMs,
      toolsExecuted: result.toolsExecuted,
    }, 'Skill execution completed');

    return result;
  }

  /**
   * Execute the tool pipeline sequentially
   */
  private async executePipeline(
    ctx: PipelineContext,
    tools: SkillToolExpanded[]
  ): Promise<SkillExecutionResult> {
    const toolResults: ToolExecutionResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let pipelineFailed = false;
    let finalError: string | undefined;

    for (const linkedTool of tools) {
      // Check timeout
      if (nowTimestamp() - ctx.startedAt > ctx.timeoutMs) {
        this.addLog(ctx, 'error', 'error', `Skill execution timed out after ${ctx.timeoutMs}ms`);
        finalError = `Execution timed out after ${ctx.timeoutMs}ms`;
        pipelineFailed = true;
        break;
      }

      // Skip if pipeline already failed and stopOnError is true
      if (pipelineFailed && ctx.stopOnError) {
        this.addLog(ctx, 'info', 'tool_start', `Skipping tool '${linkedTool.tool.name}' due to previous failure`, {
          toolId: linkedTool.toolId,
        });

        const skippedResult: ToolExecutionResult = {
          toolId: linkedTool.toolId,
          toolName: linkedTool.tool.name,
          status: EXECUTION_STATUS.SKIPPED,
          error: 'Skipped due to previous failure',
          startedAt: nowTimestamp(),
          completedAt: nowTimestamp(),
          durationMs: 0,
          required: linkedTool.required,
          role: linkedTool.role,
          orderIndex: linkedTool.orderIndex,
        };

        toolResults.push(skippedResult);
        skipped++;
        continue;
      }

      // Log tool start
      this.addLog(ctx, 'info', 'tool_start', `Executing tool '${linkedTool.tool.name}'`, {
        toolId: linkedTool.toolId,
        toolType: linkedTool.tool.type,
        orderIndex: linkedTool.orderIndex,
        required: linkedTool.required,
      });

      // Execute the tool
      const result = await this.toolInvoker.invoke(
        {
          tool: linkedTool.tool,
          input: ctx.currentOutput,
          configOverrides: linkedTool.config,
          context: ctx.userContext,
          timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
        },
        ctx.mode
      );

      // Update result with link metadata
      result.required = linkedTool.required;
      result.role = linkedTool.role;
      result.orderIndex = linkedTool.orderIndex;

      // Log tool completion
      this.addLog(ctx, result.status === EXECUTION_STATUS.SUCCESS ? 'info' : 'error', 'tool_end',
        `Tool '${linkedTool.tool.name}' ${result.status}: ${result.error || 'OK'}`, {
          toolId: linkedTool.toolId,
          status: result.status,
          durationMs: result.durationMs,
        });

      toolResults.push(result);
      ctx.previousResults.push(result);

      // Record tool execution (only in real run mode)
      if (ctx.mode === EXECUTION_MODE.RUN) {
        try {
          await this.toolService.recordExecution(linkedTool.toolId);
        } catch (err) {
          logger.warn({ err, toolId: linkedTool.toolId }, 'Failed to record tool execution');
        }
      }

      // Handle result
      if (result.status === EXECUTION_STATUS.SUCCESS) {
        succeeded++;
        // Chain output to next tool
        if (result.output) {
          ctx.currentOutput = {
            ...ctx.currentOutput,
            ...result.output,
          };
        }
      } else if (result.status === EXECUTION_STATUS.FAILED) {
        failed++;
        if (linkedTool.required) {
          pipelineFailed = true;
          finalError = result.error;
        }
      }
    }

    const completedAt = nowTimestamp();

    // Determine final status
    let finalStatus: typeof EXECUTION_STATUS[keyof typeof EXECUTION_STATUS] = EXECUTION_STATUS.SUCCESS;
    if (pipelineFailed) {
      finalStatus = EXECUTION_STATUS.FAILED;
    } else if (failed > 0) {
      // Non-required tools failed, but pipeline succeeded
      finalStatus = EXECUTION_STATUS.SUCCESS;
    }

    // Log completion
    this.addLog(ctx, finalStatus === EXECUTION_STATUS.SUCCESS ? 'info' : 'error', 'complete',
      `Skill execution ${finalStatus}: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped`);

    return {
      executionId: ctx.executionId,
      skillId: ctx.skill.id,
      skillName: ctx.skill.name,
      mode: ctx.mode,
      status: finalStatus,
      toolResults,
      output: finalStatus === EXECUTION_STATUS.SUCCESS ? ctx.currentOutput : undefined,
      error: finalError,
      toolsExecuted: succeeded + failed,
      toolsSucceeded: succeeded,
      toolsFailed: failed,
      toolsSkipped: skipped,
      totalDurationMs: completedAt - ctx.startedAt,
      startedAt: ctx.startedAt,
      completedAt,
      caller: ctx.caller,
    };
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  /**
   * Validate a skill execution request without actually executing
   */
  async validate(input: SkillExecutionInput): Promise<SkillValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Verify skill exists
    let skill;
    try {
      skill = await this.skillService.getById(input.skillId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        errors.push({ code: 'SKILL_NOT_FOUND', message: `Skill '${input.skillId}' not found` });
        return {
          valid: false,
          skillId: input.skillId,
          errors,
          warnings,
          toolsChecked: 0,
          toolsWithIssues: 0,
        };
      }
      throw err;
    }

    // Check skill status
    if (skill.status !== 'active') {
      errors.push({ code: 'SKILL_INACTIVE', message: `Skill is ${skill.status}, must be active` });
    }

    // Get linked tools
    const linkedTools = await this.skillService.getSkillToolsExpanded(input.skillId);

    if (linkedTools.length === 0) {
      warnings.push({ code: 'NO_TOOLS', message: 'Skill has no linked tools' });
    }

    // Validate each tool
    let toolsWithIssues = 0;
    for (const linked of linkedTools) {
      const tool = linked.tool;

      // Check tool status
      if (tool.status !== 'active') {
        if (linked.required) {
          errors.push({
            code: 'REQUIRED_TOOL_INACTIVE',
            message: `Required tool '${tool.name}' is ${tool.status}`,
            toolId: tool.id,
          });
        } else {
          warnings.push({
            code: 'TOOL_INACTIVE',
            message: `Optional tool '${tool.name}' is ${tool.status}`,
            toolId: tool.id,
          });
        }
        toolsWithIssues++;
      }

      // Check tool configuration
      if (tool.type === 'api' && !tool.config?.url) {
        errors.push({
          code: 'MISSING_CONFIG',
          message: `API tool '${tool.name}' missing URL configuration`,
          toolId: tool.id,
        });
        toolsWithIssues++;
      }

      // Validate input schema if present
      if (tool.inputSchema) {
        const required = (tool.inputSchema as { required?: string[] }).required || [];
        for (const field of required) {
          if (!(field in input.input)) {
            warnings.push({
              code: 'MISSING_INPUT',
              message: `Tool '${tool.name}' expects input field '${field}'`,
              toolId: tool.id,
              field,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      skillId: input.skillId,
      errors,
      warnings,
      toolsChecked: linkedTools.length,
      toolsWithIssues,
    };
  }

  // ===========================================================================
  // PREVIEW
  // ===========================================================================

  /**
   * Get an execution preview for a skill
   */
  async getPreview(skillId: string): Promise<SkillExecutionPreview> {
    const blockers: string[] = [];
    const warnings: string[] = [];

    // Get skill
    let skill;
    try {
      skill = await this.skillService.getById(skillId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return {
          skillId,
          skillName: 'Unknown',
          canExecute: false,
          blockers: ['Skill not found'],
          warnings: [],
          pipeline: [],
        };
      }
      throw err;
    }

    // Check skill status
    if (skill.status !== 'active') {
      blockers.push(`Skill is ${skill.status}, not active`);
    }

    // Get linked tools
    const linkedTools = await this.skillService.getSkillToolsExpanded(skillId);
    const sortedTools = [...linkedTools].sort((a, b) => a.orderIndex - b.orderIndex);

    if (sortedTools.length === 0) {
      warnings.push('Skill has no linked tools');
    }

    // Build pipeline preview
    const pipeline = sortedTools.map(linked => {
      let status: 'active' | 'inactive' | 'deprecated' | 'missing' = 'active';

      if (linked.tool.status === 'inactive') {
        status = 'inactive';
        if (linked.required) {
          blockers.push(`Required tool '${linked.tool.name}' is inactive`);
        } else {
          warnings.push(`Optional tool '${linked.tool.name}' is inactive`);
        }
      } else if (linked.tool.status === 'deprecated') {
        status = 'deprecated';
        warnings.push(`Tool '${linked.tool.name}' is deprecated`);
      }

      // Estimate duration from config
      const config = linked.tool.config as { timeoutMs?: number } | undefined;
      const estimatedDurationMs = config?.timeoutMs || DEFAULT_TOOL_TIMEOUT_MS;

      return {
        orderIndex: linked.orderIndex,
        toolId: linked.toolId,
        toolName: linked.tool.name,
        toolType: linked.tool.type,
        required: linked.required,
        role: linked.role,
        status,
        estimatedDurationMs,
      };
    });

    // Calculate total estimated duration
    const estimatedTotalDurationMs = pipeline.reduce(
      (sum, p) => sum + (p.estimatedDurationMs || 0),
      0
    );

    return {
      skillId,
      skillName: skill.name,
      canExecute: blockers.length === 0,
      blockers,
      warnings,
      pipeline,
      estimatedTotalDurationMs,
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Add a log entry to the context
   */
  private addLog(
    ctx: PipelineContext,
    level: ExecutionLogEntry['level'],
    phase: ExecutionLogEntry['phase'],
    message: string,
    data?: { toolId?: string; toolName?: string; [key: string]: unknown }
  ): void {
    ctx.log.push({
      timestamp: nowTimestamp(),
      level,
      message,
      phase,
      toolId: data?.toolId,
      toolName: data?.toolName,
      data,
    });

    // Also log to system logger
    const logData = {
      executionId: ctx.executionId,
      skillId: ctx.skill.id,
      phase,
      ...data,
    };

    switch (level) {
      case 'error':
        logger.error(logData, message);
        break;
      case 'warn':
        logger.warn(logData, message);
        break;
      case 'debug':
        logger.debug(logData, message);
        break;
      default:
        logger.info(logData, message);
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: SkillExecutionService | null = null;

/**
 * Initialize the SkillExecutionService singleton
 */
export function initSkillExecutionService(
  skillService: SkillService,
  toolService: ToolService,
  eventService: EventService
): SkillExecutionService {
  if (!instance) {
    instance = new SkillExecutionService(skillService, toolService, eventService);
    logger.info('SkillExecutionService initialized');
  }
  return instance;
}

/**
 * Get the SkillExecutionService singleton
 */
export function getSkillExecutionService(): SkillExecutionService {
  if (!instance) {
    throw new Error('SkillExecutionService not initialized. Call initSkillExecutionService first.');
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetSkillExecutionService(): void {
  instance = null;
}

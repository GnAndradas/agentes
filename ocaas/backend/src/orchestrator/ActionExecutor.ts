import { nanoid } from 'nanoid';
import { orchestratorLogger, logError } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getAgentGenerator } from '../generator/AgentGenerator.js';
import { getSkillGenerator } from '../generator/SkillGenerator.js';
import { getToolGenerator } from '../generator/ToolGenerator.js';
import {
  getAutonomyConfig,
  requiresApprovalForAgentCreation,
  requiresApprovalForSkillGeneration,
  requiresApprovalForToolGeneration,
} from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { SuggestedAction, MissingCapabilityReport, CapabilitySuggestion } from './types.js';

const logger = orchestratorLogger.child({ component: 'ActionExecutor' });

// Maximum retries for a task waiting for resource generation
const MAX_GENERATION_RETRIES = 3;

export interface ActionExecutionResult {
  action: string;
  success: boolean;
  generationId?: string;
  approvalId?: string;
  error?: string;
  requiresApproval: boolean;
}

export interface PendingRetry {
  taskId: string;
  generationId: string;
  actionType: 'agent' | 'skill' | 'tool';
  attempt: number;
  createdAt: number;
}

export class ActionExecutor {
  // Track pending retries: generationId -> PendingRetry
  private pendingRetries = new Map<string, PendingRetry>();

  /**
   * Execute suggested actions from a missing capability report
   * Returns results for each action attempted
   */
  async executeActions(
    taskId: string,
    missingReport: MissingCapabilityReport,
    suggestedActions: SuggestedAction[]
  ): Promise<ActionExecutionResult[]> {
    const results: ActionExecutionResult[] = [];
    const autonomyConfig = getAutonomyConfig();

    // Filter to only actionable suggestions
    const actionable = suggestedActions.filter(a =>
      a.action === 'create_agent' ||
      a.action === 'create_skill' ||
      a.action === 'create_tool'
    );

    if (actionable.length === 0) {
      logger.debug({ taskId }, 'No actionable suggestions to execute');
      return results;
    }

    // In manual mode, don't execute anything
    if (autonomyConfig.level === 'manual') {
      logger.info({ taskId }, 'Manual mode active, skipping action execution');
      return results;
    }

    for (const action of actionable) {
      try {
        const result = await this.executeSingleAction(taskId, action, missingReport);
        results.push(result);

        // Emit event
        const { eventService } = getServices();
        await eventService.emit({
          type: EVENT_TYPE.SYSTEM_INFO,
          category: 'orchestrator',
          severity: result.success ? 'info' : 'warning',
          message: result.success
            ? `Action ${action.action} initiated for task ${taskId}`
            : `Action ${action.action} failed: ${result.error}`,
          resourceType: 'task',
          resourceId: taskId,
          data: {
            action: action.action,
            generationId: result.generationId,
            approvalId: result.approvalId,
            requiresApproval: result.requiresApproval,
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, taskId, action: action.action }, 'Action execution failed');
        results.push({
          action: action.action,
          success: false,
          error,
          requiresApproval: false,
        });
      }
    }

    return results;
  }

  /**
   * Execute a single action
   */
  private async executeSingleAction(
    taskId: string,
    action: SuggestedAction,
    missingReport: MissingCapabilityReport
  ): Promise<ActionExecutionResult> {
    const metadata = action.metadata as {
      type?: string;
      name?: string;
      description?: string;
      canAutoGenerate?: boolean;
    } | undefined;

    const name = metadata?.name || `auto_${nanoid(6)}`;
    const description = metadata?.description || action.reason;

    switch (action.action) {
      case 'create_agent':
        return this.executeCreateAgent(taskId, name, description, missingReport);
      case 'create_skill':
        return this.executeCreateSkill(taskId, name, description, missingReport);
      case 'create_tool':
        return this.executeCreateTool(taskId, name, description, missingReport);
      default:
        return {
          action: action.action,
          success: false,
          error: `Unknown action type: ${action.action}`,
          requiresApproval: false,
        };
    }
  }

  /**
   * Create an agent based on missing capabilities
   */
  private async executeCreateAgent(
    taskId: string,
    name: string,
    description: string,
    missingReport: MissingCapabilityReport
  ): Promise<ActionExecutionResult> {
    const needsApproval = requiresApprovalForAgentCreation();
    const agentGenerator = getAgentGenerator();
    const { approvalService, notificationService } = getServices();

    try {
      // Generate the agent
      const result = await agentGenerator.generate({
        type: 'agent',
        name,
        description,
        prompt: `Create an agent that can handle: ${missingReport.missingCapabilities.join(', ')}`,
        requirements: missingReport.missingCapabilities,
      });

      const generationId = result.metadata?.generationId as string;

      if (!generationId) {
        return {
          action: 'create_agent',
          success: false,
          error: 'Generation failed - no ID returned',
          requiresApproval: needsApproval,
        };
      }

      // Track for retry
      this.pendingRetries.set(generationId, {
        taskId,
        generationId,
        actionType: 'agent',
        attempt: 0,
        createdAt: Date.now(),
      });

      if (needsApproval) {
        // Create approval request
        const approval = await approvalService.create({
          type: 'agent',
          resourceId: generationId,
          metadata: {
            taskId,
            name,
            description,
            capabilities: missingReport.missingCapabilities,
            autoGenerated: true,
          },
        });

        await notificationService.notifyApprovalRequired(
          approval.id,
          'agent',
          generationId,
          { name, taskId, capabilities: missingReport.missingCapabilities }
        );

        logger.info({ taskId, generationId, approvalId: approval.id }, 'Agent generation requires approval');

        return {
          action: 'create_agent',
          success: true,
          generationId,
          approvalId: approval.id,
          requiresApproval: true,
        };
      }

      // Auto-approve and activate
      const { generationService } = getServices();
      await generationService.approve(generationId, 'system:auto');
      await agentGenerator.activate(generationId);

      logger.info({ taskId, generationId, name }, 'Agent auto-generated and activated');

      return {
        action: 'create_agent',
        success: true,
        generationId,
        requiresApproval: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId, name }, 'Agent generation failed');
      return {
        action: 'create_agent',
        success: false,
        error,
        requiresApproval: needsApproval,
      };
    }
  }

  /**
   * Create a skill based on missing capabilities
   */
  private async executeCreateSkill(
    taskId: string,
    name: string,
    description: string,
    missingReport: MissingCapabilityReport
  ): Promise<ActionExecutionResult> {
    const needsApproval = requiresApprovalForSkillGeneration();
    const skillGenerator = getSkillGenerator();
    const { approvalService, notificationService } = getServices();

    try {
      // Generate the skill (source: orchestrator)
      const result = await skillGenerator.generate({
        type: 'skill',
        name,
        description,
        prompt: `Create a skill for: ${missingReport.missingCapabilities.join(', ')}`,
        requirements: missingReport.missingCapabilities,
      }, 'orchestrator');

      const generationId = result.metadata?.generationId as string;

      if (!generationId) {
        return {
          action: 'create_skill',
          success: false,
          error: 'Generation failed - no ID returned',
          requiresApproval: needsApproval,
        };
      }

      // Track for retry
      this.pendingRetries.set(generationId, {
        taskId,
        generationId,
        actionType: 'skill',
        attempt: 0,
        createdAt: Date.now(),
      });

      if (needsApproval) {
        const approval = await approvalService.create({
          type: 'skill',
          resourceId: generationId,
          metadata: {
            taskId,
            name,
            description,
            capabilities: missingReport.missingCapabilities,
            autoGenerated: true,
          },
        });

        await notificationService.notifyApprovalRequired(
          approval.id,
          'skill',
          generationId,
          { name, taskId, capabilities: missingReport.missingCapabilities }
        );

        logger.info({ taskId, generationId, approvalId: approval.id }, 'Skill generation requires approval');

        return {
          action: 'create_skill',
          success: true,
          generationId,
          approvalId: approval.id,
          requiresApproval: true,
        };
      }

      // Auto-approve and activate
      const { generationService } = getServices();
      await generationService.approve(generationId, 'system:auto');
      await skillGenerator.activate(generationId);

      logger.info({ taskId, generationId, name }, 'Skill auto-generated and activated');

      return {
        action: 'create_skill',
        success: true,
        generationId,
        requiresApproval: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId, name }, 'Skill generation failed');
      return {
        action: 'create_skill',
        success: false,
        error,
        requiresApproval: needsApproval,
      };
    }
  }

  /**
   * Create a tool based on missing capabilities
   */
  private async executeCreateTool(
    taskId: string,
    name: string,
    description: string,
    missingReport: MissingCapabilityReport
  ): Promise<ActionExecutionResult> {
    const needsApproval = requiresApprovalForToolGeneration();
    const toolGenerator = getToolGenerator();
    const { approvalService, notificationService } = getServices();

    try {
      // Generate the tool (source: orchestrator)
      const result = await toolGenerator.generate({
        type: 'tool',
        name,
        description,
        prompt: `Create a tool for: ${missingReport.missingCapabilities.join(', ')}`,
        requirements: missingReport.missingCapabilities,
      }, 'orchestrator');

      const generationId = result.metadata?.generationId as string;

      if (!generationId) {
        return {
          action: 'create_tool',
          success: false,
          error: 'Generation failed - no ID returned',
          requiresApproval: needsApproval,
        };
      }

      // Track for retry
      this.pendingRetries.set(generationId, {
        taskId,
        generationId,
        actionType: 'tool',
        attempt: 0,
        createdAt: Date.now(),
      });

      if (needsApproval) {
        const approval = await approvalService.create({
          type: 'tool',
          resourceId: generationId,
          metadata: {
            taskId,
            name,
            description,
            capabilities: missingReport.missingCapabilities,
            autoGenerated: true,
          },
        });

        await notificationService.notifyApprovalRequired(
          approval.id,
          'tool',
          generationId,
          { name, taskId, capabilities: missingReport.missingCapabilities }
        );

        logger.info({ taskId, generationId, approvalId: approval.id }, 'Tool generation requires approval');

        return {
          action: 'create_tool',
          success: true,
          generationId,
          approvalId: approval.id,
          requiresApproval: true,
        };
      }

      // Auto-approve and activate
      const { generationService } = getServices();
      await generationService.approve(generationId, 'system:auto');
      await toolGenerator.activate(generationId);

      logger.info({ taskId, generationId, name }, 'Tool auto-generated and activated');

      return {
        action: 'create_tool',
        success: true,
        generationId,
        requiresApproval: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId, name }, 'Tool generation failed');
      return {
        action: 'create_tool',
        success: false,
        error,
        requiresApproval: needsApproval,
      };
    }
  }

  /**
   * Called when a generation is activated (approved + activated)
   * Triggers retry of the original task if within limits
   */
  async onGenerationActivated(generationId: string): Promise<string | null> {
    const pending = this.pendingRetries.get(generationId);

    if (!pending) {
      logger.debug({ generationId }, 'No pending retry for this generation');
      return null;
    }

    if (pending.attempt >= MAX_GENERATION_RETRIES) {
      logger.warn({ generationId, taskId: pending.taskId, attempt: pending.attempt }, 'Max generation retries exceeded');
      this.pendingRetries.delete(generationId);
      return null;
    }

    // Increment attempt and trigger retry
    pending.attempt++;
    const { taskService, eventService } = getServices();

    try {
      const task = await taskService.getById(pending.taskId);

      // Only retry if task is still in a retriable state
      if (task.status !== 'queued' && task.status !== 'pending') {
        logger.info({ taskId: pending.taskId, status: task.status }, 'Task no longer in retriable state');
        this.pendingRetries.delete(generationId);
        return null;
      }

      // Emit retry event
      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_INFO,
        category: 'orchestrator',
        severity: 'info',
        message: `Retrying task ${task.title} after ${pending.actionType} generation`,
        resourceType: 'task',
        resourceId: pending.taskId,
        data: {
          generationId,
          actionType: pending.actionType,
          attempt: pending.attempt,
        },
      });

      logger.info({
        taskId: pending.taskId,
        generationId,
        actionType: pending.actionType,
        attempt: pending.attempt,
      }, 'Task retry triggered after generation');

      // Clean up after successful trigger
      this.pendingRetries.delete(generationId);

      return pending.taskId;
    } catch (err) {
      logger.error({ err, taskId: pending.taskId, generationId }, 'Failed to trigger task retry');
      return null;
    }
  }

  /**
   * Check if a task has pending generation
   */
  hasPendingGeneration(taskId: string): boolean {
    for (const pending of this.pendingRetries.values()) {
      if (pending.taskId === taskId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get pending retry info for a task
   */
  getPendingRetryForTask(taskId: string): PendingRetry | null {
    for (const pending of this.pendingRetries.values()) {
      if (pending.taskId === taskId) {
        return pending;
      }
    }
    return null;
  }

  /**
   * Clean up old pending retries (older than 1 hour)
   */
  cleanupOldPending(): number {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;

    for (const [generationId, pending] of this.pendingRetries.entries()) {
      if (pending.createdAt < oneHourAgo) {
        this.pendingRetries.delete(generationId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old pending retries');
    }

    return cleaned;
  }
}

let actionExecutorInstance: ActionExecutor | null = null;

export function getActionExecutor(): ActionExecutor {
  if (!actionExecutorInstance) {
    actionExecutorInstance = new ActionExecutor();
  }
  return actionExecutorInstance;
}

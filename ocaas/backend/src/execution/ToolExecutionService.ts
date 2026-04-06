/**
 * ToolExecutionService
 *
 * Executes tools in a controlled, auditable manner.
 * Implements whitelist-based security for command execution.
 *
 * Provides:
 * - run_command: Execute whitelisted shell commands
 * - Timeline events for tool execution
 * - Cost tracking for tool usage
 * - Structured logging
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getServices } from '../services/index.js';
import { getGlobalBudgetManager } from '../budget/index.js';
import { getTaskStateManager } from './TaskStateManager/index.js';
import { nanoid } from 'nanoid';

const execAsync = promisify(exec);
const logger = createLogger('ToolExecutionService');

// =============================================================================
// TYPES
// =============================================================================

export interface ToolExecutionInput {
  /** Tool name to execute */
  toolName: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Task context */
  taskId: string;
  /** Agent context */
  agentId: string;
  /** Job context (optional) */
  jobId?: string;
}

export interface ToolExecutionResult {
  /** Unique execution ID */
  executionId: string;
  /** Tool name */
  toolName: string;
  /** Success flag */
  success: boolean;
  /** Tool output */
  output?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    data?: unknown;
  };
  /** Error if failed */
  error?: {
    code: string;
    message: string;
  };
  /** Execution duration in ms */
  durationMs: number;
  /** Timestamp */
  executedAt: number;
}

export interface CommandExecutionInput {
  /** Command to execute */
  command: string;
  /** Working directory (optional, defaults to safe dir) */
  cwd?: string;
  /** Timeout in ms (optional, defaults to 30s) */
  timeout?: number;
}

export interface CommandExecutionOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// =============================================================================
// SECURITY: COMMAND WHITELIST
// =============================================================================

/**
 * Whitelist of allowed commands.
 * Each entry defines:
 * - pattern: regex to match command
 * - description: what the command does
 * - maxArgs: max number of arguments allowed
 */
const COMMAND_WHITELIST: Array<{
  pattern: RegExp;
  description: string;
  maxArgs?: number;
}> = [
  // Safe filesystem commands (read-only)
  { pattern: /^ls(\s|$)/, description: 'List directory contents', maxArgs: 3 },
  { pattern: /^pwd$/, description: 'Print working directory', maxArgs: 0 },
  { pattern: /^cat\s+[\w./-]+$/, description: 'Display file contents', maxArgs: 1 },
  { pattern: /^head(\s+-n\s+\d+)?\s+[\w./-]+$/, description: 'Display first lines', maxArgs: 3 },
  { pattern: /^tail(\s+-n\s+\d+)?\s+[\w./-]+$/, description: 'Display last lines', maxArgs: 3 },
  { pattern: /^wc(\s+-[lwc]+)?\s+[\w./-]+$/, description: 'Word count', maxArgs: 2 },
  { pattern: /^file\s+[\w./-]+$/, description: 'Determine file type', maxArgs: 1 },
  { pattern: /^stat\s+[\w./-]+$/, description: 'File statistics', maxArgs: 1 },

  // Safe search commands
  { pattern: /^find\s+[\w./-]+\s+-name\s+["']?[\w.*]+["']?$/, description: 'Find files by name', maxArgs: 4 },
  { pattern: /^grep(\s+-[rinl]+)*\s+["']?[\w\s.*]+["']?\s+[\w./-]+$/, description: 'Search file contents', maxArgs: 4 },

  // Safe informational commands
  { pattern: /^echo\s+/, description: 'Print text', maxArgs: 10 },
  { pattern: /^date(\s+[+-]?[\w%]+)?$/, description: 'Display date/time', maxArgs: 1 },
  { pattern: /^whoami$/, description: 'Display current user', maxArgs: 0 },
  { pattern: /^hostname$/, description: 'Display hostname', maxArgs: 0 },
  { pattern: /^uname(\s+-[a-z]+)?$/, description: 'System information', maxArgs: 1 },
  { pattern: /^env$/, description: 'Display environment', maxArgs: 0 },
  { pattern: /^printenv(\s+\w+)?$/, description: 'Print environment variable', maxArgs: 1 },

  // Safe process commands (read-only)
  { pattern: /^ps(\s+(aux|ef))?$/, description: 'List processes', maxArgs: 1 },
  { pattern: /^uptime$/, description: 'System uptime', maxArgs: 0 },
  { pattern: /^df(\s+-h)?$/, description: 'Disk space', maxArgs: 1 },
  { pattern: /^free(\s+-[hm])?$/, description: 'Memory usage', maxArgs: 1 },

  // Safe network commands (read-only)
  { pattern: /^curl\s+-s?\s*["']?https?:\/\/[\w./-]+["']?$/, description: 'Fetch URL (GET only)', maxArgs: 2 },
  { pattern: /^ping\s+-c\s+[1-5]\s+[\w.-]+$/, description: 'Ping host (limited)', maxArgs: 4 },

  // Safe git commands (read-only)
  { pattern: /^git\s+status$/, description: 'Git status', maxArgs: 1 },
  { pattern: /^git\s+log(\s+--oneline)?(\s+-n\s+\d+)?$/, description: 'Git log', maxArgs: 4 },
  { pattern: /^git\s+branch(\s+-a)?$/, description: 'Git branches', maxArgs: 2 },
  { pattern: /^git\s+diff(\s+--stat)?$/, description: 'Git diff', maxArgs: 2 },
  { pattern: /^git\s+remote(\s+-v)?$/, description: 'Git remotes', maxArgs: 2 },
];

/**
 * Dangerous patterns that are ALWAYS blocked
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf/,           // Recursive force delete
  /rm\s+.*\*/,          // Delete with wildcard
  />\s*\/dev\/sd/,      // Write to disk device
  /mkfs/,               // Format filesystem
  /dd\s+if=/,           // Direct disk access
  /:(){ :|:& };:/,      // Fork bomb
  /\|\s*sh/,            // Pipe to shell
  /\|\s*bash/,          // Pipe to bash
  /eval\s/,             // Eval command
  /exec\s/,             // Exec command
  /`.*`/,               // Backtick execution
  /\$\(.*\)/,           // Command substitution
  /&&\s*(rm|mv|cp)/,    // Chained destructive
  /;\s*(rm|mv|cp)/,     // Sequential destructive
  /sudo/,               // Privilege escalation
  /su\s/,               // Switch user
  /chmod\s+777/,        // Insecure permissions
  /chown/,              // Change ownership
  /passwd/,             // Password change
  /useradd|userdel/,    // User management
  /systemctl/,          // Service management
  /service\s/,          // Service management
  /shutdown|reboot/,    // System control
  /init\s/,             // Init control
  /kill\s+-9/,          // Force kill
  /pkill|killall/,      // Process killing
];

// =============================================================================
// TOOL EXECUTION SERVICE
// =============================================================================

export class ToolExecutionService {
  private defaultTimeout = 30000; // 30 seconds
  private safeCwd = process.cwd(); // Default to current working directory

  constructor(options?: { safeCwd?: string; defaultTimeout?: number }) {
    if (options?.safeCwd) this.safeCwd = options.safeCwd;
    if (options?.defaultTimeout) this.defaultTimeout = options.defaultTimeout;

    logger.info({
      safeCwd: this.safeCwd,
      defaultTimeout: this.defaultTimeout,
      whitelistedCommands: COMMAND_WHITELIST.length,
    }, 'ToolExecutionService initialized');
  }

  // ===========================================================================
  // MAIN EXECUTION
  // ===========================================================================

  /**
   * Execute a tool by name
   */
  async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const executionId = `texec_${nanoid(8)}`;
    const startTime = Date.now();

    logger.info({
      executionId,
      toolName: input.toolName,
      taskId: input.taskId,
      agentId: input.agentId,
      event: 'TOOL_EXECUTION_STARTED',
    }, `[ToolExecution] Starting ${input.toolName}`);

    // Emit timeline event: STARTED
    await this.emitToolEvent('TOOL_EXECUTION_STARTED', {
      executionId,
      toolName: input.toolName,
      taskId: input.taskId,
      agentId: input.agentId,
      input: this.summarizeInput(input.input),
    });

    try {
      let result: ToolExecutionResult;

      // Route to appropriate handler
      switch (input.toolName) {
        case 'run_command':
          result = await this.executeRunCommand(executionId, input);
          break;
        default:
          result = {
            executionId,
            toolName: input.toolName,
            success: false,
            error: {
              code: 'unknown_tool',
              message: `Tool '${input.toolName}' not found or not implemented`,
            },
            durationMs: Date.now() - startTime,
            executedAt: nowTimestamp(),
          };
      }

      // Record execution in ToolService
      await this.recordToolExecution(input.toolName, result.success);

      // Emit timeline event: COMPLETED or FAILED
      const eventType = result.success ? 'TOOL_EXECUTION_COMPLETED' : 'TOOL_EXECUTION_FAILED';
      await this.emitToolEvent(eventType, {
        executionId,
        toolName: input.toolName,
        taskId: input.taskId,
        agentId: input.agentId,
        success: result.success,
        durationMs: result.durationMs,
        output: result.output ? this.summarizeOutput(result.output) : undefined,
        error: result.error,
      });

      // Structured log
      logger.info({
        executionId,
        toolName: input.toolName,
        taskId: input.taskId,
        success: result.success,
        durationMs: result.durationMs,
        event: eventType,
      }, `[ToolExecution] ${input.toolName} ${result.success ? 'completed' : 'failed'} in ${result.durationMs}ms`);

      // Record in TaskStateManager
      await this.recordInTaskState(input.taskId, result);

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = {
        code: 'execution_error',
        message: err instanceof Error ? err.message : String(err),
      };

      // Emit timeline event: FAILED
      await this.emitToolEvent('TOOL_EXECUTION_FAILED', {
        executionId,
        toolName: input.toolName,
        taskId: input.taskId,
        agentId: input.agentId,
        success: false,
        durationMs,
        error,
      });

      logger.error({
        executionId,
        toolName: input.toolName,
        taskId: input.taskId,
        err,
        event: 'TOOL_EXECUTION_FAILED',
      }, `[ToolExecution] ${input.toolName} failed: ${error.message}`);

      return {
        executionId,
        toolName: input.toolName,
        success: false,
        error,
        durationMs,
        executedAt: nowTimestamp(),
      };
    }
  }

  // ===========================================================================
  // RUN_COMMAND TOOL
  // ===========================================================================

  /**
   * Execute run_command tool with whitelist validation
   */
  private async executeRunCommand(
    executionId: string,
    input: ToolExecutionInput
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const cmdInput = input.input as unknown as CommandExecutionInput;

    if (!cmdInput.command || typeof cmdInput.command !== 'string') {
      return {
        executionId,
        toolName: 'run_command',
        success: false,
        error: {
          code: 'invalid_input',
          message: 'Command is required and must be a string',
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    }

    const command = cmdInput.command.trim();

    // SECURITY: Check blocked patterns first
    for (const blocked of BLOCKED_PATTERNS) {
      if (blocked.test(command)) {
        logger.warn({
          executionId,
          command,
          blockedPattern: blocked.toString(),
          taskId: input.taskId,
          agentId: input.agentId,
          event: 'TOOL_EXECUTION_BLOCKED',
        }, `[ToolExecution] BLOCKED: Dangerous command attempted: ${command}`);

        return {
          executionId,
          toolName: 'run_command',
          success: false,
          error: {
            code: 'command_blocked',
            message: 'Command blocked for security reasons',
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        };
      }
    }

    // SECURITY: Check whitelist
    const whitelisted = COMMAND_WHITELIST.find(w => w.pattern.test(command));
    if (!whitelisted) {
      logger.warn({
        executionId,
        command,
        taskId: input.taskId,
        agentId: input.agentId,
        event: 'TOOL_EXECUTION_BLOCKED',
      }, `[ToolExecution] BLOCKED: Command not whitelisted: ${command}`);

      return {
        executionId,
        toolName: 'run_command',
        success: false,
        error: {
          code: 'command_not_whitelisted',
          message: `Command not in whitelist. Allowed commands: ${COMMAND_WHITELIST.map(w => w.description).join(', ')}`,
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    }

    // Execute command
    const timeout = cmdInput.timeout || this.defaultTimeout;
    const cwd = this.safeCwd; // Always use safe directory

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB max output
        windowsHide: true,
      });

      // Track cost (minimal for local execution)
      const budgetManager = getGlobalBudgetManager();
      budgetManager.recordCost({
        task_id: input.taskId,
        agent_id: input.agentId,
        operation: 'execution', // Use standard operation type
        tier: 'short',
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0.0001, // Symbolic cost for tracking
        budget_decision: 'allow',
      });

      return {
        executionId,
        toolName: 'run_command',
        success: true,
        output: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string; killed?: boolean };

      // Check if killed by timeout
      if (execErr.killed) {
        return {
          executionId,
          toolName: 'run_command',
          success: false,
          output: {
            stdout: execErr.stdout || '',
            stderr: execErr.stderr || '',
            exitCode: -1,
          },
          error: {
            code: 'timeout',
            message: `Command timed out after ${timeout}ms`,
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        };
      }

      // Command executed but returned non-zero exit code
      return {
        executionId,
        toolName: 'run_command',
        success: false,
        output: {
          stdout: execErr.stdout || '',
          stderr: execErr.stderr || '',
          exitCode: execErr.code || 1,
        },
        error: {
          code: 'command_failed',
          message: execErr.stderr || 'Command failed with non-zero exit code',
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    }
  }

  // ===========================================================================
  // SECURITY HELPERS
  // ===========================================================================

  /**
   * Check if a command is allowed (public for validation)
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    // Check blocked patterns
    for (const blocked of BLOCKED_PATTERNS) {
      if (blocked.test(command)) {
        return { allowed: false, reason: 'Command contains blocked pattern' };
      }
    }

    // Check whitelist
    const whitelisted = COMMAND_WHITELIST.find(w => w.pattern.test(command));
    if (!whitelisted) {
      return { allowed: false, reason: 'Command not in whitelist' };
    }

    return { allowed: true };
  }

  /**
   * Get list of allowed command patterns (for documentation)
   */
  getAllowedCommands(): Array<{ pattern: string; description: string }> {
    return COMMAND_WHITELIST.map(w => ({
      pattern: w.pattern.toString(),
      description: w.description,
    }));
  }

  // ===========================================================================
  // EVENT EMISSION
  // ===========================================================================

  private async emitToolEvent(
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      const { eventService } = getServices();
      await eventService.emit({
        type,
        category: 'tool_execution',
        severity: type.includes('FAILED') ? 'warning' : 'info',
        message: `Tool ${data.toolName}: ${type.replace('TOOL_EXECUTION_', '').toLowerCase()}`,
        resourceType: 'task',
        resourceId: data.taskId as string,
        agentId: data.agentId as string,
        data,
      });
    } catch (err) {
      logger.error({ err, type, data }, 'Failed to emit tool event');
    }
  }

  private async recordToolExecution(toolName: string, success: boolean): Promise<void> {
    try {
      const { toolService } = getServices();
      const tool = await toolService.getByName(toolName);
      if (tool) {
        await toolService.recordExecution(tool.id);
      }
    } catch {
      // Tool may not be registered in DB - that's OK for built-in tools
    }
  }

  /**
   * Record tool execution in TaskStateManager for state tracking
   */
  private async recordInTaskState(
    taskId: string,
    result: ToolExecutionResult
  ): Promise<void> {
    try {
      const taskStateManager = getTaskStateManager();
      await taskStateManager.recordToolExecution(taskId, {
        executionId: result.executionId,
        toolName: result.toolName,
        success: result.success,
        durationMs: result.durationMs,
        executedAt: result.executedAt,
        outputSummary: result.output ? this.summarizeOutput(result.output) : undefined,
        error: result.error?.message,
      });
    } catch (err) {
      logger.error({ err, taskId, executionId: result.executionId }, 'Failed to record tool execution in TaskState');
    }
  }

  // ===========================================================================
  // OUTPUT HELPERS
  // ===========================================================================

  private summarizeInput(input: Record<string, unknown>): string {
    const str = JSON.stringify(input);
    return str.length > 200 ? str.slice(0, 200) + '...' : str;
  }

  private summarizeOutput(output: ToolExecutionResult['output']): string {
    if (!output) return '';

    const parts: string[] = [];
    if (output.stdout) {
      parts.push(`stdout: ${output.stdout.slice(0, 100)}${output.stdout.length > 100 ? '...' : ''}`);
    }
    if (output.stderr) {
      parts.push(`stderr: ${output.stderr.slice(0, 100)}${output.stderr.length > 100 ? '...' : ''}`);
    }
    if (output.exitCode !== undefined) {
      parts.push(`exit: ${output.exitCode}`);
    }

    return parts.join(', ');
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: ToolExecutionService | null = null;

export function getToolExecutionService(): ToolExecutionService {
  if (!instance) {
    instance = new ToolExecutionService();
  }
  return instance;
}

export function resetToolExecutionService(): void {
  instance = null;
}

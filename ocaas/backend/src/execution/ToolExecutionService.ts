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

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve as pathResolve, normalize, isAbsolute } from 'path';
import Ajv from 'ajv';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getServices } from '../services/index.js';
import { getGlobalBudgetManager } from '../budget/index.js';
import { getTaskStateManager } from './TaskStateManager/index.js';
import { nanoid } from 'nanoid';
import type {
  ExecutableToolDefinition,
  ToolSecurityPolicy,
  TaskExecutionLimits,
  TaskExecutionState,
  ExecutionLimitCheckResult,
  ToolExecutionAuditEntry,
} from './types.js';
import { DEFAULT_TOOL_SECURITY_POLICY, DEFAULT_EXECUTION_LIMITS } from './types.js';
import { getToolExecutionAuditService } from './ToolExecutionAuditService.js';

// JSON Schema validator instance (reusable)
// AJV v6 options
const ajv = new Ajv({ allErrors: true });

const execAsync = promisify(exec);
const logger = createLogger('ToolExecutionService');

// =============================================================================
// SECURITY CONSTANTS
// =============================================================================

/** Maximum allowed timeout (2 minutes) */
const MAX_TIMEOUT_MS = 120000;

/** Minimum allowed timeout (1 second) */
const MIN_TIMEOUT_MS = 1000;

/** Maximum output size (5MB absolute max) */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/** Path traversal patterns to block */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\./,           // Parent directory
  /^~\//,           // Home directory
  /\/etc\//,        // System config
  /\/root\//,       // Root home
  /\/proc\//,       // Process info
  /\/sys\//,        // System info
  /\/dev\//,        // Devices
  /\/var\/log\//,   // Logs
  /\\\.\./, // Windows parent
  /^[A-Za-z]:\\Windows/i, // Windows system
  /^[A-Za-z]:\\Program Files/i, // Windows programs
];

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
  /** Tool definition (for dynamic execution) */
  toolDefinition?: ExecutableToolDefinition;
}

/**
 * Security check result
 */
export interface SecurityCheckResult {
  /** Did security check pass? */
  passed: boolean;
  /** Was security check performed? */
  checked: boolean;
  /** Failure reason if blocked */
  failureReason?: string;
  /** Failure code for structured handling */
  failureCode?: 'policy_missing' | 'policy_disabled' | 'path_not_allowed' | 'path_traversal' |
    'path_not_found' | 'host_not_allowed' | 'method_not_allowed' | 'network_not_allowed' |
    'filesystem_not_allowed' | 'binary_not_allowed' | 'timeout_exceeded' | 'input_validation_failed';
  /** Policy that was applied */
  policyApplied?: ToolSecurityPolicy;
}

/**
 * Input validation result
 */
export interface InputValidationResult {
  /** Did validation pass? */
  valid: boolean;
  /** Validation errors (if any) */
  errors?: string[];
  /** Schema that was used */
  schemaUsed?: boolean;
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
  /** Security check result */
  security?: SecurityCheckResult;
  /** Input validation result */
  inputValidation?: InputValidationResult;
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

  /** Task execution state tracking (in-memory, per task) */
  private taskExecutionStates: Map<string, TaskExecutionState> = new Map();

  /** Execution limits (can be overridden per instance) */
  private executionLimits: TaskExecutionLimits = DEFAULT_EXECUTION_LIMITS;

  constructor(options?: {
    safeCwd?: string;
    defaultTimeout?: number;
    executionLimits?: Partial<TaskExecutionLimits>;
  }) {
    if (options?.safeCwd) this.safeCwd = options.safeCwd;
    if (options?.defaultTimeout) this.defaultTimeout = options.defaultTimeout;
    if (options?.executionLimits) {
      this.executionLimits = { ...DEFAULT_EXECUTION_LIMITS, ...options.executionLimits };
    }

    logger.info({
      safeCwd: this.safeCwd,
      defaultTimeout: this.defaultTimeout,
      whitelistedCommands: COMMAND_WHITELIST.length,
      executionLimits: this.executionLimits,
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

    // =========================================================================
    // EXECUTION LIMITS CHECK
    // =========================================================================
    const limitCheck = this.checkExecutionLimits(input.taskId);
    if (!limitCheck.allowed) {
      logger.warn({
        executionId,
        toolName: input.toolName,
        taskId: input.taskId,
        limitExceeded: limitCheck.limitExceeded,
        current: limitCheck.current,
        limit: limitCheck.limit,
        event: 'TOOL_EXECUTION_LIMIT_BLOCKED',
      }, `[ToolExecution] BLOCKED: ${input.toolName} - ${limitCheck.message}`);

      return {
        executionId,
        toolName: input.toolName,
        success: false,
        error: {
          code: `execution_limit_${limitCheck.limitExceeded}`,
          message: limitCheck.message || 'Execution limit exceeded',
        },
        durationMs: 0,
        executedAt: nowTimestamp(),
      };
    }

    // Record execution start
    this.recordExecutionStart(input.taskId);

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
      // Priority: 1) toolDefinition (dynamic), 2) built-in tools
      if (input.toolDefinition) {
        // Dynamic execution based on tool definition
        result = await this.executeFromDefinition(executionId, input, input.toolDefinition);
      } else {
        // Built-in tools fallback
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
                message: `Tool '${input.toolName}' not found or not implemented. Provide toolDefinition for dynamic execution.`,
              },
              durationMs: Date.now() - startTime,
              executedAt: nowTimestamp(),
            };
        }
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

      // Record execution end for limits tracking
      this.recordExecutionEnd(input.taskId, result.durationMs);

      // Record in audit log
      await this.recordAuditEntry(input, result);

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;

      // Record execution end for limits tracking (even on error)
      this.recordExecutionEnd(input.taskId, durationMs);
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

      const failedResult: ToolExecutionResult = {
        executionId,
        toolName: input.toolName,
        success: false,
        error,
        durationMs,
        executedAt: nowTimestamp(),
      };

      // Record in audit log (even on failure)
      await this.recordAuditEntry(input, failedResult);

      return failedResult;
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
  // DYNAMIC EXECUTION FROM TOOL DEFINITION
  // ===========================================================================

  /**
   * Execute a tool based on its ExecutableToolDefinition
   * Supports: api (HTTP), script (spawn), binary (exec)
   *
   * SECURITY: All tools are validated against their security policy before execution.
   * Tools without a valid policy are BLOCKED.
   */
  private async executeFromDefinition(
    executionId: string,
    input: ToolExecutionInput,
    definition: ExecutableToolDefinition
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    logger.info({
      executionId,
      toolName: definition.name,
      toolType: definition.type,
      path: definition.path,
      hasPolicy: !!definition.securityPolicy,
      event: 'DYNAMIC_TOOL_EXECUTION_START',
    }, `[ToolExecution] Starting ${definition.type} tool: ${definition.name}`);

    // =========================================================================
    // SECURITY CHECK: Validate tool before execution
    // =========================================================================
    const securityCheck = this.validateToolSecurity(definition, executionId);

    if (!securityCheck.passed) {
      logger.warn({
        executionId,
        toolName: definition.name,
        failureCode: securityCheck.failureCode,
        failureReason: securityCheck.failureReason,
        event: 'TOOL_EXECUTION_SECURITY_BLOCKED',
      }, `[ToolExecution] SECURITY BLOCKED: ${definition.name} - ${securityCheck.failureReason}`);

      return {
        executionId,
        toolName: definition.name,
        success: false,
        error: {
          code: securityCheck.failureCode || 'security_check_failed',
          message: securityCheck.failureReason || 'Security check failed',
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
        security: securityCheck,
      };
    }

    // Get effective limits from policy
    const effectiveTimeout = this.getEffectiveTimeout(securityCheck.policyApplied);
    const effectiveMaxOutput = this.getEffectiveMaxOutput(securityCheck.policyApplied);

    logger.info({
      executionId,
      toolName: definition.name,
      effectiveTimeout,
      effectiveMaxOutput,
      event: 'SECURITY_CHECK_PASSED',
    }, `[ToolExecution] Security passed, executing ${definition.name}`);

    // =========================================================================
    // INPUT VALIDATION: Validate input against tool's inputSchema
    // =========================================================================
    const inputValidation = this.validateToolInput(definition, input.input, executionId);

    if (!inputValidation.valid) {
      logger.warn({
        executionId,
        toolName: definition.name,
        errors: inputValidation.errors,
        event: 'TOOL_EXECUTION_INPUT_INVALID',
      }, `[ToolExecution] INPUT INVALID: ${definition.name} - ${inputValidation.errors?.join(', ')}`);

      return {
        executionId,
        toolName: definition.name,
        success: false,
        error: {
          code: 'input_validation_failed',
          message: `Input validation failed: ${inputValidation.errors?.join(', ') || 'Unknown error'}`,
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
        security: securityCheck,
        inputValidation,
      };
    }

    // Execute based on type
    let result: ToolExecutionResult;
    switch (definition.type) {
      case 'api':
        result = await this.executeApiTool(executionId, input, definition, startTime, effectiveTimeout);
        break;
      case 'script':
        result = await this.executeScriptTool(executionId, input, definition, startTime, effectiveTimeout, effectiveMaxOutput);
        break;
      case 'binary':
        result = await this.executeBinaryTool(executionId, input, definition, startTime, effectiveTimeout, effectiveMaxOutput);
        break;
      default:
        result = {
          executionId,
          toolName: definition.name,
          success: false,
          error: {
            code: 'unsupported_tool_type',
            message: `Tool type '${definition.type}' is not supported`,
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        };
    }

    // Attach security and validation info to result
    result.security = securityCheck;
    result.inputValidation = inputValidation;
    return result;
  }

  /**
   * Execute API tool via HTTP fetch
   */
  private async executeApiTool(
    executionId: string,
    input: ToolExecutionInput,
    definition: ExecutableToolDefinition,
    startTime: number,
    timeout: number = this.defaultTimeout
  ): Promise<ToolExecutionResult> {
    try {
      const url = definition.path;
      const method = (definition.config?.method as string) || 'POST';
      const headers = {
        'Content-Type': 'application/json',
        ...(definition.config?.headers as Record<string, string> || {}),
      };

      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(input.input) : undefined,
        signal: AbortSignal.timeout(timeout),
      });

      const responseText = await response.text();
      let responseData: unknown;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      if (!response.ok) {
        return {
          executionId,
          toolName: definition.name,
          success: false,
          output: {
            data: responseData,
          },
          error: {
            code: 'api_error',
            message: `API returned status ${response.status}: ${response.statusText}`,
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        };
      }

      return {
        executionId,
        toolName: definition.name,
        success: true,
        output: {
          data: responseData,
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    } catch (err) {
      return {
        executionId,
        toolName: definition.name,
        success: false,
        error: {
          code: 'api_execution_failed',
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    }
  }

  /**
   * Execute script tool via spawn (for .js, .py, .sh scripts)
   */
  private async executeScriptTool(
    executionId: string,
    input: ToolExecutionInput,
    definition: ExecutableToolDefinition,
    startTime: number,
    timeout: number = this.defaultTimeout,
    maxOutput: number = 1024 * 1024
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve) => {
      // Resolve path safely
      const scriptPath = isAbsolute(definition.path)
        ? normalize(definition.path)
        : pathResolve(this.safeCwd, definition.path);
      const extension = scriptPath.split('.').pop()?.toLowerCase();

      // Determine interpreter based on extension
      let command: string;
      let args: string[];

      switch (extension) {
        case 'js':
        case 'mjs':
          command = 'node';
          args = [scriptPath];
          break;
        case 'py':
          command = 'python';
          args = [scriptPath];
          break;
        case 'sh':
          command = 'bash';
          args = [scriptPath];
          break;
        case 'ps1':
          command = 'powershell';
          args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
          break;
        default:
          resolve({
            executionId,
            toolName: definition.name,
            success: false,
            error: {
              code: 'unsupported_script',
              message: `Script extension '${extension}' is not supported`,
            },
            durationMs: Date.now() - startTime,
            executedAt: nowTimestamp(),
          });
          return;
      }

      // Pass input as JSON via stdin or environment
      const inputJson = JSON.stringify(input.input);

      const child = spawn(command, args, {
        cwd: this.safeCwd,
        timeout,
        env: {
          ...process.env,
          TOOL_INPUT: inputJson,
        },
        windowsHide: true,
      });

      let outputTruncated = false;

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        if (stdout.length + stderr.length < maxOutput) {
          stdout += data.toString();
          if (stdout.length + stderr.length >= maxOutput) {
            outputTruncated = true;
          }
        }
      });

      child.stderr.on('data', (data) => {
        if (stdout.length + stderr.length < maxOutput) {
          stderr += data.toString();
          if (stdout.length + stderr.length >= maxOutput) {
            outputTruncated = true;
          }
        }
      });

      // Send input to stdin
      child.stdin.write(inputJson);
      child.stdin.end();

      child.on('close', (code) => {
        const success = code === 0;
        let outputData: unknown;

        // Try to parse stdout as JSON
        try {
          outputData = JSON.parse(stdout.trim());
        } catch {
          outputData = stdout.trim();
        }

        resolve({
          executionId,
          toolName: definition.name,
          success,
          output: {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? -1,
            data: outputData,
          },
          error: success ? undefined : {
            code: 'script_failed',
            message: stderr || `Script exited with code ${code}`,
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        });
      });

      child.on('error', (err) => {
        resolve({
          executionId,
          toolName: definition.name,
          success: false,
          error: {
            code: 'script_spawn_error',
            message: err.message,
          },
          durationMs: Date.now() - startTime,
          executedAt: nowTimestamp(),
        });
      });
    });
  }

  /**
   * Execute binary tool via exec (for compiled executables)
   */
  private async executeBinaryTool(
    executionId: string,
    input: ToolExecutionInput,
    definition: ExecutableToolDefinition,
    startTime: number,
    timeout: number = this.defaultTimeout,
    maxOutput: number = 1024 * 1024
  ): Promise<ToolExecutionResult> {
    try {
      // Resolve path safely
      const binaryPath = isAbsolute(definition.path)
        ? normalize(definition.path)
        : pathResolve(this.safeCwd, definition.path);

      // Build command with input as JSON argument
      const inputJson = JSON.stringify(input.input);
      const command = `"${binaryPath}" '${inputJson.replace(/'/g, "\\'")}'`;

      const { stdout, stderr } = await execAsync(command, {
        cwd: this.safeCwd,
        timeout,
        maxBuffer: maxOutput,
        windowsHide: true,
      });

      let outputData: unknown;
      try {
        outputData = JSON.parse(stdout.trim());
      } catch {
        outputData = stdout.trim();
      }

      return {
        executionId,
        toolName: definition.name,
        success: true,
        output: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          data: outputData,
        },
        durationMs: Date.now() - startTime,
        executedAt: nowTimestamp(),
      };
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string; stderr?: string };
      return {
        executionId,
        toolName: definition.name,
        success: false,
        output: {
          stdout: execErr.stdout || '',
          stderr: execErr.stderr || '',
          exitCode: execErr.code || 1,
        },
        error: {
          code: 'binary_execution_failed',
          message: execErr.stderr || 'Binary execution failed',
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
  // TOOL SECURITY VALIDATION
  // ===========================================================================

  /**
   * Validate tool security policy before execution.
   * Returns SecurityCheckResult with pass/fail and reason.
   */
  private validateToolSecurity(
    definition: ExecutableToolDefinition,
    executionId: string
  ): SecurityCheckResult {
    const policy = definition.securityPolicy || DEFAULT_TOOL_SECURITY_POLICY;

    // 1. Check if policy exists and is enabled
    if (!definition.securityPolicy) {
      logger.warn({
        executionId,
        toolName: definition.name,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Tool ${definition.name} has no security policy`);
      return {
        passed: false,
        checked: true,
        failureCode: 'policy_missing',
        failureReason: 'Tool has no security policy defined. Add securityPolicy to ExecutableToolDefinition.',
      };
    }

    if (!policy.enabled) {
      logger.warn({
        executionId,
        toolName: definition.name,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Tool ${definition.name} is disabled`);
      return {
        passed: false,
        checked: true,
        failureCode: 'policy_disabled',
        failureReason: 'Tool is disabled in security policy',
        policyApplied: policy,
      };
    }

    // 2. Validate based on tool type
    switch (definition.type) {
      case 'api':
        return this.validateApiToolSecurity(definition, policy, executionId);
      case 'script':
        return this.validateScriptToolSecurity(definition, policy, executionId);
      case 'binary':
        return this.validateBinaryToolSecurity(definition, policy, executionId);
      default:
        return {
          passed: false,
          checked: true,
          failureCode: 'policy_disabled',
          failureReason: `Unknown tool type: ${definition.type}`,
          policyApplied: policy,
        };
    }
  }

  /**
   * Validate API tool security
   */
  private validateApiToolSecurity(
    definition: ExecutableToolDefinition,
    policy: ToolSecurityPolicy,
    executionId: string
  ): SecurityCheckResult {
    // Check network permission
    if (!policy.allowNetwork) {
      logger.warn({
        executionId,
        toolName: definition.name,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: API tool ${definition.name} requires network access but policy denies it`);
      return {
        passed: false,
        checked: true,
        failureCode: 'network_not_allowed',
        failureReason: 'API tool requires network access but policy.allowNetwork is false',
        policyApplied: policy,
      };
    }

    // Parse and validate URL host
    const url = definition.path;
    let host: string;
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
    } catch {
      return {
        passed: false,
        checked: true,
        failureCode: 'host_not_allowed',
        failureReason: `Invalid URL: ${url}`,
        policyApplied: policy,
      };
    }

    // Check allowed hosts whitelist
    if (policy.allowedHosts && policy.allowedHosts.length > 0) {
      const hostAllowed = policy.allowedHosts.some(
        allowed => host === allowed || host.endsWith(`.${allowed}`)
      );
      if (!hostAllowed) {
        logger.warn({
          executionId,
          toolName: definition.name,
          host,
          allowedHosts: policy.allowedHosts,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: API host ${host} not in allowed list`);
        return {
          passed: false,
          checked: true,
          failureCode: 'host_not_allowed',
          failureReason: `Host '${host}' not in allowed hosts: ${policy.allowedHosts.join(', ')}`,
          policyApplied: policy,
        };
      }
    }

    // Check allowed methods
    const method = ((definition.config?.method as string) || 'POST').toUpperCase();
    if (policy.allowedMethods && policy.allowedMethods.length > 0) {
      if (!policy.allowedMethods.includes(method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')) {
        logger.warn({
          executionId,
          toolName: definition.name,
          method,
          allowedMethods: policy.allowedMethods,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: Method ${method} not allowed`);
        return {
          passed: false,
          checked: true,
          failureCode: 'method_not_allowed',
          failureReason: `HTTP method '${method}' not in allowed methods: ${policy.allowedMethods.join(', ')}`,
          policyApplied: policy,
        };
      }
    }

    logger.info({
      executionId,
      toolName: definition.name,
      host,
      method,
      event: 'SECURITY_CHECK_PASSED',
    }, `[Security] PASSED: API tool ${definition.name}`);

    return {
      passed: true,
      checked: true,
      policyApplied: policy,
    };
  }

  /**
   * Validate script tool security
   */
  private validateScriptToolSecurity(
    definition: ExecutableToolDefinition,
    policy: ToolSecurityPolicy,
    executionId: string
  ): SecurityCheckResult {
    // Check filesystem permission
    if (!policy.allowFilesystem) {
      logger.warn({
        executionId,
        toolName: definition.name,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Script tool ${definition.name} requires filesystem access`);
      return {
        passed: false,
        checked: true,
        failureCode: 'filesystem_not_allowed',
        failureReason: 'Script tool requires filesystem access but policy.allowFilesystem is false',
        policyApplied: policy,
      };
    }

    const scriptPath = definition.path;

    // Check for path traversal attacks
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(scriptPath)) {
        logger.warn({
          executionId,
          toolName: definition.name,
          path: scriptPath,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: Path traversal detected: ${scriptPath}`);
        return {
          passed: false,
          checked: true,
          failureCode: 'path_traversal',
          failureReason: `Path contains forbidden pattern: ${scriptPath}`,
          policyApplied: policy,
        };
      }
    }

    // Resolve and normalize path
    const resolvedPath = isAbsolute(scriptPath)
      ? normalize(scriptPath)
      : pathResolve(this.safeCwd, scriptPath);

    // Check if path exists
    if (!existsSync(resolvedPath)) {
      logger.warn({
        executionId,
        toolName: definition.name,
        path: resolvedPath,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Script path does not exist: ${resolvedPath}`);
      return {
        passed: false,
        checked: true,
        failureCode: 'path_not_found',
        failureReason: `Script path does not exist: ${resolvedPath}`,
        policyApplied: policy,
      };
    }

    // Check allowed paths whitelist
    if (policy.allowedPaths && policy.allowedPaths.length > 0 && !policy.trusted) {
      const pathAllowed = policy.allowedPaths.some(allowed => {
        const normalizedAllowed = normalize(allowed);
        return resolvedPath.startsWith(normalizedAllowed);
      });
      if (!pathAllowed) {
        logger.warn({
          executionId,
          toolName: definition.name,
          path: resolvedPath,
          allowedPaths: policy.allowedPaths,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: Script path not in allowed list: ${resolvedPath}`);
        return {
          passed: false,
          checked: true,
          failureCode: 'path_not_allowed',
          failureReason: `Script path '${resolvedPath}' not in allowed paths: ${policy.allowedPaths.join(', ')}`,
          policyApplied: policy,
        };
      }
    }

    logger.info({
      executionId,
      toolName: definition.name,
      path: resolvedPath,
      event: 'SECURITY_CHECK_PASSED',
    }, `[Security] PASSED: Script tool ${definition.name}`);

    return {
      passed: true,
      checked: true,
      policyApplied: policy,
    };
  }

  /**
   * Validate binary tool security
   */
  private validateBinaryToolSecurity(
    definition: ExecutableToolDefinition,
    policy: ToolSecurityPolicy,
    executionId: string
  ): SecurityCheckResult {
    // Check binary execution permission
    if (!policy.allowBinaryExecution) {
      logger.warn({
        executionId,
        toolName: definition.name,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Binary tool ${definition.name} requires binary execution permission`);
      return {
        passed: false,
        checked: true,
        failureCode: 'binary_not_allowed',
        failureReason: 'Binary tool requires binary execution but policy.allowBinaryExecution is false',
        policyApplied: policy,
      };
    }

    // Check filesystem permission (binaries need filesystem access)
    if (!policy.allowFilesystem) {
      return {
        passed: false,
        checked: true,
        failureCode: 'filesystem_not_allowed',
        failureReason: 'Binary tool requires filesystem access but policy.allowFilesystem is false',
        policyApplied: policy,
      };
    }

    const binaryPath = definition.path;

    // Check for path traversal attacks
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(binaryPath)) {
        logger.warn({
          executionId,
          toolName: definition.name,
          path: binaryPath,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: Path traversal detected: ${binaryPath}`);
        return {
          passed: false,
          checked: true,
          failureCode: 'path_traversal',
          failureReason: `Path contains forbidden pattern: ${binaryPath}`,
          policyApplied: policy,
        };
      }
    }

    // Resolve and normalize path
    const resolvedPath = isAbsolute(binaryPath)
      ? normalize(binaryPath)
      : pathResolve(this.safeCwd, binaryPath);

    // Check if binary exists
    if (!existsSync(resolvedPath)) {
      logger.warn({
        executionId,
        toolName: definition.name,
        path: resolvedPath,
        event: 'SECURITY_CHECK_FAILED',
      }, `[Security] BLOCKED: Binary path does not exist: ${resolvedPath}`);
      return {
        passed: false,
        checked: true,
        failureCode: 'path_not_found',
        failureReason: `Binary path does not exist: ${resolvedPath}`,
        policyApplied: policy,
      };
    }

    // Check allowed paths whitelist
    if (policy.allowedPaths && policy.allowedPaths.length > 0 && !policy.trusted) {
      const pathAllowed = policy.allowedPaths.some(allowed => {
        const normalizedAllowed = normalize(allowed);
        return resolvedPath.startsWith(normalizedAllowed);
      });
      if (!pathAllowed) {
        logger.warn({
          executionId,
          toolName: definition.name,
          path: resolvedPath,
          allowedPaths: policy.allowedPaths,
          event: 'SECURITY_CHECK_FAILED',
        }, `[Security] BLOCKED: Binary path not in allowed list: ${resolvedPath}`);
        return {
          passed: false,
          checked: true,
          failureCode: 'path_not_allowed',
          failureReason: `Binary path '${resolvedPath}' not in allowed paths: ${policy.allowedPaths.join(', ')}`,
          policyApplied: policy,
        };
      }
    }

    logger.info({
      executionId,
      toolName: definition.name,
      path: resolvedPath,
      event: 'SECURITY_CHECK_PASSED',
    }, `[Security] PASSED: Binary tool ${definition.name}`);

    return {
      passed: true,
      checked: true,
      policyApplied: policy,
    };
  }

  /**
   * Get effective timeout from policy with bounds checking
   */
  private getEffectiveTimeout(policy?: ToolSecurityPolicy): number {
    const timeout = policy?.timeoutMs ?? this.defaultTimeout;
    return Math.min(Math.max(timeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }

  /**
   * Get effective max output size from policy with bounds checking
   */
  private getEffectiveMaxOutput(policy?: ToolSecurityPolicy): number {
    const maxOutput = policy?.maxOutputBytes ?? (1024 * 1024);
    return Math.min(maxOutput, MAX_OUTPUT_BYTES);
  }

  // ===========================================================================
  // INPUT VALIDATION
  // ===========================================================================

  /**
   * Validate tool input against its JSON Schema definition.
   * If tool has no inputSchema, validation passes (but schemaUsed=false).
   * If tool has inputSchema, input MUST match or execution is blocked.
   */
  private validateToolInput(
    definition: ExecutableToolDefinition,
    input: Record<string, unknown>,
    executionId: string
  ): InputValidationResult {
    // No schema defined - pass but note schema wasn't used
    if (!definition.inputSchema || Object.keys(definition.inputSchema).length === 0) {
      logger.debug({
        executionId,
        toolName: definition.name,
        event: 'INPUT_VALIDATION_SKIPPED',
      }, `[InputValidation] No schema defined for ${definition.name}, skipping validation`);
      return {
        valid: true,
        schemaUsed: false,
      };
    }

    try {
      // Compile schema (AJV caches compiled schemas)
      const validate = ajv.compile(definition.inputSchema);
      const isValid = validate(input);

      if (!isValid) {
        const errors = validate.errors?.map(err => {
          // AJV v6 uses dataPath, v8+ uses instancePath
          const path = (err as { dataPath?: string; instancePath?: string }).dataPath ||
                       (err as { instancePath?: string }).instancePath || '(root)';
          return `${path}: ${err.message}`;
        }) || ['Unknown validation error'];

        logger.warn({
          executionId,
          toolName: definition.name,
          errors,
          input: this.summarizeInput(input),
          event: 'INPUT_VALIDATION_FAILED',
        }, `[InputValidation] FAILED: ${definition.name} - ${errors.join(', ')}`);

        return {
          valid: false,
          errors,
          schemaUsed: true,
        };
      }

      logger.info({
        executionId,
        toolName: definition.name,
        event: 'INPUT_VALIDATION_PASSED',
      }, `[InputValidation] PASSED: ${definition.name}`);

      return {
        valid: true,
        schemaUsed: true,
      };
    } catch (err) {
      // Schema compilation or validation error
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({
        executionId,
        toolName: definition.name,
        error: errorMsg,
        event: 'INPUT_VALIDATION_ERROR',
      }, `[InputValidation] Schema error for ${definition.name}: ${errorMsg}`);

      return {
        valid: false,
        errors: [`Schema error: ${errorMsg}`],
        schemaUsed: true,
      };
    }
  }

  // ===========================================================================
  // EXECUTION LIMITS
  // ===========================================================================

  /**
   * Get or create execution state for a task
   */
  private getTaskExecutionState(taskId: string): TaskExecutionState {
    let state = this.taskExecutionStates.get(taskId);
    if (!state) {
      state = {
        taskId,
        toolExecutionCount: 0,
        totalExecutionMs: 0,
        currentConcurrent: 0,
        retryCount: 0,
      };
      this.taskExecutionStates.set(taskId, state);
    }
    return state;
  }

  /**
   * Check if execution can proceed within limits
   */
  private checkExecutionLimits(taskId: string): ExecutionLimitCheckResult {
    const state = this.getTaskExecutionState(taskId);

    // Check max executions
    if (state.toolExecutionCount >= this.executionLimits.maxToolExecutionsPerTask) {
      logger.warn({
        taskId,
        current: state.toolExecutionCount,
        limit: this.executionLimits.maxToolExecutionsPerTask,
        event: 'EXECUTION_LIMIT_EXCEEDED',
      }, `[ExecutionLimits] Max executions exceeded for task ${taskId}`);
      return {
        allowed: false,
        limitExceeded: 'max_executions',
        current: state.toolExecutionCount,
        limit: this.executionLimits.maxToolExecutionsPerTask,
        message: `Maximum tool executions (${this.executionLimits.maxToolExecutionsPerTask}) exceeded`,
      };
    }

    // Check max total time
    if (state.totalExecutionMs >= this.executionLimits.maxTotalExecutionMsPerTask) {
      logger.warn({
        taskId,
        current: state.totalExecutionMs,
        limit: this.executionLimits.maxTotalExecutionMsPerTask,
        event: 'EXECUTION_LIMIT_EXCEEDED',
      }, `[ExecutionLimits] Max execution time exceeded for task ${taskId}`);
      return {
        allowed: false,
        limitExceeded: 'max_time',
        current: state.totalExecutionMs,
        limit: this.executionLimits.maxTotalExecutionMsPerTask,
        message: `Maximum execution time (${this.executionLimits.maxTotalExecutionMsPerTask}ms) exceeded`,
      };
    }

    // Check max concurrent
    if (state.currentConcurrent >= this.executionLimits.maxConcurrentTools) {
      logger.warn({
        taskId,
        current: state.currentConcurrent,
        limit: this.executionLimits.maxConcurrentTools,
        event: 'EXECUTION_LIMIT_EXCEEDED',
      }, `[ExecutionLimits] Max concurrent executions for task ${taskId}`);
      return {
        allowed: false,
        limitExceeded: 'max_concurrent',
        current: state.currentConcurrent,
        limit: this.executionLimits.maxConcurrentTools,
        message: `Maximum concurrent tools (${this.executionLimits.maxConcurrentTools}) reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record execution start (increment counters)
   */
  private recordExecutionStart(taskId: string): void {
    const state = this.getTaskExecutionState(taskId);
    state.toolExecutionCount++;
    state.currentConcurrent++;
    state.lastExecutionAt = Date.now();
    if (!state.firstExecutionAt) {
      state.firstExecutionAt = state.lastExecutionAt;
    }
  }

  /**
   * Record execution end (update metrics)
   */
  private recordExecutionEnd(taskId: string, durationMs: number): void {
    const state = this.getTaskExecutionState(taskId);
    state.currentConcurrent = Math.max(0, state.currentConcurrent - 1);
    state.totalExecutionMs += durationMs;
  }

  /**
   * Get execution state for a task (public for monitoring)
   */
  getExecutionState(taskId: string): TaskExecutionState | undefined {
    return this.taskExecutionStates.get(taskId);
  }

  /**
   * Clear execution state for a task (call when task completes)
   */
  clearExecutionState(taskId: string): void {
    this.taskExecutionStates.delete(taskId);
    logger.debug({ taskId }, '[ExecutionLimits] Cleared execution state');
  }

  /**
   * Get current execution limits
   */
  getExecutionLimits(): TaskExecutionLimits {
    return { ...this.executionLimits };
  }

  // ===========================================================================
  // AUDIT LOGGING
  // ===========================================================================

  /**
   * Record an execution in the audit log
   */
  private async recordAuditEntry(
    input: ToolExecutionInput,
    result: ToolExecutionResult
  ): Promise<void> {
    try {
      const auditService = getToolExecutionAuditService();
      const toolType: ToolExecutionAuditEntry['toolType'] =
        input.toolDefinition?.type || (input.toolName === 'run_command' ? 'run_command' : 'unknown');

      await auditService.recordExecution(
        {
          executionId: result.executionId,
          toolName: input.toolName,
          toolType,
          taskId: input.taskId,
          jobId: input.jobId,
          agentId: input.agentId,
          inputSummary: this.summarizeInput(input.input),
        },
        result,
        result.inputValidation,
        result.security
      );
    } catch (err) {
      // Audit should never break execution
      logger.error({ err, executionId: result.executionId }, '[Audit] Failed to record audit entry');
    }
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

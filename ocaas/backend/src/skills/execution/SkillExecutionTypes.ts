/**
 * Skill Execution Types
 *
 * Type definitions for the skill execution model.
 * Supports sequential pipeline execution of tools within a skill.
 */

import type { ToolDTO, SkillDTO, SkillToolLink } from '../../types/domain.js';

// =============================================================================
// EXECUTION MODES
// =============================================================================

/**
 * Execution modes for skill execution
 */
export const EXECUTION_MODE = {
  /** Actually execute the tools (production mode) */
  RUN: 'run',
  /** Validate inputs and check tool availability without executing */
  VALIDATE: 'validate',
  /** Dry run - simulate execution without side effects */
  DRY_RUN: 'dry_run',
} as const;

export type ExecutionMode = typeof EXECUTION_MODE[keyof typeof EXECUTION_MODE];

// =============================================================================
// EXECUTION STATUS
// =============================================================================

/**
 * Status of skill/tool execution
 */
export const EXECUTION_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
} as const;

export type ExecutionStatus = typeof EXECUTION_STATUS[keyof typeof EXECUTION_STATUS];

// =============================================================================
// EXECUTION INPUT
// =============================================================================

/**
 * Input for a skill execution request
 */
export interface SkillExecutionInput {
  /** ID of the skill to execute */
  skillId: string;

  /** Execution mode */
  mode: ExecutionMode;

  /** Initial input data passed to the first tool */
  input: Record<string, unknown>;

  /** Optional context data available to all tools */
  context?: Record<string, unknown>;

  /** Optional timeout override (ms) */
  timeoutMs?: number;

  /** Whether to stop on first error (default: true for required tools) */
  stopOnError?: boolean;

  /** Caller identification (agent, user, system) */
  caller?: {
    type: 'agent' | 'user' | 'system';
    id: string;
    name?: string;
  };
}

// =============================================================================
// TOOL EXECUTION
// =============================================================================

/**
 * Input for a single tool execution
 */
export interface ToolExecutionInput {
  /** Tool to execute */
  tool: ToolDTO;

  /** Input data for this tool */
  input: Record<string, unknown>;

  /** Config overrides from skill-tool link */
  configOverrides?: Record<string, unknown>;

  /** Execution context */
  context?: Record<string, unknown>;

  /** Timeout (ms) */
  timeoutMs?: number;
}

/**
 * Result of a single tool execution
 */
export interface ToolExecutionResult {
  /** Tool ID */
  toolId: string;

  /** Tool name (for logging) */
  toolName: string;

  /** Execution status */
  status: ExecutionStatus;

  /** Output data from the tool */
  output?: Record<string, unknown>;

  /** Error message if failed */
  error?: string;

  /** Error stack trace (if available) */
  errorStack?: string;

  /** Start timestamp (ms) */
  startedAt: number;

  /** End timestamp (ms) */
  completedAt: number;

  /** Duration (ms) */
  durationMs: number;

  /** Whether this tool was required */
  required: boolean;

  /** Role of this tool in the skill */
  role?: string;

  /** Order index in the pipeline */
  orderIndex: number;
}

// =============================================================================
// SKILL EXECUTION
// =============================================================================

/**
 * Result of a complete skill execution
 */
export interface SkillExecutionResult {
  /** Unique execution ID */
  executionId: string;

  /** Skill ID */
  skillId: string;

  /** Skill name (for logging) */
  skillName: string;

  /** Execution mode used */
  mode: ExecutionMode;

  /** Overall execution status */
  status: ExecutionStatus;

  /** Results from each tool in order */
  toolResults: ToolExecutionResult[];

  /** Final output (from last successful tool) */
  output?: Record<string, unknown>;

  /** Error message if failed */
  error?: string;

  /** Number of tools executed */
  toolsExecuted: number;

  /** Number of tools that succeeded */
  toolsSucceeded: number;

  /** Number of tools that failed */
  toolsFailed: number;

  /** Number of tools skipped */
  toolsSkipped: number;

  /** Total execution time (ms) */
  totalDurationMs: number;

  /** Start timestamp (ms) */
  startedAt: number;

  /** End timestamp (ms) */
  completedAt: number;

  /** Caller info */
  caller?: {
    type: 'agent' | 'user' | 'system';
    id: string;
    name?: string;
  };
}

// =============================================================================
// EXECUTION PREVIEW
// =============================================================================

/**
 * Preview of what a skill execution would do
 * Used for UI preview and validation
 */
export interface SkillExecutionPreview {
  /** Skill ID */
  skillId: string;

  /** Skill name */
  skillName: string;

  /** Whether the skill can be executed */
  canExecute: boolean;

  /** Reasons why execution is not possible (if any) */
  blockers: string[];

  /** Warnings that don't block execution */
  warnings: string[];

  /** Tools that will be executed, in order */
  pipeline: {
    orderIndex: number;
    toolId: string;
    toolName: string;
    toolType: string;
    required: boolean;
    role?: string;
    status: 'active' | 'inactive' | 'deprecated' | 'missing';
    estimatedDurationMs?: number;
  }[];

  /** Total estimated duration (ms) */
  estimatedTotalDurationMs?: number;

  /** Required input schema (combined from tools) */
  requiredInput?: Record<string, unknown>;
}

// =============================================================================
// VALIDATION RESULT
// =============================================================================

/**
 * Result of validating a skill execution request
 */
export interface SkillValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Skill ID */
  skillId: string;

  /** Validation errors (blocking) */
  errors: ValidationError[];

  /** Validation warnings (non-blocking) */
  warnings: ValidationWarning[];

  /** Tools validated */
  toolsChecked: number;

  /** Tools with issues */
  toolsWithIssues: number;
}

export interface ValidationError {
  code: string;
  message: string;
  toolId?: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  toolId?: string;
  field?: string;
}

// =============================================================================
// EXECUTION LOG
// =============================================================================

/**
 * Log entry for execution events
 */
export interface ExecutionLogEntry {
  /** Timestamp (ms) */
  timestamp: number;

  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';

  /** Log message */
  message: string;

  /** Phase of execution */
  phase: 'init' | 'validation' | 'tool_start' | 'tool_end' | 'complete' | 'error';

  /** Related tool ID (if applicable) */
  toolId?: string;

  /** Related tool name (if applicable) */
  toolName?: string;

  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Complete execution log
 */
export interface ExecutionLog {
  /** Execution ID */
  executionId: string;

  /** Skill ID */
  skillId: string;

  /** Log entries in chronological order */
  entries: ExecutionLogEntry[];

  /** Total execution time (ms) */
  totalDurationMs: number;
}

// =============================================================================
// PIPELINE CONTEXT
// =============================================================================

/**
 * Context passed between tools in a pipeline
 * Allows tools to share data and accumulate results
 */
export interface PipelineContext {
  /** Execution ID */
  executionId: string;

  /** Skill being executed */
  skill: SkillDTO;

  /** Execution mode */
  mode: ExecutionMode;

  /** Initial input */
  initialInput: Record<string, unknown>;

  /** User-provided context */
  userContext: Record<string, unknown>;

  /** Accumulated results from previous tools */
  previousResults: ToolExecutionResult[];

  /** Current output (passed to next tool) */
  currentOutput: Record<string, unknown>;

  /** Execution log entries */
  log: ExecutionLogEntry[];

  /** Start timestamp */
  startedAt: number;

  /** Timeout (ms) */
  timeoutMs: number;

  /** Whether to stop on error */
  stopOnError: boolean;

  /** Caller info */
  caller?: {
    type: 'agent' | 'user' | 'system';
    id: string;
    name?: string;
  };
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isExecutionSuccess(result: SkillExecutionResult): boolean {
  return result.status === EXECUTION_STATUS.SUCCESS;
}

export function isExecutionFailed(result: SkillExecutionResult): boolean {
  return result.status === EXECUTION_STATUS.FAILED;
}

export function isToolRequired(link: SkillToolLink): boolean {
  return link.required === true;
}

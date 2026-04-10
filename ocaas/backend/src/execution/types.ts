/**
 * Job Execution Types
 *
 * Contract for OCAAS → OpenClaw job execution.
 * Defines the standard payload, responses, and blocking scenarios.
 */

import type { RoleType } from '../organization/types.js';
import type { ExecutionTraceability, TruthLevel } from './ExecutionTraceability.js';

// ============================================================================
// JOB PAYLOAD (OCAAS → OpenClaw)
// ============================================================================

/**
 * Standard job payload sent to OpenClaw runtime
 */
export interface JobPayload {
  /** Unique job ID (for tracking) */
  jobId: string;

  /** OCAAS task ID */
  taskId: string;

  /** Subtask ID if this is part of a decomposed task */
  subtaskId?: string;

  /** Parent job ID if this is a child job */
  parentJobId?: string;

  /** Goal/objective for this job */
  goal: string;

  /** Detailed description/instructions */
  description?: string;

  /** Input data for the job */
  input?: Record<string, unknown>;

  /** Agent context */
  agent: JobAgentContext;

  /** Allowed resources */
  allowedResources: JobAllowedResources;

  /** Execution constraints */
  constraints: JobConstraints;

  /** Additional context */
  context?: JobContext;

  /** Created timestamp */
  createdAt: number;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Agent context for the job
 */
export interface JobAgentContext {
  /** OCAAS agent ID */
  agentId: string;

  /** Agent name */
  name: string;

  /** Agent type */
  type: 'general' | 'specialist' | 'orchestrator';

  /** Organizational role */
  role: RoleType;

  /** Agent capabilities */
  capabilities: string[];

  /** System prompt for the agent */
  systemPrompt: string;

  /** Model to use (if specified) */
  model?: string;

  /** Temperature (if specified) */
  temperature?: number;
}

// ============================================================================
// TOOL SECURITY POLICY
// ============================================================================

/**
 * Security policy for tool execution.
 * Tools without a valid policy or with enabled=false are BLOCKED.
 */
export interface ToolSecurityPolicy {
  /** Is this tool enabled for execution? */
  enabled: boolean;

  /** Allow outbound network requests (for API tools) */
  allowNetwork: boolean;

  /** Allow filesystem access (for script/binary tools) */
  allowFilesystem: boolean;

  /** Allow binary execution (for binary tools) */
  allowBinaryExecution: boolean;

  /** Allowed paths for script/binary execution (must match one) */
  allowedPaths?: string[];

  /** Allowed URL hosts for API tools (must match one) */
  allowedHosts?: string[];

  /** Allowed HTTP methods for API tools */
  allowedMethods?: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;

  /** Maximum execution timeout in ms (default: 30000, max: 120000) */
  timeoutMs?: number;

  /** Maximum output size in bytes (default: 1MB) */
  maxOutputBytes?: number;

  /** Trusted: skip some validations (only for system tools) */
  trusted?: boolean;
}

/**
 * Default security policy - restrictive
 */
export const DEFAULT_TOOL_SECURITY_POLICY: ToolSecurityPolicy = {
  enabled: false,
  allowNetwork: false,
  allowFilesystem: false,
  allowBinaryExecution: false,
  timeoutMs: 30000,
  maxOutputBytes: 1024 * 1024, // 1MB
};

/**
 * Executable tool definition for OpenClaw runtime
 * Contains all information needed for the runtime to execute the tool
 */
export interface ExecutableToolDefinition {
  /** Tool ID (for traceability) */
  id: string;

  /** Tool name (unique identifier for invocation) */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Tool type: determines execution method */
  type: 'script' | 'binary' | 'api';

  /** Path to executable/script (for script/binary) or endpoint URL (for api) */
  path: string;

  /** Input schema (JSON Schema format) for parameter validation */
  inputSchema?: Record<string, unknown>;

  /** Output schema (JSON Schema format) */
  outputSchema?: Record<string, unknown>;

  /** Additional configuration */
  config?: Record<string, unknown>;

  /** Security policy for this tool */
  securityPolicy?: ToolSecurityPolicy;
}

/**
 * Executable skill definition for OpenClaw runtime
 */
export interface ExecutableSkillDefinition {
  /** Skill ID (for traceability) */
  id: string;

  /** Skill name */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Capabilities provided by this skill */
  capabilities?: string[];

  /** Tools included in this skill */
  tools?: ExecutableToolDefinition[];
}

/**
 * Resources the agent is allowed to use
 */
export interface JobAllowedResources {
  /** Allowed tool IDs (for backwards compatibility and traceability) */
  tools: string[];

  /** Allowed skill IDs (for backwards compatibility and traceability) */
  skills: string[];

  /** Executable tool definitions (full definitions for runtime) */
  toolDefinitions?: ExecutableToolDefinition[];

  /** Executable skill definitions (full definitions for runtime) */
  skillDefinitions?: ExecutableSkillDefinition[];

  /** Can use web search */
  webSearch: boolean;

  /** Can execute code */
  codeExecution: boolean;

  /** Can access filesystem */
  fileAccess: boolean;

  /** Can make API calls */
  apiAccess: boolean;
}

/**
 * Execution constraints
 */
export interface JobConstraints {
  /** Autonomy level for this job */
  autonomyLevel: 'manual' | 'supervised' | 'autonomous';

  /** Max tokens for response */
  maxTokens?: number;

  /** Max tool calls allowed */
  maxToolCalls?: number;

  /** Max retries within OpenClaw */
  maxRetries?: number;

  /** Require confirmation for destructive operations */
  requireConfirmation: boolean;

  /** Priority (1-4, 4 = critical) */
  priority: number;

  /** Can create new resources */
  canCreateResources: boolean;

  /** Can delegate to other agents */
  canDelegate: boolean;
}

/**
 * Additional context for the job
 */
export interface JobContext {
  /** Previous job results (for chained jobs) */
  previousResults?: Array<{
    jobId: string;
    summary: string;
    output?: Record<string, unknown>;
  }>;

  /** Parent task context */
  taskContext?: {
    title: string;
    description?: string;
    totalSubtasks?: number;
    completedSubtasks?: number;
  };

  /** User-provided context */
  userContext?: string;

  /** Environment variables/config */
  environment?: Record<string, string>;
}

// ============================================================================
// JOB RESPONSE (OpenClaw → OCAAS)
// ============================================================================

/**
 * Job execution status
 */
export type JobStatus =
  | 'pending'      // Queued but not started
  | 'running'      // Currently executing
  | 'accepted'     // Accepted by async handler (hooks_session), awaiting result via channel
  | 'completed'    // Finished successfully (REAL execution)
  | 'completed_with_fallback' // Finished with fallback evidence
  | 'completed_stub' // Finished with stub evidence (simulated)
  | 'failed'       // Failed with error
  | 'blocked'      // Blocked on missing resource/capability
  | 'cancelled'    // Cancelled by user/system
  | 'timeout';     // Exceeded timeout

/**
 * Response from OpenClaw after job execution
 */
export interface JobResponse {
  /** Job ID */
  jobId: string;

  /** Execution status */
  status: JobStatus;

  /** OpenClaw session ID (if created) */
  sessionId?: string;

  /** Result data (for completed jobs) */
  result?: JobResult;

  /** Error info (for failed jobs) */
  error?: JobError;

  /** Blocking info (for blocked jobs) */
  blocked?: JobBlocked;

  /** Execution metrics */
  metrics?: JobMetrics;

  /** Timestamp when job completed/failed/blocked */
  completedAt?: number;

  /** Execution traceability (BLOQUE 10) */
  traceability?: ExecutionTraceability;

  /** Execution truth verification result */
  truth?: {
    level: TruthLevel;
    reason: string;
  };
}

/**
 * Successful job result
 */
export interface JobResult {
  /** Main output/response */
  output: string;

  /** Structured data output */
  data?: Record<string, unknown>;

  /** Files created/modified */
  artifacts?: Array<{
    type: 'file' | 'image' | 'data';
    name: string;
    path?: string;
    url?: string;
  }>;

  /** Summary of actions taken */
  actionsSummary?: string;

  /** Tools used during execution */
  toolsUsed?: string[];

  /** Skills invoked during execution */
  skillsInvoked?: string[];
}

/**
 * Job error information
 */
export interface JobError {
  /** Error code */
  code: JobErrorCode;

  /** Human-readable message */
  message: string;

  /** Detailed error info */
  details?: Record<string, unknown>;

  /** Stack trace (if available) */
  stack?: string;

  /** Is this error retryable */
  retryable: boolean;

  /** Suggested action */
  suggestedAction?: 'retry' | 'escalate' | 'abort' | 'modify_input';
}

export type JobErrorCode =
  | 'execution_failed'
  | 'timeout'
  | 'rate_limited'
  | 'auth_error'
  | 'invalid_input'
  | 'tool_error'
  | 'skill_error'
  | 'resource_error'
  | 'agent_bundle_incomplete' // PROMPT 13: Agent from incomplete bundle
  | 'unknown';

// ============================================================================
// BLOCKING (Critical for resource proposals)
// ============================================================================

/**
 * Information when job is blocked
 */
export interface JobBlocked {
  /** Blocking reason type */
  reason: BlockingReason;

  /** Human-readable description */
  description: string;

  /** Missing resources/capabilities */
  missing: MissingResource[];

  /** Suggestions for resolution */
  suggestions: BlockingSuggestion[];

  /** Can be auto-resolved */
  canAutoResolve: boolean;

  /** Requires human intervention */
  requiresHuman: boolean;
}

export type BlockingReason =
  | 'missing_tool'
  | 'missing_skill'
  | 'missing_capability'
  | 'missing_permission'
  | 'missing_data'
  | 'dependency_failed'
  | 'awaiting_approval'
  | 'external_dependency';

/**
 * Missing resource that caused blocking
 */
export interface MissingResource {
  /** Resource type */
  type: 'tool' | 'skill' | 'capability' | 'permission' | 'data';

  /** Resource identifier/name */
  identifier: string;

  /** Why this resource is needed */
  reason: string;

  /** Is this required or optional */
  required: boolean;
}

/**
 * Suggestion for resolving block
 */
export interface BlockingSuggestion {
  /** Suggestion type */
  type: 'create_tool' | 'create_skill' | 'request_permission' | 'provide_data' | 'manual_action';

  /** What to create/request */
  target: string;

  /** Description of what's needed */
  description: string;

  /** Can OCAAS auto-generate this */
  canAutoGenerate: boolean;

  /** Priority */
  priority: 'required' | 'recommended' | 'optional';

  /** Generation prompt (if can auto-generate) */
  generationPrompt?: string;
}

/**
 * Execution metrics
 */
export interface JobMetrics {
  /** Total execution time (ms) */
  executionTimeMs: number;

  /** Time waiting for resources (ms) */
  waitTimeMs?: number;

  /** Token usage */
  tokens?: {
    input: number;
    output: number;
    total: number;
  };

  /** Tool calls made */
  toolCalls?: number;

  /** Retries attempted */
  retries?: number;
}

// ============================================================================
// JOB LIFECYCLE
// ============================================================================

/**
 * Structured step log for job execution
 * Compact format to minimize tokens
 */
export interface JobStepLog {
  /** Step index (1-based) */
  n: number;
  /** Action: t=think, x=tool, d=delegate, w=wait, ok=done, err=error */
  a: 't' | 'x' | 'd' | 'w' | 'ok' | 'err';
  /** Tool name (if a=x) */
  tool?: string;
  /** Brief result (max 100 chars) */
  r?: string;
  /** Duration ms */
  ms?: number;
}

/**
 * Job state machine events
 */
export type JobEvent =
  | { type: 'SUBMIT'; payload: JobPayload }
  | { type: 'START'; sessionId: string }
  | { type: 'PROGRESS'; progress: number; message?: string }
  | { type: 'STEP'; step: JobStepLog }
  | { type: 'TOOL_CALL'; toolName: string; input: Record<string, unknown> }
  | { type: 'TOOL_RESULT'; toolName: string; output: Record<string, unknown> }
  | { type: 'BLOCKED'; blocked: JobBlocked }
  | { type: 'COMPLETE'; result: JobResult }
  | { type: 'FAIL'; error: JobError }
  | { type: 'CANCEL' }
  | { type: 'TIMEOUT' }
  | { type: 'RETRY'; attempt: number; reason: string }
  | { type: 'DELEGATE'; toAgentId: string; reason: string };

/**
 * Stored job record
 */
export interface JobRecord {
  /** Job ID */
  id: string;

  /** Original payload */
  payload: JobPayload;

  /** Current status */
  status: JobStatus;

  /** OpenClaw session ID */
  sessionId?: string;

  /** Response (when finished) */
  response?: JobResponse;

  /** Event history */
  events: Array<{
    timestamp: number;
    event: JobEvent;
  }>;

  /** Created timestamp */
  createdAt: number;

  /** Updated timestamp */
  updatedAt: number;
}

// ============================================================================
// GLOBAL EXECUTION LIMITS
// ============================================================================

/**
 * Global execution limits per task.
 * These limits prevent runaway executions.
 */
export interface TaskExecutionLimits {
  /** Maximum tool executions per task (default: 100) */
  maxToolExecutionsPerTask: number;

  /** Maximum total execution time in ms (default: 600000 = 10 min) */
  maxTotalExecutionMsPerTask: number;

  /** Maximum concurrent tool executions (default: 5) */
  maxConcurrentTools: number;

  /** Maximum tool execution retries per task (default: 10) */
  maxRetriesPerTask: number;
}

/**
 * Default execution limits - conservative
 */
export const DEFAULT_EXECUTION_LIMITS: TaskExecutionLimits = {
  maxToolExecutionsPerTask: 100,
  maxTotalExecutionMsPerTask: 600000, // 10 minutes
  maxConcurrentTools: 5,
  maxRetriesPerTask: 10,
};

/**
 * Current execution state for a task
 */
export interface TaskExecutionState {
  /** Task ID */
  taskId: string;

  /** Total tool executions so far */
  toolExecutionCount: number;

  /** Total execution time in ms */
  totalExecutionMs: number;

  /** Currently running tool executions */
  currentConcurrent: number;

  /** Total retries so far */
  retryCount: number;

  /** First execution timestamp */
  firstExecutionAt?: number;

  /** Last execution timestamp */
  lastExecutionAt?: number;
}

/**
 * Execution limit check result
 */
export interface ExecutionLimitCheckResult {
  /** Can execution proceed? */
  allowed: boolean;

  /** Limit that was exceeded (if blocked) */
  limitExceeded?: 'max_executions' | 'max_time' | 'max_concurrent' | 'max_retries';

  /** Current value vs limit */
  current?: number;
  limit?: number;

  /** Message */
  message?: string;
}

// ============================================================================
// AUDIT LOG
// ============================================================================

/**
 * Audit log entry for tool execution.
 * Immutable record for compliance and debugging.
 */
export interface ToolExecutionAuditEntry {
  /** Unique audit entry ID */
  id: string;

  /** Execution ID from ToolExecutionService */
  executionId: string;

  /** Timestamp when audit entry was created */
  timestamp: number;

  /** Tool name */
  toolName: string;

  /** Tool type (api, script, binary, run_command) */
  toolType: 'api' | 'script' | 'binary' | 'run_command' | 'unknown';

  /** Task ID */
  taskId: string;

  /** Job ID (if applicable) */
  jobId?: string;

  /** Agent ID */
  agentId: string;

  /** Was execution successful? */
  success: boolean;

  /** Duration in ms */
  durationMs: number;

  /** Input summary (truncated for audit) */
  inputSummary?: string;

  /** Output summary (truncated for audit) */
  outputSummary?: string;

  /** Error code (if failed) */
  errorCode?: string;

  /** Error message (if failed) */
  errorMessage?: string;

  /** Security check passed? */
  securityPassed?: boolean;

  /** Security failure code */
  securityFailureCode?: string;

  /** Input validation passed? */
  inputValidationPassed?: boolean;

  /** Input validation errors */
  inputValidationErrors?: string[];

  /** Was blocked by execution limits? */
  blockedByLimits?: boolean;

  /** Limit that was exceeded */
  limitExceeded?: string;
}

// ============================================================================
// DISPATCHER TYPES
// ============================================================================

/**
 * Options for job dispatch
 */
export interface DispatchOptions {
  /** Wait for completion (sync) vs fire-and-forget (async) */
  waitForCompletion?: boolean;

  /** Timeout for waiting (if waitForCompletion) */
  waitTimeoutMs?: number;

  /** Callback for progress updates */
  onProgress?: (progress: number, message?: string) => void;

  /** Callback for tool calls */
  onToolCall?: (toolName: string, input: Record<string, unknown>) => void;

  /** Use existing session (if available) */
  reuseSession?: boolean;
}

/**
 * Dispatch result
 */
export interface DispatchResult {
  /** Job ID */
  jobId: string;

  /** Whether dispatch was successful */
  dispatched: boolean;

  /** OpenClaw session ID */
  sessionId?: string;

  /** Response (if waited for completion) */
  response?: JobResponse;

  /** Error (if dispatch failed) */
  error?: JobError;
}

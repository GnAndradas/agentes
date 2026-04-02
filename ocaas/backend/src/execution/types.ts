/**
 * Job Execution Types
 *
 * Contract for OCAAS → OpenClaw job execution.
 * Defines the standard payload, responses, and blocking scenarios.
 */

import type { RoleType } from '../organization/types.js';

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

/**
 * Resources the agent is allowed to use
 */
export interface JobAllowedResources {
  /** Allowed tool IDs */
  tools: string[];

  /** Allowed skill IDs */
  skills: string[];

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
  | 'completed'    // Finished successfully
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

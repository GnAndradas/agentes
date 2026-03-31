/**
 * Resilience Layer Types
 *
 * Task checkpoints, execution leases, error taxonomy, recovery states
 */

// =============================================================================
// TASK CHECKPOINT
// =============================================================================

export type TaskStage =
  | 'queued'
  | 'analyzing'
  | 'assigning'
  | 'spawning_session'
  | 'executing'
  | 'awaiting_response'
  | 'processing_result'
  | 'completing'
  | 'paused'
  | 'waiting_external'
  | 'waiting_approval'
  | 'waiting_resource'
  | 'retrying'
  | 'failed'
  | 'completed';

export interface TaskCheckpoint {
  /** Task ID */
  taskId: string;
  /** Unique execution ID (for tracking retries) */
  executionId: string;
  /** Assigned agent ID */
  assignedAgentId: string | null;
  /** Current execution stage */
  currentStage: TaskStage;
  /** Last completed step/milestone */
  lastCompletedStep: string | null;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Snapshot of task status at checkpoint */
  statusSnapshot: Record<string, unknown>;
  /** Last known blocker (if any) */
  lastKnownBlocker: string | null;
  /** Pending approval ID (if any) */
  pendingApproval: string | null;
  /** Pending resource IDs (if any) */
  pendingResources: string[];
  /** Last OpenClaw session ID used */
  lastOpenClawSessionId: string | null;
  /** Partial result data */
  partialResult: Record<string, unknown> | null;
  /** Number of retries so far */
  retryCount: number;
  /** Can this execution be resumed? */
  resumable: boolean;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

// =============================================================================
// EXECUTION LEASE
// =============================================================================

export interface ExecutionLease {
  /** Task ID */
  taskId: string;
  /** Execution ID holding the lease */
  executionId: string;
  /** Instance ID (for multi-instance deployments) */
  instanceId: string;
  /** Lease acquired at */
  acquiredAt: number;
  /** Lease expires at */
  expiresAt: number;
  /** Last renewal */
  lastRenewalAt: number;
  /** Is active */
  active: boolean;
}

export const DEFAULT_LEASE_DURATION_MS = 60_000; // 1 minute
export const DEFAULT_LEASE_RENEWAL_INTERVAL_MS = 20_000; // 20 seconds

// =============================================================================
// ERROR TAXONOMY
// =============================================================================

export type OperationalErrorType =
  | 'gateway_unavailable'
  | 'connection_lost'
  | 'timeout'
  | 'token_exhausted'
  | 'context_overflow'
  | 'rate_limit'
  | 'process_crashed'
  | 'orphan_execution'
  | 'lease_expired'
  | 'lease_conflict'
  | 'checkpoint_corrupted'
  | 'recovery_failed'
  | 'unknown_runtime_error';

export interface OperationalError {
  /** Error type from taxonomy */
  type: OperationalErrorType;
  /** Human-readable message */
  message: string;
  /** Original error message (if any) */
  originalMessage?: string;
  /** Is this error recoverable? */
  recoverable: boolean;
  /** Suggested action */
  suggestedAction: 'retry' | 'pause' | 'escalate' | 'abort' | 'wait';
  /** Retry delay if applicable (ms) */
  retryDelayMs?: number;
  /** Additional context */
  context?: Record<string, unknown>;
}

// =============================================================================
// RECOVERY STATES
// =============================================================================

export type RecoveryAction =
  | 'resume'
  | 'retry'
  | 'reassign'
  | 'escalate'
  | 'pause'
  | 'fail'
  | 'skip'
  | 'ready_for_assignment'
  | 'restarted'
  | 'checkpointed'
  | 'retry_continued'
  | 'ready_for_resume'
  | 'waiting'
  | 'no_action_needed'
  | 'marked_paused'
  | 'marked_failed'
  | 'reconciliation_failed';

export type RecoveryStrategy =
  | 'retry_with_backoff'
  | 'restart_from_checkpoint'
  | 'checkpoint_and_resume'
  | 'escalate_to_human'
  | 'wait_for_resolution';

export interface RecoveryDecision {
  /** Task ID */
  taskId: string;
  /** Execution ID */
  executionId: string;
  /** Action to take */
  action: RecoveryAction;
  /** Reason for decision */
  reason: string;
  /** New assigned agent (if reassigning) */
  newAgentId?: string;
  /** Delay before action (ms) */
  delayMs?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface RecoveryReport {
  /** Recovery started at */
  startedAt: number;
  /** Recovery completed at */
  completedAt: number;
  /** Total tasks checked */
  tasksChecked: number;
  /** Tasks recovered */
  tasksRecovered: number;
  /** Tasks marked orphan */
  tasksMarkedOrphan: number;
  /** Tasks failed */
  tasksFailed: number;
  /** Leases cleaned */
  leasesCleaned: number;
  /** Checkpoints reconciled */
  checkpointsReconciled: number;
  /** Errors encountered */
  errors: string[];
}

// =============================================================================
// CIRCUIT BREAKER
// =============================================================================

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening */
  failureThreshold: number;
  /** Number of successes in half-open to close */
  successThreshold: number;
  /** Time to stay open before half-open (ms) */
  openDurationMs: number;
  /** Max attempts in half-open state */
  halfOpenMaxAttempts: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 60_000,
  halfOpenMaxAttempts: 3,
};

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number;
  lastStateChangeAt: number;
  openedAt: number;
  halfOpenAttempts: number;
  config: CircuitBreakerConfig;
}

export interface CircuitBreakerState {
  /** Current state */
  state: CircuitState;
  /** Failure count */
  failureCount: number;
  /** Success count (for half-open) */
  successCount: number;
  /** Last failure timestamp */
  lastFailureAt: number | null;
  /** Last state change timestamp */
  lastStateChangeAt: number;
  /** Next attempt allowed at (if open) */
  nextAttemptAt: number | null;
}

// =============================================================================
// PAUSE/RESUME
// =============================================================================

export interface PauseContext {
  /** Task ID */
  taskId: string;
  /** Pause reason */
  reason: string;
  /** Paused by (user, system, policy) */
  pausedBy: 'user' | 'system' | 'policy';
  /** Checkpoint at pause */
  checkpoint: TaskCheckpoint;
  /** Can be auto-resumed */
  autoResumable: boolean;
  /** Auto-resume condition (if any) */
  autoResumeCondition?: string;
  /** Paused at */
  pausedAt: number;
}

export interface ResumeContext {
  /** Task ID */
  taskId: string;
  /** Resume reason */
  reason: string;
  /** Resumed by */
  resumedBy: 'user' | 'system' | 'policy' | 'auto';
  /** Checkpoint to resume from */
  checkpoint: TaskCheckpoint;
  /** Resumed at */
  resumedAt: number;
}

// =============================================================================
// HEALTH STATUS
// =============================================================================

export interface SystemHealthStatus {
  /** OCAAS backend healthy */
  ocaas: boolean;
  /** OpenClaw gateway reachable */
  openclaw: boolean;
  /** Database accessible */
  database: boolean;
  /** Circuit breaker state */
  circuitState: CircuitState;
  /** Active leases count */
  activeLeases: number;
  /** Queued tasks count */
  queuedTasks: number;
  /** Running tasks count */
  runningTasks: number;
  /** Paused tasks count */
  pausedTasks: number;
  /** Last check timestamp */
  lastCheckAt: number;
}

// =============================================================================
// HEALTH CHECKER TYPES
// =============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ComponentHealth {
  componentId: string;
  status: HealthStatus;
  lastCheckAt: number;
  consecutiveFailures: number;
  lastError: string | null;
}

// =============================================================================
// RECOVERY RESULT
// =============================================================================

export interface RecoveryResult {
  success: boolean;
  message: string;
  recovered: Array<{
    taskId: string;
    action: RecoveryAction;
    newStage?: TaskStage;
  }>;
  failed: Array<{
    taskId: string;
    error: string;
  }>;
  skipped: Array<{
    taskId: string;
    reason: string;
  }>;
}

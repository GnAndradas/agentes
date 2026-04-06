/**
 * Task State Manager Types
 *
 * Defines structured execution state for tasks,
 * separate from conversational memory (OpenClaw sessions).
 *
 * Purpose: Track business progress, steps, checkpoints,
 * and enable pause/resume without depending on LLM memory.
 */

// ============================================================================
// STEP TYPES
// ============================================================================

/**
 * Status of a single step
 */
export type StepStatus =
  | 'pending'    // Not started
  | 'running'    // Currently executing
  | 'completed'  // Finished successfully
  | 'failed'     // Failed with error
  | 'skipped'    // Intentionally skipped
  | 'blocked';   // Blocked on dependency

/**
 * A single step in task execution
 */
export interface TaskStep {
  /** Unique step ID within task */
  id: string;

  /** Step name/label */
  name: string;

  /** Step description */
  description?: string;

  /** Current status */
  status: StepStatus;

  /** Order in sequence (1-based) */
  order: number;

  /** Step started timestamp */
  startedAt?: number;

  /** Step completed timestamp */
  completedAt?: number;

  /** Output/result of this step */
  output?: Record<string, unknown>;

  /** Error if failed */
  error?: string;

  /** Job ID that executed this step */
  jobId?: string;

  /** Depends on step IDs */
  dependsOn?: string[];

  /** Retry count for this step */
  retryCount?: number;
}

// ============================================================================
// CHECKPOINT TYPES
// ============================================================================

/**
 * A checkpoint captures a restorable state
 */
export interface TaskCheckpoint {
  /** Unique checkpoint ID */
  id: string;

  /** Human-readable label */
  label: string;

  /** When checkpoint was created */
  createdAt: number;

  /** Current step at checkpoint time */
  currentStepId: string;

  /** Completed step IDs at checkpoint time */
  completedStepIds: string[];

  /** State snapshot (serializable) */
  stateSnapshot?: Record<string, unknown>;

  /** Auto-created vs manual */
  auto: boolean;

  /** Reason for checkpoint */
  reason?: string;
}

// ============================================================================
// TASK EXECUTION STATE
// ============================================================================

/**
 * Execution phase (high-level)
 */
export type ExecutionPhase =
  | 'initializing'   // State being set up
  | 'planning'       // Steps being defined
  | 'executing'      // Running steps
  | 'paused'         // Manually paused
  | 'blocked'        // Blocked on resource/approval
  | 'completing'     // Finalizing
  | 'completed'      // All done
  | 'failed'         // Terminal failure
  | 'cancelled';     // User cancelled

/**
 * Tool execution record within task state
 */
export interface ToolExecutionRecord {
  /** Execution ID */
  executionId: string;
  /** Tool name */
  toolName: string;
  /** Success flag */
  success: boolean;
  /** Duration in ms */
  durationMs: number;
  /** Executed at timestamp */
  executedAt: number;
  /** Output summary (truncated) */
  outputSummary?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Full execution state for a task
 */
export interface TaskExecutionState {
  /** Task ID */
  taskId: string;

  /** Current execution phase */
  phase: ExecutionPhase;

  /** All steps (ordered) */
  steps: TaskStep[];

  /** Current step ID */
  currentStepId?: string;

  /** Checkpoints (ordered by creation) */
  checkpoints: TaskCheckpoint[];

  /** Resume from checkpoint ID (if resuming) */
  resumeFromCheckpointId?: string;

  /** Why task is paused (if paused) */
  pausedReason?: string;

  /** Last meaningful progress update */
  lastMeaningfulUpdateAt: number;

  /** OpenClaw session key (for hooks_session) */
  sessionKey?: string;

  /** Total progress percentage (0-100) */
  progressPct: number;

  /** State consistency warnings */
  warnings: string[];

  /** State version (for optimistic locking) */
  version: number;

  /** Created timestamp */
  createdAt: number;

  /** Updated timestamp */
  updatedAt: number;

  // ===========================================================================
  // TOOL EXECUTION TRACKING
  // ===========================================================================

  /** Total tool calls executed */
  toolCallsCount: number;

  /** Last tool used */
  lastToolUsed?: string;

  /** Recent tool executions (last 10) */
  toolExecutions: ToolExecutionRecord[];
}

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Valid phase transitions
 */
export const VALID_PHASE_TRANSITIONS: Record<ExecutionPhase, ExecutionPhase[]> = {
  initializing: ['planning', 'executing', 'failed', 'cancelled'],
  planning: ['executing', 'paused', 'failed', 'cancelled'],
  executing: ['paused', 'blocked', 'completing', 'failed', 'cancelled'],
  paused: ['executing', 'cancelled'],
  blocked: ['executing', 'paused', 'failed', 'cancelled'],
  completing: ['completed', 'failed'],
  completed: [], // Terminal
  failed: [], // Terminal
  cancelled: [], // Terminal
};

/**
 * Check if a phase transition is valid
 */
export function isValidPhaseTransition(from: ExecutionPhase, to: ExecutionPhase): boolean {
  return VALID_PHASE_TRANSITIONS[from].includes(to);
}

// ============================================================================
// COMMANDS / EVENTS
// ============================================================================

/**
 * Commands that can be issued to TaskStateManager
 */
export type TaskStateCommand =
  | { type: 'INIT'; taskId: string; steps?: TaskStep[] }
  | { type: 'START_STEP'; stepId: string; jobId?: string }
  | { type: 'COMPLETE_STEP'; stepId: string; output?: Record<string, unknown> }
  | { type: 'FAIL_STEP'; stepId: string; error: string }
  | { type: 'SKIP_STEP'; stepId: string; reason: string }
  | { type: 'CREATE_CHECKPOINT'; label: string; auto?: boolean; reason?: string }
  | { type: 'PAUSE'; reason: string }
  | { type: 'RESUME'; fromCheckpointId?: string }
  | { type: 'BLOCK'; reason: string }
  | { type: 'UNBLOCK' }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string }
  | { type: 'CANCEL' }
  | { type: 'SET_SESSION_KEY'; sessionKey: string };

/**
 * Events emitted by TaskStateManager
 */
export type TaskStateEvent =
  | { type: 'STATE_INITIALIZED'; taskId: string; state: TaskExecutionState }
  | { type: 'STEP_STARTED'; taskId: string; stepId: string }
  | { type: 'STEP_COMPLETED'; taskId: string; stepId: string; output?: Record<string, unknown> }
  | { type: 'STEP_FAILED'; taskId: string; stepId: string; error: string }
  | { type: 'CHECKPOINT_CREATED'; taskId: string; checkpoint: TaskCheckpoint }
  | { type: 'TASK_PAUSED'; taskId: string; reason: string }
  | { type: 'TASK_RESUMED'; taskId: string; fromCheckpointId?: string }
  | { type: 'TASK_BLOCKED'; taskId: string; reason: string }
  | { type: 'TASK_COMPLETED'; taskId: string }
  | { type: 'TASK_FAILED'; taskId: string; error: string }
  | { type: 'PHASE_CHANGED'; taskId: string; from: ExecutionPhase; to: ExecutionPhase };

// ============================================================================
// SNAPSHOT / SUMMARY
// ============================================================================

/**
 * Lightweight snapshot for diagnostics/API
 */
export interface TaskStateSnapshot {
  taskId: string;
  phase: ExecutionPhase;
  currentStepId?: string;
  currentStepName?: string;
  completedStepsCount: number;
  totalStepsCount: number;
  pendingStepsCount: number;
  failedStepsCount: number;
  checkpointsCount: number;
  progressPct: number;
  pausedReason?: string;
  resumeFromCheckpointId?: string;
  lastMeaningfulUpdateAt: number;
  warnings: string[];
  /** Total tool calls count */
  toolCallsCount: number;
  /** Last tool used */
  lastToolUsed?: string;
}

/**
 * Convert full state to snapshot
 */
export function toSnapshot(state: TaskExecutionState): TaskStateSnapshot {
  const currentStep = state.steps.find(s => s.id === state.currentStepId);

  return {
    taskId: state.taskId,
    phase: state.phase,
    currentStepId: state.currentStepId,
    currentStepName: currentStep?.name,
    completedStepsCount: state.steps.filter(s => s.status === 'completed').length,
    totalStepsCount: state.steps.length,
    pendingStepsCount: state.steps.filter(s => s.status === 'pending').length,
    failedStepsCount: state.steps.filter(s => s.status === 'failed').length,
    checkpointsCount: state.checkpoints.length,
    progressPct: state.progressPct,
    pausedReason: state.pausedReason,
    resumeFromCheckpointId: state.resumeFromCheckpointId,
    lastMeaningfulUpdateAt: state.lastMeaningfulUpdateAt,
    warnings: state.warnings,
    toolCallsCount: state.toolCallsCount || 0,
    lastToolUsed: state.lastToolUsed,
  };
}

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Serialized state for DB storage
 */
export interface TaskStateRow {
  taskId: string;
  state: string; // JSON serialized TaskExecutionState
  version: number;
  createdAt: number;
  updatedAt: number;
}

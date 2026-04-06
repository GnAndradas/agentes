/**
 * TaskStateManager
 *
 * Central service for managing structured execution state of tasks.
 * Provides checkpoint, pause, resume, and step tracking.
 *
 * Separates business progress from conversational memory (OpenClaw sessions).
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger.js';
import { db, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import {
  TaskExecutionState,
  TaskStep,
  TaskCheckpoint,
  ExecutionPhase,
  StepStatus,
  TaskStateSnapshot,
  TaskStateCommand,
  TaskStateEvent,
  ToolExecutionRecord,
  isValidPhaseTransition,
  toSnapshot,
} from './types.js';

const logger = createLogger('TaskStateManager');

// ============================================================================
// TASK STATE MANAGER
// ============================================================================

export class TaskStateManager {
  /** In-memory cache of active states */
  private cache: Map<string, TaskExecutionState> = new Map();

  /** Event listeners */
  private listeners: Array<(event: TaskStateEvent) => void> = [];

  constructor() {
    logger.info('TaskStateManager initialized');
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize state for a task
   */
  async initState(taskId: string, steps?: TaskStep[]): Promise<TaskExecutionState> {
    // Check if already exists
    let existing = await this.loadState(taskId);
    if (existing) {
      logger.debug({ taskId }, 'State already exists, returning existing');
      return existing;
    }

    const now = Date.now();
    const state: TaskExecutionState = {
      taskId,
      phase: steps && steps.length > 0 ? 'planning' : 'initializing',
      steps: steps || [],
      currentStepId: steps?.[0]?.id,
      checkpoints: [],
      lastMeaningfulUpdateAt: now,
      progressPct: 0,
      warnings: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      // Tool execution tracking
      toolCallsCount: 0,
      toolExecutions: [],
    };

    await this.saveState(state);
    this.cache.set(taskId, state);

    this.emit({ type: 'STATE_INITIALIZED', taskId, state });
    logger.info({ taskId, stepsCount: state.steps.length }, 'Task state initialized');

    return state;
  }

  // ==========================================================================
  // STATE ACCESS
  // ==========================================================================

  /**
   * Get current state for a task
   */
  async getState(taskId: string): Promise<TaskExecutionState | null> {
    // Check cache first
    const cached = this.cache.get(taskId);
    if (cached) return cached;

    // Load from DB
    return this.loadState(taskId);
  }

  /**
   * Get snapshot for diagnostics/API
   */
  async getSnapshot(taskId: string): Promise<TaskStateSnapshot | null> {
    const state = await this.getState(taskId);
    if (!state) return null;
    return toSnapshot(state);
  }

  // ==========================================================================
  // STEP MANAGEMENT
  // ==========================================================================

  /**
   * Add steps to a task (if not already planned)
   */
  async addSteps(taskId: string, steps: TaskStep[]): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    // Add new steps
    const existingIds = new Set(state.steps.map(s => s.id));
    const newSteps = steps.filter(s => !existingIds.has(s.id));

    state.steps.push(...newSteps);

    // Set current step if not set
    if (!state.currentStepId && state.steps.length > 0) {
      state.currentStepId = state.steps[0]!.id;
    }

    // Update phase if needed
    if (state.phase === 'initializing' && state.steps.length > 0) {
      state.phase = 'planning';
    }

    await this.updateState(state, 'Steps added');
    return state;
  }

  /**
   * Start a step
   */
  async startStep(taskId: string, stepId: string, jobId?: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    const step = this.findStep(state, stepId);

    if (!step) {
      state.warnings.push(`Step ${stepId} not found`);
      await this.updateState(state, 'Warning: step not found');
      return state;
    }

    step.status = 'running';
    step.startedAt = Date.now();
    step.jobId = jobId;
    state.currentStepId = stepId;

    // Transition to executing if needed
    if (state.phase === 'planning' || state.phase === 'paused' || state.phase === 'blocked') {
      await this.transitionPhase(state, 'executing');
    }

    await this.updateState(state, `Step ${step.name} started`);
    this.emit({ type: 'STEP_STARTED', taskId, stepId });

    return state;
  }

  /**
   * Complete a step
   */
  async completeStep(
    taskId: string,
    stepId: string,
    output?: Record<string, unknown>
  ): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    const step = this.findStep(state, stepId);

    if (!step) {
      state.warnings.push(`Step ${stepId} not found`);
      await this.updateState(state, 'Warning: step not found');
      return state;
    }

    step.status = 'completed';
    step.completedAt = Date.now();
    step.output = output;

    // Update progress
    this.recalculateProgress(state);

    // Move to next step
    this.advanceToNextStep(state);

    // Auto-checkpoint after step completion
    await this.createCheckpoint(taskId, `After ${step.name}`, true, 'Step completed');

    await this.updateState(state, `Step ${step.name} completed`);
    this.emit({ type: 'STEP_COMPLETED', taskId, stepId, output });

    return state;
  }

  /**
   * Fail a step
   */
  async failStep(taskId: string, stepId: string, error: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    const step = this.findStep(state, stepId);

    if (!step) {
      state.warnings.push(`Step ${stepId} not found`);
      await this.updateState(state, 'Warning: step not found');
      return state;
    }

    step.status = 'failed';
    step.completedAt = Date.now();
    step.error = error;
    step.retryCount = (step.retryCount || 0) + 1;

    this.recalculateProgress(state);

    await this.updateState(state, `Step ${step.name} failed: ${error}`);
    this.emit({ type: 'STEP_FAILED', taskId, stepId, error });

    return state;
  }

  /**
   * Skip a step
   */
  async skipStep(taskId: string, stepId: string, reason: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    const step = this.findStep(state, stepId);

    if (!step) {
      state.warnings.push(`Step ${stepId} not found`);
      await this.updateState(state, 'Warning: step not found');
      return state;
    }

    step.status = 'skipped';
    step.completedAt = Date.now();
    step.error = reason;

    this.recalculateProgress(state);
    this.advanceToNextStep(state);

    await this.updateState(state, `Step ${step.name} skipped: ${reason}`);
    return state;
  }

  // ==========================================================================
  // CHECKPOINTS
  // ==========================================================================

  /**
   * Create a checkpoint
   */
  async createCheckpoint(
    taskId: string,
    label: string,
    auto: boolean = false,
    reason?: string
  ): Promise<TaskCheckpoint> {
    const state = await this.getOrInitState(taskId);

    const checkpoint: TaskCheckpoint = {
      id: `ckpt_${nanoid(8)}`,
      label,
      createdAt: Date.now(),
      currentStepId: state.currentStepId || '',
      completedStepIds: state.steps.filter(s => s.status === 'completed').map(s => s.id),
      stateSnapshot: this.createStateSnapshot(state),
      auto,
      reason,
    };

    state.checkpoints.push(checkpoint);

    // Keep only last 10 checkpoints
    if (state.checkpoints.length > 10) {
      state.checkpoints = state.checkpoints.slice(-10);
    }

    await this.updateState(state, `Checkpoint: ${label}`);
    this.emit({ type: 'CHECKPOINT_CREATED', taskId, checkpoint });

    logger.debug({ taskId, checkpointId: checkpoint.id, label }, 'Checkpoint created');
    return checkpoint;
  }

  /**
   * Get all checkpoints for a task
   */
  async getCheckpoints(taskId: string): Promise<TaskCheckpoint[]> {
    const state = await this.getState(taskId);
    return state?.checkpoints || [];
  }

  // ==========================================================================
  // PAUSE / RESUME
  // ==========================================================================

  /**
   * Pause task execution
   */
  async pause(taskId: string, reason: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    if (state.phase === 'completed' || state.phase === 'failed' || state.phase === 'cancelled') {
      state.warnings.push(`Cannot pause task in ${state.phase} phase`);
      await this.updateState(state, 'Warning: cannot pause');
      return state;
    }

    // Create checkpoint before pausing
    await this.createCheckpoint(taskId, 'Before pause', true, reason);

    state.pausedReason = reason;
    await this.transitionPhase(state, 'paused');

    await this.updateState(state, `Paused: ${reason}`);
    this.emit({ type: 'TASK_PAUSED', taskId, reason });

    logger.info({ taskId, reason }, 'Task paused');
    return state;
  }

  /**
   * Resume task execution
   */
  async resume(taskId: string, fromCheckpointId?: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    if (state.phase !== 'paused' && state.phase !== 'blocked') {
      state.warnings.push(`Cannot resume task in ${state.phase} phase`);
      await this.updateState(state, 'Warning: cannot resume');
      return state;
    }

    // If resuming from checkpoint, restore state
    if (fromCheckpointId) {
      const checkpoint = state.checkpoints.find(c => c.id === fromCheckpointId);
      if (checkpoint) {
        state.resumeFromCheckpointId = fromCheckpointId;
        state.currentStepId = checkpoint.currentStepId;

        // Mark steps after checkpoint as pending
        const completedSet = new Set(checkpoint.completedStepIds);
        for (const step of state.steps) {
          if (!completedSet.has(step.id) && step.status !== 'pending') {
            step.status = 'pending';
            step.startedAt = undefined;
            step.completedAt = undefined;
            step.output = undefined;
            step.error = undefined;
          }
        }

        logger.info({ taskId, checkpointId: fromCheckpointId }, 'Restored from checkpoint');
      } else {
        state.warnings.push(`Checkpoint ${fromCheckpointId} not found`);
      }
    }

    state.pausedReason = undefined;
    await this.transitionPhase(state, 'executing');

    await this.updateState(state, `Resumed${fromCheckpointId ? ` from checkpoint ${fromCheckpointId}` : ''}`);
    this.emit({ type: 'TASK_RESUMED', taskId, fromCheckpointId });

    logger.info({ taskId, fromCheckpointId }, 'Task resumed');
    return state;
  }

  // ==========================================================================
  // BLOCKING
  // ==========================================================================

  /**
   * Mark task as blocked
   */
  async block(taskId: string, reason: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    state.pausedReason = reason;
    await this.transitionPhase(state, 'blocked');

    await this.updateState(state, `Blocked: ${reason}`);
    this.emit({ type: 'TASK_BLOCKED', taskId, reason });

    return state;
  }

  /**
   * Unblock task
   */
  async unblock(taskId: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    if (state.phase !== 'blocked') {
      return state;
    }

    state.pausedReason = undefined;
    await this.transitionPhase(state, 'executing');

    await this.updateState(state, 'Unblocked');
    return state;
  }

  // ==========================================================================
  // COMPLETION
  // ==========================================================================

  /**
   * Mark task as completing
   */
  async startCompletion(taskId: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    await this.transitionPhase(state, 'completing');
    await this.updateState(state, 'Starting completion');
    return state;
  }

  /**
   * Mark task as completed
   */
  async complete(taskId: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    state.progressPct = 100;
    await this.transitionPhase(state, 'completed');

    await this.updateState(state, 'Completed');
    this.emit({ type: 'TASK_COMPLETED', taskId });

    // Clear from cache after completion
    this.cache.delete(taskId);

    logger.info({ taskId }, 'Task completed');
    return state;
  }

  /**
   * Mark task as failed
   */
  async fail(taskId: string, error: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    // Create checkpoint before failing
    await this.createCheckpoint(taskId, 'Before failure', true, error);

    await this.transitionPhase(state, 'failed');

    await this.updateState(state, `Failed: ${error}`);
    this.emit({ type: 'TASK_FAILED', taskId, error });

    logger.error({ taskId, error }, 'Task failed');
    return state;
  }

  /**
   * Cancel task
   */
  async cancel(taskId: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    if (state.phase === 'completed' || state.phase === 'failed') {
      return state;
    }

    await this.transitionPhase(state, 'cancelled');
    await this.updateState(state, 'Cancelled');

    this.cache.delete(taskId);
    return state;
  }

  // ==========================================================================
  // SESSION KEY
  // ==========================================================================

  /**
   * Set OpenClaw session key
   */
  async setSessionKey(taskId: string, sessionKey: string): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);
    state.sessionKey = sessionKey;
    await this.updateState(state, 'Session key set');
    return state;
  }

  // ==========================================================================
  // TOOL EXECUTION TRACKING
  // ==========================================================================

  /**
   * Record a tool execution in the task state
   */
  async recordToolExecution(
    taskId: string,
    record: ToolExecutionRecord
  ): Promise<TaskExecutionState> {
    const state = await this.getOrInitState(taskId);

    // Increment tool calls count
    state.toolCallsCount = (state.toolCallsCount || 0) + 1;

    // Update last tool used
    state.lastToolUsed = record.toolName;

    // Add to tool executions (keep last 10)
    if (!state.toolExecutions) {
      state.toolExecutions = [];
    }
    state.toolExecutions.push(record);
    if (state.toolExecutions.length > 10) {
      state.toolExecutions = state.toolExecutions.slice(-10);
    }

    await this.updateState(state, `Tool executed: ${record.toolName}`);

    logger.debug({
      taskId,
      toolName: record.toolName,
      success: record.success,
      durationMs: record.durationMs,
    }, 'Tool execution recorded in state');

    return state;
  }

  /**
   * Get tool execution summary for a task
   */
  async getToolExecutionSummary(taskId: string): Promise<{
    totalCalls: number;
    lastToolUsed?: string;
    successCount: number;
    failureCount: number;
    recentExecutions: ToolExecutionRecord[];
  } | null> {
    const state = await this.getState(taskId);
    if (!state) return null;

    const executions = state.toolExecutions || [];
    const successCount = executions.filter(e => e.success).length;
    const failureCount = executions.filter(e => !e.success).length;

    return {
      totalCalls: state.toolCallsCount || 0,
      lastToolUsed: state.lastToolUsed,
      successCount,
      failureCount,
      recentExecutions: executions,
    };
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  /**
   * Subscribe to state events
   */
  subscribe(listener: (event: TaskStateEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to listeners
   */
  private emit(event: TaskStateEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err, event }, 'Event listener error');
      }
    }
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  /**
   * Load state from DB
   */
  private async loadState(taskId: string): Promise<TaskExecutionState | null> {
    try {
      const rows = await db
        .select()
        .from(schema.taskStates)
        .where(eq(schema.taskStates.taskId, taskId))
        .limit(1);

      if (rows.length === 0) return null;

      const row = rows[0]!;
      const state = JSON.parse(row.state) as TaskExecutionState;

      // Update cache
      this.cache.set(taskId, state);

      return state;
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to load state');
      return null;
    }
  }

  /**
   * Save state to DB
   */
  private async saveState(state: TaskExecutionState): Promise<void> {
    try {
      const stateJson = JSON.stringify(state);

      await db
        .insert(schema.taskStates)
        .values({
          taskId: state.taskId,
          state: stateJson,
          version: state.version,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        })
        .onConflictDoUpdate({
          target: schema.taskStates.taskId,
          set: {
            state: stateJson,
            version: state.version,
            updatedAt: state.updatedAt,
          },
        });

      this.cache.set(state.taskId, state);
    } catch (err) {
      logger.error({ err, taskId: state.taskId }, 'Failed to save state');
      throw err;
    }
  }

  /**
   * Update state with reason logging
   */
  private async updateState(state: TaskExecutionState, reason: string): Promise<void> {
    state.updatedAt = Date.now();
    state.lastMeaningfulUpdateAt = Date.now();
    state.version++;

    await this.saveState(state);

    logger.debug({ taskId: state.taskId, reason, version: state.version }, 'State updated');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Get or initialize state
   */
  private async getOrInitState(taskId: string): Promise<TaskExecutionState> {
    const state = await this.getState(taskId);
    if (state) return state;
    return this.initState(taskId);
  }

  /**
   * Find step by ID
   */
  private findStep(state: TaskExecutionState, stepId: string): TaskStep | undefined {
    return state.steps.find(s => s.id === stepId);
  }

  /**
   * Transition to a new phase
   */
  private async transitionPhase(state: TaskExecutionState, to: ExecutionPhase): Promise<void> {
    const from = state.phase;

    if (!isValidPhaseTransition(from, to)) {
      state.warnings.push(`Invalid transition: ${from} -> ${to}`);
      logger.warn({ taskId: state.taskId, from, to }, 'Invalid phase transition');
      return;
    }

    state.phase = to;
    this.emit({ type: 'PHASE_CHANGED', taskId: state.taskId, from, to });

    logger.debug({ taskId: state.taskId, from, to }, 'Phase transitioned');
  }

  /**
   * Advance to next pending step
   */
  private advanceToNextStep(state: TaskExecutionState): void {
    const currentIdx = state.steps.findIndex(s => s.id === state.currentStepId);
    const nextStep = state.steps.slice(currentIdx + 1).find(s => s.status === 'pending');

    if (nextStep) {
      state.currentStepId = nextStep.id;
    } else {
      // No more steps, check if all completed
      const allDone = state.steps.every(s =>
        s.status === 'completed' || s.status === 'skipped'
      );
      if (allDone && state.steps.length > 0) {
        state.currentStepId = undefined;
        // Will transition to completing when explicitly called
      }
    }
  }

  /**
   * Recalculate progress percentage
   */
  private recalculateProgress(state: TaskExecutionState): void {
    if (state.steps.length === 0) {
      state.progressPct = 0;
      return;
    }

    const completed = state.steps.filter(s =>
      s.status === 'completed' || s.status === 'skipped'
    ).length;

    state.progressPct = Math.round((completed / state.steps.length) * 100);
  }

  /**
   * Create state snapshot for checkpoint
   */
  private createStateSnapshot(state: TaskExecutionState): Record<string, unknown> {
    return {
      phase: state.phase,
      progressPct: state.progressPct,
      stepsStatus: state.steps.map(s => ({
        id: s.id,
        status: s.status,
      })),
    };
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: TaskStateManager | null = null;

/**
 * Get TaskStateManager singleton
 */
export function getTaskStateManager(): TaskStateManager {
  if (!instance) {
    instance = new TaskStateManager();
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetTaskStateManager(): void {
  instance?.clearCache();
  instance = null;
}

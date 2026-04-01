/**
 * Checkpoint Store
 *
 * Manages task execution checkpoints for recovery.
 * Hybrid: in-memory for performance, DB for persistence.
 * Critical checkpoints are persisted to survive restarts.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger.js';
import { nowTimestamp, parseJsonSafe } from '../../utils/helpers.js';
import type { TaskCheckpoint, TaskStage } from './types.js';

// Lazy import of DB to allow unit tests without DB connection
let dbModule: typeof import('../../db/index.js') | null = null;
let drizzleOrmModule: typeof import('drizzle-orm') | null = null;

async function getDb() {
  if (!dbModule) {
    dbModule = await import('../../db/index.js');
  }
  return dbModule;
}

async function getDrizzle() {
  if (!drizzleOrmModule) {
    drizzleOrmModule = await import('drizzle-orm');
  }
  return drizzleOrmModule;
}

const logger = createLogger('CheckpointStore');

// Stages that should be persisted (non-terminal, non-transient)
const PERSISTENT_STAGES: TaskStage[] = [
  'executing',
  'awaiting_response',
  'processing_result',
  'paused',
  'waiting_external',
  'waiting_approval',
  'waiting_resource',
  'retrying',
];

// Stages that are terminal (no need to persist)
const TERMINAL_STAGES: TaskStage[] = ['completed', 'failed'];

// Stages that are transient (short-lived, don't persist)
const TRANSIENT_STAGES: TaskStage[] = ['queued', 'analyzing', 'assigning', 'spawning_session', 'completing'];

export class CheckpointStore {
  private checkpoints = new Map<string, TaskCheckpoint>();
  private persistenceEnabled = true;
  private pendingPersists = new Set<string>(); // Tasks with pending DB writes
  private persistDebounceMs = 1000; // Debounce DB writes by 1 second
  private persistTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Enable/disable DB persistence (useful for testing)
   */
  setPersistenceEnabled(enabled: boolean): void {
    this.persistenceEnabled = enabled;
  }

  /**
   * Check if a stage should be persisted to DB
   */
  private shouldPersist(stage: TaskStage): boolean {
    return PERSISTENT_STAGES.includes(stage);
  }

  /**
   * Schedule a debounced persist to DB
   */
  private schedulePersist(taskId: string): void {
    if (!this.persistenceEnabled) return;

    // Clear existing timer
    const existing = this.persistTimers.get(taskId);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new persist
    const timer = setTimeout(() => {
      this.persistToDb(taskId).catch(err => {
        logger.error({ err, taskId }, 'Failed to persist checkpoint to DB');
      });
      this.persistTimers.delete(taskId);
    }, this.persistDebounceMs);

    this.persistTimers.set(taskId, timer);
    this.pendingPersists.add(taskId);
  }

  /**
   * Persist checkpoint to DB
   */
  private async persistToDb(taskId: string): Promise<void> {
    if (!this.persistenceEnabled) return;

    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) {
      // Checkpoint was deleted, remove from DB
      await this.deleteFromDb(taskId);
      return;
    }

    // Only persist if in a persistent stage
    if (!this.shouldPersist(checkpoint.currentStage)) {
      // Delete from DB if it was there (stage changed to transient/terminal)
      await this.deleteFromDb(taskId);
      return;
    }

    try {
      const { db, schema } = await getDb();

      const row = {
        taskId: checkpoint.taskId,
        executionId: checkpoint.executionId,
        assignedAgentId: checkpoint.assignedAgentId,
        currentStage: checkpoint.currentStage,
        lastCompletedStep: checkpoint.lastCompletedStep,
        progressPercent: checkpoint.progressPercent,
        lastKnownBlocker: checkpoint.lastKnownBlocker,
        pendingApproval: checkpoint.pendingApproval,
        pendingResources: checkpoint.pendingResources.length > 0
          ? JSON.stringify(checkpoint.pendingResources)
          : null,
        lastOpenClawSessionId: checkpoint.lastOpenClawSessionId,
        partialResult: checkpoint.partialResult
          ? JSON.stringify(checkpoint.partialResult)
          : null,
        statusSnapshot: Object.keys(checkpoint.statusSnapshot).length > 0
          ? JSON.stringify(checkpoint.statusSnapshot)
          : null,
        retryCount: checkpoint.retryCount,
        resumable: checkpoint.resumable,
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.updatedAt,
      };

      // Upsert: insert or replace
      await db.insert(schema.taskCheckpoints)
        .values(row)
        .onConflictDoUpdate({
          target: schema.taskCheckpoints.taskId,
          set: {
            ...row,
            taskId: undefined, // Don't update primary key
          },
        });

      this.pendingPersists.delete(taskId);
      logger.debug({ taskId, stage: checkpoint.currentStage }, 'Checkpoint persisted to DB');
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to persist checkpoint');
      throw err;
    }
  }

  /**
   * Delete checkpoint from DB
   */
  private async deleteFromDb(taskId: string): Promise<void> {
    if (!this.persistenceEnabled) return;

    try {
      const { db, schema } = await getDb();
      const { eq } = await getDrizzle();

      await db.delete(schema.taskCheckpoints)
        .where(eq(schema.taskCheckpoints.taskId, taskId));
      this.pendingPersists.delete(taskId);
    } catch (err) {
      // Ignore errors (table might not exist yet)
      logger.debug({ err, taskId }, 'Failed to delete checkpoint from DB (may not exist)');
    }
  }

  /**
   * Flush all pending persists immediately
   */
  async flushPendingPersists(): Promise<void> {
    // Clear all timers
    for (const [taskId, timer] of this.persistTimers) {
      clearTimeout(timer);
      this.persistTimers.delete(taskId);
    }

    // Persist all pending
    const pending = Array.from(this.pendingPersists);
    await Promise.all(pending.map(taskId => this.persistToDb(taskId)));
  }

  /**
   * Load checkpoints from DB on startup
   */
  async loadFromDb(): Promise<number> {
    if (!this.persistenceEnabled) return 0;

    try {
      const { db, schema } = await getDb();
      const rows = await db.select().from(schema.taskCheckpoints);
      let loaded = 0;

      for (const row of rows) {
        const checkpoint: TaskCheckpoint = {
          taskId: row.taskId,
          executionId: row.executionId,
          assignedAgentId: row.assignedAgentId,
          currentStage: row.currentStage as TaskStage,
          lastCompletedStep: row.lastCompletedStep,
          progressPercent: row.progressPercent,
          statusSnapshot: parseJsonSafe(row.statusSnapshot) ?? {},
          lastKnownBlocker: row.lastKnownBlocker,
          pendingApproval: row.pendingApproval,
          pendingResources: parseJsonSafe(row.pendingResources) ?? [],
          lastOpenClawSessionId: row.lastOpenClawSessionId,
          partialResult: parseJsonSafe(row.partialResult) ?? null,
          retryCount: row.retryCount,
          resumable: row.resumable,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };

        this.checkpoints.set(row.taskId, checkpoint);
        loaded++;
      }

      logger.info({ loaded }, 'Checkpoints loaded from DB');
      return loaded;
    } catch (err) {
      // Table might not exist yet
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('no such table') || errorMsg.includes('SQLITE_ERROR')) {
        logger.warn('Checkpoint table does not exist yet, skipping load');
        return 0;
      }
      logger.error({ err }, 'Failed to load checkpoints from DB');
      return 0;
    }
  }

  /**
   * Create a new checkpoint for a task
   */
  create(taskId: string, agentId?: string): TaskCheckpoint {
    const now = nowTimestamp();
    const executionId = `exec_${nanoid(12)}`;

    const checkpoint: TaskCheckpoint = {
      taskId,
      executionId,
      assignedAgentId: agentId ?? null,
      currentStage: 'queued',
      lastCompletedStep: null,
      progressPercent: 0,
      statusSnapshot: {},
      lastKnownBlocker: null,
      pendingApproval: null,
      pendingResources: [],
      lastOpenClawSessionId: null,
      partialResult: null,
      retryCount: 0,
      resumable: true,
      createdAt: now,
      updatedAt: now,
    };

    this.checkpoints.set(taskId, checkpoint);
    logger.debug({ taskId, executionId }, 'Checkpoint created');

    // Schedule persist if stage is persistent
    if (this.shouldPersist(checkpoint.currentStage)) {
      this.schedulePersist(taskId);
    }

    return checkpoint;
  }

  /**
   * Get checkpoint for a task
   */
  get(taskId: string): TaskCheckpoint | null {
    return this.checkpoints.get(taskId) ?? null;
  }

  /**
   * Get or create checkpoint
   */
  getOrCreate(taskId: string, agentId?: string): TaskCheckpoint {
    const existing = this.checkpoints.get(taskId);
    if (existing) return existing;
    return this.create(taskId, agentId);
  }

  /**
   * Update checkpoint stage
   */
  updateStage(
    taskId: string,
    stage: TaskStage,
    step?: string,
    progressPercent?: number
  ): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.currentStage = stage;
    if (step) checkpoint.lastCompletedStep = step;
    if (progressPercent !== undefined) checkpoint.progressPercent = progressPercent;
    checkpoint.updatedAt = nowTimestamp();

    logger.debug({ taskId, stage, step, progressPercent }, 'Checkpoint stage updated');

    // Schedule persist if entering persistent stage, delete if leaving
    if (this.shouldPersist(stage)) {
      this.schedulePersist(taskId);
    } else if (TERMINAL_STAGES.includes(stage)) {
      // Terminal stage - delete from DB
      this.deleteFromDb(taskId).catch(() => {});
    }

    return checkpoint;
  }

  /**
   * Update assigned agent
   */
  updateAgent(taskId: string, agentId: string, sessionId?: string): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.assignedAgentId = agentId;
    if (sessionId) checkpoint.lastOpenClawSessionId = sessionId;
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Update blocker
   */
  updateBlocker(taskId: string, blocker: string | null): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.lastKnownBlocker = blocker;
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Update pending approval
   */
  updatePendingApproval(taskId: string, approvalId: string | null): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.pendingApproval = approvalId;
    if (approvalId) {
      checkpoint.currentStage = 'waiting_approval';
    }
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Update pending resources
   */
  updatePendingResources(taskId: string, resourceIds: string[]): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.pendingResources = resourceIds;
    if (resourceIds.length > 0) {
      checkpoint.currentStage = 'waiting_resource';
    }
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Save partial result
   */
  savePartialResult(taskId: string, result: Record<string, unknown>): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.partialResult = result;
    checkpoint.updatedAt = nowTimestamp();

    // Partial results are critical - persist immediately if in persistent stage
    if (this.shouldPersist(checkpoint.currentStage)) {
      this.schedulePersist(taskId);
    }

    return checkpoint;
  }

  /**
   * Save status snapshot
   */
  saveSnapshot(taskId: string, snapshot: Record<string, unknown>): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.statusSnapshot = snapshot;
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Mark checkpoint as paused
   */
  markPaused(taskId: string, reason: string): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.currentStage = 'paused';
    checkpoint.lastKnownBlocker = reason;
    checkpoint.resumable = true;
    checkpoint.updatedAt = nowTimestamp();

    // Paused is persistent - persist now
    this.schedulePersist(taskId);

    logger.info({ taskId, reason }, 'Checkpoint marked as paused');
    return checkpoint;
  }

  /**
   * Mark checkpoint as failed (not resumable)
   */
  markFailed(taskId: string, reason: string): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.currentStage = 'failed';
    checkpoint.lastKnownBlocker = reason;
    checkpoint.resumable = false;
    checkpoint.updatedAt = nowTimestamp();

    // Terminal state - delete from DB
    this.deleteFromDb(taskId).catch(() => {});

    logger.info({ taskId, reason }, 'Checkpoint marked as failed');
    return checkpoint;
  }

  /**
   * Mark checkpoint as completed
   */
  markCompleted(taskId: string): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.currentStage = 'completed';
    checkpoint.progressPercent = 100;
    checkpoint.resumable = false;
    checkpoint.lastKnownBlocker = null;
    checkpoint.pendingApproval = null;
    checkpoint.pendingResources = [];
    checkpoint.updatedAt = nowTimestamp();

    // Terminal state - delete from DB
    this.deleteFromDb(taskId).catch(() => {});

    logger.info({ taskId }, 'Checkpoint marked as completed');
    return checkpoint;
  }

  /**
   * Increment retry count
   */
  incrementRetry(taskId: string): TaskCheckpoint | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;

    checkpoint.retryCount++;
    checkpoint.currentStage = 'retrying';
    checkpoint.updatedAt = nowTimestamp();

    return checkpoint;
  }

  /**
   * Delete checkpoint
   */
  delete(taskId: string): boolean {
    const deleted = this.checkpoints.delete(taskId);
    if (deleted) {
      // Also delete from DB
      this.deleteFromDb(taskId).catch(() => {});
      logger.debug({ taskId }, 'Checkpoint deleted');
    }
    return deleted;
  }

  /**
   * Get all checkpoints
   */
  list(): TaskCheckpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Get checkpoints by stage
   */
  getByStage(stage: TaskStage): TaskCheckpoint[] {
    return this.list().filter(c => c.currentStage === stage);
  }

  /**
   * Get resumable checkpoints
   */
  getResumable(): TaskCheckpoint[] {
    return this.list().filter(c => c.resumable && c.currentStage !== 'completed');
  }

  /**
   * Get checkpoints waiting for external (approval/resource)
   */
  getWaitingExternal(): TaskCheckpoint[] {
    return this.list().filter(c =>
      c.currentStage === 'waiting_approval' ||
      c.currentStage === 'waiting_resource' ||
      c.currentStage === 'waiting_external'
    );
  }

  /**
   * Get stale checkpoints (not updated in given time)
   */
  getStale(maxAgeMs: number): TaskCheckpoint[] {
    // Convert maxAgeMs to seconds since timestamps are in seconds
    const maxAgeSec = Math.floor(maxAgeMs / 1000);
    const cutoff = nowTimestamp() - maxAgeSec;
    return this.list().filter(c =>
      c.updatedAt < cutoff &&
      c.currentStage !== 'completed' &&
      c.currentStage !== 'failed'
    );
  }

  /**
   * Cleanup old completed/failed checkpoints
   */
  cleanup(maxAgeMs: number = 3600_000): number {
    // Convert maxAgeMs to seconds since timestamps are in seconds
    const maxAgeSec = Math.floor(maxAgeMs / 1000);
    const cutoff = nowTimestamp() - maxAgeSec;
    let cleaned = 0;

    for (const [taskId, checkpoint] of this.checkpoints) {
      if (
        checkpoint.updatedAt < cutoff &&
        (checkpoint.currentStage === 'completed' || checkpoint.currentStage === 'failed')
      ) {
        this.checkpoints.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, maxAgeMs }, 'Checkpoints cleaned up');
    }

    // Also cleanup old entries from DB
    this.cleanupDb(cutoff).catch(() => {});

    return cleaned;
  }

  /**
   * Cleanup old checkpoints from DB
   */
  private async cleanupDb(cutoffTimestamp: number): Promise<number> {
    if (!this.persistenceEnabled) return 0;

    try {
      const { db, schema } = await getDb();
      const { lt } = await getDrizzle();

      await db.delete(schema.taskCheckpoints)
        .where(lt(schema.taskCheckpoints.updatedAt, cutoffTimestamp));
      return 0; // SQLite doesn't return count
    } catch (err) {
      logger.debug({ err }, 'Failed to cleanup checkpoints from DB');
      return 0;
    }
  }

  /**
   * Export checkpoint for persistence
   */
  export(taskId: string): string | null {
    const checkpoint = this.checkpoints.get(taskId);
    if (!checkpoint) return null;
    return JSON.stringify(checkpoint);
  }

  /**
   * Import checkpoint from persistence
   */
  import(data: string): TaskCheckpoint | null {
    try {
      const checkpoint = JSON.parse(data) as TaskCheckpoint;
      this.checkpoints.set(checkpoint.taskId, checkpoint);
      logger.debug({ taskId: checkpoint.taskId }, 'Checkpoint imported');
      return checkpoint;
    } catch (err) {
      logger.error({ err }, 'Failed to import checkpoint');
      return null;
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    total: number;
    byStage: Record<TaskStage, number>;
    resumable: number;
    waitingExternal: number;
  } {
    const all = this.list();
    const byStage: Record<string, number> = {};

    for (const c of all) {
      byStage[c.currentStage] = (byStage[c.currentStage] ?? 0) + 1;
    }

    return {
      total: all.length,
      byStage: byStage as Record<TaskStage, number>,
      resumable: all.filter(c => c.resumable).length,
      waitingExternal: this.getWaitingExternal().length,
    };
  }
}

// Singleton
let storeInstance: CheckpointStore | null = null;
let storeInitialized = false;

export function getCheckpointStore(): CheckpointStore {
  if (!storeInstance) {
    storeInstance = new CheckpointStore();
  }
  return storeInstance;
}

/**
 * Initialize checkpoint store and load from DB
 * Call this during application startup
 */
export async function initializeCheckpointStore(): Promise<number> {
  const store = getCheckpointStore();

  if (storeInitialized) {
    logger.debug('CheckpointStore already initialized');
    return 0;
  }

  const loaded = await store.loadFromDb();
  storeInitialized = true;
  return loaded;
}

/**
 * Shutdown checkpoint store - flush pending writes
 */
export async function shutdownCheckpointStore(): Promise<void> {
  if (!storeInstance) return;

  await storeInstance.flushPendingPersists();
  logger.info('CheckpointStore shutdown complete');
}

/**
 * Checkpoint Store
 *
 * Manages task execution checkpoints for recovery
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import type { TaskCheckpoint, TaskStage } from './types.js';

const logger = createLogger('CheckpointStore');

export class CheckpointStore {
  private checkpoints = new Map<string, TaskCheckpoint>();

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

    return cleaned;
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

export function getCheckpointStore(): CheckpointStore {
  if (!storeInstance) {
    storeInstance = new CheckpointStore();
  }
  return storeInstance;
}

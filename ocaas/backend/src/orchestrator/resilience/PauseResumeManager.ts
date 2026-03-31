/**
 * Pause/Resume Manager
 *
 * Handles task pause and resume operations with checkpoint preservation
 */

import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import { getCheckpointStore } from './CheckpointStore.js';
import { getExecutionLeaseStore } from './ExecutionLeaseStore.js';
import { getExecutionRecoveryService } from './ExecutionRecoveryService.js';
import type { TaskCheckpoint, TaskStage } from './types.js';

const logger = createLogger('PauseResumeManager');

export interface PauseResult {
  success: boolean;
  taskId: string;
  previousStage: TaskStage;
  checkpoint?: TaskCheckpoint;
  error?: string;
}

export interface ResumeResult {
  success: boolean;
  taskId: string;
  resumeFromStage: TaskStage;
  checkpoint?: TaskCheckpoint;
  error?: string;
}

export class PauseResumeManager {
  /**
   * Pause a running task
   */
  pauseTask(
    taskId: string,
    reason: string,
    options?: {
      saveSnapshot?: Record<string, unknown>;
      savePartialResult?: Record<string, unknown>;
    }
  ): PauseResult {
    const checkpointStore = getCheckpointStore();
    const leaseStore = getExecutionLeaseStore();

    const checkpoint = checkpointStore.get(taskId);

    if (!checkpoint) {
      return {
        success: false,
        taskId,
        previousStage: 'queued',
        error: 'No checkpoint found for task',
      };
    }

    const previousStage = checkpoint.currentStage;

    // Can't pause already terminal tasks
    if (previousStage === 'completed' || previousStage === 'failed') {
      return {
        success: false,
        taskId,
        previousStage,
        error: `Cannot pause task in ${previousStage} state`,
      };
    }

    // Can't pause already paused tasks
    if (previousStage === 'paused') {
      return {
        success: false,
        taskId,
        previousStage,
        error: 'Task is already paused',
      };
    }

    // Save optional data before pausing
    if (options?.saveSnapshot) {
      checkpointStore.saveSnapshot(taskId, options.saveSnapshot);
    }

    if (options?.savePartialResult) {
      checkpointStore.savePartialResult(taskId, options.savePartialResult);
    }

    // Mark as paused
    const updatedCheckpoint = checkpointStore.markPaused(taskId, reason);

    if (!updatedCheckpoint) {
      return {
        success: false,
        taskId,
        previousStage,
        error: 'Failed to update checkpoint',
      };
    }

    // Release any active lease
    const lease = leaseStore.get(taskId);
    if (lease && lease.active) {
      leaseStore.release(taskId, lease.executionId);
    }

    logger.info({
      taskId,
      previousStage,
      reason,
      hasSnapshot: !!options?.saveSnapshot,
      hasPartialResult: !!options?.savePartialResult,
    }, 'Task paused');

    return {
      success: true,
      taskId,
      previousStage,
      checkpoint: updatedCheckpoint,
    };
  }

  /**
   * Resume a paused task
   */
  resumeTask(
    taskId: string,
    options?: {
      targetStage?: TaskStage;
      clearBlocker?: boolean;
    }
  ): ResumeResult {
    const checkpointStore = getCheckpointStore();
    const recoveryService = getExecutionRecoveryService();

    const checkpoint = checkpointStore.get(taskId);

    if (!checkpoint) {
      return {
        success: false,
        taskId,
        resumeFromStage: 'queued',
        error: 'No checkpoint found for task',
      };
    }

    // Can only resume paused or waiting tasks
    const resumableStages: TaskStage[] = [
      'paused',
      'waiting_approval',
      'waiting_resource',
      'waiting_external',
    ];

    if (!resumableStages.includes(checkpoint.currentStage)) {
      return {
        success: false,
        taskId,
        resumeFromStage: checkpoint.currentStage,
        error: `Cannot resume task in ${checkpoint.currentStage} state`,
      };
    }

    // Check if resumable
    if (!checkpoint.resumable) {
      return {
        success: false,
        taskId,
        resumeFromStage: checkpoint.currentStage,
        error: 'Task is not marked as resumable',
      };
    }

    // Check system readiness
    const systemCheck = recoveryService.isSystemReady();
    if (!systemCheck.ready) {
      return {
        success: false,
        taskId,
        resumeFromStage: checkpoint.currentStage,
        error: `System not ready: ${systemCheck.reason}`,
      };
    }

    // Determine target stage
    let targetStage: TaskStage;

    if (options?.targetStage) {
      targetStage = options.targetStage;
    } else {
      // Determine based on checkpoint state
      targetStage = this.determineResumeStage(checkpoint);
    }

    // Clear blocker if requested
    if (options?.clearBlocker) {
      checkpointStore.updateBlocker(taskId, null);
    }

    // Update checkpoint to resume
    const updatedCheckpoint = checkpointStore.updateStage(
      taskId,
      targetStage,
      checkpoint.lastCompletedStep ?? undefined,
      checkpoint.progressPercent
    );

    if (!updatedCheckpoint) {
      return {
        success: false,
        taskId,
        resumeFromStage: checkpoint.currentStage,
        error: 'Failed to update checkpoint',
      };
    }

    // Reset recovery attempts
    recoveryService.resetRecoveryAttempts(taskId);

    logger.info({
      taskId,
      fromStage: checkpoint.currentStage,
      toStage: targetStage,
      hasPartialResult: !!checkpoint.partialResult,
      progressPercent: checkpoint.progressPercent,
    }, 'Task resumed');

    return {
      success: true,
      taskId,
      resumeFromStage: targetStage,
      checkpoint: updatedCheckpoint,
    };
  }

  /**
   * Get pausable tasks (tasks that can be paused)
   */
  getPausableTasks(): TaskCheckpoint[] {
    const checkpointStore = getCheckpointStore();
    const all = checkpointStore.list();

    const nonPausableStages: TaskStage[] = [
      'completed',
      'failed',
      'paused',
    ];

    return all.filter(c => !nonPausableStages.includes(c.currentStage));
  }

  /**
   * Get resumable tasks (tasks that can be resumed)
   */
  getResumableTasks(): TaskCheckpoint[] {
    const checkpointStore = getCheckpointStore();
    return checkpointStore.getResumable();
  }

  /**
   * Pause all running tasks (graceful shutdown)
   */
  pauseAllRunning(reason: string): PauseResult[] {
    const pausable = this.getPausableTasks();
    const results: PauseResult[] = [];

    for (const checkpoint of pausable) {
      const result = this.pauseTask(checkpoint.taskId, reason);
      results.push(result);
    }

    logger.info({
      total: pausable.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    }, 'Paused all running tasks');

    return results;
  }

  /**
   * Resume all paused tasks
   */
  resumeAllPaused(): ResumeResult[] {
    const checkpointStore = getCheckpointStore();
    const paused = checkpointStore.getByStage('paused');
    const results: ResumeResult[] = [];

    for (const checkpoint of paused) {
      if (checkpoint.resumable) {
        const result = this.resumeTask(checkpoint.taskId);
        results.push(result);
      }
    }

    logger.info({
      total: paused.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    }, 'Resumed all paused tasks');

    return results;
  }

  /**
   * Determine the best stage to resume from based on checkpoint
   */
  private determineResumeStage(checkpoint: TaskCheckpoint): TaskStage {
    // If we have a partial result and were near completion, try completing
    if (checkpoint.partialResult && checkpoint.progressPercent >= 80) {
      return 'processing_result';
    }

    // If we have an assigned agent and session, try continuing execution
    if (checkpoint.assignedAgentId && checkpoint.lastOpenClawSessionId) {
      return 'executing';
    }

    // If we have an assigned agent but no session, spawn new session
    if (checkpoint.assignedAgentId) {
      return 'spawning_session';
    }

    // Default: restart from queue for assignment
    return 'queued';
  }

  /**
   * Check if a task can be paused
   */
  canPause(taskId: string): { canPause: boolean; reason?: string } {
    const checkpointStore = getCheckpointStore();
    const checkpoint = checkpointStore.get(taskId);

    if (!checkpoint) {
      return { canPause: false, reason: 'No checkpoint found' };
    }

    const nonPausableStages: TaskStage[] = ['completed', 'failed', 'paused'];

    if (nonPausableStages.includes(checkpoint.currentStage)) {
      return {
        canPause: false,
        reason: `Task is in ${checkpoint.currentStage} state`,
      };
    }

    return { canPause: true };
  }

  /**
   * Check if a task can be resumed
   */
  canResume(taskId: string): { canResume: boolean; reason?: string } {
    const checkpointStore = getCheckpointStore();
    const checkpoint = checkpointStore.get(taskId);

    if (!checkpoint) {
      return { canResume: false, reason: 'No checkpoint found' };
    }

    if (!checkpoint.resumable) {
      return { canResume: false, reason: 'Task is not marked as resumable' };
    }

    const resumableStages: TaskStage[] = [
      'paused',
      'waiting_approval',
      'waiting_resource',
      'waiting_external',
    ];

    if (!resumableStages.includes(checkpoint.currentStage)) {
      return {
        canResume: false,
        reason: `Task is in ${checkpoint.currentStage} state`,
      };
    }

    return { canResume: true };
  }

  /**
   * Get pause/resume statistics
   */
  getStats(): {
    pausable: number;
    resumable: number;
    paused: number;
    waitingExternal: number;
  } {
    const checkpointStore = getCheckpointStore();

    return {
      pausable: this.getPausableTasks().length,
      resumable: this.getResumableTasks().length,
      paused: checkpointStore.getByStage('paused').length,
      waitingExternal: checkpointStore.getWaitingExternal().length,
    };
  }
}

// Singleton
let managerInstance: PauseResumeManager | null = null;

export function getPauseResumeManager(): PauseResumeManager {
  if (!managerInstance) {
    managerInstance = new PauseResumeManager();
  }
  return managerInstance;
}

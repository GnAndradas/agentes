/**
 * Execution Recovery Service
 *
 * Handles startup recovery, task reconciliation, and orphan detection
 */

import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import { getCheckpointStore } from './CheckpointStore.js';
import { getExecutionLeaseStore } from './ExecutionLeaseStore.js';
import { getHealthChecker } from './HealthChecker.js';
import { getCircuitBreaker } from './CircuitBreaker.js';
import { OperationalError } from './OperationalError.js';
import type {
  TaskCheckpoint,
  ExecutionLease,
  RecoveryResult,
  RecoveryAction,
  TaskStage,
} from './types.js';

const logger = createLogger('ExecutionRecoveryService');

// Stale threshold: tasks not updated in 10 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// Max recovery attempts
const MAX_RECOVERY_ATTEMPTS = 3;

export class ExecutionRecoveryService {
  private recoveryInProgress = false;
  private lastRecoveryAt = 0;
  private recoveryAttempts = new Map<string, number>();

  /**
   * Perform startup recovery
   * Called when OCAAS starts to reconcile any in-flight tasks
   */
  async startupRecovery(): Promise<RecoveryResult> {
    if (this.recoveryInProgress) {
      logger.warn('Recovery already in progress, skipping');
      return {
        success: false,
        message: 'Recovery already in progress',
        recovered: [],
        failed: [],
        skipped: [],
      };
    }

    this.recoveryInProgress = true;
    const startTime = nowTimestamp();

    logger.info('Starting startup recovery...');

    const result: RecoveryResult = {
      success: true,
      message: '',
      recovered: [],
      failed: [],
      skipped: [],
    };

    try {
      const checkpointStore = getCheckpointStore();
      const leaseStore = getExecutionLeaseStore();

      // 1. Release all expired leases
      const expiredLeases = leaseStore.getExpiredLeases();
      for (const lease of expiredLeases) {
        leaseStore.forceRelease(lease.taskId);
        logger.debug({ taskId: lease.taskId }, 'Released expired lease');
      }

      // 2. Find all resumable checkpoints
      const resumable = checkpointStore.getResumable();
      logger.info({ count: resumable.length }, 'Found resumable checkpoints');

      // 3. Find tasks waiting for external (approval/resource)
      const waitingExternal = checkpointStore.getWaitingExternal();
      logger.info({ count: waitingExternal.length }, 'Found tasks waiting for external');

      // 4. Find stale checkpoints
      const stale = checkpointStore.getStale(STALE_THRESHOLD_MS);
      logger.info({ count: stale.length }, 'Found stale checkpoints');

      // 5. Process each checkpoint
      for (const checkpoint of resumable) {
        // Skip tasks waiting for external - they need the external action first
        if (this.isWaitingExternal(checkpoint.currentStage)) {
          result.skipped.push({
            taskId: checkpoint.taskId,
            reason: `Waiting for ${checkpoint.currentStage}`,
          });
          continue;
        }

        const recovery = await this.reconcileTask(checkpoint);

        if (recovery.success) {
          result.recovered.push({
            taskId: checkpoint.taskId,
            action: recovery.action,
            newStage: recovery.newStage,
          });
        } else {
          result.failed.push({
            taskId: checkpoint.taskId,
            error: recovery.error ?? 'Unknown error',
          });
        }
      }

      // 6. Handle stale tasks (mark as paused for manual review)
      for (const checkpoint of stale) {
        if (!resumable.includes(checkpoint)) {
          checkpointStore.markPaused(checkpoint.taskId, 'Stale task detected during recovery');
          result.recovered.push({
            taskId: checkpoint.taskId,
            action: 'marked_paused',
            newStage: 'paused',
          });
        }
      }

      // 7. Cleanup old completed/failed checkpoints
      checkpointStore.cleanup();

      result.message = `Recovery completed: ${result.recovered.length} recovered, ${result.failed.length} failed, ${result.skipped.length} skipped`;
      logger.info({
        recovered: result.recovered.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
        durationMs: nowTimestamp() - startTime,
      }, 'Startup recovery completed');

    } catch (err) {
      result.success = false;
      result.message = `Recovery failed: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ err }, 'Startup recovery failed');
    } finally {
      this.recoveryInProgress = false;
      this.lastRecoveryAt = nowTimestamp();
    }

    return result;
  }

  /**
   * Reconcile a single task
   */
  async reconcileTask(checkpoint: TaskCheckpoint): Promise<{
    success: boolean;
    action: RecoveryAction;
    newStage?: TaskStage;
    error?: string;
  }> {
    const { taskId, currentStage, executionId } = checkpoint;

    // Track recovery attempts
    const attempts = this.recoveryAttempts.get(taskId) ?? 0;
    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      const checkpointStore = getCheckpointStore();
      checkpointStore.markFailed(taskId, 'Max recovery attempts exceeded');
      return {
        success: false,
        action: 'marked_failed',
        newStage: 'failed',
        error: 'Max recovery attempts exceeded',
      };
    }
    this.recoveryAttempts.set(taskId, attempts + 1);

    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();

    try {
      // Determine recovery action based on stage
      switch (currentStage) {
        case 'queued':
          // Task was queued but never started - ready for re-assignment
          return {
            success: true,
            action: 'ready_for_assignment',
            newStage: 'queued',
          };

        case 'analyzing':
        case 'assigning':
          // Early stages - restart from beginning
          checkpointStore.updateStage(taskId, 'queued');
          return {
            success: true,
            action: 'restarted',
            newStage: 'queued',
          };

        case 'spawning_session':
        case 'executing':
        case 'awaiting_response':
          // Mid-execution - check if we have partial progress
          if (checkpoint.lastCompletedStep || checkpoint.partialResult) {
            // Has checkpoint data - can resume
            checkpointStore.updateStage(taskId, 'paused', undefined, checkpoint.progressPercent);
            return {
              success: true,
              action: 'checkpointed',
              newStage: 'paused',
            };
          }
          // No progress - restart
          checkpointStore.updateStage(taskId, 'queued');
          return {
            success: true,
            action: 'restarted',
            newStage: 'queued',
          };

        case 'processing_result':
        case 'completing':
          // Near completion - might have result
          if (checkpoint.partialResult) {
            // Has result - mark for completion review
            checkpointStore.updateStage(taskId, 'paused', 'pending_completion_review');
            return {
              success: true,
              action: 'checkpointed',
              newStage: 'paused',
            };
          }
          // No result - restart from execution
          checkpointStore.updateStage(taskId, 'queued');
          return {
            success: true,
            action: 'restarted',
            newStage: 'queued',
          };

        case 'retrying':
          // Was retrying - continue retry
          checkpointStore.updateStage(taskId, 'queued');
          return {
            success: true,
            action: 'retry_continued',
            newStage: 'queued',
          };

        case 'paused':
          // Already paused - ready for resume
          return {
            success: true,
            action: 'ready_for_resume',
            newStage: 'paused',
          };

        case 'waiting_approval':
        case 'waiting_resource':
        case 'waiting_external':
          // Waiting for something - keep waiting
          return {
            success: true,
            action: 'waiting',
            newStage: currentStage,
          };

        case 'completed':
        case 'failed':
          // Terminal states - nothing to recover
          return {
            success: true,
            action: 'no_action_needed',
            newStage: currentStage,
          };

        default:
          // Unknown stage - pause for review
          checkpointStore.markPaused(taskId, `Unknown stage: ${currentStage}`);
          return {
            success: true,
            action: 'marked_paused',
            newStage: 'paused',
          };
      }
    } catch (err) {
      logger.error({ taskId, err }, 'Task reconciliation failed');
      return {
        success: false,
        action: 'reconciliation_failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Detect orphan executions (leases without matching active checkpoints)
   */
  detectOrphanExecutions(): Array<{
    taskId: string;
    executionId: string;
    reason: string;
  }> {
    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();
    const orphans: Array<{ taskId: string; executionId: string; reason: string }> = [];

    // Check active leases
    const activeLeases = leaseStore.getActiveLeases();

    for (const lease of activeLeases) {
      const checkpoint = checkpointStore.get(lease.taskId);

      if (!checkpoint) {
        orphans.push({
          taskId: lease.taskId,
          executionId: lease.executionId,
          reason: 'Lease without checkpoint',
        });
        continue;
      }

      if (checkpoint.executionId !== lease.executionId) {
        orphans.push({
          taskId: lease.taskId,
          executionId: lease.executionId,
          reason: 'Execution ID mismatch',
        });
        continue;
      }

      // Check if checkpoint is in terminal state but lease is still active
      if (checkpoint.currentStage === 'completed' || checkpoint.currentStage === 'failed') {
        orphans.push({
          taskId: lease.taskId,
          executionId: lease.executionId,
          reason: 'Lease for terminal task',
        });
      }
    }

    if (orphans.length > 0) {
      logger.warn({ count: orphans.length }, 'Orphan executions detected');
    }

    return orphans;
  }

  /**
   * Clean up orphan executions
   */
  cleanupOrphanExecutions(): number {
    const orphans = this.detectOrphanExecutions();
    const leaseStore = getExecutionLeaseStore();
    let cleaned = 0;

    for (const orphan of orphans) {
      if (leaseStore.forceRelease(orphan.taskId)) {
        cleaned++;
        logger.info({
          taskId: orphan.taskId,
          executionId: orphan.executionId,
          reason: orphan.reason,
        }, 'Cleaned up orphan execution');
      }
    }

    return cleaned;
  }

  /**
   * Check if system is ready for task execution
   */
  isSystemReady(): { ready: boolean; reason?: string } {
    const healthChecker = getHealthChecker();
    const mainCircuit = getCircuitBreaker('main');

    // Check health
    if (!healthChecker.isHealthyForExecution()) {
      return {
        ready: false,
        reason: `System health: ${healthChecker.getOverallStatus()}`,
      };
    }

    // Check circuit breaker
    if (!mainCircuit.canExecute()) {
      return {
        ready: false,
        reason: 'Main circuit breaker is open',
      };
    }

    return { ready: true };
  }

  /**
   * Get recovery status
   */
  getStatus(): {
    recoveryInProgress: boolean;
    lastRecoveryAt: number;
    checkpointStats: ReturnType<typeof getCheckpointStore>['getStats'] extends () => infer R ? R : never;
    leaseStats: ReturnType<typeof getExecutionLeaseStore>['getStats'] extends () => infer R ? R : never;
    orphanCount: number;
  } {
    const checkpointStore = getCheckpointStore();
    const leaseStore = getExecutionLeaseStore();

    return {
      recoveryInProgress: this.recoveryInProgress,
      lastRecoveryAt: this.lastRecoveryAt,
      checkpointStats: checkpointStore.getStats(),
      leaseStats: leaseStore.getStats(),
      orphanCount: this.detectOrphanExecutions().length,
    };
  }

  /**
   * Reset recovery attempts for a task
   */
  resetRecoveryAttempts(taskId: string): void {
    this.recoveryAttempts.delete(taskId);
  }

  /**
   * Check if stage is waiting for external
   */
  private isWaitingExternal(stage: TaskStage): boolean {
    return (
      stage === 'waiting_approval' ||
      stage === 'waiting_resource' ||
      stage === 'waiting_external'
    );
  }
}

// Singleton
let serviceInstance: ExecutionRecoveryService | null = null;

export function getExecutionRecoveryService(): ExecutionRecoveryService {
  if (!serviceInstance) {
    serviceInstance = new ExecutionRecoveryService();
  }
  return serviceInstance;
}

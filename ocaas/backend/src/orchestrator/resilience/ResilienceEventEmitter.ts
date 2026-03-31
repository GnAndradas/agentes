/**
 * Resilience Event Emitter
 *
 * Emits events related to fault tolerance, recovery, and checkpoints
 */

import { eventBus } from '../../events/EventBus.js';
import { EVENT_TYPE } from '../../config/constants.js';
import { createLogger } from '../../utils/logger.js';
import type {
  TaskCheckpoint,
  ExecutionLease,
  CircuitState,
  HealthStatus,
  RecoveryResult,
} from './types.js';

const logger = createLogger('ResilienceEventEmitter');

export class ResilienceEventEmitter {
  /**
   * Emit checkpoint created/updated event
   */
  checkpointUpdated(checkpoint: TaskCheckpoint): void {
    eventBus.emit(EVENT_TYPE.EXECUTION_CHECKPOINTED, {
      taskId: checkpoint.taskId,
      executionId: checkpoint.executionId,
      stage: checkpoint.currentStage,
      progressPercent: checkpoint.progressPercent,
      lastCompletedStep: checkpoint.lastCompletedStep,
      resumable: checkpoint.resumable,
      updatedAt: checkpoint.updatedAt,
    });
  }

  /**
   * Emit lease acquired event
   */
  leaseAcquired(lease: ExecutionLease): void {
    eventBus.emit(EVENT_TYPE.EXECUTION_LEASE_ACQUIRED, {
      taskId: lease.taskId,
      executionId: lease.executionId,
      instanceId: lease.instanceId,
      expiresAt: lease.expiresAt,
      acquiredAt: lease.acquiredAt,
    });
  }

  /**
   * Emit lease released event
   */
  leaseReleased(taskId: string, executionId: string, reason?: string): void {
    eventBus.emit(EVENT_TYPE.EXECUTION_LEASE_RELEASED, {
      taskId,
      executionId,
      reason: reason ?? 'normal_release',
    });
  }

  /**
   * Emit lease expired event
   */
  leaseExpired(lease: ExecutionLease): void {
    eventBus.emit(EVENT_TYPE.EXECUTION_LEASE_EXPIRED, {
      taskId: lease.taskId,
      executionId: lease.executionId,
      instanceId: lease.instanceId,
      expiresAt: lease.expiresAt,
    });
  }

  /**
   * Emit task paused event
   */
  taskPaused(taskId: string, reason: string, previousStage: string): void {
    eventBus.emit(EVENT_TYPE.TASK_PAUSED, {
      taskId,
      reason,
      previousStage,
    });
  }

  /**
   * Emit task resumed event
   */
  taskResumed(taskId: string, fromStage: string, toStage: string): void {
    eventBus.emit(EVENT_TYPE.TASK_RESUMED, {
      taskId,
      fromStage,
      toStage,
    });
  }

  /**
   * Emit recovery started event
   */
  recoveryStarted(reason: string, taskCount: number): void {
    eventBus.emit(EVENT_TYPE.TASK_RECOVERY_STARTED, {
      reason,
      taskCount,
    });
  }

  /**
   * Emit recovery completed event
   */
  recoveryCompleted(result: RecoveryResult): void {
    eventBus.emit(EVENT_TYPE.TASK_RECOVERY_COMPLETED, {
      success: result.success,
      message: result.message,
      recoveredCount: result.recovered.length,
      failedCount: result.failed.length,
      skippedCount: result.skipped.length,
    });
  }

  /**
   * Emit recovery failed event
   */
  recoveryFailed(taskId: string, error: string): void {
    eventBus.emit(EVENT_TYPE.TASK_RECOVERY_FAILED, {
      taskId,
      error,
    });
  }

  /**
   * Emit orphan execution detected event
   */
  orphanDetected(taskId: string, executionId: string, reason: string): void {
    eventBus.emit(EVENT_TYPE.ORPHAN_EXECUTION_DETECTED, {
      taskId,
      executionId,
      reason,
    });
  }

  /**
   * Emit circuit breaker opened event
   */
  circuitOpened(name: string, failures: number, threshold: number): void {
    eventBus.emit(EVENT_TYPE.CIRCUIT_BREAKER_OPENED, {
      name,
      failures,
      threshold,
    });
    logger.warn({ name, failures, threshold }, 'Circuit breaker opened');
  }

  /**
   * Emit circuit breaker closed event
   */
  circuitClosed(name: string, successes: number): void {
    eventBus.emit(EVENT_TYPE.CIRCUIT_BREAKER_CLOSED, {
      name,
      successes,
    });
    logger.info({ name, successes }, 'Circuit breaker closed');
  }

  /**
   * Emit health status changed event
   */
  healthStatusChanged(
    componentId: string,
    oldStatus: HealthStatus,
    newStatus: HealthStatus
  ): void {
    eventBus.emit(EVENT_TYPE.HEALTH_STATUS_CHANGED, {
      componentId,
      oldStatus,
      newStatus,
    });
  }

  /**
   * Emit system degraded event
   */
  systemDegraded(reason: string, components: string[]): void {
    eventBus.emit(EVENT_TYPE.SYSTEM_DEGRADED, {
      reason,
      affectedComponents: components,
    });
    logger.warn({ reason, components }, 'System degraded');
  }

  /**
   * Emit system recovered event
   */
  systemRecovered(): void {
    eventBus.emit(EVENT_TYPE.SYSTEM_RECOVERED, {
      recoveredAt: Date.now(),
    });
    logger.info('System recovered to healthy state');
  }
}

// Singleton
let emitterInstance: ResilienceEventEmitter | null = null;

export function getResilienceEventEmitter(): ResilienceEventEmitter {
  if (!emitterInstance) {
    emitterInstance = new ResilienceEventEmitter();
  }
  return emitterInstance;
}

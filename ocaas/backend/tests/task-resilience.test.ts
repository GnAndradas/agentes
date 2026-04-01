/**
 * Task Resilience Tests
 *
 * Tests for:
 * 1. Lease-based double execution prevention
 * 2. Checkpoint state tracking
 * 3. Recovery from crash scenarios
 * 4. FSM state transition validation
 * 5. Orphan task detection and handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { ExecutionLeaseStore, getExecutionLeaseStore } from '../src/orchestrator/resilience/ExecutionLeaseStore.js';
import { CheckpointStore, getCheckpointStore } from '../src/orchestrator/resilience/CheckpointStore.js';
import type { TaskStage } from '../src/orchestrator/resilience/types.js';

// ============================================================================
// TEST: ExecutionLeaseStore - Double Execution Prevention
// ============================================================================

describe('ExecutionLeaseStore', () => {
  let store: ExecutionLeaseStore;

  beforeEach(() => {
    store = new ExecutionLeaseStore(5000); // 5 second lease for tests
  });

  describe('acquire', () => {
    it('should acquire lease for new task', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      const lease = store.acquire(taskId, executionId);

      expect(lease).not.toBeNull();
      expect(lease?.taskId).toBe(taskId);
      expect(lease?.executionId).toBe(executionId);
      expect(lease?.active).toBe(true);
    });

    it('should prevent double acquisition by different execution', () => {
      const taskId = `task_${nanoid()}`;
      const exec1 = `exec_${nanoid()}`;
      const exec2 = `exec_${nanoid()}`;

      const lease1 = store.acquire(taskId, exec1);
      const lease2 = store.acquire(taskId, exec2);

      expect(lease1).not.toBeNull();
      expect(lease2).toBeNull(); // Should fail - already leased
    });

    it('should allow same execution to re-acquire (idempotent)', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      const lease1 = store.acquire(taskId, executionId);
      const lease2 = store.acquire(taskId, executionId);

      expect(lease1).not.toBeNull();
      expect(lease2).not.toBeNull();
      expect(lease1?.executionId).toBe(lease2?.executionId);
    });

    it('should allow acquisition after lease released', () => {
      const taskId = `task_${nanoid()}`;
      const exec1 = `exec_${nanoid()}`;
      const exec2 = `exec_${nanoid()}`;

      store.acquire(taskId, exec1);
      store.release(taskId, exec1); // Explicit release

      const lease2 = store.acquire(taskId, exec2);

      expect(lease2).not.toBeNull();
      expect(lease2?.executionId).toBe(exec2);
    });
  });

  describe('renew', () => {
    it('should renew active lease', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      const original = store.acquire(taskId, executionId);
      const originalExpiry = original?.expiresAt;

      const renewed = store.renew(taskId, executionId);

      expect(renewed).not.toBeNull();
      expect(renewed?.expiresAt).toBeGreaterThanOrEqual(originalExpiry ?? 0);
    });

    it('should reject renewal from different execution', () => {
      const taskId = `task_${nanoid()}`;
      const exec1 = `exec_${nanoid()}`;
      const exec2 = `exec_${nanoid()}`;

      store.acquire(taskId, exec1);
      const renewed = store.renew(taskId, exec2);

      expect(renewed).toBeNull();
    });

    it('should reject renewal of inactive lease', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      store.acquire(taskId, executionId);
      store.release(taskId, executionId); // Release makes it inactive

      const renewed = store.renew(taskId, executionId);

      expect(renewed).toBeNull();
    });
  });

  describe('release', () => {
    it('should release owned lease', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      store.acquire(taskId, executionId);
      const released = store.release(taskId, executionId);

      expect(released).toBe(true);
      expect(store.hasActiveLease(taskId)).toBe(false);
    });

    it('should not release lease owned by different execution', () => {
      const taskId = `task_${nanoid()}`;
      const exec1 = `exec_${nanoid()}`;
      const exec2 = `exec_${nanoid()}`;

      store.acquire(taskId, exec1);
      const released = store.release(taskId, exec2);

      expect(released).toBe(false);
      expect(store.hasActiveLease(taskId)).toBe(true);
    });
  });

  describe('hasActiveLease', () => {
    it('should return false for task without lease', () => {
      expect(store.hasActiveLease(`task_${nanoid()}`)).toBe(false);
    });

    it('should return true for task with active lease', () => {
      const taskId = `task_${nanoid()}`;
      store.acquire(taskId, `exec_${nanoid()}`);

      expect(store.hasActiveLease(taskId)).toBe(true);
    });

    it('should return false for released lease', () => {
      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      store.acquire(taskId, executionId);
      store.release(taskId, executionId);

      expect(store.hasActiveLease(taskId)).toBe(false);
    });
  });

  describe('getActiveLeases', () => {
    it('should return only active non-released leases', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const exec1 = `exec_${nanoid()}`;
      const exec2 = `exec_${nanoid()}`;

      store.acquire(task1, exec1);
      store.acquire(task2, exec2);

      expect(store.getActiveLeases().length).toBe(2);

      store.release(task1, exec1);

      expect(store.getActiveLeases().length).toBe(1);
      expect(store.getActiveLeases()[0]?.taskId).toBe(task2);
    });
  });
});

// ============================================================================
// TEST: CheckpointStore - Execution State Tracking
// ============================================================================

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new CheckpointStore();
  });

  describe('create', () => {
    it('should create checkpoint with initial state', () => {
      const taskId = `task_${nanoid()}`;

      const checkpoint = store.create(taskId);

      expect(checkpoint.taskId).toBe(taskId);
      expect(checkpoint.currentStage).toBe('queued');
      expect(checkpoint.progressPercent).toBe(0);
      expect(checkpoint.resumable).toBe(true);
    });

    it('should create checkpoint with agent ID', () => {
      const taskId = `task_${nanoid()}`;
      const agentId = `agent_${nanoid()}`;

      const checkpoint = store.create(taskId, agentId);

      expect(checkpoint.assignedAgentId).toBe(agentId);
    });
  });

  describe('updateStage', () => {
    it('should update checkpoint stage', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const updated = store.updateStage(taskId, 'executing', 'step_1', 50);

      expect(updated?.currentStage).toBe('executing');
      expect(updated?.lastCompletedStep).toBe('step_1');
      expect(updated?.progressPercent).toBe(50);
    });

    it('should return null for non-existent checkpoint', () => {
      const updated = store.updateStage(`task_${nanoid()}`, 'executing');

      expect(updated).toBeNull();
    });
  });

  describe('markPaused', () => {
    it('should mark checkpoint as paused and resumable', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const paused = store.markPaused(taskId, 'Test pause reason');

      expect(paused?.currentStage).toBe('paused');
      expect(paused?.resumable).toBe(true);
      expect(paused?.lastKnownBlocker).toBe('Test pause reason');
    });
  });

  describe('markFailed', () => {
    it('should mark checkpoint as failed and not resumable', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const failed = store.markFailed(taskId, 'Test failure');

      expect(failed?.currentStage).toBe('failed');
      expect(failed?.resumable).toBe(false);
    });
  });

  describe('markCompleted', () => {
    it('should mark checkpoint as completed', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const completed = store.markCompleted(taskId);

      expect(completed?.currentStage).toBe('completed');
      expect(completed?.progressPercent).toBe(100);
      expect(completed?.resumable).toBe(false);
    });
  });

  describe('savePartialResult', () => {
    it('should save partial result for recovery', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const result = { response: 'partial data' };
      const updated = store.savePartialResult(taskId, result);

      expect(updated?.partialResult).toEqual(result);
    });
  });

  describe('getResumable', () => {
    it('should return only resumable non-completed checkpoints', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const task3 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);
      store.create(task3);

      store.markCompleted(task1);
      store.markPaused(task2, 'paused');
      // task3 remains queued and resumable

      const resumable = store.getResumable();

      expect(resumable.length).toBe(2);
      expect(resumable.map(c => c.taskId)).toContain(task2);
      expect(resumable.map(c => c.taskId)).toContain(task3);
    });
  });

  describe('getStale', () => {
    it('should return checkpoints with old updatedAt', () => {
      const taskId = `task_${nanoid()}`;
      const checkpoint = store.create(taskId);

      // Manually set updatedAt to old value (10 minutes ago in seconds)
      checkpoint.updatedAt = checkpoint.updatedAt - 600;

      const stale = store.getStale(5 * 60 * 1000); // 5 minutes in ms

      expect(stale.length).toBe(1);
      expect(stale[0]?.taskId).toBe(taskId);
    });

    it('should not return completed checkpoints as stale', () => {
      const taskId = `task_${nanoid()}`;
      const checkpoint = store.create(taskId);
      checkpoint.updatedAt = checkpoint.updatedAt - 600; // 10 min old
      store.markCompleted(taskId);

      const stale = store.getStale(5 * 60 * 1000);

      expect(stale.length).toBe(0);
    });
  });

  describe('incrementRetry', () => {
    it('should increment retry count and set retrying stage', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const updated = store.incrementRetry(taskId);

      expect(updated?.retryCount).toBe(1);
      expect(updated?.currentStage).toBe('retrying');

      const again = store.incrementRetry(taskId);

      expect(again?.retryCount).toBe(2);
    });
  });
});

// ============================================================================
// TEST: FSM State Transitions
// ============================================================================

describe('Task FSM Transitions', () => {
  // Valid transitions map
  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['queued', 'cancelled'],
    queued: ['assigned', 'cancelled', 'pending'],
    assigned: ['running', 'failed', 'cancelled', 'queued'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: ['pending'],
    cancelled: [],
  };

  function isValidTransition(from: string, to: string): boolean {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
  }

  it('should allow pending → queued', () => {
    expect(isValidTransition('pending', 'queued')).toBe(true);
  });

  it('should allow queued → assigned', () => {
    expect(isValidTransition('queued', 'assigned')).toBe(true);
  });

  it('should allow assigned → running', () => {
    expect(isValidTransition('assigned', 'running')).toBe(true);
  });

  it('should allow running → completed', () => {
    expect(isValidTransition('running', 'completed')).toBe(true);
  });

  it('should allow running → failed', () => {
    expect(isValidTransition('running', 'failed')).toBe(true);
  });

  it('should allow failed → pending (retry)', () => {
    expect(isValidTransition('failed', 'pending')).toBe(true);
  });

  it('should reject completed → running (terminal)', () => {
    expect(isValidTransition('completed', 'running')).toBe(false);
  });

  it('should reject pending → completed (skip states)', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
  });

  it('should reject cancelled → anything (terminal)', () => {
    expect(isValidTransition('cancelled', 'pending')).toBe(false);
    expect(isValidTransition('cancelled', 'running')).toBe(false);
  });

  it('should allow any non-terminal state → cancelled', () => {
    expect(isValidTransition('pending', 'cancelled')).toBe(true);
    expect(isValidTransition('queued', 'cancelled')).toBe(true);
    expect(isValidTransition('assigned', 'cancelled')).toBe(true);
    expect(isValidTransition('running', 'cancelled')).toBe(true);
  });
});

// ============================================================================
// TEST: Recovery Scenarios
// ============================================================================

describe('Recovery Scenarios', () => {
  describe('Orphan Detection', () => {
    it('should detect lease without checkpoint', () => {
      const leaseStore = new ExecutionLeaseStore();
      const checkpointStore = new CheckpointStore();

      const taskId = `task_${nanoid()}`;
      const executionId = `exec_${nanoid()}`;

      // Only create lease, no checkpoint
      leaseStore.acquire(taskId, executionId);

      const activeLeases = leaseStore.getActiveLeases();
      const orphans: string[] = [];

      for (const lease of activeLeases) {
        if (!checkpointStore.get(lease.taskId)) {
          orphans.push(lease.taskId);
        }
      }

      expect(orphans).toContain(taskId);
    });

    it('should detect execution ID mismatch', () => {
      const leaseStore = new ExecutionLeaseStore();
      const checkpointStore = new CheckpointStore();

      const taskId = `task_${nanoid()}`;
      const leaseExec = `exec_lease_${nanoid()}`;
      const checkpointExec = `exec_checkpoint_${nanoid()}`;

      leaseStore.acquire(taskId, leaseExec);
      const checkpoint = checkpointStore.create(taskId);
      checkpoint.executionId = checkpointExec;

      const activeLeases = leaseStore.getActiveLeases();
      const mismatches: string[] = [];

      for (const lease of activeLeases) {
        const cp = checkpointStore.get(lease.taskId);
        if (cp && cp.executionId !== lease.executionId) {
          mismatches.push(lease.taskId);
        }
      }

      expect(mismatches).toContain(taskId);
    });
  });

  describe('Crash Recovery', () => {
    it('should allow new execution after lease cleanup', () => {
      const leaseStore = new ExecutionLeaseStore();

      const taskId = `task_${nanoid()}`;
      const oldExec = `exec_old_${nanoid()}`;
      const newExec = `exec_new_${nanoid()}`;

      // Simulate old execution
      leaseStore.acquire(taskId, oldExec);

      // Simulate crash recovery - force release
      leaseStore.forceRelease(taskId);

      // New execution should succeed
      const newLease = leaseStore.acquire(taskId, newExec);

      expect(newLease).not.toBeNull();
      expect(newLease?.executionId).toBe(newExec);
    });

    it('should preserve partial result in checkpoint for recovery', () => {
      const store = new CheckpointStore();
      const taskId = `task_${nanoid()}`;

      store.create(taskId);
      store.updateStage(taskId, 'processing_result', 'response_received', 80);
      store.savePartialResult(taskId, { response: 'Important data' });
      store.markPaused(taskId, 'Crash recovery');

      const checkpoint = store.get(taskId);

      expect(checkpoint?.partialResult).toEqual({ response: 'Important data' });
      expect(checkpoint?.currentStage).toBe('paused');
      expect(checkpoint?.resumable).toBe(true);
    });
  });
});

// ============================================================================
// TEST: Concurrent Execution Prevention
// ============================================================================

describe('Concurrent Execution Prevention', () => {
  it('should prevent parallel execution of same task', async () => {
    const store = new ExecutionLeaseStore();
    const taskId = `task_${nanoid()}`;

    const results: boolean[] = [];

    // Simulate 10 concurrent attempts to acquire lease
    const attempts = Array.from({ length: 10 }, (_, i) => {
      return new Promise<void>(resolve => {
        const executionId = `exec_${i}_${nanoid()}`;
        const lease = store.acquire(taskId, executionId);
        results.push(lease !== null);
        resolve();
      });
    });

    await Promise.all(attempts);

    // Only one should succeed
    const successes = results.filter(r => r).length;
    expect(successes).toBe(1);
  });

  it('should track processing count correctly', () => {
    const store = new ExecutionLeaseStore();

    const task1 = `task_${nanoid()}`;
    const task2 = `task_${nanoid()}`;
    const task3 = `task_${nanoid()}`;

    store.acquire(task1, `exec_${nanoid()}`);
    store.acquire(task2, `exec_${nanoid()}`);
    store.acquire(task3, `exec_${nanoid()}`);

    const stats = store.getStats();

    expect(stats.active).toBe(3);

    // Release one
    const lease = store.get(task1);
    if (lease) store.release(task1, lease.executionId);

    expect(store.getStats().active).toBe(2);
  });
});

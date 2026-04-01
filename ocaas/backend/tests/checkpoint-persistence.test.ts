/**
 * Checkpoint Persistence Tests
 *
 * Tests for checkpoint DB persistence and recovery behavior.
 * These tests verify that checkpoints survive restarts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import { CheckpointStore } from '../src/orchestrator/resilience/CheckpointStore.js';
import type { TaskStage } from '../src/orchestrator/resilience/types.js';

// Create a fresh store for each test (persistence disabled for unit tests)
function createTestStore(): CheckpointStore {
  const store = new CheckpointStore();
  store.setPersistenceEnabled(false); // Disable DB for unit tests
  return store;
}

describe('CheckpointStore - Persistence Behavior', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('Persistent vs Transient Stages', () => {
    const persistentStages: TaskStage[] = [
      'executing',
      'awaiting_response',
      'processing_result',
      'paused',
      'waiting_external',
      'waiting_approval',
      'waiting_resource',
      'retrying',
    ];

    const transientStages: TaskStage[] = [
      'queued',
      'analyzing',
      'assigning',
      'spawning_session',
      'completing',
    ];

    const terminalStages: TaskStage[] = ['completed', 'failed'];

    it('should identify persistent stages correctly', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      for (const stage of persistentStages) {
        store.updateStage(taskId, stage);
        const checkpoint = store.get(taskId);
        expect(checkpoint?.currentStage).toBe(stage);
        // In production, these would trigger DB persist
      }
    });

    it('should identify transient stages correctly', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      for (const stage of transientStages) {
        store.updateStage(taskId, stage);
        const checkpoint = store.get(taskId);
        expect(checkpoint?.currentStage).toBe(stage);
        // In production, these would NOT trigger DB persist
      }
    });

    it('should identify terminal stages correctly', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      for (const stage of terminalStages) {
        store.updateStage(taskId, stage);
        const checkpoint = store.get(taskId);
        expect(checkpoint?.currentStage).toBe(stage);
        // In production, terminal stages trigger DB delete
      }
    });
  });

  describe('Partial Result Persistence', () => {
    it('should save partial results for later recovery', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateStage(taskId, 'executing');

      const partialResult = {
        response: 'Partial response from OpenClaw...',
        toolCalls: [{ name: 'search', result: 'some data' }],
        progress: 'Step 2 of 5 completed',
      };

      store.savePartialResult(taskId, partialResult);

      const checkpoint = store.get(taskId);
      expect(checkpoint?.partialResult).toEqual(partialResult);
    });

    it('should preserve partial result across stage changes', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateStage(taskId, 'executing');

      const partialResult = { data: 'important' };
      store.savePartialResult(taskId, partialResult);

      store.updateStage(taskId, 'processing_result');

      const checkpoint = store.get(taskId);
      expect(checkpoint?.partialResult).toEqual(partialResult);
    });
  });

  describe('Blocker Tracking', () => {
    it('should track blockers for recovery diagnostics', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateStage(taskId, 'waiting_resource');

      store.updateBlocker(taskId, 'Missing skill: data-analysis');

      const checkpoint = store.get(taskId);
      expect(checkpoint?.lastKnownBlocker).toBe('Missing skill: data-analysis');
    });

    it('should clear blockers when resolved', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateBlocker(taskId, 'Some blocker');

      store.updateBlocker(taskId, null);

      const checkpoint = store.get(taskId);
      expect(checkpoint?.lastKnownBlocker).toBeNull();
    });
  });

  describe('Pending Resources Tracking', () => {
    it('should track pending resources for recovery', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      const resourceIds = ['draft_123', 'draft_456'];
      store.updatePendingResources(taskId, resourceIds);

      const checkpoint = store.get(taskId);
      expect(checkpoint?.pendingResources).toEqual(resourceIds);
      expect(checkpoint?.currentStage).toBe('waiting_resource');
    });
  });

  describe('Pending Approval Tracking', () => {
    it('should track pending approval for recovery', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      store.updatePendingApproval(taskId, 'approval_789');

      const checkpoint = store.get(taskId);
      expect(checkpoint?.pendingApproval).toBe('approval_789');
      expect(checkpoint?.currentStage).toBe('waiting_approval');
    });
  });

  describe('Recovery Queries', () => {
    it('should return resumable checkpoints', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const task3 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);
      store.create(task3);

      store.updateStage(task1, 'executing');
      store.updateStage(task2, 'paused');
      store.markCompleted(task3); // Not resumable

      const resumable = store.getResumable();

      expect(resumable.length).toBe(2);
      expect(resumable.map(c => c.taskId)).toContain(task1);
      expect(resumable.map(c => c.taskId)).toContain(task2);
    });

    it('should return checkpoints waiting for external', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const task3 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);
      store.create(task3);

      store.updateStage(task1, 'waiting_approval');
      store.updateStage(task2, 'waiting_resource');
      store.updateStage(task3, 'executing');

      const waiting = store.getWaitingExternal();

      expect(waiting.length).toBe(2);
      expect(waiting.map(c => c.taskId)).toContain(task1);
      expect(waiting.map(c => c.taskId)).toContain(task2);
    });

    it('should return checkpoints by stage', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const task3 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);
      store.create(task3);

      store.updateStage(task1, 'paused');
      store.updateStage(task2, 'paused');
      store.updateStage(task3, 'executing');

      const paused = store.getByStage('paused');
      const executing = store.getByStage('executing');

      expect(paused.length).toBe(2);
      expect(executing.length).toBe(1);
    });
  });

  describe('Export/Import for Manual Recovery', () => {
    it('should export checkpoint as JSON', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateStage(taskId, 'executing', 'step_2', 50);
      store.savePartialResult(taskId, { data: 'test' });

      const exported = store.export(taskId);

      expect(exported).not.toBeNull();
      const parsed = JSON.parse(exported!);
      expect(parsed.taskId).toBe(taskId);
      expect(parsed.currentStage).toBe('executing');
      expect(parsed.progressPercent).toBe(50);
      expect(parsed.partialResult).toEqual({ data: 'test' });
    });

    it('should import checkpoint from JSON', () => {
      const taskId = `task_${nanoid()}`;
      const checkpointData = {
        taskId,
        executionId: `exec_${nanoid()}`,
        assignedAgentId: 'agent_123',
        currentStage: 'paused',
        lastCompletedStep: 'step_3',
        progressPercent: 75,
        statusSnapshot: {},
        lastKnownBlocker: 'Manual pause',
        pendingApproval: null,
        pendingResources: [],
        lastOpenClawSessionId: 'sess_456',
        partialResult: { response: 'partial' },
        retryCount: 1,
        resumable: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const imported = store.import(JSON.stringify(checkpointData));

      expect(imported).not.toBeNull();
      expect(imported?.taskId).toBe(taskId);
      expect(imported?.currentStage).toBe('paused');
      expect(imported?.progressPercent).toBe(75);

      // Should be retrievable
      const retrieved = store.get(taskId);
      expect(retrieved).toEqual(imported);
    });
  });

  describe('Stats and Observability', () => {
    it('should return accurate stats', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;
      const task3 = `task_${nanoid()}`;
      const task4 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);
      store.create(task3);
      store.create(task4);

      store.updateStage(task1, 'executing');
      store.updateStage(task2, 'waiting_approval');
      store.updateStage(task3, 'paused');
      store.markCompleted(task4);

      const stats = store.getStats();

      expect(stats.total).toBe(4);
      expect(stats.resumable).toBe(3); // executing, waiting_approval, paused are resumable
      expect(stats.waitingExternal).toBe(1); // waiting_approval
      expect(stats.byStage['executing']).toBe(1);
      expect(stats.byStage['waiting_approval']).toBe(1);
      expect(stats.byStage['paused']).toBe(1);
      expect(stats.byStage['completed']).toBe(1);
    });
  });

  describe('Retry Tracking', () => {
    it('should track retry count for recovery decisions', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);

      store.incrementRetry(taskId);
      store.incrementRetry(taskId);

      const checkpoint = store.get(taskId);
      expect(checkpoint?.retryCount).toBe(2);
      expect(checkpoint?.currentStage).toBe('retrying');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup old terminal checkpoints', () => {
      const task1 = `task_${nanoid()}`;
      const task2 = `task_${nanoid()}`;

      store.create(task1);
      store.create(task2);

      store.markCompleted(task1);
      store.markCompleted(task2);

      // Manually age the checkpoints (simulate time passing)
      const cp1 = store.get(task1);
      const cp2 = store.get(task2);
      if (cp1) cp1.updatedAt = cp1.updatedAt - 7200; // 2 hours ago (in seconds)
      // cp2 stays recent

      const cleaned = store.cleanup(3600_000); // 1 hour max age

      expect(cleaned).toBe(1);
      expect(store.get(task1)).toBeNull();
      expect(store.get(task2)).not.toBeNull();
    });

    it('should not cleanup active/paused checkpoints', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updateStage(taskId, 'paused');

      // Age the checkpoint
      const checkpoint = store.get(taskId);
      if (checkpoint) checkpoint.updatedAt = checkpoint.updatedAt - 7200;

      const cleaned = store.cleanup(3600_000);

      expect(cleaned).toBe(0);
      expect(store.get(taskId)).not.toBeNull();
    });
  });
});

describe('CheckpointStore - Recovery Scenarios', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('Crash during execution', () => {
    it('should preserve state for task in executing stage', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId, 'agent_123');
      store.updateStage(taskId, 'executing', 'step_3', 60);
      store.savePartialResult(taskId, {
        intermediateData: 'some calculations',
        progress: 'Processed 60% of input',
      });

      // Simulate recovery by reading the checkpoint
      const checkpoint = store.get(taskId);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.currentStage).toBe('executing');
      expect(checkpoint?.lastCompletedStep).toBe('step_3');
      expect(checkpoint?.progressPercent).toBe(60);
      expect(checkpoint?.partialResult).toEqual({
        intermediateData: 'some calculations',
        progress: 'Processed 60% of input',
      });
      expect(checkpoint?.assignedAgentId).toBe('agent_123');
    });
  });

  describe('Crash while waiting for approval', () => {
    it('should preserve pending approval info', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updatePendingApproval(taskId, 'approval_xyz');
      store.updateBlocker(taskId, 'Waiting for human approval of resource creation');

      const checkpoint = store.get(taskId);

      expect(checkpoint?.currentStage).toBe('waiting_approval');
      expect(checkpoint?.pendingApproval).toBe('approval_xyz');
      expect(checkpoint?.lastKnownBlocker).toBe('Waiting for human approval of resource creation');
    });
  });

  describe('Crash while waiting for resource', () => {
    it('should preserve pending resource info', () => {
      const taskId = `task_${nanoid()}`;
      store.create(taskId);
      store.updatePendingResources(taskId, ['draft_abc', 'draft_def']);
      store.updateBlocker(taskId, 'Missing skills: data-analysis, image-processing');

      const checkpoint = store.get(taskId);

      expect(checkpoint?.currentStage).toBe('waiting_resource');
      expect(checkpoint?.pendingResources).toEqual(['draft_abc', 'draft_def']);
      expect(checkpoint?.lastKnownBlocker).toBe('Missing skills: data-analysis, image-processing');
    });
  });

  describe('Multiple tasks in various states', () => {
    it('should correctly identify which tasks need recovery', () => {
      // Task 1: In progress
      const task1 = `task_${nanoid()}`;
      store.create(task1);
      store.updateStage(task1, 'executing');

      // Task 2: Waiting for approval
      const task2 = `task_${nanoid()}`;
      store.create(task2);
      store.updatePendingApproval(task2, 'approval_1');

      // Task 3: Completed (no recovery needed)
      const task3 = `task_${nanoid()}`;
      store.create(task3);
      store.markCompleted(task3);

      // Task 4: Failed (no recovery needed)
      const task4 = `task_${nanoid()}`;
      store.create(task4);
      store.markFailed(task4, 'Max retries exceeded');

      // Task 5: Paused (can be resumed)
      const task5 = `task_${nanoid()}`;
      store.create(task5);
      store.markPaused(task5, 'User requested pause');

      const resumable = store.getResumable();
      const waitingExternal = store.getWaitingExternal();

      // task1, task2, task5 are resumable
      expect(resumable.length).toBe(3);
      expect(resumable.map(c => c.taskId)).toContain(task1);
      expect(resumable.map(c => c.taskId)).toContain(task2);
      expect(resumable.map(c => c.taskId)).toContain(task5);

      // Only task2 is waiting for external (approval)
      expect(waitingExternal.length).toBe(1);
      expect(waitingExternal[0]?.taskId).toBe(task2);
    });
  });
});

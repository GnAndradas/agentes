/**
 * TaskStateManager Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TaskExecutionState,
  TaskStep,
  ExecutionPhase,
  isValidPhaseTransition,
  toSnapshot,
} from './types.js';

describe('TaskStateManager Types', () => {
  describe('isValidPhaseTransition', () => {
    it('should allow valid transitions', () => {
      expect(isValidPhaseTransition('initializing', 'planning')).toBe(true);
      expect(isValidPhaseTransition('planning', 'executing')).toBe(true);
      expect(isValidPhaseTransition('executing', 'paused')).toBe(true);
      expect(isValidPhaseTransition('paused', 'executing')).toBe(true);
      expect(isValidPhaseTransition('executing', 'completing')).toBe(true);
      expect(isValidPhaseTransition('completing', 'completed')).toBe(true);
    });

    it('should reject invalid transitions', () => {
      expect(isValidPhaseTransition('completed', 'executing')).toBe(false);
      expect(isValidPhaseTransition('failed', 'executing')).toBe(false);
      expect(isValidPhaseTransition('cancelled', 'executing')).toBe(false);
      expect(isValidPhaseTransition('paused', 'completed')).toBe(false);
    });
  });

  describe('toSnapshot', () => {
    it('should create snapshot from state', () => {
      const state: TaskExecutionState = {
        taskId: 'task-1',
        phase: 'executing',
        steps: [
          { id: 'step-1', name: 'First', status: 'completed', order: 1 },
          { id: 'step-2', name: 'Second', status: 'running', order: 2 },
          { id: 'step-3', name: 'Third', status: 'pending', order: 3 },
        ],
        currentStepId: 'step-2',
        checkpoints: [
          { id: 'ckpt-1', label: 'Test', createdAt: Date.now(), currentStepId: 'step-1', completedStepIds: [], auto: true },
        ],
        lastMeaningfulUpdateAt: Date.now(),
        progressPct: 33,
        warnings: [],
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        toolCallsCount: 0,
        toolExecutions: [],
      };

      const snapshot = toSnapshot(state);

      expect(snapshot.taskId).toBe('task-1');
      expect(snapshot.phase).toBe('executing');
      expect(snapshot.currentStepId).toBe('step-2');
      expect(snapshot.currentStepName).toBe('Second');
      expect(snapshot.completedStepsCount).toBe(1);
      expect(snapshot.totalStepsCount).toBe(3);
      expect(snapshot.pendingStepsCount).toBe(1);
      expect(snapshot.checkpointsCount).toBe(1);
      expect(snapshot.progressPct).toBe(33);
    });

    it('should handle empty state', () => {
      const state: TaskExecutionState = {
        taskId: 'task-2',
        phase: 'initializing',
        steps: [],
        checkpoints: [],
        lastMeaningfulUpdateAt: Date.now(),
        progressPct: 0,
        warnings: [],
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        toolCallsCount: 0,
        toolExecutions: [],
      };

      const snapshot = toSnapshot(state);

      expect(snapshot.completedStepsCount).toBe(0);
      expect(snapshot.totalStepsCount).toBe(0);
      expect(snapshot.checkpointsCount).toBe(0);
    });
  });
});

describe('TaskStep', () => {
  it('should track step lifecycle', () => {
    const step: TaskStep = {
      id: 'step-1',
      name: 'Test Step',
      status: 'pending',
      order: 1,
    };

    // Start
    step.status = 'running';
    step.startedAt = Date.now();
    expect(step.status).toBe('running');

    // Complete
    step.status = 'completed';
    step.completedAt = Date.now();
    step.output = { result: 'success' };
    expect(step.status).toBe('completed');
    expect(step.output).toEqual({ result: 'success' });
  });

  it('should track failure with retry', () => {
    const step: TaskStep = {
      id: 'step-1',
      name: 'Failing Step',
      status: 'running',
      order: 1,
      retryCount: 0,
    };

    // Fail
    step.status = 'failed';
    step.error = 'Something went wrong';
    step.retryCount = (step.retryCount || 0) + 1;

    expect(step.status).toBe('failed');
    expect(step.error).toBe('Something went wrong');
    expect(step.retryCount).toBe(1);
  });
});

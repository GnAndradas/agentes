import { describe, it, expect, beforeEach } from 'vitest';
import { QueueManager } from '../src/orchestrator/QueueManager.js';
import { DecisionEngine } from '../src/orchestrator/DecisionEngine.js';
import type { QueuedTask } from '../src/orchestrator/types.js';

describe('QueueManager', () => {
  let queue: QueueManager;

  beforeEach(() => {
    queue = new QueueManager();
  });

  describe('enqueue/dequeue', () => {
    it('should enqueue and dequeue tasks', () => {
      const task: QueuedTask = {
        taskId: 'task-1',
        type: 'test',
        priority: 5,
        payload: {},
        enqueuedAt: Date.now(),
      };

      queue.enqueue(task);
      expect(queue.size()).toBe(1);

      const dequeued = queue.dequeue();
      expect(dequeued).toEqual(task);
      expect(queue.size()).toBe(0);
    });

    it('should dequeue highest priority first', () => {
      queue.enqueue({ taskId: 'low', type: 'test', priority: 1, payload: {}, enqueuedAt: Date.now() });
      queue.enqueue({ taskId: 'high', type: 'test', priority: 10, payload: {}, enqueuedAt: Date.now() });
      queue.enqueue({ taskId: 'medium', type: 'test', priority: 5, payload: {}, enqueuedAt: Date.now() });

      expect(queue.dequeue()?.taskId).toBe('high');
      expect(queue.dequeue()?.taskId).toBe('medium');
      expect(queue.dequeue()?.taskId).toBe('low');
    });

    it('should return undefined when empty', () => {
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should peek without removing', () => {
      const task: QueuedTask = {
        taskId: 'task-1',
        type: 'test',
        priority: 5,
        payload: {},
        enqueuedAt: Date.now(),
      };

      queue.enqueue(task);
      expect(queue.peek()).toEqual(task);
      expect(queue.size()).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove specific task', () => {
      queue.enqueue({ taskId: 'task-1', type: 'test', priority: 5, payload: {}, enqueuedAt: Date.now() });
      queue.enqueue({ taskId: 'task-2', type: 'test', priority: 5, payload: {}, enqueuedAt: Date.now() });

      const removed = queue.remove('task-1');
      expect(removed).toBe(true);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.taskId).toBe('task-2');
    });

    it('should return false if task not found', () => {
      expect(queue.remove('nonexistent')).toBe(false);
    });
  });
});

describe('DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('getCapabilitiesForTaskType', () => {
    it('should return relevant capabilities for code_review', () => {
      const caps = engine.getCapabilitiesForTaskType('code_review');
      expect(caps).toContain('code_analysis');
      expect(caps).toContain('review');
    });

    it('should return empty array for unknown type', () => {
      const caps = engine.getCapabilitiesForTaskType('unknown_type');
      expect(caps).toEqual([]);
    });
  });

  describe('scoreAgentForTask', () => {
    it('should score higher for matching capabilities', () => {
      const agent = {
        id: 'agent-1',
        type: 'specialist' as const,
        status: 'active' as const,
        capabilities: ['code_analysis', 'review'],
        activeTasks: 0,
      };

      const score = engine.scoreAgentForTask(agent, 'code_review', 5);
      expect(score).toBeGreaterThan(0);
    });

    it('should score zero for inactive agents', () => {
      const agent = {
        id: 'agent-1',
        type: 'general' as const,
        status: 'inactive' as const,
        capabilities: ['code_analysis'],
        activeTasks: 0,
      };

      const score = engine.scoreAgentForTask(agent, 'code_review', 5);
      expect(score).toBe(0);
    });

    it('should prefer agents with fewer active tasks', () => {
      const busyAgent = {
        id: 'agent-1',
        type: 'general' as const,
        status: 'active' as const,
        capabilities: ['code_analysis'],
        activeTasks: 5,
      };

      const freeAgent = {
        id: 'agent-2',
        type: 'general' as const,
        status: 'active' as const,
        capabilities: ['code_analysis'],
        activeTasks: 0,
      };

      const busyScore = engine.scoreAgentForTask(busyAgent, 'code_review', 5);
      const freeScore = engine.scoreAgentForTask(freeAgent, 'code_review', 5);

      expect(freeScore).toBeGreaterThan(busyScore);
    });
  });
});

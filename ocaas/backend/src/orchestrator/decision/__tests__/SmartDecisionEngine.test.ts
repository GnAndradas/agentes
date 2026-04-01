/**
 * Tests for Smart Decision Engine
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SmartDecisionEngine,
  getSmartDecisionEngine,
  resetSmartDecisionEngine,
} from '../SmartDecisionEngine.js';
import type { TaskDTO, AgentDTO } from '../../../types/domain.js';

// Mock dependencies
vi.mock('../../../utils/logger.js', () => ({
  orchestratorLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock('../../../services/index.js', () => ({
  getServices: () => ({
    eventService: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock('../../../integrations/openclaw/index.js', () => ({
  getOpenClawAdapter: () => ({
    isConnected: vi.fn().mockReturnValue(false),
    generate: vi.fn().mockResolvedValue({ success: false }),
  }),
}));

describe('SmartDecisionEngine', () => {
  let engine: SmartDecisionEngine;

  beforeEach(() => {
    resetSmartDecisionEngine();
    engine = new SmartDecisionEngine({
      enableCache: true,
      enableHeuristics: true,
      enableLLM: false, // Disable LLM for most tests
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create engine with default config', () => {
      const defaultEngine = new SmartDecisionEngine();
      expect(defaultEngine).toBeDefined();
    });

    it('should accept partial config', () => {
      const customEngine = new SmartDecisionEngine({
        enableCache: false,
        cacheMaxSize: 100,
      });
      expect(customEngine).toBeDefined();
    });
  });

  describe('decide', () => {
    const createTask = (overrides: Partial<TaskDTO> = {}): TaskDTO => ({
      id: 'task-1',
      title: 'Test Task',
      description: 'A test task',
      type: 'coding',
      priority: 2,
      status: 'pending',
      agentId: undefined,
      parentTaskId: undefined,
      batchId: undefined,
      retryCount: 0,
      maxRetries: 3,
      input: {},
      output: undefined,
      metadata: {},
      sequenceOrder: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });

    const createAgent = (overrides: Partial<AgentDTO> = {}): AgentDTO => ({
      id: 'agent-1',
      name: 'Test Agent',
      type: 'general',  // Use valid AgentType: general | specialist | orchestrator
      status: 'active',
      capabilities: ['coding', 'testing'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    });

    describe('heuristic decisions', () => {
      it('should escalate when no agents are available', async () => {
        const task = createTask();
        const decision = await engine.decide(task, []);

        expect(decision.decisionType).toBe('escalate');
        expect(decision.method).toBe('heuristic');
        expect(decision.heuristicsAttempted).toBe(true);
        expect(decision.requiresEscalation).toBe(true);
      });

      it('should assign to single active agent', async () => {
        const task = createTask();
        const agent = createAgent();

        const decision = await engine.decide(task, [agent]);

        expect(decision.decisionType).toBe('assign');
        expect(decision.targetAgent).toBe('agent-1');
        expect(decision.method).toBe('heuristic');
      });

      it('should assign by exact type match', async () => {
        const task = createTask({ type: 'testing' });
        const agents = [
          createAgent({ id: 'agent-1', type: 'general', capabilities: ['coding'] }),
          createAgent({ id: 'agent-2', type: 'specialist', capabilities: ['testing'] }),
        ];

        const decision = await engine.decide(task, agents);

        expect(decision.decisionType).toBe('assign');
        // With 2 agents, direct_type_match rule will find agent-2 with matching capability
        expect(decision.targetAgent).toBe('agent-2');
      });

      it('should escalate critical task without specialist', async () => {
        const task = createTask({ priority: 4, type: 'security' });
        const agent = createAgent({ type: 'general', capabilities: ['generic'] });

        const decision = await engine.decide(task, [agent]);

        expect(decision.decisionType).toBe('escalate');
        expect(decision.requiresEscalation).toBe(true);
      });

      it('should escalate when retry limit reached', async () => {
        // retryLimitRule has priority 7, which is lower than many other rules
        // To ensure it triggers, we need a scenario where earlier rules don't apply:
        // - directTypeMatch: task type != any agent capability (use 'custom-type')
        // - singleAgent: multiple agents
        // - specialistMatch: no specialist with matching caps
        // - noAgents: has agents
        // - criticalTask: priority < 4
        // - subtaskRule: no parent
        const task = createTask({ type: 'custom-unique-type', retryCount: 5, priority: 2 });
        const agents = [
          createAgent({ id: 'agent-1', type: 'general', capabilities: ['unrelated-cap-1'] }),
          createAgent({ id: 'agent-2', type: 'general', capabilities: ['unrelated-cap-2'] }),
        ];

        const decision = await engine.decide(task, agents);

        expect(decision.decisionType).toBe('escalate');
        expect(decision.reasoning.toLowerCase()).toContain('retr');
      });
    });

    describe('caching', () => {
      it('should cache decisions', async () => {
        const task = createTask();
        const agent = createAgent();

        // First decision
        const decision1 = await engine.decide(task, [agent]);
        expect(decision1.fromCache).toBe(false);

        // Second decision should be cached
        const decision2 = await engine.decide(task, [agent]);
        expect(decision2.fromCache).toBe(true);
        expect(decision2.method).toBe('cached');
      });

      it('should not cache low confidence decisions', async () => {
        const task = createTask({ type: 'unknown-type' });
        const agents: AgentDTO[] = [];

        // This will produce an escalation with low confidence
        await engine.decide(task, agents);

        const stats = engine.getCacheStats();
        expect(stats.size).toBe(0);
      });

      it('should invalidate cache on request', async () => {
        const task = createTask();
        const agent = createAgent();

        await engine.decide(task, [agent]);
        expect(engine.getCacheStats().size).toBe(1);

        engine.invalidateCache(task, [agent]);
        expect(engine.getCacheStats().size).toBe(0);
      });

      it('should clear all cache', async () => {
        const task1 = createTask({ id: 'task-1' });
        const task2 = createTask({ id: 'task-2', title: 'Different Task' });
        const agent = createAgent();

        await engine.decide(task1, [agent]);
        await engine.decide(task2, [agent]);

        engine.clearCache();
        expect(engine.getCacheStats().size).toBe(0);
      });
    });

    describe('structured output', () => {
      it('should return all required fields', async () => {
        const task = createTask();
        const agent = createAgent();

        const decision = await engine.decide(task, [agent]);

        expect(decision.id).toBeDefined();
        expect(decision.taskId).toBe('task-1');
        expect(decision.decidedAt).toBeGreaterThan(0);
        expect(decision.decisionType).toBeDefined();
        expect(decision.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(decision.confidenceScore).toBeLessThanOrEqual(1);
        expect(decision.confidenceLevel).toMatch(/^(high|medium|low)$/);
        expect(decision.reasoning).toBeDefined();
        expect(decision.method).toBeDefined();
        expect(decision.heuristicsAttempted).toBeDefined();
        expect(decision.suggestedActions).toBeInstanceOf(Array);
        expect(decision.processingTimeMs).toBeGreaterThanOrEqual(0);
        expect(typeof decision.fromCache).toBe('boolean');
      });

      it('should include agent scores when assigning', async () => {
        const task = createTask();
        const agents = [
          createAgent({ id: 'agent-1' }),
          createAgent({ id: 'agent-2', type: 'specialist' }),
        ];

        const decision = await engine.decide(task, agents);

        if (decision.decisionType === 'assign') {
          expect(decision.agentScores).toBeDefined();
          expect(decision.agentScores!.length).toBeGreaterThan(0);
        }
      });

      it('should set requiresEscalation correctly', async () => {
        const task = createTask();
        const agent = createAgent();

        const decision = await engine.decide(task, [agent]);

        expect(decision.requiresEscalation).toBe(
          decision.decisionType === 'escalate' || decision.confidenceScore < 0.4
        );
      });
    });

    describe('fallback behavior', () => {
      it('should use fallback when all methods fail', async () => {
        // Create engine with everything disabled
        const fallbackEngine = new SmartDecisionEngine({
          enableCache: false,
          enableHeuristics: false,
          enableLLM: false,
        });

        const task = createTask();
        const agent = createAgent();

        const decision = await fallbackEngine.decide(task, [agent]);

        expect(decision.method).toBe('fallback');
        expect(decision.confidenceScore).toBeLessThan(0.5);
      });

      it('should handle errors gracefully', async () => {
        // This test verifies error handling in decide method
        const task = createTask();

        // Even with no agents and potential errors, should return valid decision
        const decision = await engine.decide(task, []);

        expect(decision).toBeDefined();
        expect(decision.decisionType).toBeDefined();
      });
    });

    describe('metrics', () => {
      it('should track decision metrics', async () => {
        const task = createTask();
        const agent = createAgent();

        await engine.decide(task, [agent]);
        await engine.decide(task, [agent]); // Cached

        const metrics = engine.getMetrics();

        expect(metrics.totalDecisions).toBe(2);
        expect(metrics.heuristicDecisions).toBe(1);
        expect(metrics.cachedDecisions).toBe(1);
        expect(metrics.averageConfidence).toBeGreaterThan(0);
        expect(metrics.averageProcessingTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should track decision types', async () => {
        const task = createTask();
        const agent = createAgent();

        await engine.decide(task, [agent]);

        const metrics = engine.getMetrics();
        expect(metrics.byDecisionType.assign).toBeGreaterThan(0);
      });

      it('should reset metrics', async () => {
        const task = createTask();
        const agent = createAgent();

        await engine.decide(task, [agent]);
        engine.resetMetrics();

        const metrics = engine.getMetrics();
        expect(metrics.totalDecisions).toBe(0);
      });
    });

    describe('configuration', () => {
      it('should update configuration', () => {
        engine.updateConfig({ enableCache: false });

        // Config update doesn't throw
        expect(true).toBe(true);
      });

      it('should respect enableHeuristics config', async () => {
        const noHeuristicsEngine = new SmartDecisionEngine({
          enableHeuristics: false,
          enableLLM: false,
        });

        const task = createTask();
        const agent = createAgent();

        const decision = await noHeuristicsEngine.decide(task, [agent]);

        // Should fall back since heuristics disabled and LLM unavailable
        expect(decision.method).toBe('fallback');
      });
    });

    describe('consistency', () => {
      it('should produce same decision for same input (via cache)', async () => {
        const task = createTask();
        const agent = createAgent();

        const decision1 = await engine.decide(task, [agent]);
        const decision2 = await engine.decide(task, [agent]);

        expect(decision1.decisionType).toBe(decision2.decisionType);
        expect(decision1.targetAgent).toBe(decision2.targetAgent);
      });

      it('should produce consistent decisions without cache', async () => {
        const noCacheEngine = new SmartDecisionEngine({
          enableCache: false,
          enableHeuristics: true,
          enableLLM: false,
        });

        const task = createTask();
        const agent = createAgent();

        const decision1 = await noCacheEngine.decide(task, [agent]);
        const decision2 = await noCacheEngine.decide(task, [agent]);

        // Heuristic decisions should be deterministic
        expect(decision1.decisionType).toBe(decision2.decisionType);
        expect(decision1.targetAgent).toBe(decision2.targetAgent);
      });
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getSmartDecisionEngine();
      const instance2 = getSmartDecisionEngine();

      expect(instance1).toBe(instance2);
    });

    it('should reset instance', () => {
      const instance1 = getSmartDecisionEngine();
      resetSmartDecisionEngine();
      const instance2 = getSmartDecisionEngine();

      expect(instance1).not.toBe(instance2);
    });
  });
});

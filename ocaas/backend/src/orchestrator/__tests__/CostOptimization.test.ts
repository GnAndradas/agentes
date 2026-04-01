/**
 * Cost Optimization Tests
 *
 * Tests for operation modes, cost tracking, and LLM optimization:
 * - Operation mode switching (economy, balanced, max_quality)
 * - Cost tracking and metrics
 * - LLM avoidance strategies
 * - Cache TTL by mode
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetSmartDecisionEngine,
  getSmartDecisionEngine,
  CostTracker,
  getCostTracker,
  resetCostTracker,
  estimateTokenCost,
  getEstimatedTokensForTier,
} from '../decision/index.js';
import {
  OPERATION_MODE,
  OPERATION_MODE_CONFIGS,
  PROMPT_TIER,
  TOKEN_COSTS,
} from '../decision/types.js';
import type { TaskDTO, AgentDTO } from '../../types/domain.js';

// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  orchestratorLogger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../services/index.js', () => ({
  getServices: () => ({
    agentService: {
      getActive: vi.fn().mockResolvedValue([
        {
          id: 'agent-coding',
          name: 'Coding Agent',
          type: 'specialist',
          status: 'active',
          capabilities: ['coding', 'testing'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]),
      list: vi.fn().mockResolvedValue([]),
    },
    eventService: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock('../../integrations/openclaw/index.js', () => ({
  getOpenClawAdapter: () => ({
    isConnected: vi.fn().mockReturnValue(false),
    generate: vi.fn().mockResolvedValue({ success: false }),
  }),
}));

vi.mock('../../config/autonomy.js', () => ({
  getAutonomyConfig: () => ({
    level: 'supervised',
    humanTimeout: 300000,
    fallbackBehavior: 'pause',
  }),
}));

// ============================================================================
// CostTracker Unit Tests
// ============================================================================

describe('CostTracker', () => {
  beforeEach(() => {
    resetCostTracker();
  });

  describe('estimateTokenCost', () => {
    it('should calculate cost correctly', () => {
      // $3/M input, $15/M output
      const cost = estimateTokenCost(1000, 1000);
      // 1000/1000 * 0.003 + 1000/1000 * 0.015 = 0.003 + 0.015 = 0.018
      expect(cost).toBeCloseTo(0.018, 4);
    });

    it('should handle zero tokens', () => {
      const cost = estimateTokenCost(0, 0);
      expect(cost).toBe(0);
    });
  });

  describe('getEstimatedTokensForTier', () => {
    it('should return correct estimates for SHORT tier', () => {
      const tokens = getEstimatedTokensForTier(PROMPT_TIER.SHORT);
      expect(tokens.input).toBe(TOKEN_COSTS.inputTokens[PROMPT_TIER.SHORT]);
      expect(tokens.output).toBe(TOKEN_COSTS.outputTokens[PROMPT_TIER.SHORT]);
    });

    it('should return correct estimates for MEDIUM tier', () => {
      const tokens = getEstimatedTokensForTier(PROMPT_TIER.MEDIUM);
      expect(tokens.input).toBe(TOKEN_COSTS.inputTokens[PROMPT_TIER.MEDIUM]);
      expect(tokens.output).toBe(TOKEN_COSTS.outputTokens[PROMPT_TIER.MEDIUM]);
    });

    it('should return correct estimates for DEEP tier', () => {
      const tokens = getEstimatedTokensForTier(PROMPT_TIER.DEEP);
      expect(tokens.input).toBe(TOKEN_COSTS.inputTokens[PROMPT_TIER.DEEP]);
      expect(tokens.output).toBe(TOKEN_COSTS.outputTokens[PROMPT_TIER.DEEP]);
    });
  });

  describe('CostTracker class', () => {
    let tracker: CostTracker;

    beforeEach(() => {
      tracker = new CostTracker(OPERATION_MODE.BALANCED);
    });

    it('should initialize with zero metrics', () => {
      const metrics = tracker.getCostMetrics();
      expect(metrics.totalInputTokens).toBe(0);
      expect(metrics.totalOutputTokens).toBe(0);
      expect(metrics.estimatedCostUSD).toBe(0);
    });

    it('should record LLM usage', () => {
      const usage = tracker.recordLLMUsage(PROMPT_TIER.MEDIUM);

      expect(usage.inputTokens).toBe(TOKEN_COSTS.inputTokens[PROMPT_TIER.MEDIUM]);
      expect(usage.outputTokens).toBe(TOKEN_COSTS.outputTokens[PROMPT_TIER.MEDIUM]);
      expect(usage.cost).toBeGreaterThan(0);

      const metrics = tracker.getCostMetrics();
      expect(metrics.totalInputTokens).toBe(usage.inputTokens);
      expect(metrics.byTier.medium.count).toBe(1);
    });

    it('should record actual tokens when provided', () => {
      const usage = tracker.recordLLMUsage(PROMPT_TIER.MEDIUM, 100, 50);

      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
    });

    it('should track savings from heuristics', () => {
      tracker.recordSavings(PROMPT_TIER.MEDIUM, 'heuristic');

      const metrics = tracker.getCostMetrics();
      expect(metrics.tokensSaved).toBeGreaterThan(0);
      expect(metrics.costSavedUSD).toBeGreaterThan(0);
    });

    it('should track cache hits and misses', () => {
      tracker.recordCacheHit('assign');
      tracker.recordCacheHit('assign');
      tracker.recordCacheMiss('subdivide');

      const cacheMetrics = tracker.getCacheMetrics();
      expect(cacheMetrics.hitCount).toBe(2);
      expect(cacheMetrics.missCount).toBe(1);
      expect(cacheMetrics.hitRate).toBeCloseTo(2 / 3, 2);
      expect(cacheMetrics.byDecisionType.assign?.hits).toBe(2);
      expect(cacheMetrics.byDecisionType.subdivide?.misses).toBe(1);
    });

    it('should change operation mode', () => {
      expect(tracker.getOperationMode()).toBe(OPERATION_MODE.BALANCED);

      tracker.setOperationMode(OPERATION_MODE.ECONOMY);
      expect(tracker.getOperationMode()).toBe(OPERATION_MODE.ECONOMY);
    });

    it('should reset metrics', () => {
      tracker.recordLLMUsage(PROMPT_TIER.MEDIUM);
      tracker.recordCacheHit('assign');

      tracker.reset();

      const metrics = tracker.getCostMetrics();
      expect(metrics.totalInputTokens).toBe(0);

      const cacheMetrics = tracker.getCacheMetrics();
      expect(cacheMetrics.hitCount).toBe(0);
    });

    it('should provide summary', () => {
      tracker.recordLLMUsage(PROMPT_TIER.SHORT);
      tracker.recordSavings(PROMPT_TIER.MEDIUM, 'heuristic');

      const summary = tracker.getSummary();
      expect(summary.mode).toBe(OPERATION_MODE.BALANCED);
      expect(summary.totalCost).toMatch(/^\$\d+\.\d+$/);
      expect(summary.totalSaved).toMatch(/^\$\d+\.\d+$/);
      expect(summary.llmAvoidanceRate).toMatch(/^\d+\.\d+%$/);
    });
  });

  describe('getCostTracker singleton', () => {
    it('should return same instance', () => {
      const tracker1 = getCostTracker();
      const tracker2 = getCostTracker();
      expect(tracker1).toBe(tracker2);
    });

    it('should update mode on existing instance', () => {
      const tracker1 = getCostTracker(OPERATION_MODE.BALANCED);
      expect(tracker1.getOperationMode()).toBe(OPERATION_MODE.BALANCED);

      const tracker2 = getCostTracker(OPERATION_MODE.ECONOMY);
      expect(tracker2).toBe(tracker1);
      expect(tracker2.getOperationMode()).toBe(OPERATION_MODE.ECONOMY);
    });

    it('should reset instance', () => {
      const tracker1 = getCostTracker();
      resetCostTracker();
      const tracker2 = getCostTracker();
      expect(tracker1).not.toBe(tracker2);
    });
  });
});

// ============================================================================
// Operation Mode Tests
// ============================================================================

describe('Operation Mode Configuration', () => {
  describe('ECONOMY mode', () => {
    const config = OPERATION_MODE_CONFIGS[OPERATION_MODE.ECONOMY];

    it('should have lower heuristic threshold', () => {
      expect(config.heuristicConfidenceThreshold).toBe(0.5);
    });

    it('should limit to SHORT tier', () => {
      expect(config.maxLLMTier).toBe(PROMPT_TIER.SHORT);
    });

    it('should use compact prompts', () => {
      expect(config.useCompactPrompts).toBe(true);
    });

    it('should double cache TTL', () => {
      expect(config.cacheConfig.ttlMultiplier).toBe(2.0);
    });

    it('should skip LLM on retry', () => {
      expect(config.skipLLMOnRetry).toBe(true);
    });

    it('should force heuristics for known types', () => {
      expect(config.forceHeuristicsForKnownTypes).toBe(true);
    });
  });

  describe('BALANCED mode', () => {
    const config = OPERATION_MODE_CONFIGS[OPERATION_MODE.BALANCED];

    it('should have standard heuristic threshold', () => {
      expect(config.heuristicConfidenceThreshold).toBe(0.7);
    });

    it('should allow MEDIUM tier', () => {
      expect(config.maxLLMTier).toBe(PROMPT_TIER.MEDIUM);
    });

    it('should not use compact prompts', () => {
      expect(config.useCompactPrompts).toBe(false);
    });

    it('should use standard cache TTL', () => {
      expect(config.cacheConfig.ttlMultiplier).toBe(1.0);
    });
  });

  describe('MAX_QUALITY mode', () => {
    const config = OPERATION_MODE_CONFIGS[OPERATION_MODE.MAX_QUALITY];

    it('should have high heuristic threshold', () => {
      expect(config.heuristicConfidenceThreshold).toBe(0.85);
    });

    it('should allow DEEP tier', () => {
      expect(config.maxLLMTier).toBe(PROMPT_TIER.DEEP);
    });

    it('should use shorter cache TTL', () => {
      expect(config.cacheConfig.ttlMultiplier).toBe(0.5);
    });

    it('should not skip LLM on retry', () => {
      expect(config.skipLLMOnRetry).toBe(false);
    });

    it('should require higher confidence to cache', () => {
      expect(config.cacheConfig.minConfidenceToCache).toBe(0.7);
    });
  });
});

// ============================================================================
// SmartDecisionEngine Operation Mode Tests
// ============================================================================

describe('SmartDecisionEngine Operation Modes', () => {
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

  const mockAgents: AgentDTO[] = [
    {
      id: 'agent-coding',
      name: 'Coding Agent',
      type: 'specialist',
      status: 'active',
      capabilities: ['coding', 'testing'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    resetSmartDecisionEngine();
    resetCostTracker();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setOperationMode', () => {
    it('should change mode at runtime', () => {
      const engine = getSmartDecisionEngine();
      expect(engine.getOperationMode()).toBe(OPERATION_MODE.BALANCED);

      engine.setOperationMode(OPERATION_MODE.ECONOMY);
      expect(engine.getOperationMode()).toBe(OPERATION_MODE.ECONOMY);

      engine.setOperationMode(OPERATION_MODE.MAX_QUALITY);
      expect(engine.getOperationMode()).toBe(OPERATION_MODE.MAX_QUALITY);
    });

    it('should update cost tracker mode', () => {
      const engine = getSmartDecisionEngine();
      engine.setOperationMode(OPERATION_MODE.ECONOMY);

      const tracker = getCostTracker();
      expect(tracker.getOperationMode()).toBe(OPERATION_MODE.ECONOMY);
    });
  });

  describe('getOperationModeConfig', () => {
    it('should return current mode config', () => {
      const engine = getSmartDecisionEngine();
      engine.setOperationMode(OPERATION_MODE.ECONOMY);

      const config = engine.getOperationModeConfig();
      expect(config.mode).toBe(OPERATION_MODE.ECONOMY);
      expect(config.useCompactPrompts).toBe(true);
    });
  });

  describe('getExtendedMetrics', () => {
    it('should include cost metrics', async () => {
      const engine = getSmartDecisionEngine();
      const task = createTask();

      await engine.decide(task, mockAgents);

      const metrics = engine.getExtendedMetrics();
      expect(metrics.operationMode).toBeDefined();
      expect(metrics.cost).toBeDefined();
      expect(metrics.cache).toBeDefined();
      expect(metrics.totalDecisions).toBe(1);
    });

    it('should track heuristic savings', async () => {
      const engine = getSmartDecisionEngine();
      const task = createTask({ type: 'coding' });

      await engine.decide(task, mockAgents);

      const metrics = engine.getExtendedMetrics();
      expect(metrics.cost.tokensSaved).toBeGreaterThan(0);
      expect(metrics.cost.costSavedUSD).toBeGreaterThan(0);
    });
  });

  describe('getCostSummary', () => {
    it('should return formatted summary', async () => {
      const engine = getSmartDecisionEngine();
      const task = createTask();

      await engine.decide(task, mockAgents);

      const summary = engine.getCostSummary();
      expect(summary.mode).toBeDefined();
      expect(summary.totalCost).toBeDefined();
      expect(summary.totalSaved).toBeDefined();
      expect(summary.decisions.heuristic).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ECONOMY mode behavior', () => {
    it('should accept lower confidence heuristic results', async () => {
      const engine = getSmartDecisionEngine({
        operationMode: OPERATION_MODE.ECONOMY,
      });

      const task = createTask({ type: 'coding' });
      const decision = await engine.decide(task, mockAgents);

      // Should use heuristics even with lower confidence
      expect(decision.method).toBe('heuristic');
      expect(decision.decisionType).toBe('assign');
    });

    it('should skip LLM on retry', async () => {
      const engine = getSmartDecisionEngine({
        operationMode: OPERATION_MODE.ECONOMY,
      });

      const task = createTask({
        type: 'unknown-type',
        retryCount: 1,
      });

      const decision = await engine.decide(task, mockAgents);

      // Should fallback instead of trying LLM
      expect(['heuristic', 'fallback']).toContain(decision.method);
    });
  });

  describe('updateConfig with mode', () => {
    it('should change mode via config update', () => {
      const engine = getSmartDecisionEngine();

      engine.updateConfig({ operationMode: OPERATION_MODE.ECONOMY });

      expect(engine.getOperationMode()).toBe(OPERATION_MODE.ECONOMY);
    });
  });

  describe('initialization with mode', () => {
    it('should accept operationMode in constructor', () => {
      const engine = getSmartDecisionEngine({
        operationMode: OPERATION_MODE.MAX_QUALITY,
      });

      expect(engine.getOperationMode()).toBe(OPERATION_MODE.MAX_QUALITY);
    });
  });
});

// ============================================================================
// LLM Avoidance Tests
// ============================================================================

describe('LLM Avoidance Strategies', () => {
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

  const codingAgent: AgentDTO = {
    id: 'agent-coding',
    name: 'Coding Agent',
    type: 'specialist',
    status: 'active',
    capabilities: ['coding', 'testing'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    resetSmartDecisionEngine();
    resetCostTracker();
  });

  it('should skip LLM when exact capability match exists', async () => {
    const engine = getSmartDecisionEngine({
      operationMode: OPERATION_MODE.ECONOMY,
    });

    const task = createTask({ type: 'coding' });
    const decision = await engine.decide(task, [codingAgent]);

    expect(decision.method).toBe('heuristic');
    expect(decision.targetAgent).toBe('agent-coding');
  });

  it('should track avoidance rate', async () => {
    const engine = getSmartDecisionEngine({
      operationMode: OPERATION_MODE.ECONOMY,
    });

    // Multiple decisions using heuristics
    await engine.decide(createTask({ id: 'task-1', type: 'coding' }), [codingAgent]);
    await engine.decide(createTask({ id: 'task-2', type: 'testing' }), [codingAgent]);
    await engine.decide(createTask({ id: 'task-3', type: 'coding' }), [codingAgent]);

    const metrics = engine.getExtendedMetrics();
    // All decisions should be heuristic -> high avoidance rate
    expect(metrics.cost.llmAvoidanceRate).toBeGreaterThan(0);
  });

  it('should cache decisions and track savings', async () => {
    const engine = getSmartDecisionEngine({
      operationMode: OPERATION_MODE.BALANCED,
    });

    const task = createTask({ type: 'coding' });

    // First decision
    const decision1 = await engine.decide(task, [codingAgent]);
    expect(decision1.fromCache).toBe(false);

    // Second decision (should hit cache)
    const decision2 = await engine.decide(task, [codingAgent]);
    expect(decision2.fromCache).toBe(true);

    const metrics = engine.getExtendedMetrics();
    expect(metrics.cache.hitCount).toBe(1);
    expect(metrics.cache.hitRate).toBeGreaterThan(0);
  });
});

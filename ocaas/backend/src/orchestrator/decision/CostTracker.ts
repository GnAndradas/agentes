/**
 * Cost Tracker for Decision Engine
 *
 * Tracks token usage, estimated costs, and savings from heuristics/caching.
 */

import { orchestratorLogger } from '../../utils/logger.js';
import type {
  PromptTier,
  CostMetrics,
  CacheMetrics,
  DecisionType,
  OperationMode,
} from './types.js';
import { TOKEN_COSTS, PROMPT_TIER, OPERATION_MODE } from './types.js';

const logger = orchestratorLogger.child({ component: 'CostTracker' });

/**
 * Estimates token cost in USD
 */
export function estimateTokenCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * TOKEN_COSTS.costPer1KTokens.input;
  const outputCost = (outputTokens / 1000) * TOKEN_COSTS.costPer1KTokens.output;
  return inputCost + outputCost;
}

/**
 * Gets estimated tokens for a tier
 */
export function getEstimatedTokensForTier(tier: PromptTier): { input: number; output: number } {
  return {
    input: TOKEN_COSTS.inputTokens[tier],
    output: TOKEN_COSTS.outputTokens[tier],
  };
}

/**
 * Cost Tracker class - tracks all cost-related metrics
 */
export class CostTracker {
  private metrics: CostMetrics;
  private cacheMetrics: CacheMetrics;
  private operationMode: OperationMode;

  constructor(operationMode: OperationMode = OPERATION_MODE.BALANCED) {
    this.operationMode = operationMode;
    this.metrics = this.initCostMetrics();
    this.cacheMetrics = this.initCacheMetrics();
  }

  private initCostMetrics(): CostMetrics {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUSD: 0,
      byTier: {
        short: { count: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        medium: { count: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        deep: { count: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      },
      tokensSaved: 0,
      costSavedUSD: 0,
      llmAvoidanceRate: 0,
    };
  }

  private initCacheMetrics(): CacheMetrics {
    return {
      size: 0,
      maxSize: 500,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      evictions: 0,
      byDecisionType: {},
    };
  }

  /**
   * Record LLM usage
   */
  recordLLMUsage(tier: PromptTier, actualInputTokens?: number, actualOutputTokens?: number): {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  } {
    const estimated = getEstimatedTokensForTier(tier);
    const inputTokens = actualInputTokens ?? estimated.input;
    const outputTokens = actualOutputTokens ?? estimated.output;
    const cost = estimateTokenCost(inputTokens, outputTokens);

    // Update totals
    this.metrics.totalInputTokens += inputTokens;
    this.metrics.totalOutputTokens += outputTokens;
    this.metrics.estimatedCostUSD += cost;

    // Update by tier
    const tierKey = tier as 'short' | 'medium' | 'deep';
    this.metrics.byTier[tierKey].count++;
    this.metrics.byTier[tierKey].inputTokens += inputTokens;
    this.metrics.byTier[tierKey].outputTokens += outputTokens;
    this.metrics.byTier[tierKey].cost += cost;

    this.updateLLMAvoidanceRate();

    logger.debug({
      tier,
      inputTokens,
      outputTokens,
      cost: cost.toFixed(6),
      totalCost: this.metrics.estimatedCostUSD.toFixed(6),
    }, 'LLM usage recorded');

    return { inputTokens, outputTokens, cost };
  }

  /**
   * Record tokens saved by not using LLM
   */
  recordSavings(savedTier: PromptTier, reason: 'heuristic' | 'cache'): void {
    const estimated = getEstimatedTokensForTier(savedTier);
    const tokensSaved = estimated.input + estimated.output;
    const costSaved = estimateTokenCost(estimated.input, estimated.output);

    this.metrics.tokensSaved += tokensSaved;
    this.metrics.costSavedUSD += costSaved;

    this.updateLLMAvoidanceRate();

    logger.debug({
      reason,
      savedTier,
      tokensSaved,
      costSaved: costSaved.toFixed(6),
      totalSaved: this.metrics.costSavedUSD.toFixed(6),
    }, 'Tokens saved');
  }

  /**
   * Record cache hit
   */
  recordCacheHit(decisionType: DecisionType): void {
    this.cacheMetrics.hitCount++;
    this.updateCacheHitRate();

    if (!this.cacheMetrics.byDecisionType[decisionType]) {
      this.cacheMetrics.byDecisionType[decisionType] = { hits: 0, misses: 0 };
    }
    this.cacheMetrics.byDecisionType[decisionType]!.hits++;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(decisionType: DecisionType): void {
    this.cacheMetrics.missCount++;
    this.updateCacheHitRate();

    if (!this.cacheMetrics.byDecisionType[decisionType]) {
      this.cacheMetrics.byDecisionType[decisionType] = { hits: 0, misses: 0 };
    }
    this.cacheMetrics.byDecisionType[decisionType]!.misses++;
  }

  /**
   * Record cache eviction
   */
  recordCacheEviction(): void {
    this.cacheMetrics.evictions++;
  }

  /**
   * Update cache size
   */
  updateCacheSize(size: number, maxSize: number): void {
    this.cacheMetrics.size = size;
    this.cacheMetrics.maxSize = maxSize;
  }

  /**
   * Update operation mode
   */
  setOperationMode(mode: OperationMode): void {
    this.operationMode = mode;
    logger.info({ mode }, 'Operation mode changed');
  }

  /**
   * Get current operation mode
   */
  getOperationMode(): OperationMode {
    return this.operationMode;
  }

  /**
   * Get cost metrics
   */
  getCostMetrics(): CostMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache metrics
   */
  getCacheMetrics(): CacheMetrics {
    return { ...this.cacheMetrics };
  }

  /**
   * Get formatted summary for logging
   */
  getSummary(): {
    mode: OperationMode;
    totalCost: string;
    totalSaved: string;
    llmAvoidanceRate: string;
    cacheHitRate: string;
    llmCalls: number;
    decisions: { heuristic: number; cached: number; llm: number };
  } {
    const totalLLMCalls =
      this.metrics.byTier.short.count +
      this.metrics.byTier.medium.count +
      this.metrics.byTier.deep.count;

    return {
      mode: this.operationMode,
      totalCost: `$${this.metrics.estimatedCostUSD.toFixed(4)}`,
      totalSaved: `$${this.metrics.costSavedUSD.toFixed(4)}`,
      llmAvoidanceRate: `${(this.metrics.llmAvoidanceRate * 100).toFixed(1)}%`,
      cacheHitRate: `${(this.cacheMetrics.hitRate * 100).toFixed(1)}%`,
      llmCalls: totalLLMCalls,
      decisions: {
        heuristic: 0, // Will be updated by engine
        cached: this.cacheMetrics.hitCount,
        llm: totalLLMCalls,
      },
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = this.initCostMetrics();
    this.cacheMetrics = this.initCacheMetrics();
    logger.info('Cost tracker reset');
  }

  private updateCacheHitRate(): void {
    const total = this.cacheMetrics.hitCount + this.cacheMetrics.missCount;
    this.cacheMetrics.hitRate = total > 0 ? this.cacheMetrics.hitCount / total : 0;
  }

  private updateLLMAvoidanceRate(): void {
    const totalLLMCalls =
      this.metrics.byTier.short.count +
      this.metrics.byTier.medium.count +
      this.metrics.byTier.deep.count;

    // Estimate total decisions (LLM + savings recorded)
    // Each saving represents a decision that avoided LLM
    const estimatedHeuristicDecisions = Math.round(
      this.metrics.tokensSaved / TOKEN_COSTS.inputTokens[PROMPT_TIER.MEDIUM]
    );
    const totalDecisions = totalLLMCalls + estimatedHeuristicDecisions + this.cacheMetrics.hitCount;

    this.metrics.llmAvoidanceRate = totalDecisions > 0
      ? (estimatedHeuristicDecisions + this.cacheMetrics.hitCount) / totalDecisions
      : 0;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let costTrackerInstance: CostTracker | null = null;

export function getCostTracker(operationMode?: OperationMode): CostTracker {
  if (!costTrackerInstance) {
    costTrackerInstance = new CostTracker(operationMode);
  } else if (operationMode && operationMode !== costTrackerInstance.getOperationMode()) {
    costTrackerInstance.setOperationMode(operationMode);
  }
  return costTrackerInstance;
}

export function resetCostTracker(): void {
  costTrackerInstance = null;
}

/**
 * Smart Decision Engine
 *
 * Orchestrates the decision pipeline:
 * 1. Check cache for existing decision
 * 2. Evaluate heuristic rules
 * 3. If heuristics fail, use appropriate LLM tier
 * 4. Cache result and return structured decision
 */

import { randomUUID } from 'crypto';
import { orchestratorLogger } from '../../utils/logger.js';
import { getOpenClawAdapter } from '../../integrations/openclaw/index.js';
import { getServices } from '../../services/index.js';
import { EVENT_TYPE } from '../../config/constants.js';
import { config } from '../../config/index.js';
import type { TaskDTO, AgentDTO } from '../../types/domain.js';
import type {
  StructuredDecision,
  DecisionType,
  DecisionMethod,
  ConfidenceLevel,
  DecisionAction,
  AgentScore,
  SubtaskPlan,
  DecisionCacheEntry,
  DecisionMetrics,
  HeuristicContext,
  TaskClassification,
  PromptTier,
  OperationMode,
  OperationModeConfig,
  ExtendedDecisionMetrics,
  DecisionWithCost,
} from './types.js';
import {
  PROMPT_TIER,
  CONFIDENCE_THRESHOLDS,
  DECISION_CACHE_CONFIG,
  OPERATION_MODE,
  OPERATION_MODE_CONFIGS,
  DEFAULT_CACHE_CONFIG,
} from './types.js';
import { evaluateHeuristics, matchCapabilities } from './HeuristicRules.js';
import {
  getPromptBundle,
  getCompactPromptBundle,
  parseResponse,
  determineTier,
  type DecisionContext,
  type AgentContext,
  type TaskContext,
  type ShortResponse,
  type MediumResponse,
  type DeepResponse,
} from './PromptTiers.js';
import {
  CostTracker,
  getCostTracker,
  getEstimatedTokensForTier,
} from './CostTracker.js';
import {
  validateDecision,
  needsValidation,
  determineAction,
  type ValidationResult,
} from './DecisionValidator.js';
import { inferCapabilities } from './HeuristicRules.js';
import type { DecisionTraceability } from '../../types/contracts.js';
import {
  getGlobalBudgetManager,
  type BudgetCheckResult,
  type BudgetTraceability,
} from '../../budget/index.js';
import {
  getDecisionTraceStore,
  buildDecisionTrace,
  type DecisionTraceBuilder,
} from './DecisionTrace.js';

const logger = orchestratorLogger.child({ component: 'SmartDecisionEngine' });

// =============================================================================
// DECISION CACHE
// =============================================================================

class DecisionCache {
  private cache: Map<string, DecisionCacheEntry> = new Map();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 500, defaultTTL = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate cache key from task properties
   */
  generateKey(task: TaskDTO, agents: AgentDTO[]): string {
    // Key based on task type, capabilities implied by title/description, and available agents
    const agentSignature = agents
      .filter(a => a.status === 'active')
      .map(a => `${a.type}:${(a.capabilities || []).sort().join(',')}`)
      .sort()
      .join('|');

    return `${task.type}:${task.priority}:${agentSignature}:${task.title.substring(0, 50)}`;
  }

  /**
   * Get cached decision if valid
   */
  get(key: string): StructuredDecision | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Update hit count
    entry.hitCount++;
    entry.lastAccessedAt = now;

    logger.debug({ key, hitCount: entry.hitCount }, 'Cache hit');
    return entry.decision;
  }

  /**
   * Store decision in cache
   */
  set(key: string, decision: StructuredDecision, ttl?: number): void {
    // Don't cache low confidence or escalation decisions
    if (decision.confidenceScore < 0.5 || decision.requiresEscalation) {
      logger.debug({ key, reason: 'low_confidence_or_escalation' }, 'Skipping cache');
      return;
    }

    // Don't cache critical tasks (priority 4)
    if (decision.confidenceLevel === 'low') {
      logger.debug({ key, reason: 'low_confidence_level' }, 'Skipping cache');
      return;
    }

    const now = Date.now();
    const entry: DecisionCacheEntry = {
      key,
      decision,
      createdAt: now,
      expiresAt: now + (ttl || this.defaultTTL),
      hitCount: 0,
      lastAccessedAt: now,
    };

    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
    logger.debug({ key, ttl: ttl || this.defaultTTL }, 'Cached decision');
  }

  /**
   * Invalidate specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
    }
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// =============================================================================
// SMART DECISION ENGINE
// =============================================================================

export interface SmartDecisionEngineConfig {
  enableCache: boolean;
  cacheMaxSize: number;
  cacheTTL: number;
  enableHeuristics: boolean;
  enableLLM: boolean;
  forceDeepAnalysis: boolean;
  minConfidenceForHeuristic: number;
  /** Operation mode for cost/quality tradeoff */
  operationMode: OperationMode;
}

const DEFAULT_CONFIG: SmartDecisionEngineConfig = {
  enableCache: true,
  cacheMaxSize: 500,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
  enableHeuristics: true,
  enableLLM: true,
  forceDeepAnalysis: false,
  minConfidenceForHeuristic: 0.7,
  operationMode: OPERATION_MODE.BALANCED,
};

export class SmartDecisionEngine {
  private config: SmartDecisionEngineConfig;
  private cache: DecisionCache;
  private metrics: DecisionMetrics;
  private costTracker: CostTracker;
  private modeConfig: OperationModeConfig;

  constructor(config: Partial<SmartDecisionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new DecisionCache(this.config.cacheMaxSize, this.config.cacheTTL);
    this.metrics = this.initMetrics();
    this.costTracker = getCostTracker(this.config.operationMode);
    this.modeConfig = OPERATION_MODE_CONFIGS[this.config.operationMode];
  }

  private initMetrics(): DecisionMetrics {
    return {
      totalDecisions: 0,
      heuristicDecisions: 0,
      cachedDecisions: 0,
      llmDecisions: { short: 0, medium: 0, deep: 0 },
      fallbackDecisions: 0,
      averageConfidence: 0,
      averageProcessingTimeMs: 0,
      byDecisionType: {
        assign: 0,
        subdivide: 0,
        create_resource: 0,
        escalate: 0,
        wait: 0,
        reject: 0,
      },
    };
  }

  /**
   * Main decision method - orchestrates the decision pipeline
   */
  async decide(task: TaskDTO, agents: AgentDTO[]): Promise<StructuredDecision> {
    const startTime = Date.now();
    const decisionId = randomUUID();

    logger.info({
      taskId: task.id,
      decisionId,
      operationMode: this.modeConfig.mode,
      dispatchMode: config.dispatcher.mode,
    }, 'Starting decision process');

    const { eventService } = getServices();

    // DISPATCH MODE CHECK: If 'default_agent' mode, use configured default agent
    if (config.dispatcher.mode === 'default_agent') {
      const defaultAgent = this.resolveDefaultAgent(agents);
      if (defaultAgent) {
        logger.info({
          taskId: task.id,
          decisionId,
          defaultAgentId: defaultAgent.id,
          dispatchMode: 'default_agent',
        }, 'Using default agent (dispatch mode)');

        const decision = this.buildDecision(
          decisionId,
          task.id,
          'assign',
          defaultAgent.id,
          1.0, // High confidence - explicit config
          `Task assigned to default agent "${defaultAgent.name}" via TASK_DISPATCH_MODE=default_agent`,
          'heuristic',
          startTime,
          {
            heuristicsAttempted: false,
            agentScores: [{ agentId: defaultAgent.id, agentName: defaultAgent.name, totalScore: 1.0, capabilityMatch: 1.0 }],
            suggestedActions: [],
          }
        );

        this.updateMetrics(decision);
        await this.emitDecisionComplete(decision, task);
        return decision;
      }
    }

    // Emit decision started event
    await eventService.emit({
      type: EVENT_TYPE.TASK_DECISION_STARTED,
      category: 'orchestrator',
      severity: 'info',
      message: `Starting decision for task "${task.title}"`,
      resourceType: 'task',
      resourceId: task.id,
      data: { decisionId, operationMode: this.modeConfig.mode },
    });

    try {
      let decision: StructuredDecision;
      const cacheKey = this.cache.generateKey(task, agents);

      // Stage 1: Check cache (respecting operation mode)
      if (this.config.enableCache && this.modeConfig.cacheConfig.enabled) {
        const cached = this.cache.get(cacheKey);
        if (cached) {
          decision = this.createCachedDecision(decisionId, task.id, cached, cacheKey, startTime);

          // Track cache hit and savings
          this.costTracker.recordCacheHit(decision.decisionType);
          this.costTracker.recordSavings(PROMPT_TIER.MEDIUM, 'cache');

          this.updateMetrics(decision);
          await this.emitDecisionComplete(decision, task);

          // Stage 5: VALIDATION (BLOQUE 5) - validate cached decisions too
          return this.validateAndFinalize(decision, task, agents, startTime);
        }
        // Track cache miss for metrics
        // (decisionType unknown yet, will update later)
      }

      // Determine effective confidence threshold based on mode
      const effectiveThreshold = this.modeConfig.heuristicConfidenceThreshold;

      // Check if we should skip LLM based on operation mode rules
      const shouldSkipLLM = this.shouldSkipLLMForTask(task, agents);

      // Stage 2: Evaluate heuristics
      if (this.config.enableHeuristics) {
        const heuristicResult = await this.tryHeuristics(task, agents);
        if (heuristicResult) {
          // Check if heuristic confidence meets threshold for this mode
          const meetsThreshold = heuristicResult.confidence >= effectiveThreshold;

          if (meetsThreshold || shouldSkipLLM) {
            decision = this.buildDecision(
              decisionId,
              task.id,
              heuristicResult.decisionType,
              heuristicResult.targetAgent,
              heuristicResult.confidence,
              heuristicResult.reasoning,
              'heuristic',
              startTime,
              {
                heuristicsAttempted: true,
                agentScores: heuristicResult.agentScores,
                suggestedActions: heuristicResult.actions || [],
              }
            );

            // Track savings from using heuristics instead of LLM
            this.costTracker.recordSavings(PROMPT_TIER.MEDIUM, 'heuristic');

            // Cache if confidence meets mode's cache threshold
            if (
              this.config.enableCache &&
              this.modeConfig.cacheConfig.enabled &&
              decision.confidenceScore >= this.modeConfig.cacheConfig.minConfidenceToCache
            ) {
              const ttl = this.getCacheTTLForDecision(decision);
              this.cache.set(cacheKey, decision, ttl);
              decision.cacheKey = cacheKey;
              this.costTracker.updateCacheSize(this.cache.getStats().size, this.cache.getStats().maxSize);
            }

            this.updateMetrics(decision);
            this.costTracker.recordCacheMiss(decision.decisionType);
            await this.emitDecisionComplete(decision, task);

            // Stage 5: VALIDATION (BLOQUE 5)
            return this.validateAndFinalize(decision, task, agents, startTime);
          }
          // Heuristic didn't meet threshold - fall through to LLM
        }
      }

      // Stage 3: Use LLM with appropriate tier (if enabled and not skipped)
      if (this.config.enableLLM && this.modeConfig.enableLLM && !shouldSkipLLM) {
        const llmResult = await this.tryLLM(task, agents);
        if (llmResult) {
          decision = llmResult;
          decision.id = decisionId;
          decision.processingTimeMs = Date.now() - startTime;

          // Cache LLM decisions if meets mode's cache threshold
          if (
            this.config.enableCache &&
            this.modeConfig.cacheConfig.enabled &&
            decision.confidenceScore >= this.modeConfig.cacheConfig.minConfidenceToCache
          ) {
            const ttl = this.getCacheTTLForDecision(decision);
            this.cache.set(cacheKey, decision, ttl);
            decision.cacheKey = cacheKey;
            this.costTracker.updateCacheSize(this.cache.getStats().size, this.cache.getStats().maxSize);
          }

          this.updateMetrics(decision);
          this.costTracker.recordCacheMiss(decision.decisionType);
          await this.emitDecisionComplete(decision, task);

          // Stage 5: VALIDATION (BLOQUE 5)
          return this.validateAndFinalize(decision, task, agents, startTime);
        }
      }

      // Stage 4: Fallback decision
      decision = this.createFallbackDecision(decisionId, task, agents, startTime);
      this.costTracker.recordSavings(PROMPT_TIER.SHORT, 'heuristic');
      this.updateMetrics(decision);
      this.costTracker.recordCacheMiss(decision.decisionType);
      await this.emitDecisionComplete(decision, task);

      // Stage 5: VALIDATION (BLOQUE 5 - Hybrid Decision Engine)
      return this.validateAndFinalize(decision, task, agents, startTime);

    } catch (err) {
      logger.error({ err, taskId: task.id, decisionId }, 'Decision process failed');

      // Return safe fallback on error
      const fallback = this.createFallbackDecision(decisionId, task, agents, startTime, err);
      this.updateMetrics(fallback);
      await this.emitDecisionComplete(fallback, task);

      // Still validate fallback
      return this.validateAndFinalize(fallback, task, agents, startTime);
    }
  }

  /**
   * Determine if LLM should be skipped based on operation mode rules
   */
  private shouldSkipLLMForTask(task: TaskDTO, agents: AgentDTO[]): boolean {
    // Skip on retry if configured
    if (this.modeConfig.skipLLMOnRetry && task.retryCount && task.retryCount > 0) {
      logger.debug({ taskId: task.id, retryCount: task.retryCount }, 'Skipping LLM due to retry');
      return true;
    }

    // Skip if exact match found (and configured)
    if (this.modeConfig.skipLLMOnExactMatch) {
      const activeAgents = agents.filter(a => a.status === 'active');
      const exactMatch = activeAgents.find(a =>
        a.capabilities?.includes(task.type) ||
        a.type === task.type
      );
      if (exactMatch) {
        logger.debug({
          taskId: task.id,
          agentId: exactMatch.id,
        }, 'Skipping LLM due to exact agent match');
        return true;
      }
    }

    // Force heuristics for known types if configured
    if (this.modeConfig.forceHeuristicsForKnownTypes) {
      const knownTypes = ['coding', 'testing', 'documentation', 'analysis', 'research'];
      if (knownTypes.includes(task.type)) {
        logger.debug({ taskId: task.id, type: task.type }, 'Skipping LLM for known task type');
        return true;
      }
    }

    return false;
  }

  /**
   * Get cache TTL based on decision type and operation mode
   */
  private getCacheTTLForDecision(decision: StructuredDecision): number {
    const baseTTL = DEFAULT_CACHE_CONFIG.ttlByType[decision.decisionType]
      ?? DEFAULT_CACHE_CONFIG.defaultTtlMs;
    return baseTTL * this.modeConfig.cacheConfig.ttlMultiplier;
  }

  /**
   * Try heuristic rules for quick decision
   */
  private async tryHeuristics(
    task: TaskDTO,
    agents: AgentDTO[]
  ): Promise<{
    decisionType: DecisionType;
    targetAgent?: string;
    confidence: number;
    reasoning: string;
    agentScores?: AgentScore[];
    actions?: DecisionAction[];
  } | null> {
    const activeAgents = agents.filter(a => a.status === 'active');

    const context: HeuristicContext = {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        parentTaskId: task.parentTaskId,
        retryCount: task.retryCount,
        input: task.input,
        metadata: task.metadata,
      },
      agents: activeAgents.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        capabilities: a.capabilities || [],
        currentLoad: 0, // Would need actual load data
        successRate: 1, // Would need actual metrics
      })),
      recentDecisions: [], // Could be populated from history
    };

    const result = evaluateHeuristics(context);

    if (result.success && result.result) {
      logger.info({
        taskId: task.id,
        ruleId: result.ruleId,
        rulesEvaluated: result.rulesEvaluated.length,
        decisionType: result.result.decisionType,
        confidence: result.result.confidence,
      }, 'Heuristic decision made');

      // Calculate agent scores if assigning
      let agentScores: AgentScore[] | undefined;
      if (result.result.decisionType === 'assign' && result.result.targetAgent) {
        agentScores = this.calculateAgentScores(task, activeAgents);
      }

      return {
        decisionType: result.result.decisionType!,
        targetAgent: result.result.targetAgent,
        confidence: result.result.confidence,
        reasoning: result.result.reasoning,
        agentScores,
        actions: result.result.actions,
      };
    }

    logger.debug({
      taskId: task.id,
      rulesEvaluated: result.rulesEvaluated,
    }, 'Heuristics did not produce decision');

    return null;
  }

  /**
   * Try LLM with appropriate tier
   *
   * BUDGET INTEGRATION: Checks budget before LLM call.
   * May block, warn, or degrade tier based on budget status.
   */
  private async tryLLM(task: TaskDTO, agents: AgentDTO[]): Promise<StructuredDecision | null> {
    const adapter = getOpenClawAdapter();
    const budgetManager = getGlobalBudgetManager();

    if (!adapter.isConnected()) {
      logger.warn({ taskId: task.id }, 'Gateway not connected, skipping LLM');
      return null;
    }

    const activeAgents = agents.filter(a => a.status === 'active');

    // Build context for tier determination
    const decisionContext: DecisionContext = {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        input: task.input,
        metadata: task.metadata,
        parentTaskId: task.parentTaskId,
        retryCount: task.retryCount,
      },
      agents: activeAgents.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        capabilities: a.capabilities || [],
      })),
    };

    // Determine which tier to use (respecting operation mode limits)
    let tier = this.config.forceDeepAnalysis
      ? PROMPT_TIER.DEEP
      : determineTier(decisionContext);

    // Enforce max tier from operation mode
    tier = this.enforceMaxTier(tier);

    // BUDGET CHECK: Validate before LLM call
    const budgetCheck = budgetManager.checkBudget({
      task_id: task.id,
      agent_id: task.agentId || undefined,
      tier: tier as 'short' | 'medium' | 'deep',
      operation: 'decision',
    });

    // Handle budget decision
    if (budgetCheck.decision === 'block') {
      logger.warn({
        taskId: task.id,
        tier,
        budget_decision: 'block',
        reason: budgetCheck.reason,
        current_cost: budgetCheck.current_cost_usd,
        limit: budgetCheck.limit_usd,
      }, 'BUDGET BLOCK: LLM call blocked due to budget limit');
      return null; // Skip LLM, will fall back to heuristic
    }

    if (budgetCheck.decision === 'degrade' && budgetCheck.degraded_tier) {
      const originalTier = tier;
      tier = budgetCheck.degraded_tier as PromptTier;
      logger.info({
        taskId: task.id,
        original_tier: originalTier,
        degraded_tier: tier,
        budget_decision: 'degrade',
        reason: budgetCheck.reason,
      }, 'BUDGET DEGRADE: Tier degraded due to budget');
    }

    if (budgetCheck.decision === 'warn') {
      logger.warn({
        taskId: task.id,
        tier,
        budget_decision: 'warn',
        reason: budgetCheck.reason,
        usage_pct: budgetCheck.usage_pct,
      }, 'BUDGET WARNING: Approaching budget limit');
    }

    logger.info({
      taskId: task.id,
      tier,
      operationMode: this.modeConfig.mode,
      useCompactPrompts: this.modeConfig.useCompactPrompts,
    }, 'Using LLM tier');

    // Use compact prompts in economy mode
    const bundle = this.modeConfig.useCompactPrompts
      ? getCompactPromptBundle(decisionContext)
      : getPromptBundle(tier, decisionContext);

    try {
      const result = await adapter.generate({
        systemPrompt: bundle.systemPrompt,
        userPrompt: bundle.userPrompt,
        maxTokens: bundle.maxTokens,
      });

      if (!result.success || !result.content) {
        logger.warn({ taskId: task.id, error: result.error }, 'LLM generation failed');
        return null;
      }

      // Track LLM usage with actual tokens if available
      const costInfo = this.costTracker.recordLLMUsage(
        bundle.tier,
        result.usage?.inputTokens,
        result.usage?.outputTokens
      );

      // BUDGET: Record actual cost in GlobalBudgetManager
      const inputTokens = result.usage?.inputTokens || costInfo.inputTokens;
      const outputTokens = result.usage?.outputTokens || costInfo.outputTokens;
      budgetManager.recordCost({
        task_id: task.id,
        agent_id: task.agentId || undefined,
        operation: 'decision',
        tier: tier as 'short' | 'medium' | 'deep',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: budgetCheck.estimated_cost_usd,
        budget_decision: budgetCheck.decision,
      });

      const parsed = parseResponse(tier, result.content);

      if (!parsed) {
        logger.warn({ taskId: task.id, tier }, 'Failed to parse LLM response');
        return null;
      }

      // Convert parsed response to StructuredDecision with cost info
      const decision = this.convertLLMResponse(task.id, tier, parsed, activeAgents);

      // Attach cost info to decision (if implementing DecisionWithCost)
      (decision as DecisionWithCost).costInfo = {
        inputTokens: costInfo.inputTokens,
        outputTokens: costInfo.outputTokens,
        estimatedCostUSD: costInfo.cost,
        savedByHeuristic: false,
        savedByCache: false,
        // BUDGET: Add budget traceability
        budgetDecision: budgetCheck.decision,
        budgetScope: budgetCheck.scope,
      };

      return decision;

    } catch (err) {
      logger.error({ err, taskId: task.id, tier }, 'LLM request failed');
      return null;
    }
  }

  /**
   * Enforce max tier based on operation mode
   */
  private enforceMaxTier(requestedTier: PromptTier): PromptTier {
    const maxTier = this.modeConfig.maxLLMTier;

    const tierOrder: Record<PromptTier, number> = {
      [PROMPT_TIER.SHORT]: 1,
      [PROMPT_TIER.MEDIUM]: 2,
      [PROMPT_TIER.DEEP]: 3,
    };

    if (tierOrder[requestedTier] > tierOrder[maxTier]) {
      logger.debug({
        requestedTier,
        maxTier,
        operationMode: this.modeConfig.mode,
      }, 'Downgrading LLM tier due to operation mode');
      return maxTier;
    }

    return requestedTier;
  }

  /**
   * Convert LLM response to StructuredDecision based on tier
   */
  private convertLLMResponse(
    taskId: string,
    tier: PromptTier,
    response: ShortResponse | MediumResponse | DeepResponse,
    agents: AgentDTO[]
  ): StructuredDecision {
    const startTime = Date.now();

    if (tier === PROMPT_TIER.SHORT) {
      const r = response as ShortResponse;
      // Short tier is classification - use it to inform decision
      const decisionType: DecisionType = r.mayNeedDecomposition
        ? 'subdivide'
        : r.mayNeedHumanReview
        ? 'escalate'
        : 'assign';

      // Try to find matching agent for assignment
      let targetAgent: string | undefined;
      if (decisionType === 'assign') {
        const match = this.findBestAgentByCapabilities(r.requiredCapabilities, agents);
        targetAgent = match?.id;
      }

      return this.buildDecision(
        randomUUID(),
        taskId,
        decisionType,
        targetAgent,
        r.confidence,
        `Classification: ${r.category} (${r.complexity} complexity)`,
        'llm_classify',
        startTime,
        {
          llmTier: 'short',
          heuristicsAttempted: true,
          heuristicFailReason: 'escalated_to_llm',
          missingCapabilities: targetAgent ? undefined : r.requiredCapabilities,
        }
      );
    }

    if (tier === PROMPT_TIER.MEDIUM) {
      const r = response as MediumResponse;
      return this.buildDecision(
        randomUUID(),
        taskId,
        r.decisionType,
        r.suggestedAgent || undefined,
        r.confidence,
        r.reasoning,
        'llm_decide',
        startTime,
        {
          llmTier: 'medium',
          heuristicsAttempted: true,
          heuristicFailReason: 'escalated_to_llm',
          missingCapabilities: r.suggestedAgent ? undefined : r.requiredCapabilities,
        }
      );
    }

    // Deep tier
    const r = response as DeepResponse;
    const decisionType: DecisionType = r.canBeSubdivided && r.suggestedSubtasks?.length
      ? 'subdivide'
      : r.requiresHumanReview
      ? 'escalate'
      : 'assign';

    // Find agent if assigning
    let targetAgent: string | undefined;
    if (decisionType === 'assign') {
      const match = this.findBestAgentByCapabilities(r.requiredCapabilities, agents);
      targetAgent = match?.id;
    }

    // Build subtask plans if subdividing
    let subtasks: SubtaskPlan[] | undefined;
    if (r.suggestedSubtasks?.length) {
      subtasks = r.suggestedSubtasks.map(s => ({
        title: s.title,
        description: s.description,
        type: s.type,
        requiredCapabilities: s.requiredCapabilities || [],
        order: s.order,
        dependsOn: s.dependsOnPrevious ? [s.order - 1] : [],
        estimatedComplexity: s.estimatedComplexity || 'medium',
      }));
    }

    return this.buildDecision(
      randomUUID(),
      taskId,
      decisionType,
      targetAgent,
      r.confidence,
      `${r.intent}${r.complexityReason ? ` (${r.complexityReason})` : ''}`,
      'llm_plan',
      startTime,
      {
        llmTier: 'deep',
        heuristicsAttempted: true,
        heuristicFailReason: 'escalated_to_llm',
        subtasks,
        missingCapabilities: targetAgent ? undefined : r.requiredCapabilities,
      }
    );
  }

  /**
   * Find best agent by capability match
   *
   * PROMPT 18 FIX: If no capability match, return fallback agent
   * (general > orchestrator > first available) to prevent stuck tasks.
   */
  private findBestAgentByCapabilities(
    requiredCapabilities: string[],
    agents: AgentDTO[]
  ): AgentDTO | null {
    let bestAgent: AgentDTO | null = null;
    let bestScore = 0;

    for (const agent of agents) {
      const score = matchCapabilities(requiredCapabilities, agent.capabilities || []);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    // PROMPT 18: If we found a capability match, return it
    if (bestScore > 0 && bestAgent) {
      return bestAgent;
    }

    // PROMPT 18: No capability match - return fallback agent if any exist
    // This prevents tasks from getting stuck when no perfect match exists
    if (agents.length > 0) {
      // Prefer general agent, then orchestrator, then first available
      const general = agents.find(a => a.type === 'general');
      if (general) return general;

      const orchestrator = agents.find(a => a.type === 'orchestrator');
      if (orchestrator) return orchestrator;

      // Return first available agent
      return agents[0]!;
    }

    return null;
  }

  /**
   * Resolve the default agent based on config.dispatcher settings.
   *
   * Priority:
   * 1. config.dispatcher.defaultAgentId (if set and exists)
   * 2. Agent with name 'default-general-agent' (bootstrap default)
   * 3. First 'general' type agent
   * 4. First available agent
   */
  private resolveDefaultAgent(agents: AgentDTO[]): AgentDTO | null {
    if (agents.length === 0) return null;

    // 1. Check configured default agent ID
    if (config.dispatcher.defaultAgentId) {
      const configuredAgent = agents.find(a => a.id === config.dispatcher.defaultAgentId);
      if (configuredAgent) {
        logger.debug({ agentId: configuredAgent.id }, 'Using configured default agent');
        return configuredAgent;
      }
      logger.warn({
        configuredId: config.dispatcher.defaultAgentId,
        availableAgents: agents.map(a => a.id),
      }, 'Configured default agent not found, falling back');
    }

    // 2. Check for bootstrap default agent
    const bootstrapDefault = agents.find(a => a.name === 'default-general-agent');
    if (bootstrapDefault) {
      logger.debug({ agentId: bootstrapDefault.id }, 'Using bootstrap default agent');
      return bootstrapDefault;
    }

    // 3. First general agent
    const generalAgent = agents.find(a => a.type === 'general');
    if (generalAgent) {
      logger.debug({ agentId: generalAgent.id }, 'Using first general agent as default');
      return generalAgent;
    }

    // 4. First available agent
    logger.debug({ agentId: agents[0]!.id }, 'Using first available agent as default');
    return agents[0]!;
  }

  /**
   * Calculate scores for all agents
   */
  private calculateAgentScores(task: TaskDTO, agents: AgentDTO[]): AgentScore[] {
    const requiredCaps = [task.type];

    return agents.map(agent => {
      const capabilityMatch = matchCapabilities(requiredCaps, agent.capabilities || []);
      const typeBonus = agent.type === task.type ? 0.2 : 0;

      return {
        agentId: agent.id,
        agentName: agent.name,
        totalScore: Math.min(1, capabilityMatch + typeBonus),
        capabilityMatch,
        loadScore: 1, // Would need actual load data
        historyScore: 1, // Would need actual history
        specialization: capabilityMatch > 0.7,
      };
    }).sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * Build a structured decision
   */
  private buildDecision(
    id: string,
    taskId: string,
    decisionType: DecisionType,
    targetAgent: string | undefined,
    confidence: number,
    reasoning: string,
    method: DecisionMethod,
    startTime: number,
    extras: Partial<StructuredDecision> = {}
  ): StructuredDecision {
    const confidenceLevel = this.getConfidenceLevel(confidence);

    const decision: StructuredDecision = {
      id,
      taskId,
      decidedAt: Date.now(),
      decisionType,
      targetAgent,
      requiresEscalation: decisionType === 'escalate' || confidence < CONFIDENCE_THRESHOLDS.LOW,
      confidenceScore: confidence,
      confidenceLevel,
      reasoning,
      method,
      heuristicsAttempted: extras.heuristicsAttempted ?? false,
      suggestedActions: extras.suggestedActions || this.buildDefaultActions(decisionType, targetAgent),
      processingTimeMs: Date.now() - startTime,
      fromCache: false,
      ...extras,
    };

    return decision;
  }

  /**
   * Build default actions based on decision type
   */
  private buildDefaultActions(decisionType: DecisionType, targetAgent?: string): DecisionAction[] {
    switch (decisionType) {
      case 'assign':
        return targetAgent
          ? [{ type: 'assign', targetId: targetAgent, priority: 1 }]
          : [{ type: 'escalate', reason: 'no_suitable_agent', priority: 1 }];
      case 'subdivide':
        return [{ type: 'subdivide', priority: 1 }];
      case 'escalate':
        return [{ type: 'escalate', reason: 'decision_escalation', priority: 1 }];
      case 'wait':
        return [{ type: 'wait', reason: 'pending_dependency', priority: 1 }];
      case 'create_resource':
        return [{ type: 'create_resource', resourceType: 'agent', priority: 1 }];
      case 'reject':
        return [{ type: 'reject', reason: 'invalid_task', priority: 1 }];
      default:
        return [];
    }
  }

  /**
   * Create cached decision wrapper
   */
  private createCachedDecision(
    id: string,
    taskId: string,
    cached: StructuredDecision,
    cacheKey: string,
    startTime: number
  ): StructuredDecision {
    return {
      ...cached,
      id,
      taskId,
      decidedAt: Date.now(),
      method: 'cached',
      processingTimeMs: Date.now() - startTime,
      fromCache: true,
      cacheKey,
    };
  }

  /**
   * Create fallback decision when all else fails
   *
   * PROMPT 18 FIX: ALWAYS assign to an available agent if any exist.
   * This prevents tasks from getting stuck in "queued" forever.
   * The agent may not be perfect, but it can at least attempt the task.
   */
  private createFallbackDecision(
    id: string,
    task: TaskDTO,
    agents: AgentDTO[],
    startTime: number,
    error?: unknown
  ): StructuredDecision {
    const activeAgents = agents.filter(a => a.status === 'active');

    // PROMPT 18: ALWAYS find an agent if any are active
    // Priority: general/orchestrator > first available
    let targetAgent: string | undefined;
    let assignReason = '';

    if (activeAgents.length > 0) {
      // Find general-purpose agent first (best for unknown tasks)
      const general = activeAgents.find(a => a.type === 'general');
      const orchestrator = activeAgents.find(a => a.type === 'orchestrator');

      if (general) {
        targetAgent = general.id;
        assignReason = `Fallback to general agent "${general.name}"`;
      } else if (orchestrator) {
        targetAgent = orchestrator.id;
        assignReason = `Fallback to orchestrator agent "${orchestrator.name}"`;
      } else {
        // Use first available agent
        targetAgent = activeAgents[0]!.id;
        assignReason = `Fallback to first available agent "${activeAgents[0]!.name}"`;
      }
    }

    const errorReason = error
      ? `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      : '';

    const reason = targetAgent
      ? `${assignReason}. ${errorReason || 'No specific match found, using fallback agent.'}`
      : `No active agents available. ${errorReason}`;

    // PROMPT 18: Only escalate if NO agents at all. Otherwise force assign.
    const decisionType = targetAgent ? 'assign' : 'escalate';

    logger.info({
      taskId: task.id,
      decisionType,
      targetAgent,
      activeAgentsCount: activeAgents.length,
      reason,
    }, 'PROMPT 18: Fallback decision created');

    return this.buildDecision(
      id,
      task.id,
      decisionType,
      targetAgent,
      targetAgent ? 0.4 : 0.1, // Slightly higher confidence if we found an agent
      reason,
      'fallback',
      startTime,
      {
        heuristicsAttempted: true,
        heuristicFailReason: 'all_methods_failed',
        // PROMPT 18: Include agent scores if we assigned
        agentScores: targetAgent ? [{
          agentId: targetAgent,
          agentName: activeAgents.find(a => a.id === targetAgent)?.name || 'unknown',
          totalScore: 40, // Low but non-zero score
          capabilityMatch: 0.2,
          loadScore: 1,
          historyScore: 0.5,
          specialization: false,
        }] : undefined,
      }
    );
  }

  /**
   * BLOQUE 5: Validate and finalize decision
   *
   * This is the final validation gate before a decision is executed.
   * IA interpreta → heurística valida → validador confirma → sistema decide
   */
  private validateAndFinalize(
    decision: StructuredDecision,
    task: TaskDTO,
    agents: AgentDTO[],
    startTime: number
  ): StructuredDecision {
    // Infer required capabilities from task
    const requiredCapabilities = inferCapabilities({
      id: task.id,
      title: task.title,
      description: task.description,
      type: task.type,
      priority: task.priority,
      parentTaskId: task.parentTaskId,
      retryCount: task.retryCount,
      input: task.input,
      metadata: task.metadata,
    });

    // Skip validation for escalations (already safe)
    if (!needsValidation(decision)) {
      // Still record decision trace for traceability
      this.recordDecisionTrace(task, agents, decision, requiredCapabilities, startTime);
      return this.attachTraceability(decision, null);
    }

    // Validate the decision
    const validation = validateDecision(
      decision,
      agents,
      requiredCapabilities,
      {
        requireCapabilityMatch: this.modeConfig.mode !== 'max_quality',
        strictMode: task.priority >= 4, // Strict for critical tasks
      }
    );

    // Log validation result
    logger.info({
      taskId: task.id,
      decisionId: decision.id,
      valid: validation.valid,
      fallbackApplied: validation.fallbackApplied,
      fallbackType: validation.fallbackType,
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    }, 'Decision validated');

    // Record decision trace for traceability
    this.recordDecisionTrace(task, agents, validation.decision, requiredCapabilities, startTime);

    // Return validated decision with traceability
    return this.attachTraceability(validation.decision, validation);
  }

  /**
   * Record decision trace for audit and debugging
   */
  private recordDecisionTrace(
    task: TaskDTO,
    agents: AgentDTO[],
    decision: StructuredDecision,
    requiredCapabilities: string[],
    startTime: number
  ): void {
    const traceStore = getDecisionTraceStore();

    const builder: DecisionTraceBuilder = {
      taskId: task.id,
      taskType: task.type,
      taskPriority: task.priority,
      requiredCapabilities,
      startTime,
    };

    // Map agents to trace format
    const agentData = agents.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      capabilities: a.capabilities || [],
    }));

    // Determine method for trace
    const method = decision.method === 'heuristic' || decision.method === 'fallback'
      ? 'heuristic'
      : decision.method === 'cached'
      ? 'cached'
      : decision.method.startsWith('llm')
      ? 'llm'
      : 'fallback';

    const trace = buildDecisionTrace(
      builder,
      agentData,
      decision.targetAgent,
      decision.confidenceScore,
      decision.reasoning,
      method,
      decision.confidenceScore,
      undefined // no error
    );

    traceStore.record(trace);
  }

  /**
   * Attach traceability to decision (BLOQUE 5)
   */
  private attachTraceability(
    decision: StructuredDecision,
    validation: ValidationResult | null
  ): StructuredDecision {
    const traceability: DecisionTraceability = validation?.traceability ?? {
      decision_source: this.getDecisionSource(decision),
      decision_confidence: decision.confidenceScore,
      decision_validated: true,
      decided_at: decision.decidedAt,
      decision_reason: decision.reasoning,
    };

    // Attach to decision metadata
    return {
      ...decision,
      // Store traceability in metadata for downstream consumers
      extras: {
        ...(decision as unknown as { extras?: Record<string, unknown> }).extras,
        _traceability: traceability,
        _validated: validation?.valid ?? true,
        _fallbackApplied: validation?.fallbackApplied ?? false,
        _fallbackType: validation?.fallbackType,
      },
    } as StructuredDecision;
  }

  /**
   * Determine decision source for traceability
   */
  private getDecisionSource(decision: StructuredDecision): DecisionTraceability['decision_source'] {
    switch (decision.method) {
      case 'heuristic':
      case 'fallback':
      case 'cached':
        return 'heuristic';
      case 'llm_classify':
      case 'llm_decide':
      case 'llm_plan':
        return 'ai';
      default:
        return 'hybrid';
    }
  }

  /**
   * Get confidence level from score
   */
  private getConfidenceLevel(score: number): ConfidenceLevel {
    if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
    if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
    return 'low';
  }

  /**
   * Emit decision completion event
   */
  private async emitDecisionComplete(decision: StructuredDecision, task: TaskDTO): Promise<void> {
    const { eventService } = getServices();
    const costSummary = this.costTracker.getSummary();

    await eventService.emit({
      type: EVENT_TYPE.TASK_DECISION_COMPLETED,
      category: 'orchestrator',
      severity: decision.requiresEscalation ? 'warning' : 'info',
      message: `Decision for "${task.title}": ${decision.decisionType} (${decision.confidenceLevel} confidence)`,
      resourceType: 'task',
      resourceId: task.id,
      data: {
        decisionId: decision.id,
        decisionType: decision.decisionType,
        targetAgent: decision.targetAgent,
        confidenceScore: decision.confidenceScore,
        method: decision.method,
        processingTimeMs: decision.processingTimeMs,
        fromCache: decision.fromCache,
        // Cost optimization info
        operationMode: this.modeConfig.mode,
        llmTier: decision.llmTier,
        costInfo: (decision as DecisionWithCost).costInfo,
        costSummary: {
          totalCost: costSummary.totalCost,
          totalSaved: costSummary.totalSaved,
          llmAvoidanceRate: costSummary.llmAvoidanceRate,
          cacheHitRate: costSummary.cacheHitRate,
        },
      },
    });
  }

  /**
   * Update metrics after decision
   */
  private updateMetrics(decision: StructuredDecision): void {
    this.metrics.totalDecisions++;
    this.metrics.byDecisionType[decision.decisionType]++;

    switch (decision.method) {
      case 'heuristic':
        this.metrics.heuristicDecisions++;
        break;
      case 'cached':
        this.metrics.cachedDecisions++;
        break;
      case 'llm_classify':
        this.metrics.llmDecisions.short++;
        break;
      case 'llm_decide':
        this.metrics.llmDecisions.medium++;
        break;
      case 'llm_plan':
        this.metrics.llmDecisions.deep++;
        break;
      case 'fallback':
        this.metrics.fallbackDecisions++;
        break;
    }

    // Rolling average for confidence and time
    const n = this.metrics.totalDecisions;
    this.metrics.averageConfidence =
      ((n - 1) * this.metrics.averageConfidence + decision.confidenceScore) / n;
    this.metrics.averageProcessingTimeMs =
      ((n - 1) * this.metrics.averageProcessingTimeMs + decision.processingTimeMs) / n;
  }

  /**
   * Get current metrics
   */
  getMetrics(): DecisionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return this.cache.getStats();
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate cache for a task
   */
  invalidateCache(task: TaskDTO, agents: AgentDTO[]): void {
    const key = this.cache.generateKey(task, agents);
    this.cache.invalidate(key);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartDecisionEngineConfig>): void {
    this.config = { ...this.config, ...config };

    // Update operation mode if changed
    if (config.operationMode && config.operationMode !== this.modeConfig.mode) {
      this.setOperationMode(config.operationMode);
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initMetrics();
  }

  // =============================================================================
  // OPERATION MODE MANAGEMENT
  // =============================================================================

  /**
   * Set operation mode at runtime
   */
  setOperationMode(mode: OperationMode): void {
    const oldMode = this.modeConfig.mode;
    this.modeConfig = OPERATION_MODE_CONFIGS[mode];
    this.config.operationMode = mode;
    this.costTracker.setOperationMode(mode);

    logger.info({
      oldMode,
      newMode: mode,
      heuristicThreshold: this.modeConfig.heuristicConfidenceThreshold,
      maxTier: this.modeConfig.maxLLMTier,
      useCompactPrompts: this.modeConfig.useCompactPrompts,
    }, 'Operation mode changed');
  }

  /**
   * Get current operation mode
   */
  getOperationMode(): OperationMode {
    return this.modeConfig.mode;
  }

  /**
   * Get operation mode config
   */
  getOperationModeConfig(): OperationModeConfig {
    return { ...this.modeConfig };
  }

  // =============================================================================
  // EXTENDED METRICS
  // =============================================================================

  /**
   * Get extended metrics including cost and cache data
   */
  getExtendedMetrics(): ExtendedDecisionMetrics {
    const costMetrics = this.costTracker.getCostMetrics();
    const cacheMetrics = this.costTracker.getCacheMetrics();

    // Update cache size from actual cache
    const cacheStats = this.cache.getStats();
    cacheMetrics.size = cacheStats.size;
    cacheMetrics.maxSize = cacheStats.maxSize;

    return {
      ...this.metrics,
      cost: costMetrics,
      cache: cacheMetrics,
      operationMode: this.modeConfig.mode,
    };
  }

  /**
   * Get cost summary for logging
   */
  getCostSummary(): ReturnType<CostTracker['getSummary']> {
    const summary = this.costTracker.getSummary();
    // Update heuristic count from our metrics
    summary.decisions.heuristic = this.metrics.heuristicDecisions;
    return summary;
  }

  /**
   * Reset cost tracking
   */
  resetCostTracking(): void {
    this.costTracker.reset();
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let smartDecisionEngineInstance: SmartDecisionEngine | null = null;

export function getSmartDecisionEngine(
  config?: Partial<SmartDecisionEngineConfig>
): SmartDecisionEngine {
  if (!smartDecisionEngineInstance) {
    smartDecisionEngineInstance = new SmartDecisionEngine(config);
  }
  return smartDecisionEngineInstance;
}

export function resetSmartDecisionEngine(): void {
  smartDecisionEngineInstance = null;
}

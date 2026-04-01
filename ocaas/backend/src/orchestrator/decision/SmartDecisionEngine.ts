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
} from './types.js';
import {
  PROMPT_TIER,
  CONFIDENCE_THRESHOLDS,
  DECISION_CACHE_CONFIG,
} from './types.js';
import { evaluateHeuristics, matchCapabilities } from './HeuristicRules.js';
import {
  getPromptBundle,
  parseResponse,
  determineTier,
  type DecisionContext,
  type AgentContext,
  type TaskContext,
  type ShortResponse,
  type MediumResponse,
  type DeepResponse,
} from './PromptTiers.js';

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
}

const DEFAULT_CONFIG: SmartDecisionEngineConfig = {
  enableCache: true,
  cacheMaxSize: 500,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
  enableHeuristics: true,
  enableLLM: true,
  forceDeepAnalysis: false,
  minConfidenceForHeuristic: 0.7,
};

export class SmartDecisionEngine {
  private config: SmartDecisionEngineConfig;
  private cache: DecisionCache;
  private metrics: DecisionMetrics;

  constructor(config: Partial<SmartDecisionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new DecisionCache(this.config.cacheMaxSize, this.config.cacheTTL);
    this.metrics = this.initMetrics();
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

    logger.info({ taskId: task.id, decisionId }, 'Starting decision process');

    const { eventService } = getServices();

    // Emit decision started event
    await eventService.emit({
      type: EVENT_TYPE.TASK_DECISION_STARTED,
      category: 'orchestrator',
      severity: 'info',
      message: `Starting decision for task "${task.title}"`,
      resourceType: 'task',
      resourceId: task.id,
      data: { decisionId },
    });

    try {
      let decision: StructuredDecision;

      // Stage 1: Check cache
      if (this.config.enableCache) {
        const cacheKey = this.cache.generateKey(task, agents);
        const cached = this.cache.get(cacheKey);
        if (cached) {
          decision = this.createCachedDecision(decisionId, task.id, cached, cacheKey, startTime);
          this.updateMetrics(decision);
          await this.emitDecisionComplete(decision, task);
          return decision;
        }
      }

      // Stage 2: Evaluate heuristics
      if (this.config.enableHeuristics) {
        const heuristicResult = await this.tryHeuristics(task, agents);
        if (heuristicResult) {
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

          // Cache if confidence is good
          if (this.config.enableCache && decision.confidenceScore >= this.config.minConfidenceForHeuristic) {
            const cacheKey = this.cache.generateKey(task, agents);
            this.cache.set(cacheKey, decision);
            decision.cacheKey = cacheKey;
          }

          this.updateMetrics(decision);
          await this.emitDecisionComplete(decision, task);
          return decision;
        }
      }

      // Stage 3: Use LLM with appropriate tier
      if (this.config.enableLLM) {
        const llmResult = await this.tryLLM(task, agents);
        if (llmResult) {
          decision = llmResult;
          decision.id = decisionId;
          decision.processingTimeMs = Date.now() - startTime;

          // Cache LLM decisions if high confidence
          if (this.config.enableCache && decision.confidenceScore >= 0.7) {
            const cacheKey = this.cache.generateKey(task, agents);
            this.cache.set(cacheKey, decision);
            decision.cacheKey = cacheKey;
          }

          this.updateMetrics(decision);
          await this.emitDecisionComplete(decision, task);
          return decision;
        }
      }

      // Stage 4: Fallback decision
      decision = this.createFallbackDecision(decisionId, task, agents, startTime);
      this.updateMetrics(decision);
      await this.emitDecisionComplete(decision, task);
      return decision;

    } catch (err) {
      logger.error({ err, taskId: task.id, decisionId }, 'Decision process failed');

      // Return safe fallback on error
      const fallback = this.createFallbackDecision(decisionId, task, agents, startTime, err);
      this.updateMetrics(fallback);
      await this.emitDecisionComplete(fallback, task);
      return fallback;
    }
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
   */
  private async tryLLM(task: TaskDTO, agents: AgentDTO[]): Promise<StructuredDecision | null> {
    const adapter = getOpenClawAdapter();

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

    // Determine which tier to use
    const tier = this.config.forceDeepAnalysis
      ? PROMPT_TIER.DEEP
      : determineTier(decisionContext);

    logger.info({ taskId: task.id, tier }, 'Using LLM tier');

    const bundle = getPromptBundle(tier, decisionContext);

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

      const parsed = parseResponse(tier, result.content);

      if (!parsed) {
        logger.warn({ taskId: task.id, tier }, 'Failed to parse LLM response');
        return null;
      }

      // Convert parsed response to StructuredDecision
      return this.convertLLMResponse(task.id, tier, parsed, activeAgents);

    } catch (err) {
      logger.error({ err, taskId: task.id, tier }, 'LLM request failed');
      return null;
    }
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

    return bestScore > 0 ? bestAgent : null;
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
   */
  private createFallbackDecision(
    id: string,
    task: TaskDTO,
    agents: AgentDTO[],
    startTime: number,
    error?: unknown
  ): StructuredDecision {
    const activeAgents = agents.filter(a => a.status === 'active');

    // Try to find any agent that might handle this
    let targetAgent: string | undefined;
    if (activeAgents.length === 1) {
      targetAgent = activeAgents[0]!.id;
    } else if (activeAgents.length > 0) {
      // Find general-purpose agent or first available
      const general = activeAgents.find(a => a.type === 'orchestrator' || a.type === 'general');
      targetAgent = general?.id || activeAgents[0]!.id;
    }

    const reason = error
      ? `Fallback due to error: ${error instanceof Error ? error.message : 'Unknown error'}`
      : 'No decision method succeeded';

    return this.buildDecision(
      id,
      task.id,
      targetAgent ? 'assign' : 'escalate',
      targetAgent,
      0.3, // Low confidence for fallback
      reason,
      'fallback',
      startTime,
      {
        heuristicsAttempted: true,
        heuristicFailReason: 'all_methods_failed',
      }
    );
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
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initMetrics();
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

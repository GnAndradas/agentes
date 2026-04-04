/**
 * GlobalBudgetManager
 *
 * Central cost control for OCAAS.
 * Estimates, validates, tracks, and enforces budget limits.
 *
 * Responsibilities:
 * - Check if operation fits within budget before execution
 * - Record actual costs after execution
 * - Decide: allow, warn, block, or degrade
 * - Track daily/task/agent accumulated costs
 * - Provide diagnostics and visibility
 */

import { createLogger } from '../utils/logger.js';
import {
  BudgetConfig,
  DEFAULT_BUDGET_CONFIG,
  BudgetDecision,
  BudgetScope,
  BudgetCheckResult,
  BudgetEstimationRequest,
  CostRecord,
  AccumulatedCost,
  DailyCostSnapshot,
  BudgetTraceability,
  BudgetDiagnostics,
  TIER_TOKEN_ESTIMATES,
  calculateCostUSD,
  estimateTierCost,
} from './types.js';

const logger = createLogger('GlobalBudgetManager');

// ============================================================================
// GLOBAL BUDGET MANAGER
// ============================================================================

export class GlobalBudgetManager {
  private config: BudgetConfig;
  private dailySnapshot: DailyCostSnapshot;
  private costRecords: CostRecord[] = [];
  private readonly maxRecords = 1000; // Keep last 1000 records in memory

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.dailySnapshot = this.createDailySnapshot();

    logger.info({
      config: this.config,
    }, 'GlobalBudgetManager initialized');
  }

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'Budget config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // BUDGET CHECK (BEFORE EXECUTION)
  // ==========================================================================

  /**
   * Check if an operation fits within budget
   *
   * Call this BEFORE making LLM calls to decide:
   * - allow: proceed normally
   * - warn: proceed but log warning
   * - block: do not proceed (hard limit)
   * - degrade: proceed with lower tier
   */
  checkBudget(request: BudgetEstimationRequest): BudgetCheckResult {
    // Ensure we're on today's snapshot
    this.ensureTodaySnapshot();

    // Estimate cost for this operation
    const estimatedCost = this.estimateCost(request);

    // Check each scope in order of specificity
    const taskCheck = request.task_id
      ? this.checkTaskBudget(request.task_id, estimatedCost)
      : null;

    const agentCheck = request.agent_id
      ? this.checkAgentDailyBudget(request.agent_id, estimatedCost)
      : null;

    const globalCheck = this.checkGlobalDailyBudget(estimatedCost);

    // Return the most restrictive check
    const checks = [taskCheck, agentCheck, globalCheck].filter(Boolean) as BudgetCheckResult[];
    const mostRestrictive = this.getMostRestrictiveCheck(checks);

    // If we need to degrade, calculate degraded tier
    if (mostRestrictive.decision === 'degrade' && this.config.auto_degrade_enabled) {
      mostRestrictive.degraded_tier = this.calculateDegradedTier(request.tier, mostRestrictive);
    }

    // Track warnings/blocks/degradations
    this.trackDecisionMetrics(mostRestrictive.decision);

    // Log decision
    logger.info({
      request,
      decision: mostRestrictive.decision,
      scope: mostRestrictive.scope,
      reason: mostRestrictive.reason,
      estimated_cost: estimatedCost,
      usage_pct: mostRestrictive.usage_pct,
    }, 'Budget check completed');

    return mostRestrictive;
  }

  /**
   * Estimate cost for a request
   */
  private estimateCost(request: BudgetEstimationRequest): number {
    if (request.estimated_input_tokens && request.estimated_output_tokens) {
      return calculateCostUSD(request.estimated_input_tokens, request.estimated_output_tokens);
    }
    return estimateTierCost(request.tier);
  }

  /**
   * Check task budget
   */
  private checkTaskBudget(taskId: string, estimatedCost: number): BudgetCheckResult {
    const taskCost = this.dailySnapshot.by_task.get(taskId) || this.createEmptyAccumulated();
    const currentCost = taskCost.total_cost_usd;
    const limit = this.config.max_cost_per_task_usd;
    const wouldBe = currentCost + estimatedCost;
    const usagePct = wouldBe / limit;

    return this.makeBudgetDecision({
      scope: 'task',
      currentCost,
      limit,
      estimatedCost,
      usagePct,
      wouldExceed: wouldBe > limit,
    });
  }

  /**
   * Check agent daily budget
   */
  private checkAgentDailyBudget(agentId: string, estimatedCost: number): BudgetCheckResult {
    const agentCost = this.dailySnapshot.by_agent.get(agentId) || this.createEmptyAccumulated();
    const currentCost = agentCost.total_cost_usd;
    const limit = this.config.max_cost_per_agent_daily_usd;
    const wouldBe = currentCost + estimatedCost;
    const usagePct = wouldBe / limit;

    return this.makeBudgetDecision({
      scope: 'agent_daily',
      currentCost,
      limit,
      estimatedCost,
      usagePct,
      wouldExceed: wouldBe > limit,
    });
  }

  /**
   * Check global daily budget
   */
  private checkGlobalDailyBudget(estimatedCost: number): BudgetCheckResult {
    const currentCost = this.dailySnapshot.global.total_cost_usd;
    const limit = this.config.max_cost_daily_usd;
    const wouldBe = currentCost + estimatedCost;
    const usagePct = wouldBe / limit;

    return this.makeBudgetDecision({
      scope: 'global_daily',
      currentCost,
      limit,
      estimatedCost,
      usagePct,
      wouldExceed: wouldBe > limit,
    });
  }

  /**
   * Make budget decision based on thresholds
   */
  private makeBudgetDecision(params: {
    scope: BudgetScope;
    currentCost: number;
    limit: number;
    estimatedCost: number;
    usagePct: number;
    wouldExceed: boolean;
  }): BudgetCheckResult {
    const { scope, currentCost, limit, estimatedCost, usagePct, wouldExceed } = params;

    let decision: BudgetDecision;
    let reason: string;

    if (wouldExceed && this.config.hard_stop_enabled) {
      decision = 'block';
      reason = `Would exceed ${scope} limit: $${(currentCost + estimatedCost).toFixed(4)} > $${limit.toFixed(2)}`;
    } else if (wouldExceed && this.config.auto_degrade_enabled) {
      decision = 'degrade';
      reason = `Approaching ${scope} limit, degrading tier: ${(usagePct * 100).toFixed(1)}% of $${limit.toFixed(2)}`;
    } else if (usagePct >= this.config.soft_warning_threshold_pct) {
      decision = 'warn';
      reason = `${scope} budget at ${(usagePct * 100).toFixed(1)}% of $${limit.toFixed(2)} limit`;
    } else {
      decision = 'allow';
      reason = `Within ${scope} budget: ${(usagePct * 100).toFixed(1)}% of $${limit.toFixed(2)}`;
    }

    return {
      decision,
      scope,
      reason,
      current_cost_usd: currentCost,
      limit_usd: limit,
      usage_pct: usagePct,
      estimated_cost_usd: estimatedCost,
      would_exceed: wouldExceed,
      checked_at: Date.now(),
    };
  }

  /**
   * Get most restrictive check from multiple scopes
   */
  private getMostRestrictiveCheck(checks: BudgetCheckResult[]): BudgetCheckResult {
    const priority: Record<BudgetDecision, number> = {
      block: 4,
      degrade: 3,
      warn: 2,
      allow: 1,
    };

    return checks.reduce((most, current) =>
      priority[current.decision] > priority[most.decision] ? current : most
    );
  }

  /**
   * Calculate degraded tier
   */
  private calculateDegradedTier(
    originalTier: 'short' | 'medium' | 'deep',
    check: BudgetCheckResult
  ): 'short' | 'medium' | 'deep' {
    // Degrade by one level if possible
    if (originalTier === 'deep') return 'medium';
    if (originalTier === 'medium') return 'short';
    return 'short'; // Can't degrade further
  }

  /**
   * Track decision metrics
   */
  private trackDecisionMetrics(decision: BudgetDecision): void {
    if (decision === 'warn') {
      this.dailySnapshot.warnings_issued++;
    } else if (decision === 'block') {
      this.dailySnapshot.blocks_issued++;
    } else if (decision === 'degrade') {
      this.dailySnapshot.degradations_issued++;
    }
  }

  // ==========================================================================
  // COST RECORDING (AFTER EXECUTION)
  // ==========================================================================

  /**
   * Record actual cost after execution
   */
  recordCost(params: {
    task_id?: string;
    agent_id?: string;
    operation: 'decision' | 'generation' | 'execution';
    tier: 'short' | 'medium' | 'deep' | 'none';
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    budget_decision: BudgetDecision;
  }): CostRecord {
    this.ensureTodaySnapshot();

    const actualCost = calculateCostUSD(params.input_tokens, params.output_tokens);

    const record: CostRecord = {
      id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task_id: params.task_id,
      agent_id: params.agent_id,
      operation: params.operation,
      tier: params.tier,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      estimated_cost_usd: params.estimated_cost_usd,
      actual_cost_usd: actualCost,
      budget_decision: params.budget_decision,
      recorded_at: Date.now(),
    };

    // Add to records (keep bounded)
    this.costRecords.push(record);
    if (this.costRecords.length > this.maxRecords) {
      this.costRecords = this.costRecords.slice(-this.maxRecords);
    }

    // Update accumulated costs
    this.updateAccumulatedCosts(record);

    logger.debug({
      record_id: record.id,
      task_id: record.task_id,
      agent_id: record.agent_id,
      actual_cost: actualCost,
      estimated_cost: params.estimated_cost_usd,
      variance: actualCost - params.estimated_cost_usd,
    }, 'Cost recorded');

    return record;
  }

  /**
   * Update accumulated costs from a record
   */
  private updateAccumulatedCosts(record: CostRecord): void {
    const cost = record.actual_cost_usd;
    const tokens = { input: record.input_tokens, output: record.output_tokens };

    // Update global
    this.dailySnapshot.global.total_cost_usd += cost;
    this.dailySnapshot.global.total_input_tokens += tokens.input;
    this.dailySnapshot.global.total_output_tokens += tokens.output;
    this.dailySnapshot.global.operation_count++;
    this.dailySnapshot.global.last_updated = Date.now();

    // Update by agent
    if (record.agent_id) {
      const agent = this.dailySnapshot.by_agent.get(record.agent_id) || this.createEmptyAccumulated();
      agent.total_cost_usd += cost;
      agent.total_input_tokens += tokens.input;
      agent.total_output_tokens += tokens.output;
      agent.operation_count++;
      agent.last_updated = Date.now();
      this.dailySnapshot.by_agent.set(record.agent_id, agent);
    }

    // Update by task
    if (record.task_id) {
      const task = this.dailySnapshot.by_task.get(record.task_id) || this.createEmptyAccumulated();
      task.total_cost_usd += cost;
      task.total_input_tokens += tokens.input;
      task.total_output_tokens += tokens.output;
      task.operation_count++;
      task.last_updated = Date.now();
      this.dailySnapshot.by_task.set(record.task_id, task);
    }
  }

  // ==========================================================================
  // BUDGET TRACEABILITY
  // ==========================================================================

  /**
   * Build traceability from a budget check
   */
  buildTraceability(
    check: BudgetCheckResult,
    actualCost?: number,
    originalTier?: 'short' | 'medium' | 'deep',
    finalTier?: 'short' | 'medium' | 'deep'
  ): BudgetTraceability {
    const wasDegraded = originalTier && finalTier && originalTier !== finalTier;

    return {
      estimated_cost_usd: check.estimated_cost_usd,
      actual_cost_usd: actualCost,
      budget_decision: check.decision,
      budget_reason: check.reason,
      budget_scope: check.scope,
      budget_threshold_triggered:
        check.decision === 'block' ? 'hard' :
        check.decision === 'warn' || check.decision === 'degrade' ? 'soft' : null,
      budget_snapshot: {
        task_cost_usd: check.scope === 'task' ? check.current_cost_usd : 0,
        agent_daily_cost_usd: check.scope === 'agent_daily' ? check.current_cost_usd : 0,
        global_daily_cost_usd: this.dailySnapshot.global.total_cost_usd,
      },
      was_degraded: wasDegraded,
      original_tier: wasDegraded ? originalTier : undefined,
      final_tier: wasDegraded ? finalTier : undefined,
    };
  }

  // ==========================================================================
  // DIAGNOSTICS
  // ==========================================================================

  /**
   * Get budget diagnostics
   */
  getDiagnostics(): BudgetDiagnostics {
    this.ensureTodaySnapshot();

    const globalUsagePct = this.dailySnapshot.global.total_cost_usd / this.config.max_cost_daily_usd;

    // Determine status
    let status: 'healthy' | 'warning' | 'critical';
    let statusReason: string;

    if (globalUsagePct >= 1) {
      status = 'critical';
      statusReason = 'Global daily budget exceeded';
    } else if (globalUsagePct >= this.config.soft_warning_threshold_pct) {
      status = 'warning';
      statusReason = `Global daily budget at ${(globalUsagePct * 100).toFixed(1)}%`;
    } else {
      status = 'healthy';
      statusReason = 'Within budget limits';
    }

    // Top agents by cost
    const topAgents = Array.from(this.dailySnapshot.by_agent.entries())
      .map(([agent_id, acc]) => ({
        agent_id,
        cost_usd: acc.total_cost_usd,
        limit_usd: this.config.max_cost_per_agent_daily_usd,
        usage_pct: acc.total_cost_usd / this.config.max_cost_per_agent_daily_usd,
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd)
      .slice(0, 10);

    // Recent records
    const recentRecords = this.costRecords.slice(-10).reverse();

    return {
      config: this.config,
      today: {
        date: this.dailySnapshot.date,
        global_cost_usd: this.dailySnapshot.global.total_cost_usd,
        global_limit_usd: this.config.max_cost_daily_usd,
        global_usage_pct: globalUsagePct,
        warnings_issued: this.dailySnapshot.warnings_issued,
        blocks_issued: this.dailySnapshot.blocks_issued,
        degradations_issued: this.dailySnapshot.degradations_issued,
      },
      top_agents: topAgents,
      recent_records: recentRecords,
      status,
      status_reason: statusReason,
    };
  }

  /**
   * Get cost for a specific task
   */
  getTaskCost(taskId: string): AccumulatedCost {
    this.ensureTodaySnapshot();
    return this.dailySnapshot.by_task.get(taskId) || this.createEmptyAccumulated();
  }

  /**
   * Get cost for a specific agent today
   */
  getAgentDailyCost(agentId: string): AccumulatedCost {
    this.ensureTodaySnapshot();
    return this.dailySnapshot.by_agent.get(agentId) || this.createEmptyAccumulated();
  }

  /**
   * Get global daily cost
   */
  getGlobalDailyCost(): AccumulatedCost {
    this.ensureTodaySnapshot();
    return { ...this.dailySnapshot.global };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * Get today's date string
   */
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /**
   * Ensure we're on today's snapshot (reset if day changed)
   */
  private ensureTodaySnapshot(): void {
    const today = this.getTodayString();
    if (this.dailySnapshot.date !== today) {
      logger.info({
        old_date: this.dailySnapshot.date,
        new_date: today,
        old_global_cost: this.dailySnapshot.global.total_cost_usd,
      }, 'Day changed, resetting daily budget');
      this.dailySnapshot = this.createDailySnapshot();
    }
  }

  /**
   * Create new daily snapshot
   */
  private createDailySnapshot(): DailyCostSnapshot {
    return {
      date: this.getTodayString(),
      global: this.createEmptyAccumulated(),
      by_agent: new Map(),
      by_task: new Map(),
      warnings_issued: 0,
      blocks_issued: 0,
      degradations_issued: 0,
    };
  }

  /**
   * Create empty accumulated cost
   */
  private createEmptyAccumulated(): AccumulatedCost {
    return {
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      operation_count: 0,
      last_updated: Date.now(),
      period_start: Date.now(),
    };
  }

  /**
   * Reset manager (for testing)
   */
  reset(): void {
    this.dailySnapshot = this.createDailySnapshot();
    this.costRecords = [];
    logger.info('GlobalBudgetManager reset');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: GlobalBudgetManager | null = null;

/**
 * Get GlobalBudgetManager singleton
 */
export function getGlobalBudgetManager(): GlobalBudgetManager {
  if (!instance) {
    // Load config from environment if available
    const config: Partial<BudgetConfig> = {};

    if (process.env.BUDGET_MAX_COST_PER_TASK_USD) {
      config.max_cost_per_task_usd = parseFloat(process.env.BUDGET_MAX_COST_PER_TASK_USD);
    }
    if (process.env.BUDGET_MAX_COST_PER_AGENT_DAILY_USD) {
      config.max_cost_per_agent_daily_usd = parseFloat(process.env.BUDGET_MAX_COST_PER_AGENT_DAILY_USD);
    }
    if (process.env.BUDGET_MAX_COST_DAILY_USD) {
      config.max_cost_daily_usd = parseFloat(process.env.BUDGET_MAX_COST_DAILY_USD);
    }
    if (process.env.BUDGET_MAX_TOKENS_PER_TASK) {
      config.max_tokens_per_task = parseInt(process.env.BUDGET_MAX_TOKENS_PER_TASK);
    }
    if (process.env.BUDGET_SOFT_WARNING_THRESHOLD_PCT) {
      config.soft_warning_threshold_pct = parseFloat(process.env.BUDGET_SOFT_WARNING_THRESHOLD_PCT);
    }
    if (process.env.BUDGET_HARD_STOP_ENABLED) {
      config.hard_stop_enabled = process.env.BUDGET_HARD_STOP_ENABLED === 'true';
    }
    if (process.env.BUDGET_AUTO_DEGRADE_ENABLED) {
      config.auto_degrade_enabled = process.env.BUDGET_AUTO_DEGRADE_ENABLED === 'true';
    }

    instance = new GlobalBudgetManager(config);
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
export function resetGlobalBudgetManager(): void {
  instance = null;
}

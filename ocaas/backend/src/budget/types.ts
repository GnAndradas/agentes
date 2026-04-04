/**
 * Global Budget Manager Types
 *
 * Defines budget limits, decisions, and traceability for cost control.
 */

// ============================================================================
// BUDGET CONFIGURATION
// ============================================================================

/**
 * Budget configuration with limits and thresholds
 */
export interface BudgetConfig {
  /** Maximum cost per task in USD (default: 0.50) */
  max_cost_per_task_usd: number;

  /** Maximum cost per agent per day in USD (default: 5.00) */
  max_cost_per_agent_daily_usd: number;

  /** Maximum global cost per day in USD (default: 50.00) */
  max_cost_daily_usd: number;

  /** Maximum tokens per task (default: 50000) */
  max_tokens_per_task: number;

  /** Soft warning threshold percentage (default: 0.8 = 80%) */
  soft_warning_threshold_pct: number;

  /** Enable hard stop when limits exceeded (default: true) */
  hard_stop_enabled: boolean;

  /** Enable automatic degradation (default: true) */
  auto_degrade_enabled: boolean;
}

/**
 * Default budget configuration - safe defaults
 */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  max_cost_per_task_usd: 0.50,
  max_cost_per_agent_daily_usd: 5.00,
  max_cost_daily_usd: 50.00,
  max_tokens_per_task: 50000,
  soft_warning_threshold_pct: 0.80,
  hard_stop_enabled: true,
  auto_degrade_enabled: true,
};

// ============================================================================
// BUDGET DECISIONS
// ============================================================================

/**
 * Budget decision type
 */
export type BudgetDecision = 'allow' | 'warn' | 'block' | 'degrade';

/**
 * Scope of budget check
 */
export type BudgetScope = 'task' | 'agent_daily' | 'global_daily';

/**
 * Result of budget check
 */
export interface BudgetCheckResult {
  /** Decision made */
  decision: BudgetDecision;

  /** Scope that triggered the decision */
  scope: BudgetScope;

  /** Human-readable reason */
  reason: string;

  /** Current cost in this scope */
  current_cost_usd: number;

  /** Limit for this scope */
  limit_usd: number;

  /** Percentage of limit used */
  usage_pct: number;

  /** Estimated cost of requested operation */
  estimated_cost_usd: number;

  /** Would exceed limit if allowed */
  would_exceed: boolean;

  /** Recommended tier after degradation (if decision=degrade) */
  degraded_tier?: 'short' | 'medium' | 'deep';

  /** Timestamp of check */
  checked_at: number;
}

/**
 * Budget estimation request
 */
export interface BudgetEstimationRequest {
  /** Task ID */
  task_id?: string;

  /** Agent ID */
  agent_id?: string;

  /** Requested tier */
  tier: 'short' | 'medium' | 'deep';

  /** Operation type */
  operation: 'decision' | 'generation' | 'execution';

  /** Estimated input tokens */
  estimated_input_tokens?: number;

  /** Estimated output tokens */
  estimated_output_tokens?: number;
}

// ============================================================================
// BUDGET TRACKING
// ============================================================================

/**
 * Cost record for a single operation
 */
export interface CostRecord {
  /** Unique ID */
  id: string;

  /** Task ID */
  task_id?: string;

  /** Agent ID */
  agent_id?: string;

  /** Operation type */
  operation: 'decision' | 'generation' | 'execution';

  /** Tier used */
  tier: 'short' | 'medium' | 'deep' | 'none';

  /** Input tokens */
  input_tokens: number;

  /** Output tokens */
  output_tokens: number;

  /** Estimated cost before execution */
  estimated_cost_usd: number;

  /** Actual cost after execution */
  actual_cost_usd: number;

  /** Budget decision at time of execution */
  budget_decision: BudgetDecision;

  /** Timestamp */
  recorded_at: number;
}

/**
 * Accumulated costs for a scope
 */
export interface AccumulatedCost {
  /** Total cost in USD */
  total_cost_usd: number;

  /** Total input tokens */
  total_input_tokens: number;

  /** Total output tokens */
  total_output_tokens: number;

  /** Number of operations */
  operation_count: number;

  /** Last updated timestamp */
  last_updated: number;

  /** Period start (for daily limits) */
  period_start?: number;
}

/**
 * Daily cost snapshot
 */
export interface DailyCostSnapshot {
  /** Date string (YYYY-MM-DD) */
  date: string;

  /** Global accumulated cost */
  global: AccumulatedCost;

  /** Per-agent accumulated costs */
  by_agent: Map<string, AccumulatedCost>;

  /** Per-task accumulated costs */
  by_task: Map<string, AccumulatedCost>;

  /** Warnings issued */
  warnings_issued: number;

  /** Blocks issued */
  blocks_issued: number;

  /** Degradations issued */
  degradations_issued: number;
}

// ============================================================================
// BUDGET TRACEABILITY
// ============================================================================

/**
 * Budget traceability for a task/operation
 */
export interface BudgetTraceability {
  /** Estimated cost before execution */
  estimated_cost_usd: number;

  /** Actual cost after execution */
  actual_cost_usd?: number;

  /** Budget decision made */
  budget_decision: BudgetDecision;

  /** Reason for decision */
  budget_reason: string;

  /** Scope that triggered decision */
  budget_scope: BudgetScope;

  /** Threshold that was triggered (if any) */
  budget_threshold_triggered?: 'soft' | 'hard' | null;

  /** Snapshot at time of decision */
  budget_snapshot: {
    task_cost_usd: number;
    agent_daily_cost_usd: number;
    global_daily_cost_usd: number;
  };

  /** Was degraded from original tier */
  was_degraded?: boolean;

  /** Original tier before degradation */
  original_tier?: 'short' | 'medium' | 'deep';

  /** Final tier after degradation */
  final_tier?: 'short' | 'medium' | 'deep';
}

// ============================================================================
// BUDGET DIAGNOSTICS
// ============================================================================

/**
 * Budget diagnostics response
 */
export interface BudgetDiagnostics {
  /** Current configuration */
  config: BudgetConfig;

  /** Today's snapshot */
  today: {
    date: string;
    global_cost_usd: number;
    global_limit_usd: number;
    global_usage_pct: number;
    warnings_issued: number;
    blocks_issued: number;
    degradations_issued: number;
  };

  /** Top agents by cost today */
  top_agents: Array<{
    agent_id: string;
    cost_usd: number;
    limit_usd: number;
    usage_pct: number;
  }>;

  /** Recent cost records (last 10) */
  recent_records: CostRecord[];

  /** Current status */
  status: 'healthy' | 'warning' | 'critical';

  /** Status reason */
  status_reason: string;
}

// ============================================================================
// TOKEN COST CONSTANTS
// ============================================================================

/**
 * Token cost estimates per tier
 */
export const TIER_TOKEN_ESTIMATES = {
  short: { input: 150, output: 100 },
  medium: { input: 400, output: 250 },
  deep: { input: 1200, output: 800 },
} as const;

/**
 * Cost per 1K tokens (Claude pricing approximation)
 */
export const COST_PER_1K_TOKENS = {
  input: 0.003,   // $3 per 1M input tokens
  output: 0.015,  // $15 per 1M output tokens
} as const;

/**
 * Calculate cost from tokens
 */
export function calculateCostUSD(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1000) * COST_PER_1K_TOKENS.input;
  const outputCost = (outputTokens / 1000) * COST_PER_1K_TOKENS.output;
  return inputCost + outputCost;
}

/**
 * Estimate cost for a tier
 */
export function estimateTierCost(tier: 'short' | 'medium' | 'deep'): number {
  const estimate = TIER_TOKEN_ESTIMATES[tier];
  return calculateCostUSD(estimate.input, estimate.output);
}

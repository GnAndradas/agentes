/**
 * Decision Pipeline Types
 *
 * Structured types for the improved decision engine with heuristics-first approach.
 */

// =============================================================================
// DECISION OUTPUT (Structured, consistent)
// =============================================================================

export type DecisionType =
  | 'assign'           // Can assign to agent
  | 'subdivide'        // Task needs decomposition
  | 'create_resource'  // Need to create agent/skill/tool
  | 'escalate'         // Needs human intervention
  | 'wait'             // Waiting for approval/resource
  | 'reject';          // Cannot process

export type DecisionMethod =
  | 'heuristic'        // Pure rules, no LLM
  | 'cached'           // From cache
  | 'llm_classify'     // LLM for classification only
  | 'llm_decide'       // LLM for decision
  | 'llm_plan'         // LLM for deep planning
  | 'fallback';        // Fallback rules

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface StructuredDecision {
  /** Unique decision ID */
  id: string;
  /** Task this decision is for */
  taskId: string;
  /** When decision was made */
  decidedAt: number;

  // Core decision
  /** Primary decision type */
  decisionType: DecisionType;
  /** Target agent ID (if assign) */
  targetAgent?: string;
  /** Whether escalation to human is required */
  requiresEscalation: boolean;
  /** Confidence score 0-1 */
  confidenceScore: number;
  /** Confidence level category */
  confidenceLevel: ConfidenceLevel;
  /** Brief reasoning (always provided) */
  reasoning: string;

  // Method tracking
  /** How decision was made */
  method: DecisionMethod;
  /** Which tier of LLM was used (if any) */
  llmTier?: 'short' | 'medium' | 'deep';
  /** Whether heuristics were attempted first */
  heuristicsAttempted: boolean;
  /** Why heuristics failed (if they did) */
  heuristicFailReason?: string;

  // Detailed data
  /** Agent scores if assignment decision */
  agentScores?: AgentScore[];
  /** Suggested actions in priority order */
  suggestedActions: DecisionAction[];
  /** Missing capabilities (if any) */
  missingCapabilities?: string[];
  /** Subtask suggestions (if subdivide) */
  subtasks?: SubtaskPlan[];

  // Metadata
  /** Processing time in ms */
  processingTimeMs: number;
  /** Cache hit? */
  fromCache: boolean;
  /** Cache key used */
  cacheKey?: string;
}

export interface AgentScore {
  agentId: string;
  agentName: string;
  totalScore: number;
  capabilityMatch: number;
  loadScore?: number;
  historyScore?: number;
  specialization?: boolean;
}

export interface DecisionAction {
  type: 'assign' | 'subdivide' | 'create_resource' | 'wait' | 'escalate' | 'reject';
  targetId?: string;
  reason?: string;
  resourceType?: string;
  priority: number;  // 1 = highest
  metadata?: Record<string, unknown>;
}

export interface SubtaskPlan {
  title: string;
  description: string;
  type: string;
  order: number;
  dependsOn: number[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiredCapabilities: string[];
}

// =============================================================================
// CONFIDENCE THRESHOLDS
// =============================================================================

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.4,
} as const;

// =============================================================================
// HEURISTIC RULES
// =============================================================================

export interface HeuristicRule {
  /** Rule identifier */
  id: string;
  /** Rule name for logging */
  name: string;
  /** Priority (lower = checked first) */
  priority: number;
  /** When this rule applies */
  condition: (context: HeuristicContext) => boolean;
  /** What decision to make */
  decide: (context: HeuristicContext) => HeuristicDecisionResult;
  /** Minimum confidence this rule provides */
  minConfidence: number;
}

export interface HeuristicContext {
  task: {
    id: string;
    title: string;
    description?: string;
    type: string;
    priority: number;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    parentTaskId?: string;
    retryCount?: number;
  };
  agents: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    capabilities: string[];
    currentLoad?: number;
    successRate?: number;
  }>;
  recentDecisions?: Array<{
    taskId: string;
    decision: {
      decisionType: string;
      targetAgent?: string;
    };
  }>;
}

export interface HeuristicDecisionResult {
  canDecide: boolean;
  decisionType?: DecisionType;
  targetAgent?: string;
  confidence: number;
  reasoning: string;
  actions?: DecisionAction[];
}

// =============================================================================
// CLASSIFICATION (Simple, fast)
// =============================================================================

export type TaskClassification = {
  /** Primary category */
  category: 'simple' | 'moderate' | 'complex' | 'requires_planning';
  /** Task type inferred */
  taskType: string;
  /** Complexity level */
  complexity: 'low' | 'medium' | 'high';
  /** Required capabilities (inferred) */
  requiredCapabilities: string[];
  /** Whether decomposition might help */
  mayNeedDecomposition: boolean;
  /** Whether human review is likely needed */
  mayNeedHumanReview: boolean;
  /** Classification confidence */
  confidence: number;
  /** Method used */
  method: 'keyword' | 'pattern' | 'llm';
};

// =============================================================================
// PROMPT TIERS
// =============================================================================

export const PROMPT_TIER = {
  /** Quick classification - ~100 tokens */
  SHORT: 'short',
  /** Standard decision - ~500 tokens */
  MEDIUM: 'medium',
  /** Deep planning - ~1500 tokens */
  DEEP: 'deep',
} as const;

export type PromptTier = (typeof PROMPT_TIER)[keyof typeof PROMPT_TIER];

export interface PromptTierConfig {
  tier: PromptTier;
  maxTokens: number;
  systemPromptLength: 'minimal' | 'standard' | 'detailed';
  includeExamples: boolean;
  includeHistory: boolean;
  timeout: number;
}

export const PROMPT_TIER_CONFIGS: Record<PromptTier, PromptTierConfig> = {
  [PROMPT_TIER.SHORT]: {
    tier: PROMPT_TIER.SHORT,
    maxTokens: 256,
    systemPromptLength: 'minimal',
    includeExamples: false,
    includeHistory: false,
    timeout: 5000,
  },
  [PROMPT_TIER.MEDIUM]: {
    tier: PROMPT_TIER.MEDIUM,
    maxTokens: 512,
    systemPromptLength: 'standard',
    includeExamples: true,
    includeHistory: false,
    timeout: 10000,
  },
  [PROMPT_TIER.DEEP]: {
    tier: PROMPT_TIER.DEEP,
    maxTokens: 1536,
    systemPromptLength: 'detailed',
    includeExamples: true,
    includeHistory: true,
    timeout: 30000,
  },
};

// =============================================================================
// DECISION CACHE
// =============================================================================

export interface CachedDecision {
  decision: StructuredDecision;
  cacheKey: string;
  cachedAt: number;
  expiresAt: number;
  hitCount: number;
}

export interface DecisionCacheEntry {
  key: string;
  decision: StructuredDecision;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  lastAccessedAt: number;
}

export interface DecisionCacheConfig {
  /** Default TTL in ms */
  defaultTtlMs: number;
  /** Max cache entries */
  maxEntries: number;
  /** TTL by decision type */
  ttlByType: Partial<Record<DecisionType, number>>;
  /** Never cache these */
  neverCache: DecisionType[];
}

export const DEFAULT_CACHE_CONFIG: DecisionCacheConfig = {
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 500,
  ttlByType: {
    assign: 3 * 60 * 1000,      // 3 min - agent availability changes
    subdivide: 10 * 60 * 1000,  // 10 min - decomposition is stable
    escalate: 1 * 60 * 1000,    // 1 min - escalation needs fresh data
  },
  neverCache: ['reject'],  // Always recalculate rejections
};

// Alias for backwards compatibility
export const DECISION_CACHE_CONFIG = DEFAULT_CACHE_CONFIG;

// =============================================================================
// DECISION METRICS
// =============================================================================

export interface DecisionMetrics {
  totalDecisions: number;
  heuristicDecisions: number;
  cachedDecisions: number;
  llmDecisions: {
    short: number;
    medium: number;
    deep: number;
  };
  fallbackDecisions: number;
  averageConfidence: number;
  averageProcessingTimeMs: number;
  byDecisionType: Record<DecisionType, number>;
}

// =============================================================================
// COST OPTIMIZATION
// =============================================================================

/**
 * Operation modes for cost/quality tradeoff
 */
export const OPERATION_MODE = {
  /** Minimize LLM usage, aggressive caching, lower thresholds */
  ECONOMY: 'economy',
  /** Default balanced approach */
  BALANCED: 'balanced',
  /** Maximize quality, use LLM more freely */
  MAX_QUALITY: 'max_quality',
} as const;

export type OperationMode = (typeof OPERATION_MODE)[keyof typeof OPERATION_MODE];

/**
 * Configuration for each operation mode
 */
export interface OperationModeConfig {
  mode: OperationMode;
  /** Minimum confidence to skip LLM */
  heuristicConfidenceThreshold: number;
  /** Whether to allow LLM at all */
  enableLLM: boolean;
  /** Which tier is the maximum allowed */
  maxLLMTier: PromptTier;
  /** Cache aggressiveness */
  cacheConfig: {
    enabled: boolean;
    ttlMultiplier: number;  // 1.0 = default, 2.0 = double TTL, etc.
    minConfidenceToCache: number;
  };
  /** Skip LLM for retry attempts */
  skipLLMOnRetry: boolean;
  /** Skip LLM when agents are obvious match */
  skipLLMOnExactMatch: boolean;
  /** Force heuristics for known task types */
  forceHeuristicsForKnownTypes: boolean;
  /** Use compact prompts */
  useCompactPrompts: boolean;
}

export const OPERATION_MODE_CONFIGS: Record<OperationMode, OperationModeConfig> = {
  [OPERATION_MODE.ECONOMY]: {
    mode: OPERATION_MODE.ECONOMY,
    heuristicConfidenceThreshold: 0.5,  // Accept lower confidence from heuristics
    enableLLM: true,
    maxLLMTier: PROMPT_TIER.SHORT,      // Only SHORT tier
    cacheConfig: {
      enabled: true,
      ttlMultiplier: 2.0,               // Double TTL
      minConfidenceToCache: 0.4,        // Cache more aggressively
    },
    skipLLMOnRetry: true,
    skipLLMOnExactMatch: true,
    forceHeuristicsForKnownTypes: true,
    useCompactPrompts: true,
  },
  [OPERATION_MODE.BALANCED]: {
    mode: OPERATION_MODE.BALANCED,
    heuristicConfidenceThreshold: 0.7,  // Default threshold
    enableLLM: true,
    maxLLMTier: PROMPT_TIER.MEDIUM,     // Up to MEDIUM tier
    cacheConfig: {
      enabled: true,
      ttlMultiplier: 1.0,               // Default TTL
      minConfidenceToCache: 0.5,        // Standard caching
    },
    skipLLMOnRetry: true,
    skipLLMOnExactMatch: true,
    forceHeuristicsForKnownTypes: false,
    useCompactPrompts: false,
  },
  [OPERATION_MODE.MAX_QUALITY]: {
    mode: OPERATION_MODE.MAX_QUALITY,
    heuristicConfidenceThreshold: 0.85, // High threshold before skipping LLM
    enableLLM: true,
    maxLLMTier: PROMPT_TIER.DEEP,       // Full DEEP tier
    cacheConfig: {
      enabled: true,
      ttlMultiplier: 0.5,               // Shorter TTL, fresher decisions
      minConfidenceToCache: 0.7,        // Only cache high-quality
    },
    skipLLMOnRetry: false,
    skipLLMOnExactMatch: false,
    forceHeuristicsForKnownTypes: false,
    useCompactPrompts: false,
  },
};

/**
 * Token cost estimation by tier (approximate)
 */
export const TOKEN_COSTS = {
  /** Estimated input tokens per tier */
  inputTokens: {
    [PROMPT_TIER.SHORT]: 150,
    [PROMPT_TIER.MEDIUM]: 400,
    [PROMPT_TIER.DEEP]: 1200,
  },
  /** Estimated output tokens per tier */
  outputTokens: {
    [PROMPT_TIER.SHORT]: 100,
    [PROMPT_TIER.MEDIUM]: 250,
    [PROMPT_TIER.DEEP]: 800,
  },
  /** Cost per 1K tokens (Claude pricing estimate in USD) */
  costPer1KTokens: {
    input: 0.003,   // $3/M input tokens
    output: 0.015,  // $15/M output tokens
  },
} as const;

/**
 * Cost metrics for tracking
 */
export interface CostMetrics {
  /** Total estimated tokens used */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Estimated cost in USD */
  estimatedCostUSD: number;
  /** Breakdown by tier */
  byTier: {
    short: { count: number; inputTokens: number; outputTokens: number; cost: number };
    medium: { count: number; inputTokens: number; outputTokens: number; cost: number };
    deep: { count: number; inputTokens: number; outputTokens: number; cost: number };
  };
  /** Savings from not using LLM */
  tokensSaved: number;
  costSavedUSD: number;
  /** Percentage of decisions that avoided LLM */
  llmAvoidanceRate: number;
}

/**
 * Cache metrics for monitoring
 */
export interface CacheMetrics {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictions: number;
  byDecisionType: Partial<Record<DecisionType, { hits: number; misses: number }>>;
}

/**
 * Extended decision with cost info
 */
export interface DecisionWithCost extends StructuredDecision {
  /** Cost tracking */
  costInfo?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
    savedByHeuristic: boolean;
    savedByCache: boolean;
    /** Budget decision made before execution */
    budgetDecision?: 'allow' | 'warn' | 'block' | 'degrade';
    /** Budget scope that triggered decision */
    budgetScope?: 'task' | 'agent_daily' | 'global_daily';
  };
}

/**
 * Combined metrics including cost
 */
export interface ExtendedDecisionMetrics extends DecisionMetrics {
  cost: CostMetrics;
  cache: CacheMetrics;
  operationMode: OperationMode;
}

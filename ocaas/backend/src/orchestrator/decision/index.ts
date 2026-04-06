/**
 * Decision Module
 *
 * Provides intelligent task decision-making with:
 * - Heuristics-first approach
 * - Controlled LLM invocation with prompt tiers
 * - Decision caching
 * - Structured output
 */

// Types
export * from './types.js';

// Heuristic rules
export {
  HEURISTIC_RULES,
  evaluateHeuristics,
  matchCapabilities,
  findCapabilitySynonyms,
  CAPABILITY_SYNONYMS,
} from './HeuristicRules.js';

// Prompt tiers
export {
  getPromptBundle,
  getCompactPromptBundle,
  parseResponse,
  parseCompactResponse,
  determineTier,
  SYSTEM_PROMPT_SHORT,
  SYSTEM_PROMPT_MEDIUM,
  SYSTEM_PROMPT_DEEP,
  SYSTEM_PROMPT_COMPACT,
  type DecisionContext,
  type AgentContext,
  type TaskContext,
  type PromptBundle,
  type ShortResponse,
  type MediumResponse,
  type DeepResponse,
  type CompactResponse,
} from './PromptTiers.js';

// Cost tracking
export {
  CostTracker,
  getCostTracker,
  resetCostTracker,
  estimateTokenCost,
  getEstimatedTokensForTier,
} from './CostTracker.js';

// Smart decision engine
export {
  SmartDecisionEngine,
  getSmartDecisionEngine,
  resetSmartDecisionEngine,
  type SmartDecisionEngineConfig,
} from './SmartDecisionEngine.js';

// Decision validator (BLOQUE 5)
export {
  validateDecision,
  needsValidation,
  determineAction,
  VALIDATION_THRESHOLDS,
  type ValidationResult,
  type ValidationError,
  type ValidationErrorCode,
  type ValidatorConfig,
} from './DecisionValidator.js';

// Decision traceability
export {
  getDecisionTraceStore,
  resetDecisionTraceStore,
  buildDecisionTrace,
  type DecisionTrace,
  type DecisionOutcome,
  type FailureReason,
  type EvaluatedAgent,
  type DecisionTraceBuilder,
} from './DecisionTrace.js';

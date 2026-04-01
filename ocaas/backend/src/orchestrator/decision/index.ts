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
  parseResponse,
  determineTier,
  SYSTEM_PROMPT_SHORT,
  SYSTEM_PROMPT_MEDIUM,
  SYSTEM_PROMPT_DEEP,
  type DecisionContext,
  type AgentContext,
  type TaskContext,
  type PromptBundle,
  type ShortResponse,
  type MediumResponse,
  type DeepResponse,
} from './PromptTiers.js';

// Smart decision engine
export {
  SmartDecisionEngine,
  getSmartDecisionEngine,
  resetSmartDecisionEngine,
  type SmartDecisionEngineConfig,
} from './SmartDecisionEngine.js';

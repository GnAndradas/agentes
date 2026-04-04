/**
 * Decision Validator (BLOQUE 5)
 *
 * Validación determinista de decisiones antes de ejecutar.
 * IA interpreta → heurística valida → validador confirma → sistema decide.
 *
 * CRÍTICO: Ninguna decisión pasa sin validación.
 */

import { orchestratorLogger } from '../../utils/logger.js';
import { matchCapabilities } from './HeuristicRules.js';
import type { AgentDTO } from '../../types/domain.js';
import type { StructuredDecision, DecisionType, ConfidenceLevel } from './types.js';
import type { DecisionTraceability } from '../../types/contracts.js';

const logger = orchestratorLogger.child({ component: 'DecisionValidator' });

// ============================================================================
// VALIDATION RESULT
// ============================================================================

export interface ValidationResult {
  /** Validación exitosa */
  valid: boolean;

  /** Decisión original (puede ser modificada) */
  decision: StructuredDecision;

  /** Errores de validación */
  errors: ValidationError[];

  /** Warnings (no bloquean) */
  warnings: string[];

  /** Fallback aplicado */
  fallbackApplied: boolean;

  /** Tipo de fallback si aplica */
  fallbackType?: 'alternate_agent' | 'escalation' | 'resource_generation' | 'rejection';

  /** Trazabilidad de la decisión */
  traceability: DecisionTraceability;
}

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  field?: string;
  recoverable: boolean;
}

export type ValidationErrorCode =
  | 'agent_not_found'
  | 'agent_not_active'
  | 'agent_busy'
  | 'missing_capabilities'
  | 'policy_violation'
  | 'priority_mismatch'
  | 'autonomy_violation'
  | 'no_valid_target';

// ============================================================================
// CONFIDENCE THRESHOLDS
// ============================================================================

export const VALIDATION_THRESHOLDS = {
  /** Alta confianza: auto-asignar sin revisión */
  AUTO_ASSIGN: 0.8,
  /** Media confianza: validar doble, pero permitir */
  REQUIRE_DOUBLE_CHECK: 0.5,
  /** Baja confianza: fallback o aprobación */
  REQUIRE_FALLBACK: 0.4,
} as const;

// ============================================================================
// VALIDATOR
// ============================================================================

export interface ValidatorConfig {
  /** Require capability match for assignment */
  requireCapabilityMatch: boolean;
  /** Minimum capability coverage for auto-assign */
  minCapabilityCoverage: number;
  /** Allow busy agents for high priority tasks */
  allowBusyForHighPriority: boolean;
  /** Strict mode: any validation error blocks */
  strictMode: boolean;
}

const DEFAULT_VALIDATOR_CONFIG: ValidatorConfig = {
  requireCapabilityMatch: true,
  minCapabilityCoverage: 0.3,
  allowBusyForHighPriority: true,
  strictMode: false,
};

/**
 * Validate a decision before execution
 */
export function validateDecision(
  decision: StructuredDecision,
  agents: AgentDTO[],
  requiredCapabilities: string[] = [],
  config: Partial<ValidatorConfig> = {}
): ValidationResult {
  const cfg = { ...DEFAULT_VALIDATOR_CONFIG, ...config };
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  let validatedDecision = { ...decision };
  let fallbackApplied = false;
  let fallbackType: ValidationResult['fallbackType'];

  const startTime = Date.now();

  logger.debug({
    decisionId: decision.id,
    decisionType: decision.decisionType,
    targetAgent: decision.targetAgent,
    confidence: decision.confidenceScore,
  }, 'Validating decision');

  // -------------------------------------------------------------------------
  // VALIDATION CHECKS
  // -------------------------------------------------------------------------

  // 1. Agent existence check (if assigning)
  if (decision.decisionType === 'assign' && decision.targetAgent) {
    const agent = agents.find(a => a.id === decision.targetAgent);

    if (!agent) {
      errors.push({
        code: 'agent_not_found',
        message: `Agent ${decision.targetAgent} not found`,
        field: 'targetAgent',
        recoverable: true,
      });
    } else {
      // 2. Agent status check
      if (agent.status !== 'active') {
        if (agent.status === 'busy') {
          // Busy is a warning unless strict mode
          if (cfg.strictMode) {
            errors.push({
              code: 'agent_busy',
              message: `Agent ${agent.name} is busy`,
              field: 'targetAgent',
              recoverable: true,
            });
          } else {
            warnings.push(`Agent ${agent.name} is busy, may cause delay`);
          }
        } else {
          errors.push({
            code: 'agent_not_active',
            message: `Agent ${agent.name} is ${agent.status}`,
            field: 'targetAgent',
            recoverable: true,
          });
        }
      }

      // 3. Capability match check
      if (cfg.requireCapabilityMatch && requiredCapabilities.length > 0) {
        const coverage = matchCapabilities(requiredCapabilities, agent.capabilities || []);

        if (coverage < cfg.minCapabilityCoverage) {
          errors.push({
            code: 'missing_capabilities',
            message: `Agent ${agent.name} has ${(coverage * 100).toFixed(0)}% capability coverage (min: ${(cfg.minCapabilityCoverage * 100).toFixed(0)}%)`,
            field: 'capabilities',
            recoverable: true,
          });
        } else if (coverage < 0.7) {
          warnings.push(`Agent ${agent.name} has partial capability match (${(coverage * 100).toFixed(0)}%)`);
        }
      }
    }
  }

  // 4. Confidence threshold check
  if (decision.confidenceScore < VALIDATION_THRESHOLDS.REQUIRE_FALLBACK) {
    warnings.push(`Low confidence (${(decision.confidenceScore * 100).toFixed(0)}%) - consider fallback`);
  }

  // -------------------------------------------------------------------------
  // FALLBACK LOGIC
  // -------------------------------------------------------------------------

  const hasRecoverableErrors = errors.some(e => e.recoverable);

  if (hasRecoverableErrors) {
    const fallbackResult = applyFallback(decision, agents, errors, requiredCapabilities);

    if (fallbackResult.success) {
      validatedDecision = fallbackResult.decision;
      fallbackApplied = true;
      fallbackType = fallbackResult.fallbackType;

      // Clear recoverable errors since fallback handled them
      errors.length = 0;
      errors.push(...fallbackResult.remainingErrors);

      logger.info({
        decisionId: decision.id,
        fallbackType,
        newTarget: validatedDecision.targetAgent,
      }, 'Fallback applied successfully');
    }
  }

  // -------------------------------------------------------------------------
  // BUILD TRACEABILITY
  // -------------------------------------------------------------------------

  const traceability: DecisionTraceability = {
    decision_source: determineSource(decision, fallbackApplied),
    decision_confidence: validatedDecision.confidenceScore,
    decision_validated: errors.length === 0,
    heuristic_method: decision.method === 'heuristic' ? 'rules' : undefined,
    ai_model: decision.llmTier ? `tier_${decision.llmTier}` : undefined,
    decided_at: decision.decidedAt,
    execution_time_ms: Date.now() - startTime,
    decision_reason: validatedDecision.reasoning,
  };

  // -------------------------------------------------------------------------
  // FINAL RESULT
  // -------------------------------------------------------------------------

  const valid = errors.length === 0;

  logger.info({
    decisionId: decision.id,
    valid,
    errorCount: errors.length,
    warningCount: warnings.length,
    fallbackApplied,
    fallbackType,
  }, 'Decision validation complete');

  return {
    valid,
    decision: validatedDecision,
    errors,
    warnings,
    fallbackApplied,
    fallbackType,
    traceability,
  };
}

// ============================================================================
// FALLBACK LOGIC
// ============================================================================

interface FallbackResult {
  success: boolean;
  decision: StructuredDecision;
  fallbackType: ValidationResult['fallbackType'];
  remainingErrors: ValidationError[];
}

function applyFallback(
  decision: StructuredDecision,
  agents: AgentDTO[],
  errors: ValidationError[],
  requiredCapabilities: string[]
): FallbackResult {
  const activeAgents = agents.filter(a => a.status === 'active');
  const remainingErrors: ValidationError[] = [];

  // Try alternate agent
  if (decision.decisionType === 'assign') {
    // Find best alternate agent
    const alternates = activeAgents
      .filter(a => a.id !== decision.targetAgent)
      .map(a => ({
        agent: a,
        score: matchCapabilities(requiredCapabilities, a.capabilities || []),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (alternates.length > 0) {
      const best = alternates[0]!;
      return {
        success: true,
        decision: {
          ...decision,
          targetAgent: best.agent.id,
          reasoning: `${decision.reasoning} [Fallback: alternate agent "${best.agent.name}"]`,
          confidenceScore: Math.min(decision.confidenceScore, best.score),
        },
        fallbackType: 'alternate_agent',
        remainingErrors: [],
      };
    }

    // No alternate agent - try escalation
    if (activeAgents.length === 0) {
      return {
        success: true,
        decision: {
          ...decision,
          decisionType: 'escalate',
          targetAgent: undefined,
          reasoning: `${decision.reasoning} [Fallback: escalation - no valid agents]`,
          requiresEscalation: true,
          confidenceScore: 0.9,
        },
        fallbackType: 'escalation',
        remainingErrors: [],
      };
    }

    // Try resource generation
    const needsCapabilities = errors.some(e => e.code === 'missing_capabilities');
    if (needsCapabilities) {
      return {
        success: true,
        decision: {
          ...decision,
          decisionType: 'create_resource',
          targetAgent: undefined,
          reasoning: `${decision.reasoning} [Fallback: resource generation - missing capabilities]`,
          missingCapabilities: requiredCapabilities,
          confidenceScore: 0.8,
        },
        fallbackType: 'resource_generation',
        remainingErrors: [],
      };
    }
  }

  // No fallback available - return original errors
  return {
    success: false,
    decision,
    fallbackType: 'rejection',
    remainingErrors: errors,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function determineSource(
  decision: StructuredDecision,
  fallbackApplied: boolean
): DecisionTraceability['decision_source'] {
  if (fallbackApplied) {
    return 'heuristic'; // Fallback is always heuristic
  }

  switch (decision.method) {
    case 'heuristic':
    case 'fallback':
      return 'heuristic';
    case 'llm_classify':
    case 'llm_decide':
    case 'llm_plan':
      return 'ai';
    case 'cached':
      return 'heuristic'; // Cached decisions were originally heuristic or AI
    default:
      return 'hybrid';
  }
}

/**
 * Quick check if decision needs validation
 */
export function needsValidation(decision: StructuredDecision): boolean {
  // Always validate assignments
  if (decision.decisionType === 'assign') return true;

  // Validate low confidence decisions
  if (decision.confidenceScore < VALIDATION_THRESHOLDS.AUTO_ASSIGN) return true;

  // Skip validation for escalations (already a safe action)
  if (decision.decisionType === 'escalate') return false;

  return true;
}

/**
 * Determine action based on confidence
 */
export function determineAction(
  confidence: number
): 'auto_assign' | 'double_check' | 'require_fallback' | 'require_approval' {
  if (confidence >= VALIDATION_THRESHOLDS.AUTO_ASSIGN) {
    return 'auto_assign';
  }
  if (confidence >= VALIDATION_THRESHOLDS.REQUIRE_DOUBLE_CHECK) {
    return 'double_check';
  }
  if (confidence >= VALIDATION_THRESHOLDS.REQUIRE_FALLBACK) {
    return 'require_fallback';
  }
  return 'require_approval';
}

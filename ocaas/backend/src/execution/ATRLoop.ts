/**
 * Autonomous Task Resolution (ATR) Loop
 *
 * Implements intelligent retry when tools are available but not used.
 * Uses ONLY structured data (no text parsing/heuristics).
 *
 * DESIGN:
 * - Max 2 retries to avoid infinite loops
 * - Classification based on runtime events and verification data
 * - Escalates to human if no progress after retries
 */

import { createLogger } from '../utils/logger.js';
import type { ResolutionReason } from './ExecutionTraceability.js';

const logger = createLogger('ATRLoop');

/** Maximum resolution attempts (excluding initial attempt) */
export const ATR_MAX_RETRIES = 2;

/**
 * ATR evaluation input - structured data only
 */
export interface ATREvaluationInput {
  /** Were tools assigned to this execution? */
  tools_available: boolean;

  /** Tool IDs that were available */
  tool_ids: string[];

  /** Did we get a response? */
  has_response: boolean;

  /** Response content (for valid bypass detection only) */
  response_content?: string;

  /**
   * Runtime events from progress-tracker hook
   * Only check for tool:call / tool:result events
   */
  runtime_events?: Array<{
    event: string;
    [key: string]: unknown;
  }>;

  /**
   * Current tool usage verification status
   * From ToolUsageVerificationService
   */
  tool_usage_status?: 'verified' | 'unverified' | 'unknown';
}

/**
 * ATR evaluation result
 */
export interface ATREvaluationResult {
  /** Should we retry? */
  should_retry: boolean;

  /** Classification reason */
  reason: ResolutionReason;

  /** Human-readable explanation */
  explanation: string;

  /** Is tool usage verified? */
  tool_used_verified: boolean;
}

/**
 * ATR Loop state for tracking across retries
 */
export interface ATRLoopState {
  /** Current attempt number (0 = initial, 1+ = retries) */
  attempt: number;

  /** History of attempts */
  history: Array<{
    attempt: number;
    reason: ResolutionReason;
    action: 'retry' | 'escalate' | 'accept';
    tool_used_after?: boolean;
  }>;

  /** Has the loop completed? */
  completed: boolean;

  /** Final status */
  final_status?: 'success' | 'partial' | 'failed';

  /** Requires human? */
  requires_human: boolean;

  /** Human escalation reason */
  human_reason?: ResolutionReason;
}

/**
 * Create initial ATR loop state
 */
export function createATRState(): ATRLoopState {
  return {
    attempt: 0,
    history: [],
    completed: false,
    requires_human: false,
  };
}

/**
 * Evaluate if ATR retry is needed
 *
 * RULES (no heuristics):
 * 1. If tools_available = false → not_applicable
 * 2. If tool_used_verified = true → success (no retry needed)
 * 3. If runtime_events contains tool:call → check for tool:result
 * 4. If no tool:call and response indicates bypass → tool_not_applicable
 * 5. Otherwise → tool_not_attempted (retry candidate)
 */
export function evaluateATR(input: ATREvaluationInput): ATREvaluationResult {
  // Case 1: No tools available - not applicable
  if (!input.tools_available || input.tool_ids.length === 0) {
    return {
      should_retry: false,
      reason: 'unknown',
      explanation: 'No tools were available for this execution',
      tool_used_verified: false,
    };
  }

  // Case 2: Tool usage verified - success
  if (input.tool_usage_status === 'verified') {
    return {
      should_retry: false,
      reason: 'unknown', // Not a failure reason
      explanation: 'Tool usage verified via runtime events',
      tool_used_verified: true,
    };
  }

  // Case 3: Check runtime events for tool:call
  const hasToolCall = input.runtime_events?.some(e => e.event === 'tool:call');
  const hasToolResult = input.runtime_events?.some(e => e.event === 'tool:result');

  if (hasToolCall) {
    if (hasToolResult) {
      // Tool was called and got result - partial success
      return {
        should_retry: false,
        reason: 'unknown',
        explanation: 'Tool call detected with result in runtime events',
        tool_used_verified: true,
      };
    } else {
      // Tool was called but no result - might have failed
      return {
        should_retry: true,
        reason: 'tool_failed',
        explanation: 'Tool call detected but no result in runtime events',
        tool_used_verified: false,
      };
    }
  }

  // Case 4: Check for valid bypass patterns in response
  if (input.has_response && input.response_content) {
    const bypassResult = detectValidToolBypass(input.response_content);
    if (bypassResult.valid) {
      return {
        should_retry: false,
        reason: 'tool_not_applicable',
        explanation: bypassResult.reason || 'Model indicated tools not applicable',
        tool_used_verified: false,
      };
    }
  }

  // Case 5: No tool:call, no valid bypass - should retry
  return {
    should_retry: true,
    reason: 'tool_not_attempted',
    explanation: 'Tools available but no tool:call detected in runtime events',
    tool_used_verified: false,
  };
}

/**
 * Check if response indicates valid tool bypass
 *
 * Only checks for EXPLICIT statements, not heuristic text matching.
 * Returns valid=true only for clear, unambiguous bypass indicators.
 */
function detectValidToolBypass(response: string): { valid: boolean; reason?: string } {
  const lowerResponse = response.toLowerCase();

  // Explicit bypass patterns (strict, not heuristic)
  const explicitPatterns = [
    { pattern: /cannot use.*tool/i, reason: 'explicit_cannot_use' },
    { pattern: /tool.*not.*applicable/i, reason: 'explicit_not_applicable' },
    { pattern: /no.*tool.*available.*for.*this/i, reason: 'explicit_no_tool' },
    { pattern: /tools?.*(?:error|failed|exception)/i, reason: 'tool_error_reported' },
  ];

  for (const { pattern, reason } of explicitPatterns) {
    if (pattern.test(response)) {
      return { valid: true, reason };
    }
  }

  return { valid: false };
}

/**
 * Process ATR loop iteration
 *
 * @param state Current ATR state
 * @param evaluation Evaluation result from evaluateATR
 * @returns Updated state with action to take
 */
export function processATRIteration(
  state: ATRLoopState,
  evaluation: ATREvaluationResult
): { state: ATRLoopState; action: 'retry' | 'escalate' | 'accept' } {
  const newState = { ...state };

  // Determine action
  let action: 'retry' | 'escalate' | 'accept';

  if (evaluation.tool_used_verified) {
    // Success - tool was used
    action = 'accept';
    newState.final_status = 'success';
    newState.completed = true;
  } else if (!evaluation.should_retry) {
    // No retry needed (tool not applicable or other valid reason)
    action = 'accept';
    newState.final_status = 'partial';
    newState.completed = true;
  } else if (state.attempt >= ATR_MAX_RETRIES) {
    // Max retries exhausted
    action = 'escalate';
    newState.final_status = 'failed';
    newState.completed = true;
    newState.requires_human = true;
    newState.human_reason = evaluation.reason;
  } else {
    // Retry
    action = 'retry';
    newState.attempt++;
  }

  // Record in history
  newState.history.push({
    attempt: state.attempt,
    reason: evaluation.reason,
    action,
    tool_used_after: evaluation.tool_used_verified,
  });

  logger.info({
    attempt: state.attempt,
    action,
    reason: evaluation.reason,
    tool_used_verified: evaluation.tool_used_verified,
    final_status: newState.final_status,
  }, 'ATR iteration processed');

  return { state: newState, action };
}

/**
 * Build retry prompt suffix for ATR
 *
 * Adds clear instruction to use tools without being too aggressive.
 */
export function buildATRRetryPrompt(attempt: number, reason: ResolutionReason): string {
  return `

## Tool Execution Required (Attempt ${attempt + 1}/${ATR_MAX_RETRIES + 1})

Your previous response did not include tool execution.
Reason: ${reason}

**Please:**
1. Use the available tools to complete this task
2. If tools cannot help, explain specifically why
3. Do not provide a text-only response if tools can accomplish the goal

Available tools are listed above. Execute them using: \`run_command: <command>\`
`;
}

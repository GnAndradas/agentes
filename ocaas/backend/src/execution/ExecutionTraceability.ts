/**
 * Execution Traceability Module (BLOQUE 10)
 *
 * Defines REAL execution modes and provides honest traceability
 * of what actually happens during job execution.
 *
 * EXECUTION MODES (HONEST):
 * - chat_completion: Uses OpenAI-compatible /v1/chat/completions endpoint
 * - stub: OpenClaw not configured/connected, execution simulated or failed
 * - real_agent: Would use actual OpenClaw agent session (NOT IMPLEMENTED YET)
 *
 * IMPORTANT: Currently ALL executions use chat_completion, NOT real agents.
 * The "spawn" method creates a local session ID but does NOT start a real OpenClaw agent.
 */

import { createLogger } from '../utils/logger.js';
import {
  computeMaterializationStatus,
  type AgentMaterializationStatus,
} from '../generator/AgentMaterialization.js';

const logger = createLogger('ExecutionTraceability');

// ============================================================================
// EXECUTION MODES
// ============================================================================

/**
 * Real execution mode - HONEST about what actually happens
 */
export type ExecutionMode =
  | 'hooks_session'    // PRIMARY: Uses /hooks/agent with sessionKey (stateful)
  | 'chat_completion'  // FALLBACK: Uses /v1/chat/completions (stateless)
  | 'stub'             // OpenClaw not available, stub response
  | 'real_agent';      // Would use actual OpenClaw agent (legacy, NOT IMPLEMENTED)

/**
 * Execution Truth Level
 */
export type TruthLevel =
  | 'real'      // Confirmed real execution (hooks or chat_completion with response)
  | 'fallback'  // Fallback used (async timeout or similar)
  | 'stub'      // No real execution (gateway down or stub mode)
  | 'uncertain'; // Evidence is missing or contradictory

/**
 * Execution transport used
 */
export type ExecutionTransport =
  | 'hooks_agent'      // PRIMARY: HTTP POST to /hooks/agent with sessionKey
  | 'rest_api'         // FALLBACK: HTTP POST to /v1/chat/completions
  | 'websocket_rpc'    // WebSocket RPC (for session management only)
  | 'webhook'          // Fire-and-forget webhook (notifications)
  | 'none';            // No transport (stub)

// ============================================================================
// EXECUTION TRACEABILITY
// ============================================================================

/**
 * Full traceability of job execution
 */
export interface ExecutionTraceability {
  /** Actual execution mode used */
  execution_mode: ExecutionMode;

  /** Transport mechanism used */
  transport: ExecutionTransport;

  /** Agent ID from OCAAS */
  target_agent_id: string;

  /** OpenClaw session ID (if any - legacy local ID) */
  openclaw_session_id?: string;

  /** Session key for hooks_session mode (hook:ocaas:task-{id} or hook:ocaas:job-{id}) */
  session_key?: string;

  /** Was agent runtime_ready at execution time? */
  runtime_ready_at_execution: boolean;

  /** Agent materialization status at execution time */
  agent_materialization_status?: AgentMaterializationStatus;

  /** Gateway configured */
  gateway_configured: boolean;

  /** Gateway connected at execution time */
  gateway_connected: boolean;

  /** WebSocket connected at execution time */
  websocket_connected: boolean;

  /** Transport succeeded (request sent) */
  transport_success: boolean;

  /** Async accepted (hooks_session mode: request accepted, response via channel) */
  accepted_async: boolean;

  /** Async timeout triggered (accepted_async but no response within timeout) */
  async_timeout_triggered?: boolean;
  async_timeout_ms?: number;

  /** PROMPT 11: Agent warmup attempted before execution */
  agent_warmup_attempted?: boolean;
  agent_warmup_success?: boolean;

  /** Fallback used (and why) */
  execution_fallback_used: boolean;
  execution_fallback_reason?: string;

  /** Execution timestamps */
  execution_started_at: number;
  execution_completed_at?: number;

  /** Response info */
  response_received: boolean;

  /** AI Generated info (Confirmed by provider) */
  ai_generated: boolean;
  ai_provider?: string;
  response_tokens?: {
    input: number;
    output: number;
  };

  /** Gap explanation */
  gap?: string;

  // ==========================================================================
  // RESOURCE TRACEABILITY (skills/tools)
  // ==========================================================================

  /** Resources assigned to the agent for this execution */
  resources_assigned?: {
    tools: string[];
    skills: string[];
  };

  /** Resources actually injected into the request */
  resources_injected?: {
    tools: string[];
    skills: string[];
    /** How resources were injected */
    injection_mode: 'native' | 'prompt' | 'none';
    /**
     * Definition mode: describes what was actually sent
     * - 'full_definitions': Complete tool/skill definitions (executable)
     * - 'ids_only': Only IDs sent (informational, not executable)
     * - 'none': No resources injected
     */
    definition_mode?: 'full_definitions' | 'ids_only' | 'none';
    /** Number of executable tool definitions sent */
    executable_tools_count?: number;
    /** Number of executable skill definitions sent */
    executable_skills_count?: number;
    /** Names of executable tools (for debugging) */
    executable_tool_names?: string[];
  };

  /**
   * Resource usage verification status
   *
   * IMPORTANT: This field follows strict contractual verification.
   * - verified = true ONLY if OpenClaw returns explicit structured confirmation
   * - verified = false if no structured confirmation exists (current state)
   *
   * DO NOT use heuristics, text parsing, or inference to set verified = true.
   * DO NOT assume injected = used.
   */
  resources_usage?: {
    /** Is resource usage verified by structured runtime confirmation? */
    verified: boolean;

    /**
     * Source of verification
     * - 'runtime_receipt': OpenClaw returned resources_used field (NOT SUPPORTED YET)
     * - 'unverified': No structured confirmation available
     */
    verification_source: 'runtime_receipt' | 'unverified';

    /**
     * Tools confirmed as used by runtime (ONLY if verified = true)
     * Empty if verified = false - never infer from text
     */
    tools_used: string[];

    /**
     * Skills confirmed as used by runtime (ONLY if verified = true)
     * Empty if verified = false - never infer from text
     */
    skills_used: string[];

    /**
     * Explanation when verified = false
     */
    unverified_reason?: string;
  };

  // ==========================================================================
  // TOOL-FIRST POLICY (Increase tool usage when appropriate)
  // ==========================================================================

  /**
   * Tool execution policy applied to this execution.
   * - 'standard': Normal execution, tools available but not prioritized
   * - 'tool_first': Explicit instruction to attempt tools before direct response
   */
  tool_policy?: 'standard' | 'tool_first';

  /**
   * Whether the agent attempted to use tools during execution.
   * This is SEPARATE from verified usage - it tracks intent/attempt.
   *
   * Values:
   * - true: Evidence of tool attempt (runtime events show tool:call or similar)
   * - false: No evidence of tool attempt (no tool events in runtime)
   * - undefined: Unknown (no runtime events available to check)
   *
   * IMPORTANT: tool_attempted=true does NOT mean tool_used_verified=true
   * An attempt may fail, be rejected, or not complete.
   */
  tool_attempted?: boolean;

  /**
   * Reason if tools were not attempted when tool_first policy was active.
   * Only populated when tool_policy='tool_first' AND tool_attempted=false.
   */
  tool_not_attempted_reason?: string;

  // ==========================================================================
  // TOOL ENFORCEMENT (Force tool execution when tools_available)
  // ==========================================================================

  /**
   * Whether tool enforcement was active for this execution.
   * true = system blocked direct responses and required tool attempt
   */
  tool_enforced?: boolean;

  /**
   * Whether enforcement was triggered (model tried to respond without tool).
   * true = initial response was rejected, retry was issued
   */
  tool_enforcement_triggered?: boolean;

  /**
   * Number of enforcement retry attempts made.
   * 0 = no retries needed (model used tool on first try)
   * 1+ = retries needed due to model bypassing tools
   */
  enforcement_attempts?: number;

  /**
   * Final enforcement result after all retries.
   * - 'success': Tool was eventually attempted
   * - 'failed': Max retries reached, model refused tools
   * - 'not_applicable': Enforcement not active (no tools available)
   */
  enforcement_result?: 'success' | 'failed' | 'not_applicable';

  // ==========================================================================
  // AUTONOMOUS TASK RESOLUTION (ATR Loop)
  // ==========================================================================

  /**
   * Number of resolution attempts made (0 = first attempt only, no retries)
   */
  resolution_attempts?: number;

  /**
   * Path of resolution attempts with classification
   */
  resolution_path?: Array<{
    attempt: number;
    reason: ResolutionReason;
    action: 'retry' | 'escalate' | 'accept';
    tool_used_after?: boolean;
  }>;

  /**
   * Final resolution status after all attempts
   * - 'success': Task completed with tool execution verified
   * - 'partial': Task completed but tool usage unverified
   * - 'failed': Max retries exhausted, no useful progress
   */
  final_resolution_status?: 'success' | 'partial' | 'failed';

  /**
   * Whether human intervention is required
   */
  requires_human_intervention?: boolean;

  /**
   * Reason for human escalation (only if requires_human_intervention = true)
   */
  human_escalation_reason?: ResolutionReason;

  // ==========================================================================
  // REAL TOOL EXECUTION (Backend-controlled execution)
  // ==========================================================================

  /**
   * Whether a tool was executed by OCAAS backend (not LLM-side)
   * This tracks REAL execution via ToolExecutionService
   */
  tool_execution_real?: boolean;

  /**
   * Details of real tool execution
   */
  tool_execution_details?: {
    /** Execution ID from ToolExecutionService */
    execution_id: string;
    /** Tool name executed */
    tool_name: string;
    /** Tool type: api, script, binary, builtin */
    tool_type: 'api' | 'script' | 'binary' | 'builtin';
    /** Execution success */
    success: boolean;
    /** Duration in milliseconds */
    duration_ms: number;
    /** Had tool definition (dynamic execution) vs builtin */
    had_definition: boolean;
    /** Error code if failed */
    error_code?: string;
    /** Error message if failed */
    error_message?: string;
  };

  /**
   * Follow-up AI call after tool execution
   */
  tool_followup_call?: {
    /** Was a follow-up call made to interpret tool result? */
    made: boolean;
    /** Follow-up call succeeded */
    success: boolean;
    /** Follow-up tokens used */
    tokens?: {
      input: number;
      output: number;
    };
  };

  // ==========================================================================
  // TOOL SECURITY (Security validation for real tool execution)
  // ==========================================================================

  /**
   * Was security check performed before tool execution?
   */
  tool_security_checked?: boolean;

  /**
   * Did security check pass?
   */
  tool_security_passed?: boolean;

  /**
   * Security failure reason (if blocked)
   */
  security_failure_reason?: string;

  /**
   * Security failure code (structured)
   */
  security_failure_code?: 'policy_missing' | 'policy_disabled' | 'path_not_allowed' | 'path_traversal' |
    'path_not_found' | 'host_not_allowed' | 'method_not_allowed' | 'network_not_allowed' |
    'filesystem_not_allowed' | 'binary_not_allowed' | 'timeout_exceeded' | 'input_validation_failed';

  /**
   * Was a security policy applied?
   */
  security_policy_applied?: boolean;

  // =========================================================================
  // INPUT VALIDATION (BLOQUE 10.2)
  // =========================================================================

  /**
   * Was input validation performed?
   */
  input_validation_checked?: boolean;

  /**
   * Did input validation pass?
   */
  input_validation_passed?: boolean;

  /**
   * Was a schema used for validation?
   */
  input_schema_used?: boolean;

  /**
   * Validation errors (if any)
   */
  input_validation_errors?: string[];

  // =========================================================================
  // EXECUTION LIMITS (BLOQUE 10.3)
  // =========================================================================

  /**
   * Was execution blocked by limits?
   */
  execution_limit_blocked?: boolean;

  /**
   * Which limit was exceeded?
   */
  limit_exceeded?: 'max_executions' | 'max_time' | 'max_concurrent' | 'max_retries';

  /**
   * Current execution count for this task
   */
  task_execution_count?: number;

  /**
   * Total execution time for this task (ms)
   */
  task_total_execution_ms?: number;

  // =========================================================================
  // AUDIT (BLOQUE 10.4)
  // =========================================================================

  /**
   * Audit entry ID (for cross-referencing)
   */
  audit_entry_id?: string;
}

/**
 * Resolution reason classification (no heuristics, based on structured data)
 */
export type ResolutionReason =
  | 'tool_not_attempted'    // tools_available but no tool:call in runtime
  | 'tool_failed'           // tool:call exists but tool:result indicates failure
  | 'tool_not_applicable'   // model explicitly stated tools don't apply
  | 'external_block'        // blocked by external dependency
  | 'unknown';

/**
 * Default execution traceability (not yet executed)
 */
export const DEFAULT_EXECUTION_TRACEABILITY: ExecutionTraceability = {
  execution_mode: 'stub',
  transport: 'none',
  target_agent_id: '',
  runtime_ready_at_execution: false,
  gateway_configured: false,
  gateway_connected: false,
  websocket_connected: false,
  transport_success: false,
  accepted_async: false,
  execution_fallback_used: false,
  execution_started_at: 0,
  response_received: false,
  ai_generated: false,
  resources_assigned: { tools: [], skills: [] },
};

// ============================================================================
// EXECUTION MODE DETECTION
// ============================================================================

/**
 * Execution mode detection result
 */
export interface ExecutionModeInfo {
  mode: ExecutionMode;
  transport: ExecutionTransport;
  available: boolean;
  reason: string;
  fallback_available: boolean;
}

/**
 * Detect actual execution mode based on gateway status
 *
 * Priority:
 * 1. hooks_session (if hooksToken configured)
 * 2. chat_completion (fallback)
 * 3. stub (if nothing works)
 */
export function detectExecutionMode(
  gatewayConfigured: boolean,
  gatewayConnected: boolean,
  wsConnected: boolean,
  hooksConfigured: boolean = false
): ExecutionModeInfo {
  // Not configured at all
  if (!gatewayConfigured) {
    return {
      mode: 'stub',
      transport: 'none',
      available: false,
      reason: 'OpenClaw gateway not configured (missing OPENCLAW_API_KEY)',
      fallback_available: false,
    };
  }

  // Configured but not connected
  if (!gatewayConnected) {
    return {
      mode: 'stub',
      transport: 'none',
      available: false,
      reason: 'OpenClaw gateway not connected (REST API unreachable)',
      fallback_available: false,
    };
  }

  // PRIMARY: hooks_session if hooks are configured
  if (hooksConfigured) {
    return {
      mode: 'hooks_session',
      transport: 'hooks_agent',
      available: true,
      reason: 'Using /hooks/agent with sessionKey (stateful session). ' +
              'Fallback to chat_completion if hooks fail.',
      fallback_available: true,
    };
  }

  // FALLBACK: chat_completion
  return {
    mode: 'chat_completion',
    transport: 'rest_api',
    available: true,
    reason: 'Using /v1/chat/completions endpoint (stateless). ' +
            'Configure OPENCLAW_HOOKS_TOKEN for hooks_session mode.',
    fallback_available: false,
  };
}

/**
 * Check if execution mode is "real" (actually does something)
 */
export function isRealExecution(mode: ExecutionMode): boolean {
  return mode === 'hooks_session' || mode === 'chat_completion' || mode === 'real_agent';
}

/**
 * Verify execution truth based on traceability evidence
 */
export function verifyExecutionTruth(trace: ExecutionTraceability): {
  level: TruthLevel;
  reason: string;
  isReal: boolean;
} {
  // 1. Stub is never real
  if (trace.execution_mode === 'stub') {
    return {
      level: 'stub',
      reason: trace.execution_fallback_reason || 'Execution mode is stub',
      isReal: false,
    };
  }

  // 2. Check for real AI activity signs
  const hasResponse = trace.response_received;
  const hasTransportSuccess = trace.transport_success;
  const fallbackUsed = trace.execution_fallback_used;

  // Real execution requirements:
  // - Transport succeeded
  // - Response received
  // - AI generation confirmed (LAST GAP CLOSED)
  // - Fallback NOT used (or fallback was to another real mode)
  if (hasTransportSuccess && hasResponse && trace.ai_generated) {
    if (fallbackUsed) {
      return {
        level: 'fallback',
        reason: `Fallback used (${trace.execution_mode}), but AI generation confirmed`,
        isReal: true,
      };
    }

    return {
      level: 'real',
      reason: `Verified AI execution via ${trace.execution_mode} (${trace.ai_provider || 'default'})`,
      isReal: true,
    };
  }

  // Fallback case: Response received but AI generation NOT confirmed or uncertain
  if (hasResponse && !trace.ai_generated) {
    return {
      level: 'fallback',
      reason: 'Response received but AI generation could not be verified (possible stub/hardcoded)',
      isReal: false,
    };
  }

  // 3. Accepted async is real-intent but incomplete
  if (trace.accepted_async && !hasResponse) {
    return {
      level: 'uncertain',
      reason: 'Job accepted async but no response received yet',
      isReal: true, // Intent is real
    };
  }

  return {
    level: 'uncertain',
    reason: 'Incomplete execution evidence',
    isReal: false,
  };
}

/**
 * Get human-readable description of execution mode
 */
export function getExecutionModeDescription(mode: ExecutionMode): string {
  switch (mode) {
    case 'hooks_session':
      return 'Hooks session via /hooks/agent with sessionKey (stateful)';
    case 'chat_completion':
      return 'Chat completion via /v1/chat/completions (stateless fallback)';
    case 'stub':
      return 'Stub/mock execution (OpenClaw not available)';
    case 'real_agent':
      return 'Real OpenClaw agent session (legacy, NOT IMPLEMENTED)';
    default:
      return 'Unknown execution mode';
  }
}

// ============================================================================
// RUNTIME READY CHECK
// ============================================================================

/**
 * Result of runtime_ready check before execution
 */
export interface RuntimeReadyCheck {
  /** Agent is ready for execution */
  ready: boolean;

  /** Reason if not ready */
  reason?: string;

  /** Current lifecycle state */
  lifecycle_state: string;

  /** Materialization status */
  materialization_status?: AgentMaterializationStatus;

  /** Can proceed with fallback? */
  can_proceed_with_fallback: boolean;

  /** Fallback execution mode */
  fallback_mode?: ExecutionMode;
}

/**
 * Check if agent is runtime_ready before execution
 *
 * IMPORTANT: runtime_ready = true ONLY if:
 * - Gateway is configured and connected
 * - AND (has openclaw_session OR execution_mode != 'hooks_session')
 *
 * For hooks_session without openclaw_session: runtime_ready = false
 * (but can_proceed_with_fallback = true if chat_completion available)
 */
export function checkRuntimeReady(
  agentName: string,
  agentSessionId: string | undefined,
  gatewayConfigured: boolean,
  gatewayConnected: boolean,
  executionMode: ExecutionMode = 'chat_completion'
): RuntimeReadyCheck {
  // Compute materialization status
  const matStatus = computeMaterializationStatus(
    agentName,
    true, // has DB record
    true, // assume generation active (we're executing)
    agentSessionId
  );

  // Gateway not configured
  if (!gatewayConfigured) {
    return {
      ready: false,
      reason: 'OpenClaw gateway not configured',
      lifecycle_state: matStatus.state,
      materialization_status: matStatus,
      can_proceed_with_fallback: false,
      fallback_mode: 'stub',
    };
  }

  // Gateway not connected
  if (!gatewayConnected) {
    return {
      ready: false,
      reason: 'OpenClaw gateway not connected',
      lifecycle_state: matStatus.state,
      materialization_status: matStatus,
      can_proceed_with_fallback: false,
      fallback_mode: 'stub',
    };
  }

  // For hooks_session: runtime_ready requires actual session
  // For chat_completion: ready if gateway connected
  const hasOpenclawSession = !!agentSessionId;

  if (executionMode === 'hooks_session' && !hasOpenclawSession) {
    // hooks_session mode but no session - NOT runtime_ready
    // but CAN proceed with chat_completion fallback
    return {
      ready: false,
      reason: 'hooks_session mode requires openclaw_session',
      lifecycle_state: matStatus.state,
      materialization_status: matStatus,
      can_proceed_with_fallback: true,
      fallback_mode: 'chat_completion',
    };
  }

  // Ready for execution
  return {
    ready: true,
    lifecycle_state: matStatus.state,
    materialization_status: matStatus,
    can_proceed_with_fallback: true,
    fallback_mode: 'chat_completion',
  };
}

// ============================================================================
// TRACEABILITY BUILDER
// ============================================================================

/**
 * Builder for execution traceability
 */
export class ExecutionTraceabilityBuilder {
  private trace: ExecutionTraceability;

  constructor(agentId: string) {
    this.trace = {
      ...DEFAULT_EXECUTION_TRACEABILITY,
      target_agent_id: agentId,
      execution_started_at: Date.now(),
    };
  }

  /** Set execution mode */
  mode(mode: ExecutionMode, transport: ExecutionTransport): this {
    this.trace.execution_mode = mode;
    this.trace.transport = transport;
    return this;
  }

  /** Set gateway status */
  gatewayStatus(configured: boolean, connected: boolean, wsConnected: boolean): this {
    this.trace.gateway_configured = configured;
    this.trace.gateway_connected = connected;
    this.trace.websocket_connected = wsConnected;
    return this;
  }

  /** Set runtime ready status */
  runtimeReady(ready: boolean, matStatus?: AgentMaterializationStatus): this {
    this.trace.runtime_ready_at_execution = ready;
    this.trace.agent_materialization_status = matStatus;
    return this;
  }

  /** Set session ID (legacy local) */
  sessionId(id: string): this {
    this.trace.openclaw_session_id = id;
    return this;
  }

  /** Set session key for hooks_session mode */
  sessionKey(key: string): this {
    this.trace.session_key = key;
    return this;
  }

  /** Mark transport success */
  transportSuccess(success: boolean): this {
    this.trace.transport_success = success;
    return this;
  }

  /** Mark accepted async (hooks_session without immediate response) */
  acceptedAsync(): this {
    this.trace.accepted_async = true;
    return this;
  }

  /** Mark async timeout triggered */
  asyncTimeout(timeoutMs: number): this {
    this.trace.async_timeout_triggered = true;
    this.trace.async_timeout_ms = timeoutMs;
    return this;
  }

  /** PROMPT 11: Mark agent warmup result */
  warmup(success: boolean): this {
    this.trace.agent_warmup_attempted = true;
    this.trace.agent_warmup_success = success;
    return this;
  }

  /** Mark fallback used */
  fallbackUsed(reason: string): this {
    this.trace.execution_fallback_used = true;
    this.trace.execution_fallback_reason = reason;
    return this;
  }

  /** Mark response received and AI confirmed */
  responseReceived(tokens?: { input: number; output: number }, provider?: string): this {
    this.trace.response_received = true;
    this.trace.ai_generated = true;
    this.trace.ai_provider = provider;
    this.trace.response_tokens = tokens;
    return this;
  }

  /** Mark execution completed */
  completed(): this {
    this.trace.execution_completed_at = Date.now();
    return this;
  }

  /** Set gap explanation */
  gap(explanation: string): this {
    this.trace.gap = explanation;
    return this;
  }

  // ==========================================================================
  // RESOURCE TRACEABILITY
  // ==========================================================================

  /** Set assigned resources (from agent config) */
  resourcesAssigned(tools: string[], skills: string[]): this {
    this.trace.resources_assigned = { tools, skills };
    return this;
  }

  /** Mark resources as injected into request */
  resourcesInjected(tools: string[], skills: string[], mode: 'native' | 'prompt' | 'none'): this {
    this.trace.resources_injected = { tools, skills, injection_mode: mode };
    return this;
  }

  /**
   * Mark resources with full definition mode (executable vs ids-only)
   * Call this AFTER resourcesInjected() to add definition mode info.
   */
  resourcesDefinitionMode(
    definitionMode: 'full_definitions' | 'ids_only' | 'none',
    executableToolsCount: number,
    executableSkillsCount: number,
    executableToolNames?: string[]
  ): this {
    if (this.trace.resources_injected) {
      this.trace.resources_injected.definition_mode = definitionMode;
      this.trace.resources_injected.executable_tools_count = executableToolsCount;
      this.trace.resources_injected.executable_skills_count = executableSkillsCount;
      if (executableToolNames && executableToolNames.length > 0) {
        this.trace.resources_injected.executable_tool_names = executableToolNames;
      }
    }
    return this;
  }

  /**
   * Mark resource usage verification status
   *
   * @param verified - true ONLY if OpenClaw returned structured confirmation
   * @param source - 'runtime_receipt' if verified, 'unverified' otherwise
   * @param toolsUsed - ONLY populated if verified=true
   * @param skillsUsed - ONLY populated if verified=true
   * @param unverifiedReason - Explanation when verified=false
   */
  resourcesUsage(
    verified: boolean,
    source: 'runtime_receipt' | 'unverified',
    toolsUsed: string[],
    skillsUsed: string[],
    unverifiedReason?: string
  ): this {
    this.trace.resources_usage = {
      verified,
      verification_source: source,
      tools_used: verified ? toolsUsed : [], // NEVER populate if not verified
      skills_used: verified ? skillsUsed : [], // NEVER populate if not verified
      unverified_reason: unverifiedReason,
    };
    return this;
  }

  // ==========================================================================
  // TOOL-FIRST POLICY
  // ==========================================================================

  /**
   * Set tool execution policy.
   * - 'standard': Normal execution
   * - 'tool_first': Explicit instruction to attempt tools before direct response
   */
  toolPolicy(policy: 'standard' | 'tool_first'): this {
    this.trace.tool_policy = policy;
    return this;
  }

  /**
   * Mark whether tools were attempted during execution.
   *
   * @param attempted - true if runtime events show tool attempt
   * @param notAttemptedReason - Reason if not attempted when tool_first was active
   */
  toolAttempted(attempted: boolean, notAttemptedReason?: string): this {
    this.trace.tool_attempted = attempted;
    if (!attempted && notAttemptedReason) {
      this.trace.tool_not_attempted_reason = notAttemptedReason;
    }
    return this;
  }

  // ==========================================================================
  // TOOL ENFORCEMENT
  // ==========================================================================

  /**
   * Mark tool enforcement status.
   * Called when enforcement gate is active.
   */
  toolEnforcement(enforced: boolean): this {
    this.trace.tool_enforced = enforced;
    if (!enforced) {
      this.trace.enforcement_result = 'not_applicable';
    }
    return this;
  }

  /**
   * Mark enforcement was triggered (model tried to bypass tools).
   */
  enforcementTriggered(): this {
    this.trace.tool_enforcement_triggered = true;
    return this;
  }

  /**
   * Record enforcement attempt count and result.
   */
  enforcementResult(
    attempts: number,
    result: 'success' | 'failed' | 'not_applicable'
  ): this {
    this.trace.enforcement_attempts = attempts;
    this.trace.enforcement_result = result;
    return this;
  }

  // ==========================================================================
  // ATR LOOP (Autonomous Task Resolution)
  // ==========================================================================

  /**
   * Record a resolution attempt in the ATR loop.
   */
  resolutionAttempt(
    attempt: number,
    reason: ResolutionReason,
    action: 'retry' | 'escalate' | 'accept',
    toolUsedAfter?: boolean
  ): this {
    if (!this.trace.resolution_path) {
      this.trace.resolution_path = [];
    }
    this.trace.resolution_path.push({
      attempt,
      reason,
      action,
      tool_used_after: toolUsedAfter,
    });
    this.trace.resolution_attempts = attempt;
    return this;
  }

  /**
   * Set final resolution status after ATR loop completes.
   */
  finalResolution(status: 'success' | 'partial' | 'failed'): this {
    this.trace.final_resolution_status = status;
    return this;
  }

  /**
   * Mark task as requiring human intervention.
   */
  humanEscalation(reason: ResolutionReason): this {
    this.trace.requires_human_intervention = true;
    this.trace.human_escalation_reason = reason;
    return this;
  }

  // ==========================================================================
  // REAL TOOL EXECUTION
  // ==========================================================================

  /**
   * Record real tool execution by OCAAS backend.
   */
  toolExecutionReal(
    executionId: string,
    toolName: string,
    toolType: 'api' | 'script' | 'binary' | 'builtin',
    success: boolean,
    durationMs: number,
    hadDefinition: boolean,
    error?: { code: string; message: string }
  ): this {
    this.trace.tool_execution_real = true;
    this.trace.tool_execution_details = {
      execution_id: executionId,
      tool_name: toolName,
      tool_type: toolType,
      success,
      duration_ms: durationMs,
      had_definition: hadDefinition,
      error_code: error?.code,
      error_message: error?.message,
    };
    return this;
  }

  /**
   * Record follow-up AI call after tool execution.
   */
  toolFollowupCall(
    made: boolean,
    success: boolean,
    tokens?: { input: number; output: number }
  ): this {
    this.trace.tool_followup_call = {
      made,
      success,
      tokens,
    };
    return this;
  }

  // ==========================================================================
  // TOOL SECURITY
  // ==========================================================================

  /**
   * Record tool security check result.
   */
  toolSecurityCheck(
    checked: boolean,
    passed: boolean,
    failureCode?: ExecutionTraceability['security_failure_code'],
    failureReason?: string,
    policyApplied?: boolean
  ): this {
    this.trace.tool_security_checked = checked;
    this.trace.tool_security_passed = passed;
    if (failureCode) {
      this.trace.security_failure_code = failureCode;
    }
    if (failureReason) {
      this.trace.security_failure_reason = failureReason;
    }
    this.trace.security_policy_applied = policyApplied;
    return this;
  }

  /**
   * Record input validation result.
   */
  inputValidation(
    checked: boolean,
    passed: boolean,
    schemaUsed: boolean,
    errors?: string[]
  ): this {
    this.trace.input_validation_checked = checked;
    this.trace.input_validation_passed = passed;
    this.trace.input_schema_used = schemaUsed;
    if (errors && errors.length > 0) {
      this.trace.input_validation_errors = errors;
    }
    return this;
  }

  /**
   * Record execution limits check.
   */
  executionLimits(
    blocked: boolean,
    limitExceeded?: ExecutionTraceability['limit_exceeded'],
    executionCount?: number,
    totalExecutionMs?: number
  ): this {
    this.trace.execution_limit_blocked = blocked;
    if (limitExceeded) {
      this.trace.limit_exceeded = limitExceeded;
    }
    if (executionCount !== undefined) {
      this.trace.task_execution_count = executionCount;
    }
    if (totalExecutionMs !== undefined) {
      this.trace.task_total_execution_ms = totalExecutionMs;
    }
    return this;
  }

  /**
   * Record audit entry ID.
   */
  auditEntry(auditEntryId: string): this {
    this.trace.audit_entry_id = auditEntryId;
    return this;
  }

  /** Build final traceability */
  build(): ExecutionTraceability {
    // Add gap explanation if not set
    if (!this.trace.gap) {
      if (this.trace.execution_mode === 'hooks_session') {
        this.trace.gap = 'Execution uses /hooks/agent with sessionKey. ' +
          'Session state persisted in OpenClaw. Primary execution mode.';
      } else if (this.trace.execution_mode === 'chat_completion') {
        this.trace.gap = 'Execution uses /v1/chat/completions (stateless fallback). ' +
          'No session state persisted. Configure OPENCLAW_HOOKS_TOKEN for hooks_session.';
      } else if (this.trace.execution_mode === 'stub') {
        this.trace.gap = 'Stub execution - no actual AI call made. ' +
          this.trace.execution_fallback_reason || 'Gateway not available.';
      }
    }

    return { ...this.trace };
  }
}

/**
 * Create new execution traceability builder
 */
export function createExecutionTraceability(agentId: string): ExecutionTraceabilityBuilder {
  return new ExecutionTraceabilityBuilder(agentId);
}

// ============================================================================
// EXECUTION MAP
// ============================================================================

/**
 * Execution point in the system
 */
export interface ExecutionPoint {
  /** Name of the execution point */
  name: string;

  /** File location */
  file: string;

  /** Function/method name */
  method: string;

  /** What it actually does */
  actual_behavior: string;

  /** Execution mode used */
  execution_mode: ExecutionMode;

  /** Transport used */
  transport: ExecutionTransport;

  /** Uses real agent? */
  uses_real_agent: boolean;

  /** Gap explanation */
  gap: string;
}

/**
 * Map of all execution points in the system
 *
 * BLOQUE 10: Honest documentation of what each point actually does
 * Updated: hooks_session is now PRIMARY, chat_completion is FALLBACK
 */
export const EXECUTION_POINTS: ExecutionPoint[] = [
  {
    name: 'OpenClawAdapter.executeViaHooks',
    file: 'integrations/openclaw/OpenClawAdapter.ts',
    method: 'executeViaHooks()',
    actual_behavior: 'PRIMARY: Calls gateway.runViaHooksAgent() with sessionKey. ' +
      'Uses /hooks/agent endpoint. Session persisted in OpenClaw.',
    execution_mode: 'hooks_session',
    transport: 'hooks_agent',
    uses_real_agent: true,
    gap: 'Session state persisted via sessionKey. Requires OPENCLAW_HOOKS_TOKEN.',
  },
  {
    name: 'OpenClawAdapter.executeAgent',
    file: 'integrations/openclaw/OpenClawAdapter.ts',
    method: 'executeAgent()',
    actual_behavior: 'FALLBACK: Calls gateway.spawn() then gateway.send(). ' +
      'spawn() creates LOCAL session ID only. send() uses /v1/chat/completions.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'Fallback mode. Session ID is LOCAL to OCAAS. No OpenClaw session.',
  },
  {
    name: 'OpenClawAdapter.generate',
    file: 'integrations/openclaw/OpenClawAdapter.ts',
    method: 'generate()',
    actual_behavior: 'Direct call to gateway.generate() which uses /v1/chat/completions.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'Pure chat completion. No agent context.',
  },
  {
    name: 'OpenClawGateway.generate',
    file: 'openclaw/gateway.ts',
    method: 'generate()',
    actual_behavior: 'POST to /v1/chat/completions with system+user messages.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'OpenAI-compatible chat completion. No agent state.',
  },
  {
    name: 'OpenClawGateway.spawn',
    file: 'openclaw/gateway.ts',
    method: 'spawn()',
    actual_behavior: 'Creates LOCAL session ID (ocaas-{agentId}-{timestamp}). ' +
      'Optionally sends webhook notification. Does NOT create OpenClaw session.',
    execution_mode: 'stub',
    transport: 'webhook',
    uses_real_agent: false,
    gap: 'Session ID is LOCAL. No real OpenClaw agent spawned.',
  },
  {
    name: 'OpenClawGateway.send',
    file: 'openclaw/gateway.ts',
    method: 'send()',
    actual_behavior: 'POST to /v1/chat/completions ignoring sessionId.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'sessionId not used. Each call is stateless.',
  },
  {
    name: 'OpenClawGateway.exec',
    file: 'openclaw/gateway.ts',
    method: 'exec()',
    actual_behavior: 'POST to /v1/chat/completions with tool execution prompt.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'Tool execution via prompt, not native tool calling.',
  },
  {
    name: 'JobDispatcherService.executeJob',
    file: 'execution/JobDispatcherService.ts',
    method: 'executeJob()',
    actual_behavior: 'Calls OpenClawAdapter.executeAgent() which uses chat_completion.',
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    uses_real_agent: false,
    gap: 'Builds payload and prompt, but execution is stateless chat completion.',
  },
];

/**
 * Get execution point by name
 */
export function getExecutionPoint(name: string): ExecutionPoint | undefined {
  return EXECUTION_POINTS.find(p => p.name === name);
}

/**
 * Log execution map summary
 */
export function logExecutionMapSummary(): void {
  logger.info({
    total_points: EXECUTION_POINTS.length,
    chat_completion: EXECUTION_POINTS.filter(p => p.execution_mode === 'chat_completion').length,
    stub: EXECUTION_POINTS.filter(p => p.execution_mode === 'stub').length,
    real_agent: EXECUTION_POINTS.filter(p => p.execution_mode === 'real_agent').length,
    uses_real_agent: EXECUTION_POINTS.filter(p => p.uses_real_agent).length,
  }, 'Execution points summary (BLOQUE 10)');
}

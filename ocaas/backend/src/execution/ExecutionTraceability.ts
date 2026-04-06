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
  response_tokens?: {
    input: number;
    output: number;
  };

  /** Gap explanation */
  gap?: string;
}

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

  /** Mark response received */
  responseReceived(tokens?: { input: number; output: number }): this {
    this.trace.response_received = true;
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

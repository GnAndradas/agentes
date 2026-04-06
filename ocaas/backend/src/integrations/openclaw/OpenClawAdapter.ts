/**
 * OpenClawAdapter
 *
 * Punto único de integración con OpenClaw.
 * TODO uso de OpenClaw DEBE pasar por este adapter.
 *
 * Prohibido:
 * - Importar getGateway() fuera de este módulo
 * - Llamar directamente a gateway.* fuera de este módulo
 * - Usar fetch/axios contra URLs de OpenClaw fuera de este módulo
 */

import { integrationLogger, logError } from '../../utils/logger.js';
import { getGateway, type OpenClawGateway } from '../../openclaw/gateway.js';
import type {
  OpenClawErrorCode,
  OpenClawError,
  ExecuteAgentInput,
  ExecuteAgentResult,
  GenerateInput,
  GenerateResult,
  NotifyChannelInput,
  NotifyChannelResult,
  SendTaskInput,
  SendTaskResult,
  ExecuteToolInput,
  ExecuteToolResult,
  StatusResponse,
  OpenClawSession,
  ListSessionsResult,
  TestConnectionResult,
  ExecuteViaHooksInput,
  ExecuteViaHooksResult,
} from './types.js';
import { buildSessionKey } from '../../openclaw/types.js';

const logger = integrationLogger.child({ component: 'OpenClawAdapter' });

/**
 * Normalize any error to OpenClawError format
 */
function normalizeError(err: unknown, defaultCode: OpenClawErrorCode = 'execution_error'): OpenClawError {
  if (err instanceof Error) {
    const message = err.message.toLowerCase();

    // Detect error type from message
    if (message.includes('timeout') || message.includes('timed out')) {
      return { code: 'timeout', message: err.message };
    }
    if (message.includes('auth') || message.includes('401') || message.includes('unauthorized')) {
      return { code: 'auth_error', message: err.message };
    }
    if (message.includes('rate') || message.includes('429') || message.includes('too many')) {
      return { code: 'rate_limited', message: err.message };
    }
    if (message.includes('connect') || message.includes('network') || message.includes('econnrefused')) {
      return { code: 'connection_error', message: err.message };
    }
    if (message.includes('invalid') || message.includes('parse') || message.includes('json')) {
      return { code: 'invalid_response', message: err.message };
    }

    return { code: defaultCode, message: err.message };
  }

  return { code: defaultCode, message: String(err) };
}

export class OpenClawAdapter {
  private gateway: OpenClawGateway;

  constructor() {
    this.gateway = getGateway();
  }

  // ==========================================================================
  // Configuration & Status
  // ==========================================================================

  /**
   * Check if OpenClaw is configured (has API key)
   */
  isConfigured(): boolean {
    return this.gateway.isConfigured();
  }

  /**
   * Check if connected (cached, may be stale)
   */
  isConnected(): boolean {
    return this.gateway.isConnected();
  }

  /**
   * Get full status (makes real requests)
   */
  async getStatus(): Promise<StatusResponse> {
    try {
      const quickStatus = await this.gateway.getQuickStatus();

      return {
        connected: quickStatus.rest.reachable && quickStatus.rest.authenticated,
        configured: this.isConfigured(),
        rest: {
          reachable: quickStatus.rest.reachable,
          authenticated: quickStatus.rest.authenticated,
          latencyMs: quickStatus.rest.latencyMs,
        },
        websocket: {
          connected: quickStatus.websocket.connected,
        },
        hooks: {
          configured: quickStatus.hooks.configured,
        },
        error: quickStatus.rest.error,
      };
    } catch (err) {
      const error = normalizeError(err, 'connection_error');
      return {
        connected: false,
        configured: this.isConfigured(),
        rest: { reachable: false, authenticated: false, latencyMs: 0 },
        websocket: { connected: false },
        hooks: { configured: false },
        error: error.message,
      };
    }
  }

  /**
   * Test connection with timing
   */
  async testConnection(): Promise<TestConnectionResult> {
    const startTime = Date.now();

    try {
      const status = await this.gateway.getStatus();
      const latencyMs = Date.now() - startTime;

      if (status.connected) {
        return { success: true, latencyMs };
      }

      return {
        success: false,
        latencyMs,
        error: { code: 'connection_error', message: 'Gateway not connected' },
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: normalizeError(err, 'connection_error'),
      };
    }
  }

  // ==========================================================================
  // LLM Generation
  // ==========================================================================

  /**
   * Generate content using LLM
   */
  async generate(input: GenerateInput): Promise<GenerateResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: { code: 'not_configured', message: 'OpenClaw API key not configured' },
      };
    }

    try {
      const result = await this.gateway.generate({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        maxTokens: input.maxTokens,
      });

      if (!result.success) {
        return {
          success: false,
          error: { code: 'execution_error', message: result.error || 'Generation failed' },
        };
      }

      return {
        success: true,
        content: result.content,
        usage: result.usage,
      };
    } catch (err) {
      logger.error({ err, input: { systemPrompt: input.systemPrompt.slice(0, 50) } }, 'Generation failed');
      return {
        success: false,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // Agent Execution
  // ==========================================================================

  /**
   * Execute an agent (spawn session + send prompt)
   */
  async executeAgent(input: ExecuteAgentInput): Promise<ExecuteAgentResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: { code: 'not_configured', message: 'OpenClaw API key not configured' },
      };
    }

    try {
      // Spawn session
      const spawnResult = await this.gateway.spawn({
        agentId: input.agentId,
        taskId: input.taskId,
        prompt: input.prompt,
        tools: input.tools,
        skills: input.skills,
        config: input.config,
      });

      if (!spawnResult.success) {
        return {
          success: false,
          error: { code: 'execution_error', message: spawnResult.error || 'Failed to spawn agent' },
        };
      }

      // Send the prompt to get response
      const sendResult = await this.gateway.send({
        sessionId: spawnResult.sessionId,
        message: input.prompt,
      });

      if (!sendResult.success) {
        return {
          success: false,
          sessionId: spawnResult.sessionId,
          error: { code: 'execution_error', message: sendResult.error || 'Failed to get response' },
        };
      }

      return {
        success: true,
        sessionId: spawnResult.sessionId,
        response: sendResult.response,
      };
    } catch (err) {
      logger.error({ err, agentId: input.agentId }, 'Agent execution failed');
      return {
        success: false,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // AGENT RUNTIME BOOTSTRAP (PROMPT 11)
  // ==========================================================================

  /**
   * Ensure agent is ready for execution (warm-up ping)
   *
   * PROMPT 11: Sends a minimal warmup request to ensure:
   * - Gateway can reach agent
   * - Session routing works
   * - Agent is responsive (no wait for AI response)
   *
   * Does NOT block execution if warmup fails - just logs and continues.
   */
  async ensureAgentReady(agentId: string): Promise<{ ready: boolean; error?: string }> {
    // Step 1: Check if hooks are configured
    if (!this.isHooksConfigured()) {
      logger.debug({ agentId }, 'Warmup skipped: hooks not configured');
      return { ready: false, error: 'hooks_not_configured' };
    }

    // Step 2: Generate warmup sessionKey
    const timestamp = Date.now();
    const sessionKey = `hook:ocaas:warmup:${agentId}:${timestamp}`;

    logger.debug({ agentId, sessionKey }, 'Sending agent warmup ping');

    try {
      // Step 3: Send minimal ping via hooks
      const result = await this.gateway.runViaHooksAgent({
        message: 'ping',
        agentId,
        sessionKey,
        name: `OCAAS Warmup ${agentId}`,
        wakeMode: 'now',
        deliver: false, // Don't wait for full response
      });

      // Step 4: Interpret result
      // If request was accepted (sent without error), agent is ready
      if (result.success || result.accepted) {
        logger.info({ agentId, sessionKey }, 'Agent warmup successful');
        return { ready: true };
      }

      // Request failed
      logger.warn({
        agentId,
        sessionKey,
        error: result.error,
      }, 'Agent warmup failed');

      return { ready: false, error: result.error || 'warmup_failed' };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'unknown_error';
      logger.warn({ err, agentId, sessionKey }, 'Agent warmup threw exception');
      return { ready: false, error: errorMsg };
    }
  }

  // ==========================================================================
  // PRIMARY EXECUTION: Via Hooks (hooks_session mode)
  // ==========================================================================

  /**
   * Check if hooks are configured
   */
  isHooksConfigured(): boolean {
    return this.gateway.isHooksConfigured();
  }

  /**
   * Execute an agent via hooks (PRIMARY execution mode)
   *
   * Uses /hooks/agent with sessionKey for stateful session.
   * Falls back to chat_completion if hooks fail or are not configured.
   */
  async executeViaHooks(input: ExecuteViaHooksInput): Promise<ExecuteViaHooksResult> {
    // Build session key
    const sessionKey = input.taskId
      ? buildSessionKey('task', input.taskId)
      : input.jobId
        ? buildSessionKey('job', input.jobId)
        : buildSessionKey('manual', `${input.agentId}-${Date.now()}`);

    logger.info({
      agentId: input.agentId,
      sessionKey,
      hooksConfigured: this.isHooksConfigured(),
    }, 'executeViaHooks called');

    // Try hooks_session first (PRIMARY)
    if (this.isHooksConfigured()) {
      try {
        const result = await this.gateway.runViaHooksAgent({
          message: input.prompt,
          agentId: input.agentId,
          sessionKey,
          name: input.name || `OCAAS Agent ${input.agentId}`,
          wakeMode: 'now',
          deliver: false, // We want sync-ish response handling
        });

        if (result.success) {
          logger.info({
            agentId: input.agentId,
            sessionKey,
            executionMode: 'hooks_session',
          }, 'Execution succeeded via hooks_session');

          return {
            success: true,
            sessionKey,
            executionMode: 'hooks_session',
            accepted: result.accepted,
            response: result.response,
          };
        }

        // Hooks failed - fall back to chat_completion
        logger.warn({
          agentId: input.agentId,
          sessionKey,
          error: result.error,
        }, 'hooks_session failed, falling back to chat_completion');

        return this.executeChatCompletionDirect(input, sessionKey, result.error || 'hooks call failed');

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.warn({ err, agentId: input.agentId }, 'hooks_session threw, falling back');
        return this.executeChatCompletionDirect(input, sessionKey, errorMsg);
      }
    }

    // Hooks not configured - use fallback directly
    logger.info({
      agentId: input.agentId,
    }, 'Hooks not configured, using chat_completion fallback');

    return this.executeChatCompletionDirect(input, sessionKey, 'OPENCLAW_HOOKS_TOKEN not configured');
  }

  /**
   * Fallback execution via chat_completion (direct, no hooks)
   * Public for use in async timeout scenarios where we need to bypass hooks.
   */
  async executeChatCompletionDirect(
    input: ExecuteViaHooksInput,
    sessionKey: string,
    fallbackReason: string
  ): Promise<ExecuteViaHooksResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        sessionKey,
        executionMode: 'stub',
        fallbackUsed: true,
        fallbackReason: 'OpenClaw not configured',
        error: { code: 'not_configured', message: 'OpenClaw API key not configured' },
      };
    }

    try {
      // Use executeAgent which uses spawn+send (chat_completion)
      const result = await this.executeAgent({
        agentId: input.agentId,
        taskId: input.taskId,
        prompt: input.prompt,
      });

      return {
        success: result.success,
        sessionKey,
        executionMode: 'chat_completion',
        fallbackUsed: true,
        fallbackReason,
        response: result.response,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        sessionKey,
        executionMode: 'stub',
        fallbackUsed: true,
        fallbackReason,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // Channel Notifications
  // ==========================================================================

  /**
   * Send notification to a channel (Telegram, etc.)
   */
  async notifyChannel(input: NotifyChannelInput): Promise<NotifyChannelResult> {
    try {
      const success = await this.gateway.notify(input.message, input.channel);

      if (!success) {
        return {
          success: false,
          error: { code: 'execution_error', message: 'Failed to send notification' },
        };
      }

      return { success: true };
    } catch (err) {
      logger.error({ err, channel: input.channel }, 'Channel notification failed');
      return {
        success: false,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // Task/Message Sending
  // ==========================================================================

  /**
   * Send a task/message to an existing session
   */
  async sendTask(input: SendTaskInput): Promise<SendTaskResult> {
    try {
      const result = await this.gateway.send({
        sessionId: input.sessionId,
        message: input.message,
        data: input.data,
      });

      if (!result.success) {
        return {
          success: false,
          error: { code: 'execution_error', message: result.error || 'Failed to send task' },
        };
      }

      return {
        success: true,
        response: result.response,
      };
    } catch (err) {
      logger.error({ err, sessionId: input.sessionId }, 'Send task failed');
      return {
        success: false,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

  /**
   * Execute a tool in a session
   */
  async executeTool(input: ExecuteToolInput): Promise<ExecuteToolResult> {
    try {
      const result = await this.gateway.exec({
        sessionId: input.sessionId,
        toolName: input.toolName,
        input: input.input,
      });

      if (!result.success) {
        return {
          success: false,
          error: { code: 'execution_error', message: result.error || 'Failed to execute tool' },
        };
      }

      return {
        success: true,
        output: result.output,
      };
    } catch (err) {
      logger.error({ err, toolName: input.toolName }, 'Tool execution failed');
      return {
        success: false,
        error: normalizeError(err),
      };
    }
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * List active sessions
   */
  async listSessions(): Promise<ListSessionsResult> {
    try {
      const sessions = await this.gateway.listSessions();

      return {
        success: true,
        sessions: sessions.map(s => ({
          id: s.id,
          agentId: s.agentId,
          status: s.status,
          createdAt: s.createdAt,
        })),
      };
    } catch (err) {
      logger.error({ err }, 'Failed to list sessions');
      return {
        success: false,
        sessions: [],
        error: normalizeError(err),
      };
    }
  }

  /**
   * Terminate a session
   */
  async terminateSession(sessionId: string): Promise<boolean> {
    try {
      return await this.gateway.terminate(sessionId);
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to terminate session');
      return false;
    }
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string): Promise<boolean> {
    try {
      return await this.gateway.abortSession(sessionId);
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to abort session');
      return false;
    }
  }

  // ==========================================================================
  // WebSocket Connection
  // ==========================================================================

  /**
   * Connect WebSocket for real-time operations
   */
  async connectWebSocket(): Promise<boolean> {
    try {
      return await this.gateway.connectWebSocket();
    } catch (err) {
      logger.error({ err }, 'Failed to connect WebSocket');
      return false;
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    this.gateway.disconnectWebSocket();
  }

  /**
   * Check WebSocket connection status
   */
  isWsConnected(): boolean {
    return this.gateway.isWsConnected();
  }

  // ==========================================================================
  // Cron Jobs (via WebSocket RPC)
  // ==========================================================================

  /**
   * List cron jobs
   */
  async listCronJobs(): Promise<Array<{ id: string; schedule: string; enabled: boolean }>> {
    try {
      return await this.gateway.listCronJobs();
    } catch (err) {
      logger.error({ err }, 'Failed to list cron jobs');
      return [];
    }
  }

  /**
   * Enable/disable a cron job
   */
  async setCronJobEnabled(jobId: string, enabled: boolean): Promise<boolean> {
    try {
      return await this.gateway.setCronJobEnabled(jobId, enabled);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to set cron job enabled');
      return false;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Initialize adapter (connect to gateway)
   */
  async initialize(): Promise<boolean> {
    try {
      const connected = await this.gateway.connect();
      if (connected) {
        // Also try WebSocket
        await this.gateway.connectWebSocket();
      }
      return connected;
    } catch (err) {
      logger.error({ err }, 'Failed to initialize adapter');
      return false;
    }
  }

  /**
   * Shutdown adapter
   */
  async shutdown(): Promise<void> {
    await this.gateway.shutdown();
  }
}

// Singleton instance
let adapterInstance: OpenClawAdapter | null = null;

export function getOpenClawAdapter(): OpenClawAdapter {
  if (!adapterInstance) {
    adapterInstance = new OpenClawAdapter();
  }
  return adapterInstance;
}

export function resetOpenClawAdapter(): void {
  adapterInstance = null;
}

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
} from './types.js';

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

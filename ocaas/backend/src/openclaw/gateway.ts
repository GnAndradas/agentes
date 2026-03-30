import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { OpenClawError } from '../utils/errors.js';
import type { GatewayStatus, SpawnOptions, SpawnResult, ExecOptions, ExecResult, SendOptions, SendResult, GenerateOptions, GenerateResult } from './types.js';

const logger = createLogger('OpenClawGateway');

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const GENERATION_TIMEOUT = 120000; // 2 minutes for LLM generation

/**
 * OpenAI-compatible chat completion response
 * From: POST /v1/chat/completions
 * Docs: https://docs.openclaw.ai/gateway
 */
interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenClaw Gateway Client
 *
 * Uses two OpenClaw APIs (verified from docs.openclaw.ai):
 *
 * 1. REST API (Synchronous) - For AI generation:
 *    - GET  /v1/models           - Health check / list models
 *    - POST /v1/chat/completions - Chat completion (OpenAI-compatible)
 *
 * 2. Webhook API (Asynchronous) - For notifications:
 *    - POST /hooks/agent - Fire-and-forget, results go to channel
 *    - POST /hooks/wake  - Wake an agent
 *
 * Authentication: Authorization: Bearer <token>
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
  }

  /**
   * Build headers for OpenClaw API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Make a synchronous REST API request
   * Used for /v1/chat/completions and /v1/models
   */
  private async apiRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    timeout = DEFAULT_TIMEOUT
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.getHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ method, url }, 'Sending API request');

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();

        if (response.status === 401) {
          throw new OpenClawError('Authentication failed - check OPENCLAW_API_KEY', {
            url,
            status: response.status,
          });
        }
        if (response.status === 429) {
          throw new OpenClawError('Rate limited - too many requests', {
            url,
            status: response.status,
          });
        }

        throw new OpenClawError(`API request failed: ${response.status} ${text}`, {
          url,
          status: response.status,
        });
      }

      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      return JSON.parse(text) as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof OpenClawError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenClawError(`API request timed out after ${timeout}ms`, {
          url,
          timeout,
        });
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new OpenClawError(`Gateway connection failed: ${message}`, { url });
    }
  }

  /**
   * Make an asynchronous webhook request (fire-and-forget)
   * Used for /hooks/agent and /hooks/wake
   * Returns immediately with 200, results go to configured channel
   */
  private async webhookRequest(
    endpoint: string,
    body: Record<string, unknown>,
    timeout = DEFAULT_TIMEOUT
  ): Promise<void> {
    const url = `${this.baseUrl}/hooks${endpoint}`;
    const headers = this.getHeaders();
    // Webhooks also accept x-openclaw-token
    if (this.apiKey) {
      headers['x-openclaw-token'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ url, body }, 'Sending webhook request (fire-and-forget)');

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();

        if (response.status === 401) {
          throw new OpenClawError('Webhook auth failed - check OPENCLAW_API_KEY', {
            url,
            status: response.status,
          });
        }

        throw new OpenClawError(`Webhook request failed: ${response.status} ${text}`, {
          url,
          status: response.status,
        });
      }

      // Webhook returns 200 immediately, no meaningful response body
      logger.debug({ url }, 'Webhook accepted');
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof OpenClawError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenClawError(`Webhook request timed out after ${timeout}ms`, {
          url,
          timeout,
        });
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new OpenClawError(`Webhook connection failed: ${message}`, { url });
    }
  }

  /**
   * Connect and verify gateway is available
   * Uses GET /v1/models as health check
   */
  async connect(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      this.connected = status.connected;
      logger.info({ connected: this.connected, url: this.baseUrl }, 'Gateway connection check complete');
      return this.connected;
    } catch (err) {
      logger.warn({ err, url: this.baseUrl }, 'Gateway connection failed, running in offline mode');
      this.connected = false;
      return false;
    }
  }

  /**
   * Check gateway health status using GET /v1/models
   */
  async getStatus(): Promise<GatewayStatus> {
    try {
      const headers = this.getHeaders();

      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({})) as { data?: Array<{ id: string }> };
        return {
          connected: true,
          version: 'openclaw',
          sessions: data.data?.length || 0,
          lastPing: Date.now(),
        };
      }

      return { connected: false, sessions: 0 };
    } catch (err) {
      logger.debug({ err }, 'Health check failed');
      return { connected: false, sessions: 0 };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Generate content using LLM via /v1/chat/completions (synchronous)
   *
   * This is the primary method for AI generation in OCAAS.
   * Used by: AgentGenerator, SkillGenerator, ToolGenerator, TaskAnalyzer
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, generation unavailable');
      return { success: false, error: 'Gateway not connected' };
    }

    try {
      // Build messages array (OpenAI format)
      const messages: Array<{ role: string; content: string }> = [];

      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }

      messages.push({ role: 'user', content: options.userPrompt });

      const response = await this.apiRequest<ChatCompletionResponse>(
        'POST',
        '/v1/chat/completions',
        { messages },
        GENERATION_TIMEOUT
      );

      const content = response.choices?.[0]?.message?.content || '';

      if (!content) {
        logger.warn('Empty response from chat completion');
        return { success: false, error: 'Empty response from OpenClaw' };
      }

      logger.debug({
        promptLength: options.userPrompt.length,
        responseLength: content.length,
        model: response.model,
      }, 'Generation completed via /v1/chat/completions');

      return {
        success: true,
        content,
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Generation failed');
      return { success: false, error: message };
    }
  }

  /**
   * Send notification via webhook (fire-and-forget)
   *
   * POST /hooks/agent with deliver: true
   * Results go to configured channel (Telegram, etc.), NOT returned here
   */
  async notify(message: string, channel?: string): Promise<boolean> {
    if (!this.connected) {
      logger.warn('Gateway not connected, notification unavailable');
      return false;
    }

    try {
      await this.webhookRequest('/agent', {
        message,
        channel: channel || 'telegram',
        deliver: true,
        wakeMode: 'now',
      });
      logger.info({ channel: channel || 'telegram' }, 'Notification sent via webhook');
      return true;
    } catch (err) {
      logger.error({ err }, 'Failed to send notification');
      return false;
    }
  }

  /**
   * Wake an agent using POST /hooks/wake
   */
  async wake(agentId: string): Promise<boolean> {
    if (!this.connected) {
      logger.warn('Gateway not connected, wake unavailable');
      return false;
    }

    try {
      await this.webhookRequest('/wake', {
        text: `Wake agent ${agentId}`,
        mode: 'now',
      });
      logger.info({ agentId }, 'Agent wake signal sent');
      return true;
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to wake agent');
      return false;
    }
  }

  /**
   * Spawn a new agent session
   *
   * Note: OpenClaw manages sessions internally. This creates a local
   * session ID for OCAAS tracking and sends initialization via webhook.
   */
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot spawn agent session');
      throw new OpenClawError('Gateway not connected - cannot spawn agent session', {
        operation: 'spawn',
        agentId: options.agentId,
      });
    }

    try {
      // Generate local session ID (OpenClaw manages its own sessions)
      const sessionId = `ocaas-${options.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Send initialization notification
      await this.webhookRequest('/agent', {
        message: `[OCAAS] Agent ${options.agentId} initialized\nPrompt: ${options.prompt}`,
        agentId: options.agentId,
        deliver: false, // Don't deliver to channel, just initialize
        wakeMode: 'now',
      });

      logger.info({ sessionId, agentId: options.agentId }, 'Agent session created');

      return {
        sessionId,
        success: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, agentId: options.agentId }, 'Failed to spawn agent');
      return {
        sessionId: '',
        success: false,
        error: message,
      };
    }
  }

  /**
   * Send a message to an agent and get response
   *
   * Uses /v1/chat/completions for synchronous response
   */
  async send(options: SendOptions): Promise<SendResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot send message');
      throw new OpenClawError('Gateway not connected - cannot send message', {
        operation: 'send',
        sessionId: options.sessionId,
      });
    }

    try {
      // Use chat completion for synchronous response
      const response = await this.apiRequest<ChatCompletionResponse>(
        'POST',
        '/v1/chat/completions',
        {
          messages: [{ role: 'user', content: options.message }],
        },
        GENERATION_TIMEOUT
      );

      const content = response.choices?.[0]?.message?.content || '';

      return {
        success: true,
        response: content,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, sessionId: options.sessionId }, 'Failed to send message');
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Execute a tool
   *
   * Uses /v1/chat/completions with tool execution prompt
   */
  async exec(options: ExecOptions): Promise<ExecResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot execute tool');
      throw new OpenClawError('Gateway not connected - cannot execute tool', {
        operation: 'exec',
        sessionId: options.sessionId,
        tool: options.toolName,
      });
    }

    try {
      const execPrompt = `Execute the tool "${options.toolName}" with the following input:\n${JSON.stringify(options.input, null, 2)}\n\nReturn the result as JSON.`;

      const response = await this.apiRequest<ChatCompletionResponse>(
        'POST',
        '/v1/chat/completions',
        {
          messages: [{ role: 'user', content: execPrompt }],
        },
        GENERATION_TIMEOUT
      );

      const content = response.choices?.[0]?.message?.content || '';

      // Try to parse as JSON
      let output: Record<string, unknown>;
      try {
        output = JSON.parse(content);
      } catch {
        output = { result: content };
      }

      return {
        success: true,
        output,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, tool: options.toolName }, 'Tool execution failed');
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Terminate an agent session
   *
   * Note: OpenClaw manages sessions. This just cleans up OCAAS tracking.
   */
  async terminate(sessionId: string): Promise<boolean> {
    logger.info({ sessionId }, 'Session terminated (local cleanup)');
    return true;
  }

  /**
   * List active sessions
   *
   * Note: Sessions are tracked locally in OCAAS, not in OpenClaw
   */
  async listSessions(): Promise<string[]> {
    return [];
  }
}

// Singleton instance
let gatewayInstance: OpenClawGateway | null = null;

export function getGateway(): OpenClawGateway {
  if (!gatewayInstance) {
    gatewayInstance = new OpenClawGateway();
  }
  return gatewayInstance;
}

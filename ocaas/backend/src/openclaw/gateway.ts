import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { OpenClawError } from '../utils/errors.js';
import type { GatewayStatus, SpawnOptions, SpawnResult, ExecOptions, ExecResult, SendOptions, SendResult, GenerateOptions, GenerateResult } from './types.js';

const logger = createLogger('OpenClawGateway');

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const GENERATION_TIMEOUT = 120000; // 2 minutes for LLM generation

/**
 * OpenClaw Gateway Client
 *
 * Uses OpenClaw's Webhook API:
 * - GET /health for status checks
 * - POST /hooks/agent - Send message to agent (main endpoint)
 * - POST /hooks/wake - Wake an agent
 *
 * Authentication via Bearer token or x-openclaw-token header.
 * Required parameter for /hooks/agent: message
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;
  private hooksPath: string;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
    this.hooksPath = '/hooks';
  }

  /**
   * Build headers for OpenClaw API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      // OpenClaw accepts both Authorization: Bearer and x-openclaw-token
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['x-openclaw-token'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Make a webhook request to OpenClaw
   */
  private async webhookRequest<T>(
    endpoint: string,
    body: Record<string, unknown>,
    timeout = DEFAULT_TIMEOUT
  ): Promise<T> {
    const url = `${this.baseUrl}${this.hooksPath}${endpoint}`;
    const headers = this.getHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ url, body }, 'Sending webhook request');

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
        if (response.status === 404) {
          throw new OpenClawError(`Webhook endpoint not found: ${endpoint}`, {
            url,
            status: response.status,
          });
        }

        throw new OpenClawError(`Webhook request failed: ${response.status} ${text}`, {
          url,
          status: response.status,
        });
      }

      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        // If response is plain text, wrap it
        return { response: text } as T;
      }
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
      throw new OpenClawError(`Gateway connection failed: ${message}`, { url });
    }
  }

  /**
   * Connect and verify gateway is available
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
   * Check gateway health status
   */
  async getStatus(): Promise<GatewayStatus> {
    try {
      const headers = this.getHeaders();

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({})) as { version?: string; sessions?: number };
        return {
          connected: true,
          version: data.version || 'unknown',
          sessions: data.sessions || 0,
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
   * Spawn a new agent session
   *
   * POST /hooks/agent with wakeMode
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
      // Build the spawn message
      const spawnMessage = `[SPAWN] Agent: ${options.agentId}\nPrompt: ${options.prompt}`;

      const response = await this.webhookRequest<{ sessionId?: string; id?: string; error?: string }>(
        '/agent',
        {
          message: spawnMessage,
          agentId: options.agentId,
          wakeMode: 'now',
          deliver: false,
          skills: options.skills,
          tools: options.tools,
          config: options.config,
          timeoutSeconds: Math.floor(DEFAULT_TIMEOUT / 1000),
        }
      );

      // Generate a local session ID if not returned
      const sessionId = response.sessionId || response.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      logger.info({ sessionId, agentId: options.agentId }, 'Agent session created via webhook');

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
   * Send a message to an agent session
   *
   * POST /hooks/agent
   */
  async send(options: SendOptions): Promise<SendResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot send message to agent');
      throw new OpenClawError('Gateway not connected - cannot send message to agent', {
        operation: 'send',
        sessionId: options.sessionId,
      });
    }

    try {
      const response = await this.webhookRequest<{ response?: string; message?: string; content?: string }>(
        '/agent',
        {
          message: options.message,
          sessionId: options.sessionId,
          data: options.data,
          wakeMode: 'now',
          deliver: true,
          timeoutSeconds: Math.floor(GENERATION_TIMEOUT / 1000),
        },
        GENERATION_TIMEOUT
      );

      const content = response.response || response.message || response.content || '';

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
   * Execute a tool in an agent session
   *
   * POST /hooks/agent with tool execution request
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
      const execMessage = `[TOOL_EXEC] Execute tool "${options.toolName}" with input: ${JSON.stringify(options.input)}`;

      const response = await this.webhookRequest<{ response?: string; output?: unknown }>(
        '/agent',
        {
          message: execMessage,
          sessionId: options.sessionId,
          tool: options.toolName,
          toolInput: options.input,
          wakeMode: 'now',
          deliver: true,
          timeoutSeconds: Math.floor(GENERATION_TIMEOUT / 1000),
        },
        GENERATION_TIMEOUT
      );

      const output: Record<string, unknown> = (response.output as Record<string, unknown>) || { result: response.response || '' };
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
   * POST /hooks/agent with terminate command
   */
  async terminate(sessionId: string): Promise<boolean> {
    if (!this.connected) {
      logger.info({ sessionId }, 'Session terminated (offline mode)');
      return true;
    }

    try {
      await this.webhookRequest('/agent', {
        message: '[TERMINATE]',
        sessionId,
        terminate: true,
        wakeMode: 'now',
      });
      logger.info({ sessionId }, 'Session terminated');
      return true;
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to terminate session');
      return false;
    }
  }

  /**
   * List active sessions (local tracking - webhook doesn't support listing)
   */
  async listSessions(): Promise<string[]> {
    // Webhook API doesn't support listing sessions
    // Sessions are tracked locally in OCAAS
    return [];
  }

  /**
   * Generate content using LLM via webhook
   *
   * POST /hooks/agent with generation request
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, generation unavailable');
      return { success: false, error: 'Gateway not connected' };
    }

    try {
      // Build the full prompt combining system and user prompts
      let fullPrompt = options.userPrompt;
      if (options.systemPrompt) {
        fullPrompt = `[System Instructions]\n${options.systemPrompt}\n\n[User Request]\n${options.userPrompt}`;
      }

      const response = await this.webhookRequest<{
        response?: string;
        message?: string;
        content?: string;
        usage?: { inputTokens: number; outputTokens: number };
      }>(
        '/agent',
        {
          message: fullPrompt,
          wakeMode: 'now',
          deliver: false,
          maxTokens: options.maxTokens,
          timeoutSeconds: Math.floor(GENERATION_TIMEOUT / 1000),
        },
        GENERATION_TIMEOUT
      );

      const content = response.response || response.message || response.content || '';

      logger.debug({ promptLength: fullPrompt.length, responseLength: content.length }, 'Generation completed via webhook');

      return {
        success: true,
        content,
        usage: response.usage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Generation via webhook failed');
      return { success: false, error: message };
    }
  }

  /**
   * Wake an agent using the /hooks/wake endpoint
   */
  async wake(agentId: string): Promise<boolean> {
    if (!this.connected) {
      logger.warn('Gateway not connected, wake unavailable');
      return false;
    }

    try {
      await this.webhookRequest('/wake', {
        agentId,
        wakeMode: 'now',
      });
      logger.info({ agentId }, 'Agent awakened via webhook');
      return true;
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to wake agent');
      return false;
    }
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

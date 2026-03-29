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
 * Uses OpenClaw's Webhook API (v2026+):
 * - /health for status checks
 * - /hooks/agent for agent message processing
 * - /hooks/wake for system events
 *
 * Authentication via Bearer token or x-openclaw-token header.
 *
 * @see https://docs.openclaw.ai/automation/webhook
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;
  private defaultModel: string;
  private hooksPath: string;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
    this.defaultModel = config.openclaw.defaultModel;
    this.hooksPath = '/hooks'; // Default OpenClaw hooks path
  }

  /**
   * Build headers for OpenClaw webhook requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      // OpenClaw accepts both Authorization: Bearer and x-openclaw-token
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Make a request to OpenClaw webhook API
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

        // Handle specific OpenClaw error codes
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

        throw new OpenClawError(`Webhook request failed: ${response.status} ${text}`, {
          url,
          status: response.status,
        });
      }

      // OpenClaw may return empty response for some endpoints
      const text = await response.text();
      if (!text) {
        return {} as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        // If response is not JSON, return as wrapped object
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
        const data = await response.json().catch(() => ({})) as { version?: string };
        return {
          connected: true,
          version: data.version || 'unknown',
          sessions: 0,
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
   * Creates a local session ID and optionally wakes the agent
   */
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot spawn agent session');
      throw new OpenClawError('Gateway not connected - cannot spawn agent session', {
        operation: 'spawn',
        agentId: options.agentId,
      });
    }

    // Generate session key for OpenClaw
    const sessionKey = `ocaas:${options.agentId}:${Date.now()}`;

    try {
      // Wake the agent with initial prompt if provided
      if (options.prompt) {
        await this.webhookRequest('/wake', {
          text: `Agent ${options.agentId} initialized. ${options.prompt}`,
          mode: 'now',
        });
      }

      logger.info({ sessionKey, agentId: options.agentId }, 'Agent session created');

      return {
        sessionId: sessionKey,
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
   * Send a message to an agent via webhook
   *
   * Uses /hooks/agent endpoint
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
          sessionKey: options.sessionId,
          wakeMode: 'now',
          deliver: false, // Don't deliver to external channels, we handle response internally
          model: this.defaultModel,
          timeoutSeconds: Math.floor(DEFAULT_TIMEOUT / 1000),
          // Include any additional context data
          ...(options.data && { context: options.data }),
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
   * Execute a tool via agent webhook
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
      const response = await this.webhookRequest<{ response?: string; output?: unknown }>(
        '/agent',
        {
          message: `Execute tool "${options.toolName}" with input: ${JSON.stringify(options.input)}`,
          sessionKey: options.sessionId,
          wakeMode: 'now',
          deliver: false,
          model: this.defaultModel,
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
   */
  async terminate(sessionId: string): Promise<boolean> {
    // OpenClaw sessions are stateless via webhook, just log cleanup
    logger.info({ sessionId }, 'Session terminated');
    return true;
  }

  /**
   * List active sessions (local tracking only)
   */
  async listSessions(): Promise<string[]> {
    // Sessions are tracked locally, not via webhook API
    return [];
  }

  /**
   * Generate content using LLM via webhook
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, generation unavailable');
      return { success: false, error: 'Gateway not connected' };
    }

    try {
      // Build the prompt combining system and user prompts
      let fullPrompt = options.userPrompt;
      if (options.systemPrompt) {
        fullPrompt = `[System: ${options.systemPrompt}]\n\n${options.userPrompt}`;
      }

      const response = await this.webhookRequest<{ response?: string; message?: string; content?: string }>(
        '/agent',
        {
          message: fullPrompt,
          wakeMode: 'now',
          deliver: false,
          model: this.defaultModel,
          timeoutSeconds: Math.floor(GENERATION_TIMEOUT / 1000),
        },
        GENERATION_TIMEOUT
      );

      const content = response.response || response.message || response.content || '';

      logger.debug({ promptLength: fullPrompt.length, responseLength: content.length }, 'Generation completed');

      return {
        success: true,
        content,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Generation via gateway failed');
      return { success: false, error: message };
    }
  }

  /**
   * Set the default model for LLM calls
   */
  setModel(model: string): void {
    this.defaultModel = model;
    logger.info({ model }, 'Default model updated');
  }

  /**
   * Get available models (not available via webhook API)
   */
  async getModels(): Promise<string[]> {
    // Model listing not available via webhook, return configured default
    return [this.defaultModel];
  }

  /**
   * Send a wake event to the agent
   */
  async wake(text: string, mode: 'now' | 'next-heartbeat' = 'now'): Promise<boolean> {
    if (!this.connected) {
      return false;
    }

    try {
      await this.webhookRequest('/wake', { text, mode });
      return true;
    } catch (err) {
      logger.error({ err }, 'Wake event failed');
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

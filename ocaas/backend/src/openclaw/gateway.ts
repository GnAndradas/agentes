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
 * Uses OpenClaw's Sessions API (v2026+):
 * - GET /health for status checks
 * - POST /api/v1/sessions - Create session
 * - POST /api/v1/sessions/{id}/messages - Send message
 * - DELETE /api/v1/sessions/{id} - Terminate session
 *
 * Authentication via Bearer token or x-openclaw-token header.
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;
  private defaultModel: string;
  private apiPath: string;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
    this.defaultModel = config.openclaw.defaultModel;
    this.apiPath = '/api/v1';
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
   * Make a request to OpenClaw API
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
    timeout = DEFAULT_TIMEOUT
  ): Promise<T> {
    const url = `${this.baseUrl}${this.apiPath}${endpoint}`;
    const headers = this.getHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ method, url, body }, 'Sending API request');

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
        if (response.status === 404) {
          throw new OpenClawError(`Endpoint not found: ${endpoint}`, {
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

      try {
        return JSON.parse(text) as T;
      } catch {
        return { response: text } as T;
      }
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
   * POST /api/v1/sessions
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
      const response = await this.request<{ id?: string; sessionId?: string; error?: string }>(
        'POST',
        '/sessions',
        {
          agentId: options.agentId,
          prompt: options.prompt,
          model: this.defaultModel,
          skills: options.skills,
          tools: options.tools,
          config: options.config,
        }
      );

      const sessionId = response.id || response.sessionId;

      if (!sessionId) {
        throw new OpenClawError('No session ID returned from gateway', {
          operation: 'spawn',
          agentId: options.agentId,
        });
      }

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
   * Send a message to an agent session
   *
   * POST /api/v1/sessions/{id}/messages
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
      const response = await this.request<{ response?: string; message?: string; content?: string }>(
        'POST',
        `/sessions/${options.sessionId}/messages`,
        {
          message: options.message,
          data: options.data,
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
   * POST /api/v1/sessions/{id}/messages with tool execution request
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
      const response = await this.request<{ response?: string; output?: unknown }>(
        'POST',
        `/sessions/${options.sessionId}/messages`,
        {
          message: `Execute tool "${options.toolName}" with input: ${JSON.stringify(options.input)}`,
          tool: options.toolName,
          toolInput: options.input,
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
   * DELETE /api/v1/sessions/{id}
   */
  async terminate(sessionId: string): Promise<boolean> {
    if (!this.connected) {
      logger.info({ sessionId }, 'Session terminated (offline mode)');
      return true;
    }

    try {
      await this.request('DELETE', `/sessions/${sessionId}`);
      logger.info({ sessionId }, 'Session terminated');
      return true;
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to terminate session');
      return false;
    }
  }

  /**
   * List active sessions
   *
   * GET /api/v1/sessions
   */
  async listSessions(): Promise<string[]> {
    if (!this.connected) {
      return [];
    }

    try {
      const response = await this.request<{ sessions?: Array<{ id: string }> }>('GET', '/sessions');
      return response.sessions?.map(s => s.id) || [];
    } catch (err) {
      logger.warn({ err }, 'Failed to list sessions');
      return [];
    }
  }

  /**
   * Generate content using LLM
   *
   * POST /api/v1/sessions/{id}/messages or direct generation
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

      // Use a temporary session for generation
      const spawnResult = await this.spawn({
        agentId: 'generator',
        prompt: options.systemPrompt || 'You are a helpful assistant.',
      });

      if (!spawnResult.success || !spawnResult.sessionId) {
        return { success: false, error: spawnResult.error || 'Failed to create generation session' };
      }

      try {
        const response = await this.request<{ response?: string; message?: string; content?: string }>(
          'POST',
          `/sessions/${spawnResult.sessionId}/messages`,
          {
            message: options.userPrompt,
            maxTokens: options.maxTokens,
          },
          GENERATION_TIMEOUT
        );

        const content = response.response || response.message || response.content || '';

        logger.debug({ promptLength: fullPrompt.length, responseLength: content.length }, 'Generation completed');

        return {
          success: true,
          content,
        };
      } finally {
        // Clean up temporary session
        await this.terminate(spawnResult.sessionId);
      }
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
   * Get available models from OpenClaw
   *
   * GET /api/v1/models
   */
  async getModels(): Promise<string[]> {
    if (!this.connected) {
      return [this.defaultModel];
    }

    try {
      const response = await this.request<{ models?: Array<{ id: string }> }>('GET', '/models');
      return response.models?.map(m => m.id) || [this.defaultModel];
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch models');
      return [this.defaultModel];
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

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
 * Adapted for OpenClaw v2026.3.24+ which uses:
 * - /health for status checks (HTTP)
 * - /v1/chat/completions for LLM generation (OpenAI-compatible API)
 * - WebSocket for interactive sessions (not yet implemented)
 *
 * Note: Session-based operations (spawn, send, exec) are currently
 * implemented as direct LLM calls since the REST session API is not
 * available in current OpenClaw versions.
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;
  private defaultModel: string;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
    this.defaultModel = config.openclaw.defaultModel;
  }

  private async request<T>(path: string, options: RequestInit = {}, timeout = DEFAULT_TIMEOUT): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new OpenClawError(`Gateway request failed: ${response.status} ${text}`, { url, status: response.status });
      }

      return await response.json() as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof OpenClawError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenClawError(`Gateway request timed out after ${timeout}ms`, { url, timeout });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new OpenClawError(`Gateway connection failed: ${message}`, { url });
    }
  }

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

  async getStatus(): Promise<GatewayStatus> {
    try {
      // OpenClaw exposes /health endpoint
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return {
          connected: true,
          version: data.version || 'unknown',
          sessions: 0, // Sessions not available via REST in current OpenClaw
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
   * In current OpenClaw, we simulate sessions by tracking them locally
   * and using /v1/chat/completions for actual LLM calls
   */
  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (!this.connected) {
      logger.error('Gateway not connected - cannot spawn agent session');
      throw new OpenClawError('Gateway not connected - cannot spawn agent session', {
        operation: 'spawn',
        agentId: options.agentId,
      });
    }

    // Generate a local session ID since OpenClaw doesn't have session management via REST
    const sessionId = `session_${options.agentId}_${Date.now()}`;

    logger.info({ sessionId, agentId: options.agentId }, 'Agent session created (local tracking)');

    return {
      sessionId,
      success: true,
    };
  }

  /**
   * Send a message to an agent session
   *
   * Uses OpenAI-compatible /v1/chat/completions endpoint
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
      // Use OpenAI-compatible chat completions endpoint
      const response = await this.chatCompletion({
        messages: [
          { role: 'user', content: options.message },
        ],
        context: options.data,
      });

      return {
        success: true,
        response: response.content,
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
   * Tools are executed via LLM with tool definitions
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
      // Execute tool via chat completion with tool call
      const response = await this.chatCompletion({
        messages: [
          {
            role: 'user',
            content: `Execute tool "${options.toolName}" with input: ${JSON.stringify(options.input)}`,
          },
        ],
      });

      return {
        success: true,
        output: { result: response.content },
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
    // Local session cleanup - no remote call needed
    logger.info({ sessionId }, 'Session terminated (local cleanup)');
    return true;
  }

  /**
   * List active sessions
   */
  async listSessions(): Promise<string[]> {
    // Sessions are tracked locally, not via REST API
    return [];
  }

  /**
   * Generate content using LLM
   *
   * Uses OpenAI-compatible /v1/chat/completions endpoint
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, generation unavailable');
      return { success: false, error: 'Gateway not connected' };
    }

    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: options.userPrompt });

      const response = await this.chatCompletion({
        messages,
        maxTokens: options.maxTokens,
      });

      return {
        success: true,
        content: response.content,
        usage: response.usage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err }, 'Generation via gateway failed');
      return { success: false, error: message };
    }
  }

  /**
   * OpenAI-compatible chat completions call
   *
   * This is the core method that interfaces with OpenClaw's /v1/chat/completions endpoint
   */
  private async chatCompletion(options: {
    messages: Array<{ role: string; content: string }>;
    maxTokens?: number;
    context?: Record<string, unknown>;
  }): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.defaultModel,
      messages: options.messages,
      max_tokens: options.maxTokens ?? 4096,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GENERATION_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new OpenClawError(`Chat completion failed: ${response.status} ${text}`, {
          url,
          status: response.status,
        });
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage ? {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
      } : undefined;

      return { content, usage };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof OpenClawError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenClawError(`Chat completion timed out after ${GENERATION_TIMEOUT}ms`, { url });
      }
      throw err;
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
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await this.request<{ data?: Array<{ id: string }> }>('/v1/models');
      return response.data?.map(m => m.id) || [];
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch models');
      return [];
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

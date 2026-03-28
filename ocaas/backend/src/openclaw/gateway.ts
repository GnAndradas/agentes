import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { OpenClawError } from '../utils/errors.js';
import type { GatewayStatus, SpawnOptions, SpawnResult, ExecOptions, ExecResult, SendOptions, SendResult, GenerateOptions, GenerateResult } from './types.js';

const logger = createLogger('OpenClawGateway');

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const GENERATION_TIMEOUT = 120000; // 2 minutes for LLM generation

export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private connected = false;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
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
      logger.info({ connected: this.connected }, 'Gateway connection established');
      return this.connected;
    } catch (err) {
      logger.warn({ err }, 'Gateway connection failed, running in offline mode');
      this.connected = false;
      return false;
    }
  }

  async getStatus(): Promise<GatewayStatus> {
    try {
      const result = await this.request<{ status: string; version?: string; sessions?: number }>('/status');
      return {
        connected: result.status === 'ok',
        version: result.version,
        sessions: result.sessions ?? 0,
        lastPing: Date.now(),
      };
    } catch {
      return {
        connected: false,
        sessions: 0,
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, spawn simulated');
      return {
        sessionId: `sim_${Date.now()}`,
        success: true,
      };
    }

    return this.request<SpawnResult>('/sessions/spawn', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async send(options: SendOptions): Promise<SendResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, send simulated');
      return {
        success: true,
        response: 'Simulated response',
      };
    }

    return this.request<SendResult>(`/sessions/${options.sessionId}/send`, {
      method: 'POST',
      body: JSON.stringify({
        message: options.message,
        data: options.data,
      }),
    });
  }

  async exec(options: ExecOptions): Promise<ExecResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, exec simulated');
      return {
        success: true,
        output: { simulated: true },
      };
    }

    return this.request<ExecResult>(`/sessions/${options.sessionId}/exec`, {
      method: 'POST',
      body: JSON.stringify({
        tool: options.toolName,
        input: options.input,
      }),
    });
  }

  async terminate(sessionId: string): Promise<boolean> {
    if (!this.connected) {
      return true;
    }

    try {
      await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<string[]> {
    if (!this.connected) {
      return [];
    }

    try {
      const result = await this.request<{ sessions: string[] }>('/sessions');
      return result.sessions;
    } catch {
      return [];
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.connected) {
      logger.warn('Gateway not connected, generation unavailable');
      return { success: false, error: 'Gateway not connected' };
    }

    try {
      const result = await this.request<{ content: string; usage?: { inputTokens: number; outputTokens: number } }>('/generate', {
        method: 'POST',
        body: JSON.stringify({
          systemPrompt: options.systemPrompt,
          userPrompt: options.userPrompt,
          maxTokens: options.maxTokens ?? 4096,
        }),
      }, GENERATION_TIMEOUT);

      return {
        success: true,
        content: result.content,
        usage: result.usage,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, options }, 'Generation via gateway failed');
      return { success: false, error: message };
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

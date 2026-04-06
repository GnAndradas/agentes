import { config } from '../config/index.js';
import { integrationLogger, logError } from '../utils/logger.js';
import { OpenClawError } from '../utils/errors.js';
import type {
  GatewayStatus,
  SpawnOptions,
  SpawnResult,
  ExecOptions,
  ExecResult,
  SendOptions,
  SendResult,
  GenerateOptions,
  GenerateResult,
  OpenClawSession,
  HooksAgentOptions,
  HooksAgentResult,
} from './types.js';
import WebSocket from 'ws';

const logger = integrationLogger.child({ component: 'OpenClawGateway' });

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const GENERATION_TIMEOUT = 120000; // 2 minutes for LLM generation
const STALE_CHECK_INTERVAL = 60000; // 1 minute
const WS_PING_INTERVAL = 30000; // 30 seconds ping interval

// WebSocket reconnection with exponential backoff
const WS_RECONNECT_BASE_DELAY = 1000; // 1 second initial
const WS_RECONNECT_MAX_DELAY = 60000; // 1 minute max
const WS_MAX_RECONNECT_ATTEMPTS = 10; // Stop after 10 failures

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
 * Diagnostic result for OpenClaw connectivity (full, slower)
 */
export interface GatewayDiagnostic {
  timestamp: number;
  checkedAt: number;
  rest: {
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
    models?: string[];
  };
  hooks: {
    configured: boolean;
    probed: boolean; // true if we actually tested (not just assumed)
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
  };
  generation?: {
    enabled: boolean;
    working: boolean;
    latencyMs: number;
    error?: string;
  };
  websocket: {
    connected: boolean;
    sessionId?: string;
  };
  overall: {
    healthy: boolean;
    message: string;
  };
  lastError?: string;
}

/**
 * Quick status for StatusBar polling (fast, real probe)
 * Does NOT use cached state - makes actual requests
 */
export interface QuickStatus {
  timestamp: number;
  backend: boolean; // Always true if this response arrives
  rest: {
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    error?: string;
  };
  hooks: {
    configured: boolean;
    probed: boolean; // true if we actually tested (false = just checked config)
    working: boolean;
    error?: string;
  };
  probe: {
    enabled: boolean;
    tested: boolean; // true if we actually ran probe
    working: boolean;
    error?: string;
  };
  websocket: {
    connected: boolean;
  };
}

/**
 * WebSocket RPC message types
 * From: OpenClaw WebSocket Protocol v3
 */
interface WsRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface WsRpcResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface WsConnectChallenge {
  type: 'connect.challenge';
  nonce: string;
}

interface WsConnectAck {
  type: 'connect.ack';
  sessionId: string;
}

/**
 * OpenClaw Gateway Client
 *
 * Uses two OpenClaw APIs (verified from docs.openclaw.ai):
 *
 * 1. REST API (Synchronous) - For AI generation:
 *    - GET  /v1/models           - Health check / list models
 *    - POST /v1/chat/completions - Chat completion (OpenAI-compatible)
 *    Authentication: Authorization: Bearer <OPENCLAW_API_KEY>
 *
 * 2. Webhook API (Asynchronous) - For notifications:
 *    - POST /hooks/agent - Fire-and-forget, results go to channel
 *    - POST /hooks/wake  - Wake an agent
 *    Authentication: x-openclaw-token: <OPENCLAW_HOOKS_TOKEN>
 */
export class OpenClawGateway {
  private baseUrl: string;
  private apiKey?: string;
  private hooksToken?: string;
  private enableGenerationProbe: boolean;

  // WebSocket configuration
  private wsUrl: string;
  private wsMode: 'required' | 'optional' | 'disabled';

  // Connection state
  private restConnected = false;
  private hooksConnected = false;
  private lastCheckTime = 0;
  private lastError?: string;

  // WebSocket RPC client
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsSessionId: string | null = null;
  private pendingRpcCalls = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private rpcIdCounter = 0;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // WebSocket reconnection state
  private wsReconnectAttempts = 0;
  private wsLastCloseCode: number | null = null;
  private wsLastCloseReason: string | null = null;

  constructor() {
    this.baseUrl = config.openclaw.gatewayUrl;
    this.apiKey = config.openclaw.apiKey;
    this.hooksToken = config.openclaw.hooksToken;
    this.enableGenerationProbe = config.openclaw.enableGenerationProbe;
    this.wsUrl = config.openclaw.wsUrl;
    this.wsMode = config.openclaw.wsMode;
  }

  /**
   * Build headers for REST API requests (Authorization: Bearer)
   */
  private getApiHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Build headers for Webhook requests (x-openclaw-token)
   */
  private getWebhookHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.hooksToken) {
      headers['x-openclaw-token'] = this.hooksToken;
    }

    return headers;
  }

  /**
   * Check if connection state is stale and needs revalidation
   */
  private isConnectionStale(): boolean {
    return Date.now() - this.lastCheckTime > STALE_CHECK_INTERVAL;
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
    const headers = this.getApiHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ method, path }, 'Sending REST API request');

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
          this.lastError = 'Authentication failed - check OPENCLAW_API_KEY';
          throw new OpenClawError(this.lastError, { path, status: response.status });
        }
        if (response.status === 429) {
          this.lastError = 'Rate limited - too many requests';
          throw new OpenClawError(this.lastError, { path, status: response.status });
        }

        this.lastError = `API request failed: ${response.status}`;
        throw new OpenClawError(`${this.lastError} ${text}`, { path, status: response.status });
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
        this.lastError = `Request timed out after ${timeout}ms`;
        throw new OpenClawError(this.lastError, { path, timeout });
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      this.lastError = `Connection failed: ${message}`;
      throw new OpenClawError(this.lastError, { path });
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
    const headers = this.getWebhookHeaders();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      logger.debug({ endpoint }, 'Sending webhook request (fire-and-forget)');

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
          throw new OpenClawError('Webhook auth failed - check OPENCLAW_HOOKS_TOKEN', {
            endpoint,
            status: response.status,
          });
        }

        throw new OpenClawError(`Webhook request failed: ${response.status} ${text}`, {
          endpoint,
          status: response.status,
        });
      }

      logger.debug({ endpoint }, 'Webhook accepted');
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof OpenClawError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenClawError(`Webhook request timed out after ${timeout}ms`, { endpoint, timeout });
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new OpenClawError(`Webhook connection failed: ${message}`, { endpoint });
    }
  }

  /**
   * Connect and verify gateway is available
   * Uses GET /v1/models as health check
   */
  async connect(): Promise<boolean> {
    try {
      const diagnostic = await this.getDiagnostic();
      this.restConnected = diagnostic.rest.reachable && diagnostic.rest.authenticated;
      this.hooksConnected = diagnostic.hooks.reachable;
      this.lastCheckTime = Date.now();

      logger.info({
        restConnected: this.restConnected,
        hooksConnected: this.hooksConnected,
        url: this.baseUrl,
      }, 'Gateway connection check complete');

      return this.restConnected;
    } catch (err) {
      logger.warn({ err, url: this.baseUrl }, 'Gateway connection failed, running in offline mode');
      this.restConnected = false;
      this.hooksConnected = false;
      return false;
    }
  }

  /**
   * Full diagnostic of OpenClaw connectivity
   * Tests REST API, Webhooks, and optionally generation
   *
   * HONEST: Each indicator is independent and reports what was actually tested.
   */
  async getDiagnostic(): Promise<GatewayDiagnostic> {
    const timestamp = Date.now();

    // Test REST API (/v1/models) - REAL PROBE
    const restResult = await this.testRestApi();

    // Test Webhooks - HONEST: cannot probe without side effects
    const hooksResult = await this.testWebhooks();

    // Test generation if enabled AND REST is working
    let generationResult: GatewayDiagnostic['generation'] | undefined;
    if (this.enableGenerationProbe) {
      if (restResult.reachable && restResult.authenticated) {
        const genTest = await this.testGeneration();
        generationResult = {
          enabled: true,
          working: genTest.working,
          latencyMs: genTest.latencyMs,
          error: genTest.error,
        };
      } else {
        // Probe enabled but REST not working - can't test
        generationResult = {
          enabled: true,
          working: false,
          latencyMs: 0,
          error: 'Cannot probe: REST API not available',
        };
      }
    } else {
      generationResult = {
        enabled: false,
        working: false,
        latencyMs: 0,
        error: 'Probe disabled (OPENCLAW_ENABLE_GENERATION_PROBE=false)',
      };
    }

    // Update cached state (for methods that still use it)
    this.restConnected = restResult.reachable && restResult.authenticated;
    this.hooksConnected = hooksResult.configured; // Only know if configured
    this.lastCheckTime = timestamp;

    // Determine overall health
    const healthy = this.restConnected;
    let message = '';

    if (!restResult.reachable) {
      message = 'OpenClaw Gateway unreachable';
    } else if (!restResult.authenticated) {
      message = 'REST API authentication failed';
    } else if (generationResult.enabled && !generationResult.working) {
      message = `Generation probe failed: ${generationResult.error || 'unknown'}`;
    } else if (!hooksResult.configured) {
      message = 'REST OK, but hooks not configured';
    } else {
      message = 'REST API operational (hooks not probed)';
    }

    return {
      timestamp,
      checkedAt: Date.now(),
      rest: restResult,
      hooks: hooksResult,
      generation: generationResult,
      websocket: {
        connected: this.wsConnected,
        sessionId: this.wsSessionId || undefined,
      },
      overall: {
        healthy,
        message,
      },
      lastError: this.lastError,
    };
  }

  /**
   * Test REST API connectivity
   */
  private async testRestApi(): Promise<GatewayDiagnostic['rest']> {
    const startTime = Date.now();

    try {
      const headers = this.getApiHeaders();

      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.status === 401) {
        return {
          reachable: true,
          authenticated: false,
          latencyMs,
          error: 'Authentication failed',
        };
      }

      if (response.ok) {
        const data = await response.json().catch(() => ({})) as { data?: Array<{ id: string }> };
        return {
          reachable: true,
          authenticated: true,
          latencyMs,
          models: data.data?.map(m => m.id),
        };
      }

      return {
        reachable: true,
        authenticated: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        reachable: false,
        authenticated: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Test Webhooks connectivity
   * HONEST: We cannot probe webhooks without triggering them,
   * so we only report what we can actually verify.
   */
  private async testWebhooks(): Promise<GatewayDiagnostic['hooks']> {
    const startTime = Date.now();

    // Check if token is configured
    if (!this.hooksToken) {
      return {
        configured: false,
        probed: false,
        reachable: false,
        authenticated: false,
        latencyMs: 0,
        error: 'OPENCLAW_HOOKS_TOKEN not configured',
      };
    }

    // HONEST: We have a token but cannot verify it works without triggering a hook.
    // We report configured=true, probed=false to indicate we didn't actually test.
    // The UI should interpret this as "unknown" not "working".
    return {
      configured: true,
      probed: false, // IMPORTANT: false means "not tested"
      reachable: false, // Unknown - we didn't probe
      authenticated: false, // Unknown - we didn't probe
      latencyMs: Date.now() - startTime,
      error: 'Hooks cannot be probed without triggering side effects',
    };
  }

  /**
   * Test generation with a simple probe prompt
   * Returns partial result without `enabled` (caller adds that)
   */
  private async testGeneration(): Promise<{ working: boolean; latencyMs: number; error?: string }> {
    const startTime = Date.now();

    try {
      const result = await this.generate({
        systemPrompt: 'You are a test probe. Respond with exactly: OK',
        userPrompt: 'Respond with exactly one word: OK',
        maxTokens: 10,
      });

      const latencyMs = Date.now() - startTime;

      if (!result.success) {
        return {
          working: false,
          latencyMs,
          error: result.error,
        };
      }

      return {
        working: true,
        latencyMs,
      };
    } catch (err) {
      return {
        working: false,
        latencyMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Check gateway health status using GET /v1/models
   */
  async getStatus(): Promise<GatewayStatus> {
    try {
      const headers = this.getApiHeaders();

      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({})) as { data?: Array<{ id: string }> };
        this.restConnected = true;
        this.lastCheckTime = Date.now();

        return {
          connected: true,
          version: 'openclaw',
          sessions: data.data?.length || 0,
          lastPing: Date.now(),
        };
      }

      this.restConnected = false;
      return { connected: false, sessions: 0 };
    } catch (err) {
      logger.debug({ err }, 'Health check failed');
      this.restConnected = false;
      return { connected: false, sessions: 0 };
    }
  }

  /**
   * Check if REST API is connected (cached state)
   * Revalidates if connection state is stale
   *
   * NOTE: This uses cached state. For real connectivity check, use getQuickStatus()
   */
  isConnected(): boolean {
    if (this.isConnectionStale()) {
      // Don't block, just schedule a revalidation
      this.connect().catch(() => {});
    }
    return this.restConnected;
  }

  /**
   * Sync check if gateway is configured (has API key)
   * Does NOT guarantee connectivity - use getQuickStatus() or isConnected() for that
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Check if WebSocket RPC is connected
   */
  isWsConnected(): boolean {
    return this.wsConnected;
  }

  /**
   * Get last error message
   */
  getLastError(): string | undefined {
    return this.lastError;
  }

  /**
   * Quick status for StatusBar polling
   *
   * HONEST: Does NOT use cached state. Makes real requests to verify connectivity.
   * Faster than getDiagnostic() but still truthful.
   */
  async getQuickStatus(): Promise<QuickStatus> {
    const timestamp = Date.now();

    // Test REST API - REAL PROBE (fast, ~100-500ms)
    const restResult = await this.testRestApi();

    // Update cached state
    this.restConnected = restResult.reachable && restResult.authenticated;
    this.lastCheckTime = timestamp;

    // Hooks: only report configuration status (cannot probe without side effects)
    const hooksConfigured = !!this.hooksToken;

    // Probe: report if enabled and what we know
    // NOTE: We don't run the probe on quick status to keep it fast
    // The full diagnostic runs the actual generation probe
    const probeEnabled = this.enableGenerationProbe;

    return {
      timestamp,
      backend: true, // If we're responding, backend is up
      rest: {
        reachable: restResult.reachable,
        authenticated: restResult.authenticated,
        latencyMs: restResult.latencyMs,
        error: restResult.error,
      },
      hooks: {
        configured: hooksConfigured,
        probed: false, // Quick status never probes hooks
        working: false, // Unknown - not probed
        error: hooksConfigured ? 'Not probed (use diagnostic for full test)' : 'OPENCLAW_HOOKS_TOKEN not configured',
      },
      probe: {
        enabled: probeEnabled,
        tested: false, // Quick status doesn't run generation probe
        working: false, // Unknown - not tested
        error: probeEnabled ? 'Not tested (use diagnostic for full test)' : 'Probe disabled',
      },
      websocket: {
        connected: this.wsConnected,
      },
    };
  }

  /**
   * Connect to WebSocket RPC for real-time operations
   * Uses OpenClaw Protocol v3 with connect.challenge handshake
   *
   * Respects wsMode configuration:
   * - disabled: never attempt connection
   * - optional: connect but don't fail if it doesn't work
   * - required: connect and fail if it doesn't work
   */
  async connectWebSocket(): Promise<boolean> {
    // Check if WS is disabled
    if (this.wsMode === 'disabled') {
      logger.debug('WebSocket disabled by configuration (OPENCLAW_WS_MODE=disabled)');
      return false;
    }

    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      return true;
    }

    // Check max reconnect attempts
    if (this.wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      logger.warn({
        attempts: this.wsReconnectAttempts,
        maxAttempts: WS_MAX_RECONNECT_ATTEMPTS,
        lastCloseCode: this.wsLastCloseCode,
      }, 'WebSocket max reconnect attempts reached, giving up');
      return false;
    }

    return new Promise((resolve) => {
      try {
        // Use configured wsUrl
        logger.info({
          wsUrl: this.wsUrl,
          wsMode: this.wsMode,
          attempt: this.wsReconnectAttempts + 1,
        }, 'Connecting to WebSocket RPC');

        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          logger.debug('WebSocket connection opened, waiting for challenge');
        });

        this.ws.on('message', (data) => {
          this.handleWsMessage(data.toString(), resolve);
        });

        this.ws.on('close', (code, reason) => {
          const reasonStr = reason.toString();
          this.wsLastCloseCode = code;
          this.wsLastCloseReason = reasonStr;

          // Log with context about what happened
          const closeInfo = {
            code,
            reason: reasonStr,
            wsUrl: this.wsUrl,
            wsMode: this.wsMode,
            attempts: this.wsReconnectAttempts,
          };

          if (code === 1000) {
            // Normal close - could be server doesn't support WS or clean shutdown
            logger.info(closeInfo, 'WebSocket closed normally (code 1000). Server may not support WS protocol.');
          } else if (code === 1006) {
            // Abnormal close - connection failed
            logger.warn(closeInfo, 'WebSocket connection failed (code 1006). Check if server is running and accepts WS.');
          } else {
            logger.warn(closeInfo, 'WebSocket closed');
          }

          this.wsConnected = false;
          this.wsSessionId = null;
          this.cleanupWs();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
          logger.error({ err, wsUrl: this.wsUrl }, 'WebSocket error');
          this.wsConnected = false;
          resolve(false);
        });

        // Timeout for connection
        setTimeout(() => {
          if (!this.wsConnected) {
            logger.warn({ wsUrl: this.wsUrl, timeout: DEFAULT_TIMEOUT }, 'WebSocket connection timeout');
            this.ws?.close();
            resolve(false);
          }
        }, DEFAULT_TIMEOUT);

      } catch (err) {
        logger.error({ err, wsUrl: this.wsUrl }, 'Failed to create WebSocket connection');
        resolve(false);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWsMessage(data: string, connectResolve?: (value: boolean) => void): void {
    try {
      const message = JSON.parse(data);

      // Handle connect.challenge (Protocol v3)
      if (message.type === 'connect.challenge') {
        const challenge = message as WsConnectChallenge;
        this.sendWsHandshake(challenge.nonce);
        return;
      }

      // Handle connect.ack
      if (message.type === 'connect.ack') {
        const ack = message as WsConnectAck;
        this.wsSessionId = ack.sessionId;
        this.wsConnected = true;
        this.wsReconnectAttempts = 0; // Reset backoff on successful connection
        this.startPingInterval();
        logger.info({ sessionId: ack.sessionId }, 'WebSocket RPC connected');
        connectResolve?.(true);
        return;
      }

      // Handle RPC responses
      if (message.id && this.pendingRpcCalls.has(message.id)) {
        const pending = this.pendingRpcCalls.get(message.id)!;
        this.pendingRpcCalls.delete(message.id);

        const response = message as WsRpcResponse;
        if (response.error) {
          pending.reject(new OpenClawError(response.error.message, { code: response.error.code }));
        } else {
          pending.resolve(response.result);
        }
        return;
      }

      // Handle server-initiated events
      if (message.type) {
        this.handleWsEvent(message);
      }

    } catch (err) {
      logger.error({ err }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * Send handshake response to connect.challenge
   */
  private sendWsHandshake(nonce: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const handshake = {
      type: 'connect.handshake',
      nonce,
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        name: 'ocaas-gateway',
        version: '1.0.0',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: {
        token: this.apiKey || '',
      },
    };

    this.ws.send(JSON.stringify(handshake));
    logger.debug('Sent WebSocket handshake');
  }

  /**
   * Handle server-initiated WebSocket events
   */
  private handleWsEvent(event: { type: string; [key: string]: unknown }): void {
    logger.debug({ type: event.type }, 'Received WebSocket event');
    // Events can be used for real-time monitoring
    // Future: emit events to OCAAS event bus
  }

  /**
   * Send RPC request over WebSocket
   */
  private async rpcCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Try to connect first
      const connected = await this.connectWebSocket();
      if (!connected) {
        throw new OpenClawError('WebSocket not connected', { method });
      }
    }

    return new Promise((resolve, reject) => {
      const id = `rpc-${++this.rpcIdCounter}-${Date.now()}`;

      const request: WsRpcRequest = {
        id,
        method,
        params,
      };

      this.pendingRpcCalls.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      // Timeout for RPC call
      setTimeout(() => {
        if (this.pendingRpcCalls.has(id)) {
          this.pendingRpcCalls.delete(id);
          reject(new OpenClawError(`RPC call timed out: ${method}`, { method, timeout: DEFAULT_TIMEOUT }));
        }
      }, DEFAULT_TIMEOUT);

      this.ws!.send(JSON.stringify(request));
      logger.debug({ id, method }, 'Sent RPC request');
    });
  }

  /**
   * Start WebSocket ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, WS_PING_INTERVAL);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    // Don't reconnect if disabled
    if (this.wsMode === 'disabled') return;

    // Don't schedule if already scheduled
    if (this.reconnectTimeout) return;

    // Check max attempts
    if (this.wsReconnectAttempts >= WS_MAX_RECONNECT_ATTEMPTS) {
      logger.info({
        attempts: this.wsReconnectAttempts,
        maxAttempts: WS_MAX_RECONNECT_ATTEMPTS,
      }, 'WebSocket reconnection stopped: max attempts reached');
      return;
    }

    // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, ..., max 60s
    const delay = Math.min(
      WS_RECONNECT_BASE_DELAY * Math.pow(2, this.wsReconnectAttempts),
      WS_RECONNECT_MAX_DELAY
    );

    this.wsReconnectAttempts++;

    logger.debug({
      attempt: this.wsReconnectAttempts,
      delayMs: delay,
      maxAttempts: WS_MAX_RECONNECT_ATTEMPTS,
    }, 'Scheduling WebSocket reconnection');

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      if (!this.wsConnected && this.restConnected) {
        logger.info({ attempt: this.wsReconnectAttempts }, 'Attempting WebSocket reconnection');
        const connected = await this.connectWebSocket();
        if (connected) {
          // Reset attempts on successful connection
          this.wsReconnectAttempts = 0;
        }
      }
    }, delay);
  }

  /**
   * Reset WebSocket reconnection attempts (call after successful REST connection)
   */
  resetWsReconnectAttempts(): void {
    this.wsReconnectAttempts = 0;
  }

  /**
   * Cleanup WebSocket resources
   */
  private cleanupWs(): void {
    this.stopPingInterval();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // Reject all pending RPC calls
    for (const [id, pending] of this.pendingRpcCalls) {
      pending.reject(new OpenClawError('WebSocket disconnected'));
      this.pendingRpcCalls.delete(id);
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    this.cleanupWs();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
    this.wsSessionId = null;
    logger.info('WebSocket disconnected');
  }

  /**
   * Generate content using LLM via /v1/chat/completions (synchronous)
   *
   * This is the primary method for AI generation in OCAAS.
   * Used by: AgentGenerator, SkillGenerator, ToolGenerator, TaskAnalyzer
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // Revalidate connection if stale
    if (this.isConnectionStale()) {
      await this.connect();
    }

    if (!this.restConnected) {
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

      // Build request body
      const requestBody: Record<string, unknown> = { messages };
      if (options.maxTokens) {
        requestBody.max_tokens = options.maxTokens;
      }

      const response = await this.apiRequest<ChatCompletionResponse>(
        'POST',
        '/v1/chat/completions',
        requestBody,
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
    if (!this.hooksToken) {
      logger.warn('Hooks token not configured, notification unavailable');
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
   * PRIMARY EXECUTION: Run agent via /hooks/agent with sessionKey
   *
   * This is the main execution path for OCAAS.
   * Uses sessionKey for stateful session management in OpenClaw.
   *
   * POST /hooks/agent with:
   * - message: The prompt/task
   * - sessionKey: Stable key like hook:ocaas:task-{taskId}
   * - name: Agent display name
   * - wakeMode: 'now' for immediate execution
   * - deliver: false to get response back (vs fire-and-forget)
   *
   * Authentication: x-openclaw-token header
   */
  async runViaHooksAgent(options: HooksAgentOptions): Promise<HooksAgentResult> {
    if (!this.hooksToken) {
      logger.warn('Hooks token not configured, runViaHooksAgent unavailable');
      return {
        success: false,
        error: 'OPENCLAW_HOOKS_TOKEN not configured',
      };
    }

    try {
      // PROMPT 7: Validation warnings (non-blocking)
      if (!options.agentId) {
        logger.warn({
          sessionKey: options.sessionKey,
        }, 'hooks dispatch without explicit agentId (may rely on gateway defaults)');
      }

      if (options.sessionKey && !options.sessionKey.startsWith('hook:ocaas:')) {
        logger.warn({
          sessionKey: options.sessionKey,
        }, 'sessionKey does not follow hook:ocaas: convention');
      }

      logger.info({
        agentId: options.agentId,
        sessionKey: options.sessionKey,
        messageLength: options.message.length,
      }, 'Running agent via /hooks/agent (PRIMARY MODE)');

      // PROMPT 7: Include agentId in payload
      const body: Record<string, unknown> = {
        message: options.message,
        sessionKey: options.sessionKey,
        agentId: options.agentId,
        name: options.name || `OCAAS Agent ${options.agentId}`,
        wakeMode: options.wakeMode || 'now',
        deliver: options.deliver ?? false, // Default to sync response
      };

      if (options.channel) {
        body.channel = options.channel;
      }

      await this.webhookRequest('/agent', body);

      logger.info({
        sessionKey: options.sessionKey,
        agentId: options.agentId,
      }, 'Agent execution accepted via /hooks/agent');

      return {
        success: true,
        sessionKey: options.sessionKey,
        accepted: true,
        // Note: /hooks/agent is fire-and-forget, response comes via channel
        // For sync response, would need different endpoint or polling
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, agentId: options.agentId, sessionKey: options.sessionKey }, 'runViaHooksAgent failed');
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Check if hooks are configured and available
   */
  isHooksConfigured(): boolean {
    return !!this.hooksToken;
  }

  /**
   * Wake an agent using POST /hooks/wake
   */
  async wake(agentId: string): Promise<boolean> {
    if (!this.hooksToken) {
      logger.warn('Hooks token not configured, wake unavailable');
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
    if (!this.restConnected && !this.hooksConnected) {
      logger.error('Gateway not connected - cannot spawn agent session');
      throw new OpenClawError('Gateway not connected - cannot spawn agent session', {
        operation: 'spawn',
        agentId: options.agentId,
      });
    }

    try {
      // Generate local session ID (OpenClaw manages its own sessions)
      const sessionId = `ocaas-${options.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Send initialization notification if hooks are available
      if (this.hooksToken) {
        await this.webhookRequest('/agent', {
          message: `[OCAAS] Agent ${options.agentId} initialized\nPrompt: ${options.prompt}`,
          agentId: options.agentId,
          deliver: false, // Don't deliver to channel, just initialize
          wakeMode: 'now',
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
   * Send a message to an agent and get response
   *
   * Uses /v1/chat/completions for synchronous response
   */
  async send(options: SendOptions): Promise<SendResult> {
    if (!this.restConnected) {
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
    if (!this.restConnected) {
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
   * List active sessions via WebSocket RPC
   * Uses: sessions.list method
   */
  async listSessions(): Promise<OpenClawSession[]> {
    if (!this.wsConnected) {
      logger.debug('WebSocket not connected, returning empty sessions');
      return [];
    }

    try {
      const result = await this.rpcCall<{ sessions: Array<{ id: string; status: string; createdAt: number }> }>('sessions.list');

      return (result.sessions || []).map(s => ({
        id: s.id,
        agentId: s.id.split('-')[1] || 'unknown',
        status: s.status as 'active' | 'inactive' | 'error',
        createdAt: s.createdAt,
      }));
    } catch (err) {
      logger.error({ err }, 'Failed to list sessions');
      return [];
    }
  }

  /**
   * Abort/cancel a running chat session via WebSocket RPC
   * Uses: chat.abort method
   */
  async abortSession(sessionId: string): Promise<boolean> {
    if (!this.wsConnected) {
      logger.warn('WebSocket not connected, cannot abort session');
      return false;
    }

    try {
      await this.rpcCall('chat.abort', { sessionId });
      logger.info({ sessionId }, 'Session aborted');
      return true;
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to abort session');
      return false;
    }
  }

  /**
   * Patch/update a session via WebSocket RPC
   * Uses: sessions.patch method
   */
  async patchSession(sessionId: string, patch: Record<string, unknown>): Promise<boolean> {
    if (!this.wsConnected) {
      logger.warn('WebSocket not connected, cannot patch session');
      return false;
    }

    try {
      await this.rpcCall('sessions.patch', { sessionId, ...patch });
      logger.info({ sessionId }, 'Session patched');
      return true;
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to patch session');
      return false;
    }
  }

  /**
   * List cron jobs via WebSocket RPC
   * Uses: cron.list method
   */
  async listCronJobs(): Promise<Array<{ id: string; schedule: string; enabled: boolean }>> {
    if (!this.wsConnected) {
      logger.debug('WebSocket not connected, returning empty cron jobs');
      return [];
    }

    try {
      const result = await this.rpcCall<{ jobs: Array<{ id: string; schedule: string; enabled: boolean }> }>('cron.list');
      return result.jobs || [];
    } catch (err) {
      logger.error({ err }, 'Failed to list cron jobs');
      return [];
    }
  }

  /**
   * Enable/disable a cron job via WebSocket RPC
   * Uses: cron.patch method
   */
  async setCronJobEnabled(jobId: string, enabled: boolean): Promise<boolean> {
    if (!this.wsConnected) {
      logger.warn('WebSocket not connected, cannot update cron job');
      return false;
    }

    try {
      await this.rpcCall('cron.patch', { id: jobId, enabled });
      logger.info({ jobId, enabled }, 'Cron job updated');
      return true;
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to update cron job');
      return false;
    }
  }

  /**
   * Clean shutdown - disconnect all connections
   */
  async shutdown(): Promise<void> {
    this.disconnectWebSocket();
    this.restConnected = false;
    this.hooksConnected = false;
    logger.info('Gateway shutdown complete');
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

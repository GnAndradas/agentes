import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create shared mock gateway instance
const mockGateway = {
  isConfigured: vi.fn(() => true),
  isConnected: vi.fn(() => true),
  isWsConnected: vi.fn(() => false),
  getQuickStatus: vi.fn(),
  getStatus: vi.fn(),
  getDiagnostic: vi.fn(),
  generate: vi.fn(),
  spawn: vi.fn(),
  send: vi.fn(),
  exec: vi.fn(),
  notify: vi.fn(),
  terminate: vi.fn(),
  abortSession: vi.fn(),
  listSessions: vi.fn(),
  listCronJobs: vi.fn(),
  setCronJobEnabled: vi.fn(),
  connect: vi.fn(),
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  shutdown: vi.fn(),
};

// Mock the gateway module before importing adapter
vi.mock('../src/openclaw/gateway.js', () => {
  return {
    getGateway: vi.fn(() => mockGateway),
    OpenClawGateway: vi.fn(() => mockGateway),
  };
});

import { OpenClawAdapter, getOpenClawAdapter, resetOpenClawAdapter } from '../src/integrations/openclaw/index.js';

describe('OpenClawAdapter', () => {
  let adapter: OpenClawAdapter;

  beforeEach(() => {
    // Reset all mocks but keep default return values
    vi.clearAllMocks();
    mockGateway.isConfigured.mockReturnValue(true);
    mockGateway.isConnected.mockReturnValue(true);
    mockGateway.isWsConnected.mockReturnValue(false);
    resetOpenClawAdapter();
    adapter = getOpenClawAdapter();
  });

  describe('isConfigured', () => {
    it('should return true when gateway is configured', () => {
      mockGateway.isConfigured.mockReturnValue(true);
      expect(adapter.isConfigured()).toBe(true);
    });

    it('should return false when gateway is not configured', () => {
      mockGateway.isConfigured.mockReturnValue(false);
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return true when gateway is connected', () => {
      mockGateway.isConnected.mockReturnValue(true);
      expect(adapter.isConnected()).toBe(true);
    });

    it('should return false when gateway is not connected', () => {
      mockGateway.isConnected.mockReturnValue(false);
      expect(adapter.isConnected()).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return status from gateway', async () => {
      mockGateway.getQuickStatus.mockResolvedValue({
        timestamp: Date.now(),
        backend: true,
        rest: { reachable: true, authenticated: true, latencyMs: 50 },
        websocket: { connected: false },
        hooks: { configured: true, probed: false, working: false },
        probe: { enabled: false, tested: false, working: false },
      });

      const status = await adapter.getStatus();

      expect(status.connected).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.rest.reachable).toBe(true);
      expect(status.rest.authenticated).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      mockGateway.getQuickStatus.mockRejectedValue(new Error('Connection refused'));

      const status = await adapter.getStatus();

      expect(status.connected).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('generate', () => {
    it('should generate content successfully', async () => {
      mockGateway.generate.mockResolvedValue({
        success: true,
        content: 'Generated content',
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await adapter.generate({
        systemPrompt: 'You are a helper',
        userPrompt: 'Generate something',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Generated content');
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('should handle generation failure', async () => {
      mockGateway.generate.mockResolvedValue({
        success: false,
        error: 'Rate limited',
      });

      const result = await adapter.generate({
        systemPrompt: 'You are a helper',
        userPrompt: 'Generate something',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('execution_error');
      expect(result.error?.message).toContain('Rate limited');
    });

    it('should return error when not configured', async () => {
      mockGateway.isConfigured.mockReturnValue(false);

      const result = await adapter.generate({
        systemPrompt: 'You are a helper',
        userPrompt: 'Generate something',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('not_configured');
    });
  });

  describe('executeAgent', () => {
    it('should spawn and send to agent successfully', async () => {
      mockGateway.spawn.mockResolvedValue({
        success: true,
        sessionId: 'session-123',
      });
      mockGateway.send.mockResolvedValue({
        success: true,
        response: 'Agent response',
      });

      const result = await adapter.executeAgent({
        agentId: 'agent-1',
        prompt: 'Do something',
      });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('session-123');
      expect(result.response).toBe('Agent response');
    });

    it('should handle spawn failure', async () => {
      mockGateway.spawn.mockResolvedValue({
        success: false,
        sessionId: '',
        error: 'Agent not found',
      });

      const result = await adapter.executeAgent({
        agentId: 'agent-1',
        prompt: 'Do something',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('execution_error');
      expect(result.error?.message).toContain('Agent not found');
    });
  });

  describe('notifyChannel', () => {
    it('should send notification successfully', async () => {
      mockGateway.notify.mockResolvedValue(true);

      const result = await adapter.notifyChannel({
        channel: 'telegram',
        message: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(mockGateway.notify).toHaveBeenCalledWith('Hello!', 'telegram');
    });

    it('should handle notification failure', async () => {
      mockGateway.notify.mockResolvedValue(false);

      const result = await adapter.notifyChannel({
        channel: 'telegram',
        message: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('execution_error');
    });
  });

  describe('sendTask', () => {
    it('should send task to session successfully', async () => {
      mockGateway.send.mockResolvedValue({
        success: true,
        response: 'Task completed',
      });

      const result = await adapter.sendTask({
        sessionId: 'session-123',
        message: 'Execute task',
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Task completed');
    });
  });

  describe('executeTool', () => {
    it('should execute tool successfully', async () => {
      mockGateway.exec.mockResolvedValue({
        success: true,
        output: { result: 'done' },
      });

      const result = await adapter.executeTool({
        sessionId: 'session-123',
        toolName: 'my-tool',
        input: { param: 'value' },
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: 'done' });
    });
  });

  describe('error normalization', () => {
    it('should normalize timeout errors', async () => {
      mockGateway.generate.mockRejectedValue(new Error('Request timed out after 30s'));

      const result = await adapter.generate({
        systemPrompt: 'test',
        userPrompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('timeout');
    });

    it('should normalize auth errors', async () => {
      mockGateway.generate.mockRejectedValue(new Error('401 Unauthorized'));

      const result = await adapter.generate({
        systemPrompt: 'test',
        userPrompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('auth_error');
    });

    it('should normalize connection errors', async () => {
      mockGateway.generate.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await adapter.generate({
        systemPrompt: 'test',
        userPrompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('connection_error');
    });

    it('should normalize rate limit errors', async () => {
      mockGateway.generate.mockRejectedValue(new Error('429 Too Many Requests'));

      const result = await adapter.generate({
        systemPrompt: 'test',
        userPrompt: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('rate_limited');
    });
  });

  describe('session management', () => {
    it('should list sessions', async () => {
      mockGateway.listSessions.mockResolvedValue([
        { id: 'session-1', agentId: 'agent-1', status: 'active', createdAt: Date.now() },
      ]);

      const result = await adapter.listSessions();

      expect(result.success).toBe(true);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe('session-1');
    });

    it('should terminate session', async () => {
      mockGateway.terminate.mockResolvedValue(true);

      const result = await adapter.terminateSession('session-123');

      expect(result).toBe(true);
      expect(mockGateway.terminate).toHaveBeenCalledWith('session-123');
    });

    it('should abort session', async () => {
      mockGateway.abortSession.mockResolvedValue(true);

      const result = await adapter.abortSession('session-123');

      expect(result).toBe(true);
      expect(mockGateway.abortSession).toHaveBeenCalledWith('session-123');
    });
  });

  describe('testConnection', () => {
    it('should return success with latency when connected', async () => {
      mockGateway.getStatus.mockResolvedValue({
        connected: true,
        version: 'v1',
        sessions: 0,
        lastPing: Date.now(),
      });

      const result = await adapter.testConnection();

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return failure when not connected', async () => {
      mockGateway.getStatus.mockResolvedValue({
        connected: false,
        sessions: 0,
      });

      const result = await adapter.testConnection();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('connection_error');
    });
  });

  describe('singleton behavior', () => {
    it('should return same instance', () => {
      const adapter1 = getOpenClawAdapter();
      const adapter2 = getOpenClawAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it('should reset instance', () => {
      const adapter1 = getOpenClawAdapter();
      resetOpenClawAdapter();
      const adapter2 = getOpenClawAdapter();

      expect(adapter1).not.toBe(adapter2);
    });
  });
});

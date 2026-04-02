/**
 * ToolInvoker Tests
 *
 * Tests for API tool invocation with detailed error handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToolInvoker } from '../ToolInvoker.js';
import { EXECUTION_MODE, EXECUTION_STATUS } from '../SkillExecutionTypes.js';
import type { ToolDTO } from '../../../types/domain.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ToolInvoker', () => {
  let invoker: ToolInvoker;

  beforeEach(() => {
    invoker = new ToolInvoker();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createApiTool = (config: Record<string, unknown>): ToolDTO => ({
    id: 'tool-1',
    name: 'Test API Tool',
    description: 'Test tool',
    version: '1.0.0',
    path: '/tools/test',
    type: 'api',
    status: 'active',
    inputSchema: undefined,
    outputSchema: undefined,
    config,
    executionCount: 0,
    lastExecutedAt: undefined,
    syncedAt: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  describe('API Tool Invocation - Success Cases', () => {
    it('should successfully call API and parse JSON response', async () => {
      const responseData = { result: 'success', value: 42 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => JSON.stringify(responseData),
      });

      const tool = createApiTool({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(result.output).toEqual(responseData);
      expect(result.error).toBeUndefined();
    });

    it('should handle text response when responseType is text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/plain']]),
        text: async () => 'Hello World',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/text',
        method: 'GET',
        responseType: 'text',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(result.output).toEqual({ text: 'Hello World' });
    });
  });

  describe('API Tool Invocation - HTTP Error Cases', () => {
    it('should handle 404 Not Found with detailed error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"error": "Resource not found"}',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/missing',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('404');
      expect(result.error).toContain('Not Found');
      expect(result.output).toMatchObject({
        errorType: 'http_error',
        statusCode: 404,
        hint: expect.stringContaining('not found'),
      });
    });

    it('should handle 401 Unauthorized with auth hint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"error": "Invalid API key"}',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/protected',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.output).toMatchObject({
        errorType: 'http_error',
        statusCode: 401,
        hint: expect.stringContaining('authentication'),
      });
    });

    it('should handle 500 Server Error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<html><body>Error</body></html>',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/error',
        method: 'POST',
      });

      const result = await invoker.invoke(
        { tool, input: { data: 'test' }, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.output).toMatchObject({
        errorType: 'http_error',
        statusCode: 500,
        hint: expect.stringContaining('Server error'),
      });
    });

    it('should handle 429 Rate Limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"error": "Rate limit exceeded"}',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/limited',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.output).toMatchObject({
        errorType: 'http_error',
        statusCode: 429,
        hint: expect.stringContaining('Rate limited'),
      });
    });
  });

  describe('API Tool Invocation - Content Type Errors', () => {
    it('should detect HTML response when expecting JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => '<!DOCTYPE html><html><body>Web page</body></html>',
      });

      const tool = createApiTool({
        url: 'https://example.com/page',
        method: 'GET',
        responseType: 'json',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('HTML');
      expect(result.output).toMatchObject({
        errorType: 'unexpected_content_type',
        expectedType: 'application/json',
        hint: expect.stringContaining('web page'),
      });
    });

    it('should handle JSON parse error with invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{invalid json}',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/broken',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('parse');
      expect(result.output).toMatchObject({
        errorType: 'json_parse_error',
        hint: expect.stringContaining('invalid JSON'),
      });
    });
  });

  describe('API Tool Invocation - Network Errors', () => {
    it('should handle connection refused', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      mockFetch.mockRejectedValueOnce(error);

      const tool = createApiTool({
        url: 'http://localhost:3000/api',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('Connection refused');
      expect(result.output).toMatchObject({
        errorType: 'connection_refused',
        hint: expect.stringContaining('server is running'),
      });
    });

    it('should handle DNS resolution failure', async () => {
      const error = new Error('getaddrinfo ENOTFOUND invalid.domain.xyz');
      mockFetch.mockRejectedValueOnce(error);

      const tool = createApiTool({
        url: 'https://invalid.domain.xyz/api',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('hostname');
      expect(result.output).toMatchObject({
        errorType: 'dns_error',
        hint: expect.stringContaining('typos'),
      });
    });

    it('should handle timeout', async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(error);

      const tool = createApiTool({
        url: 'https://api.slow.com/endpoint',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 1000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('timed out');
      expect(result.output).toMatchObject({
        errorType: 'timeout',
        hint: expect.stringContaining('timeout'),
      });
    });

    it('should handle SSL certificate error', async () => {
      const error = new Error('unable to verify the first certificate');
      mockFetch.mockRejectedValueOnce(error);

      const tool = createApiTool({
        url: 'https://self-signed.example.com/api',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.output).toMatchObject({
        errorType: 'ssl_error',
        hint: expect.stringContaining('certificate'),
      });
    });
  });

  describe('API Tool Invocation - URL Validation', () => {
    it('should reject invalid URL', async () => {
      const tool = createApiTool({
        url: 'not-a-valid-url',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('Invalid URL');
      expect(result.output).toMatchObject({
        errorType: 'invalid_url',
        suggestion: expect.stringContaining('properly formatted'),
      });
    });

    it('should handle URL template substitution', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"id": 123}',
      });

      const tool = createApiTool({
        url: 'https://api.example.com/users/{{userId}}',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: { userId: '123' }, timeoutMs: 5000 },
        EXECUTION_MODE.RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/123',
        expect.any(Object)
      );
    });
  });

  describe('Dry Run Mode', () => {
    it('should return simulated result without making request', async () => {
      const tool = createApiTool({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.DRY_RUN
      );

      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(result.output).toMatchObject({ _dryRun: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Validate Mode', () => {
    it('should validate tool config without making request', async () => {
      const tool = createApiTool({
        url: 'https://api.example.com/data',
        method: 'GET',
      });

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.VALIDATE
      );

      expect(result.status).toBe(EXECUTION_STATUS.SUCCESS);
      expect(result.output).toMatchObject({ _validated: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should fail validation if URL is missing', async () => {
      const tool = createApiTool({});

      const result = await invoker.invoke(
        { tool, input: {}, timeoutMs: 5000 },
        EXECUTION_MODE.VALIDATE
      );

      expect(result.status).toBe(EXECUTION_STATUS.FAILED);
      expect(result.error).toContain('URL');
    });
  });
});

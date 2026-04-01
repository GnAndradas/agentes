/**
 * Bootstrap Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BootstrapCheck } from '../src/bootstrap/types.js';

// Mock environment
const originalEnv = { ...process.env };

describe('Bootstrap Checks', () => {
  beforeEach(() => {
    vi.resetModules();
    // Reset env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('checkEnvironmentVariables', () => {
    it('should fail when required env vars are missing', async () => {
      // Remove required vars
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_KEY;
      delete process.env.API_SECRET_KEY;

      const { checkEnvironmentVariables } = await import('../src/bootstrap/checks.js');
      const result = checkEnvironmentVariables();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('Missing required');
    });

    it('should pass when all required env vars are present', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_API_KEY = 'test-key';
      process.env.API_SECRET_KEY = 'test-api-key-16ch';

      const { checkEnvironmentVariables } = await import('../src/bootstrap/checks.js');
      const result = checkEnvironmentVariables();

      expect(result.status).toBe('ok');
    });
  });

  describe('checkApiSecretKey', () => {
    it('should fail when API_SECRET_KEY is not set', async () => {
      delete process.env.API_SECRET_KEY;

      const { checkApiSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkApiSecretKey();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('not set');
    });

    it('should fail when API_SECRET_KEY is too short', async () => {
      process.env.API_SECRET_KEY = 'short';

      const { checkApiSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkApiSecretKey();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('at least 16 characters');
    });

    it('should pass when API_SECRET_KEY is valid', async () => {
      process.env.API_SECRET_KEY = 'this-is-a-valid-api-key-123';

      const { checkApiSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkApiSecretKey();

      expect(result.status).toBe('ok');
    });
  });

  describe('checkChannelSecretKey', () => {
    it('should warn when no channel or api key is set', async () => {
      delete process.env.CHANNEL_SECRET_KEY;
      delete process.env.API_SECRET_KEY;

      const { checkChannelSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkChannelSecretKey();

      expect(result.status).toBe('warn');
    });

    it('should pass when CHANNEL_SECRET_KEY is set', async () => {
      process.env.CHANNEL_SECRET_KEY = 'channel-key-at-least-16';

      const { checkChannelSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkChannelSecretKey();

      expect(result.status).toBe('ok');
      expect(result.message).toContain('CHANNEL_SECRET_KEY configured');
    });

    it('should pass using API_SECRET_KEY fallback', async () => {
      delete process.env.CHANNEL_SECRET_KEY;
      process.env.API_SECRET_KEY = 'api-key-at-least-16-chars';

      const { checkChannelSecretKey } = await import('../src/bootstrap/checks.js');
      const result = checkChannelSecretKey();

      expect(result.status).toBe('ok');
      expect(result.message).toContain('API_SECRET_KEY for channels');
    });
  });

  describe('checkOpenClawConfig', () => {
    it('should fail when OPENCLAW_GATEWAY_URL is not set', async () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      process.env.OPENCLAW_API_KEY = 'test-key';

      const { checkOpenClawConfig } = await import('../src/bootstrap/checks.js');
      const result = await checkOpenClawConfig();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('OPENCLAW_GATEWAY_URL');
    });

    it('should fail when OPENCLAW_API_KEY is not set', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      delete process.env.OPENCLAW_API_KEY;

      const { checkOpenClawConfig } = await import('../src/bootstrap/checks.js');
      const result = await checkOpenClawConfig();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('OPENCLAW_API_KEY');
    });

    it('should fail when URL is invalid', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'not-a-valid-url';
      process.env.OPENCLAW_API_KEY = 'test-key';

      const { checkOpenClawConfig } = await import('../src/bootstrap/checks.js');
      const result = await checkOpenClawConfig();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('Invalid');
    });

    it('should pass when config is valid', async () => {
      process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
      process.env.OPENCLAW_API_KEY = 'test-key';

      const { checkOpenClawConfig } = await import('../src/bootstrap/checks.js');
      const result = await checkOpenClawConfig();

      expect(result.status).toBe('ok');
    });
  });

  describe('checkDirectories', () => {
    it('should create missing directories', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      // Use temp directory
      const tempDir = path.join(os.tmpdir(), `ocaas-test-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const { checkDirectories } = await import('../src/bootstrap/checks.js');
      const result = checkDirectories(tempDir);

      expect(result.status).toBe('ok');

      // Verify directories were created
      expect(fs.existsSync(path.join(tempDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'data'))).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe('checkLogging', () => {
    it('should verify logging is writable', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const tempDir = path.join(os.tmpdir(), `ocaas-log-test-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const { checkLogging } = await import('../src/bootstrap/checks.js');
      const result = checkLogging(tempDir);

      expect(result.status).toBe('ok');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe('checkDatabaseSchema', () => {
    it('should fail when database file does not exist', async () => {
      // This test runs without DB setup, so it should fail gracefully
      const { checkDatabaseSchema } = await import('../src/bootstrap/checks.js');

      // Mock config to use non-existent path
      vi.mock('../src/config/index.js', () => ({
        config: {
          database: {
            url: '/tmp/nonexistent-db-test-' + Date.now() + '.db',
          },
        },
      }));

      // Re-import after mock
      const checksModule = await import('../src/bootstrap/checks.js');
      const result = await checksModule.checkDatabaseSchema();

      // Should fail because DB doesn't exist
      expect(result.status).toBe('fail');
      expect(result.message).toMatch(/does not exist|Schema check error/);
    });
  });
});

describe('Bootstrap Result', () => {
  beforeEach(() => {
    vi.resetModules();
    // Set up valid environment
    process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
    process.env.OPENCLAW_API_KEY = 'test-key';
    process.env.API_SECRET_KEY = 'this-is-a-valid-api-key-123';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should return NOT_READY when critical checks fail', async () => {
    delete process.env.API_SECRET_KEY;

    // Mock the checks that need external resources
    vi.mock('../src/db/index.js', () => ({
      db: {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ test: 1 }),
        }),
      },
    }));

    vi.mock('../src/integrations/openclaw/index.js', () => ({
      getOpenClawAdapter: vi.fn(() => ({
        testConnection: vi.fn().mockResolvedValue({ success: false }),
      })),
    }));

    vi.mock('../src/orchestrator/resilience/index.js', () => ({
      getCheckpointStore: vi.fn(() => ({
        getStats: vi.fn().mockReturnValue({ total: 0 }),
      })),
      getExecutionLeaseStore: vi.fn(() => ({
        getStats: vi.fn().mockReturnValue({ total: 0 }),
      })),
      getCircuitBreakersSummary: vi.fn(() => ({
        total: 0,
        closed: 0,
        open: 0,
        halfOpen: 0,
      })),
    }));

    vi.mock('../src/system/index.js', () => ({
      getSystemDiagnosticsService: vi.fn(() => ({
        getSystemHealth: vi.fn().mockResolvedValue({
          status: 'healthy',
          score: 100,
          criticalIssues: [],
        }),
      })),
    }));

    const { bootstrap } = await import('../src/bootstrap/startup.js');
    const result = await bootstrap({ silent: true, skipOpenClaw: true });

    expect(result.status).toBe('NOT_READY');
    expect(result.criticalFailures.length).toBeGreaterThan(0);
  });
});

describe('Doctor Command', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.OPENCLAW_GATEWAY_URL = 'http://localhost:18789';
    process.env.OPENCLAW_API_KEY = 'test-key';
    process.env.API_SECRET_KEY = 'this-is-a-valid-api-key-123';
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should include environment info in result', async () => {
    // Mock all external dependencies
    vi.mock('../src/db/index.js', () => ({
      db: {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn().mockReturnValue({ test: 1 }),
          all: vi.fn().mockReturnValue([
            { name: 'tasks' },
            { name: 'agents' },
            { name: 'skills' },
            { name: 'tools' },
            { name: 'events' },
          ]),
        }),
        pragma: vi.fn().mockReturnValue([{ integrity_check: 'ok' }]),
      },
    }));

    vi.mock('../src/integrations/openclaw/index.js', () => ({
      getOpenClawAdapter: vi.fn(() => ({
        testConnection: vi.fn().mockResolvedValue({ success: true, latencyMs: 50 }),
        getStatus: vi.fn().mockResolvedValue({
          connected: true,
          rest: { authenticated: true },
          websocket: { connected: false },
        }),
      })),
    }));

    vi.mock('../src/orchestrator/resilience/index.js', () => ({
      getCheckpointStore: vi.fn(() => ({
        getStats: vi.fn().mockReturnValue({ total: 0 }),
      })),
      getExecutionLeaseStore: vi.fn(() => ({
        getStats: vi.fn().mockReturnValue({ total: 0 }),
      })),
      getCircuitBreakersSummary: vi.fn(() => ({
        total: 3,
        closed: 3,
        open: 0,
        halfOpen: 0,
      })),
    }));

    vi.mock('../src/system/index.js', () => ({
      getSystemDiagnosticsService: vi.fn(() => ({
        getSystemHealth: vi.fn().mockResolvedValue({
          status: 'healthy',
          score: 100,
          criticalIssues: [],
        }),
        getReadinessReport: vi.fn().mockResolvedValue({
          ready: true,
          score: 100,
          blockers: [],
          nonBlockers: [],
        }),
      })),
    }));

    const { doctor } = await import('../src/bootstrap/doctor.js');
    const result = await doctor({ silent: true });

    expect(result.environment).toBeDefined();
    expect(result.environment.nodeVersion).toBe(process.version);
    expect(result.environment.platform).toBe(process.platform);
    expect(result.configuration).toBeDefined();
    expect(result.configuration.envVars).toBeDefined();
  });
});

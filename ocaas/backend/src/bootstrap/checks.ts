/**
 * Bootstrap Checks
 *
 * Individual verification functions for system startup.
 */

import fs from 'fs';
import path from 'path';
import type { BootstrapCheck, CheckStatus } from './types.js';

// =============================================================================
// ENVIRONMENT CHECKS
// =============================================================================

const REQUIRED_ENV_VARS = [
  'OPENCLAW_GATEWAY_URL',
  'OPENCLAW_API_KEY',
  'API_SECRET_KEY',
];

const OPTIONAL_ENV_VARS = [
  'CHANNEL_SECRET_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_ALLOWED_USER_IDS',
  'DATABASE_PATH',
  'LOG_LEVEL',
  'PORT',
];

export function checkEnvironmentVariables(): BootstrapCheck {
  const missing: string[] = [];
  const present: string[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    } else {
      present.push(envVar);
    }
  }

  if (missing.length > 0) {
    return {
      name: 'environment_variables',
      status: 'fail',
      message: `Missing required environment variables: ${missing.join(', ')}`,
      details: { missing, present, required: REQUIRED_ENV_VARS },
    };
  }

  // Check optional vars
  const optionalMissing = OPTIONAL_ENV_VARS.filter(v => !process.env[v]);

  return {
    name: 'environment_variables',
    status: 'ok',
    message: `All ${REQUIRED_ENV_VARS.length} required environment variables present`,
    details: {
      present,
      optionalMissing,
    },
  };
}

export function checkApiSecretKey(): BootstrapCheck {
  const key = process.env.API_SECRET_KEY;

  if (!key) {
    return {
      name: 'api_secret_key',
      status: 'fail',
      message: 'API_SECRET_KEY not set',
    };
  }

  if (key.length < 16) {
    return {
      name: 'api_secret_key',
      status: 'fail',
      message: 'API_SECRET_KEY must be at least 16 characters',
      details: { length: key.length, required: 16 },
    };
  }

  return {
    name: 'api_secret_key',
    status: 'ok',
    message: 'API_SECRET_KEY is valid',
  };
}

export function checkChannelSecretKey(): BootstrapCheck {
  const channelKey = process.env.CHANNEL_SECRET_KEY;
  const apiKey = process.env.API_SECRET_KEY;

  if (!channelKey && !apiKey) {
    return {
      name: 'channel_secret_key',
      status: 'warn',
      message: 'No CHANNEL_SECRET_KEY or API_SECRET_KEY set - channel auth will fail',
    };
  }

  const key = channelKey || apiKey;
  if (key && key.length < 16) {
    return {
      name: 'channel_secret_key',
      status: 'warn',
      message: 'Channel secret key should be at least 16 characters',
    };
  }

  return {
    name: 'channel_secret_key',
    status: 'ok',
    message: channelKey ? 'CHANNEL_SECRET_KEY configured' : 'Using API_SECRET_KEY for channels',
  };
}

// =============================================================================
// DIRECTORY CHECKS
// =============================================================================

const REQUIRED_DIRECTORIES = [
  { path: 'logs', writable: true },
  { path: 'data', writable: true },
];

export function checkDirectories(baseDir: string): BootstrapCheck {
  const issues: string[] = [];
  const created: string[] = [];

  for (const dir of REQUIRED_DIRECTORIES) {
    const fullPath = path.join(baseDir, dir.path);

    try {
      if (!fs.existsSync(fullPath)) {
        // Try to create
        fs.mkdirSync(fullPath, { recursive: true });
        created.push(dir.path);
      }

      if (dir.writable) {
        // Test write permission
        const testFile = path.join(fullPath, '.write-test');
        try {
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
        } catch {
          issues.push(`${dir.path}: not writable`);
        }
      }
    } catch (err) {
      issues.push(`${dir.path}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  if (issues.length > 0) {
    return {
      name: 'directories',
      status: 'fail',
      message: `Directory issues: ${issues.join('; ')}`,
      details: { issues, created },
    };
  }

  return {
    name: 'directories',
    status: 'ok',
    message: `All required directories exist and are writable`,
    details: { created: created.length > 0 ? created : undefined },
  };
}

// =============================================================================
// DATABASE CHECKS
// =============================================================================

export async function checkDatabase(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    // Dynamic import to avoid loading DB at module level
    // Using initDatabase to verify DB is accessible
    const { initDatabase } = await import('../db/index.js');
    await initDatabase();

    return {
      name: 'database',
      status: 'ok',
      message: 'Database connection verified',
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'database',
      status: 'fail',
      message: `Database error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// OPENCLAW CHECKS
// =============================================================================

export async function checkOpenClawConfig(): Promise<BootstrapCheck> {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  const key = process.env.OPENCLAW_API_KEY;

  if (!url) {
    return {
      name: 'openclaw_config',
      status: 'fail',
      message: 'OPENCLAW_GATEWAY_URL not configured',
    };
  }

  if (!key) {
    return {
      name: 'openclaw_config',
      status: 'fail',
      message: 'OPENCLAW_API_KEY not configured',
    };
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return {
      name: 'openclaw_config',
      status: 'fail',
      message: `Invalid OPENCLAW_GATEWAY_URL: ${url}`,
    };
  }

  return {
    name: 'openclaw_config',
    status: 'ok',
    message: 'OpenClaw configuration valid',
    details: { url },
  };
}

export async function checkOpenClawConnection(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    const { getOpenClawAdapter } = await import('../integrations/openclaw/index.js');
    const adapter = getOpenClawAdapter();

    const result = await adapter.testConnection();
    const durationMs = Date.now() - startTime;

    if (result.success) {
      return {
        name: 'openclaw_connection',
        status: 'ok',
        message: `OpenClaw connected (${result.latencyMs}ms)`,
        durationMs,
        details: { latencyMs: result.latencyMs },
      };
    }

    return {
      name: 'openclaw_connection',
      status: 'fail',
      message: `OpenClaw connection failed: ${result.error?.message ?? 'unknown'}`,
      durationMs,
      details: { error: result.error },
    };
  } catch (err) {
    return {
      name: 'openclaw_connection',
      status: 'fail',
      message: `OpenClaw error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// LOGGING CHECKS
// =============================================================================

export function checkLogging(baseDir: string): BootstrapCheck {
  const logsDir = path.join(baseDir, 'logs');

  try {
    // Verify logs directory
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Test write
    const testFile = path.join(logsDir, '.log-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    return {
      name: 'logging',
      status: 'ok',
      message: 'Logging system ready',
      details: { logsDir },
    };
  } catch (err) {
    return {
      name: 'logging',
      status: 'fail',
      message: `Logging setup failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// =============================================================================
// RESILIENCE LAYER CHECKS
// =============================================================================

export async function checkResilienceLayer(): Promise<BootstrapCheck> {
  try {
    const {
      getCheckpointStore,
      getExecutionLeaseStore,
      getCircuitBreakersSummary,
    } = await import('../orchestrator/resilience/index.js');

    // Initialize stores
    const checkpointStore = getCheckpointStore();
    const leaseStore = getExecutionLeaseStore();
    const circuitSummary = getCircuitBreakersSummary();

    return {
      name: 'resilience_layer',
      status: 'ok',
      message: 'Resilience layer initialized',
      details: {
        checkpoints: checkpointStore.getStats().total,
        leases: leaseStore.getStats().total,
        circuitBreakers: circuitSummary.total,
      },
    };
  } catch (err) {
    return {
      name: 'resilience_layer',
      status: 'fail',
      message: `Resilience layer error: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// =============================================================================
// DIAGNOSTICS CHECK
// =============================================================================

export async function checkDiagnosticsService(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    const { getSystemDiagnosticsService } = await import('../system/index.js');
    const diagnostics = getSystemDiagnosticsService();

    // Quick health check
    const health = await diagnostics.getSystemHealth();

    return {
      name: 'diagnostics_service',
      status: health.status === 'critical' ? 'warn' : 'ok',
      message: `Diagnostics initialized (score: ${health.score})`,
      durationMs: Date.now() - startTime,
      details: {
        status: health.status,
        score: health.score,
        criticalIssues: health.criticalIssues.length,
      },
    };
  } catch (err) {
    return {
      name: 'diagnostics_service',
      status: 'fail',
      message: `Diagnostics error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

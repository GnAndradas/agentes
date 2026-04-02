/**
 * Production Startup Checks
 *
 * Critical validations before system is ready:
 * - Health check (internal)
 * - Gateway check (OpenClaw reachable)
 * - Test job (optional, verifies full pipeline)
 */

import { createLogger } from '../utils/logger.js';
import { getOpenClawAdapter } from '../integrations/openclaw/OpenClawAdapter.js';
import { getJobSafetyService } from '../execution/JobSafetyService.js';
import { db, schema } from '../db/index.js';

const logger = createLogger('ProductionChecks');

// ============================================================================
// TYPES
// ============================================================================

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  latencyMs?: number;
}

export interface ProductionCheckResult {
  allPassed: boolean;
  checks: CheckResult[];
  timestamp: number;
}

// ============================================================================
// INDIVIDUAL CHECKS
// ============================================================================

/**
 * Check database connection
 */
async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Simple query to verify DB is working
    const result = db.select().from(schema.systemConfig).limit(1).all();
    return {
      name: 'database',
      passed: true,
      message: 'Database connected',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: 'database',
      passed: false,
      message: `Database error: ${err instanceof Error ? err.message : 'unknown'}`,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Check OpenClaw gateway reachability
 */
async function checkGateway(): Promise<CheckResult> {
  const adapter = getOpenClawAdapter();
  const safety = getJobSafetyService();

  try {
    const testResult = await adapter.testConnection();

    // Report to safety service
    safety.reportGatewayStatus(testResult.success);

    if (testResult.success) {
      return {
        name: 'gateway',
        passed: true,
        message: 'OpenClaw gateway reachable',
        latencyMs: testResult.latencyMs,
      };
    }

    return {
      name: 'gateway',
      passed: false,
      message: `Gateway error: ${testResult.error?.message || 'unreachable'}`,
      latencyMs: testResult.latencyMs,
    };
  } catch (err) {
    safety.reportGatewayStatus(false);
    return {
      name: 'gateway',
      passed: false,
      message: `Gateway check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

/**
 * Check OpenClaw API authentication
 */
async function checkGatewayAuth(): Promise<CheckResult> {
  const adapter = getOpenClawAdapter();

  try {
    const status = await adapter.getStatus();

    if (!status.configured) {
      return {
        name: 'gateway_auth',
        passed: false,
        message: 'OpenClaw API key not configured',
      };
    }

    if (!status.rest.authenticated) {
      return {
        name: 'gateway_auth',
        passed: false,
        message: 'OpenClaw API key invalid or expired',
      };
    }

    return {
      name: 'gateway_auth',
      passed: true,
      message: 'OpenClaw authenticated',
    };
  } catch (err) {
    return {
      name: 'gateway_auth',
      passed: false,
      message: `Auth check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

/**
 * Check WebSocket connection (optional)
 */
async function checkWebSocket(): Promise<CheckResult> {
  const adapter = getOpenClawAdapter();

  try {
    const connected = adapter.isWsConnected();

    return {
      name: 'websocket',
      passed: connected,
      message: connected ? 'WebSocket connected' : 'WebSocket not connected (optional)',
    };
  } catch (err) {
    return {
      name: 'websocket',
      passed: false,
      message: `WebSocket check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

/**
 * Check failsafe status
 */
function checkFailsafe(): CheckResult {
  const safety = getJobSafetyService();
  const state = safety.getFailsafeState();

  if (state.active) {
    return {
      name: 'failsafe',
      passed: false,
      message: `Failsafe active: ${state.reason}`,
    };
  }

  return {
    name: 'failsafe',
    passed: true,
    message: 'Failsafe not active',
  };
}

// ============================================================================
// MAIN CHECK RUNNER
// ============================================================================

/**
 * Run all production checks
 */
export async function runProductionChecks(): Promise<ProductionCheckResult> {
  logger.info('Running production checks...');

  const checks: CheckResult[] = [];

  // Run checks in sequence (some depend on others)
  checks.push(await checkDatabase());
  checks.push(await checkGateway());
  checks.push(await checkGatewayAuth());
  checks.push(await checkWebSocket());
  checks.push(checkFailsafe());

  const allPassed = checks.every(c => c.passed);
  const criticalFailed = checks
    .filter(c => ['database', 'gateway'].includes(c.name))
    .some(c => !c.passed);

  // Log results
  for (const check of checks) {
    if (check.passed) {
      logger.info({ check: check.name, latencyMs: check.latencyMs }, check.message);
    } else {
      logger.warn({ check: check.name }, check.message);
    }
  }

  if (criticalFailed) {
    logger.error('Critical checks failed - system may not function properly');
  } else if (!allPassed) {
    logger.warn('Some non-critical checks failed');
  } else {
    logger.info('All production checks passed');
  }

  return {
    allPassed,
    checks,
    timestamp: Date.now(),
  };
}

/**
 * Run checks and exit if critical fail
 */
export async function runChecksOrExit(): Promise<void> {
  const result = await runProductionChecks();

  const criticalFailed = result.checks
    .filter(c => ['database', 'gateway'].includes(c.name))
    .some(c => !c.passed);

  if (criticalFailed && process.env.NODE_ENV === 'production') {
    logger.error('Critical checks failed in production - exiting');
    process.exit(1);
  }
}

/**
 * Periodic health check (call from interval)
 */
export async function periodicHealthCheck(): Promise<boolean> {
  const gateway = await checkGateway();
  const failsafe = checkFailsafe();

  return gateway.passed && failsafe.passed;
}

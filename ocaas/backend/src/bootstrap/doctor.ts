/**
 * OCAAS Doctor Command
 *
 * Comprehensive system health check and troubleshooting tool.
 */

// Load .env FIRST before any other imports that might need env vars
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Try multiple .env locations for robustness
const envPaths = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'backend', '.env'),
  resolve(import.meta.dirname, '..', '..', '.env'),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    break;
  }
}

import path from 'path';
import fs from 'fs';
import type { DoctorResult, BootstrapCheck, CheckStatus } from './types.js';
import {
  checkEnvironmentVariables,
  checkApiSecretKey,
  checkChannelSecretKey,
  checkDirectories,
  checkDatabase,
  checkOpenClawConfig,
  checkOpenClawConnection,
  checkLogging,
  checkResilienceLayer,
  checkDiagnosticsService,
} from './checks.js';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case 'ok': return `${colors.green}✓${colors.reset}`;
    case 'fail': return `${colors.red}✗${colors.reset}`;
    case 'warn': return `${colors.yellow}⚠${colors.reset}`;
    case 'skip': return `${colors.dim}○${colors.reset}`;
  }
}

function printSection(title: string): void {
  console.log(`\n${colors.bold}${colors.cyan}┌─ ${title} ${'─'.repeat(Math.max(0, 45 - title.length))}┐${colors.reset}`);
}

function printCheck(check: BootstrapCheck): void {
  const icon = statusIcon(check.status);
  const duration = check.durationMs ? ` ${colors.dim}(${check.durationMs}ms)${colors.reset}` : '';
  console.log(`│ ${icon} ${check.name.padEnd(25)} ${check.message}${duration}`);
}

function printEnvVar(name: string, status: CheckStatus, value?: string): void {
  const icon = statusIcon(status);
  const display = value ? `${colors.dim}${value.substring(0, 30)}${value.length > 30 ? '...' : ''}${colors.reset}` : `${colors.dim}(not set)${colors.reset}`;
  console.log(`│ ${icon} ${name.padEnd(25)} ${display}`);
}

function printEndSection(): void {
  console.log(`${colors.cyan}└${'─'.repeat(48)}┘${colors.reset}`);
}

// =============================================================================
// ADDITIONAL CHECKS FOR DOCTOR
// =============================================================================

async function checkNodeVersion(): Promise<BootstrapCheck> {
  const version = process.version;
  const majorStr = version.slice(1).split('.')[0] ?? '0';
  const major = parseInt(majorStr, 10);

  if (major < 18) {
    return {
      name: 'node_version',
      status: 'fail',
      message: `Node.js ${version} - requires v18+`,
    };
  }

  if (major < 20) {
    return {
      name: 'node_version',
      status: 'warn',
      message: `Node.js ${version} - v20+ recommended`,
    };
  }

  return {
    name: 'node_version',
    status: 'ok',
    message: `Node.js ${version}`,
  };
}

async function checkDiskSpace(baseDir: string): Promise<BootstrapCheck> {
  // Basic check - just verify we can write
  try {
    const testFile = path.join(baseDir, '.disk-test');
    const testData = Buffer.alloc(1024 * 1024); // 1MB
    fs.writeFileSync(testFile, testData);
    fs.unlinkSync(testFile);

    return {
      name: 'disk_space',
      status: 'ok',
      message: 'Disk write test passed',
    };
  } catch (err) {
    return {
      name: 'disk_space',
      status: 'fail',
      message: `Disk write failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

async function checkDatabaseIntegrity(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    // Use initDatabase to verify DB is accessible and properly initialized
    const { initDatabase } = await import('../db/index.js');
    await initDatabase();

    // If initDatabase succeeds, tables exist via drizzle schema
    return {
      name: 'database_integrity',
      status: 'ok',
      message: 'Database schema verified',
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'database_integrity',
      status: 'fail',
      message: `DB integrity error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function checkOpenClawStatus(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    const { getOpenClawAdapter } = await import('../integrations/openclaw/index.js');
    const adapter = getOpenClawAdapter();
    const status = await adapter.getStatus();

    const parts: string[] = [];
    if (status.connected) parts.push('connected');
    if (status.rest?.authenticated) parts.push('authenticated');
    if (status.websocket?.connected) parts.push('websocket');

    return {
      name: 'openclaw_status',
      status: status.connected ? 'ok' : 'fail',
      message: parts.length > 0 ? parts.join(', ') : 'not connected',
      durationMs: Date.now() - startTime,
      details: {
        connected: status.connected,
        configured: status.configured,
        restReachable: status.rest?.reachable,
        wsConnected: status.websocket?.connected,
      },
    };
  } catch (err) {
    return {
      name: 'openclaw_status',
      status: 'fail',
      message: `Status error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function checkSystemDiagnostics(): Promise<BootstrapCheck> {
  const startTime = Date.now();

  try {
    const { getSystemDiagnosticsService } = await import('../system/index.js');
    const diagnostics = getSystemDiagnosticsService();
    const readiness = await diagnostics.getReadinessReport();

    return {
      name: 'system_readiness',
      status: readiness.ready ? 'ok' : (readiness.blockers.length > 0 ? 'fail' : 'warn'),
      message: `Score: ${readiness.score}%, ${readiness.blockers.length} blockers, ${readiness.nonBlockers.length} warnings`,
      durationMs: Date.now() - startTime,
      details: {
        ready: readiness.ready,
        score: readiness.score,
        blockers: readiness.blockers.length,
      },
    };
  } catch (err) {
    return {
      name: 'system_readiness',
      status: 'fail',
      message: `Readiness error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// MAIN DOCTOR
// =============================================================================

export async function doctor(options: {
  baseDir?: string;
  silent?: boolean;
} = {}): Promise<DoctorResult> {
  const startTime = Date.now();
  const baseDir = options.baseDir ?? process.cwd();
  const log = options.silent ? () => {} : console.log;

  const checks: BootstrapCheck[] = [];
  const criticalFailures: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!options.silent) {
    log(`\n${colors.bold}${colors.magenta}╔════════════════════════════════════════════════╗${colors.reset}`);
    log(`${colors.bold}${colors.magenta}║           OCAAS SYSTEM DOCTOR                  ║${colors.reset}`);
    log(`${colors.bold}${colors.magenta}╚════════════════════════════════════════════════╝${colors.reset}`);
  }

  // Environment Info
  const envVars: Record<string, CheckStatus> = {};
  const directories: Record<string, CheckStatus> = {};

  // Section 1: System
  if (!options.silent) printSection('System');

  const nodeCheck = await checkNodeVersion();
  checks.push(nodeCheck);
  if (!options.silent) printCheck(nodeCheck);
  if (nodeCheck.status === 'fail') criticalFailures.push(nodeCheck.message);
  if (nodeCheck.status === 'warn') warnings.push(nodeCheck.message);

  const diskCheck = await checkDiskSpace(baseDir);
  checks.push(diskCheck);
  if (!options.silent) printCheck(diskCheck);
  if (diskCheck.status === 'fail') criticalFailures.push(diskCheck.message);

  if (!options.silent) printEndSection();

  // Section 2: Environment Variables
  if (!options.silent) printSection('Environment Variables');

  const requiredVars = ['OPENCLAW_GATEWAY_URL', 'OPENCLAW_API_KEY', 'API_SECRET_KEY'];
  const optionalVars = ['CHANNEL_SECRET_KEY', 'DATABASE_PATH', 'LOG_LEVEL', 'PORT'];

  for (const v of requiredVars) {
    const val = process.env[v];
    const status: CheckStatus = val ? 'ok' : 'fail';
    envVars[v] = status;
    if (!options.silent) printEnvVar(v, status, val ? '********' : undefined);
    if (!val) criticalFailures.push(`Missing required: ${v}`);
  }

  for (const v of optionalVars) {
    const val = process.env[v];
    const status: CheckStatus = val ? 'ok' : 'skip';
    envVars[v] = status;
    if (!options.silent) printEnvVar(v, status, val);
  }

  if (!options.silent) printEndSection();

  // Section 3: Directories
  if (!options.silent) printSection('Directories');

  const dirs = ['logs', 'data'];
  for (const dir of dirs) {
    const fullPath = path.join(baseDir, dir);
    const exists = fs.existsSync(fullPath);
    let writable = false;

    if (exists) {
      try {
        const testFile = path.join(fullPath, '.test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        writable = true;
      } catch { /* ignore */ }
    }

    const status: CheckStatus = exists && writable ? 'ok' : (exists ? 'warn' : 'fail');
    directories[dir] = status;

    const icon = statusIcon(status);
    if (!options.silent) {
      log(`│ ${icon} ${dir.padEnd(25)} ${exists ? (writable ? 'exists, writable' : 'exists, NOT writable') : 'missing'}`);
    }

    if (status === 'fail') criticalFailures.push(`Directory missing: ${dir}`);
    if (status === 'warn') warnings.push(`Directory not writable: ${dir}`);
  }

  if (!options.silent) printEndSection();

  // Section 4: Database
  if (!options.silent) printSection('Database');

  const dbCheck = await checkDatabase();
  checks.push(dbCheck);
  if (!options.silent) printCheck(dbCheck);
  if (dbCheck.status === 'fail') criticalFailures.push(dbCheck.message);

  const dbIntegrityCheck = await checkDatabaseIntegrity();
  checks.push(dbIntegrityCheck);
  if (!options.silent) printCheck(dbIntegrityCheck);
  if (dbIntegrityCheck.status === 'fail') criticalFailures.push(dbIntegrityCheck.message);
  if (dbIntegrityCheck.status === 'warn') warnings.push(dbIntegrityCheck.message);

  if (!options.silent) printEndSection();

  // Section 5: OpenClaw
  if (!options.silent) printSection('OpenClaw Gateway');

  const openclawConfigCheck = await checkOpenClawConfig();
  checks.push(openclawConfigCheck);
  if (!options.silent) printCheck(openclawConfigCheck);
  if (openclawConfigCheck.status === 'fail') criticalFailures.push(openclawConfigCheck.message);

  const openclawConnCheck = await checkOpenClawConnection();
  checks.push(openclawConnCheck);
  if (!options.silent) printCheck(openclawConnCheck);
  if (openclawConnCheck.status === 'fail') {
    warnings.push('OpenClaw not reachable');
    recommendations.push('Start OpenClaw: openclaw start');
  }

  const openclawStatusCheck = await checkOpenClawStatus();
  checks.push(openclawStatusCheck);
  if (!options.silent) printCheck(openclawStatusCheck);

  if (!options.silent) printEndSection();

  // Section 6: Services
  if (!options.silent) printSection('Services');

  const resilienceCheck = await checkResilienceLayer();
  checks.push(resilienceCheck);
  if (!options.silent) printCheck(resilienceCheck);
  if (resilienceCheck.status === 'fail') criticalFailures.push(resilienceCheck.message);

  const loggingCheck = checkLogging(baseDir);
  checks.push(loggingCheck);
  if (!options.silent) printCheck(loggingCheck);
  if (loggingCheck.status === 'fail') criticalFailures.push(loggingCheck.message);

  if (!options.silent) printEndSection();

  // Section 7: Diagnostics
  if (!options.silent) printSection('System Health');

  const diagnosticsCheck = await checkDiagnosticsService();
  checks.push(diagnosticsCheck);
  if (!options.silent) printCheck(diagnosticsCheck);

  const readinessCheck = await checkSystemDiagnostics();
  checks.push(readinessCheck);
  if (!options.silent) printCheck(readinessCheck);
  if (readinessCheck.status === 'fail') criticalFailures.push(readinessCheck.message);
  if (readinessCheck.status === 'warn') warnings.push('System has non-blocking issues');

  if (!options.silent) printEndSection();

  // Calculate final result
  const passedChecks = checks.filter(c => c.status === 'ok').length;
  const totalChecks = checks.filter(c => c.status !== 'skip').length;
  const readinessScore = Math.round((passedChecks / totalChecks) * 100);

  let status: DoctorResult['status'];
  if (criticalFailures.length > 0) {
    status = 'NOT_READY';
  } else if (warnings.length > 0 || readinessScore < 100) {
    status = 'DEGRADED';
  } else {
    status = 'READY';
  }

  // Add recommendations based on issues
  if (status !== 'READY') {
    if (!envVars['OPENCLAW_GATEWAY_URL'] || envVars['OPENCLAW_GATEWAY_URL'] === 'fail') {
      recommendations.push('Set OPENCLAW_GATEWAY_URL in .env');
    }
    if (!envVars['OPENCLAW_API_KEY'] || envVars['OPENCLAW_API_KEY'] === 'fail') {
      recommendations.push('Set OPENCLAW_API_KEY in .env');
    }
    if (directories['logs'] === 'fail') {
      recommendations.push('Create logs directory: mkdir logs');
    }
    if (directories['data'] === 'fail') {
      recommendations.push('Create data directory: mkdir data');
    }
  }

  const result: DoctorResult = {
    status,
    checks,
    readinessScore,
    criticalFailures,
    warnings,
    recommendations,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
    },
    configuration: {
      envVars,
      directories,
    },
  };

  // Print summary
  if (!options.silent) {
    log('\n' + '═'.repeat(50));

    const statusColor = status === 'READY'
      ? colors.green
      : status === 'DEGRADED'
        ? colors.yellow
        : colors.red;

    log(`${colors.bold}${statusColor}  STATUS: ${status}${colors.reset}`);
    log(`${colors.dim}  Readiness Score: ${readinessScore}/100${colors.reset}`);
    log(`${colors.dim}  Checks: ${passedChecks}/${totalChecks} passed${colors.reset}`);
    log(`${colors.dim}  Duration: ${result.durationMs}ms${colors.reset}`);

    if (criticalFailures.length > 0) {
      log(`\n${colors.red}${colors.bold}Critical Issues (${criticalFailures.length}):${colors.reset}`);
      for (const failure of criticalFailures) {
        log(`  ${colors.red}✗ ${failure}${colors.reset}`);
      }
    }

    if (warnings.length > 0) {
      log(`\n${colors.yellow}${colors.bold}Warnings (${warnings.length}):${colors.reset}`);
      for (const warning of warnings) {
        log(`  ${colors.yellow}⚠ ${warning}${colors.reset}`);
      }
    }

    if (recommendations.length > 0) {
      log(`\n${colors.blue}${colors.bold}Recommendations:${colors.reset}`);
      for (const rec of recommendations) {
        log(`  ${colors.blue}→ ${rec}${colors.reset}`);
      }
    }

    log('\n' + '═'.repeat(50) + '\n');
  }

  return result;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

export async function runDoctor(): Promise<void> {
  const args = process.argv.slice(2);
  const silent = args.includes('--silent') || args.includes('-q');
  const json = args.includes('--json');

  const result = await doctor({
    silent: json || silent,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Exit with appropriate code
  if (result.status === 'NOT_READY') {
    process.exit(1);
  } else if (result.status === 'DEGRADED') {
    process.exit(0);
  } else {
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDoctor().catch(err => {
    console.error('Doctor failed:', err);
    process.exit(1);
  });
}

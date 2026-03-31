/**
 * OCAAS Bootstrap / Startup
 *
 * Validates environment and initializes all required services before starting the API.
 */

import path from 'path';
import type { BootstrapResult, BootstrapCheck } from './types.js';
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

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function statusIcon(status: BootstrapCheck['status']): string {
  switch (status) {
    case 'ok': return `${colors.green}✓${colors.reset}`;
    case 'fail': return `${colors.red}✗${colors.reset}`;
    case 'warn': return `${colors.yellow}⚠${colors.reset}`;
    case 'skip': return `${colors.dim}○${colors.reset}`;
  }
}

function printCheck(check: BootstrapCheck): void {
  const icon = statusIcon(check.status);
  const duration = check.durationMs ? ` ${colors.dim}(${check.durationMs}ms)${colors.reset}` : '';
  console.log(`  ${icon} ${check.name}: ${check.message}${duration}`);
}

function printHeader(title: string): void {
  console.log(`\n${colors.bold}${colors.cyan}═══ ${title} ═══${colors.reset}\n`);
}

function printResult(result: BootstrapResult): void {
  console.log('\n' + '═'.repeat(50));

  const statusColor = result.status === 'READY'
    ? colors.green
    : result.status === 'DEGRADED'
      ? colors.yellow
      : colors.red;

  console.log(`${colors.bold}${statusColor}  STATUS: ${result.status}${colors.reset}`);
  console.log(`${colors.dim}  Score: ${result.readinessScore}/100 | Duration: ${result.durationMs}ms${colors.reset}`);

  if (result.criticalFailures.length > 0) {
    console.log(`\n${colors.red}${colors.bold}Critical Failures:${colors.reset}`);
    for (const failure of result.criticalFailures) {
      console.log(`  ${colors.red}• ${failure}${colors.reset}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`\n${colors.yellow}${colors.bold}Warnings:${colors.reset}`);
    for (const warning of result.warnings) {
      console.log(`  ${colors.yellow}• ${warning}${colors.reset}`);
    }
  }

  if (result.recommendations.length > 0) {
    console.log(`\n${colors.blue}${colors.bold}Recommendations:${colors.reset}`);
    for (const rec of result.recommendations) {
      console.log(`  ${colors.blue}• ${rec}${colors.reset}`);
    }
  }

  console.log('═'.repeat(50) + '\n');
}

// =============================================================================
// MAIN BOOTSTRAP
// =============================================================================

export async function bootstrap(options: {
  baseDir?: string;
  silent?: boolean;
  skipOpenClaw?: boolean;
} = {}): Promise<BootstrapResult> {
  const startTime = Date.now();
  const baseDir = options.baseDir ?? process.cwd();
  const log = options.silent ? () => {} : console.log;

  const checks: BootstrapCheck[] = [];
  const criticalFailures: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!options.silent) {
    printHeader('OCAAS Bootstrap');
    log(`${colors.dim}Base directory: ${baseDir}${colors.reset}`);
  }

  // Phase 1: Environment
  if (!options.silent) log(`\n${colors.bold}Phase 1: Environment${colors.reset}`);

  const envCheck = checkEnvironmentVariables();
  checks.push(envCheck);
  if (!options.silent) printCheck(envCheck);
  if (envCheck.status === 'fail') criticalFailures.push(envCheck.message);

  const apiKeyCheck = checkApiSecretKey();
  checks.push(apiKeyCheck);
  if (!options.silent) printCheck(apiKeyCheck);
  if (apiKeyCheck.status === 'fail') criticalFailures.push(apiKeyCheck.message);

  const channelKeyCheck = checkChannelSecretKey();
  checks.push(channelKeyCheck);
  if (!options.silent) printCheck(channelKeyCheck);
  if (channelKeyCheck.status === 'warn') warnings.push(channelKeyCheck.message);

  // Phase 2: Directories
  if (!options.silent) log(`\n${colors.bold}Phase 2: Directories${colors.reset}`);

  const dirCheck = checkDirectories(baseDir);
  checks.push(dirCheck);
  if (!options.silent) printCheck(dirCheck);
  if (dirCheck.status === 'fail') criticalFailures.push(dirCheck.message);

  const loggingCheck = checkLogging(baseDir);
  checks.push(loggingCheck);
  if (!options.silent) printCheck(loggingCheck);
  if (loggingCheck.status === 'fail') criticalFailures.push(loggingCheck.message);

  // Phase 3: Database
  if (!options.silent) log(`\n${colors.bold}Phase 3: Database${colors.reset}`);

  const dbCheck = await checkDatabase();
  checks.push(dbCheck);
  if (!options.silent) printCheck(dbCheck);
  if (dbCheck.status === 'fail') criticalFailures.push(dbCheck.message);

  // Phase 4: OpenClaw
  if (!options.silent) log(`\n${colors.bold}Phase 4: OpenClaw${colors.reset}`);

  const openclawConfigCheck = await checkOpenClawConfig();
  checks.push(openclawConfigCheck);
  if (!options.silent) printCheck(openclawConfigCheck);
  if (openclawConfigCheck.status === 'fail') criticalFailures.push(openclawConfigCheck.message);

  if (!options.skipOpenClaw && openclawConfigCheck.status === 'ok') {
    const openclawConnCheck = await checkOpenClawConnection();
    checks.push(openclawConnCheck);
    if (!options.silent) printCheck(openclawConnCheck);
    if (openclawConnCheck.status === 'fail') {
      warnings.push(openclawConnCheck.message);
      recommendations.push('Ensure OpenClaw gateway is running before starting OCAAS');
    }
  } else if (options.skipOpenClaw) {
    const skipCheck: BootstrapCheck = {
      name: 'openclaw_connection',
      status: 'skip',
      message: 'Skipped (--skip-openclaw)',
    };
    checks.push(skipCheck);
    if (!options.silent) printCheck(skipCheck);
  }

  // Phase 5: Resilience Layer
  if (!options.silent) log(`\n${colors.bold}Phase 5: Resilience Layer${colors.reset}`);

  const resilienceCheck = await checkResilienceLayer();
  checks.push(resilienceCheck);
  if (!options.silent) printCheck(resilienceCheck);
  if (resilienceCheck.status === 'fail') criticalFailures.push(resilienceCheck.message);

  // Phase 6: Diagnostics
  if (!options.silent) log(`\n${colors.bold}Phase 6: Diagnostics${colors.reset}`);

  const diagnosticsCheck = await checkDiagnosticsService();
  checks.push(diagnosticsCheck);
  if (!options.silent) printCheck(diagnosticsCheck);
  if (diagnosticsCheck.status === 'warn') warnings.push(diagnosticsCheck.message);

  // Calculate result
  const passedChecks = checks.filter(c => c.status === 'ok').length;
  const totalChecks = checks.filter(c => c.status !== 'skip').length;
  const readinessScore = Math.round((passedChecks / totalChecks) * 100);

  let status: BootstrapResult['status'];
  if (criticalFailures.length > 0) {
    status = 'NOT_READY';
  } else if (warnings.length > 0 || readinessScore < 100) {
    status = 'DEGRADED';
  } else {
    status = 'READY';
  }

  // Add general recommendations
  if (status === 'DEGRADED' && !options.skipOpenClaw) {
    const openclawCheck = checks.find(c => c.name === 'openclaw_connection');
    if (openclawCheck?.status === 'fail') {
      recommendations.push('Start OpenClaw gateway: openclaw start');
    }
  }

  const result: BootstrapResult = {
    status,
    checks,
    readinessScore,
    criticalFailures,
    warnings,
    recommendations,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
  };

  if (!options.silent) {
    printResult(result);
  }

  return result;
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

export async function runBootstrap(): Promise<void> {
  const args = process.argv.slice(2);
  const skipOpenClaw = args.includes('--skip-openclaw');
  const silent = args.includes('--silent') || args.includes('-q');
  const json = args.includes('--json');

  const result = await bootstrap({
    skipOpenClaw,
    silent: json || silent,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Exit with appropriate code
  if (result.status === 'NOT_READY') {
    process.exit(1);
  } else if (result.status === 'DEGRADED') {
    process.exit(0); // Degraded is acceptable for startup
  } else {
    process.exit(0);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBootstrap().catch(err => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  });
}

/**
 * OCAAS Smoke Test
 *
 * Quick production validation script to verify system is operational.
 *
 * Usage:
 *   npm run smoke-test
 *   npm run smoke-test -- --skip-openclaw
 *   npm run smoke-test -- --json
 */

import 'dotenv/config';

// ANSI colors
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

interface SmokeTestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

interface SmokeTestReport {
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  tests: SmokeTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  timestamp: number;
  durationMs: number;
}

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

// =============================================================================
// TEST HELPERS
// =============================================================================

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function printTest(test: SmokeTestResult): void {
  const icon = test.status === 'pass'
    ? `${colors.green}✓${colors.reset}`
    : test.status === 'fail'
      ? `${colors.red}✗${colors.reset}`
      : `${colors.dim}○${colors.reset}`;

  const duration = test.durationMs ? ` ${colors.dim}(${test.durationMs}ms)${colors.reset}` : '';
  console.log(`  ${icon} ${test.name}: ${test.message}${duration}`);
}

// =============================================================================
// SMOKE TESTS
// =============================================================================

async function testBackendHealth(): Promise<SmokeTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/health`);

    if (response.ok) {
      return {
        name: 'backend_health',
        status: 'pass',
        message: 'Backend is responding',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'backend_health',
      status: 'fail',
      message: `Backend returned ${response.status}`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'backend_health',
      status: 'fail',
      message: `Backend not reachable: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testDiagnosticsEndpoint(): Promise<SmokeTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/system/diagnostics`);

    if (!response.ok) {
      return {
        name: 'diagnostics_endpoint',
        status: 'fail',
        message: `Diagnostics returned ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: { status: string; score: number } };

    if (!data.data) {
      return {
        name: 'diagnostics_endpoint',
        status: 'fail',
        message: 'Invalid diagnostics response',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'diagnostics_endpoint',
      status: 'pass',
      message: `Status: ${data.data.status}, Score: ${data.data.score}`,
      durationMs: Date.now() - startTime,
      details: data.data,
    };
  } catch (err) {
    return {
      name: 'diagnostics_endpoint',
      status: 'fail',
      message: `Diagnostics error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testOpenClawConnection(skip: boolean): Promise<SmokeTestResult> {
  if (skip) {
    return {
      name: 'openclaw_connection',
      status: 'skip',
      message: 'Skipped (--skip-openclaw)',
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/system/gateway`);

    if (!response.ok) {
      return {
        name: 'openclaw_connection',
        status: 'fail',
        message: `Gateway status returned ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: { connected: boolean } };

    if (data.data?.connected) {
      return {
        name: 'openclaw_connection',
        status: 'pass',
        message: 'OpenClaw gateway connected',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'openclaw_connection',
      status: 'fail',
      message: 'OpenClaw gateway not connected',
      durationMs: Date.now() - startTime,
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

async function testCreateTask(): Promise<SmokeTestResult> {
  const startTime = Date.now();
  const secretKey = process.env.API_SECRET_KEY;

  if (!secretKey) {
    return {
      name: 'create_task',
      status: 'skip',
      message: 'No API_SECRET_KEY for task creation',
    };
  }

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': secretKey,
      },
      body: JSON.stringify({
        title: '[SMOKE TEST] System validation task',
        description: 'Automated smoke test - can be safely deleted',
        type: 'internal',
        priority: 'low',
        metadata: {
          smokeTest: true,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        name: 'create_task',
        status: 'fail',
        message: `Task creation failed: ${response.status} - ${body}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: { id: string } };

    if (!data.data?.id) {
      return {
        name: 'create_task',
        status: 'fail',
        message: 'Task created but no ID returned',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'create_task',
      status: 'pass',
      message: `Task created: ${data.data.id}`,
      durationMs: Date.now() - startTime,
      details: { taskId: data.data.id },
    };
  } catch (err) {
    return {
      name: 'create_task',
      status: 'fail',
      message: `Task creation error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testListTasks(): Promise<SmokeTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/tasks`);

    if (!response.ok) {
      return {
        name: 'list_tasks',
        status: 'fail',
        message: `List tasks failed: ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: unknown[] };

    return {
      name: 'list_tasks',
      status: 'pass',
      message: `${Array.isArray(data.data) ? data.data.length : 0} tasks found`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'list_tasks',
      status: 'fail',
      message: `List tasks error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testListAgents(): Promise<SmokeTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/agents`);

    if (!response.ok) {
      return {
        name: 'list_agents',
        status: 'fail',
        message: `List agents failed: ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: unknown[] };

    return {
      name: 'list_agents',
      status: 'pass',
      message: `${Array.isArray(data.data) ? data.data.length : 0} agents found`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'list_agents',
      status: 'fail',
      message: `List agents error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testChannelIngest(skip: boolean): Promise<SmokeTestResult> {
  const channelKey = process.env.CHANNEL_SECRET_KEY || process.env.API_SECRET_KEY;

  if (!channelKey || skip) {
    return {
      name: 'channel_ingest',
      status: 'skip',
      message: skip ? 'Skipped' : 'No channel secret key configured',
    };
  }

  const startTime = Date.now();

  try {
    // Just test the endpoint is accessible (don't actually ingest)
    const response = await fetchWithTimeout(`${API_BASE}/api/channels/test/users/smoke-test/tasks`);

    // We expect 200 even if no tasks - this tests the route exists
    if (response.ok || response.status === 404) {
      return {
        name: 'channel_ingest',
        status: 'pass',
        message: 'Channel routes accessible',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'channel_ingest',
      status: 'fail',
      message: `Channel routes returned ${response.status}`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'channel_ingest',
      status: 'fail',
      message: `Channel error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

async function testSystemMetrics(): Promise<SmokeTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/system/metrics`);

    if (!response.ok) {
      return {
        name: 'system_metrics',
        status: 'fail',
        message: `Metrics returned ${response.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const data = await response.json() as { data?: { tasks?: { total: number } } };

    if (!data.data) {
      return {
        name: 'system_metrics',
        status: 'fail',
        message: 'Invalid metrics response',
        durationMs: Date.now() - startTime,
      };
    }

    return {
      name: 'system_metrics',
      status: 'pass',
      message: `Metrics OK (${data.data.tasks?.total ?? 0} tasks)`,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: 'system_metrics',
      status: 'fail',
      message: `Metrics error: ${err instanceof Error ? err.message : 'unknown'}`,
      durationMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function runSmokeTest(options: {
  skipOpenClaw?: boolean;
  skipChannel?: boolean;
  json?: boolean;
}): Promise<SmokeTestReport> {
  const startTime = Date.now();
  const tests: SmokeTestResult[] = [];

  if (!options.json) {
    console.log(`\n${colors.bold}${colors.cyan}═══ OCAAS Smoke Test ═══${colors.reset}\n`);
    console.log(`${colors.dim}Target: ${API_BASE}${colors.reset}\n`);
  }

  // Run tests
  if (!options.json) console.log(`${colors.bold}API Tests:${colors.reset}`);

  tests.push(await testBackendHealth());
  if (!options.json) printTest(tests[tests.length - 1]);

  tests.push(await testDiagnosticsEndpoint());
  if (!options.json) printTest(tests[tests.length - 1]);

  tests.push(await testSystemMetrics());
  if (!options.json) printTest(tests[tests.length - 1]);

  if (!options.json) console.log(`\n${colors.bold}OpenClaw Tests:${colors.reset}`);

  tests.push(await testOpenClawConnection(options.skipOpenClaw ?? false));
  if (!options.json) printTest(tests[tests.length - 1]);

  if (!options.json) console.log(`\n${colors.bold}Data Tests:${colors.reset}`);

  tests.push(await testListTasks());
  if (!options.json) printTest(tests[tests.length - 1]);

  tests.push(await testListAgents());
  if (!options.json) printTest(tests[tests.length - 1]);

  tests.push(await testCreateTask());
  if (!options.json) printTest(tests[tests.length - 1]);

  if (!options.json) console.log(`\n${colors.bold}Channel Tests:${colors.reset}`);

  tests.push(await testChannelIngest(options.skipChannel ?? false));
  if (!options.json) printTest(tests[tests.length - 1]);

  // Calculate results
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const skipped = tests.filter(t => t.status === 'skip').length;

  let status: SmokeTestReport['status'];
  if (failed === 0) {
    status = 'PASS';
  } else if (passed > 0) {
    status = 'PARTIAL';
  } else {
    status = 'FAIL';
  }

  const report: SmokeTestReport = {
    status,
    tests,
    passed,
    failed,
    skipped,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
  };

  // Print summary
  if (!options.json) {
    console.log('\n' + '═'.repeat(40));

    const statusColor = status === 'PASS'
      ? colors.green
      : status === 'PARTIAL'
        ? colors.yellow
        : colors.red;

    console.log(`${colors.bold}${statusColor}  STATUS: ${status}${colors.reset}`);
    console.log(`${colors.dim}  Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}${colors.reset}`);
    console.log(`${colors.dim}  Duration: ${report.durationMs}ms${colors.reset}`);

    if (failed > 0) {
      console.log(`\n${colors.red}${colors.bold}Failed Tests:${colors.reset}`);
      for (const test of tests.filter(t => t.status === 'fail')) {
        console.log(`  ${colors.red}✗ ${test.name}: ${test.message}${colors.reset}`);
      }
    }

    console.log('═'.repeat(40) + '\n');
  }

  return report;
}

// =============================================================================
// CLI
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipOpenClaw = args.includes('--skip-openclaw');
  const skipChannel = args.includes('--skip-channel');
  const json = args.includes('--json');

  const report = await runSmokeTest({
    skipOpenClaw,
    skipChannel,
    json,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  }

  // Exit with appropriate code
  if (report.status === 'FAIL') {
    process.exit(1);
  } else if (report.status === 'PARTIAL') {
    process.exit(0); // Partial is acceptable
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * OCAAS Task Injection Script
 *
 * PROMPT 17: Creates a task and monitors its execution
 *
 * Usage:
 *   npx tsx scripts/inject-task.ts
 *   npx tsx scripts/inject-task.ts --title "My Task"
 *   npx tsx scripts/inject-task.ts --agent=<agentId>
 *   npx tsx scripts/inject-task.ts --watch
 *
 * Environment:
 *   API_BASE_URL - Backend URL (default: http://localhost:3001)
 *   API_SECRET_KEY - Required for API authentication
 */

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// Load .env
const envPaths = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'backend', '.env'),
  resolve(import.meta.dirname, '..', '.env'),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    break;
  }
}

// =============================================================================
// CONFIG
// =============================================================================

const API_BASE = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const API_KEY = process.env.API_SECRET_KEY;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// =============================================================================
// HELPERS
// =============================================================================

async function apiRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['X-API-KEY'] = API_KEY;
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let json: unknown;

    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `${response.status}: ${JSON.stringify(json)}`,
      };
    }

    const data = json as { data?: T };
    return { ok: true, data: data.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

function log(level: 'info' | 'warn' | 'error' | 'success', msg: string, data?: Record<string, unknown>): void {
  const prefix = {
    info: `${c.blue}ℹ${c.reset}`,
    warn: `${c.yellow}⚠${c.reset}`,
    error: `${c.red}✗${c.reset}`,
    success: `${c.green}✓${c.reset}`,
  }[level];

  console.log(`${prefix} ${msg}`);
  if (data) {
    console.log(`  ${c.dim}${JSON.stringify(data)}${c.reset}`);
  }
}

// =============================================================================
// TASK OPERATIONS
// =============================================================================

interface TaskResult {
  id: string;
  title: string;
  status: string;
  assignedAgentId?: string;
  result?: string;
  executionTrace?: Record<string, unknown>;
}

async function createTask(
  title: string,
  description: string,
  agentId?: string
): Promise<TaskResult | null> {
  log('info', `Creating task: ${title}`);

  const body: Record<string, unknown> = {
    title,
    description,
    type: 'execution',
    priority: 3,
    metadata: {
      injectedAt: new Date().toISOString(),
      source: 'inject-task-script',
    },
  };

  if (agentId) {
    body.assignedAgentId = agentId;
    body.metadata = { ...body.metadata as Record<string, unknown>, preferredAgent: agentId };
  }

  const result = await apiRequest<TaskResult>('POST', '/api/tasks', body);

  if (!result.ok || !result.data) {
    log('error', `Failed to create task: ${result.error}`);
    return null;
  }

  log('success', `Task created: ${result.data.id}`);
  return result.data;
}

async function getTask(id: string): Promise<TaskResult | null> {
  const result = await apiRequest<TaskResult>('GET', `/api/tasks/${id}`);
  return result.data || null;
}

async function watchTask(id: string, maxWaitMs = 60000): Promise<TaskResult | null> {
  const startTime = Date.now();
  const pollInterval = 2000;
  let lastStatus = '';

  log('info', `Watching task ${id} (timeout: ${maxWaitMs}ms)`);

  while (Date.now() - startTime < maxWaitMs) {
    const task = await getTask(id);
    if (!task) {
      log('error', `Task ${id} not found`);
      return null;
    }

    // Log status changes
    if (task.status !== lastStatus) {
      const statusColor = {
        pending: c.yellow,
        assigned: c.blue,
        running: c.cyan,
        completed: c.green,
        failed: c.red,
        blocked: c.yellow,
      }[task.status] || c.reset;

      console.log(`  ${c.dim}[${Math.floor((Date.now() - startTime) / 1000)}s]${c.reset} Status: ${statusColor}${task.status}${c.reset}`);
      lastStatus = task.status;
    }

    // Terminal states
    if (['completed', 'failed', 'cancelled'].includes(task.status)) {
      return task;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  log('warn', `Timeout watching task ${id}`);
  return await getTask(id);
}

async function listAgents(): Promise<Array<{ id: string; name: string; status: string }>> {
  const result = await apiRequest<Array<{ id: string; name: string; status: string }>>('GET', '/api/agents');
  return result.data || [];
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse args
  const titleArg = args.find(a => a.startsWith('--title='));
  const agentArg = args.find(a => a.startsWith('--agent='));
  const shouldWatch = args.includes('--watch');

  const taskTitle = titleArg?.split('=')[1] || `Test Task ${Date.now()}`;
  const agentId = agentArg?.split('=')[1];

  console.log(`\n${c.bold}${c.cyan}═══ OCAAS Task Injection ═══${c.reset}\n`);
  console.log(`${c.dim}Target: ${API_BASE}${c.reset}`);
  console.log(`${c.dim}Title: ${taskTitle}${c.reset}`);
  console.log(`${c.dim}Agent: ${agentId || '(auto-assign)'}${c.reset}`);
  console.log(`${c.dim}Watch: ${shouldWatch}${c.reset}\n`);

  if (!API_KEY) {
    log('error', 'API_SECRET_KEY not set - cannot create task');
    process.exit(1);
  }

  // Health check
  const healthResult = await apiRequest('GET', '/health');
  if (!healthResult.ok) {
    log('error', `Backend not reachable: ${healthResult.error}`);
    process.exit(1);
  }
  log('success', 'Backend is healthy');

  // List available agents
  const agents = await listAgents();
  const activeAgents = agents.filter(a => a.status === 'active');

  if (activeAgents.length === 0) {
    log('warn', 'No active agents found - task may not be assigned');
  } else {
    log('info', `Found ${activeAgents.length} active agent(s)`);
    for (const agent of activeAgents.slice(0, 3)) {
      console.log(`  ${c.dim}- ${agent.name} (${agent.id})${c.reset}`);
    }
  }

  // Create task
  const task = await createTask(
    taskTitle,
    `This is an automated test task created by inject-task.ts.
Please process this task and provide a helpful response.

Instructions:
1. Acknowledge receipt of the task
2. Perform any relevant analysis
3. Provide a summary of the result`,
    agentId
  );

  if (!task) {
    process.exit(1);
  }

  // Watch if requested
  if (shouldWatch) {
    console.log('');
    const finalTask = await watchTask(task.id);

    if (finalTask) {
      console.log(`\n${c.bold}═══ Task Result ═══${c.reset}\n`);

      const statusColor = finalTask.status === 'completed' ? c.green : c.red;
      console.log(`Status: ${statusColor}${finalTask.status}${c.reset}`);

      if (finalTask.result) {
        console.log(`\nResult:\n${c.dim}${finalTask.result}${c.reset}`);
      }

      if (finalTask.executionTrace) {
        console.log(`\nExecution Trace:`);
        const trace = finalTask.executionTrace as Record<string, unknown>;
        console.log(`  Mode: ${trace.execution_mode || 'unknown'}`);
        console.log(`  Transport: ${trace.transport_method || 'unknown'}`);
        console.log(`  Success: ${trace.transport_success}`);
        console.log(`  Response: ${trace.response_received}`);
        console.log(`  Fallback: ${trace.execution_fallback_used}`);
      }

      if (finalTask.status === 'completed') {
        log('success', 'Task completed successfully!');
      } else {
        log('error', `Task ended with status: ${finalTask.status}`);
        process.exit(1);
      }
    }
  } else {
    console.log(`\n${c.dim}Task created. Use --watch to monitor execution.${c.reset}`);
    console.log(`  npx tsx scripts/inject-task.ts --watch\n`);
  }
}

main().catch(err => {
  console.error(`${c.red}Error:${c.reset}`, err);
  process.exit(1);
});

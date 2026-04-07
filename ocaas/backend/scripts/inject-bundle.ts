#!/usr/bin/env npx tsx
/**
 * OCAAS Bundle Injection Script
 *
 * PROMPT 17: Creates a complete bundle (tool + skill + agent) via API
 *
 * Usage:
 *   npx tsx scripts/inject-bundle.ts
 *   npx tsx scripts/inject-bundle.ts --name "My Bundle"
 *   npx tsx scripts/inject-bundle.ts --activate
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
// BUNDLE CREATION
// =============================================================================

interface GenerationResult {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface BundleResult {
  toolId?: string;
  toolGenerationId?: string;
  skillId?: string;
  skillGenerationId?: string;
  agentId?: string;
  agentGenerationId?: string;
  bundleId: string;
  bundleStatus: 'complete' | 'partial';
}

async function createTool(name: string, description: string): Promise<GenerationResult | null> {
  log('info', `Creating tool: ${name}`);

  const result = await apiRequest<GenerationResult>('POST', '/api/generations', {
    type: 'tool',
    name,
    description,
    prompt: `Create a simple shell tool called "${name}" that ${description}.
Use bash/sh. Include proper error handling and usage help.
The tool should be practical and immediately usable.`,
  });

  if (!result.ok || !result.data) {
    log('error', `Failed to create tool: ${result.error}`);
    return null;
  }

  log('success', `Tool generation created: ${result.data.id}`);
  return result.data;
}

async function createSkill(name: string, description: string): Promise<GenerationResult | null> {
  log('info', `Creating skill: ${name}`);

  const result = await apiRequest<GenerationResult>('POST', '/api/generations', {
    type: 'skill',
    name,
    description,
    prompt: `Create a skill called "${name}" that ${description}.
Include clear SKILL.md documentation and agent-instructions.md for how to use it.
Define practical capabilities that agents can use.`,
  });

  if (!result.ok || !result.data) {
    log('error', `Failed to create skill: ${result.error}`);
    return null;
  }

  log('success', `Skill generation created: ${result.data.id}`);
  return result.data;
}

async function createAgent(
  name: string,
  description: string,
  toolId?: string,
  skillId?: string
): Promise<GenerationResult | null> {
  log('info', `Creating agent: ${name}`);

  const result = await apiRequest<GenerationResult>('POST', '/api/generations', {
    type: 'agent',
    name,
    description,
    prompt: `Create an agent called "${name}" that ${description}.
Type should be "general" for versatile tasks or "specialist" for focused domains.
Include practical capabilities.`,
    metadata: {
      bundleId: `bundle-${Date.now()}`,
      linkedToolId: toolId,
      linkedSkillId: skillId,
    },
  });

  if (!result.ok || !result.data) {
    log('error', `Failed to create agent: ${result.error}`);
    return null;
  }

  log('success', `Agent generation created: ${result.data.id}`);
  return result.data;
}

async function approveGeneration(id: string): Promise<boolean> {
  log('info', `Approving generation: ${id}`);

  const result = await apiRequest('POST', `/api/generations/${id}/approve`);

  if (!result.ok) {
    log('error', `Failed to approve: ${result.error}`);
    return false;
  }

  log('success', `Approved: ${id}`);
  return true;
}

async function activateGeneration(id: string): Promise<{ resourceId?: string } | null> {
  log('info', `Activating generation: ${id}`);

  const result = await apiRequest<{ resourceId?: string }>('POST', `/api/generations/${id}/activate`);

  if (!result.ok) {
    log('error', `Failed to activate: ${result.error}`);
    return null;
  }

  log('success', `Activated: ${id}`);
  return result.data || {};
}

async function getGeneration(id: string): Promise<GenerationResult | null> {
  const result = await apiRequest<GenerationResult>('GET', `/api/generations/${id}`);
  return result.data || null;
}

async function waitForGeneration(id: string, maxWaitMs = 30000): Promise<GenerationResult | null> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < maxWaitMs) {
    const gen = await getGeneration(id);
    if (!gen) return null;

    // Check if generation is ready for approval
    if (gen.status === 'generated' || gen.status === 'pending_approval') {
      return gen;
    }

    // If already approved/active, return it
    if (gen.status === 'approved' || gen.status === 'active') {
      return gen;
    }

    // If failed/rejected, stop waiting
    if (gen.status === 'failed' || gen.status === 'rejected') {
      log('error', `Generation ${id} ended with status: ${gen.status}`);
      return gen;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  log('warn', `Timeout waiting for generation ${id}`);
  return await getGeneration(id);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const nameArg = args.find(a => a.startsWith('--name='));
  const bundleName = nameArg?.split('=')[1] || `test-bundle-${Date.now()}`;
  const shouldActivate = args.includes('--activate');

  console.log(`\n${c.bold}${c.cyan}═══ OCAAS Bundle Injection ═══${c.reset}\n`);
  console.log(`${c.dim}Target: ${API_BASE}${c.reset}`);
  console.log(`${c.dim}Bundle: ${bundleName}${c.reset}`);
  console.log(`${c.dim}Activate: ${shouldActivate}${c.reset}\n`);

  if (!API_KEY) {
    log('error', 'API_SECRET_KEY not set - cannot create resources');
    process.exit(1);
  }

  // Health check
  const healthResult = await apiRequest('GET', '/health');
  if (!healthResult.ok) {
    log('error', `Backend not reachable: ${healthResult.error}`);
    process.exit(1);
  }
  log('success', 'Backend is healthy');

  const bundleResult: BundleResult = {
    bundleId: `bundle-${Date.now()}`,
    bundleStatus: 'partial',
  };

  // 1. Create Tool
  const tool = await createTool(
    `${bundleName}-tool`,
    'echoes a message back with timestamp. Usage: tool.sh <message>'
  );

  if (tool) {
    bundleResult.toolGenerationId = tool.id;

    // Wait for generation
    const toolGen = await waitForGeneration(tool.id);
    if (toolGen?.status === 'generated' || toolGen?.status === 'pending_approval') {
      if (await approveGeneration(tool.id)) {
        if (shouldActivate) {
          const activation = await activateGeneration(tool.id);
          bundleResult.toolId = activation?.resourceId;
        }
      }
    }
  }

  // 2. Create Skill
  const skill = await createSkill(
    `${bundleName}-skill`,
    'provides text formatting capabilities (uppercase, lowercase, reverse)'
  );

  if (skill) {
    bundleResult.skillGenerationId = skill.id;

    const skillGen = await waitForGeneration(skill.id);
    if (skillGen?.status === 'generated' || skillGen?.status === 'pending_approval') {
      if (await approveGeneration(skill.id)) {
        if (shouldActivate) {
          const activation = await activateGeneration(skill.id);
          bundleResult.skillId = activation?.resourceId;
        }
      }
    }
  }

  // 3. Create Agent
  const agent = await createAgent(
    `${bundleName}-agent`,
    'handles text processing tasks using available tools and skills',
    bundleResult.toolId,
    bundleResult.skillId
  );

  if (agent) {
    bundleResult.agentGenerationId = agent.id;

    const agentGen = await waitForGeneration(agent.id);
    if (agentGen?.status === 'generated' || agentGen?.status === 'pending_approval') {
      if (await approveGeneration(agent.id)) {
        if (shouldActivate) {
          const activation = await activateGeneration(agent.id);
          bundleResult.agentId = activation?.resourceId;
        }
      }
    }
  }

  // Determine bundle status
  if (bundleResult.toolId && bundleResult.skillId && bundleResult.agentId) {
    bundleResult.bundleStatus = 'complete';
  } else if (bundleResult.toolGenerationId || bundleResult.skillGenerationId || bundleResult.agentGenerationId) {
    bundleResult.bundleStatus = 'partial';
  }

  // Summary
  console.log(`\n${c.bold}═══ Bundle Result ═══${c.reset}\n`);
  console.log(JSON.stringify(bundleResult, null, 2));

  if (bundleResult.bundleStatus === 'complete') {
    log('success', 'Bundle created and activated successfully!');
  } else if (bundleResult.bundleStatus === 'partial') {
    log('warn', 'Bundle created but some resources not activated');
    if (!shouldActivate) {
      log('info', 'Use --activate flag to automatically activate resources');
    }
  } else {
    log('error', 'Bundle creation failed');
    process.exit(1);
  }

  console.log(`\n${c.dim}To inject a task using this agent:${c.reset}`);
  if (bundleResult.agentId) {
    console.log(`  npx tsx scripts/inject-task.ts --agent=${bundleResult.agentId}`);
  } else if (bundleResult.agentGenerationId) {
    console.log(`  (Activate the agent first, then use its ID)`);
  }
}

main().catch(err => {
  console.error(`${c.red}Error:${c.reset}`, err);
  process.exit(1);
});

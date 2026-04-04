/**
 * Agent Materialization Module (BLOQUE 9)
 *
 * Defines the REAL lifecycle states for agents and provides
 * minimal materialization support without redesigning the system.
 *
 * LIFECYCLE STATES (explicit separation):
 * 1. record      - DB row exists in agents table
 * 2. generated   - Generation record with content exists
 * 3. activated   - Generation status = active, agent record created
 * 4. materialized - Agent workspace prepared (files, config)
 * 5. runtime-ready - OpenClaw session could be started (NOT guaranteed)
 *
 * IMPORTANT: "activated" does NOT mean "runtime-ready"
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AgentMaterialization');

// ============================================================================
// LIFECYCLE STATES
// ============================================================================

/**
 * Agent lifecycle state - explicit and unambiguous
 */
export type AgentLifecycleState =
  | 'record'           // DB row exists only
  | 'generated'        // Generation content exists
  | 'activated'        // Generation activated, agent record created
  | 'materialized'     // Workspace prepared, files written
  | 'runtime_ready';   // Could start OpenClaw session (not guaranteed)

/**
 * Materialization status for an agent
 */
export interface AgentMaterializationStatus {
  /** Current lifecycle state */
  state: AgentLifecycleState;

  /** DB record exists */
  db_record: boolean;

  /** Generation exists and is active */
  generation_active: boolean;

  /** Agent workspace exists */
  workspace_exists: boolean;

  /** Config file written */
  config_written: boolean;

  /** Could potentially start OpenClaw session */
  runtime_possible: boolean;

  /** OpenClaw session actually exists */
  openclaw_session: boolean;

  /** Timestamp of last materialization attempt */
  materialization_attempted_at?: number;

  /** Materialization succeeded */
  materialization_succeeded: boolean;

  /** Reason if materialization failed or skipped */
  materialization_reason?: string;

  /** Target workspace path */
  target_workspace?: string;
}

/**
 * Default materialization status (unmaterialized)
 */
export const DEFAULT_MATERIALIZATION_STATUS: AgentMaterializationStatus = {
  state: 'record',
  db_record: true,
  generation_active: false,
  workspace_exists: false,
  config_written: false,
  runtime_possible: false,
  openclaw_session: false,
  materialization_succeeded: false,
};

// ============================================================================
// MATERIALIZATION TRACEABILITY
// ============================================================================

/**
 * Full traceability for materialization attempt
 */
export interface MaterializationTraceability {
  /** When materialization was attempted */
  attempted_at: number;

  /** Source of attempt: activation, manual, system */
  source: 'activation' | 'manual' | 'system';

  /** Steps attempted */
  steps_attempted: string[];

  /** Steps completed */
  steps_completed: string[];

  /** Steps failed */
  steps_failed: string[];

  /** Final state achieved */
  final_state: AgentLifecycleState;

  /** Whether runtime is ready */
  runtime_ready: boolean;

  /** Gap explanation if not fully materialized */
  gap?: string;
}

// ============================================================================
// AGENT WORKSPACE
// ============================================================================

/**
 * Agent workspace structure
 */
export interface AgentWorkspace {
  /** Root path of agent workspace */
  path: string;

  /** Config file path */
  configPath: string;

  /** System prompt path */
  systemPromptPath: string;

  /** Whether workspace exists */
  exists: boolean;
}

/**
 * Get workspace path for an agent
 */
export function getAgentWorkspacePath(agentName: string): string {
  const workspacePath = config.openclaw.workspacePath;
  return join(workspacePath, 'agents', agentName);
}

/**
 * Get workspace info for an agent
 */
export function getAgentWorkspace(agentName: string): AgentWorkspace {
  const path = getAgentWorkspacePath(agentName);
  return {
    path,
    configPath: join(path, 'agent.json'),
    systemPromptPath: join(path, 'system-prompt.md'),
    exists: existsSync(path),
  };
}

// ============================================================================
// MINIMAL MATERIALIZATION
// ============================================================================

/**
 * Agent config for workspace
 */
export interface AgentWorkspaceConfig {
  name: string;
  description?: string;
  type: string;
  capabilities: string[];
  config: Record<string, unknown>;
  materialized_at: number;
  materialized_by: 'activation' | 'manual' | 'system';
}

/**
 * Materialize an agent - create minimal workspace
 *
 * This creates:
 * 1. Agent directory in workspace
 * 2. agent.json config file
 * 3. system-prompt.md (basic)
 *
 * This does NOT:
 * - Start OpenClaw session
 * - Register in OpenClaw
 * - Verify runtime compatibility
 */
export async function materializeAgent(
  agentName: string,
  agentType: string,
  description: string | undefined,
  capabilities: string[],
  agentConfig: Record<string, unknown>,
  source: 'activation' | 'manual' | 'system' = 'activation'
): Promise<MaterializationTraceability> {
  const trace: MaterializationTraceability = {
    attempted_at: Date.now(),
    source,
    steps_attempted: [],
    steps_completed: [],
    steps_failed: [],
    final_state: 'activated',
    runtime_ready: false,
  };

  const workspace = getAgentWorkspace(agentName);

  try {
    // Step 1: Create workspace directory
    trace.steps_attempted.push('create_workspace_dir');
    if (!existsSync(workspace.path)) {
      mkdirSync(workspace.path, { recursive: true });
    }
    trace.steps_completed.push('create_workspace_dir');

    // Step 2: Write agent config
    trace.steps_attempted.push('write_agent_config');
    const workspaceConfig: AgentWorkspaceConfig = {
      name: agentName,
      description,
      type: agentType,
      capabilities,
      config: agentConfig,
      materialized_at: Date.now(),
      materialized_by: source,
    };
    writeFileSync(workspace.configPath, JSON.stringify(workspaceConfig, null, 2), 'utf-8');
    trace.steps_completed.push('write_agent_config');

    // Step 3: Write basic system prompt
    trace.steps_attempted.push('write_system_prompt');
    const systemPrompt = generateBasicSystemPrompt(agentName, agentType, description, capabilities);
    writeFileSync(workspace.systemPromptPath, systemPrompt, 'utf-8');
    trace.steps_completed.push('write_system_prompt');

    // Update final state
    trace.final_state = 'materialized';
    trace.runtime_ready = false; // Still not runtime-ready until OpenClaw session

    // Explain the gap
    trace.gap = 'Agent workspace materialized (files written). ' +
      'OpenClaw session NOT started. Agent is NOT runtime-ready. ' +
      'Session must be explicitly started by JobDispatcher or manual action.';

    logger.info({
      agent: agentName,
      workspace: workspace.path,
      steps: trace.steps_completed,
      state: trace.final_state,
    }, 'Agent materialized to workspace');

  } catch (err) {
    const currentStep = trace.steps_attempted[trace.steps_attempted.length - 1];
    if (currentStep) {
      trace.steps_failed.push(currentStep);
    }
    trace.gap = `Materialization failed at step: ${currentStep}. Error: ${err instanceof Error ? err.message : 'Unknown'}`;

    logger.error({
      agent: agentName,
      error: err,
      failedStep: currentStep,
    }, 'Agent materialization failed');
  }

  return trace;
}

/**
 * Generate a basic system prompt for the agent
 */
function generateBasicSystemPrompt(
  name: string,
  type: string,
  description: string | undefined,
  capabilities: string[]
): string {
  return `# Agent: ${name}

## Type
${type}

## Description
${description || 'No description provided.'}

## Capabilities
${capabilities.length > 0 ? capabilities.map(c => `- ${c}`).join('\n') : '- general'}

## Instructions
You are an AI agent operating within the OCAAS orchestration system.
Follow the task instructions provided and use available tools when needed.
Report blockers clearly if you cannot complete a task.

---
*Generated by OCAAS Agent Materialization (BLOQUE 9)*
*Materialized at: ${new Date().toISOString()}*
`;
}

// ============================================================================
// STATUS HELPERS
// ============================================================================

/**
 * Compute materialization status for an agent
 */
export function computeMaterializationStatus(
  agentName: string,
  hasDbRecord: boolean,
  hasActiveGeneration: boolean,
  sessionId?: string
): AgentMaterializationStatus {
  const workspace = getAgentWorkspace(agentName);

  const workspaceExists = workspace.exists;
  const configExists = existsSync(workspace.configPath);

  // Determine lifecycle state
  let state: AgentLifecycleState = 'record';

  if (!hasDbRecord) {
    // This shouldn't happen, but handle it
    state = 'record';
  } else if (hasActiveGeneration && workspaceExists && configExists) {
    state = sessionId ? 'runtime_ready' : 'materialized';
  } else if (hasActiveGeneration) {
    state = 'activated';
  } else if (hasDbRecord) {
    state = 'record';
  }

  return {
    state,
    db_record: hasDbRecord,
    generation_active: hasActiveGeneration,
    workspace_exists: workspaceExists,
    config_written: configExists,
    runtime_possible: workspaceExists && configExists,
    openclaw_session: !!sessionId,
    materialization_succeeded: workspaceExists && configExists,
    target_workspace: workspace.path,
  };
}

/**
 * Check if agent is truly runtime-ready
 */
export function isRuntimeReady(status: AgentMaterializationStatus): boolean {
  return status.state === 'runtime_ready' && status.openclaw_session;
}

/**
 * Check if agent is materialized but not runtime-ready
 */
export function isMaterializedOnly(status: AgentMaterializationStatus): boolean {
  return status.state === 'materialized' && !status.openclaw_session;
}

/**
 * Get human-readable status description
 */
export function getStatusDescription(status: AgentMaterializationStatus): string {
  switch (status.state) {
    case 'record':
      return 'DB record only - not materialized';
    case 'generated':
      return 'Generation exists - not activated';
    case 'activated':
      return 'Activated but NOT materialized - workspace not prepared';
    case 'materialized':
      return 'Materialized (workspace ready) but NO runtime session';
    case 'runtime_ready':
      return 'Runtime-ready - OpenClaw session active';
    default:
      return 'Unknown state';
  }
}

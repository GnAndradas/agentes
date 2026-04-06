/**
 * AgentBootstrap
 *
 * Auto-seeds a default agent if no active agents exist in the system.
 * This ensures tasks can be assigned immediately after system startup.
 *
 * P0-A: Now includes materialization after activation to ensure agent is runtime-ready.
 */

import { getServices } from '../services/index.js';
import { createLogger } from '../utils/logger.js';
import { materializeAgent, getAgentWorkspace } from '../generator/AgentMaterialization.js';

const logger = createLogger('AgentBootstrap');

const DEFAULT_AGENT_NAME = 'default-general-agent';
const DEFAULT_AGENT_CAPABILITIES = ['general'];

/**
 * Ensures at least one active agent exists in the system.
 * If no active agents are found, creates and activates a default agent.
 */
export async function ensureDefaultAgent(): Promise<void> {
  const { agentService } = getServices();

  try {
    // Check if any active agents exist
    const activeAgents = await agentService.getActive();

    if (activeAgents.length > 0) {
      logger.info(
        { count: activeAgents.length },
        'Active agents found, skipping default agent creation'
      );
      return;
    }

    // Check if default agent already exists (but inactive)
    const allAgents = await agentService.list();
    const existingDefault = allAgents.find((a) => a.name === DEFAULT_AGENT_NAME);

    if (existingDefault) {
      // Activate existing default agent
      await agentService.activate(existingDefault.id);
      logger.info(
        { id: existingDefault.id },
        '[AgentBootstrap] activated existing default-general-agent'
      );

      // P0-A: Materialize agent if not already materialized
      await materializeAgentIfNeeded(
        existingDefault.name,
        existingDefault.type || 'general',
        existingDefault.description,
        existingDefault.capabilities || DEFAULT_AGENT_CAPABILITIES,
        (existingDefault.config as Record<string, unknown>) || {}
      );
      return;
    }

    // Create and activate new default agent
    const newAgent = await agentService.create({
      name: DEFAULT_AGENT_NAME,
      description: 'Auto-created default agent for general tasks',
      type: 'general',
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      source: 'system',
    });

    // Activate the newly created agent
    await agentService.activate(newAgent.id);

    logger.info(
      { id: newAgent.id, name: DEFAULT_AGENT_NAME },
      '[AgentBootstrap] created default-general-agent'
    );

    // P0-A: Materialize newly created agent
    await materializeAgentIfNeeded(
      newAgent.name,
      newAgent.type || 'general',
      newAgent.description,
      newAgent.capabilities || DEFAULT_AGENT_CAPABILITIES,
      (newAgent.config as Record<string, unknown>) || {}
    );
  } catch (error) {
    // Log error but don't fail startup - this is a convenience feature
    logger.error(
      { error },
      '[AgentBootstrap] failed to create default agent'
    );
  }
}

/**
 * P0-A: Materialize agent if workspace doesn't exist
 * Non-blocking - logs errors but doesn't fail
 */
async function materializeAgentIfNeeded(
  name: string,
  type: string,
  description: string | undefined,
  capabilities: string[],
  config: Record<string, unknown>
): Promise<void> {
  try {
    // Check if already materialized
    const workspace = getAgentWorkspace(name);
    if (workspace.exists) {
      logger.info(
        { agent: name, workspace: workspace.path },
        '[AgentMaterialization] workspace already exists, skipping materialization'
      );
      return;
    }

    // Materialize
    const trace = await materializeAgent(name, type, description, capabilities, config, 'system');

    if (trace.final_state === 'materialized') {
      logger.info(
        { agent: name, state: trace.final_state, steps: trace.steps_completed },
        '[AgentMaterialization] agent materialized successfully'
      );
    } else {
      logger.warn(
        { agent: name, state: trace.final_state, gap: trace.gap },
        '[AgentMaterialization] agent materialization incomplete'
      );
    }
  } catch (error) {
    // Don't fail bootstrap if materialization fails
    logger.error(
      { agent: name, error },
      '[AgentMaterialization] failed to materialize agent (non-blocking)'
    );
  }
}

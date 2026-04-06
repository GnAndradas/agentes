/**
 * AgentBootstrap
 *
 * Auto-seeds a default agent if no active agents exist in the system.
 * This ensures tasks can be assigned immediately after system startup.
 */

import { getServices } from '../services/index.js';
import { createLogger } from '../utils/logger.js';

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
  } catch (error) {
    // Log error but don't fail startup - this is a convenience feature
    logger.error(
      { error },
      '[AgentBootstrap] failed to create default agent'
    );
  }
}

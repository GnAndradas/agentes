import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getSessionManager } from '../openclaw/index.js';
import { AGENT_STATUS } from '../config/constants.js';
import type { AgentDTO } from '../types/domain.js';

const logger = createLogger('AgentManager');

export class AgentManager {
  async spawnAgent(agentId: string, initialPrompt?: string): Promise<boolean> {
    const { agentService } = getServices();
    const sessionManager = getSessionManager();

    const agent = await agentService.getById(agentId);

    if (agent.status === 'active') {
      logger.warn({ agentId }, 'Agent already active');
      return true;
    }

    const prompt = initialPrompt ?? `You are agent "${agent.name}". ${agent.description ?? ''}`;
    const sessionId = await sessionManager.spawnAgent(agentId, prompt);

    return sessionId !== null;
  }

  async terminateAgent(agentId: string): Promise<boolean> {
    const sessionManager = getSessionManager();
    return sessionManager.terminateAgent(agentId);
  }

  async getAgentStatus(agentId: string): Promise<{
    agent: AgentDTO;
    hasSession: boolean;
    taskCount: number;
  }> {
    const { agentService, taskService } = getServices();
    const sessionManager = getSessionManager();

    const agent = await agentService.getById(agentId);
    const tasks = await taskService.getByAgent(agentId);
    const hasSession = sessionManager.hasActiveSession(agentId);

    return {
      agent,
      hasSession,
      taskCount: tasks.filter(t => t.status === 'running').length,
    };
  }

  async healthCheck(): Promise<{
    total: number;
    active: number;
    inactive: number;
    error: number;
  }> {
    const { agentService } = getServices();
    const agents = await agentService.list();

    const counts = {
      total: agents.length,
      active: 0,
      inactive: 0,
      error: 0,
    };

    for (const agent of agents) {
      switch (agent.status) {
        case 'active':
        case 'busy':
          counts.active++;
          break;
        case 'inactive':
          counts.inactive++;
          break;
        case 'error':
          counts.error++;
          break;
      }
    }

    return counts;
  }

  async recoverAgents(): Promise<number> {
    const { agentService } = getServices();
    const sessionManager = getSessionManager();

    // Get agents that should be active but lost sessions
    const agents = await agentService.list();
    let recovered = 0;

    for (const agent of agents) {
      if (agent.status === 'active' && !sessionManager.hasActiveSession(agent.id)) {
        logger.info({ agentId: agent.id }, 'Recovering lost agent session');

        const success = await this.spawnAgent(agent.id);
        if (success) {
          recovered++;
        } else {
          await agentService.setStatus(agent.id, 'error');
        }
      }
    }

    return recovered;
  }
}

let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager();
  }
  return agentManagerInstance;
}

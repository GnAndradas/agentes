import { createLogger } from '../utils/logger.js';
import { getGateway } from './gateway.js';
import { getServices } from '../services/index.js';
import { getFeedbackService, type FeedbackType } from '../orchestrator/feedback/index.js';
import { AGENT_STATUS } from '../config/constants.js';
import type { SpawnOptions, SendOptions } from './types.js';

const logger = createLogger('SessionManager');

export class SessionManager {
  private activeSessions = new Map<string, string>(); // agentId -> sessionId

  async spawnAgent(agentId: string, prompt: string, options?: Partial<SpawnOptions>): Promise<string | null> {
    const { agentService, skillService, toolService } = getServices();
    const gateway = getGateway();

    try {
      const agent = await agentService.getById(agentId);
      const skills = await skillService.getAgentSkills(agentId);
      const tools = await toolService.getAgentTools(agentId);

      const result = await gateway.spawn({
        agentId,
        prompt,
        skills: skills.map(s => s.name),
        tools: tools.map(t => t.name),
        config: agent.config,
        ...options,
      });

      if (result.success && result.sessionId) {
        this.activeSessions.set(agentId, result.sessionId);
        await agentService.activate(agentId, result.sessionId);
        logger.info({ agentId, sessionId: result.sessionId }, 'Agent spawned');
        return result.sessionId;
      }

      logger.error({ agentId, error: result.error }, 'Failed to spawn agent');
      return null;
    } catch (err) {
      logger.error({ err, agentId }, 'Spawn error');
      return null;
    }
  }

  async sendToAgent(agentId: string, message: string, data?: Record<string, unknown>): Promise<string | null> {
    const sessionId = this.activeSessions.get(agentId);
    if (!sessionId) {
      logger.warn({ agentId }, 'No active session for agent');
      return null;
    }

    const gateway = getGateway();
    const result = await gateway.send({
      sessionId,
      message,
      data,
    });

    if (result.success) {
      return result.response ?? null;
    }

    logger.error({ agentId, error: result.error }, 'Send failed');
    return null;
  }

  async terminateAgent(agentId: string): Promise<boolean> {
    const sessionId = this.activeSessions.get(agentId);
    if (!sessionId) {
      return true;
    }

    const gateway = getGateway();
    const success = await gateway.terminate(sessionId);

    if (success) {
      this.activeSessions.delete(agentId);
      const { agentService } = getServices();
      await agentService.deactivate(agentId);
      logger.info({ agentId, sessionId }, 'Agent terminated');
    }

    return success;
  }

  getSessionId(agentId: string): string | null {
    return this.activeSessions.get(agentId) ?? null;
  }

  hasActiveSession(agentId: string): boolean {
    return this.activeSessions.has(agentId);
  }

  async syncSessions(): Promise<void> {
    const gateway = getGateway();
    const { agentService } = getServices();

    const remoteSessions = await gateway.listSessions();
    const agents = await agentService.getActive();

    // Create a set of active session IDs for fast lookup
    const remoteSessionIds = new Set(remoteSessions.map(s => s.id));

    // Deactivate agents without remote sessions
    for (const agent of agents) {
      if (agent.sessionId && !remoteSessionIds.has(agent.sessionId)) {
        logger.warn({ agentId: agent.id }, 'Session lost, deactivating agent');
        await agentService.deactivate(agent.id);
        this.activeSessions.delete(agent.id);
      }
    }

    // Update local session map
    for (const agent of agents) {
      if (agent.sessionId && remoteSessionIds.has(agent.sessionId)) {
        this.activeSessions.set(agent.id, agent.sessionId);
      }
    }
  }

  /**
   * Report feedback from agent during execution
   * This is the main entry point for agent-reported issues
   */
  async reportFeedback(
    agentId: string,
    taskId: string,
    type: FeedbackType,
    message: string,
    requirement?: string,
    context?: Record<string, unknown>
  ): Promise<void> {
    const sessionId = this.activeSessions.get(agentId);
    const feedbackService = getFeedbackService();

    await feedbackService.receiveFeedback({
      type,
      agentId,
      taskId,
      sessionId,
      message,
      requirement,
      context,
    });

    logger.info({ agentId, taskId, type, requirement }, 'Agent feedback reported via SessionManager');
  }
}

let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

export * from './types.js';
export { QueueManager } from './QueueManager.js';
export { DecisionEngine, getDecisionEngine } from './DecisionEngine.js';
export { TaskRouter, getTaskRouter } from './TaskRouter.js';
export { AgentManager, getAgentManager } from './AgentManager.js';

import { getTaskRouter } from './TaskRouter.js';
import { getAgentManager } from './AgentManager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('orchestrator');

export async function initOrchestrator(): Promise<void> {
  const taskRouter = getTaskRouter();
  const agentManager = getAgentManager();

  // Recover any agents that lost sessions
  const recoveredAgents = await agentManager.recoverAgents();
  if (recoveredAgents > 0) {
    logger.info({ recovered: recoveredAgents }, 'Recovered agent sessions');
  }

  // Recover pending tasks from database
  const recoveredTasks = await taskRouter.recoverPendingTasks();
  if (recoveredTasks > 0) {
    logger.info({ recovered: recoveredTasks }, 'Recovered pending tasks');
  }

  // Start task processing
  taskRouter.start();

  logger.info('Orchestrator initialized');
}

export function shutdownOrchestrator(): void {
  const taskRouter = getTaskRouter();
  taskRouter.stop();
  logger.info('Orchestrator shutdown');
}

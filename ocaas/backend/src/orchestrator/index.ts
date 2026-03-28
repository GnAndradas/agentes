export * from './types.js';
export { QueueManager } from './QueueManager.js';
export { TaskAnalyzer, getTaskAnalyzer } from './TaskAnalyzer.js';
export { DecisionEngine, getDecisionEngine } from './DecisionEngine.js';
export { TaskRouter, getTaskRouter } from './TaskRouter.js';
export { AgentManager, getAgentManager } from './AgentManager.js';
export { ActionExecutor, getActionExecutor } from './ActionExecutor.js';
export { TaskDecomposer, getTaskDecomposer } from './TaskDecomposer.js';
export * from './feedback/index.js';

import { getTaskRouter } from './TaskRouter.js';
import { getAgentManager } from './AgentManager.js';
import { getActionExecutor } from './ActionExecutor.js';
import { getFeedbackService } from './feedback/index.js';
import { getServices } from '../services/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('orchestrator');

export async function initOrchestrator(): Promise<void> {
  const taskRouter = getTaskRouter();
  const agentManager = getAgentManager();
  const actionExecutor = getActionExecutor();
  const { generationService } = getServices();

  // Register callback for task retry when generation is activated
  generationService.setOnActivatedCallback(async (generationId: string) => {
    const taskId = await actionExecutor.onGenerationActivated(generationId);
    if (taskId) {
      // Prioritize the specific task and re-trigger processing
      logger.info({ taskId, generationId }, 'Triggering task retry after generation activated');
      await taskRouter.retryTask(taskId);
    }
  });

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

  // Setup periodic cleanup of old feedback
  setInterval(async () => {
    const feedbackService = getFeedbackService();
    await feedbackService.cleanupOld();
  }, 60 * 60 * 1000); // Every hour

  logger.info('Orchestrator initialized');
}

export function shutdownOrchestrator(): void {
  const taskRouter = getTaskRouter();
  taskRouter.stop();
  logger.info('Orchestrator shutdown');
}

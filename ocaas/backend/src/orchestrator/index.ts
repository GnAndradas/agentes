export * from './types.js';
export { QueueManager } from './QueueManager.js';
export { TaskAnalyzer, getTaskAnalyzer } from './TaskAnalyzer.js';
export { DecisionEngine, getDecisionEngine } from './DecisionEngine.js';
export { TaskRouter, getTaskRouter } from './TaskRouter.js';
export { AgentManager, getAgentManager } from './AgentManager.js';
export { ActionExecutor, getActionExecutor } from './ActionExecutor.js';
export { TaskDecomposer, getTaskDecomposer } from './TaskDecomposer.js';
export { ResourceRetryService, getResourceRetryService } from './ResourceRetryService.js';
export * from './feedback/index.js';

import { getTaskRouter } from './TaskRouter.js';
import { getAgentManager } from './AgentManager.js';
import { getActionExecutor } from './ActionExecutor.js';
import { getResourceRetryService } from './ResourceRetryService.js';
import { getFeedbackService } from './feedback/index.js';
import { getServices } from '../services/index.js';
import { createLogger } from '../utils/logger.js';
import { initializeResilience, shutdownResilience } from './resilience/index.js';

const logger = createLogger('orchestrator');

export async function initOrchestrator(): Promise<void> {
  // Initialize resilience layer first (health checks, circuit breakers, recovery)
  await initializeResilience();

  const taskRouter = getTaskRouter();
  const agentManager = getAgentManager();
  const actionExecutor = getActionExecutor();
  const resourceRetryService = getResourceRetryService();
  const { generationService, manualResourceService } = getServices();

  // Register callback for task retry when AI generation is activated
  generationService.setOnActivatedCallback(async (generationId: string) => {
    const taskId = await actionExecutor.onGenerationActivated(generationId);
    if (taskId) {
      // Prioritize the specific task and re-trigger processing
      logger.info({ taskId, generationId }, 'Triggering task retry after generation activated');
      await taskRouter.retryTask(taskId);
    }
  });

  // Register callback for task retry when manual resource is activated
  manualResourceService.setOnActivatedCallback(async (draftId: string) => {
    const taskIds = await resourceRetryService.onResourceActivated(draftId);
    for (const taskId of taskIds) {
      logger.info({ taskId, draftId }, 'Triggering task retry after manual resource activated');
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

  // RECOVERY: Reconstruct ResourceRetryService state from database
  const retryRecovery = await resourceRetryService.recoverState();
  if (retryRecovery.pendingDrafts > 0) {
    logger.info({
      pendingDrafts: retryRecovery.pendingDrafts,
      tasksWaiting: retryRecovery.tasksWaiting,
    }, 'Recovered ResourceRetryService state');

    // Trigger retries for resources that were approved but not activated
    if (retryRecovery.resourcesNeedingRetry.length > 0) {
      const retriedTasks = await resourceRetryService.triggerPendingRetries(
        retryRecovery.resourcesNeedingRetry
      );
      if (retriedTasks.length > 0) {
        logger.info({ retriedTasks: retriedTasks.length }, 'Triggered pending retries after recovery');
      }
    }
  }

  // Start task processing
  taskRouter.start();

  // Setup periodic cleanup of old feedback and resource retries
  setInterval(async () => {
    const feedbackService = getFeedbackService();
    await feedbackService.cleanupOld();
    resourceRetryService.cleanupOld();
  }, 60 * 60 * 1000); // Every hour

  logger.info('Orchestrator initialized');
}

export async function shutdownOrchestrator(): Promise<void> {
  const taskRouter = getTaskRouter();
  taskRouter.stop();

  // Shutdown resilience layer (pause running tasks, stop health checks)
  await shutdownResilience();

  logger.info('Orchestrator shutdown');
}

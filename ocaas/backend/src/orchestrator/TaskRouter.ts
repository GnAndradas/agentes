import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getSessionManager } from '../openclaw/index.js';
import { QueueManager } from './QueueManager.js';
import { getDecisionEngine } from './DecisionEngine.js';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types.js';
import {
  getAutonomyConfig,
  requiresApprovalForTask,
} from '../config/autonomy.js';
import type { TaskDTO } from '../types/domain.js';
import type { OrchestratorConfig } from './types.js';
import type { CreateTaskInput } from '../services/TaskService.js';

const logger = createLogger('TaskRouter');

export class TaskRouter {
  private queue: QueueManager;
  private config: OrchestratorConfig;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.queue = new QueueManager();
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  // Enable/disable sequential mode (one task at a time globally)
  setSequentialMode(enabled: boolean): void {
    this.queue.setSequentialMode(enabled);
  }

  async submit(task: TaskDTO): Promise<void> {
    const { taskService } = getServices();

    // Queue the task
    await taskService.queue(task.id);
    this.queue.add(task);

    // Try immediate assignment if auto-assign enabled
    if (this.config.autoAssign) {
      await this.processNext();
    }
  }

  // Submit multiple tasks as a sequential batch (executed one after another)
  async submitBatch(inputs: CreateTaskInput[]): Promise<{ batchId: string; taskIds: string[] }> {
    const { taskService } = getServices();
    const batchId = `batch_${nanoid(10)}`;
    const taskIds: string[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!;
      const dependsOn = i > 0 ? [taskIds[i - 1]!] : undefined;

      const task = await taskService.create({
        ...input,
        batchId,
        sequenceOrder: i + 1,
        dependsOn,
      });

      taskIds.push(task.id);
      this.queue.add(task);
    }

    // Queue all tasks
    for (const id of taskIds) {
      await taskService.queue(id);
    }

    logger.info({ batchId, taskCount: taskIds.length }, 'Batch submitted for sequential execution');
    return { batchId, taskIds };
  }

  async processNext(): Promise<boolean> {
    const queued = this.queue.peek();
    if (!queued) {
      return false;
    }

    // Check autonomy level - manual mode requires explicit approval
    const autonomyConfig = getAutonomyConfig();
    if (autonomyConfig.level === 'manual') {
      logger.debug('Manual mode active, skipping automatic processing');
      return false;
    }

    // Check concurrent limit
    if (this.queue.getProcessingCount() >= this.config.maxConcurrentTasks) {
      logger.debug('Max concurrent tasks reached');
      return false;
    }

    const { taskService, approvalService, notificationService } = getServices();
    const decisionEngine = getDecisionEngine();
    const sessionManager = getSessionManager();

    // Get fresh task data
    const task = await taskService.getById(queued.task.id);

    // Check if dependencies are met
    const canRun = await taskService.areDependenciesMet(task);
    if (!canRun) {
      logger.debug({ taskId: task.id }, 'Task dependencies not met, skipping');
      return false;
    }

    // Check if task requires human approval
    if (requiresApprovalForTask(task.priority)) {
      const existingApproval = await approvalService.getByResource('task', task.id);

      if (!existingApproval) {
        // Create approval request
        const approval = await approvalService.create({
          type: 'task',
          resourceId: task.id,
          metadata: {
            title: task.title,
            priority: task.priority,
            description: task.description,
          },
        });

        // Notify human
        await notificationService.notifyApprovalRequired(
          approval.id,
          'task',
          task.id,
          { title: task.title, priority: task.priority }
        );

        logger.info({ taskId: task.id, approvalId: approval.id }, 'Task requires approval');
        return false;
      }

      if (existingApproval.status === 'pending') {
        // Still waiting for approval
        return false;
      }

      if (existingApproval.status === 'rejected' || existingApproval.status === 'expired') {
        // Approval denied or expired - cancel task
        await taskService.cancel(task.id);
        this.queue.remove(task.id);
        logger.info({ taskId: task.id, status: existingApproval.status }, 'Task cancelled due to approval status');
        return false;
      }

      // If approved, continue with execution
    }

    // Find best agent
    const assignment = await decisionEngine.findBestAgent(task);

    if (!assignment) {
      // Check for missing capability
      const missing = await decisionEngine.detectMissingCapability(task);
      if (missing) {
        logger.info({ taskId: task.id, missingCapability: missing }, 'Task requires missing capability');
        // Could trigger generation here
      }
      return false;
    }

    // Mark as processing
    this.queue.markProcessing(task.id);

    try {
      // Assign task
      await taskService.assign(task.id, assignment.agentId);

      // Ensure agent has an active session
      if (!sessionManager.hasActiveSession(assignment.agentId)) {
        const { agentService } = getServices();
        const agent = await agentService.getById(assignment.agentId);
        const sessionId = await sessionManager.spawnAgent(
          assignment.agentId,
          agent.config?.systemPrompt as string ?? `You are agent ${agent.name}. Execute assigned tasks.`
        );
        if (!sessionId) {
          throw new Error(`Failed to spawn session for agent ${assignment.agentId}`);
        }
      }

      // Start task
      await taskService.start(task.id);

      // Send to agent via session
      const response = await sessionManager.sendToAgent(
        assignment.agentId,
        `Execute task: ${task.title}\n\nDescription: ${task.description ?? 'No description'}\n\nInput: ${JSON.stringify(task.input ?? {})}`,
        { taskId: task.id, ...task.input }
      );

      if (response) {
        // Task completed
        await taskService.complete(task.id, { response });
        this.queue.markDone(task.id);
        return true;
      }

      // If no response, task might still be running async
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId: task.id }, 'Task processing failed');

      // Use task's own retry settings
      if (task.retryCount < task.maxRetries) {
        // Re-queue for retry
        await taskService.incrementRetry(task.id);
        this.queue.markDone(task.id);
        // Re-add to queue for retry
        const updatedTask = await taskService.getById(task.id);
        this.queue.add(updatedTask);
        logger.info({ taskId: task.id, retryCount: updatedTask.retryCount }, 'Task queued for retry');
      } else {
        await taskService.fail(task.id, message);
        this.queue.markDone(task.id);
        logger.error({ taskId: task.id, retryCount: task.retryCount }, 'Task failed after max retries');
      }

      return false;
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const { taskService } = getServices();

    if (this.queue.has(taskId)) {
      this.queue.remove(taskId);
      await taskService.cancel(taskId);
      return true;
    }

    return false;
  }

  // Recover pending tasks from database on startup
  async recoverPendingTasks(): Promise<number> {
    const { taskService } = getServices();
    const pendingTasks = await taskService.getPending();

    let recovered = 0;
    for (const task of pendingTasks) {
      if (!this.queue.has(task.id)) {
        this.queue.add(task);
        recovered++;
      }
    }

    if (recovered > 0) {
      logger.info({ recovered }, 'Recovered pending tasks from database');
    }
    return recovered;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = setInterval(async () => {
      try {
        // Process expired approvals
        const { approvalService } = getServices();
        await approvalService.processExpired();

        // Process next task
        await this.processNext();
      } catch (err) {
        logger.error({ err }, 'Error in task processing loop');
      }
    }, 1000);

    logger.info('TaskRouter started');
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('TaskRouter stopped');
  }

  getStatus(): {
    running: boolean;
    queueSize: number;
    processing: number;
    sequentialMode: boolean;
    batchesProcessing: number;
  } {
    const queueStatus = this.queue.getStatus();
    return {
      running: this.running,
      queueSize: queueStatus.queueSize,
      processing: queueStatus.processing,
      sequentialMode: queueStatus.sequentialMode,
      batchesProcessing: queueStatus.batchesProcessing,
    };
  }
}

let taskRouterInstance: TaskRouter | null = null;

export function getTaskRouter(): TaskRouter {
  if (!taskRouterInstance) {
    taskRouterInstance = new TaskRouter();
  }
  return taskRouterInstance;
}

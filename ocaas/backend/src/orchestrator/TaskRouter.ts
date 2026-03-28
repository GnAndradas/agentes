import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getSessionManager } from '../openclaw/index.js';
import { QueueManager } from './QueueManager.js';
import { getDecisionEngine } from './DecisionEngine.js';
import { getActionExecutor } from './ActionExecutor.js';
import { getTaskDecomposer } from './TaskDecomposer.js';
import { getFeedbackService } from './feedback/index.js';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types.js';
import {
  getAutonomyConfig,
  requiresApprovalForTask,
} from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
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

    const { taskService, approvalService, notificationService, eventService } = getServices();
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

    // Use intelligent decision (AI-powered when available)
    const decision = await decisionEngine.makeIntelligentDecision(task);

    // Store analysis metadata on task for future reference
    if (decision.analysis) {
      const analysisMetadata = {
        ...task.metadata,
        _analysis: {
          taskType: decision.analysis.taskType,
          complexity: decision.analysis.complexity,
          capabilities: decision.analysis.requiredCapabilities,
          confidence: decision.analysis.confidence,
          usedFallback: decision.usedFallback,
        },
      };
      // Note: Could persist this via taskService.update() if needed
    }

    // Log intelligent decision info
    if (!decision.usedFallback) {
      logger.info({
        taskId: task.id,
        analysisType: decision.analysis.taskType,
        complexity: decision.analysis.complexity,
        confidence: decision.analysis.confidence,
        suggestedActions: decision.suggestedActions.map(a => a.action),
      }, 'Intelligent decision made');
    }

    // Check if task should be decomposed into subtasks
    const taskDecomposer = getTaskDecomposer();
    if (decision.analysis && !decision.usedFallback) {
      if (taskDecomposer.shouldDecompose(task, decision.analysis)) {
        logger.info({
          taskId: task.id,
          subtaskCount: decision.analysis.suggestedSubtasks?.length,
          complexity: decision.analysis.complexity,
        }, 'Task should be decomposed');

        const decompResult = await taskDecomposer.decompose(task, decision.analysis);

        if (decompResult.decomposed) {
          // Submit subtasks to queue
          for (const subtaskId of decompResult.subtaskIds) {
            const subtask = await taskService.getById(subtaskId);
            await taskService.queue(subtaskId);
            this.queue.add(subtask);
          }

          // Remove parent from queue (it will be completed when subtasks finish)
          this.queue.remove(task.id);

          logger.info({
            parentTaskId: task.id,
            subtaskCount: decompResult.subtaskIds.length,
          }, 'Parent task decomposed and subtasks queued');

          // Process next (which will be a subtask)
          return true;
        }
      }
    }

    const assignment = decision.assignment;

    if (!assignment) {
      // No agent found - check if we should execute suggested actions
      const actionExecutor = getActionExecutor();

      // Check if there's already a pending generation for this task
      if (actionExecutor.hasPendingGeneration(task.id)) {
        logger.debug({ taskId: task.id }, 'Task has pending generation, waiting');
        return false;
      }

      if (decision.missingReport && decision.missingReport.suggestions.length > 0) {
        logger.info({
          taskId: task.id,
          missingCapabilities: decision.missingReport.missingCapabilities,
          suggestions: decision.missingReport.suggestions.map(s => ({
            type: s.type,
            name: s.name,
            canAutoGenerate: s.canAutoGenerate,
          })),
          requiresApproval: decision.missingReport.requiresApproval,
        }, 'Missing capabilities detected with suggestions');

        // Emit event for potential UI notification
        await eventService.emit({
          type: EVENT_TYPE.SYSTEM_INFO,
          category: 'orchestrator',
          severity: 'warning',
          message: `Task "${task.title}" requires capabilities that are not available`,
          resourceType: 'task',
          resourceId: task.id,
          data: {
            missingCapabilities: decision.missingReport.missingCapabilities,
            suggestions: decision.missingReport.suggestions,
          },
        });

        // Execute suggested actions if autonomy allows
        if (autonomyConfig.level !== 'manual') {
          const results = await actionExecutor.executeActions(
            task.id,
            decision.missingReport,
            decision.suggestedActions
          );

          // Log action execution results
          for (const result of results) {
            if (result.success) {
              logger.info({
                taskId: task.id,
                action: result.action,
                generationId: result.generationId,
                requiresApproval: result.requiresApproval,
              }, 'Action executed successfully');

              await eventService.emit({
                type: EVENT_TYPE.ACTION_CREATED,
                category: 'orchestrator',
                severity: 'info',
                message: `Action ${result.action} created for task "${task.title}"`,
                resourceType: 'task',
                resourceId: task.id,
                data: {
                  action: result.action,
                  generationId: result.generationId,
                  approvalId: result.approvalId,
                  requiresApproval: result.requiresApproval,
                },
              });
            } else {
              logger.error({
                taskId: task.id,
                action: result.action,
                error: result.error,
              }, 'Action execution failed');

              await eventService.emit({
                type: EVENT_TYPE.ACTION_FAILED,
                category: 'orchestrator',
                severity: 'error',
                message: `Action ${result.action} failed: ${result.error}`,
                resourceType: 'task',
                resourceId: task.id,
                data: { action: result.action, error: result.error },
              });
            }
          }

          // If any action was initiated, task stays queued waiting for completion
          if (results.some(r => r.success)) {
            logger.info({ taskId: task.id }, 'Task waiting for resource generation');
            return false;
          }
        }
      }

      // Fallback: also check legacy method
      const missing = await decisionEngine.detectMissingCapability(task);
      if (missing) {
        logger.debug({ taskId: task.id, missingCapability: missing }, 'Legacy missing capability check');
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
        // Clear any feedback for this task
        await getFeedbackService().clearForTask(task.id);

        // Check if this is a subtask and parent needs to be completed
        if (task.parentTaskId) {
          const decomposer = getTaskDecomposer();
          await decomposer.checkParentCompletion(task);
        }

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
        // Clear any feedback for this task
        await getFeedbackService().clearForTask(task.id);

        // Check if this is a subtask and parent needs to be marked as failed
        if (task.parentTaskId) {
          const decomposer = getTaskDecomposer();
          await decomposer.checkParentCompletion(task);
        }

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

  /**
   * Retry a specific task (used after resource generation)
   * Prioritizes the task in queue and triggers processing
   */
  async retryTask(taskId: string): Promise<boolean> {
    const { eventService, taskService } = getServices();

    // Check if task is in queue
    if (!this.queue.has(taskId)) {
      logger.warn({ taskId }, 'Task not in queue for retry');
      return false;
    }

    // Get task info for event
    const task = await taskService.getById(taskId);

    // Emit retry triggered event
    await eventService.emit({
      type: EVENT_TYPE.TASK_RETRY_TRIGGERED,
      category: 'orchestrator',
      severity: 'info',
      message: `Task "${task.title}" retry triggered after resource generation`,
      resourceType: 'task',
      resourceId: taskId,
    });

    // Prioritize this task
    this.queue.prioritizeTask(taskId);

    // Process (will pick up the prioritized task)
    return this.processNext();
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
    let cleanupCounter = 0;

    this.intervalId = setInterval(async () => {
      try {
        // Process expired approvals
        const { approvalService } = getServices();
        await approvalService.processExpired();

        // Cleanup old pending retries every ~60 seconds
        cleanupCounter++;
        if (cleanupCounter >= 60) {
          cleanupCounter = 0;
          const actionExecutor = getActionExecutor();
          actionExecutor.cleanupOldPending();
        }

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

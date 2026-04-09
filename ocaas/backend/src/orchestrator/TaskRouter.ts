import { nanoid } from 'nanoid';
import { orchestratorLogger, createTaskLogger, logError } from '../utils/logger.js';
import type { EnhancedLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getSessionManager } from '../openclaw/index.js';
import { QueueManager } from './QueueManager.js';
import { getDecisionEngine } from './DecisionEngine.js';
import { getActionExecutor } from './ActionExecutor.js';
import { getTaskDecomposer } from './TaskDecomposer.js';
import { getResourceRetryService } from './ResourceRetryService.js';
import { getFeedbackService } from './feedback/index.js';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types.js';
import {
  getAutonomyConfig,
  requiresApprovalForTask,
} from '../config/autonomy.js';
import { EVENT_TYPE, TASK_STATUS } from '../config/constants.js';
import type { TaskDTO, TaskIngressMode } from '../types/domain.js';
import type { OrchestratorConfig } from './types.js';
import type { CreateTaskInput } from '../services/TaskService.js';
import {
  getExecutionLeaseStore,
  getCheckpointStore,
} from './resilience/index.js';
import { getJobDispatcherService } from '../execution/JobDispatcherService.js';
import type { OrgAwareDecision } from './OrgAwareDecisionEngine.js';

const logger = orchestratorLogger.child({ component: 'TaskRouter' });

// Valid state transitions FSM
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued', 'cancelled'],
  queued: ['assigned', 'cancelled', 'pending'], // pending for retry
  assigned: ['running', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [], // terminal
  failed: ['pending'], // can retry
  cancelled: [], // terminal
};

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

  /**
   * Submit a task for processing (unified entry point)
   * @param task - The task to submit
   * @param ingressMode - How the task entered the system (defaults to 'api')
   * @param ingressMeta - Additional ingress metadata
   */
  async submit(
    task: TaskDTO,
    ingressMode: TaskIngressMode = 'api',
    ingressMeta?: { sourceChannel?: string; batchId?: string; decomposedFrom?: string }
  ): Promise<void> {
    const { taskService } = getServices();

    // Add intake traceability to task metadata
    const intake = {
      ingress_mode: ingressMode,
      queued_at: Date.now(),
      source_channel: ingressMeta?.sourceChannel,
      batch_id: ingressMeta?.batchId,
      decomposed_from: ingressMeta?.decomposedFrom,
    };

    // Update task with intake info (stored in metadata for now)
    await taskService.update(task.id, {
      metadata: {
        ...task.metadata,
        _intake: intake,
      },
    });

    // Queue the task
    await taskService.queue(task.id);
    this.queue.add(task);

    logger.debug({
      taskId: task.id,
      ingressMode,
      queuedAt: intake.queued_at,
    }, 'Task submitted to router');

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

    // Create task-scoped logger for correlation
    const taskLog = createTaskLogger('TaskRouter', task.id);

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
      // =======================================================================
      // PROMPT 18: CLEAR ERROR - No agent assignment possible
      // After PROMPT 18 fixes, this should only happen when NO agents exist.
      // =======================================================================
      logger.error({
        taskId: task.id,
        taskTitle: task.title,
        taskType: task.type,
        decisionType: decision.analysis?.taskType,
        usedFallback: decision.usedFallback,
        fallbackReason: decision.fallbackReason,
        suggestedActions: decision.suggestedActions?.map(a => a.action),
      }, 'TASK BLOCKED: No agent assignment possible. Check if any active agents exist.');

      // Emit clear error event for UI/monitoring
      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_ERROR,
        category: 'orchestrator',
        severity: 'error',
        message: `Task "${task.title}" cannot be assigned - no active agents available`,
        resourceType: 'task',
        resourceId: task.id,
        data: {
          reason: 'NO_ACTIVE_AGENTS',
          taskType: task.type,
          suggestion: 'Create or activate an agent to handle this task',
        },
      });

      // No agent found - check if we should execute suggested actions
      const actionExecutor = getActionExecutor();
      const resourceRetryService = getResourceRetryService();

      // Check if there's already a pending generation or resource creation for this task
      if (actionExecutor.hasPendingGeneration(task.id) || resourceRetryService.hasPendingResource(task.id)) {
        logger.debug({ taskId: task.id }, 'Task has pending resource creation, waiting');
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

        // Try ResourceRetryService first (creates drafts via ManualResourceService)
        const { draftIds, requiresHuman } = await resourceRetryService.handleMissingResource(
          task.id,
          decision.missingReport
        );

        if (draftIds.length > 0) {
          logger.info({
            taskId: task.id,
            draftIds,
            requiresHuman,
          }, 'Resource drafts created for task');

          // Task stays queued waiting for resource activation
          return false;
        }

        // Fallback: Try AI generation via ActionExecutor (legacy path)
        {
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

    // =========================================================================
    // CRITICAL: Acquire execution lease BEFORE processing to prevent duplicates
    // =========================================================================
    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();
    const executionId = `exec_${nanoid(12)}`;

    // Check if task already has an active lease (another instance processing)
    if (leaseStore.hasActiveLease(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already has active lease, skipping');
      return false;
    }

    // Acquire lease - this is the critical section for preventing double execution
    const lease = leaseStore.acquire(task.id, executionId);
    if (!lease) {
      logger.warn({ taskId: task.id, executionId }, 'Failed to acquire execution lease');
      return false;
    }

    // Create checkpoint to track execution state
    const checkpoint = checkpointStore.getOrCreate(task.id, assignment.agentId);
    checkpoint.executionId = executionId;
    checkpointStore.updateStage(task.id, 'assigning');

    // Mark as processing in queue
    this.queue.markProcessing(task.id);

    try {
      // =========================================================================
      // STAGE: Assigning agent
      // =========================================================================
      await taskService.assign(task.id, assignment.agentId);
      checkpointStore.updateAgent(task.id, assignment.agentId);
      checkpointStore.updateStage(task.id, 'spawning_session', 'agent_assigned', 20);

      // Renew lease after each significant operation
      leaseStore.renew(task.id, executionId);

      // =========================================================================
      // STAGE: Dispatch via JobDispatcherService
      // =========================================================================
      // Build OrgAwareDecision-compatible object for JobDispatcher
      const dispatchDecision: OrgAwareDecision = {
        taskId: task.id,
        decidedAt: Date.now(),
        analysis: decision.analysis,
        assignment: {
          taskId: task.id,
          agentId: assignment.agentId,
          score: assignment.score,
          reason: assignment.reason,
        },
        suggestedActions: decision.suggestedActions || [],
        usedFallback: decision.usedFallback,
        usedHierarchy: false,
      };

      const jobDispatcher = getJobDispatcherService();
      checkpointStore.updateStage(task.id, 'executing', 'dispatching_job', 40);

      // Start task before dispatch
      await taskService.start(task.id);
      checkpointStore.updateStage(task.id, 'awaiting_response', 'job_dispatched', 50);

      // Dispatch job - this handles:
      // - Job creation in DB
      // - TaskState tracking
      // - Cost recording
      // - OpenClaw execution (or fallback)
      const dispatchResult = await jobDispatcher.dispatch(dispatchDecision, task, {
        waitForCompletion: true,
      });

      // Renew lease after dispatch
      leaseStore.renew(task.id, executionId);

      if (dispatchResult.dispatched && dispatchResult.response) {
        const jobResponse = dispatchResult.response;

        if (
          jobResponse.status === 'completed' || 
          jobResponse.status === 'completed_with_fallback' || 
          jobResponse.status === 'completed_stub'
        ) {
          // =========================================================================
          // STAGE: Completing task
          // =========================================================================
          checkpointStore.updateStage(task.id, 'completing', 'saving_result', 90);
          await taskService.complete(
            task.id, 
            {
              jobId: jobResponse.jobId,
              response: jobResponse.result?.output,
              data: jobResponse.result?.data,
            },
            jobResponse.truth
          );

          // Mark checkpoint as completed
          checkpointStore.markCompleted(task.id);

          // Release lease
          leaseStore.release(task.id, executionId);

          this.queue.markDone(task.id);

          // Clear any feedback and pending retries for this task
          await getFeedbackService().clearForTask(task.id);
          getResourceRetryService().clearForTask(task.id);

          // Check if this is a subtask and parent needs to be completed
          if (task.parentTaskId) {
            const decomposer = getTaskDecomposer();
            await decomposer.checkParentCompletion(task);
          }

          logger.info({ taskId: task.id, executionId, jobId: jobResponse.jobId }, 'Task completed successfully via JobDispatcher');
          return true;
        }

        if (jobResponse.status === 'accepted') {
          // Async execution accepted - task stays running
          checkpointStore.updateStage(task.id, 'awaiting_response', 'async_accepted', 60);
          logger.info({ taskId: task.id, jobId: jobResponse.jobId }, 'Task accepted for async execution');
          return true;
        }

        if (jobResponse.status === 'failed') {
          throw new Error(jobResponse.error?.message || 'Job execution failed');
        }

        if (jobResponse.status === 'blocked') {
          // Task blocked - stays in running, waiting for resource
          checkpointStore.updateBlocker(task.id, jobResponse.blocked?.description || 'Blocked');
          logger.warn({ taskId: task.id, jobId: jobResponse.jobId, reason: jobResponse.blocked?.reason }, 'Task blocked');
          return false;
        }
      }

      // Dispatch failed without response
      if (!dispatchResult.dispatched) {
        throw new Error(dispatchResult.error?.message || 'Job dispatch failed');
      }

      // Async dispatch without immediate response
      checkpointStore.updateStage(task.id, 'awaiting_response', 'async_execution', 60);
      return true;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      // Update checkpoint with failure info
      checkpointStore.updateBlocker(task.id, message);

      logError(taskLog, err, {
        taskId: task.id,
        executionId,
        errorType: 'task_processing_failed',
        recoverable: task.retryCount < task.maxRetries,
        suggestedAction: task.retryCount < task.maxRetries ? 'retry' : 'fail',
      });

      // Use task's own retry settings
      if (task.retryCount < task.maxRetries) {
        // Mark checkpoint as retrying
        checkpointStore.incrementRetry(task.id);
        checkpointStore.updateStage(task.id, 'retrying', `retry_${task.retryCount + 1}`);

        // Re-queue for retry
        await taskService.incrementRetry(task.id);

        // Release lease before re-queue
        leaseStore.release(task.id, executionId);

        this.queue.markDone(task.id);

        // Re-add to queue for retry
        const updatedTask = await taskService.getById(task.id);
        this.queue.add(updatedTask);

        logger.info({ taskId: task.id, executionId, retryCount: updatedTask.retryCount }, 'Task queued for retry');
      } else {
        // Mark checkpoint as failed
        checkpointStore.markFailed(task.id, message);

        await taskService.fail(task.id, message);

        // Release lease
        leaseStore.release(task.id, executionId);

        this.queue.markDone(task.id);

        // Clear any feedback and pending retries for this task
        await getFeedbackService().clearForTask(task.id);
        getResourceRetryService().clearForTask(task.id);

        // Check if this is a subtask and parent needs to be marked as failed
        if (task.parentTaskId) {
          const decomposer = getTaskDecomposer();
          await decomposer.checkParentCompletion(task);
        }

        logger.error({ taskId: task.id, executionId, retryCount: task.retryCount }, 'Task failed after max retries');
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

  /**
   * Recover pending tasks from database on startup
   * Also rebuilds checkpoints and handles orphaned RUNNING tasks
   */
  async recoverPendingTasks(): Promise<number> {
    const { taskService } = getServices();
    const checkpointStore = getCheckpointStore();
    const leaseStore = getExecutionLeaseStore();

    logger.info('Starting task recovery from database...');

    // 1. First, release all leases from previous instance (clean slate)
    const expiredLeases = leaseStore.getExpiredLeases();
    for (const lease of expiredLeases) {
      leaseStore.forceRelease(lease.taskId);
    }
    logger.info({ releasedLeases: expiredLeases.length }, 'Released leases from previous instance');

    // 2. Recover RUNNING tasks - these need special handling
    const runningTasks = await taskService.getRunning();
    let runningRecovered = 0;

    for (const task of runningTasks) {
      // Create checkpoint for tracking
      const checkpoint = checkpointStore.getOrCreate(task.id, task.agentId);
      checkpoint.currentStage = 'paused';
      checkpoint.lastKnownBlocker = 'Recovered from crash - was RUNNING';
      checkpoint.resumable = true;

      // Decide: retry or fail based on retry count
      if (task.retryCount < task.maxRetries) {
        // Requeue for retry
        await taskService.incrementRetry(task.id);
        const updated = await taskService.getById(task.id);
        this.queue.add(updated);
        checkpoint.currentStage = 'retrying';
        runningRecovered++;
        logger.info({ taskId: task.id, retryCount: updated.retryCount }, 'RUNNING task recovered and requeued');
      } else {
        // No retries - mark as failed
        await taskService.fail(task.id, 'Task was in RUNNING state during crash recovery');
        checkpointStore.markFailed(task.id, 'Crash recovery - max retries exceeded');
        logger.warn({ taskId: task.id }, 'RUNNING task failed during recovery - max retries');
      }
    }

    // 3. Recover ASSIGNED tasks (agent selected but not started)
    const assignedTasks = await taskService.list({ status: TASK_STATUS.ASSIGNED as any });
    let assignedRecovered = 0;

    for (const task of assignedTasks) {
      // Reset to queued state
      await taskService.queue(task.id);
      const updated = await taskService.getById(task.id);

      if (!this.queue.has(task.id)) {
        this.queue.add(updated);
        assignedRecovered++;

        const checkpoint = checkpointStore.getOrCreate(task.id, task.agentId);
        checkpoint.currentStage = 'queued';
        checkpoint.lastKnownBlocker = 'Recovered from crash - was ASSIGNED';
      }
    }

    // 4. Recover PENDING and QUEUED tasks
    const pendingTasks = await taskService.getPending();
    let pendingRecovered = 0;

    for (const task of pendingTasks) {
      if (!this.queue.has(task.id)) {
        this.queue.add(task);
        pendingRecovered++;

        // Create lightweight checkpoint
        const checkpoint = checkpointStore.getOrCreate(task.id, task.agentId);
        checkpoint.currentStage = 'queued';
      }
    }

    const totalRecovered = runningRecovered + assignedRecovered + pendingRecovered;

    logger.info({
      totalRecovered,
      runningRecovered,
      assignedRecovered,
      pendingRecovered,
      queueSize: this.queue.getQueueSize(),
    }, 'Task recovery completed');

    return totalRecovered;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    let cleanupCounter = 0;
    let leaseCleanupCounter = 0;

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

        // Cleanup expired leases and stale tasks every ~30 seconds
        leaseCleanupCounter++;
        if (leaseCleanupCounter >= 30) {
          leaseCleanupCounter = 0;
          await this.cleanupStaleExecutions();
        }

        // Process next task
        await this.processNext();
      } catch (err) {
        logger.error({ err }, 'Error in task processing loop');
      }
    }, 1000);

    logger.info('TaskRouter started');
  }

  /**
   * Cleanup stale executions - tasks with expired leases or stuck states
   */
  private async cleanupStaleExecutions(): Promise<void> {
    const leaseStore = getExecutionLeaseStore();
    const checkpointStore = getCheckpointStore();
    const { taskService } = getServices();

    // 1. Release expired leases
    const expiredCount = leaseStore.cleanupExpired();
    if (expiredCount > 0) {
      logger.info({ expiredCount }, 'Cleaned up expired execution leases');
    }

    // 2. Find tasks in RUNNING state without active lease (orphaned)
    const runningTasks = await taskService.getRunning();
    for (const task of runningTasks) {
      if (!leaseStore.hasActiveLease(task.id)) {
        // Task is RUNNING but no lease - it's orphaned
        const checkpoint = checkpointStore.get(task.id);

        // Check how long it's been stuck
        const stuckDuration = Date.now() - (task.startedAt ?? task.updatedAt) * 1000;
        const stuckMinutes = Math.round(stuckDuration / 60000);

        if (stuckDuration > 5 * 60 * 1000) { // 5 minutes
          logger.warn({
            taskId: task.id,
            stuckMinutes,
            hasCheckpoint: !!checkpoint,
            checkpointStage: checkpoint?.currentStage,
          }, 'Found orphaned RUNNING task');

          // If task has retries remaining, requeue it
          if (task.retryCount < task.maxRetries) {
            await taskService.incrementRetry(task.id);
            const updated = await taskService.getById(task.id);
            if (!this.queue.has(task.id)) {
              this.queue.add(updated);
            }
            logger.info({ taskId: task.id }, 'Orphaned task requeued for retry');
          } else {
            // No retries left - fail the task
            await taskService.fail(task.id, `Task orphaned after ${stuckMinutes} minutes with no active lease`);
            checkpointStore.markFailed(task.id, 'Orphaned execution');
            logger.error({ taskId: task.id }, 'Orphaned task failed - no retries remaining');
          }
        }
      }
    }

    // 3. Cleanup old checkpoints
    checkpointStore.cleanup();
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

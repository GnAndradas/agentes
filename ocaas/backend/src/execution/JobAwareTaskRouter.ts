/**
 * Job-Aware Task Router
 *
 * Extends TaskRouter to use the new Job Dispatch system when appropriate.
 *
 * Decision flow:
 * 1. Use OrgAwareDecisionEngine for hierarchy-aware decisions
 * 2. If decision has assignment AND agent has org profile → use JobDispatcher
 * 3. Otherwise → fall back to legacy TaskRouter flow
 *
 * This maintains backward compatibility while enabling the new execution model.
 */

import { orchestratorLogger, createTaskLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getTaskRouter, TaskRouter } from '../orchestrator/TaskRouter.js';
import { getOrgAwareDecisionEngine } from '../orchestrator/OrgAwareDecisionEngine.js';
import { getAgentHierarchyStore } from '../organization/AgentHierarchyStore.js';
import { getJobDispatcherService } from './JobDispatcherService.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { TaskDTO } from '../types/domain.js';
import type { OrgAwareDecision } from '../orchestrator/OrgAwareDecisionEngine.js';
import type { JobResponse, DispatchResult } from './types.js';

const logger = orchestratorLogger.child({ component: 'JobAwareTaskRouter' });

export interface JobAwareConfig {
  /** Use job dispatch when org hierarchy is configured */
  useJobDispatchForOrgTasks: boolean;
  /** Minimum hierarchy depth to use job dispatch (0 = any org profile) */
  minHierarchyDepthForJobDispatch: number;
  /** Fall back to legacy on job dispatch failure */
  fallbackToLegacyOnFailure: boolean;
  /** Log job dispatch decisions for debugging */
  debugJobDispatch: boolean;
}

const DEFAULT_CONFIG: JobAwareConfig = {
  useJobDispatchForOrgTasks: true,
  minHierarchyDepthForJobDispatch: 0,
  fallbackToLegacyOnFailure: true,
  debugJobDispatch: false,
};

export class JobAwareTaskRouter {
  private config: JobAwareConfig;
  private legacyRouter: TaskRouter;

  constructor(config: Partial<JobAwareConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.legacyRouter = getTaskRouter();
  }

  /**
   * Submit a task with job-aware routing
   */
  async submit(task: TaskDTO): Promise<void> {
    // For now, delegate to legacy router's submit
    // Job dispatch happens during processNext
    return this.legacyRouter.submit(task);
  }

  /**
   * Process next task with job-aware decision
   */
  async processNext(): Promise<boolean> {
    // Check if we should use job dispatch
    if (!this.config.useJobDispatchForOrgTasks) {
      return this.legacyRouter.processNext();
    }

    const { taskService } = getServices();
    const hierarchyStore = getAgentHierarchyStore();

    // Check if org hierarchy is configured
    const hasHierarchy = hierarchyStore.list().length > 0;

    if (!hasHierarchy) {
      // No org hierarchy - use legacy router
      if (this.config.debugJobDispatch) {
        logger.debug('No org hierarchy configured, using legacy router');
      }
      return this.legacyRouter.processNext();
    }

    // Peek at next queued task
    const routerStatus = this.legacyRouter.getStatus();
    if (routerStatus.queueSize === 0) {
      return false;
    }

    // Get pending tasks
    const pendingTasks = await taskService.getPending();
    if (pendingTasks.length === 0) {
      return false;
    }

    const task = pendingTasks[0]!;
    const taskLog = createTaskLogger('JobAwareTaskRouter', task.id);

    // Make org-aware decision
    const orgDecisionEngine = getOrgAwareDecisionEngine();
    const decision = await orgDecisionEngine.decide(task);

    if (this.config.debugJobDispatch) {
      logger.debug({
        taskId: task.id,
        usedHierarchy: decision.usedHierarchy,
        hasAssignment: !!decision.assignment,
        delegation: decision.delegation,
        escalation: decision.escalation,
      }, 'OrgAware decision made');
    }

    // Check if we should use job dispatch
    const shouldUseJobDispatch = this.shouldUseJobDispatch(decision);

    if (!shouldUseJobDispatch) {
      // Use legacy router
      return this.legacyRouter.processNext();
    }

    // Use job dispatch
    return this.dispatchViaJobSystem(task, decision);
  }

  /**
   * Determine if job dispatch should be used
   */
  private shouldUseJobDispatch(decision: OrgAwareDecision): boolean {
    // Must have used hierarchy
    if (!decision.usedHierarchy) {
      return false;
    }

    // Must have an assignment
    if (!decision.assignment) {
      return false;
    }

    // Check hierarchy depth
    const hierarchyStore = getAgentHierarchyStore();
    const agentProfile = hierarchyStore.get(decision.assignment.agentId);

    if (!agentProfile) {
      return false;
    }

    // Check minimum depth
    const chain = hierarchyStore.getEscalationChain(decision.assignment.agentId);
    if (chain.length < this.config.minHierarchyDepthForJobDispatch) {
      return false;
    }

    return true;
  }

  /**
   * Dispatch task via job system
   */
  private async dispatchViaJobSystem(
    task: TaskDTO,
    decision: OrgAwareDecision
  ): Promise<boolean> {
    const { taskService, eventService } = getServices();
    const dispatcher = getJobDispatcherService();

    logger.info({
      taskId: task.id,
      agentId: decision.assignment!.agentId,
      delegation: decision.delegation,
    }, 'Dispatching task via job system');

    try {
      // Queue the task first
      await taskService.queue(task.id);

      // Assign agent
      await taskService.assign(task.id, decision.assignment!.agentId);

      // Dispatch job
      const result = await dispatcher.dispatch(decision, task, {
        waitForCompletion: false, // Async dispatch
      });

      if (!result.dispatched) {
        // Dispatch failed - handle based on config
        logger.warn({
          taskId: task.id,
          error: result.error,
        }, 'Job dispatch failed');

        if (this.config.fallbackToLegacyOnFailure) {
          // Reset task status and use legacy router
          await taskService.queue(task.id);
          return this.legacyRouter.processNext();
        }

        // Fail the task
        await taskService.fail(task.id, result.error?.message || 'Job dispatch failed');
        return false;
      }

      // Job dispatched successfully
      await taskService.start(task.id);

      // Emit event
      await eventService.emit({
        type: EVENT_TYPE.TASK_STARTED,
        category: 'orchestrator',
        severity: 'info',
        message: `Task "${task.title}" dispatched via job system`,
        resourceType: 'task',
        resourceId: task.id,
        data: {
          jobId: result.jobId,
          sessionId: result.sessionId,
          usedJobDispatch: true,
          delegation: decision.delegation,
        },
      });

      // Handle response if we got one immediately
      if (result.response) {
        await this.handleJobResponse(task.id, result.response);
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, taskId: task.id }, 'Job dispatch error');

      if (this.config.fallbackToLegacyOnFailure) {
        // Try legacy router
        try {
          await taskService.queue(task.id);
          return this.legacyRouter.processNext();
        } catch {
          // Both paths failed
        }
      }

      await taskService.fail(task.id, message);
      return false;
    }
  }

  /**
   * Handle job response
   */
  private async handleJobResponse(taskId: string, response: JobResponse): Promise<void> {
    const { taskService, eventService } = getServices();

    switch (response.status) {
      case 'completed':
        await taskService.complete(taskId, {
          jobId: response.jobId,
          output: response.result?.output,
          data: response.result?.data,
          artifacts: response.result?.artifacts,
          toolsUsed: response.result?.toolsUsed,
        });

        logger.info({ taskId, jobId: response.jobId }, 'Task completed via job system');
        break;

      case 'failed':
        await taskService.fail(taskId, response.error?.message || 'Job execution failed');
        logger.error({ taskId, jobId: response.jobId, error: response.error }, 'Task failed via job system');
        break;

      case 'blocked':
        // Task blocked - emit event for UI/human intervention
        await eventService.emit({
          type: EVENT_TYPE.SYSTEM_WARNING,
          category: 'orchestrator',
          severity: 'warning',
          message: `Task blocked: ${response.blocked?.description}`,
          resourceType: 'task',
          resourceId: taskId,
          data: {
            jobId: response.jobId,
            blocked: response.blocked,
          },
        });

        logger.warn({
          taskId,
          jobId: response.jobId,
          reason: response.blocked?.reason,
          missing: response.blocked?.missing,
        }, 'Task blocked via job system');
        break;

      case 'cancelled':
        await taskService.cancel(taskId);
        break;

      case 'timeout':
        await taskService.fail(taskId, 'Job execution timed out');
        break;

      default:
        // pending, running - no action needed
        break;
    }
  }

  /**
   * Start the router (delegates to legacy + starts job monitoring)
   */
  start(): void {
    this.legacyRouter.start();
    logger.info({ config: this.config }, 'JobAwareTaskRouter started');
  }

  /**
   * Stop the router
   */
  stop(): void {
    this.legacyRouter.stop();
    logger.info('JobAwareTaskRouter stopped');
  }

  /**
   * Get status
   */
  getStatus(): {
    running: boolean;
    queueSize: number;
    processing: number;
    sequentialMode: boolean;
    batchesProcessing: number;
    jobDispatchEnabled: boolean;
    activeJobs: number;
  } {
    const legacyStatus = this.legacyRouter.getStatus();
    const dispatcher = getJobDispatcherService();

    return {
      ...legacyStatus,
      jobDispatchEnabled: this.config.useJobDispatchForOrgTasks,
      activeJobs: dispatcher.getActiveJobs().length,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<JobAwareConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'JobAwareTaskRouter config updated');
  }

  /**
   * Get legacy router for direct access when needed
   */
  getLegacyRouter(): TaskRouter {
    return this.legacyRouter;
  }
}

// Singleton
let instance: JobAwareTaskRouter | null = null;

export function getJobAwareTaskRouter(): JobAwareTaskRouter {
  if (!instance) {
    instance = new JobAwareTaskRouter();
  }
  return instance;
}

export function resetJobAwareTaskRouter(): void {
  instance = null;
}

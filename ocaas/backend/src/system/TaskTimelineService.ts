/**
 * TaskTimelineService
 *
 * Provides complete task traceability with timeline of events,
 * state changes, checkpoints, and operational insights.
 */

import { desc, eq, and, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { systemLogger } from '../utils/logger.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { getServices } from '../services/index.js';
import { getCheckpointStore } from '../orchestrator/resilience/index.js';
import { getHumanEscalationService, type EscalationDTO, ESCALATION_STATUS } from '../hitl/index.js';
import { TASK_STATUS } from '../config/constants.js';
import { NotFoundError } from '../utils/errors.js';
import type { EventDTO, TaskDTO } from '../types/domain.js';
import type { TaskCheckpoint } from '../orchestrator/resilience/types.js';

const logger = systemLogger.child({ component: 'TaskTimelineService' });

// =============================================================================
// TYPES
// =============================================================================

/** Single entry in a task's timeline */
export interface TimelineEntry {
  /** Unique identifier */
  id: string;
  /** Entry type */
  type: 'event' | 'state_change' | 'checkpoint' | 'error' | 'retry' | 'escalation' | 'approval' | 'resource';
  /** Timestamp */
  timestamp: number;
  /** Title/summary */
  title: string;
  /** Detailed description */
  description?: string;
  /** Severity for visual indication */
  severity: 'info' | 'warning' | 'error' | 'success';
  /** Additional metadata */
  data?: Record<string, unknown>;
  /** Source of this entry */
  source: 'event' | 'task' | 'checkpoint' | 'feedback';
}

/** Complete task timeline */
export interface TaskTimeline {
  /** Task ID */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Current task status */
  currentStatus: string;
  /** Current checkpoint stage (if any) */
  currentStage?: string;
  /** Timeline entries ordered chronologically */
  entries: TimelineEntry[];
  /** Summary statistics */
  summary: {
    totalEvents: number;
    stateChanges: number;
    errors: number;
    retries: number;
    escalations: number;
    durationMs: number;
    currentBlocker?: string;
  };
  /** Related resources */
  related: {
    agentId?: string;
    parentTaskId?: string;
    childTaskIds: string[];
    pendingApproval?: string;
    pendingResources: string[];
    pendingEscalations: string[];
  };
  /** Generated at */
  generatedAt: number;
}

/** Stuck task details */
export interface StuckTaskInfo {
  taskId: string;
  title: string;
  status: string;
  agentId?: string;
  stuckSinceMs: number;
  lastActivity: number;
  checkpointStage?: string;
  lastKnownBlocker?: string;
  suggestedAction: string;
}

/** High retry task details */
export interface HighRetryTaskInfo {
  taskId: string;
  title: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  pattern?: string;
  suggestedAction: string;
}

/** Blocked task details */
export interface BlockedTaskInfo {
  taskId: string;
  title: string;
  status: string;
  blockerType: 'approval' | 'resource' | 'dependency' | 'external' | 'escalation' | 'unknown';
  blockerDetails: string;
  blockedSinceMs: number;
  suggestedAction: string;
}

/** System overview */
export interface SystemOverview {
  /** Task distribution */
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    activeCount: number;
    problemCount: number;
  };
  /** Problem tasks */
  problems: {
    stuck: StuckTaskInfo[];
    highRetry: HighRetryTaskInfo[];
    blocked: BlockedTaskInfo[];
  };
  /** Recent activity (last hour) */
  recentActivity: {
    tasksCreated: number;
    tasksCompleted: number;
    tasksFailed: number;
    eventsEmitted: number;
  };
  /** Health indicators */
  health: {
    avgTaskDurationMs: number;
    successRate: number;
    errorRate: number;
  };
  /** Generated at */
  generatedAt: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

interface TimelineConfig {
  /** Time threshold for stuck tasks (ms) */
  stuckThresholdMs: number;
  /** Retry count threshold for high retry */
  highRetryThreshold: number;
  /** Max timeline entries to return */
  maxTimelineEntries: number;
  /** How far back to look for events (seconds) */
  eventLookbackSeconds: number;
}

const DEFAULT_CONFIG: TimelineConfig = {
  stuckThresholdMs: 30 * 60 * 1000, // 30 minutes
  highRetryThreshold: 3,
  maxTimelineEntries: 200,
  eventLookbackSeconds: 86400, // 24 hours
};

// =============================================================================
// SERVICE
// =============================================================================

export class TaskTimelineService {
  private config: TimelineConfig;

  constructor(config: Partial<TimelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // MAIN TIMELINE METHODS
  // ===========================================================================

  /**
   * Get complete timeline for a specific task
   */
  async getTaskTimeline(taskId: string): Promise<TaskTimeline | null> {
    const { taskService } = getServices();
    const checkpointStore = getCheckpointStore();

    // Get task
    let task: TaskDTO;
    try {
      task = await taskService.getById(taskId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        logger.warn({ taskId }, 'Task not found for timeline');
        return null;
      }
      throw err;
    }

    // Get checkpoint
    const checkpoint = checkpointStore.get(taskId);

    // Get events for this task
    const events = await this.getTaskEvents(taskId);

    // Get feedback for this task
    const feedback = await this.getTaskFeedback(taskId);

    // Get escalations for this task
    const escalations = await this.getTaskEscalations(taskId);

    // Get child tasks directly from DB
    const childTasks = await this.getChildTasks(taskId);

    // Build timeline entries
    const entries: TimelineEntry[] = [];

    // Task creation event
    entries.push({
      id: `task_created_${taskId}`,
      type: 'state_change',
      timestamp: task.createdAt,
      title: 'Task Created',
      description: `Task "${task.title}" created with priority ${task.priority}`,
      severity: 'info',
      data: { status: 'pending', priority: task.priority },
      source: 'task',
    });

    // Add events to timeline
    for (const event of events) {
      entries.push(this.eventToTimelineEntry(event));
    }

    // Add feedback to timeline
    for (const fb of feedback) {
      entries.push({
        id: `feedback_${fb.id}`,
        type: fb.type === 'error' ? 'error' : 'escalation',
        timestamp: fb.createdAt,
        title: fb.type === 'error' ? 'Error Reported' : `Feedback: ${fb.type}`,
        description: fb.message,
        severity: fb.type === 'error' ? 'error' : 'warning',
        data: { feedbackType: fb.type, requirement: fb.requirement },
        source: 'feedback',
      });
    }

    // Add escalations to timeline
    for (const esc of escalations) {
      entries.push(this.escalationToTimelineEntry(esc));
      // If escalation was resolved, add resolution entry
      if (esc.resolvedAt && esc.resolution) {
        entries.push({
          id: `esc_resolved_${esc.id}`,
          type: 'escalation',
          timestamp: esc.resolvedAt,
          title: `Escalation Resolved: ${esc.resolution}`,
          description: `Resolved by ${esc.resolvedBy}${esc.resolutionDetails ? `: ${JSON.stringify(esc.resolutionDetails)}` : ''}`,
          severity: esc.resolution === 'rejected' || esc.resolution === 'timed_out' ? 'warning' : 'success',
          data: { escalationId: esc.id, resolution: esc.resolution, resolvedBy: esc.resolvedBy },
          source: 'event',
        });
      }
    }

    // Add checkpoint info if exists
    if (checkpoint) {
      entries.push({
        id: `checkpoint_${taskId}`,
        type: 'checkpoint',
        timestamp: checkpoint.updatedAt,
        title: `Checkpoint: ${checkpoint.currentStage}`,
        description: `Progress: ${checkpoint.progressPercent}%${checkpoint.lastCompletedStep ? `, Last step: ${checkpoint.lastCompletedStep}` : ''}`,
        severity: checkpoint.currentStage === 'paused' || checkpoint.currentStage === 'retrying' ? 'warning' : 'info',
        data: {
          stage: checkpoint.currentStage,
          progress: checkpoint.progressPercent,
          retryCount: checkpoint.retryCount,
        },
        source: 'checkpoint',
      });
    }

    // Add status changes based on task updates
    if (task.startedAt) {
      entries.push({
        id: `task_started_${taskId}`,
        type: 'state_change',
        timestamp: task.startedAt,
        title: 'Task Started',
        description: task.agentId ? `Assigned to agent ${task.agentId}` : 'Execution started',
        severity: 'info',
        data: { status: 'running', agentId: task.agentId },
        source: 'task',
      });
    }

    if (task.completedAt) {
      const isError = task.status === TASK_STATUS.FAILED;
      entries.push({
        id: `task_completed_${taskId}`,
        type: isError ? 'error' : 'state_change',
        timestamp: task.completedAt,
        title: isError ? 'Task Failed' : 'Task Completed',
        description: isError ? task.error : 'Task completed successfully',
        severity: isError ? 'error' : 'success',
        data: { status: task.status, error: task.error },
        source: 'task',
      });
    }

    // Add retry entries
    if (task.retryCount > 0) {
      entries.push({
        id: `task_retries_${taskId}`,
        type: 'retry',
        timestamp: task.updatedAt,
        title: `Retry Count: ${task.retryCount}/${task.maxRetries}`,
        description: `Task has been retried ${task.retryCount} times`,
        severity: task.retryCount >= this.config.highRetryThreshold ? 'error' : 'warning',
        data: { retryCount: task.retryCount, maxRetries: task.maxRetries },
        source: 'task',
      });
    }

    // Sort by timestamp
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Limit entries
    const limitedEntries = entries.slice(-this.config.maxTimelineEntries);

    // Calculate summary
    const errors = entries.filter(e => e.type === 'error').length;
    const stateChanges = entries.filter(e => e.type === 'state_change').length;
    const escalationCount = escalations.length;
    const durationMs = task.completedAt
      ? (task.completedAt - task.createdAt) * 1000
      : (nowTimestamp() - task.createdAt) * 1000;

    // Get pending escalations
    const pendingEscalations = escalations
      .filter(e => e.status === ESCALATION_STATUS.PENDING || e.status === ESCALATION_STATUS.ACKNOWLEDGED)
      .map(e => e.id);

    return {
      taskId,
      taskTitle: task.title,
      currentStatus: task.status,
      currentStage: checkpoint?.currentStage,
      entries: limitedEntries,
      summary: {
        totalEvents: entries.length,
        stateChanges,
        errors,
        retries: task.retryCount,
        escalations: escalationCount,
        durationMs,
        currentBlocker: checkpoint?.lastKnownBlocker ?? undefined,
      },
      related: {
        agentId: task.agentId,
        parentTaskId: task.parentTaskId,
        childTaskIds: childTasks.map(t => t.id),
        pendingApproval: checkpoint?.pendingApproval ?? undefined,
        pendingResources: checkpoint?.pendingResources ?? [],
        pendingEscalations,
      },
      generatedAt: nowTimestamp(),
    };
  }

  // ===========================================================================
  // PROBLEM DETECTION
  // ===========================================================================

  /**
   * Get all stuck tasks (running too long without progress)
   */
  async getStuckTasks(): Promise<StuckTaskInfo[]> {
    const { taskService } = getServices();
    const checkpointStore = getCheckpointStore();
    const now = nowTimestamp();
    const thresholdSeconds = this.config.stuckThresholdMs / 1000;

    // Get running/assigned tasks
    const tasks = await taskService.list({});
    const activeTasks = tasks.filter(t =>
      t.status === TASK_STATUS.RUNNING || t.status === TASK_STATUS.ASSIGNED
    );

    const stuckTasks: StuckTaskInfo[] = [];

    for (const task of activeTasks) {
      const lastActivity = task.updatedAt;
      const stuckDuration = (now - lastActivity) * 1000;

      if (stuckDuration > this.config.stuckThresholdMs) {
        const checkpoint = checkpointStore.get(task.id);

        stuckTasks.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          agentId: task.agentId,
          stuckSinceMs: stuckDuration,
          lastActivity,
          checkpointStage: checkpoint?.currentStage,
          lastKnownBlocker: checkpoint?.lastKnownBlocker ?? undefined,
          suggestedAction: this.suggestStuckAction(task, checkpoint),
        });
      }
    }

    // Sort by stuck duration (longest first)
    stuckTasks.sort((a, b) => b.stuckSinceMs - a.stuckSinceMs);

    logger.info({ count: stuckTasks.length }, 'Found stuck tasks');
    return stuckTasks;
  }

  /**
   * Get tasks with high retry counts
   */
  async getHighRetryTasks(): Promise<HighRetryTaskInfo[]> {
    const { taskService } = getServices();

    const tasks = await taskService.list({});
    const highRetryTasks = tasks.filter(t =>
      t.retryCount >= this.config.highRetryThreshold &&
      t.status !== TASK_STATUS.COMPLETED &&
      t.status !== TASK_STATUS.CANCELLED
    );

    const result: HighRetryTaskInfo[] = [];

    for (const task of highRetryTasks) {
      // Try to detect a pattern from events
      const pattern = await this.detectRetryPattern(task.id);

      result.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        lastError: task.error,
        pattern,
        suggestedAction: this.suggestRetryAction(task, pattern),
      });
    }

    // Sort by retry count (highest first)
    result.sort((a, b) => b.retryCount - a.retryCount);

    logger.info({ count: result.length }, 'Found high retry tasks');
    return result;
  }

  /**
   * Get tasks that are blocked
   */
  async getBlockedTasks(): Promise<BlockedTaskInfo[]> {
    const { taskService } = getServices();
    const checkpointStore = getCheckpointStore();
    const now = nowTimestamp();

    const result: BlockedTaskInfo[] = [];

    // Get checkpoints in waiting states
    const waitingCheckpoints = checkpointStore.getWaitingExternal();

    for (const checkpoint of waitingCheckpoints) {
      let task: TaskDTO;
      try {
        task = await taskService.getById(checkpoint.taskId);
      } catch {
        continue;
      }

      const blockedDuration = (now - checkpoint.updatedAt) * 1000;
      const blockerType = this.determineBlockerType(checkpoint);
      const blockerDetails = this.getBlockerDetails(checkpoint);

      result.push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        blockerType,
        blockerDetails,
        blockedSinceMs: blockedDuration,
        suggestedAction: this.suggestBlockedAction(blockerType, checkpoint),
      });
    }

    // Also check for dependency-blocked tasks
    const pendingTasks = await taskService.list({ status: TASK_STATUS.PENDING });
    for (const pendingTask of pendingTasks) {
      if (pendingTask.dependsOn && pendingTask.dependsOn.length > 0) {
        const dependencies: (TaskDTO | null)[] = await Promise.all(
          pendingTask.dependsOn.map(async (id) => {
            try {
              return await taskService.getById(id);
            } catch {
              return null;
            }
          })
        );
        const pendingDeps = dependencies.filter((d): d is TaskDTO =>
          d !== null && d.status !== TASK_STATUS.COMPLETED
        );

        if (pendingDeps.length > 0) {
          result.push({
            taskId: pendingTask.id,
            title: pendingTask.title,
            status: pendingTask.status,
            blockerType: 'dependency',
            blockerDetails: `Waiting for ${pendingDeps.length} dependencies: ${pendingDeps.map(d => d.id).join(', ')}`,
            blockedSinceMs: (now - pendingTask.createdAt) * 1000,
            suggestedAction: 'Wait for dependencies to complete or cancel blocking tasks',
          });
        }
      }
    }

    // Check for escalation-blocked tasks (tasks with pending escalations)
    const escalationService = getHumanEscalationService();
    const inbox = await escalationService.getHumanInbox();
    const pendingEscalations = [...inbox.pending, ...inbox.acknowledged];

    for (const esc of pendingEscalations) {
      if (esc.taskId) {
        // Skip if already added
        if (result.some(r => r.taskId === esc.taskId)) continue;

        let task: TaskDTO;
        try {
          task = await taskService.getById(esc.taskId);
        } catch {
          continue;
        }

        const blockedDuration = (now - esc.createdAt) * 1000;

        result.push({
          taskId: task.id,
          title: task.title,
          status: task.status,
          blockerType: 'escalation',
          blockerDetails: `Awaiting human response: ${esc.reason} [${esc.type}]`,
          blockedSinceMs: blockedDuration,
          suggestedAction: `Respond to escalation ${esc.id} in human inbox`,
        });
      }
    }

    // Sort by blocked duration (longest first)
    result.sort((a, b) => b.blockedSinceMs - a.blockedSinceMs);

    logger.info({ count: result.length }, 'Found blocked tasks');
    return result;
  }

  // ===========================================================================
  // SYSTEM OVERVIEW
  // ===========================================================================

  /**
   * Get comprehensive system overview
   */
  async getSystemOverview(): Promise<SystemOverview> {
    const { taskService } = getServices();
    const now = nowTimestamp();
    const oneHourAgo = now - 3600;

    // Get all tasks
    const tasks = await taskService.list({});

    // Calculate task distribution
    const byStatus: Record<string, number> = {};
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    }

    const activeCount = tasks.filter(t =>
      t.status === TASK_STATUS.RUNNING ||
      t.status === TASK_STATUS.ASSIGNED ||
      t.status === TASK_STATUS.QUEUED
    ).length;

    // Get problems
    const [stuck, highRetry, blocked] = await Promise.all([
      this.getStuckTasks(),
      this.getHighRetryTasks(),
      this.getBlockedTasks(),
    ]);

    const problemCount = stuck.length + highRetry.length + blocked.length;

    // Recent activity
    const recentTasks = tasks.filter(t => t.createdAt >= oneHourAgo);
    const recentCompleted = tasks.filter(t =>
      t.status === TASK_STATUS.COMPLETED && t.completedAt && t.completedAt >= oneHourAgo
    );
    const recentFailed = tasks.filter(t =>
      t.status === TASK_STATUS.FAILED && t.completedAt && t.completedAt >= oneHourAgo
    );

    // Get recent events count
    const recentEvents = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .where(gte(schema.events.createdAt, oneHourAgo));
    const eventsEmitted = Number(recentEvents[0]?.count ?? 0);

    // Calculate health metrics
    const completedTasks = tasks.filter(t => t.status === TASK_STATUS.COMPLETED);
    const failedTasks = tasks.filter(t => t.status === TASK_STATUS.FAILED);
    const totalFinished = completedTasks.length + failedTasks.length;

    const avgTaskDurationMs = completedTasks.length > 0
      ? completedTasks.reduce((sum, t) => {
          const duration = (t.completedAt ?? t.updatedAt) - t.createdAt;
          return sum + duration * 1000;
        }, 0) / completedTasks.length
      : 0;

    const successRate = totalFinished > 0
      ? (completedTasks.length / totalFinished) * 100
      : 100;

    const errorRate = totalFinished > 0
      ? (failedTasks.length / totalFinished) * 100
      : 0;

    return {
      tasks: {
        total: tasks.length,
        byStatus,
        activeCount,
        problemCount,
      },
      problems: {
        stuck,
        highRetry,
        blocked,
      },
      recentActivity: {
        tasksCreated: recentTasks.length,
        tasksCompleted: recentCompleted.length,
        tasksFailed: recentFailed.length,
        eventsEmitted,
      },
      health: {
        avgTaskDurationMs: Math.round(avgTaskDurationMs),
        successRate: Math.round(successRate * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
      },
      generatedAt: now,
    };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private async getChildTasks(parentTaskId: string): Promise<Array<{ id: string }>> {
    const rows = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.parentTaskId, parentTaskId))
      .limit(100);
    return rows;
  }

  private async getTaskEvents(taskId: string): Promise<EventDTO[]> {
    const now = nowTimestamp();
    const lookbackTime = now - this.config.eventLookbackSeconds;

    const rows = await db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.resourceType, 'task'),
          eq(schema.events.resourceId, taskId),
          gte(schema.events.createdAt, lookbackTime)
        )
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(100);

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      category: row.category,
      severity: row.severity as EventDTO['severity'],
      message: row.message,
      resourceType: row.resourceType ?? undefined,
      resourceId: row.resourceId ?? undefined,
      agentId: row.agentId ?? undefined,
      data: parseJsonSafe(row.data),
      createdAt: row.createdAt,
    }));
  }

  private async getTaskFeedback(taskId: string): Promise<Array<{
    id: string;
    type: string;
    message: string;
    requirement?: string;
    createdAt: number;
  }>> {
    try {
      const rows = await db
        .select()
        .from(schema.agentFeedback)
        .where(eq(schema.agentFeedback.taskId, taskId))
        .orderBy(desc(schema.agentFeedback.createdAt))
        .limit(50);

      return rows.map(row => ({
        id: row.id,
        type: row.type,
        message: row.message,
        requirement: row.requirement ?? undefined,
        createdAt: row.createdAt,
      }));
    } catch {
      return [];
    }
  }

  private eventToTimelineEntry(event: EventDTO): TimelineEntry {
    let type: TimelineEntry['type'] = 'event';
    let severity: TimelineEntry['severity'] = 'info';

    // Determine type based on event type
    if (event.type.includes('error') || event.type.includes('failed')) {
      type = 'error';
      severity = 'error';
    } else if (event.type.includes('retry')) {
      type = 'retry';
      severity = 'warning';
    } else if (event.type.includes('escalat')) {
      type = 'escalation';
      severity = 'warning';
    } else if (event.type.includes('approval')) {
      type = 'approval';
      severity = 'info';
    } else if (event.type.includes('resource') || event.type.includes('skill') || event.type.includes('tool')) {
      type = 'resource';
      severity = 'info';
    } else if (event.type.includes('status') || event.type.includes('state') || event.type.includes('assigned')) {
      type = 'state_change';
      severity = 'info';
    } else if (event.type.includes('complet') || event.type.includes('success')) {
      type = 'state_change';
      severity = 'success';
    }

    // Map event severity to timeline severity
    if (event.severity === 'critical' || event.severity === 'error') {
      severity = 'error';
    } else if (event.severity === 'warning') {
      severity = 'warning';
    }

    return {
      id: event.id,
      type,
      timestamp: event.createdAt,
      title: event.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: event.message,
      severity,
      data: event.data,
      source: 'event',
    };
  }

  private suggestStuckAction(task: TaskDTO, checkpoint?: TaskCheckpoint | null): string {
    if (checkpoint?.lastKnownBlocker) {
      return `Investigate blocker: ${checkpoint.lastKnownBlocker}`;
    }
    if (checkpoint?.currentStage === 'waiting_approval') {
      return 'Check pending approvals and process them';
    }
    if (checkpoint?.currentStage === 'waiting_resource') {
      return 'Check pending resource drafts and approve/activate them';
    }
    if (task.agentId) {
      return `Check agent ${task.agentId} status and OpenClaw session health`;
    }
    return 'Review task execution logs and consider manual intervention';
  }

  private async detectRetryPattern(taskId: string): Promise<string | undefined> {
    const events = await this.getTaskEvents(taskId);
    const errorEvents = events.filter(e =>
      e.type.includes('error') || e.type.includes('failed')
    );

    if (errorEvents.length < 2) return undefined;

    // Look for common error patterns
    const errorMessages = errorEvents.map(e => e.message);
    const uniqueMessages = [...new Set(errorMessages)];

    if (uniqueMessages.length === 1) {
      return `Same error repeated: "${uniqueMessages[0]?.substring(0, 50)}..."`;
    }

    // Check for timeout patterns
    const timeoutErrors = errorMessages.filter(m =>
      m.toLowerCase().includes('timeout') || m.toLowerCase().includes('timed out')
    );
    if (timeoutErrors.length > errorMessages.length / 2) {
      return 'Frequent timeout errors';
    }

    // Check for connection patterns
    const connectionErrors = errorMessages.filter(m =>
      m.toLowerCase().includes('connection') || m.toLowerCase().includes('network')
    );
    if (connectionErrors.length > errorMessages.length / 2) {
      return 'Frequent connection errors';
    }

    return undefined;
  }

  private suggestRetryAction(task: TaskDTO, pattern?: string): string {
    if (pattern?.includes('timeout')) {
      return 'Consider increasing timeout limits or optimizing task execution';
    }
    if (pattern?.includes('connection')) {
      return 'Check network connectivity and OpenClaw gateway health';
    }
    if (task.retryCount >= task.maxRetries) {
      return 'Max retries reached - manual intervention required';
    }
    return 'Review error logs and consider adjusting task parameters';
  }

  private determineBlockerType(checkpoint: TaskCheckpoint): BlockedTaskInfo['blockerType'] {
    if (checkpoint.pendingApproval) return 'approval';
    if (checkpoint.pendingResources && checkpoint.pendingResources.length > 0) return 'resource';
    if (checkpoint.currentStage === 'waiting_external') return 'external';
    return 'unknown';
  }

  private getBlockerDetails(checkpoint: TaskCheckpoint): string {
    if (checkpoint.pendingApproval) {
      return `Waiting for approval: ${checkpoint.pendingApproval}`;
    }
    if (checkpoint.pendingResources && checkpoint.pendingResources.length > 0) {
      return `Waiting for resources: ${checkpoint.pendingResources.join(', ')}`;
    }
    if (checkpoint.lastKnownBlocker) {
      return checkpoint.lastKnownBlocker;
    }
    return `Blocked at stage: ${checkpoint.currentStage}`;
  }

  private suggestBlockedAction(blockerType: BlockedTaskInfo['blockerType'], checkpoint: TaskCheckpoint): string {
    switch (blockerType) {
      case 'approval':
        return `Process pending approval: ${checkpoint.pendingApproval}`;
      case 'resource':
        return 'Review and activate pending resource drafts';
      case 'dependency':
        return 'Wait for dependencies or consider cancelling blocking tasks';
      case 'external':
        return 'Check external system integration and retry';
      case 'escalation':
        return 'Check human inbox and respond to pending escalation';
      default:
        return 'Investigate blocker cause and take appropriate action';
    }
  }

  private async getTaskEscalations(taskId: string): Promise<EscalationDTO[]> {
    try {
      const escalationService = getHumanEscalationService();
      return await escalationService.getByTask(taskId);
    } catch {
      return [];
    }
  }

  private escalationToTimelineEntry(escalation: EscalationDTO): TimelineEntry {
    let severity: TimelineEntry['severity'] = 'warning';

    // Map priority to severity
    if (escalation.priority === 'critical') {
      severity = 'error';
    } else if (escalation.status === ESCALATION_STATUS.RESOLVED) {
      severity = 'success';
    } else if (escalation.status === ESCALATION_STATUS.EXPIRED) {
      severity = 'error';
    }

    // Build title
    const typeLabel = escalation.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const statusLabel = escalation.status.charAt(0).toUpperCase() + escalation.status.slice(1);

    return {
      id: `escalation_${escalation.id}`,
      type: 'escalation',
      timestamp: escalation.createdAt,
      title: `Escalation: ${typeLabel} [${statusLabel}]`,
      description: escalation.reason,
      severity,
      data: {
        escalationId: escalation.id,
        type: escalation.type,
        priority: escalation.priority,
        status: escalation.status,
        agentId: escalation.agentId,
        checkpointStage: escalation.checkpointStage,
        expiresAt: escalation.expiresAt,
        linkedApprovalId: escalation.linkedApprovalId,
        linkedFeedbackId: escalation.linkedFeedbackId,
      },
      source: 'event',
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let timelineInstance: TaskTimelineService | null = null;

export function getTaskTimelineService(): TaskTimelineService {
  if (!timelineInstance) {
    timelineInstance = new TaskTimelineService();
  }
  return timelineInstance;
}

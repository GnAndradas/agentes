/**
 * HumanEscalationService
 *
 * Central service for managing escalations to human ("DIOS").
 * Provides:
 * - Formal escalation creation and tracking
 * - Human inbox (pending actions)
 * - Resolution handling (approve, reject, provide_resource, override)
 * - Timeout management
 * - Integration with TaskTimeline
 */

import { nanoid } from 'nanoid';
import { eq, and, desc, lt, or, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger, auditLogger, logAuditEvent } from '../utils/logger.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { getServices } from '../services/index.js';
import { getCheckpointStore } from '../orchestrator/resilience/index.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import {
  ESCALATION_TYPE,
  ESCALATION_STATUS,
  ESCALATION_PRIORITY,
  RESOLUTION_TYPE,
  FALLBACK_ACTION,
  type EscalationType,
  type EscalationStatus,
  type EscalationPriority,
  type ResolutionType,
  type FallbackAction,
  type HumanEscalationRow,
} from '../db/schema/escalations.js';

const logger = createLogger('HumanEscalationService');
const audit = auditLogger.child({ component: 'HumanEscalationService' });

// =============================================================================
// TYPES
// =============================================================================

export interface EscalationDTO {
  id: string;
  type: EscalationType;
  priority: EscalationPriority;
  taskId?: string;
  agentId?: string;
  resourceType?: string;
  resourceId?: string;
  reason: string;
  context?: Record<string, unknown>;
  checkpointStage?: string;
  status: EscalationStatus;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolution?: ResolutionType;
  resolutionDetails?: Record<string, unknown>;
  resolvedAt?: number;
  resolvedBy?: string;
  expiresAt?: number;
  fallbackAction?: FallbackAction;
  linkedApprovalId?: string;
  linkedFeedbackId?: string;
  linkedGenerationId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEscalationInput {
  type: EscalationType;
  priority?: EscalationPriority;
  taskId?: string;
  agentId?: string;
  resourceType?: string;
  resourceId?: string;
  reason: string;
  context?: Record<string, unknown>;
  checkpointStage?: string;
  expiresIn?: number; // milliseconds from now
  fallbackAction?: FallbackAction;
  linkedApprovalId?: string;
  linkedFeedbackId?: string;
  linkedGenerationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ResolveEscalationInput {
  resolution: ResolutionType;
  resolvedBy: string;
  details?: Record<string, unknown>;
}

export interface HumanInbox {
  pending: EscalationDTO[];
  acknowledged: EscalationDTO[];
  summary: {
    totalPending: number;
    totalAcknowledged: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    oldestPendingAge?: number; // ms since oldest pending
    expiringCount: number; // count expiring within 5 min
  };
}

export interface EscalationStats {
  total: number;
  pending: number;
  acknowledged: number;
  resolved: number;
  expired: number;
  byType: Record<string, number>;
  byResolution: Record<string, number>;
  avgResolutionTimeMs: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function rowToDTO(row: HumanEscalationRow): EscalationDTO {
  return {
    id: row.id,
    type: row.type as EscalationType,
    priority: row.priority as EscalationPriority,
    taskId: row.taskId ?? undefined,
    agentId: row.agentId ?? undefined,
    resourceType: row.resourceType ?? undefined,
    resourceId: row.resourceId ?? undefined,
    reason: row.reason,
    context: parseJsonSafe(row.context),
    checkpointStage: row.checkpointStage ?? undefined,
    status: row.status as EscalationStatus,
    acknowledgedAt: row.acknowledgedAt ?? undefined,
    acknowledgedBy: row.acknowledgedBy ?? undefined,
    resolution: row.resolution as ResolutionType | undefined,
    resolutionDetails: parseJsonSafe(row.resolutionDetails),
    resolvedAt: row.resolvedAt ?? undefined,
    resolvedBy: row.resolvedBy ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    fallbackAction: row.fallbackAction as FallbackAction | undefined,
    linkedApprovalId: row.linkedApprovalId ?? undefined,
    linkedFeedbackId: row.linkedFeedbackId ?? undefined,
    linkedGenerationId: row.linkedGenerationId ?? undefined,
    metadata: parseJsonSafe(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// =============================================================================
// SERVICE
// =============================================================================

export class HumanEscalationService {
  // ===========================================================================
  // ESCALATION CREATION
  // ===========================================================================

  /**
   * Create a new escalation to human
   */
  async escalate(input: CreateEscalationInput): Promise<EscalationDTO> {
    const { eventService } = getServices();
    const autonomyConfig = getAutonomyConfig();
    const now = nowTimestamp();
    const id = `esc_${nanoid()}`;

    // Calculate expiration
    const expiresIn = input.expiresIn ?? autonomyConfig.humanTimeout;
    const expiresAt = expiresIn > 0 ? now + Math.floor(expiresIn / 1000) : undefined;

    // Default fallback based on autonomy config
    const fallbackAction = input.fallbackAction ?? this.mapFallbackBehavior(autonomyConfig.fallbackBehavior);

    // Get checkpoint stage if taskId provided
    let checkpointStage = input.checkpointStage;
    if (input.taskId && !checkpointStage) {
      const checkpoint = getCheckpointStore().get(input.taskId);
      checkpointStage = checkpoint?.currentStage;
    }

    // Insert escalation
    await db.insert(schema.humanEscalations).values({
      id,
      type: input.type,
      priority: input.priority ?? ESCALATION_PRIORITY.NORMAL,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      reason: input.reason,
      context: input.context ? JSON.stringify(input.context) : null,
      checkpointStage: checkpointStage ?? null,
      status: ESCALATION_STATUS.PENDING,
      expiresAt: expiresAt ?? null,
      fallbackAction: fallbackAction ?? null,
      linkedApprovalId: input.linkedApprovalId ?? null,
      linkedFeedbackId: input.linkedFeedbackId ?? null,
      linkedGenerationId: input.linkedGenerationId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    const escalation = await this.getById(id);

    logger.warn({
      escalationId: id,
      type: input.type,
      priority: input.priority ?? 'normal',
      taskId: input.taskId,
      reason: input.reason,
    }, 'Human escalation created');

    // Emit event
    await eventService.emit({
      type: EVENT_TYPE.ORG_HUMAN_NOTIFIED,
      category: 'escalation',
      severity: input.priority === ESCALATION_PRIORITY.CRITICAL ? 'critical' : 'warning',
      message: `Human escalation: ${input.reason}`,
      resourceType: 'escalation',
      resourceId: id,
      data: {
        escalationType: input.type,
        priority: input.priority ?? 'normal',
        taskId: input.taskId,
        agentId: input.agentId,
        expiresAt,
      },
    });

    // Update checkpoint if task-related
    if (input.taskId) {
      const checkpointStore = getCheckpointStore();
      checkpointStore.updateBlocker(input.taskId, `Escalated to human: ${input.reason}`);
    }

    // Audit log
    logAuditEvent({
      action: 'escalation.create',
      actor: 'system',
      actorId: input.agentId ?? 'orchestrator',
      resourceType: 'escalation',
      resourceId: id,
      outcome: 'success',
      details: { type: input.type, taskId: input.taskId, reason: input.reason },
    });

    return escalation;
  }

  /**
   * Escalate for approval requirement
   */
  async escalateForApproval(
    approvalId: string,
    taskId?: string,
    reason?: string
  ): Promise<EscalationDTO> {
    const { approvalService } = getServices();
    const approval = await approvalService.getById(approvalId);

    return this.escalate({
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      taskId,
      resourceType: approval.type,
      resourceId: approval.resourceId,
      reason: reason ?? `Approval required for ${approval.type}: ${approval.resourceId}`,
      linkedApprovalId: approvalId,
      context: { approvalType: approval.type, metadata: approval.metadata },
    });
  }

  /**
   * Escalate for missing resource
   */
  async escalateForMissingResource(
    taskId: string,
    resourceType: string,
    requirement: string,
    feedbackId?: string
  ): Promise<EscalationDTO> {
    return this.escalate({
      type: ESCALATION_TYPE.RESOURCE_MISSING,
      priority: ESCALATION_PRIORITY.HIGH,
      taskId,
      resourceType,
      reason: `Missing ${resourceType}: ${requirement}`,
      linkedFeedbackId: feedbackId,
      context: { requirement },
    });
  }

  /**
   * Escalate for execution failure
   */
  async escalateForFailure(
    taskId: string,
    error: string,
    retryCount: number
  ): Promise<EscalationDTO> {
    const priority = retryCount >= 3 ? ESCALATION_PRIORITY.HIGH : ESCALATION_PRIORITY.NORMAL;

    return this.escalate({
      type: ESCALATION_TYPE.EXECUTION_FAILURE,
      priority,
      taskId,
      reason: `Execution failed after ${retryCount} retries: ${error}`,
      context: { error, retryCount },
    });
  }

  /**
   * Escalate for uncertainty/ambiguity
   */
  async escalateForUncertainty(
    taskId: string,
    agentId: string,
    question: string,
    options?: string[]
  ): Promise<EscalationDTO> {
    return this.escalate({
      type: ESCALATION_TYPE.UNCERTAINTY,
      priority: ESCALATION_PRIORITY.NORMAL,
      taskId,
      agentId,
      reason: question,
      context: { options },
    });
  }

  /**
   * Escalate for blocked task
   */
  async escalateForBlocked(
    taskId: string,
    agentId: string,
    reason: string,
    feedbackId?: string
  ): Promise<EscalationDTO> {
    return this.escalate({
      type: ESCALATION_TYPE.BLOCKED,
      priority: ESCALATION_PRIORITY.HIGH,
      taskId,
      agentId,
      reason,
      linkedFeedbackId: feedbackId,
    });
  }

  // ===========================================================================
  // HUMAN INBOX
  // ===========================================================================

  /**
   * Get human inbox with pending and acknowledged escalations
   */
  async getHumanInbox(): Promise<HumanInbox> {
    const now = nowTimestamp();
    const fiveMinutes = 5 * 60;

    // Get pending escalations
    const pendingRows = await db
      .select()
      .from(schema.humanEscalations)
      .where(eq(schema.humanEscalations.status, ESCALATION_STATUS.PENDING))
      .orderBy(
        // Priority order: critical > high > normal > low
        sql`CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END`,
        schema.humanEscalations.createdAt
      );

    // Get acknowledged escalations
    const acknowledgedRows = await db
      .select()
      .from(schema.humanEscalations)
      .where(eq(schema.humanEscalations.status, ESCALATION_STATUS.ACKNOWLEDGED))
      .orderBy(desc(schema.humanEscalations.acknowledgedAt));

    const pending = pendingRows.map(rowToDTO);
    const acknowledged = acknowledgedRows.map(rowToDTO);

    // Calculate summary
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const esc of pending) {
      byType[esc.type] = (byType[esc.type] || 0) + 1;
      byPriority[esc.priority] = (byPriority[esc.priority] || 0) + 1;
    }

    const oldestPending = pending[pending.length - 1];
    const oldestPendingAge = oldestPending ? (now - oldestPending.createdAt) * 1000 : undefined;

    const expiringCount = pending.filter(e =>
      e.expiresAt && (e.expiresAt - now) < fiveMinutes
    ).length;

    return {
      pending,
      acknowledged,
      summary: {
        totalPending: pending.length,
        totalAcknowledged: acknowledged.length,
        byType,
        byPriority,
        oldestPendingAge,
        expiringCount,
      },
    };
  }

  /**
   * Get all pending human actions (simplified alias)
   */
  async getPendingHumanActions(): Promise<EscalationDTO[]> {
    const inbox = await this.getHumanInbox();
    return [...inbox.pending, ...inbox.acknowledged];
  }

  // ===========================================================================
  // ACKNOWLEDGMENT
  // ===========================================================================

  /**
   * Acknowledge an escalation (human has seen it)
   */
  async acknowledge(id: string, acknowledgedBy: string): Promise<EscalationDTO> {
    const current = await this.getById(id);

    if (current.status !== ESCALATION_STATUS.PENDING) {
      if (current.status === ESCALATION_STATUS.ACKNOWLEDGED) {
        return current; // Idempotent
      }
      throw new Error(`Cannot acknowledge escalation in status '${current.status}'`);
    }

    const now = nowTimestamp();

    await db
      .update(schema.humanEscalations)
      .set({
        status: ESCALATION_STATUS.ACKNOWLEDGED,
        acknowledgedAt: now,
        acknowledgedBy,
        updatedAt: now,
      })
      .where(eq(schema.humanEscalations.id, id));

    logger.info({ escalationId: id, acknowledgedBy }, 'Escalation acknowledged');

    return this.getById(id);
  }

  // ===========================================================================
  // RESOLUTION
  // ===========================================================================

  /**
   * Resolve an escalation
   */
  async resolve(id: string, input: ResolveEscalationInput): Promise<EscalationDTO> {
    const { eventService } = getServices();
    const current = await this.getById(id);

    if (current.status === ESCALATION_STATUS.RESOLVED) {
      return current; // Idempotent
    }

    if (current.status === ESCALATION_STATUS.EXPIRED || current.status === ESCALATION_STATUS.CANCELLED) {
      throw new Error(`Cannot resolve escalation in status '${current.status}'`);
    }

    const now = nowTimestamp();

    await db
      .update(schema.humanEscalations)
      .set({
        status: ESCALATION_STATUS.RESOLVED,
        resolution: input.resolution,
        resolutionDetails: input.details ? JSON.stringify(input.details) : null,
        resolvedAt: now,
        resolvedBy: input.resolvedBy,
        updatedAt: now,
      })
      .where(eq(schema.humanEscalations.id, id));

    const resolved = await this.getById(id);

    logger.info({
      escalationId: id,
      resolution: input.resolution,
      resolvedBy: input.resolvedBy,
    }, 'Escalation resolved');

    // Emit event
    await eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'escalation',
      message: `Escalation ${id} resolved: ${input.resolution}`,
      resourceType: 'escalation',
      resourceId: id,
      data: {
        resolution: input.resolution,
        resolvedBy: input.resolvedBy,
        taskId: current.taskId,
      },
    });

    // Audit log
    logAuditEvent({
      action: 'escalation.resolve',
      actor: 'user',
      actorId: input.resolvedBy,
      resourceType: 'escalation',
      resourceId: id,
      outcome: 'success',
      details: { resolution: input.resolution, taskId: current.taskId },
    });

    // Handle linked resources based on resolution
    await this.handleResolution(resolved, input);

    return resolved;
  }

  /**
   * Approve the escalated request
   */
  async approve(id: string, approvedBy: string, details?: Record<string, unknown>): Promise<EscalationDTO> {
    const escalation = await this.getById(id);

    // If linked to approval, approve that too
    if (escalation.linkedApprovalId) {
      const { approvalService } = getServices();
      await approvalService.approve(escalation.linkedApprovalId, approvedBy);
    }

    return this.resolve(id, {
      resolution: RESOLUTION_TYPE.APPROVED,
      resolvedBy: approvedBy,
      details,
    });
  }

  /**
   * Reject the escalated request
   */
  async reject(id: string, rejectedBy: string, reason?: string): Promise<EscalationDTO> {
    const escalation = await this.getById(id);

    // If linked to approval, reject that too
    if (escalation.linkedApprovalId) {
      const { approvalService } = getServices();
      await approvalService.reject(escalation.linkedApprovalId, rejectedBy, reason);
    }

    return this.resolve(id, {
      resolution: RESOLUTION_TYPE.REJECTED,
      resolvedBy: rejectedBy,
      details: { reason },
    });
  }

  /**
   * Provide a resource to resolve the escalation
   */
  async provideResource(
    id: string,
    providedBy: string,
    resourceId: string,
    resourceType: string
  ): Promise<EscalationDTO> {
    return this.resolve(id, {
      resolution: RESOLUTION_TYPE.RESOURCE_PROVIDED,
      resolvedBy: providedBy,
      details: { resourceId, resourceType },
    });
  }

  /**
   * Override the decision (human takes control)
   */
  async override(
    id: string,
    overriddenBy: string,
    decision: string,
    details?: Record<string, unknown>
  ): Promise<EscalationDTO> {
    return this.resolve(id, {
      resolution: RESOLUTION_TYPE.OVERRIDDEN,
      resolvedBy: overriddenBy,
      details: { decision, ...details },
    });
  }

  // ===========================================================================
  // TIMEOUT HANDLING
  // ===========================================================================

  /**
   * Process expired escalations
   */
  async processExpired(): Promise<number> {
    const now = nowTimestamp();

    // Find expired pending/acknowledged escalations
    const expiredRows = await db
      .select()
      .from(schema.humanEscalations)
      .where(
        and(
          or(
            eq(schema.humanEscalations.status, ESCALATION_STATUS.PENDING),
            eq(schema.humanEscalations.status, ESCALATION_STATUS.ACKNOWLEDGED)
          ),
          isNotNull(schema.humanEscalations.expiresAt),
          lt(schema.humanEscalations.expiresAt, now)
        )
      );

    let processed = 0;

    for (const row of expiredRows) {
      const escalation = rowToDTO(row);
      await this.handleExpired(escalation);
      processed++;
    }

    if (processed > 0) {
      logger.info({ processed }, 'Processed expired escalations');
    }

    return processed;
  }

  private async handleExpired(escalation: EscalationDTO): Promise<void> {
    const { eventService, taskService } = getServices();
    const now = nowTimestamp();

    // Mark as expired
    await db
      .update(schema.humanEscalations)
      .set({
        status: ESCALATION_STATUS.EXPIRED,
        resolution: RESOLUTION_TYPE.TIMED_OUT,
        resolvedAt: now,
        resolvedBy: 'system:timeout',
        updatedAt: now,
      })
      .where(eq(schema.humanEscalations.id, escalation.id));

    logger.warn({
      escalationId: escalation.id,
      fallbackAction: escalation.fallbackAction,
    }, 'Escalation expired');

    // Emit event
    await eventService.emit({
      type: EVENT_TYPE.SYSTEM_WARNING,
      category: 'escalation',
      severity: 'warning',
      message: `Escalation ${escalation.id} expired (no human response)`,
      resourceType: 'escalation',
      resourceId: escalation.id,
      data: {
        type: escalation.type,
        taskId: escalation.taskId,
        fallbackAction: escalation.fallbackAction,
      },
    });

    // Execute fallback action
    if (escalation.fallbackAction && escalation.taskId) {
      await this.executeFallback(escalation);
    }
  }

  private async executeFallback(escalation: EscalationDTO): Promise<void> {
    const { taskService } = getServices();
    const checkpointStore = getCheckpointStore();

    switch (escalation.fallbackAction) {
      case FALLBACK_ACTION.RETRY:
        // Re-queue the task for retry
        if (escalation.taskId) {
          await taskService.incrementRetry(escalation.taskId);
          checkpointStore.updateBlocker(escalation.taskId, null);
          logger.info({ taskId: escalation.taskId }, 'Fallback: retrying task');
        }
        break;

      case FALLBACK_ACTION.FAIL:
        // Fail the task
        if (escalation.taskId) {
          await taskService.fail(escalation.taskId, 'Escalation timeout - no human response');
          logger.info({ taskId: escalation.taskId }, 'Fallback: failing task');
        }
        break;

      case FALLBACK_ACTION.AUTO_APPROVE:
        // Auto-approve if linked to approval
        if (escalation.linkedApprovalId) {
          const { approvalService } = getServices();
          await approvalService.approve(escalation.linkedApprovalId, 'system:auto_approve');
          logger.info({ approvalId: escalation.linkedApprovalId }, 'Fallback: auto-approved');
        }
        break;

      case FALLBACK_ACTION.ESCALATE_HIGHER:
        // Create a higher priority escalation
        await this.escalate({
          type: escalation.type,
          priority: ESCALATION_PRIORITY.CRITICAL,
          taskId: escalation.taskId,
          agentId: escalation.agentId,
          reason: `URGENT: Previous escalation timed out - ${escalation.reason}`,
          context: { previousEscalationId: escalation.id, ...escalation.context },
          fallbackAction: FALLBACK_ACTION.FAIL, // Don't infinite loop
        });
        logger.info({ taskId: escalation.taskId }, 'Fallback: escalated to higher priority');
        break;

      case FALLBACK_ACTION.PAUSE:
      default:
        // Keep task paused
        if (escalation.taskId) {
          checkpointStore.markPaused(escalation.taskId, 'Escalation timeout - awaiting manual review');
          logger.info({ taskId: escalation.taskId }, 'Fallback: task paused');
        }
        break;
    }
  }

  // ===========================================================================
  // QUERIES
  // ===========================================================================

  async getById(id: string): Promise<EscalationDTO> {
    const rows = await db
      .select()
      .from(schema.humanEscalations)
      .where(eq(schema.humanEscalations.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(`Escalation not found: ${id}`);
    }

    return rowToDTO(rows[0]!);
  }

  async getByTask(taskId: string): Promise<EscalationDTO[]> {
    const rows = await db
      .select()
      .from(schema.humanEscalations)
      .where(eq(schema.humanEscalations.taskId, taskId))
      .orderBy(desc(schema.humanEscalations.createdAt));

    return rows.map(rowToDTO);
  }

  async list(opts?: {
    status?: EscalationStatus;
    type?: EscalationType;
    priority?: EscalationPriority;
    taskId?: string;
    limit?: number;
  }): Promise<EscalationDTO[]> {
    const conditions = [];

    if (opts?.status) conditions.push(eq(schema.humanEscalations.status, opts.status));
    if (opts?.type) conditions.push(eq(schema.humanEscalations.type, opts.type));
    if (opts?.priority) conditions.push(eq(schema.humanEscalations.priority, opts.priority));
    if (opts?.taskId) conditions.push(eq(schema.humanEscalations.taskId, opts.taskId));

    let query = db.select().from(schema.humanEscalations);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const rows = await query
      .orderBy(desc(schema.humanEscalations.createdAt))
      .limit(opts?.limit ?? 100);

    return rows.map(rowToDTO);
  }

  async getStats(): Promise<EscalationStats> {
    const rows = await db.select().from(schema.humanEscalations);
    const all = rows.map(rowToDTO);

    const byType: Record<string, number> = {};
    const byResolution: Record<string, number> = {};
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const esc of all) {
      byType[esc.type] = (byType[esc.type] || 0) + 1;
      if (esc.resolution) {
        byResolution[esc.resolution] = (byResolution[esc.resolution] || 0) + 1;
      }
      if (esc.resolvedAt && esc.createdAt) {
        totalResolutionTime += (esc.resolvedAt - esc.createdAt) * 1000;
        resolvedCount++;
      }
    }

    return {
      total: all.length,
      pending: all.filter(e => e.status === ESCALATION_STATUS.PENDING).length,
      acknowledged: all.filter(e => e.status === ESCALATION_STATUS.ACKNOWLEDGED).length,
      resolved: all.filter(e => e.status === ESCALATION_STATUS.RESOLVED).length,
      expired: all.filter(e => e.status === ESCALATION_STATUS.EXPIRED).length,
      byType,
      byResolution,
      avgResolutionTimeMs: resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount) : 0,
    };
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = nowTimestamp() - Math.floor(maxAgeMs / 1000);

    const result = await db
      .delete(schema.humanEscalations)
      .where(
        and(
          or(
            eq(schema.humanEscalations.status, ESCALATION_STATUS.RESOLVED),
            eq(schema.humanEscalations.status, ESCALATION_STATUS.EXPIRED),
            eq(schema.humanEscalations.status, ESCALATION_STATUS.CANCELLED)
          ),
          lt(schema.humanEscalations.updatedAt, cutoff)
        )
      );

    logger.info({ maxAgeMs }, 'Cleaned up old escalations');
    return 0; // SQLite doesn't return count
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private mapFallbackBehavior(behavior: string): FallbackAction {
    switch (behavior) {
      case 'pause': return FALLBACK_ACTION.PAUSE;
      case 'reject': return FALLBACK_ACTION.FAIL;
      case 'auto_approve': return FALLBACK_ACTION.AUTO_APPROVE;
      default: return FALLBACK_ACTION.PAUSE;
    }
  }

  private async handleResolution(
    escalation: EscalationDTO,
    input: ResolveEscalationInput
  ): Promise<void> {
    const checkpointStore = getCheckpointStore();
    const { taskService } = getServices();

    // Clear blocker if task-related and approved/resource_provided
    if (escalation.taskId) {
      if (input.resolution === RESOLUTION_TYPE.APPROVED ||
          input.resolution === RESOLUTION_TYPE.RESOURCE_PROVIDED ||
          input.resolution === RESOLUTION_TYPE.OVERRIDDEN) {
        // Clear blocker and re-queue task
        checkpointStore.updateBlocker(escalation.taskId, null);

        // If task was waiting, re-queue it
        try {
          const task = await taskService.getById(escalation.taskId);
          if (task.status === 'pending' || task.status === 'queued') {
            // Task can be processed
            logger.info({ taskId: escalation.taskId }, 'Task can continue after escalation resolved');
          }
        } catch {
          // Task may have been deleted
        }
      }
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: HumanEscalationService | null = null;

export function getHumanEscalationService(): HumanEscalationService {
  if (!instance) {
    instance = new HumanEscalationService();
  }
  return instance;
}

// Re-export types for convenience
export {
  ESCALATION_TYPE,
  ESCALATION_STATUS,
  ESCALATION_PRIORITY,
  RESOLUTION_TYPE,
  FALLBACK_ACTION,
};

import { nanoid } from 'nanoid';
import { eq, and, desc, lt } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { getServices } from '../../services/index.js';
import { getActionExecutor } from '../ActionExecutor.js';
import { getAutonomyConfig } from '../../config/autonomy.js';
import { EVENT_TYPE } from '../../config/constants.js';
import { db } from '../../db/index.js';
import { agentFeedback, type AgentFeedbackRow } from '../../db/schema/feedback.js';
import {
  FEEDBACK_TYPE,
  feedbackToActionType,
  type AgentFeedback,
  type CreateFeedbackInput,
  type FeedbackType,
} from './types.js';
import type { SuggestedAction, MissingCapabilityReport } from '../types.js';

const logger = createLogger('FeedbackService');

// Track processed feedback per task to avoid duplicates (in-memory for performance)
const processedPerTask = new Map<string, Set<string>>();

// Cooldown to prevent spam (taskId:type -> last feedback timestamp)
const feedbackCooldown = new Map<string, number>();
const COOLDOWN_MS = 5000; // 5 seconds between same-type feedback per task

/**
 * Convert DB row to AgentFeedback
 */
function rowToFeedback(row: AgentFeedbackRow): AgentFeedback {
  return {
    id: row.id,
    type: row.type as FeedbackType,
    agentId: row.agentId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? undefined,
    message: row.message,
    requirement: row.requirement ?? undefined,
    context: row.context ? JSON.parse(row.context) : undefined,
    createdAt: row.createdAt,
    processed: row.processed,
    processingResult: row.processingResult ? JSON.parse(row.processingResult) : undefined,
  };
}

export class FeedbackService {
  /**
   * Receive feedback from an agent
   * This is the main entry point for agent-reported issues
   */
  async receiveFeedback(input: CreateFeedbackInput): Promise<AgentFeedback> {
    const { eventService } = getServices();

    // Check cooldown to prevent spam
    const cooldownKey = `${input.taskId}:${input.type}`;
    const lastFeedback = feedbackCooldown.get(cooldownKey);
    const now = Date.now();

    if (lastFeedback && now - lastFeedback < COOLDOWN_MS) {
      logger.debug({ taskId: input.taskId, type: input.type }, 'Feedback cooldown active, skipping');
      // Return existing feedback without processing again
      const existing = (await this.getByTask(input.taskId)).find(f => f.type === input.type && !f.processed);
      if (existing) return existing;
      // If no existing unprocessed feedback, still skip during cooldown
      // Create a minimal feedback record to return without processing
      const skippedFeedback: AgentFeedback = {
        id: nanoid(),
        type: input.type,
        agentId: input.agentId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        message: input.message,
        requirement: input.requirement,
        context: input.context,
        createdAt: now,
        processed: true,
        processingResult: { error: 'Cooldown active - skipped' },
      };
      return skippedFeedback;
    }

    feedbackCooldown.set(cooldownKey, now);

    // Create feedback record
    const feedback: AgentFeedback = {
      id: nanoid(),
      type: input.type,
      agentId: input.agentId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      message: input.message,
      requirement: input.requirement,
      context: input.context,
      createdAt: now,
      processed: false,
    };

    // Persist to DB
    try {
      await db.insert(agentFeedback).values({
        id: feedback.id,
        type: feedback.type,
        agentId: feedback.agentId,
        taskId: feedback.taskId,
        sessionId: feedback.sessionId ?? null,
        message: feedback.message,
        requirement: feedback.requirement ?? null,
        context: feedback.context ? JSON.stringify(feedback.context) : null,
        processed: false,
        processingResult: null,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, feedbackId: feedback.id }, 'Failed to persist feedback to DB');
      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_ERROR,
        category: 'orchestrator',
        severity: 'error',
        message: `Failed to persist feedback: ${errorMsg}`,
        resourceType: 'task',
        resourceId: feedback.taskId,
        data: { feedbackId: feedback.id, error: errorMsg },
      });
      // Continue processing even if DB fails
    }

    logger.info({
      feedbackId: feedback.id,
      type: feedback.type,
      agentId: feedback.agentId,
      taskId: feedback.taskId,
      requirement: feedback.requirement,
    }, 'Agent feedback received');

    // Emit specific event based on feedback type
    const eventType = this.getEventTypeForFeedback(feedback.type);
    await eventService.emit({
      type: eventType,
      category: 'orchestrator',
      severity: feedback.type === FEEDBACK_TYPE.BLOCKED ? 'warning' : 'info',
      message: `Agent ${feedback.agentId}: ${feedback.message}`,
      resourceType: 'task',
      resourceId: feedback.taskId,
      data: {
        feedbackId: feedback.id,
        type: feedback.type,
        agentId: feedback.agentId,
        requirement: feedback.requirement,
        context: feedback.context,
      },
    });

    // Process feedback (may trigger actions)
    await this.processFeedback(feedback);

    return feedback;
  }

  /**
   * Process feedback and potentially trigger actions via ActionExecutor
   */
  private async processFeedback(feedback: AgentFeedback): Promise<void> {
    const autonomyConfig = getAutonomyConfig();
    const actionExecutor = getActionExecutor();
    const { eventService } = getServices();

    // Check if we already processed similar feedback for this task
    const taskProcessed = processedPerTask.get(feedback.taskId) || new Set();
    const feedbackKey = `${feedback.type}:${feedback.requirement || 'general'}`;

    if (taskProcessed.has(feedbackKey)) {
      logger.debug({ taskId: feedback.taskId, feedbackKey }, 'Similar feedback already processed for this task');
      await this.markProcessed(feedback.id, { error: 'Duplicate feedback - already processed' });
      feedback.processed = true;
      feedback.processingResult = { error: 'Duplicate feedback - already processed' };
      return;
    }

    // In manual mode, just log and wait for human
    if (autonomyConfig.level === 'manual') {
      logger.info({ feedbackId: feedback.id }, 'Manual mode - feedback logged, awaiting human intervention');
      await this.markProcessed(feedback.id, { error: 'Manual mode - requires human intervention' });
      feedback.processed = true;
      feedback.processingResult = { error: 'Manual mode - requires human intervention' };
      return;
    }

    // Map feedback to action type
    const actionType = feedbackToActionType(feedback.type);

    if (!actionType) {
      // Blocked or cannot_continue - needs human attention
      logger.warn({
        feedbackId: feedback.id,
        type: feedback.type,
        message: feedback.message,
      }, 'Feedback requires human intervention');

      await eventService.emit({
        type: EVENT_TYPE.SYSTEM_WARNING,
        category: 'orchestrator',
        severity: 'warning',
        message: `Agent blocked on task "${feedback.taskId}": ${feedback.message}`,
        resourceType: 'task',
        resourceId: feedback.taskId,
        data: { feedbackId: feedback.id, type: feedback.type },
      });

      await this.markProcessed(feedback.id, { error: 'Requires human intervention' });
      feedback.processed = true;
      feedback.processingResult = { error: 'Requires human intervention' };
      return;
    }

    // Check if there's already a pending generation for this task
    if (actionExecutor.hasPendingGeneration(feedback.taskId)) {
      logger.debug({ taskId: feedback.taskId }, 'Task already has pending generation, skipping feedback action');
      await this.markProcessed(feedback.id, { error: 'Generation already pending' });
      feedback.processed = true;
      feedback.processingResult = { error: 'Generation already pending' };
      return;
    }

    // Build MissingCapabilityReport from feedback
    const resourceType = actionType === 'create_agent' ? 'agent' : actionType === 'create_skill' ? 'skill' : 'tool';
    const missingReport: MissingCapabilityReport = {
      taskId: feedback.taskId,
      createdAt: Date.now(),
      missingCapabilities: feedback.requirement ? [feedback.requirement] : ['unknown'],
      suggestions: [{
        type: resourceType,
        name: feedback.requirement || `auto_${feedback.type}`,
        description: feedback.message,
        reason: `Agent feedback: ${feedback.message}`,
        canAutoGenerate: true,
        priority: 'required',
      }],
      requiresApproval: autonomyConfig.level === 'supervised',
    };

    // Build suggested action
    const suggestedAction: SuggestedAction = {
      action: actionType,
      reason: `Agent feedback: ${feedback.message}`,
      metadata: {
        name: feedback.requirement || `auto_${feedback.type}_${nanoid(4)}`,
        description: feedback.message,
        feedbackId: feedback.id,
        agentId: feedback.agentId,
      },
    };

    // Execute via ActionExecutor (reuses existing loop)
    try {
      const results = await actionExecutor.executeActions(
        feedback.taskId,
        missingReport,
        [suggestedAction]
      );

      const result = results[0];
      if (result) {
        const processingResult = {
          action: result.action,
          generationId: result.generationId,
          approvalId: result.approvalId,
          error: result.success ? undefined : result.error,
        };

        await this.markProcessed(feedback.id, processingResult);
        feedback.processed = true;
        feedback.processingResult = processingResult;

        // Mark as processed to avoid duplicates
        taskProcessed.add(feedbackKey);
        processedPerTask.set(feedback.taskId, taskProcessed);

        logger.info({
          feedbackId: feedback.id,
          action: result.action,
          success: result.success,
          generationId: result.generationId,
          approvalId: result.approvalId,
        }, 'Feedback processed via ActionExecutor');
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, feedbackId: feedback.id }, 'Failed to process feedback');
      await this.markProcessed(feedback.id, { error });
      feedback.processed = true;
      feedback.processingResult = { error };
    }
  }

  /**
   * Mark feedback as processed in DB
   */
  private async markProcessed(
    feedbackId: string,
    result: { action?: string; generationId?: string; approvalId?: string; error?: string }
  ): Promise<void> {
    try {
      await db.update(agentFeedback)
        .set({
          processed: true,
          processingResult: JSON.stringify(result),
          updatedAt: Date.now(),
        })
        .where(eq(agentFeedback.id, feedbackId));
    } catch (err) {
      logger.error({ err, feedbackId }, 'Failed to mark feedback as processed in DB');
      // Non-critical - continue execution
    }
  }

  /**
   * Get event type for feedback type
   */
  private getEventTypeForFeedback(type: FeedbackType): string {
    switch (type) {
      case FEEDBACK_TYPE.MISSING_TOOL:
        return EVENT_TYPE.AGENT_MISSING_TOOL;
      case FEEDBACK_TYPE.MISSING_SKILL:
        return EVENT_TYPE.AGENT_MISSING_SKILL;
      case FEEDBACK_TYPE.MISSING_CAPABILITY:
        return EVENT_TYPE.AGENT_MISSING_CAPABILITY;
      case FEEDBACK_TYPE.BLOCKED:
        return EVENT_TYPE.AGENT_BLOCKED;
      case FEEDBACK_TYPE.CANNOT_CONTINUE:
        return EVENT_TYPE.AGENT_BLOCKED;
      default:
        return EVENT_TYPE.AGENT_FEEDBACK_RECEIVED;
    }
  }

  /**
   * Get feedback by ID
   */
  async getById(id: string): Promise<AgentFeedback | null> {
    try {
      const rows = await db.select()
        .from(agentFeedback)
        .where(eq(agentFeedback.id, id))
        .limit(1);

      const row = rows[0];
      if (!row) return null;
      return rowToFeedback(row);
    } catch (err) {
      logger.error({ err, feedbackId: id }, 'Failed to get feedback by ID from DB');
      return null;
    }
  }

  /**
   * Get all feedback for a task
   */
  async getByTask(taskId: string): Promise<AgentFeedback[]> {
    try {
      const rows = await db.select()
        .from(agentFeedback)
        .where(eq(agentFeedback.taskId, taskId))
        .orderBy(desc(agentFeedback.createdAt));

      return rows.map(rowToFeedback);
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to get feedback by task from DB');
      return [];
    }
  }

  /**
   * Get unprocessed feedback
   */
  async getUnprocessed(): Promise<AgentFeedback[]> {
    try {
      const rows = await db.select()
        .from(agentFeedback)
        .where(eq(agentFeedback.processed, false))
        .orderBy(agentFeedback.createdAt);

      return rows.map(rowToFeedback);
    } catch (err) {
      logger.error({ err }, 'Failed to get unprocessed feedback from DB');
      return [];
    }
  }

  /**
   * Get all feedback (with optional filters)
   */
  async getAll(filters?: { taskId?: string; type?: string; processed?: boolean }): Promise<AgentFeedback[]> {
    try {
      // Build conditions
      const conditions = [];
      if (filters?.taskId) {
        conditions.push(eq(agentFeedback.taskId, filters.taskId));
      }
      if (filters?.type) {
        conditions.push(eq(agentFeedback.type, filters.type));
      }
      if (filters?.processed !== undefined) {
        conditions.push(eq(agentFeedback.processed, filters.processed));
      }

      let rows;
      if (conditions.length > 0) {
        rows = await db.select()
          .from(agentFeedback)
          .where(and(...conditions))
          .orderBy(desc(agentFeedback.createdAt));
      } else {
        rows = await db.select()
          .from(agentFeedback)
          .orderBy(desc(agentFeedback.createdAt));
      }

      return rows.map(rowToFeedback);
    } catch (err) {
      logger.error({ err, filters }, 'Failed to get feedback from DB');
      return [];
    }
  }

  /**
   * Clear old feedback (older than 1 hour)
   */
  async cleanupOld(): Promise<number> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;

    try {
      // Delete old processed feedback from DB
      const result = await db.delete(agentFeedback)
        .where(and(
          eq(agentFeedback.processed, true),
          lt(agentFeedback.createdAt, oneHourAgo)
        ));

      // Note: SQLite doesn't return affected rows count reliably,
      // so we just log success
      cleaned = 1; // Simplified - actual count not available

      // Cleanup in-memory processedPerTask
      for (const [taskId] of processedPerTask.entries()) {
        const taskFeedback = await this.getByTask(taskId);
        if (taskFeedback.length === 0) {
          processedPerTask.delete(taskId);
        }
      }

      logger.info('Cleaned up old feedback from DB');
    } catch (err) {
      logger.error({ err }, 'Failed to cleanup old feedback from DB');
    }

    return cleaned;
  }

  /**
   * Clear feedback for a completed task
   */
  async clearForTask(taskId: string): Promise<void> {
    try {
      await db.delete(agentFeedback)
        .where(eq(agentFeedback.taskId, taskId));

      logger.debug({ taskId }, 'Cleared feedback for task from DB');
    } catch (err) {
      logger.error({ err, taskId }, 'Failed to clear feedback for task from DB');
    }

    // Clear in-memory tracking
    processedPerTask.delete(taskId);

    // Clear all cooldown entries for this task (keys are taskId:type)
    for (const key of feedbackCooldown.keys()) {
      if (key.startsWith(`${taskId}:`)) {
        feedbackCooldown.delete(key);
      }
    }
  }
}

let feedbackServiceInstance: FeedbackService | null = null;

export function getFeedbackService(): FeedbackService {
  if (!feedbackServiceInstance) {
    feedbackServiceInstance = new FeedbackService();
  }
  return feedbackServiceInstance;
}

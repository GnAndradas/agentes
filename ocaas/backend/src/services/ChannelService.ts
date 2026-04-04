import { createLogger } from '../utils/logger.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { TaskService } from './TaskService.js';
import type { TaskDTO, TaskPriority } from '../types/domain.js';
import type { TaskRouter } from '../orchestrator/TaskRouter.js';

const logger = createLogger('ChannelService');

// ============================================================================
// Types
// ============================================================================

export type ChannelType = 'telegram' | 'whatsapp' | 'web' | 'api' | 'slack' | 'discord';

export interface ChannelIngestInput {
  channel: ChannelType;
  userId: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelTaskResult {
  taskId: string;
  status: string;
  title: string;
}

export interface ChannelResponsePayload {
  taskId: string;
  channel: ChannelType;
  userId: string;
  response: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Service
// ============================================================================

/**
 * ChannelService: Bridge between external channels and OCAAS task system
 *
 * Responsibilities:
 * - Normalize input from different channels
 * - Transform message → task input
 * - Create tasks via TaskService
 * - Emit events for responses
 */
export class ChannelService {
  private taskRouter: TaskRouter | null = null;

  constructor(
    private taskService: TaskService,
    private eventService: EventService
  ) {}

  /**
   * Set the TaskRouter reference (injected after init to avoid circular deps)
   */
  setTaskRouter(router: TaskRouter): void {
    this.taskRouter = router;
  }

  /**
   * Ingest a message from an external channel and create a task
   */
  async ingest(input: ChannelIngestInput): Promise<ChannelTaskResult> {
    // Normalize and validate input
    const normalized = this.normalizeInput(input);

    // Create task
    const task = await this.taskService.create({
      title: normalized.title,
      description: normalized.description,
      type: 'channel_request',
      priority: normalized.priority,
      metadata: {
        source: 'channel',
        channel: normalized.channel,
        userId: normalized.userId,
        originalMessage: normalized.message,
        ingestedAt: Date.now(),
        ...normalized.metadata,
      },
    });

    logger.info({
      taskId: task.id,
      channel: normalized.channel,
      userId: normalized.userId,
      messageLength: normalized.message.length,
    }, 'Channel message ingested as task');

    // Submit to TaskRouter for processing (unified entry point)
    if (this.taskRouter) {
      await this.taskRouter.submit(task, 'channel', {
        sourceChannel: normalized.channel,
      });
      logger.debug({ taskId: task.id }, 'Task submitted to TaskRouter');
    } else {
      logger.warn({ taskId: task.id }, 'TaskRouter not set - task created but not submitted');
    }

    // Emit ingest event
    await this.eventService.emit({
      type: EVENT_TYPE.CHANNEL_INGEST,
      category: 'channel',
      severity: 'info',
      message: `Message from ${normalized.channel} ingested as task`,
      resourceType: 'task',
      resourceId: task.id,
      data: {
        channel: normalized.channel,
        userId: normalized.userId,
        taskId: task.id,
      },
    });

    return {
      taskId: task.id,
      status: task.status,
      title: task.title,
    };
  }

  /**
   * Normalize input from channel
   */
  private normalizeInput(input: ChannelIngestInput): {
    channel: ChannelType;
    userId: string;
    message: string;
    title: string;
    description: string;
    priority: TaskPriority;
    metadata?: Record<string, unknown>;
  } {
    const message = input.message.trim();

    // Extract title: first 80 chars, cut at word boundary if possible
    let title = message.substring(0, 80);
    if (message.length > 80) {
      const lastSpace = title.lastIndexOf(' ');
      if (lastSpace > 40) {
        title = title.substring(0, lastSpace);
      }
      title += '...';
    }

    // Detect priority from message content
    const priority = this.detectPriority(message, input.metadata);

    return {
      channel: input.channel,
      userId: input.userId,
      message,
      title,
      description: message,
      priority,
      metadata: input.metadata,
    };
  }

  /**
   * Detect priority from message content or metadata
   */
  private detectPriority(message: string, metadata?: Record<string, unknown>): TaskPriority {
    // Check metadata for explicit priority
    if (metadata?.priority && typeof metadata.priority === 'number') {
      const p = metadata.priority as number;
      if (p >= 1 && p <= 4) return p as TaskPriority;
    }

    // Detect urgency keywords
    const lowerMessage = message.toLowerCase();
    const urgentKeywords = ['urgent', 'urgente', 'asap', 'critical', 'emergency', 'now'];
    const highKeywords = ['important', 'importante', 'priority', 'prioridad'];

    if (urgentKeywords.some(k => lowerMessage.includes(k))) {
      return 1; // Critical
    }
    if (highKeywords.some(k => lowerMessage.includes(k))) {
      return 2; // High
    }

    return 3; // Normal
  }

  /**
   * Emit response ready event when a channel task completes
   * Called by TaskService or TaskRouter when task completes
   */
  async emitResponseReady(task: TaskDTO): Promise<void> {
    // Only for channel tasks
    if (task.metadata?.source !== 'channel') {
      return;
    }

    const channel = task.metadata.channel as ChannelType;
    const userId = task.metadata.userId as string;

    if (!channel || !userId) {
      logger.warn({ taskId: task.id }, 'Channel task missing channel or userId metadata');
      return;
    }

    // Build response from task output
    const response = this.buildResponse(task);

    const payload: ChannelResponsePayload = {
      taskId: task.id,
      channel,
      userId,
      response,
      metadata: task.metadata,
    };

    await this.eventService.emit({
      type: EVENT_TYPE.CHANNEL_RESPONSE_READY,
      category: 'channel',
      severity: 'info',
      message: `Response ready for ${channel} user ${userId}`,
      resourceType: 'task',
      resourceId: task.id,
      data: payload as unknown as Record<string, unknown>,
    });

    logger.info({
      taskId: task.id,
      channel,
      userId,
      responseLength: response.length,
    }, 'Channel response ready event emitted');
  }

  /**
   * Build response string from task output
   */
  private buildResponse(task: TaskDTO): string {
    if (task.status === 'failed') {
      return `Lo siento, hubo un error procesando tu solicitud: ${task.error || 'Error desconocido'}`;
    }

    if (task.status === 'cancelled') {
      return 'Tu solicitud fue cancelada.';
    }

    // Extract response from output
    if (task.output?.response) {
      return String(task.output.response);
    }

    if (task.output?.result) {
      return String(task.output.result);
    }

    // Default response
    return `Tarea completada: ${task.title}`;
  }

  /**
   * Get tasks for a specific channel user
   */
  async getTasksForUser(channel: ChannelType, userId: string, limit = 10): Promise<TaskDTO[]> {
    // Get all tasks and filter by channel/userId
    // Note: In production, this should be a proper DB query
    const allTasks = await this.taskService.list({ limit: 100 });

    return allTasks
      .filter(t =>
        t.metadata?.source === 'channel' &&
        t.metadata?.channel === channel &&
        t.metadata?.userId === userId
      )
      .slice(0, limit);
  }
}

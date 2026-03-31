import { createLogger } from '../utils/logger.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { EventDTO } from '../types/domain.js';
import type { ChannelResponsePayload, ChannelType } from './ChannelService.js';
import { getOpenClawAdapter } from '../integrations/openclaw/index.js';

const logger = createLogger('ChannelBridge');

// Task completion events that may require channel response
const TASK_COMPLETION_EVENTS: string[] = [
  EVENT_TYPE.TASK_COMPLETED,
  EVENT_TYPE.TASK_FAILED,
  EVENT_TYPE.TASK_CANCELLED,
];

/**
 * ChannelBridge: Routes responses back to external channels via OpenClaw
 *
 * Listens for:
 * - CHANNEL_RESPONSE_READY: Explicit channel response event
 * - TASK_COMPLETED/FAILED/CANCELLED: Auto-detect channel tasks and send response
 *
 * Flow:
 * 1. Task completes → TaskService emits TASK_COMPLETED
 * 2. ChannelBridge detects channel task (metadata.source === 'channel')
 * 3. ChannelBridge uses ChannelService.emitResponseReady()
 * 4. ChannelService emits CHANNEL_RESPONSE_READY
 * 5. ChannelBridge receives and sends to OpenClaw webhook
 * 6. OpenClaw delivers to actual channel (Telegram, etc.)
 */
export class ChannelBridge {
  private unsubscribe?: () => void;
  private channelServiceGetter: (() => { emitResponseReady: (task: EventDTO['data']) => Promise<void> }) | null = null;

  constructor(private eventService: EventService) {}

  /**
   * Set the getter for ChannelService (avoids circular dependency)
   */
  setChannelServiceGetter(getter: () => { emitResponseReady: (task: EventDTO['data']) => Promise<void> }): void {
    this.channelServiceGetter = getter;
  }

  /**
   * Start listening for channel response events
   */
  start(): void {
    // Subscribe to all events and filter by type
    this.unsubscribe = this.eventService.subscribe((event: EventDTO) => {
      if (event.type === EVENT_TYPE.CHANNEL_RESPONSE_READY) {
        this.handleResponseReady(event);
      } else if (TASK_COMPLETION_EVENTS.includes(event.type)) {
        this.handleTaskCompletion(event);
      }
    });

    logger.info('ChannelBridge started - listening for task and channel events');
  }

  /**
   * Stop listening
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    logger.info('ChannelBridge stopped');
  }

  /**
   * Handle task completion events - check if channel task and emit response
   */
  private async handleTaskCompletion(event: EventDTO): Promise<void> {
    // Event data contains taskId in resourceId
    const taskId = event.resourceId;
    if (!taskId) return;

    // We need to fetch the task to check if it's a channel task
    // This is done via ChannelService.emitResponseReady which does the check
    if (!this.channelServiceGetter) {
      logger.warn('ChannelService getter not set, cannot process task completion');
      return;
    }

    try {
      // Import dynamically to avoid circular dependencies
      const { getServices } = await import('./index.js');
      const { taskService, channelService } = getServices();

      const task = await taskService.getById(taskId);
      if (task.metadata?.source === 'channel') {
        // This is a channel task - emit response ready event
        await channelService.emitResponseReady(task);
        logger.debug({ taskId, status: task.status }, 'Triggered channel response for completed task');
      }
    } catch (error) {
      logger.error({ error, taskId }, 'Failed to process task completion for channel');
    }
  }

  /**
   * Handle CHANNEL_RESPONSE_READY event
   */
  private async handleResponseReady(event: EventDTO): Promise<void> {
    const payload = event.data as unknown as ChannelResponsePayload;

    if (!payload || !payload.channel || !payload.userId || !payload.response) {
      logger.warn({ event }, 'Invalid channel response payload');
      return;
    }

    logger.info({
      taskId: payload.taskId,
      channel: payload.channel,
      userId: payload.userId,
      responseLength: payload.response.length,
    }, 'Routing response to channel');

    try {
      await this.sendToChannel(payload);
    } catch (error) {
      logger.error({
        error,
        taskId: payload.taskId,
        channel: payload.channel,
      }, 'Failed to send response to channel');
    }
  }

  /**
   * Send response to the appropriate channel via OpenClaw
   */
  private async sendToChannel(payload: ChannelResponsePayload): Promise<void> {
    const adapter = getOpenClawAdapter();

    // Format message with user context
    const formattedMessage = this.formatMessage(payload);

    // Map OCAAS channel type to OpenClaw channel
    const openclawChannel = this.mapToOpenClawChannel(payload.channel);

    // Send via OpenClaw adapter
    const result = await adapter.notifyChannel({
      channel: openclawChannel,
      message: formattedMessage,
      userId: payload.userId,
    });

    if (result.success) {
      logger.info({
        taskId: payload.taskId,
        channel: payload.channel,
        openclawChannel,
      }, 'Response sent to channel via OpenClaw');
    } else {
      logger.warn({
        taskId: payload.taskId,
        channel: payload.channel,
        error: result.error,
      }, 'Failed to send response via OpenClaw - gateway may be offline');
    }
  }

  /**
   * Format the response message for the channel
   */
  private formatMessage(payload: ChannelResponsePayload): string {
    // Simple format - can be extended per channel type
    return payload.response;
  }

  /**
   * Map OCAAS channel type to OpenClaw channel identifier
   */
  private mapToOpenClawChannel(channel: ChannelType): string {
    // OpenClaw currently supports 'telegram' as primary channel
    // Future: add mappings for other channels as OpenClaw supports them
    const channelMap: Record<ChannelType, string> = {
      telegram: 'telegram',
      whatsapp: 'whatsapp',
      web: 'web',
      api: 'api',
      slack: 'slack',
      discord: 'discord',
    };

    return channelMap[channel] || 'telegram';
  }
}

let bridgeInstance: ChannelBridge | null = null;

export function initChannelBridge(eventService: EventService): ChannelBridge {
  if (!bridgeInstance) {
    bridgeInstance = new ChannelBridge(eventService);
    bridgeInstance.start();
  }
  return bridgeInstance;
}

export function getChannelBridge(): ChannelBridge | null {
  return bridgeInstance;
}

export function shutdownChannelBridge(): void {
  if (bridgeInstance) {
    bridgeInstance.stop();
    bridgeInstance = null;
  }
}

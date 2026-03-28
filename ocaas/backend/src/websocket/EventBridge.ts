import { getServices } from '../services/index.js';
import { getSocketManager } from './SocketManager.js';
import { createLogger } from '../utils/logger.js';
import type { EventType } from '../config/constants.js';
import type { WSEvent } from './types.js';

const logger = createLogger('EventBridge');

export class EventBridge {
  private isRunning = false;

  start(): void {
    if (this.isRunning) {
      return;
    }

    const { eventService } = getServices();

    // Subscribe to all events and forward to WebSocket
    eventService.subscribe((event) => {
      this.forwardEvent(event.type as EventType, event.resourceType ?? null, event.resourceId ?? null, event.data);
    });

    this.isRunning = true;
    logger.info('EventBridge started');
  }

  stop(): void {
    this.isRunning = false;
    logger.info('EventBridge stopped');
  }

  private forwardEvent(
    type: EventType,
    entityType: string | null,
    entityId: string | null,
    payload: unknown
  ): void {
    const socketManager = getSocketManager();

    // Determine channels to broadcast to
    const channels = this.getChannelsForEvent(type, entityType, entityId);

    const wsEvent: WSEvent = {
      type,
      channel: channels[0] || 'system',
      payload: {
        entityType,
        entityId,
        data: payload,
      },
      timestamp: Date.now(),
    };

    // Broadcast to all relevant channels
    for (const channel of channels) {
      wsEvent.channel = channel;
      socketManager.emitToChannel(channel, wsEvent);
    }

    logger.debug({ type, channels }, 'Event forwarded to WebSocket');
  }

  private getChannelsForEvent(
    type: EventType,
    entityType: string | null,
    entityId: string | null
  ): string[] {
    const channels: string[] = [];

    // Add entity-specific channel
    if (entityType && entityId) {
      channels.push(`${entityType}:${entityId}`);
    }

    // Add entity type channel
    if (entityType) {
      channels.push(entityType);
    }

    // Add type-based channels (EVENT_TYPE uses 'agent.created' format)
    if (type.startsWith('agent.')) {
      channels.push('agents');
    } else if (type.startsWith('task.')) {
      channels.push('tasks');
    } else if (type.startsWith('generation.')) {
      channels.push('generations');
    } else if (type.startsWith('system.') || type.startsWith('openclaw.')) {
      channels.push('system');
    } else if (type.startsWith('skill.')) {
      channels.push('skills');
    } else if (type.startsWith('tool.')) {
      channels.push('tools');
    }

    // Always include general channel
    if (!channels.includes('system')) {
      channels.push('system');
    }

    return [...new Set(channels)];
  }

  // Manual event emission helpers
  emitAgentEvent(
    type: EventType,
    agentId: string,
    data: unknown
  ): void {
    this.forwardEvent(type, 'agent', agentId, data);
  }

  emitTaskEvent(
    type: EventType,
    taskId: string,
    data: unknown
  ): void {
    this.forwardEvent(type, 'task', taskId, data);
  }

  emitGenerationEvent(
    type: EventType,
    generationId: string,
    data: unknown
  ): void {
    this.forwardEvent(type, 'generation', generationId, data);
  }

  emitSystemEvent(type: EventType, data: unknown): void {
    this.forwardEvent(type, null, null, data);
  }
}

let eventBridgeInstance: EventBridge | null = null;

export function getEventBridge(): EventBridge {
  if (!eventBridgeInstance) {
    eventBridgeInstance = new EventBridge();
  }
  return eventBridgeInstance;
}

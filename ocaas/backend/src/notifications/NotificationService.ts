import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';
import { TelegramChannel } from './TelegramChannel.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from '../services/EventService.js';
import type {
  NotificationChannel,
  NotificationMessage,
  NotificationPriority,
  NotificationAction,
} from './types.js';

const logger = createLogger('NotificationService');

export interface SendNotificationInput {
  title: string;
  body: string;
  priority?: NotificationPriority;
  actions?: NotificationAction[];
  approvalId?: string;
  resourceType?: string;
  resourceId?: string;
  data?: Record<string, unknown>;
}

export class NotificationService {
  private channels: NotificationChannel[] = [];
  private eventService: EventService;

  constructor(eventService: EventService, telegramBotToken?: string, telegramChatId?: string) {
    this.eventService = eventService;

    // Initialize Telegram channel
    const telegram = new TelegramChannel(telegramBotToken, telegramChatId);
    this.channels.push(telegram);

    logger.info(
      { telegramConfigured: telegram.isConfigured() },
      'NotificationService initialized'
    );
  }

  async send(input: SendNotificationInput): Promise<{ sent: boolean; channels: string[] }> {
    const message: NotificationMessage = {
      id: nanoid(),
      title: input.title,
      body: input.body,
      priority: input.priority ?? 'normal',
      actions: input.actions,
      approvalId: input.approvalId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      data: input.data,
    };

    const sentChannels: string[] = [];
    let anySent = false;

    // Try each channel in order
    for (const channel of this.channels) {
      if (!channel.isConfigured()) {
        continue;
      }

      try {
        const sent = await channel.send(message);
        if (sent) {
          sentChannels.push(channel.name);
          anySent = true;
          break; // Stop after first successful send
        }
      } catch (err) {
        logger.error({ err, channel: channel.name }, 'Channel send failed');
      }
    }

    // Fallback: emit WebSocket event if no external channel worked
    if (!anySent) {
      await this.emitWebSocketNotification(message);
      sentChannels.push('websocket');
      anySent = true;
    }

    logger.info(
      { messageId: message.id, channels: sentChannels, priority: message.priority },
      'Notification processed'
    );

    return { sent: anySent, channels: sentChannels };
  }

  private async emitWebSocketNotification(message: NotificationMessage): Promise<void> {
    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'notification',
      severity: message.priority === 'urgent' ? 'critical' :
               message.priority === 'high' ? 'warning' : 'info',
      message: message.title,
      resourceType: message.resourceType,
      resourceId: message.resourceId,
      data: {
        notificationId: message.id,
        body: message.body,
        actions: message.actions,
        approvalId: message.approvalId,
        priority: message.priority,
      },
    });
  }

  // Convenience methods
  async notifyApprovalRequired(
    approvalId: string,
    type: string,
    resourceId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.send({
      title: `Aprobación requerida: ${type}`,
      body: `Se requiere aprobación humana para ${type} (${resourceId})`,
      priority: 'high',
      actions: ['approve', 'reject'],
      approvalId,
      resourceType: type,
      resourceId,
      data: metadata,
    });
  }

  async notifyApprovalExpiring(
    approvalId: string,
    type: string,
    expiresIn: number
  ): Promise<void> {
    const minutes = Math.round(expiresIn / 60000);
    await this.send({
      title: `Aprobación expira pronto`,
      body: `La aprobación para ${type} expira en ${minutes} minutos`,
      priority: 'urgent',
      actions: ['approve', 'reject'],
      approvalId,
      resourceType: 'approval',
      resourceId: approvalId,
    });
  }

  async notifyTaskCompleted(taskId: string, title: string, result: string): Promise<void> {
    await this.send({
      title: `Tarea completada: ${title}`,
      body: result,
      priority: 'normal',
      resourceType: 'task',
      resourceId: taskId,
    });
  }

  async notifyTaskFailed(taskId: string, title: string, error: string): Promise<void> {
    await this.send({
      title: `Tarea fallida: ${title}`,
      body: error,
      priority: 'high',
      resourceType: 'task',
      resourceId: taskId,
    });
  }

  async notifySystemAlert(title: string, message: string): Promise<void> {
    await this.send({
      title,
      body: message,
      priority: 'urgent',
      resourceType: 'system',
    });
  }

  getConfiguredChannels(): string[] {
    return this.channels
      .filter((ch) => ch.isConfigured())
      .map((ch) => ch.name);
  }
}

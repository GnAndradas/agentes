import { createLogger } from '../utils/logger.js';
import type {
  NotificationChannel,
  NotificationMessage,
  TelegramConfig,
  NotificationAction,
} from './types.js';

const logger = createLogger('TelegramChannel');

export class TelegramChannel implements NotificationChannel {
  name = 'telegram';
  private config: TelegramConfig | null = null;

  constructor(botToken?: string, chatId?: string) {
    if (botToken && chatId) {
      this.config = { botToken, chatId };
    }
  }

  isConfigured(): boolean {
    return this.config !== null && this.config.botToken.length > 0 && this.config.chatId.length > 0;
  }

  configure(botToken: string, chatId: string): void {
    this.config = { botToken, chatId };
  }

  async send(message: NotificationMessage): Promise<boolean> {
    if (!this.isConfigured() || !this.config) {
      logger.debug('Telegram not configured, skipping');
      return false;
    }

    try {
      const text = this.formatMessage(message);
      const inlineKeyboard = this.buildInlineKeyboard(message);

      const payload: Record<string, unknown> = {
        chat_id: this.config.chatId,
        text,
        parse_mode: 'HTML',
      };

      if (inlineKeyboard.length > 0) {
        payload.reply_markup = {
          inline_keyboard: inlineKeyboard,
        };
      }

      const response = await fetch(
        `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.error({ error, status: response.status }, 'Telegram API error');
        return false;
      }

      logger.info({ messageId: message.id }, 'Telegram notification sent');
      return true;
    } catch (err) {
      logger.error({ err }, 'Failed to send Telegram notification');
      return false;
    }
  }

  private formatMessage(message: NotificationMessage): string {
    const priorityEmoji = this.getPriorityEmoji(message.priority);
    const lines: string[] = [
      `${priorityEmoji} <b>${this.escapeHtml(message.title)}</b>`,
      '',
      this.escapeHtml(message.body),
    ];

    if (message.resourceType && message.resourceId) {
      lines.push('');
      lines.push(`<code>${message.resourceType}: ${message.resourceId}</code>`);
    }

    return lines.join('\n');
  }

  private getPriorityEmoji(priority: NotificationMessage['priority']): string {
    switch (priority) {
      case 'urgent':
        return '🚨';
      case 'high':
        return '⚠️';
      case 'normal':
        return '📋';
      case 'low':
        return 'ℹ️';
      default:
        return '📋';
    }
  }

  private buildInlineKeyboard(message: NotificationMessage): Array<Array<{ text: string; callback_data: string }>> {
    if (!message.actions || message.actions.length === 0 || !message.approvalId) {
      return [];
    }

    const buttons = message.actions.map((action) => ({
      text: this.getActionLabel(action),
      callback_data: JSON.stringify({
        action,
        approvalId: message.approvalId,
      }),
    }));

    return [buttons];
  }

  private getActionLabel(action: NotificationAction): string {
    switch (action) {
      case 'approve':
        return '✅ Aprobar';
      case 'reject':
        return '❌ Rechazar';
      case 'view':
        return '👁 Ver';
      case 'dismiss':
        return '🔕 Descartar';
      default:
        return action;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Parse callback data from Telegram webhook
  static parseCallbackData(data: string): { action: NotificationAction; approvalId: string } | null {
    try {
      const parsed = JSON.parse(data);
      if (parsed.action && parsed.approvalId) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }
}

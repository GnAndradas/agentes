export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationAction = 'approve' | 'reject' | 'view' | 'dismiss';

export interface NotificationMessage {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  actions?: NotificationAction[];
  approvalId?: string;
  resourceType?: string;
  resourceId?: string;
  data?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  isConfigured(): boolean;
  send(message: NotificationMessage): Promise<boolean>;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramCallbackData {
  action: NotificationAction;
  approvalId: string;
}

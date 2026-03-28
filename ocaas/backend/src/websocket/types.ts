import type { EventType } from '../config/constants.js';

export interface WSClient {
  id: string;
  socket: unknown;
  subscriptions: Set<string>;
  connectedAt: number;
}

export interface WSMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'event';
  channel?: string;
  payload?: unknown;
}

export interface WSEvent {
  type: EventType;
  channel: string;
  payload: unknown;
  timestamp: number;
}

export interface ChannelSubscription {
  pattern: string;
  handler?: (event: WSEvent) => void;
}

export type WSChannel =
  | 'agents'
  | 'tasks'
  | 'generations'
  | 'system'
  | `agent:${string}`
  | `task:${string}`
  | `generation:${string}`;

export interface BroadcastOptions {
  excludeClient?: string;
  onlySubscribed?: boolean;
}

import { io, Socket } from 'socket.io-client';
import type { WSEvent } from '../types';

type EventHandler = (event: WSEvent) => void;

class SocketClient {
  private socket: Socket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private connected = false;

  connect(): void {
    if (this.socket) {
      return;
    }

    this.socket = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[WS] Connected');
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      console.log('[WS] Disconnected:', reason);
    });

    this.socket.on('connected', (data: { clientId: string }) => {
      console.log('[WS] Client ID:', data.clientId);
    });

    this.socket.on('event', (event: WSEvent) => {
      this.dispatchEvent(event);
    });

    this.socket.on('error', (error) => {
      console.error('[WS] Error:', error);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribe(channels: string | string[]): void {
    if (!this.socket) {
      return;
    }
    this.socket.emit('subscribe', channels);
  }

  unsubscribe(channels: string | string[]): void {
    if (!this.socket) {
      return;
    }
    this.socket.emit('unsubscribe', channels);
  }

  on(channel: string, handler: EventHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);

    // Return unsubscribe function
    return () => {
      const channelHandlers = this.handlers.get(channel);
      if (channelHandlers) {
        channelHandlers.delete(handler);
        if (channelHandlers.size === 0) {
          this.handlers.delete(channel);
        }
      }
    };
  }

  off(channel: string, handler?: EventHandler): void {
    if (!handler) {
      this.handlers.delete(channel);
      return;
    }

    const channelHandlers = this.handlers.get(channel);
    if (channelHandlers) {
      channelHandlers.delete(handler);
    }
  }

  private dispatchEvent(event: WSEvent): void {
    // Dispatch to specific channel handlers
    const channelHandlers = this.handlers.get(event.channel);
    if (channelHandlers) {
      for (const handler of channelHandlers) {
        handler(event);
      }
    }

    // Dispatch to wildcard handlers
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(event);
      }
    }
  }
}

export const socketClient = new SocketClient();

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createLogger } from '../utils/logger.js';
import { nanoid } from 'nanoid';
import type { WSClient, WSEvent, BroadcastOptions } from './types.js';

const logger = createLogger('SocketManager');

export class SocketManager {
  private io: Server | null = null;
  private clients: Map<string, WSClient> = new Map();

  initialize(httpServer: HttpServer): void {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
        methods: ['GET', 'POST'],
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.io.on('connection', (socket) => this.handleConnection(socket));

    logger.info('WebSocket server initialized');
  }

  private handleConnection(socket: Socket): void {
    const clientId = nanoid();
    const client: WSClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);
    logger.debug({ clientId }, 'Client connected');

    // Send welcome message
    socket.emit('connected', { clientId });

    // Handle subscriptions
    socket.on('subscribe', (channels: string | string[]) => {
      const channelList = Array.isArray(channels) ? channels : [channels];
      for (const channel of channelList) {
        client.subscriptions.add(channel);
        socket.join(channel);
        logger.debug({ clientId, channel }, 'Client subscribed');
      }
      socket.emit('subscribed', { channels: channelList });
    });

    socket.on('unsubscribe', (channels: string | string[]) => {
      const channelList = Array.isArray(channels) ? channels : [channels];
      for (const channel of channelList) {
        client.subscriptions.delete(channel);
        socket.leave(channel);
        logger.debug({ clientId, channel }, 'Client unsubscribed');
      }
      socket.emit('unsubscribed', { channels: channelList });
    });

    // Handle ping
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      this.clients.delete(clientId);
      logger.debug({ clientId, reason }, 'Client disconnected');
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error({ clientId, error }, 'Socket error');
    });
  }

  broadcast(event: WSEvent, options: BroadcastOptions = {}): void {
    if (!this.io) {
      logger.warn('WebSocket not initialized, cannot broadcast');
      return;
    }

    const { excludeClient, onlySubscribed = true } = options;

    if (onlySubscribed) {
      // Broadcast to channel subscribers only
      if (excludeClient) {
        const client = this.clients.get(excludeClient);
        if (client) {
          (client.socket as Socket).to(event.channel).emit('event', event);
        } else {
          this.io.to(event.channel).emit('event', event);
        }
      } else {
        this.io.to(event.channel).emit('event', event);
      }
    } else {
      // Broadcast to all clients
      if (excludeClient) {
        const client = this.clients.get(excludeClient);
        if (client) {
          (client.socket as Socket).broadcast.emit('event', event);
        } else {
          this.io.emit('event', event);
        }
      } else {
        this.io.emit('event', event);
      }
    }

    logger.debug({ channel: event.channel, type: event.type }, 'Event broadcast');
  }

  emitToClient(clientId: string, event: WSEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    (client.socket as Socket).emit('event', event);
    return true;
  }

  emitToChannel(channel: string, event: WSEvent): void {
    if (!this.io) {
      return;
    }

    this.io.to(channel).emit('event', event);
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  getClientSubscriptions(clientId: string): string[] {
    const client = this.clients.get(clientId);
    return client ? Array.from(client.subscriptions) : [];
  }

  getChannelSubscribers(channel: string): string[] {
    const subscribers: string[] = [];
    for (const [clientId, client] of this.clients) {
      if (client.subscriptions.has(channel)) {
        subscribers.push(clientId);
      }
    }
    return subscribers;
  }

  disconnectClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    (client.socket as Socket).disconnect(true);
    this.clients.delete(clientId);
    return true;
  }

  shutdown(): void {
    if (this.io) {
      this.io.close();
      this.io = null;
    }
    this.clients.clear();
    logger.info('WebSocket server shutdown');
  }
}

let socketManagerInstance: SocketManager | null = null;

export function getSocketManager(): SocketManager {
  if (!socketManagerInstance) {
    socketManagerInstance = new SocketManager();
  }
  return socketManagerInstance;
}

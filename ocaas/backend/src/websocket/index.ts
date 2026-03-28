export * from './types.js';
export { SocketManager, getSocketManager } from './SocketManager.js';
export { EventBridge, getEventBridge } from './EventBridge.js';

import { Server as HttpServer } from 'http';
import { getSocketManager } from './SocketManager.js';
import { getEventBridge } from './EventBridge.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket');

export function initWebSocket(httpServer: HttpServer): void {
  const socketManager = getSocketManager();
  socketManager.initialize(httpServer);

  const eventBridge = getEventBridge();
  eventBridge.start();

  logger.info('WebSocket system initialized');
}

export function shutdownWebSocket(): void {
  const eventBridge = getEventBridge();
  eventBridge.stop();

  const socketManager = getSocketManager();
  socketManager.shutdown();

  logger.info('WebSocket system shutdown');
}

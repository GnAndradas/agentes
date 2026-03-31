/**
 * Simple EventBus for internal event emission
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('EventBus');

type EventHandler = (payload: Record<string, unknown>) => void;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  /**
   * Subscribe to an event
   */
  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /**
   * Emit an event
   */
  emit(event: string, payload: Record<string, unknown>): void {
    const handlers = this.handlers.get(event);

    logger.debug({ event, payload }, 'Event emitted');

    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          logger.error({ event, err }, 'Event handler error');
        }
      }
    }
  }

  /**
   * Remove all handlers for an event
   */
  off(event: string): void {
    this.handlers.delete(event);
  }

  /**
   * Remove all handlers
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get number of handlers for an event
   */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

export const eventBus = new EventBus();

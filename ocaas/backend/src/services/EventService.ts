import { nanoid } from 'nanoid';
import { desc, eq, and, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import type { EventDTO, EventSeverity } from '../types/domain.js';

const logger = createLogger('EventService');

export interface EmitEventInput {
  type: string;
  category: string;
  severity?: EventSeverity;
  message: string;
  resourceType?: string;
  resourceId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
}

export type EventListener = (event: EventDTO) => void;

function rowToDTO(row: typeof schema.events.$inferSelect): EventDTO {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    severity: row.severity as EventSeverity,
    message: row.message,
    resourceType: row.resourceType ?? undefined,
    resourceId: row.resourceId ?? undefined,
    agentId: row.agentId ?? undefined,
    data: parseJsonSafe(row.data),
    createdAt: row.createdAt,
  };
}

export class EventService {
  private listeners = new Set<EventListener>();

  async emit(input: EmitEventInput): Promise<EventDTO> {
    const now = nowTimestamp();
    const id = nanoid();

    const row: typeof schema.events.$inferInsert = {
      id,
      type: input.type,
      category: input.category,
      severity: input.severity ?? 'info',
      message: input.message,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      agentId: input.agentId,
      data: input.data ? JSON.stringify(input.data) : null,
      createdAt: now,
    };

    await db.insert(schema.events).values(row);

    const event = rowToDTO({ ...row, createdAt: now });

    if (input.severity === 'error' || input.severity === 'critical') {
      logger.error({ type: input.type }, input.message);
    } else {
      logger.info({ type: input.type }, input.message);
    }

    this.notify(event);
    return event;
  }

  async list(opts?: { limit?: number; category?: string; since?: number }): Promise<EventDTO[]> {
    const limit = opts?.limit ?? 100;
    const conditions = [];

    if (opts?.category) {
      conditions.push(eq(schema.events.category, opts.category));
    }
    if (opts?.since) {
      conditions.push(gte(schema.events.createdAt, opts.since));
    }

    const query = conditions.length > 0
      ? db.select().from(schema.events).where(and(...conditions))
      : db.select().from(schema.events);

    const rows = await query.orderBy(desc(schema.events.createdAt)).limit(limit);
    return rows.map(rowToDTO);
  }

  async getByResource(resourceType: string, resourceId: string): Promise<EventDTO[]> {
    const rows = await db
      .select()
      .from(schema.events)
      .where(and(
        eq(schema.events.resourceType, resourceType),
        eq(schema.events.resourceId, resourceId)
      ))
      .orderBy(desc(schema.events.createdAt))
      .limit(50);

    return rows.map(rowToDTO);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: EventDTO): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'Event listener error');
      }
    }
  }
}

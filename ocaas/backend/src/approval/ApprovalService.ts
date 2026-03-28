import { nanoid } from 'nanoid';
import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { NotFoundError } from '../utils/errors.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from '../services/EventService.js';
import type {
  ApprovalDTO,
  ApprovalType,
  ApprovalStatus,
  CreateApprovalInput,
  ApprovalResponse,
} from './types.js';

const logger = createLogger('ApprovalService');

function rowToDTO(row: typeof schema.approvals.$inferSelect): ApprovalDTO {
  return {
    id: row.id,
    type: row.type as ApprovalType,
    resourceId: row.resourceId ?? undefined,
    status: row.status as ApprovalStatus,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt ?? undefined,
    respondedAt: row.respondedAt ?? undefined,
    respondedBy: row.respondedBy ?? undefined,
    reason: row.reason ?? undefined,
    metadata: parseJsonSafe(row.metadata),
  };
}

export class ApprovalService {
  constructor(private eventService: EventService) {}

  async create(input: CreateApprovalInput): Promise<ApprovalDTO> {
    const now = nowTimestamp();
    const id = nanoid();
    const autonomyConfig = getAutonomyConfig();

    const expiresAt = input.expiresIn
      ? now + input.expiresIn
      : now + autonomyConfig.humanTimeout;

    await db.insert(schema.approvals).values({
      id,
      type: input.type,
      resourceId: input.resourceId,
      status: 'pending',
      requestedAt: now,
      expiresAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });

    logger.info({ id, type: input.type, resourceId: input.resourceId }, 'Approval requested');

    const approval = await this.getById(id);

    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'approval',
      message: `Approval requested for ${input.type}`,
      resourceType: 'approval',
      resourceId: id,
      data: { type: input.type, resourceId: input.resourceId, metadata: input.metadata },
    });

    return approval;
  }

  async getById(id: string): Promise<ApprovalDTO> {
    const rows = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Approval', id);
    }

    return rowToDTO(rows[0]!);
  }

  async getByResource(type: ApprovalType, resourceId: string): Promise<ApprovalDTO | null> {
    const rows = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.type, type),
          eq(schema.approvals.resourceId, resourceId)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rowToDTO(rows[0]!);
  }

  async getPending(): Promise<ApprovalDTO[]> {
    const rows = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.status, 'pending'));

    return rows.map(rowToDTO);
  }

  async getExpired(): Promise<ApprovalDTO[]> {
    const now = nowTimestamp();
    const rows = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.status, 'pending'),
          isNotNull(schema.approvals.expiresAt),
          lt(schema.approvals.expiresAt, now)
        )
      );

    return rows.map(rowToDTO);
  }

  async approve(id: string, respondedBy: string): Promise<ApprovalDTO> {
    const now = nowTimestamp();

    await db
      .update(schema.approvals)
      .set({
        status: 'approved',
        respondedAt: now,
        respondedBy,
      })
      .where(eq(schema.approvals.id, id));

    const approval = await this.getById(id);

    logger.info({ id, respondedBy }, 'Approval approved');

    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'approval',
      message: `Approval ${id} approved by ${respondedBy}`,
      resourceType: 'approval',
      resourceId: id,
      data: { status: 'approved', respondedBy },
    });

    return approval;
  }

  async reject(id: string, respondedBy: string, reason?: string): Promise<ApprovalDTO> {
    const now = nowTimestamp();

    await db
      .update(schema.approvals)
      .set({
        status: 'rejected',
        respondedAt: now,
        respondedBy,
        reason,
      })
      .where(eq(schema.approvals.id, id));

    const approval = await this.getById(id);

    logger.info({ id, respondedBy, reason }, 'Approval rejected');

    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_INFO,
      category: 'approval',
      severity: 'warning',
      message: `Approval ${id} rejected by ${respondedBy}`,
      resourceType: 'approval',
      resourceId: id,
      data: { status: 'rejected', respondedBy, reason },
    });

    return approval;
  }

  async markExpired(id: string): Promise<ApprovalDTO> {
    const now = nowTimestamp();

    await db
      .update(schema.approvals)
      .set({
        status: 'expired',
        respondedAt: now,
        respondedBy: 'system:timeout',
        reason: 'Human response timeout',
      })
      .where(eq(schema.approvals.id, id));

    const approval = await this.getById(id);

    logger.warn({ id }, 'Approval expired');

    await this.eventService.emit({
      type: EVENT_TYPE.SYSTEM_WARNING,
      category: 'approval',
      severity: 'warning',
      message: `Approval ${id} expired (no human response)`,
      resourceType: 'approval',
      resourceId: id,
      data: { status: 'expired' },
    });

    return approval;
  }

  async processExpired(): Promise<number> {
    const expired = await this.getExpired();
    const autonomyConfig = getAutonomyConfig();

    let processed = 0;

    for (const approval of expired) {
      switch (autonomyConfig.fallbackBehavior) {
        case 'pause':
          // Keep as pending, do nothing
          break;
        case 'reject':
          await this.markExpired(approval.id);
          processed++;
          break;
        case 'auto_approve':
          await this.approve(approval.id, 'system:auto_approve');
          processed++;
          break;
      }
    }

    if (processed > 0) {
      logger.info({ processed, fallback: autonomyConfig.fallbackBehavior }, 'Processed expired approvals');
    }

    return processed;
  }

  async respond(id: string, response: ApprovalResponse): Promise<ApprovalDTO> {
    if (response.approved) {
      return this.approve(id, response.respondedBy);
    } else {
      return this.reject(id, response.respondedBy, response.reason);
    }
  }

  async delete(id: string): Promise<void> {
    await this.getById(id); // Verify exists
    await db.delete(schema.approvals).where(eq(schema.approvals.id, id));
    logger.info({ id }, 'Approval deleted');
  }

  async list(opts?: { status?: ApprovalStatus; type?: ApprovalType }): Promise<ApprovalDTO[]> {
    let query = db.select().from(schema.approvals);

    if (opts?.status) {
      query = query.where(eq(schema.approvals.status, opts.status)) as typeof query;
    } else if (opts?.type) {
      query = query.where(eq(schema.approvals.type, opts.type)) as typeof query;
    }

    const rows = await query;
    return rows.map(rowToDTO);
  }
}

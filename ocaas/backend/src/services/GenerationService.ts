import { nanoid } from 'nanoid';
import { eq, desc, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE, GENERATION_STATUS } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { GenerationDTO, GenerationStatus, GenerationType } from '../types/domain.js';

const logger = createLogger('GenerationService');

export interface CreateGenerationInput {
  type: GenerationType;
  name: string;
  description?: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

function rowToDTO(row: typeof schema.generations.$inferSelect): GenerationDTO {
  return {
    id: row.id,
    type: row.type as GenerationType,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status as GenerationStatus,
    prompt: row.prompt,
    generatedContent: parseJsonSafe(row.generatedContent),
    validationResult: parseJsonSafe(row.validationResult),
    targetPath: row.targetPath ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    activatedAt: row.activatedAt ?? undefined,
    metadata: parseJsonSafe(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class GenerationService {
  constructor(private eventService: EventService) {}

  async list(opts?: { status?: GenerationStatus; type?: GenerationType }): Promise<GenerationDTO[]> {
    let query = db.select().from(schema.generations);

    if (opts?.status) {
      query = query.where(eq(schema.generations.status, opts.status)) as typeof query;
    } else if (opts?.type) {
      query = query.where(eq(schema.generations.type, opts.type)) as typeof query;
    }

    const rows = await query.orderBy(desc(schema.generations.createdAt));
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<GenerationDTO> {
    const rows = await db.select().from(schema.generations).where(eq(schema.generations.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Generation', id);
    return rowToDTO(rows[0]!);
  }

  async create(input: CreateGenerationInput): Promise<GenerationDTO> {
    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.generations).values({
      id,
      type: input.type,
      name: input.name,
      description: input.description,
      status: GENERATION_STATUS.DRAFT,
      prompt: input.prompt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, type: input.type, name: input.name }, 'Generation created');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_STARTED,
      category: 'generation',
      message: `Generation '${input.name}' started`,
      resourceType: 'generation',
      resourceId: id,
      data: { type: input.type },
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await db.delete(schema.generations).where(eq(schema.generations.id, id));
  }

  async markGenerated(id: string, content: Record<string, unknown>, targetPath: string): Promise<GenerationDTO> {
    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.GENERATED,
      generatedContent: JSON.stringify(content),
      targetPath,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    const gen = await this.getById(id);

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_COMPLETED,
      category: 'generation',
      message: `Generation '${gen.name}' completed`,
      resourceType: 'generation',
      resourceId: id,
    });

    return gen;
  }

  async markPendingApproval(id: string, validationResult: Record<string, unknown>): Promise<GenerationDTO> {
    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.PENDING_APPROVAL,
      validationResult: JSON.stringify(validationResult),
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    return this.getById(id);
  }

  async approve(id: string, approvedBy: string): Promise<GenerationDTO> {
    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.APPROVED,
      approvedBy,
      approvedAt: now,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    const gen = await this.getById(id);

    logger.info({ id, approvedBy }, 'Generation approved');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_APPROVED,
      category: 'generation',
      message: `Generation '${gen.name}' approved`,
      resourceType: 'generation',
      resourceId: id,
    });

    return gen;
  }

  async reject(id: string, reason: string): Promise<GenerationDTO> {
    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.REJECTED,
      errorMessage: reason,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    const gen = await this.getById(id);

    logger.info({ id, reason }, 'Generation rejected');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_REJECTED,
      category: 'generation',
      message: `Generation '${gen.name}' rejected`,
      resourceType: 'generation',
      resourceId: id,
    });

    return gen;
  }

  async activate(id: string): Promise<GenerationDTO> {
    const gen = await this.getById(id);

    if (gen.status !== GENERATION_STATUS.APPROVED) {
      throw new ValidationError('Can only activate approved generations');
    }

    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.ACTIVE,
      activatedAt: now,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    logger.info({ id }, 'Generation activated');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_ACTIVATED,
      category: 'generation',
      message: `Generation '${gen.name}' activated`,
      resourceType: 'generation',
      resourceId: id,
    });

    return this.getById(id);
  }

  async markFailed(id: string, errorMessage: string): Promise<GenerationDTO> {
    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.FAILED,
      errorMessage,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    const gen = await this.getById(id);

    logger.error({ id, errorMessage }, 'Generation failed');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_FAILED,
      category: 'generation',
      severity: 'error',
      message: `Generation '${gen.name}' failed: ${errorMessage}`,
      resourceType: 'generation',
      resourceId: id,
      data: { error: errorMessage },
    });

    return gen;
  }

  async getPendingApprovals(): Promise<GenerationDTO[]> {
    const rows = await db
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.status, GENERATION_STATUS.PENDING_APPROVAL))
      .orderBy(desc(schema.generations.createdAt));

    return rows.map(rowToDTO);
  }

  async getApproved(): Promise<GenerationDTO[]> {
    const rows = await db
      .select()
      .from(schema.generations)
      .where(inArray(schema.generations.status, [GENERATION_STATUS.APPROVED, GENERATION_STATUS.ACTIVE]))
      .orderBy(desc(schema.generations.createdAt));

    return rows.map(rowToDTO);
  }
}

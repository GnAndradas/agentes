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

// Callback type for when a generation is activated
export type OnGenerationActivatedCallback = (generationId: string) => Promise<void>;

export class GenerationService {
  private onActivatedCallback: OnGenerationActivatedCallback | null = null;

  constructor(private eventService: EventService) {}

  /**
   * Register callback to be called when a generation is activated
   * Used by ActionExecutor to trigger task retries
   */
  setOnActivatedCallback(callback: OnGenerationActivatedCallback): void {
    this.onActivatedCallback = callback;
  }

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

    const gen = await this.getById(id);

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_PENDING_APPROVAL,
      category: 'generation',
      severity: 'warning',
      message: `Generation '${gen.name}' awaiting approval`,
      resourceType: 'generation',
      resourceId: id,
      data: { type: gen.type },
    });

    return gen;
  }

  async approve(id: string, approvedBy: string): Promise<GenerationDTO> {
    // FSM check: can only approve from pending_approval
    const current = await this.getById(id);
    if (current.status !== GENERATION_STATUS.PENDING_APPROVAL) {
      if (current.status === GENERATION_STATUS.APPROVED || current.status === GENERATION_STATUS.ACTIVE) {
        logger.info({ id, status: current.status }, 'Generation already approved/active (idempotent)');
        return current;
      }
      throw new ValidationError(`Cannot approve generation in status '${current.status}'. Expected 'pending_approval'.`);
    }

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
    // FSM check: can only reject from pending_approval or generated
    const current = await this.getById(id);
    const rejectableStatuses = [GENERATION_STATUS.PENDING_APPROVAL, GENERATION_STATUS.GENERATED];
    if (!rejectableStatuses.includes(current.status as typeof rejectableStatuses[number])) {
      if (current.status === GENERATION_STATUS.REJECTED) {
        logger.info({ id }, 'Generation already rejected (idempotent)');
        return current;
      }
      throw new ValidationError(`Cannot reject generation in status '${current.status}'.`);
    }

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

    // FSM check: can only activate from approved
    if (gen.status !== GENERATION_STATUS.APPROVED) {
      if (gen.status === GENERATION_STATUS.ACTIVE) {
        logger.info({ id }, 'Generation already active (idempotent)');
        return gen;
      }
      throw new ValidationError(`Cannot activate generation in status '${gen.status}'. Expected 'approved'.`);
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

    // Trigger callback for task retry if registered
    if (this.onActivatedCallback) {
      try {
        await this.onActivatedCallback(id);
      } catch (err) {
        logger.error({ err, id }, 'Error in onActivatedCallback');
      }
    }

    return this.getById(id);
  }

  async markFailed(id: string, errorMessage: string): Promise<GenerationDTO> {
    // FSM guard: cannot mark terminal states as failed
    const current = await this.getById(id);
    const terminalStatuses = [GENERATION_STATUS.ACTIVE, GENERATION_STATUS.REJECTED, GENERATION_STATUS.FAILED];

    if (terminalStatuses.includes(current.status as typeof terminalStatuses[number])) {
      // Already in terminal state - idempotent for failed, skip for others
      if (current.status === GENERATION_STATUS.FAILED) {
        logger.debug({ id }, 'Generation already failed (idempotent)');
        return current;
      }
      // Don't overwrite active or rejected with failed
      logger.warn({ id, currentStatus: current.status }, 'Cannot mark terminal generation as failed');
      return current;
    }

    const now = nowTimestamp();

    await db.update(schema.generations).set({
      status: GENERATION_STATUS.FAILED,
      errorMessage,
      updatedAt: now,
    }).where(eq(schema.generations.id, id));

    const gen = await this.getById(id);

    logger.error({ id, errorMessage, previousStatus: current.status }, 'Generation marked as failed');

    await this.eventService.emit({
      type: EVENT_TYPE.GENERATION_FAILED,
      category: 'generation',
      severity: 'error',
      message: `Generation '${gen.name}' failed: ${errorMessage}`,
      resourceType: 'generation',
      resourceId: id,
      data: { error: errorMessage, previousStatus: current.status },
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

import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { SkillDTO, SkillStatus } from '../types/domain.js';

const logger = createLogger('SkillService');

export interface CreateSkillInput {
  name: string;
  description?: string;
  version?: string;
  path: string;
  capabilities?: string[];
  requirements?: string[];
  config?: Record<string, unknown>;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  version?: string;
  path?: string;
  status?: SkillStatus;
  capabilities?: string[];
  requirements?: string[];
  config?: Record<string, unknown>;
}

function rowToDTO(row: typeof schema.skills.$inferSelect): SkillDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    path: row.path,
    status: row.status as SkillStatus,
    capabilities: parseJsonSafe(row.capabilities),
    requirements: parseJsonSafe(row.requirements),
    config: parseJsonSafe(row.config),
    syncedAt: row.syncedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SkillService {
  constructor(private eventService: EventService) {}

  async list(): Promise<SkillDTO[]> {
    const rows = await db.select().from(schema.skills).orderBy(desc(schema.skills.updatedAt));
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<SkillDTO> {
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Skill', id);
    return rowToDTO(rows[0]!);
  }

  async getByName(name: string): Promise<SkillDTO | null> {
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.name, name)).limit(1);
    return rows.length > 0 ? rowToDTO(rows[0]!) : null;
  }

  async create(input: CreateSkillInput): Promise<SkillDTO> {
    const existing = await this.getByName(input.name);
    if (existing) throw new ConflictError(`Skill '${input.name}' already exists`);

    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.skills).values({
      id,
      name: input.name,
      description: input.description,
      version: input.version ?? '1.0.0',
      path: input.path,
      status: 'active',
      capabilities: input.capabilities ? JSON.stringify(input.capabilities) : null,
      requirements: input.requirements ? JSON.stringify(input.requirements) : null,
      config: input.config ? JSON.stringify(input.config) : null,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, name: input.name }, 'Skill created');

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_CREATED,
      category: 'skill',
      message: `Skill '${input.name}' created`,
      resourceType: 'skill',
      resourceId: id,
    });

    return this.getById(id);
  }

  async update(id: string, input: UpdateSkillInput): Promise<SkillDTO> {
    const existing = await this.getById(id);
    const now = nowTimestamp();

    if (input.name && input.name !== existing.name) {
      const conflict = await this.getByName(input.name);
      if (conflict) throw new ConflictError(`Skill '${input.name}' already exists`);
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.version !== undefined) updates.version = input.version;
    if (input.path !== undefined) updates.path = input.path;
    if (input.status !== undefined) updates.status = input.status;
    if (input.capabilities !== undefined) updates.capabilities = JSON.stringify(input.capabilities);
    if (input.requirements !== undefined) updates.requirements = JSON.stringify(input.requirements);
    if (input.config !== undefined) updates.config = JSON.stringify(input.config);

    await db.update(schema.skills).set(updates).where(eq(schema.skills.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_UPDATED,
      category: 'skill',
      message: `Skill '${input.name ?? existing.name}' updated`,
      resourceType: 'skill',
      resourceId: id,
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    await db.delete(schema.skills).where(eq(schema.skills.id, id));
    logger.info({ id }, 'Skill deleted');
  }

  async markSynced(id: string): Promise<SkillDTO> {
    const now = nowTimestamp();
    await db.update(schema.skills).set({ syncedAt: now, updatedAt: now }).where(eq(schema.skills.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_SYNCED,
      category: 'skill',
      message: 'Skill synced with workspace',
      resourceType: 'skill',
      resourceId: id,
    });

    return this.getById(id);
  }

  async assignToAgent(skillId: string, agentId: string): Promise<void> {
    const now = nowTimestamp();
    const existing = await db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.skillId, skillId))
      .limit(100);

    if (existing.some(r => r.agentId === agentId)) return;

    await db.insert(schema.agentSkills).values({ agentId, skillId, assignedAt: now });
  }

  async unassignFromAgent(skillId: string, agentId: string): Promise<void> {
    await db.delete(schema.agentSkills).where(
      eq(schema.agentSkills.skillId, skillId)
    );
  }

  async getAgentSkills(agentId: string): Promise<SkillDTO[]> {
    const rows = await db
      .select({ skill: schema.skills })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
      .where(eq(schema.agentSkills.agentId, agentId));

    return rows.map(r => rowToDTO(r.skill));
  }

  async getActive(): Promise<SkillDTO[]> {
    const rows = await db.select().from(schema.skills).where(eq(schema.skills.status, 'active'));
    return rows.map(rowToDTO);
  }
}

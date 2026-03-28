import { nanoid } from 'nanoid';
import { eq, and, or, isNull, gte, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, PermissionError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import type { PermissionDTO, PermissionLevel, ResourceType } from '../types/domain.js';

const logger = createLogger('PermissionService');

export interface CreatePermissionInput {
  agentId: string;
  resourceType: ResourceType;
  resourceId?: string;
  level: PermissionLevel;
  constraints?: Record<string, unknown>;
  expiresAt?: number;
  grantedBy?: string;
}

export interface UpdatePermissionInput {
  level?: PermissionLevel;
  constraints?: Record<string, unknown>;
  expiresAt?: number | null;
}

function rowToDTO(row: typeof schema.permissions.$inferSelect): PermissionDTO {
  return {
    id: row.id,
    agentId: row.agentId,
    resourceType: row.resourceType as ResourceType,
    resourceId: row.resourceId ?? undefined,
    level: row.level as PermissionLevel,
    constraints: parseJsonSafe(row.constraints),
    expiresAt: row.expiresAt ?? undefined,
    grantedBy: row.grantedBy ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PermissionService {
  async list(agentId?: string): Promise<PermissionDTO[]> {
    const query = agentId
      ? db.select().from(schema.permissions).where(eq(schema.permissions.agentId, agentId))
      : db.select().from(schema.permissions);

    const rows = await query.orderBy(desc(schema.permissions.createdAt));
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<PermissionDTO> {
    const rows = await db.select().from(schema.permissions).where(eq(schema.permissions.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Permission', id);
    return rowToDTO(rows[0]!);
  }

  async create(input: CreatePermissionInput): Promise<PermissionDTO> {
    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.permissions).values({
      id,
      agentId: input.agentId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      level: input.level,
      constraints: input.constraints ? JSON.stringify(input.constraints) : null,
      expiresAt: input.expiresAt,
      grantedBy: input.grantedBy,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, agentId: input.agentId, resourceType: input.resourceType }, 'Permission created');
    return this.getById(id);
  }

  async update(id: string, input: UpdatePermissionInput): Promise<PermissionDTO> {
    await this.getById(id);
    const now = nowTimestamp();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.level !== undefined) updates.level = input.level;
    if (input.constraints !== undefined) updates.constraints = JSON.stringify(input.constraints);
    if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;

    await db.update(schema.permissions).set(updates).where(eq(schema.permissions.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await db.delete(schema.permissions).where(eq(schema.permissions.id, id));
  }

  async check(
    agentId: string,
    resourceType: ResourceType,
    resourceId: string | null,
    requiredLevel: PermissionLevel
  ): Promise<boolean> {
    const now = nowTimestamp();

    const rows = await db
      .select()
      .from(schema.permissions)
      .where(
        and(
          eq(schema.permissions.agentId, agentId),
          eq(schema.permissions.resourceType, resourceType),
          or(
            eq(schema.permissions.resourceId, '*'),
            resourceId ? eq(schema.permissions.resourceId, resourceId) : isNull(schema.permissions.resourceId)
          ),
          or(
            isNull(schema.permissions.expiresAt),
            gte(schema.permissions.expiresAt, now)
          )
        )
      );

    return rows.some(row => row.level >= requiredLevel);
  }

  async require(
    agentId: string,
    resourceType: ResourceType,
    resourceId: string | null,
    requiredLevel: PermissionLevel
  ): Promise<void> {
    const has = await this.check(agentId, resourceType, resourceId, requiredLevel);
    if (!has) {
      throw new PermissionError(
        `Agent '${agentId}' lacks permission level ${requiredLevel} for ${resourceType}${resourceId ? `:${resourceId}` : ''}`
      );
    }
  }

  async getForAgent(agentId: string): Promise<PermissionDTO[]> {
    const rows = await db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.agentId, agentId))
      .orderBy(desc(schema.permissions.createdAt));

    return rows.map(rowToDTO);
  }

  async grantTool(agentId: string, toolId: string, level: PermissionLevel, grantedBy?: string): Promise<PermissionDTO> {
    return this.create({ agentId, resourceType: 'tool', resourceId: toolId, level, grantedBy });
  }

  async grantSkill(agentId: string, skillId: string, level: PermissionLevel, grantedBy?: string): Promise<PermissionDTO> {
    return this.create({ agentId, resourceType: 'skill', resourceId: skillId, level, grantedBy });
  }

  async revoke(agentId: string, resourceType: ResourceType, resourceId: string): Promise<void> {
    await db.delete(schema.permissions).where(
      and(
        eq(schema.permissions.agentId, agentId),
        eq(schema.permissions.resourceType, resourceType),
        eq(schema.permissions.resourceId, resourceId)
      )
    );
  }
}

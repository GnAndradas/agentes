import { nanoid } from 'nanoid';
import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { SkillDTO, SkillStatus, SkillToolLink, SkillToolExpanded, ToolDTO } from '../types/domain.js';

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

  // ==========================================================================
  // SKILL-TOOL COMPOSITION
  // ==========================================================================

  /**
   * Get tools linked to a skill
   */
  async getSkillTools(skillId: string): Promise<SkillToolLink[]> {
    await this.getById(skillId); // Verify skill exists

    const rows = await db
      .select()
      .from(schema.skillTools)
      .where(eq(schema.skillTools.skillId, skillId))
      .orderBy(asc(schema.skillTools.orderIndex));

    return rows.map((row) => ({
      toolId: row.toolId,
      orderIndex: row.orderIndex,
      required: row.required,
      role: row.role ?? undefined,
      config: parseJsonSafe(row.config),
      createdAt: row.createdAt,
    }));
  }

  /**
   * Get tools linked to a skill with expanded tool details
   */
  async getSkillToolsExpanded(skillId: string): Promise<SkillToolExpanded[]> {
    await this.getById(skillId); // Verify skill exists

    const rows = await db
      .select({
        link: schema.skillTools,
        tool: schema.tools,
      })
      .from(schema.skillTools)
      .innerJoin(schema.tools, eq(schema.skillTools.toolId, schema.tools.id))
      .where(eq(schema.skillTools.skillId, skillId))
      .orderBy(asc(schema.skillTools.orderIndex));

    return rows.map((row) => ({
      toolId: row.link.toolId,
      orderIndex: row.link.orderIndex,
      required: row.link.required,
      role: row.link.role ?? undefined,
      config: parseJsonSafe(row.link.config),
      createdAt: row.link.createdAt,
      tool: {
        id: row.tool.id,
        name: row.tool.name,
        description: row.tool.description ?? undefined,
        version: row.tool.version,
        path: row.tool.path,
        type: row.tool.type as ToolDTO['type'],
        status: row.tool.status as ToolDTO['status'],
        inputSchema: parseJsonSafe(row.tool.inputSchema),
        outputSchema: parseJsonSafe(row.tool.outputSchema),
        config: parseJsonSafe(row.tool.config),
        executionCount: row.tool.executionCount,
        lastExecutedAt: row.tool.lastExecutedAt ?? undefined,
        syncedAt: row.tool.syncedAt ?? undefined,
        createdAt: row.tool.createdAt,
        updatedAt: row.tool.updatedAt,
      },
    }));
  }

  /**
   * Get skill with tool count
   */
  async getByIdWithToolCount(id: string): Promise<SkillDTO> {
    const skill = await this.getById(id);
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.skillTools)
      .where(eq(schema.skillTools.skillId, id));

    return {
      ...skill,
      toolCount: countResult[0]?.count ?? 0,
    };
  }

  /**
   * List skills with tool counts
   */
  async listWithToolCounts(): Promise<SkillDTO[]> {
    const skills = await this.list();
    const counts = await db
      .select({
        skillId: schema.skillTools.skillId,
        count: sql<number>`count(*)`,
      })
      .from(schema.skillTools)
      .groupBy(schema.skillTools.skillId);

    const countMap = new Map(counts.map((c) => [c.skillId, c.count]));

    return skills.map((skill) => ({
      ...skill,
      toolCount: countMap.get(skill.id) ?? 0,
    }));
  }

  /**
   * Add a tool to a skill
   */
  async addTool(
    skillId: string,
    toolId: string,
    options?: { orderIndex?: number; required?: boolean; role?: string; config?: Record<string, unknown> }
  ): Promise<SkillToolLink> {
    await this.getById(skillId); // Verify skill exists

    // Verify tool exists
    const toolRows = await db.select().from(schema.tools).where(eq(schema.tools.id, toolId)).limit(1);
    if (toolRows.length === 0) {
      throw new NotFoundError('Tool', toolId);
    }

    // Check for duplicate
    const existing = await db
      .select()
      .from(schema.skillTools)
      .where(and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError(`Tool '${toolId}' is already linked to skill '${skillId}'`);
    }

    // Get max order index
    const maxOrder = await db
      .select({ max: sql<number>`coalesce(max(order_index), -1)` })
      .from(schema.skillTools)
      .where(eq(schema.skillTools.skillId, skillId));

    const orderIndex = options?.orderIndex ?? (maxOrder[0]?.max ?? -1) + 1;
    const now = nowTimestamp();

    await db.insert(schema.skillTools).values({
      skillId,
      toolId,
      orderIndex,
      required: options?.required ?? true,
      role: options?.role ?? null,
      config: options?.config ? JSON.stringify(options.config) : null,
      createdAt: now,
    });

    logger.info({ skillId, toolId, orderIndex }, 'Tool added to skill');

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_UPDATED,
      category: 'skill',
      message: `Tool '${toolId}' added to skill`,
      resourceType: 'skill',
      resourceId: skillId,
      data: { toolId, orderIndex },
    });

    return {
      toolId,
      orderIndex,
      required: options?.required ?? true,
      role: options?.role,
      config: options?.config,
      createdAt: now,
    };
  }

  /**
   * Remove a tool from a skill
   */
  async removeTool(skillId: string, toolId: string): Promise<void> {
    await this.getById(skillId); // Verify skill exists

    const existing = await db
      .select()
      .from(schema.skillTools)
      .where(and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId)))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError('SkillToolLink', `${skillId}:${toolId}`);
    }

    await db
      .delete(schema.skillTools)
      .where(and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId)));

    logger.info({ skillId, toolId }, 'Tool removed from skill');

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_UPDATED,
      category: 'skill',
      message: `Tool '${toolId}' removed from skill`,
      resourceType: 'skill',
      resourceId: skillId,
      data: { toolId },
    });
  }

  /**
   * Replace all tools for a skill
   */
  async setTools(
    skillId: string,
    tools: Array<{
      toolId: string;
      orderIndex?: number;
      required?: boolean;
      role?: string;
      config?: Record<string, unknown>;
    }>
  ): Promise<SkillToolLink[]> {
    await this.getById(skillId); // Verify skill exists

    // Verify all tools exist
    const toolIds = tools.map((t) => t.toolId);
    const uniqueToolIds = [...new Set(toolIds)];
    if (uniqueToolIds.length !== toolIds.length) {
      throw new ValidationError('Duplicate tool IDs in request');
    }

    if (uniqueToolIds.length > 0) {
      const existingTools = await db.select({ id: schema.tools.id }).from(schema.tools);
      const existingIds = new Set(existingTools.map((t) => t.id));
      const missingIds = uniqueToolIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundError('Tool', missingIds.join(', '));
      }
    }

    const now = nowTimestamp();

    // Delete all existing links
    await db.delete(schema.skillTools).where(eq(schema.skillTools.skillId, skillId));

    // Insert new links
    const links: SkillToolLink[] = [];
    for (let i = 0; i < tools.length; i++) {
      const t = tools[i]!;
      const orderIndex = t.orderIndex ?? i;
      const required = t.required ?? true;

      await db.insert(schema.skillTools).values({
        skillId,
        toolId: t.toolId,
        orderIndex,
        required,
        role: t.role ?? null,
        config: t.config ? JSON.stringify(t.config) : null,
        createdAt: now,
      });

      links.push({
        toolId: t.toolId,
        orderIndex,
        required,
        role: t.role,
        config: t.config,
        createdAt: now,
      });
    }

    logger.info({ skillId, toolCount: tools.length }, 'Skill tools replaced');

    await this.eventService.emit({
      type: EVENT_TYPE.SKILL_UPDATED,
      category: 'skill',
      message: `Skill tools updated (${tools.length} tools)`,
      resourceType: 'skill',
      resourceId: skillId,
      data: { toolIds },
    });

    return links;
  }

  /**
   * Update a tool link in a skill
   */
  async updateToolLink(
    skillId: string,
    toolId: string,
    updates: { orderIndex?: number; required?: boolean; role?: string; config?: Record<string, unknown> }
  ): Promise<SkillToolLink> {
    await this.getById(skillId);

    const existing = await db
      .select()
      .from(schema.skillTools)
      .where(and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId)))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundError('SkillToolLink', `${skillId}:${toolId}`);
    }

    const row = existing[0]!;
    const updateValues: Record<string, unknown> = {};

    if (updates.orderIndex !== undefined) updateValues.orderIndex = updates.orderIndex;
    if (updates.required !== undefined) updateValues.required = updates.required;
    if (updates.role !== undefined) updateValues.role = updates.role;
    if (updates.config !== undefined) updateValues.config = JSON.stringify(updates.config);

    if (Object.keys(updateValues).length > 0) {
      await db
        .update(schema.skillTools)
        .set(updateValues)
        .where(and(eq(schema.skillTools.skillId, skillId), eq(schema.skillTools.toolId, toolId)));
    }

    return {
      toolId,
      orderIndex: updates.orderIndex ?? row.orderIndex,
      required: updates.required ?? row.required,
      role: updates.role ?? row.role ?? undefined,
      config: updates.config ?? parseJsonSafe(row.config),
      createdAt: row.createdAt,
    };
  }

  /**
   * Get tool count for a skill
   */
  async getToolCount(skillId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.skillTools)
      .where(eq(schema.skillTools.skillId, skillId));

    return result[0]?.count ?? 0;
  }
}

import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { ToolDTO, ToolStatus, ToolType } from '../types/domain.js';

const logger = createLogger('ToolService');

export interface CreateToolInput {
  name: string;
  description?: string;
  version?: string;
  path: string;
  type?: ToolType;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  version?: string;
  path?: string;
  type?: ToolType;
  status?: ToolStatus;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

function rowToDTO(row: typeof schema.tools.$inferSelect): ToolDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    path: row.path,
    type: row.type as ToolType,
    status: row.status as ToolStatus,
    inputSchema: parseJsonSafe(row.inputSchema),
    outputSchema: parseJsonSafe(row.outputSchema),
    config: parseJsonSafe(row.config),
    executionCount: row.executionCount,
    lastExecutedAt: row.lastExecutedAt ?? undefined,
    syncedAt: row.syncedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ToolService {
  constructor(private eventService: EventService) {}

  async list(): Promise<ToolDTO[]> {
    const rows = await db.select().from(schema.tools).orderBy(desc(schema.tools.updatedAt));
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<ToolDTO> {
    const rows = await db.select().from(schema.tools).where(eq(schema.tools.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Tool', id);
    return rowToDTO(rows[0]!);
  }

  async getByName(name: string): Promise<ToolDTO | null> {
    const rows = await db.select().from(schema.tools).where(eq(schema.tools.name, name)).limit(1);
    return rows.length > 0 ? rowToDTO(rows[0]!) : null;
  }

  async create(input: CreateToolInput): Promise<ToolDTO> {
    const existing = await this.getByName(input.name);
    if (existing) throw new ConflictError(`Tool '${input.name}' already exists`);

    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.tools).values({
      id,
      name: input.name,
      description: input.description,
      version: input.version ?? '1.0.0',
      path: input.path,
      type: input.type ?? 'script',
      status: 'active',
      inputSchema: input.inputSchema ? JSON.stringify(input.inputSchema) : null,
      outputSchema: input.outputSchema ? JSON.stringify(input.outputSchema) : null,
      config: input.config ? JSON.stringify(input.config) : null,
      executionCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, name: input.name }, 'Tool created');

    await this.eventService.emit({
      type: EVENT_TYPE.TOOL_CREATED,
      category: 'tool',
      message: `Tool '${input.name}' created`,
      resourceType: 'tool',
      resourceId: id,
    });

    return this.getById(id);
  }

  async update(id: string, input: UpdateToolInput): Promise<ToolDTO> {
    const existing = await this.getById(id);
    const now = nowTimestamp();

    if (input.name && input.name !== existing.name) {
      const conflict = await this.getByName(input.name);
      if (conflict) throw new ConflictError(`Tool '${input.name}' already exists`);
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.version !== undefined) updates.version = input.version;
    if (input.path !== undefined) updates.path = input.path;
    if (input.type !== undefined) updates.type = input.type;
    if (input.status !== undefined) updates.status = input.status;
    if (input.inputSchema !== undefined) updates.inputSchema = JSON.stringify(input.inputSchema);
    if (input.outputSchema !== undefined) updates.outputSchema = JSON.stringify(input.outputSchema);
    if (input.config !== undefined) updates.config = JSON.stringify(input.config);

    await db.update(schema.tools).set(updates).where(eq(schema.tools.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TOOL_UPDATED,
      category: 'tool',
      message: `Tool '${input.name ?? existing.name}' updated`,
      resourceType: 'tool',
      resourceId: id,
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await db.delete(schema.tools).where(eq(schema.tools.id, id));
  }

  async recordExecution(id: string): Promise<ToolDTO> {
    const tool = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tools).set({
      executionCount: tool.executionCount + 1,
      lastExecutedAt: now,
      updatedAt: now,
    }).where(eq(schema.tools.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TOOL_EXECUTED,
      category: 'tool',
      message: `Tool '${tool.name}' executed`,
      resourceType: 'tool',
      resourceId: id,
    });

    return this.getById(id);
  }

  async markSynced(id: string): Promise<ToolDTO> {
    const now = nowTimestamp();
    await db.update(schema.tools).set({ syncedAt: now, updatedAt: now }).where(eq(schema.tools.id, id));
    return this.getById(id);
  }

  async assignToAgent(toolId: string, agentId: string): Promise<void> {
    const now = nowTimestamp();
    const existing = await db
      .select()
      .from(schema.agentTools)
      .where(eq(schema.agentTools.toolId, toolId))
      .limit(100);

    if (existing.some(r => r.agentId === agentId)) return;

    await db.insert(schema.agentTools).values({ agentId, toolId, assignedAt: now });
  }

  async unassignFromAgent(toolId: string, agentId: string): Promise<void> {
    await db.delete(schema.agentTools).where(eq(schema.agentTools.toolId, toolId));
  }

  async getAgentTools(agentId: string): Promise<ToolDTO[]> {
    const rows = await db
      .select({ tool: schema.tools })
      .from(schema.agentTools)
      .innerJoin(schema.tools, eq(schema.agentTools.toolId, schema.tools.id))
      .where(eq(schema.agentTools.agentId, agentId));

    return rows.map(r => rowToDTO(r.tool));
  }

  async getActive(): Promise<ToolDTO[]> {
    const rows = await db.select().from(schema.tools).where(eq(schema.tools.status, 'active'));
    return rows.map(rowToDTO);
  }
}

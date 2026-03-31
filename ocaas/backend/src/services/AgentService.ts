import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { systemLogger, logAuditEvent } from '../utils/logger.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE, AGENT_STATUS } from '../config/constants.js';
import { canCreateAgentAutonomously, requiresApprovalForAgentCreation } from '../config/autonomy.js';
import type { EventService } from './EventService.js';
import type { AgentDTO, AgentStatus, AgentType } from '../types/domain.js';

const logger = systemLogger.child({ component: 'AgentService' });

export type AgentCreationSource = 'api' | 'system' | 'generation';

export interface CreateAgentInput {
  name: string;
  description?: string;
  type?: AgentType;
  capabilities?: string[];
  config?: Record<string, unknown>;
  source?: AgentCreationSource;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  type?: AgentType;
  capabilities?: string[];
  config?: Record<string, unknown>;
}

function rowToDTO(row: typeof schema.agents.$inferSelect): AgentDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    type: (row.type as AgentType) ?? 'general',
    status: (row.status as AgentStatus) ?? 'inactive',
    capabilities: parseJsonSafe(row.capabilities),
    config: parseJsonSafe(row.config),
    sessionId: row.sessionId ?? undefined,
    lastActiveAt: row.lastActiveAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AgentService {
  constructor(private eventService: EventService) {}

  async list(): Promise<AgentDTO[]> {
    const rows = await db.select().from(schema.agents).orderBy(desc(schema.agents.updatedAt));
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<AgentDTO> {
    const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Agent', id);
    return rowToDTO(rows[0]!);
  }

  async create(input: CreateAgentInput): Promise<AgentDTO> {
    const source = input.source ?? 'api';

    // Check autonomy permissions for system/generation sources
    if (source === 'system' || source === 'generation') {
      if (!canCreateAgentAutonomously()) {
        throw new ForbiddenError('Autonomous agent creation is disabled by autonomy policy');
      }
    }

    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.agents).values({
      id,
      name: input.name,
      description: input.description,
      type: input.type ?? 'general',
      status: AGENT_STATUS.INACTIVE,
      capabilities: input.capabilities ? JSON.stringify(input.capabilities) : null,
      config: input.config ? JSON.stringify(input.config) : null,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, name: input.name, source }, 'Agent created');

    // Audit log for agent creation
    logAuditEvent({
      action: 'agent.create',
      actor: source === 'api' ? 'user' : 'system',
      resourceType: 'agent',
      resourceId: id,
      outcome: 'success',
      details: { name: input.name, type: input.type ?? 'general', source },
    });

    await this.eventService.emit({
      type: EVENT_TYPE.AGENT_CREATED,
      category: 'agent',
      message: `Agent '${input.name}' created`,
      resourceType: 'agent',
      resourceId: id,
      data: { source },
    });

    return this.getById(id);
  }

  // Check if agent creation requires approval
  requiresApproval(source: AgentCreationSource): boolean {
    if (source === 'api') return false; // Human-initiated via API doesn't need approval
    return requiresApprovalForAgentCreation();
  }

  async update(id: string, input: UpdateAgentInput): Promise<AgentDTO> {
    const existing = await this.getById(id);
    const now = nowTimestamp();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.type !== undefined) updates.type = input.type;
    if (input.capabilities !== undefined) updates.capabilities = JSON.stringify(input.capabilities);
    if (input.config !== undefined) updates.config = JSON.stringify(input.config);

    await db.update(schema.agents).set(updates).where(eq(schema.agents.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.AGENT_UPDATED,
      category: 'agent',
      message: `Agent '${input.name ?? existing.name}' updated`,
      resourceType: 'agent',
      resourceId: id,
    });

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    await db.delete(schema.agents).where(eq(schema.agents.id, id));

    // Audit log for agent deletion
    logAuditEvent({
      action: 'agent.delete',
      actor: 'user',
      resourceType: 'agent',
      resourceId: id,
      outcome: 'success',
      details: { name: existing.name },
    });

    await this.eventService.emit({
      type: EVENT_TYPE.AGENT_DELETED,
      category: 'agent',
      message: `Agent '${existing.name}' deleted`,
      resourceType: 'agent',
      resourceId: id,
    });
  }

  async activate(id: string, sessionId?: string): Promise<AgentDTO> {
    const agent = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.agents).set({
      status: AGENT_STATUS.ACTIVE,
      sessionId,
      lastActiveAt: now,
      updatedAt: now,
    }).where(eq(schema.agents.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.AGENT_ACTIVATED,
      category: 'agent',
      message: `Agent '${agent.name}' activated`,
      resourceType: 'agent',
      resourceId: id,
      agentId: id,
    });

    return this.getById(id);
  }

  async deactivate(id: string): Promise<AgentDTO> {
    const agent = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.agents).set({
      status: AGENT_STATUS.INACTIVE,
      sessionId: null,
      updatedAt: now,
    }).where(eq(schema.agents.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.AGENT_DEACTIVATED,
      category: 'agent',
      message: `Agent '${agent.name}' deactivated`,
      resourceType: 'agent',
      resourceId: id,
      agentId: id,
    });

    return this.getById(id);
  }

  async setStatus(id: string, status: AgentStatus): Promise<AgentDTO> {
    await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.agents).set({
      status,
      updatedAt: now,
    }).where(eq(schema.agents.id, id));

    return this.getById(id);
  }

  async getActive(): Promise<AgentDTO[]> {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.status, AGENT_STATUS.ACTIVE));
    return rows.map(rowToDTO);
  }

  async getByCapability(capability: string): Promise<AgentDTO[]> {
    const all = await this.list();
    return all.filter(a => a.capabilities?.includes(capability));
  }
}

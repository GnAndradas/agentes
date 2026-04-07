import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { systemLogger, logAuditEvent } from '../utils/logger.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE, AGENT_STATUS } from '../config/constants.js';
import { canCreateAgentAutonomously, requiresApprovalForAgentCreation } from '../config/autonomy.js';
import {
  computeMaterializationStatus,
  getStatusDescription,
  materializeAgent,
  getAgentWorkspace,
  type AgentMaterializationStatus,
  type AgentLifecycleState,
  type MaterializationTraceability,
} from '../generator/AgentMaterialization.js';
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

    // P0-A: Auto-materialize agent on activation if not already materialized
    try {
      await this.materializeIfNeeded(agent);
    } catch (err) {
      // Non-blocking - log but don't fail activation
      logger.warn(
        { agentId: id, error: err },
        '[AgentService] Materialization failed during activation (non-blocking)'
      );
    }

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

  // ============================================================================
  // BLOQUE 9 + P0-A: MATERIALIZATION
  // ============================================================================

  /**
   * P0-A: Materialize an agent - create workspace files
   * Call this after activation to ensure agent is ready
   */
  async materialize(id: string, source: 'activation' | 'manual' | 'system' = 'manual'): Promise<MaterializationTraceability> {
    const agent = await this.getById(id);

    // Check if already materialized
    const workspace = getAgentWorkspace(agent.name);
    if (workspace.exists) {
      logger.info(
        { agentId: id, agent: agent.name },
        '[AgentMaterialization] already materialized, skipping'
      );
      return {
        attempted_at: Date.now(),
        source,
        steps_attempted: [],
        steps_completed: [],
        steps_failed: [],
        final_state: 'materialized',
        runtime_ready: false,
        gap: 'Already materialized',
      };
    }

    const trace = await materializeAgent(
      agent.name,
      agent.type || 'general',
      agent.description,
      agent.capabilities || [],
      (agent.config as Record<string, unknown>) || {},
      source
    );

    logger.info(
      { agentId: id, agent: agent.name, state: trace.final_state },
      '[AgentMaterialization] materialization completed'
    );

    return trace;
  }

  /**
   * P0-A: Internal - materialize if workspace doesn't exist
   */
  private async materializeIfNeeded(agent: AgentDTO): Promise<void> {
    const workspace = getAgentWorkspace(agent.name);
    if (workspace.exists) {
      logger.debug({ agent: agent.name }, '[AgentMaterialization] workspace exists, skipping');
      return;
    }

    const trace = await materializeAgent(
      agent.name,
      agent.type || 'general',
      agent.description,
      agent.capabilities || [],
      (agent.config as Record<string, unknown>) || {},
      'activation'
    );

    if (trace.final_state !== 'materialized') {
      logger.warn(
        { agent: agent.name, state: trace.final_state, gap: trace.gap },
        '[AgentMaterialization] materialization incomplete'
      );
    }
  }

  /**
   * Get materialization status for an agent
   * BLOQUE 9: Explicit separation between db record, activated, materialized, runtime-ready
   */
  async getMaterializationStatus(id: string): Promise<AgentMaterializationStatus> {
    const agent = await this.getById(id);

    // Check if agent has active generation (stored in config)
    const config = agent.config as Record<string, unknown> | undefined;
    const materializationData = config?._materialization as Record<string, unknown> | undefined;
    const hasActiveGeneration = !!materializationData;

    return computeMaterializationStatus(
      agent.name,
      true, // has DB record since we fetched it
      hasActiveGeneration,
      agent.sessionId
    );
  }

  /**
   * Get lifecycle state for an agent
   * BLOQUE 9: Returns explicit lifecycle state
   */
  async getLifecycleState(id: string): Promise<{
    state: AgentLifecycleState;
    description: string;
    runtime_ready: boolean;
  }> {
    const status = await this.getMaterializationStatus(id);
    return {
      state: status.state,
      description: getStatusDescription(status),
      runtime_ready: status.openclaw_session,
    };
  }

  /**
   * List agents with their materialization status
   * BLOQUE 9: Includes lifecycle state for each agent
   */
  async listWithMaterializationStatus(): Promise<Array<AgentDTO & {
    lifecycle_state: AgentLifecycleState;
    runtime_ready: boolean;
    status_description: string;
  }>> {
    const agents = await this.list();

    return agents.map(agent => {
      const config = agent.config as Record<string, unknown> | undefined;
      const materializationData = config?._materialization as Record<string, unknown> | undefined;
      const hasActiveGeneration = !!materializationData;

      const matStatus = computeMaterializationStatus(
        agent.name,
        true,
        hasActiveGeneration,
        agent.sessionId
      );

      return {
        ...agent,
        lifecycle_state: matStatus.state,
        runtime_ready: matStatus.openclaw_session,
        status_description: getStatusDescription(matStatus),
      };
    });
  }

  // ============================================================================
  // PROMPT 13: BUNDLE GUARD
  // ============================================================================

  /**
   * Check if agent is from an incomplete bundle
   *
   * PROMPT 13: Agents from partial bundles should NOT be used for task execution.
   * Returns true if agent belongs to a bundle with bundleStatus !== 'complete'
   */
  async isFromIncompleteBundle(id: string): Promise<boolean> {
    const agent = await this.getById(id);
    const config = agent.config as Record<string, unknown> | undefined;

    // Check if agent config has bundle metadata
    const bundleId = config?.bundleId as string | undefined;
    const bundleStatus = config?.bundleStatus as string | undefined;

    // If no bundle metadata, agent is not from a bundle - OK to use
    if (!bundleId) {
      return false;
    }

    // If bundleStatus explicitly set in config, use it
    if (bundleStatus) {
      return bundleStatus !== 'complete';
    }

    // Fallback: check generation record if agent has generationId
    const generationId = config?.generationId as string | undefined;
    if (generationId) {
      try {
        // Query generation directly to avoid circular dependency
        const rows = await db
          .select()
          .from(schema.generations)
          .where(eq(schema.generations.id, generationId))
          .limit(1);

        if (rows.length > 0) {
          const genMeta = parseJsonSafe(rows[0]!.metadata) as Record<string, unknown> | undefined;
          if (genMeta?.bundleStatus) {
            return genMeta.bundleStatus !== 'complete';
          }
        }
      } catch {
        // If query fails, assume incomplete for safety
        logger.warn({ agentId: id, generationId }, 'Failed to check bundle status from generation');
        return true;
      }
    }

    // Has bundleId but no status - treat as incomplete
    return true;
  }

  /**
   * Validate agent is ready for execution
   *
   * PROMPT 13: Guards against using agents from incomplete bundles.
   * Throws ForbiddenError if agent cannot be used.
   */
  async validateForExecution(id: string): Promise<void> {
    const isIncomplete = await this.isFromIncompleteBundle(id);
    if (isIncomplete) {
      throw new ForbiddenError('Agent bundle incomplete - cannot execute');
    }
  }
}

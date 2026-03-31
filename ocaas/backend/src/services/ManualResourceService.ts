import { nanoid } from 'nanoid';
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { systemLogger, logAuditEvent } from '../utils/logger.js';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE } from '../config/constants.js';
import { getWorkspaceSync } from '../openclaw/index.js';
import {
  DRAFT_STATUS,
  RESOURCE_TYPE,
  type DraftStatus,
  type ResourceType,
} from '../db/schema/drafts.js';
import type { EventService } from './EventService.js';
import type { AgentService } from './AgentService.js';
import type { SkillService } from './SkillService.js';
import type { ToolService } from './ToolService.js';

const logger = systemLogger.child({ component: 'ManualResourceService' });

// ============================================================================
// Types
// ============================================================================

/**
 * Content for Agent drafts
 */
export interface AgentDraftContent {
  type?: 'general' | 'specialist' | 'orchestrator';
  capabilities?: string[];
  config?: Record<string, unknown>;
  skillIds?: string[];
  toolIds?: string[];
  supervisorId?: string;
}

/**
 * Content for Skill drafts
 */
export interface SkillDraftContent {
  files: Record<string, string>; // filename -> content
  capabilities?: string[];
  version?: string;
  requirements?: string[];
}

/**
 * Content for Tool drafts
 */
export interface ToolDraftContent {
  type: 'sh' | 'py';
  script: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  version?: string;
}

export type DraftContent = AgentDraftContent | SkillDraftContent | ToolDraftContent;

/**
 * DTO returned by the service
 */
export interface ResourceDraftDTO {
  id: string;
  resourceType: ResourceType;
  name: string;
  slug: string;
  description?: string;
  status: DraftStatus;
  content: DraftContent;
  validationResult?: {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  };
  submittedAt?: number;
  submittedBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  rejectionReason?: string;
  activatedAt?: number;
  activeResourceId?: string;
  parentDraftId?: string;
  revision: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

/**
 * Input for creating a draft
 */
export interface CreateDraftInput {
  resourceType: ResourceType;
  name: string;
  description?: string;
  content: DraftContent;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

/**
 * Input for updating a draft
 */
export interface UpdateDraftInput {
  name?: string;
  description?: string;
  content?: DraftContent;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Helper functions
// ============================================================================

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rowToDTO(row: typeof schema.resourceDrafts.$inferSelect): ResourceDraftDTO {
  return {
    id: row.id,
    resourceType: row.resourceType as ResourceType,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    status: row.status as DraftStatus,
    content: parseJsonSafe<DraftContent>(row.content) ?? ({} as DraftContent),
    validationResult: parseJsonSafe(row.validationResult),
    submittedAt: row.submittedAt ?? undefined,
    submittedBy: row.submittedBy ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    rejectedAt: row.rejectedAt ?? undefined,
    rejectedBy: row.rejectedBy ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    activatedAt: row.activatedAt ?? undefined,
    activeResourceId: row.activeResourceId ?? undefined,
    parentDraftId: row.parentDraftId ?? undefined,
    revision: row.revision,
    metadata: parseJsonSafe(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ?? undefined,
  };
}

// ============================================================================
// ManualResourceService
// ============================================================================

/**
 * Service for managing manual resource creation workflow
 *
 * FSM: draft → pending_approval → approved → active
 *                    ↓
 *               rejected
 *
 * This service:
 * - Manages drafts in the resource_drafts table
 * - Delegates to existing services (AgentService, SkillService, ToolService) for activation
 * - Uses WorkspaceSync for writing files (skills/tools)
 * - Emits events via EventService
 *
 * Does NOT duplicate:
 * - Agent/Skill/Tool creation logic (uses existing services)
 * - File writing (uses WorkspaceSync)
 * - Event emission patterns
 */
export class ManualResourceService {
  private onActivatedCallback: ((draftId: string) => Promise<void>) | null = null;

  constructor(
    private eventService: EventService,
    private agentService: AgentService,
    private skillService: SkillService,
    private toolService: ToolService
  ) {}

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new draft
   */
  async createDraft(input: CreateDraftInput): Promise<ResourceDraftDTO> {
    const now = nowTimestamp();
    const id = nanoid();
    const slug = slugify(input.name);

    // Check for duplicate slug within same type
    const existing = await this.getBySlug(input.resourceType, slug);
    if (existing && existing.status !== DRAFT_STATUS.REJECTED) {
      throw new ConflictError(
        `Draft with slug '${slug}' already exists for ${input.resourceType}`
      );
    }

    // Validate content based on type
    this.validateContent(input.resourceType, input.content);

    await db.insert(schema.resourceDrafts).values({
      id,
      resourceType: input.resourceType,
      name: input.name,
      slug,
      description: input.description,
      status: DRAFT_STATUS.DRAFT,
      content: JSON.stringify(input.content),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
    });

    logger.info({ id, resourceType: input.resourceType, name: input.name }, 'Draft created');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_CREATED,
      category: 'manual_resource',
      message: `Draft '${input.name}' created for ${input.resourceType}`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: input.resourceType, name: input.name, slug },
    });

    return this.getById(id);
  }

  /**
   * Update an existing draft
   * Only allowed in 'draft' or 'rejected' status
   */
  async updateDraft(id: string, input: UpdateDraftInput): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    // FSM: can only update in draft or rejected status
    if (draft.status !== DRAFT_STATUS.DRAFT && draft.status !== DRAFT_STATUS.REJECTED) {
      throw new ValidationError(
        `Cannot update draft in status '${draft.status}'. Only 'draft' or 'rejected' allowed.`
      );
    }

    const now = nowTimestamp();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (input.name !== undefined) {
      updates.name = input.name;
      updates.slug = slugify(input.name);
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.content !== undefined) {
      this.validateContent(draft.resourceType, input.content);
      updates.content = JSON.stringify(input.content);
    }
    if (input.metadata !== undefined) {
      updates.metadata = JSON.stringify(input.metadata);
    }

    // If updating from rejected, reset to draft
    if (draft.status === DRAFT_STATUS.REJECTED) {
      updates.status = DRAFT_STATUS.DRAFT;
      updates.rejectedAt = null;
      updates.rejectedBy = null;
      updates.rejectionReason = null;
    }

    await db.update(schema.resourceDrafts).set(updates).where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, updates: Object.keys(input) }, 'Draft updated');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_UPDATED,
      category: 'manual_resource',
      message: `Draft '${input.name ?? draft.name}' updated`,
      resourceType: 'draft',
      resourceId: id,
    });

    return this.getById(id);
  }

  /**
   * Get draft by ID
   */
  async getById(id: string): Promise<ResourceDraftDTO> {
    const rows = await db
      .select()
      .from(schema.resourceDrafts)
      .where(eq(schema.resourceDrafts.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Draft', id);
    }

    return rowToDTO(rows[0]!);
  }

  /**
   * Get draft by slug and type
   */
  async getBySlug(resourceType: ResourceType, slug: string): Promise<ResourceDraftDTO | null> {
    const rows = await db
      .select()
      .from(schema.resourceDrafts)
      .where(
        and(
          eq(schema.resourceDrafts.resourceType, resourceType),
          eq(schema.resourceDrafts.slug, slug)
        )
      )
      .limit(1);

    return rows.length > 0 ? rowToDTO(rows[0]!) : null;
  }

  /**
   * List drafts with optional filters
   */
  async list(opts?: {
    resourceType?: ResourceType;
    status?: DraftStatus;
  }): Promise<ResourceDraftDTO[]> {
    let query = db.select().from(schema.resourceDrafts);

    if (opts?.resourceType && opts?.status) {
      query = query.where(
        and(
          eq(schema.resourceDrafts.resourceType, opts.resourceType),
          eq(schema.resourceDrafts.status, opts.status)
        )
      ) as typeof query;
    } else if (opts?.resourceType) {
      query = query.where(eq(schema.resourceDrafts.resourceType, opts.resourceType)) as typeof query;
    } else if (opts?.status) {
      query = query.where(eq(schema.resourceDrafts.status, opts.status)) as typeof query;
    }

    const rows = await query.orderBy(desc(schema.resourceDrafts.updatedAt));
    return rows.map(rowToDTO);
  }

  /**
   * Delete a draft
   * Only allowed in 'draft' or 'rejected' status
   */
  async delete(id: string): Promise<void> {
    const draft = await this.getById(id);

    if (draft.status !== DRAFT_STATUS.DRAFT && draft.status !== DRAFT_STATUS.REJECTED) {
      throw new ValidationError(
        `Cannot delete draft in status '${draft.status}'. Only 'draft' or 'rejected' allowed.`
      );
    }

    await db.delete(schema.resourceDrafts).where(eq(schema.resourceDrafts.id, id));
    logger.info({ id }, 'Draft deleted');
  }

  // ==========================================================================
  // Workflow Operations
  // ==========================================================================

  /**
   * Submit draft for approval
   * FSM: draft → pending_approval
   */
  async submitForApproval(id: string, submittedBy?: string): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    // FSM check
    if (draft.status !== DRAFT_STATUS.DRAFT) {
      throw new ValidationError(
        `Cannot submit draft in status '${draft.status}'. Expected 'draft'.`
      );
    }

    // Validate content before submission
    const validation = this.validateContentFull(draft.resourceType, draft.content);

    const now = nowTimestamp();
    await db
      .update(schema.resourceDrafts)
      .set({
        status: DRAFT_STATUS.PENDING_APPROVAL,
        validationResult: JSON.stringify(validation),
        submittedAt: now,
        submittedBy: submittedBy ?? 'system',
        updatedAt: now,
      })
      .where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, submittedBy }, 'Draft submitted for approval');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_SUBMITTED,
      category: 'manual_resource',
      message: `Draft '${draft.name}' submitted for approval`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: draft.resourceType, validation },
    });

    return this.getById(id);
  }

  /**
   * Approve a draft
   * FSM: pending_approval → approved
   */
  async approve(id: string, approvedBy: string): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    // FSM check
    if (draft.status !== DRAFT_STATUS.PENDING_APPROVAL) {
      if (draft.status === DRAFT_STATUS.APPROVED) {
        logger.info({ id }, 'Draft already approved (idempotent)');
        return draft;
      }
      throw new ValidationError(
        `Cannot approve draft in status '${draft.status}'. Expected 'pending_approval'.`
      );
    }

    const now = nowTimestamp();
    await db
      .update(schema.resourceDrafts)
      .set({
        status: DRAFT_STATUS.APPROVED,
        approvedAt: now,
        approvedBy,
        updatedAt: now,
      })
      .where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, approvedBy }, 'Draft approved');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_APPROVED,
      category: 'manual_resource',
      message: `Draft '${draft.name}' approved by ${approvedBy}`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: draft.resourceType, approvedBy },
    });

    return this.getById(id);
  }

  /**
   * Reject a draft
   * FSM: pending_approval → rejected
   */
  async reject(id: string, rejectedBy: string, reason?: string): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    // FSM check
    if (draft.status !== DRAFT_STATUS.PENDING_APPROVAL) {
      if (draft.status === DRAFT_STATUS.REJECTED) {
        logger.info({ id }, 'Draft already rejected (idempotent)');
        return draft;
      }
      throw new ValidationError(
        `Cannot reject draft in status '${draft.status}'. Expected 'pending_approval'.`
      );
    }

    const now = nowTimestamp();
    await db
      .update(schema.resourceDrafts)
      .set({
        status: DRAFT_STATUS.REJECTED,
        rejectedAt: now,
        rejectedBy,
        rejectionReason: reason,
        updatedAt: now,
      })
      .where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, rejectedBy, reason }, 'Draft rejected');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_REJECTED,
      category: 'manual_resource',
      severity: 'warning',
      message: `Draft '${draft.name}' rejected by ${rejectedBy}`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: draft.resourceType, rejectedBy, reason },
    });

    return this.getById(id);
  }

  /**
   * Activate an approved draft - creates the actual resource
   * FSM: approved → active
   *
   * Delegates to existing services:
   * - AgentService.create() for agents
   * - SkillService.create() for skills (after writing files via WorkspaceSync)
   * - ToolService.create() for tools (after writing files via WorkspaceSync)
   */
  async activate(id: string): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    // FSM check
    if (draft.status !== DRAFT_STATUS.APPROVED) {
      if (draft.status === DRAFT_STATUS.ACTIVE) {
        logger.info({ id }, 'Draft already active (idempotent)');
        return draft;
      }
      throw new ValidationError(
        `Cannot activate draft in status '${draft.status}'. Expected 'approved'.`
      );
    }

    let activeResourceId: string;

    try {
      switch (draft.resourceType) {
        case RESOURCE_TYPE.AGENT:
          activeResourceId = await this.activateAgent(draft);
          break;
        case RESOURCE_TYPE.SKILL:
          activeResourceId = await this.activateSkill(draft);
          break;
        case RESOURCE_TYPE.TOOL:
          activeResourceId = await this.activateTool(draft);
          break;
        default:
          throw new Error(`Unknown resource type: ${draft.resourceType}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, id, resourceType: draft.resourceType }, 'Activation failed');

      // Emit failure event but don't change status (keep as approved for retry)
      await this.eventService.emit({
        type: EVENT_TYPE.MANUAL_RESOURCE_FAILED,
        category: 'manual_resource',
        severity: 'error',
        message: `Failed to activate draft '${draft.name}': ${message}`,
        resourceType: 'draft',
        resourceId: id,
        data: { resourceType: draft.resourceType, error: message },
      });

      throw err;
    }

    const now = nowTimestamp();
    await db
      .update(schema.resourceDrafts)
      .set({
        status: DRAFT_STATUS.ACTIVE,
        activatedAt: now,
        activeResourceId,
        updatedAt: now,
      })
      .where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, resourceType: draft.resourceType, activeResourceId }, 'Draft activated');

    // Audit log for resource activation
    logAuditEvent({
      action: 'resource.activate',
      actor: 'system',
      resourceType: draft.resourceType,
      resourceId: activeResourceId,
      outcome: 'success',
      details: { draftId: id, name: draft.name },
    });

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_ACTIVATED,
      category: 'manual_resource',
      message: `Draft '${draft.name}' activated as ${draft.resourceType}`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: draft.resourceType, activeResourceId },
    });

    // Trigger callback for task retry loop
    if (this.onActivatedCallback) {
      try {
        await this.onActivatedCallback(id);
      } catch (err) {
        logger.error({ err, id }, 'Failed to execute onActivated callback');
      }
    }

    return this.getById(id);
  }

  /**
   * Set callback to be called when a resource is activated
   * Used by orchestrator to trigger task retries
   */
  setOnActivatedCallback(callback: (draftId: string) => Promise<void>): void {
    this.onActivatedCallback = callback;
  }

  /**
   * Deactivate an active resource
   * This marks the draft as no longer active but keeps the created resource
   */
  async deactivate(id: string): Promise<ResourceDraftDTO> {
    const draft = await this.getById(id);

    if (draft.status !== DRAFT_STATUS.ACTIVE) {
      throw new ValidationError(
        `Cannot deactivate draft in status '${draft.status}'. Expected 'active'.`
      );
    }

    const now = nowTimestamp();
    await db
      .update(schema.resourceDrafts)
      .set({
        status: DRAFT_STATUS.APPROVED, // Go back to approved
        activatedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.resourceDrafts.id, id));

    logger.info({ id, activeResourceId: draft.activeResourceId }, 'Draft deactivated');

    await this.eventService.emit({
      type: EVENT_TYPE.MANUAL_RESOURCE_DEACTIVATED,
      category: 'manual_resource',
      message: `Draft '${draft.name}' deactivated`,
      resourceType: 'draft',
      resourceId: id,
      data: { resourceType: draft.resourceType, activeResourceId: draft.activeResourceId },
    });

    return this.getById(id);
  }

  // ==========================================================================
  // Private: Type-specific activation
  // ==========================================================================

  private async activateAgent(draft: ResourceDraftDTO): Promise<string> {
    const content = draft.content as AgentDraftContent;

    const agent = await this.agentService.create({
      name: draft.name,
      description: draft.description,
      type: content.type ?? 'general',
      capabilities: content.capabilities,
      config: content.config,
      source: 'api', // Manual = API (human initiated)
    });

    return agent.id;
  }

  private async activateSkill(draft: ResourceDraftDTO): Promise<string> {
    const content = draft.content as SkillDraftContent;
    const workspaceSync = getWorkspaceSync();

    // Write skill files to workspace
    const skillPath = await workspaceSync.writeSkill(draft.name, content.files);

    // Create skill in DB
    const skill = await this.skillService.create({
      name: draft.name,
      description: draft.description,
      path: skillPath,
      version: content.version,
      capabilities: content.capabilities,
      requirements: content.requirements,
    });

    return skill.id;
  }

  private async activateTool(draft: ResourceDraftDTO): Promise<string> {
    const content = draft.content as ToolDraftContent;
    const workspaceSync = getWorkspaceSync();

    // Write tool script to workspace
    const toolPath = await workspaceSync.writeTool(draft.name, content.script, content.type);

    // Create tool in DB
    const tool = await this.toolService.create({
      name: draft.name,
      description: draft.description,
      path: toolPath,
      version: content.version,
      type: 'script',
      inputSchema: content.inputSchema,
      outputSchema: content.outputSchema,
    });

    return tool.id;
  }

  // ==========================================================================
  // Private: Validation
  // ==========================================================================

  /**
   * Basic validation during create/update
   */
  private validateContent(resourceType: ResourceType, content: DraftContent): void {
    switch (resourceType) {
      case RESOURCE_TYPE.AGENT:
        // Agents are flexible, minimal validation
        break;

      case RESOURCE_TYPE.SKILL: {
        const skillContent = content as SkillDraftContent;
        if (!skillContent.files || Object.keys(skillContent.files).length === 0) {
          throw new ValidationError('Skill content must include files');
        }
        break;
      }

      case RESOURCE_TYPE.TOOL: {
        const toolContent = content as ToolDraftContent;
        if (!toolContent.script) {
          throw new ValidationError('Tool content must include script');
        }
        if (!toolContent.type || !['sh', 'py'].includes(toolContent.type)) {
          throw new ValidationError("Tool content must specify type: 'sh' or 'py'");
        }
        break;
      }
    }
  }

  /**
   * Full validation for submission
   */
  private validateContentFull(
    resourceType: ResourceType,
    content: DraftContent
  ): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    this.validateContent(resourceType, content);

    switch (resourceType) {
      case RESOURCE_TYPE.SKILL: {
        const skillContent = content as SkillDraftContent;
        // Check for required skill files
        if (!skillContent.files['SKILL.md']) {
          warnings.push('Missing SKILL.md file');
        }
        if (!skillContent.files['agent-instructions.md']) {
          warnings.push('Missing agent-instructions.md file');
        }
        break;
      }

      case RESOURCE_TYPE.TOOL: {
        const toolContent = content as ToolDraftContent;
        // Check for shebang
        if (toolContent.type === 'sh' && !toolContent.script.startsWith('#!/')) {
          warnings.push('Shell script missing shebang');
        }
        if (toolContent.type === 'py' && !toolContent.script.includes('#!/')) {
          warnings.push('Python script missing shebang');
        }
        break;
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  // ==========================================================================
  // Convenience queries
  // ==========================================================================

  async getPendingApproval(): Promise<ResourceDraftDTO[]> {
    return this.list({ status: DRAFT_STATUS.PENDING_APPROVAL });
  }

  async getActive(): Promise<ResourceDraftDTO[]> {
    return this.list({ status: DRAFT_STATUS.ACTIVE });
  }
}

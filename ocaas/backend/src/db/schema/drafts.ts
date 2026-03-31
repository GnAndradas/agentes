import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Draft status for manual resources
 *
 * FSM: draft → pending_approval → approved → active
 *                    ↓
 *                rejected
 */
export const DRAFT_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
} as const;

export type DraftStatus = typeof DRAFT_STATUS[keyof typeof DRAFT_STATUS];

export const RESOURCE_TYPE = {
  AGENT: 'agent',
  SKILL: 'skill',
  TOOL: 'tool',
} as const;

export type ResourceType = typeof RESOURCE_TYPE[keyof typeof RESOURCE_TYPE];

/**
 * Unified drafts table for all manual resources
 *
 * Design decision: Single table instead of separate tables per type
 * Rationale:
 * - Simpler FSM logic (one service, one set of transitions)
 * - Unified approval workflow
 * - Easier to query pending approvals across all types
 * - Content stored as JSON allows type-specific data
 * - activeResourceId links to the final resource after activation
 */
export const resourceDrafts = sqliteTable('resource_drafts', {
  id: text('id').primaryKey(),

  // Resource identification
  resourceType: text('resource_type').notNull(), // 'agent' | 'skill' | 'tool'
  name: text('name').notNull(),
  slug: text('slug').notNull(), // URL-safe identifier, unique per type
  description: text('description'),

  // FSM state
  status: text('status').notNull().default('draft'),

  // Content (JSON - structure depends on resourceType)
  content: text('content').notNull(), // JSON: type-specific content

  // Validation
  validationResult: text('validation_result'), // JSON: validation errors/warnings

  // Approval tracking
  submittedAt: integer('submitted_at'),
  submittedBy: text('submitted_by'),
  approvedAt: integer('approved_at'),
  approvedBy: text('approved_by'),
  rejectedAt: integer('rejected_at'),
  rejectedBy: text('rejected_by'),
  rejectionReason: text('rejection_reason'),

  // Activation
  activatedAt: integer('activated_at'),
  activeResourceId: text('active_resource_id'), // ID in agents/skills/tools table

  // Revision tracking (for editing active resources)
  parentDraftId: text('parent_draft_id'), // If this is a revision of another draft
  revision: integer('revision').notNull().default(1),

  // Metadata
  metadata: text('metadata'), // JSON: additional data
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  createdBy: text('created_by'),
});

export type ResourceDraftRow = typeof resourceDrafts.$inferSelect;
export type NewResourceDraftRow = typeof resourceDrafts.$inferInsert;

/**
 * Content structures per type (for documentation and validation)
 *
 * AgentDraftContent:
 * {
 *   type: 'general' | 'specialist' | 'orchestrator',
 *   capabilities: string[],
 *   config: Record<string, unknown>,
 *   skillIds?: string[],
 *   toolIds?: string[],
 *   supervisorId?: string,
 * }
 *
 * SkillDraftContent:
 * {
 *   files: Record<string, string>, // filename -> content
 *   capabilities: string[],
 *   version?: string,
 *   requirements?: string[],
 * }
 *
 * ToolDraftContent:
 * {
 *   type: 'sh' | 'py',
 *   script: string,
 *   inputSchema?: Record<string, unknown>,
 *   outputSchema?: Record<string, unknown>,
 *   version?: string,
 * }
 */

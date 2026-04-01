import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Human Escalations Table
 *
 * Tracks all escalations to human ("DIOS") for intervention.
 * Provides a unified inbox for human operators.
 */
export const humanEscalations = sqliteTable('human_escalations', {
  // Primary key
  id: text('id').primaryKey(),

  // Escalation classification
  type: text('type').notNull(), // approval_required, resource_missing, permission_denied, execution_failure, uncertainty, blocked
  priority: text('priority').notNull().default('normal'), // critical, high, normal, low

  // What is being escalated
  taskId: text('task_id'),
  agentId: text('agent_id'),
  resourceType: text('resource_type'), // agent, skill, tool, task, approval
  resourceId: text('resource_id'),

  // Escalation details
  reason: text('reason').notNull(),
  context: text('context'), // JSON with relevant context
  checkpointStage: text('checkpoint_stage'),

  // Status tracking
  status: text('status').notNull().default('pending'), // pending, acknowledged, resolved, expired, cancelled
  acknowledgedAt: integer('acknowledged_at'),
  acknowledgedBy: text('acknowledged_by'),

  // Resolution
  resolution: text('resolution'), // approved, rejected, resource_provided, overridden, auto_resolved, timed_out
  resolutionDetails: text('resolution_details'), // JSON with resolution data
  resolvedAt: integer('resolved_at'),
  resolvedBy: text('resolved_by'),

  // Timeout configuration
  expiresAt: integer('expires_at'),
  fallbackAction: text('fallback_action'), // retry, fail, escalate_higher, auto_approve

  // Linked resources
  linkedApprovalId: text('linked_approval_id'),
  linkedFeedbackId: text('linked_feedback_id'),
  linkedGenerationId: text('linked_generation_id'),

  // Metadata
  metadata: text('metadata'), // JSON

  // Timestamps
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type HumanEscalationRow = typeof humanEscalations.$inferSelect;
export type NewHumanEscalationRow = typeof humanEscalations.$inferInsert;

/**
 * Escalation Types
 */
export const ESCALATION_TYPE = {
  APPROVAL_REQUIRED: 'approval_required',
  RESOURCE_MISSING: 'resource_missing',
  PERMISSION_DENIED: 'permission_denied',
  EXECUTION_FAILURE: 'execution_failure',
  UNCERTAINTY: 'uncertainty',
  BLOCKED: 'blocked',
  TIMEOUT: 'timeout',
  POLICY_VIOLATION: 'policy_violation',
} as const;

export type EscalationType = typeof ESCALATION_TYPE[keyof typeof ESCALATION_TYPE];

/**
 * Escalation Status
 */
export const ESCALATION_STATUS = {
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type EscalationStatus = typeof ESCALATION_STATUS[keyof typeof ESCALATION_STATUS];

/**
 * Escalation Priority
 */
export const ESCALATION_PRIORITY = {
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
} as const;

export type EscalationPriority = typeof ESCALATION_PRIORITY[keyof typeof ESCALATION_PRIORITY];

/**
 * Resolution Types
 */
export const RESOLUTION_TYPE = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RESOURCE_PROVIDED: 'resource_provided',
  OVERRIDDEN: 'overridden',
  AUTO_RESOLVED: 'auto_resolved',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
} as const;

export type ResolutionType = typeof RESOLUTION_TYPE[keyof typeof RESOLUTION_TYPE];

/**
 * Fallback Actions
 */
export const FALLBACK_ACTION = {
  RETRY: 'retry',
  FAIL: 'fail',
  ESCALATE_HIGHER: 'escalate_higher',
  AUTO_APPROVE: 'auto_approve',
  PAUSE: 'pause',
} as const;

export type FallbackAction = typeof FALLBACK_ACTION[keyof typeof FALLBACK_ACTION];

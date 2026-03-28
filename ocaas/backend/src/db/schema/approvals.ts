import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'task' | 'agent' | 'skill' | 'tool'
  resourceId: text('resource_id'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'expired'
  requestedAt: integer('requested_at').notNull(),
  expiresAt: integer('expires_at'),
  respondedAt: integer('responded_at'),
  respondedBy: text('responded_by'),
  reason: text('reason'),
  metadata: text('metadata'), // JSON object
});

export type ApprovalRow = typeof approvals.$inferSelect;
export type NewApprovalRow = typeof approvals.$inferInsert;

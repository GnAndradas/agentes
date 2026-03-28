import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  resourceType: text('resource_type').notNull(), // tool, skill, task_type, system
  resourceId: text('resource_id'), // specific ID or '*' for all
  level: integer('level').notNull().default(1), // 0-4
  constraints: text('constraints'), // JSON
  expiresAt: integer('expires_at'),
  grantedBy: text('granted_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type PermissionRow = typeof permissions.$inferSelect;
export type NewPermissionRow = typeof permissions.$inferInsert;

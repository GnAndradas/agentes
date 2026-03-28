import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('general'),
  status: text('status').notNull().default('inactive'),
  capabilities: text('capabilities'), // JSON array
  config: text('config'), // JSON object
  sessionId: text('session_id'),
  lastActiveAt: integer('last_active_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;

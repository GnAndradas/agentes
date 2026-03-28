import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  severity: text('severity').notNull().default('info'),
  message: text('message').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  agentId: text('agent_id'),
  data: text('data'), // JSON
  createdAt: integer('created_at').notNull(),
});

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: integer('updated_at').notNull(),
});

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;

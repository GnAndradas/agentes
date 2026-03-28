import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const tools = sqliteTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  version: text('version').notNull().default('1.0.0'),
  path: text('path').notNull(),
  type: text('type').notNull().default('script'),
  status: text('status').notNull().default('active'),
  inputSchema: text('input_schema'), // JSON Schema
  outputSchema: text('output_schema'), // JSON Schema
  config: text('config'), // JSON
  executionCount: integer('execution_count').notNull().default(0),
  lastExecutedAt: integer('last_executed_at'),
  syncedAt: integer('synced_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const agentTools = sqliteTable(
  'agent_tools',
  {
    agentId: text('agent_id').notNull(),
    toolId: text('tool_id').notNull(),
    assignedAt: integer('assigned_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.toolId] }),
  })
);

export type ToolRow = typeof tools.$inferSelect;
export type NewToolRow = typeof tools.$inferInsert;

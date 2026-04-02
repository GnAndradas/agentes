import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Jobs table schema
 *
 * Stores execution records for OpenClaw runtime.
 * Each job represents a single execution attempt for a task by an agent.
 */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name'),
  agentRole: text('agent_role'),
  goal: text('goal').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  sessionId: text('session_id'),
  payload: text('payload').notNull(), // JSON - full JobPayload
  response: text('response'), // JSON - JobResponse
  events: text('events'), // JSON array of JobEvents
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
});

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;

/**
 * Task States Schema
 *
 * Persists structured execution state for tasks.
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const taskStates = sqliteTable('task_states', {
  /** Task ID (foreign key to tasks) */
  taskId: text('task_id').primaryKey(),

  /** JSON serialized TaskExecutionState */
  state: text('state').notNull(),

  /** Optimistic locking version */
  version: integer('version').notNull().default(1),

  /** Created timestamp */
  createdAt: integer('created_at').notNull(),

  /** Updated timestamp */
  updatedAt: integer('updated_at').notNull(),
});

export type TaskStateRow = typeof taskStates.$inferSelect;
export type NewTaskStateRow = typeof taskStates.$inferInsert;

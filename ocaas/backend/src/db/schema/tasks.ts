import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  type: text('type').notNull().default('generic'),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(2),
  agentId: text('agent_id'),
  parentTaskId: text('parent_task_id'),
  // Dependencias y secuenciación
  batchId: text('batch_id'), // Agrupa tareas relacionadas
  dependsOn: text('depends_on'), // JSON array de task IDs que deben completarse primero
  sequenceOrder: integer('sequence_order'), // Orden dentro de un batch (1, 2, 3...)
  input: text('input'), // JSON
  output: text('output'), // JSON
  error: text('error'),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  metadata: text('metadata'), // JSON
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;

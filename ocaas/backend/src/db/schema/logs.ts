import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * System logs table
 *
 * Persistent storage for critical logs:
 * - Job execution logs
 * - Error logs
 * - Safety events
 */
export const systemLogs = sqliteTable('system_logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(), // debug, info, warn, error, fatal
  source: text('source').notNull(), // Component name
  message: text('message').notNull(),
  // Context
  jobId: text('job_id'),
  taskId: text('task_id'),
  agentId: text('agent_id'),
  // Error details
  errorCode: text('error_code'),
  errorStack: text('error_stack'),
  // Metadata
  data: text('data'), // JSON
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  levelIdx: index('logs_level_idx').on(table.level),
  sourceIdx: index('logs_source_idx').on(table.source),
  jobIdx: index('logs_job_idx').on(table.jobId),
  createdAtIdx: index('logs_created_at_idx').on(table.createdAt),
}));

export type SystemLogRow = typeof systemLogs.$inferSelect;
export type NewSystemLogRow = typeof systemLogs.$inferInsert;

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Task Checkpoints Table
 *
 * Persists critical execution state for crash recovery.
 * Only stores non-terminal task states.
 */
export const taskCheckpoints = sqliteTable('task_checkpoints', {
  // Primary key is taskId (one checkpoint per task)
  taskId: text('task_id').primaryKey(),

  // Execution tracking
  executionId: text('execution_id').notNull(),
  assignedAgentId: text('assigned_agent_id'),

  // Stage and progress
  currentStage: text('current_stage').notNull(),
  lastCompletedStep: text('last_completed_step'),
  progressPercent: integer('progress_percent').notNull().default(0),

  // Blockers and waiting state
  lastKnownBlocker: text('last_known_blocker'),
  pendingApproval: text('pending_approval'),
  pendingResources: text('pending_resources'), // JSON array

  // OpenClaw session
  lastOpenClawSessionId: text('last_openclaw_session_id'),

  // Partial result (can be large)
  partialResult: text('partial_result'), // JSON

  // Status snapshot
  statusSnapshot: text('status_snapshot'), // JSON

  // Retry tracking
  retryCount: integer('retry_count').notNull().default(0),
  resumable: integer('resumable', { mode: 'boolean' }).notNull().default(true),

  // Timestamps
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type TaskCheckpointRow = typeof taskCheckpoints.$inferSelect;
export type NewTaskCheckpointRow = typeof taskCheckpoints.$inferInsert;

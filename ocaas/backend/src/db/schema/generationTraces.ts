import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Generation Traces table schema
 *
 * Provides FULL traceability of what happened during task execution:
 * - Was AI requested? attempted? succeeded?
 * - Was fallback used and why?
 * - What was the raw AI output vs final output?
 */
export const generationTraces = sqliteTable('generation_traces', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  jobId: text('job_id'),

  /** Execution mode: hooks_session | chat_completion | stub */
  executionMode: text('execution_mode').notNull(),

  /** Was AI execution requested? */
  aiRequested: integer('ai_requested', { mode: 'boolean' }).notNull().default(false),

  /** Was AI execution actually attempted? */
  aiAttempted: integer('ai_attempted', { mode: 'boolean' }).notNull().default(false),

  /** Did AI execution succeed (got response)? */
  aiSucceeded: integer('ai_succeeded', { mode: 'boolean' }).notNull().default(false),

  /** Was fallback used instead of primary mode? */
  fallbackUsed: integer('fallback_used', { mode: 'boolean' }).notNull().default(false),

  /** Reason for fallback if used */
  fallbackReason: text('fallback_reason'),

  /** Raw output from AI (truncated if too long, max 10KB) */
  rawOutput: text('raw_output'),

  /** Final processed output */
  finalOutput: text('final_output'),

  /** Token usage (JSON: { input: number, output: number }) */
  tokenUsage: text('token_usage'),

  /** Model used for execution */
  model: text('model'),

  /** Execution duration in ms */
  durationMs: integer('duration_ms'),

  /** Error message if failed */
  error: text('error'),

  createdAt: integer('created_at').notNull(),
});

export type GenerationTraceRow = typeof generationTraces.$inferSelect;
export type NewGenerationTraceRow = typeof generationTraces.$inferInsert;

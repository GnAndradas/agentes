import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const agentFeedback = sqliteTable('agent_feedback', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'missing_tool' | 'missing_skill' | 'missing_capability' | 'blocked' | 'cannot_continue'
  agentId: text('agent_id').notNull(),
  taskId: text('task_id').notNull(),
  sessionId: text('session_id'),
  message: text('message').notNull(),
  requirement: text('requirement'), // What the agent needs (tool name, skill name, etc)
  context: text('context'), // JSON object with additional context
  processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
  processingResult: text('processing_result'), // JSON object with action result
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type AgentFeedbackRow = typeof agentFeedback.$inferSelect;
export type NewAgentFeedbackRow = typeof agentFeedback.$inferInsert;

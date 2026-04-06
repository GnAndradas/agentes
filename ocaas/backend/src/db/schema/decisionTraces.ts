import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Decision Traces table schema
 *
 * Stores decision traceability records for Task → Agent assignment.
 * Enables post-mortem analysis of why tasks were/weren't assigned.
 */
export const decisionTraces = sqliteTable('decision_traces', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  decision: text('decision').notNull(), // DecisionOutcome
  failureReason: text('failure_reason'), // FailureReason (nullable)
  explanation: text('explanation').notNull(),
  selectedAgentId: text('selected_agent_id'),
  selectionScore: real('selection_score'),
  selectionReason: text('selection_reason'),
  totalAgents: integer('total_agents').notNull().default(0),
  activeAgents: integer('active_agents').notNull().default(0),
  matchingAgents: integer('matching_agents').notNull().default(0),
  evaluatedAgentsJson: text('evaluated_agents_json'), // JSON array
  taskType: text('task_type').notNull().default('general'),
  taskPriority: integer('task_priority').notNull().default(0),
  requiredCapabilitiesJson: text('required_capabilities_json'), // JSON array
  decisionMethod: text('decision_method'), // heuristic | llm | fallback | cached
  confidence: real('confidence'),
  processingTimeMs: integer('processing_time_ms'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
});

export type DecisionTraceRow = typeof decisionTraces.$inferSelect;
export type NewDecisionTraceRow = typeof decisionTraces.$inferInsert;

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const generations = sqliteTable('generations', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // agent, skill, tool
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  prompt: text('prompt').notNull(),
  generatedContent: text('generated_content'), // JSON
  validationResult: text('validation_result'), // JSON
  targetPath: text('target_path'),
  errorMessage: text('error_message'),
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at'),
  activatedAt: integer('activated_at'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type GenerationRow = typeof generations.$inferSelect;
export type NewGenerationRow = typeof generations.$inferInsert;

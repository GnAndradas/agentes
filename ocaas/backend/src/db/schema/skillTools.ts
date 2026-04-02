import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Skill-Tools composition table
 *
 * Links skills to their component tools, enabling skills to be
 * composed from multiple tools with ordering and metadata.
 */
export const skillTools = sqliteTable(
  'skill_tools',
  {
    skillId: text('skill_id').notNull(),
    toolId: text('tool_id').notNull(),
    orderIndex: integer('order_index').notNull().default(0),
    required: integer('required', { mode: 'boolean' }).notNull().default(true),
    role: text('role'), // Optional: 'primary', 'fallback', 'preprocessing', etc.
    config: text('config'), // Optional: JSON override config for this tool in this skill
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.skillId, table.toolId] }),
  })
);

export type SkillToolRow = typeof skillTools.$inferSelect;
export type NewSkillToolRow = typeof skillTools.$inferInsert;

import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  version: text('version').notNull().default('1.0.0'),
  path: text('path').notNull(),
  status: text('status').notNull().default('active'),
  capabilities: text('capabilities'), // JSON array
  requirements: text('requirements'), // JSON array
  config: text('config'), // JSON
  syncedAt: integer('synced_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const agentSkills = sqliteTable(
  'agent_skills',
  {
    agentId: text('agent_id').notNull(),
    skillId: text('skill_id').notNull(),
    assignedAt: integer('assigned_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.skillId] }),
  })
);

export type SkillRow = typeof skills.$inferSelect;
export type NewSkillRow = typeof skills.$inferInsert;

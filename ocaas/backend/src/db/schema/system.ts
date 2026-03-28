import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const systemConfig = sqliteTable('system_config', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type SystemConfigRow = typeof systemConfig.$inferSelect;
export type NewSystemConfigRow = typeof systemConfig.$inferInsert;

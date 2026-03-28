import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import * as schema from './schema/index.js';

const logger = createLogger('database');

const dbPath = config.database.url;
const dbDir = dirname(dbPath);

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export async function initDatabase(): Promise<void> {
  logger.info('Initializing database...');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'inactive',
      capabilities TEXT,
      config TEXT,
      session_id TEXT,
      last_active_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'generic',
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 2,
      agent_id TEXT,
      parent_task_id TEXT,
      input TEXT,
      output TEXT,
      error TEXT,
      metadata TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      capabilities TEXT,
      requirements TEXT,
      config TEXT,
      synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      path TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'script',
      status TEXT NOT NULL DEFAULT 'active',
      input_schema TEXT,
      output_schema TEXT,
      config TEXT,
      execution_count INTEGER NOT NULL DEFAULT 0,
      last_executed_at INTEGER,
      synced_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      agent_id TEXT NOT NULL,
      tool_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, tool_id)
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      constraints TEXT,
      expires_at INTEGER,
      granted_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      prompt TEXT NOT NULL,
      generated_content TEXT,
      validation_result TEXT,
      target_path TEXT,
      error_message TEXT,
      approved_by TEXT,
      approved_at INTEGER,
      activated_at INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      agent_id TEXT,
      data TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      resource_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at INTEGER NOT NULL,
      expires_at INTEGER,
      responded_at INTEGER,
      responded_by TEXT,
      reason TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
    CREATE INDEX IF NOT EXISTS idx_permissions_agent ON permissions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(key);
  `);

  logger.info('Database initialized');
}

export function closeDatabase(): void {
  sqlite.close();
  logger.info('Database closed');
}

export { schema };

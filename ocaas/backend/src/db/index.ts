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
      batch_id TEXT,
      depends_on TEXT,
      sequence_order INTEGER,
      input TEXT,
      output TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
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
    CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(batch_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
    CREATE INDEX IF NOT EXISTS idx_permissions_agent ON permissions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_approvals_resource ON approvals(type, resource_id);
    CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(key);

    CREATE TABLE IF NOT EXISTS agent_feedback (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      session_id TEXT,
      message TEXT NOT NULL,
      requirement TEXT,
      context TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      processing_result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_feedback_task ON agent_feedback(task_id);
    CREATE INDEX IF NOT EXISTS idx_agent_feedback_agent ON agent_feedback(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_feedback_processed ON agent_feedback(processed);

    -- Resource drafts table (for ManualResourceService)
    CREATE TABLE IF NOT EXISTS resource_drafts (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      content TEXT NOT NULL,
      validation_result TEXT,
      submitted_at INTEGER,
      submitted_by TEXT,
      approved_at INTEGER,
      approved_by TEXT,
      rejected_at INTEGER,
      rejected_by TEXT,
      rejection_reason TEXT,
      activated_at INTEGER,
      active_resource_id TEXT,
      parent_draft_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_resource_drafts_type ON resource_drafts(resource_type);
    CREATE INDEX IF NOT EXISTS idx_resource_drafts_status ON resource_drafts(status);
    CREATE INDEX IF NOT EXISTS idx_resource_drafts_slug ON resource_drafts(resource_type, slug);

    -- Task checkpoints table (for resilience/recovery)
    CREATE TABLE IF NOT EXISTS task_checkpoints (
      task_id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      assigned_agent_id TEXT,
      current_stage TEXT NOT NULL,
      last_completed_step TEXT,
      progress_percent INTEGER NOT NULL DEFAULT 0,
      last_known_blocker TEXT,
      pending_approval TEXT,
      pending_resources TEXT,
      last_openclaw_session_id TEXT,
      partial_result TEXT,
      status_snapshot TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      resumable INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_checkpoints_stage ON task_checkpoints(current_stage);

    -- Execution leases table (for resilience)
    CREATE TABLE IF NOT EXISTS execution_leases (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      holder_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      renewed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_leases_task ON execution_leases(task_id);
    CREATE INDEX IF NOT EXISTS idx_leases_expires ON execution_leases(expires_at);

    -- Human escalations table (for HITL)
    CREATE TABLE IF NOT EXISTS human_escalations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      task_id TEXT,
      agent_id TEXT,
      resource_type TEXT,
      resource_id TEXT,
      reason TEXT NOT NULL,
      context TEXT,
      checkpoint_stage TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      acknowledged_at INTEGER,
      acknowledged_by TEXT,
      resolution TEXT,
      resolution_details TEXT,
      resolved_at INTEGER,
      resolved_by TEXT,
      expires_at INTEGER,
      fallback_action TEXT,
      linked_approval_id TEXT,
      linked_feedback_id TEXT,
      linked_generation_id TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_escalations_status ON human_escalations(status);
    CREATE INDEX IF NOT EXISTS idx_escalations_type ON human_escalations(type);
    CREATE INDEX IF NOT EXISTS idx_escalations_task ON human_escalations(task_id);
    CREATE INDEX IF NOT EXISTS idx_escalations_priority ON human_escalations(priority, status);
  `);

  // Verify critical tables exist after initialization
  const criticalTables = [
    'tasks', 'agents', 'skills', 'tools', 'events',
    'resource_drafts', 'approvals', 'agent_feedback',
    'task_checkpoints', 'execution_leases', 'human_escalations',
  ];

  const existingTables = sqlite.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string }>;

  const tableNames = new Set(existingTables.map(t => t.name));
  const missingTables = criticalTables.filter(t => !tableNames.has(t));

  if (missingTables.length > 0) {
    logger.error({ missingTables }, 'CRITICAL: Some tables failed to create during initDatabase');
    throw new Error(`Failed to create critical tables: ${missingTables.join(', ')}`);
  }

  logger.info({ tableCount: tableNames.size, criticalTables: criticalTables.length }, 'Database initialized with all critical tables');
}

export function closeDatabase(): void {
  sqlite.close();
  logger.info('Database closed');
}

export { schema };

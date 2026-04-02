/**
 * Database Logger
 *
 * Persists critical logs to SQLite for:
 * - Post-mortem analysis
 * - Audit trail
 * - Safety monitoring
 */

import { nanoid } from 'nanoid';
import { db, schema } from '../db/index.js';
import { nowTimestamp } from './helpers.js';
import { desc, eq, and, gte, lte } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  jobId?: string;
  taskId?: string;
  agentId?: string;
  errorCode?: string;
  errorStack?: string;
  data?: Record<string, unknown>;
}

export interface LogQuery {
  level?: LogLevel;
  source?: string;
  jobId?: string;
  taskId?: string;
  fromTime?: number;
  toTime?: number;
  limit?: number;
}

// ============================================================================
// DB LOGGER
// ============================================================================

/**
 * Persist log entry to database
 */
export function persistLog(entry: LogEntry): void {
  try {
    db.insert(schema.systemLogs).values({
      id: `log_${nanoid(12)}`,
      level: entry.level,
      source: entry.source,
      message: entry.message,
      jobId: entry.jobId,
      taskId: entry.taskId,
      agentId: entry.agentId,
      errorCode: entry.errorCode,
      errorStack: entry.errorStack,
      data: entry.data ? JSON.stringify(entry.data) : null,
      createdAt: nowTimestamp(),
    }).run();
  } catch (err) {
    // Fallback to console if DB fails
    console.error('[dbLogger] Failed to persist log:', err);
  }
}

/**
 * Query logs from database
 */
export function queryLogs(query: LogQuery): Array<{
  id: string;
  level: string;
  source: string;
  message: string;
  jobId?: string;
  taskId?: string;
  agentId?: string;
  errorCode?: string;
  data?: Record<string, unknown>;
  createdAt: number;
}> {
  try {
    let q = db.select().from(schema.systemLogs);

    // Build where conditions
    const conditions = [];

    if (query.level) {
      conditions.push(eq(schema.systemLogs.level, query.level));
    }
    if (query.source) {
      conditions.push(eq(schema.systemLogs.source, query.source));
    }
    if (query.jobId) {
      conditions.push(eq(schema.systemLogs.jobId, query.jobId));
    }
    if (query.taskId) {
      conditions.push(eq(schema.systemLogs.taskId, query.taskId));
    }
    if (query.fromTime) {
      conditions.push(gte(schema.systemLogs.createdAt, query.fromTime));
    }
    if (query.toTime) {
      conditions.push(lte(schema.systemLogs.createdAt, query.toTime));
    }

    if (conditions.length > 0) {
      q = q.where(and(...conditions)) as typeof q;
    }

    const rows = q
      .orderBy(desc(schema.systemLogs.createdAt))
      .limit(query.limit || 100)
      .all();

    return rows.map(r => ({
      id: r.id,
      level: r.level,
      source: r.source,
      message: r.message,
      jobId: r.jobId ?? undefined,
      taskId: r.taskId ?? undefined,
      agentId: r.agentId ?? undefined,
      errorCode: r.errorCode ?? undefined,
      data: r.data ? JSON.parse(r.data) : undefined,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.error('[dbLogger] Failed to query logs:', err);
    return [];
  }
}

/**
 * Get logs for a specific job
 */
export function getJobLogs(jobId: string): ReturnType<typeof queryLogs> {
  return queryLogs({ jobId, limit: 500 });
}

/**
 * Get error logs
 */
export function getErrorLogs(limit = 100): ReturnType<typeof queryLogs> {
  return queryLogs({ level: 'error', limit });
}

/**
 * Get recent logs
 */
export function getRecentLogs(minutes = 60, limit = 200): ReturnType<typeof queryLogs> {
  const fromTime = nowTimestamp() - (minutes * 60 * 1000);
  return queryLogs({ fromTime, limit });
}

/**
 * Cleanup old logs (keep last N days)
 */
export function cleanupOldLogs(keepDays = 7): number {
  try {
    const cutoff = nowTimestamp() - (keepDays * 24 * 60 * 60 * 1000);
    const result = db.delete(schema.systemLogs)
      .where(lte(schema.systemLogs.createdAt, cutoff))
      .run();
    return result.changes;
  } catch (err) {
    console.error('[dbLogger] Failed to cleanup logs:', err);
    return 0;
  }
}

// ============================================================================
// HELPER: Log with persistence
// ============================================================================

/**
 * Log error with automatic DB persistence
 */
export function logAndPersistError(
  source: string,
  message: string,
  context?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>
): void {
  const entry: LogEntry = {
    level: 'error',
    source,
    message,
    ...context,
  };
  persistLog(entry);
}

/**
 * Log warning with persistence
 */
export function logAndPersistWarn(
  source: string,
  message: string,
  context?: Partial<Omit<LogEntry, 'level' | 'source' | 'message'>>
): void {
  const entry: LogEntry = {
    level: 'warn',
    source,
    message,
    ...context,
  };
  persistLog(entry);
}

/**
 * Log safety event
 */
export function logSafetyEvent(
  event: 'failsafe_activated' | 'failsafe_deactivated' | 'job_auto_aborted' | 'tool_blocked' | 'retry_limit_exceeded',
  message: string,
  context?: { jobId?: string; taskId?: string; data?: Record<string, unknown> }
): void {
  persistLog({
    level: 'warn',
    source: 'JobSafety',
    message: `[${event}] ${message}`,
    ...context,
  });
}

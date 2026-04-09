/**
 * RuntimeEventsService
 *
 * Reads runtime event logs from OpenClaw progress-tracker hook.
 * Logs are written to: $OPENCLAW_WORKSPACE_PATH/runs/<sessionKey>.jsonl
 *
 * IMPORTANT:
 * - Read-only service
 * - Does NOT modify any files
 * - Gracefully handles missing files
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/index.js';
import { integrationLogger } from '../utils/logger.js';

const logger = integrationLogger.child({ component: 'RuntimeEventsService' });

/**
 * Runtime event from OpenClaw hook
 */
export interface RuntimeEvent {
  timestamp: number;
  sessionKey: string;
  event: string;
  stage: string;
  summary: string;
  source: 'openclaw-hook';
  metadata?: Record<string, unknown>;
}

/**
 * Response from getRuntimeEvents
 */
export interface RuntimeEventsResponse {
  taskId: string;
  sessionKey: string | null;
  hasEvents: boolean;
  events: RuntimeEvent[];
  logPath: string | null;
  logExists: boolean;
  source: 'openclaw-hook';
  limitation?: string;
}

/**
 * Sanitize sessionKey for filename (must match hook logic)
 */
function sanitizeForFilename(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Get runs directory path
 */
function getRunsDir(): string {
  return path.join(config.openclaw.workspacePath, 'runs');
}

/**
 * Build sessionKey from taskId
 * OCAAS convention: hook:ocaas:task-{taskId}
 */
export function buildSessionKeyFromTaskId(taskId: string): string {
  return `hook:ocaas:task-${taskId}`;
}

/**
 * Get log file path for a sessionKey
 */
function getLogPath(sessionKey: string): string {
  const filename = `${sanitizeForFilename(sessionKey)}.jsonl`;
  return path.join(getRunsDir(), filename);
}

/**
 * Read runtime events from log file
 */
export async function getRuntimeEvents(taskId: string, sessionKey?: string): Promise<RuntimeEventsResponse> {
  // Determine sessionKey
  const resolvedSessionKey = sessionKey || buildSessionKeyFromTaskId(taskId);
  const logPath = getLogPath(resolvedSessionKey);

  // Check if log file exists
  if (!fs.existsSync(logPath)) {
    logger.debug({ taskId, logPath }, 'Runtime events log not found');
    return {
      taskId,
      sessionKey: resolvedSessionKey,
      hasEvents: false,
      events: [],
      logPath,
      logExists: false,
      source: 'openclaw-hook',
      limitation: 'Log file not found. Hook may not be installed or session not started.',
    };
  }

  try {
    // Read and parse JSONL file
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const events: RuntimeEvent[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as RuntimeEvent;
        events.push(event);
      } catch {
        // Skip malformed lines
        logger.warn({ line: line.substring(0, 100) }, 'Skipping malformed log line');
      }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    logger.debug({ taskId, eventCount: events.length }, 'Read runtime events');

    return {
      taskId,
      sessionKey: resolvedSessionKey,
      hasEvents: events.length > 0,
      events,
      logPath,
      logExists: true,
      source: 'openclaw-hook',
    };
  } catch (err) {
    logger.error({ err, taskId, logPath }, 'Failed to read runtime events');
    return {
      taskId,
      sessionKey: resolvedSessionKey,
      hasEvents: false,
      events: [],
      logPath,
      logExists: true,
      source: 'openclaw-hook',
      limitation: `Failed to read log: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check if hook logs exist for a task
 */
export function hasRuntimeLogs(taskId: string, sessionKey?: string): boolean {
  const resolvedSessionKey = sessionKey || buildSessionKeyFromTaskId(taskId);
  const logPath = getLogPath(resolvedSessionKey);
  return fs.existsSync(logPath);
}

/**
 * Get log file stats
 */
export function getLogStats(taskId: string, sessionKey?: string): { exists: boolean; size: number; mtime: number } | null {
  const resolvedSessionKey = sessionKey || buildSessionKeyFromTaskId(taskId);
  const logPath = getLogPath(resolvedSessionKey);

  try {
    if (!fs.existsSync(logPath)) {
      return null;
    }
    const stats = fs.statSync(logPath);
    return {
      exists: true,
      size: stats.size,
      mtime: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

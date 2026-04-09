/**
 * Progress Tracker Hook Handler
 *
 * PASSIVE observability hook for OCAAS integration.
 * Logs runtime events to runs/<sessionKey>.jsonl
 *
 * IMPORTANT:
 * - Does NOT modify any data
 * - Does NOT intercept messages
 * - Does NOT alter agent behavior
 * - ONLY writes log entries
 */

import * as fs from 'fs';
import * as path from 'path';

// Event types we handle
type EventType =
  | 'message:received'
  | 'message:preprocessed'
  | 'message:sent'
  | 'agent:bootstrap'
  | 'session:patch'
  | 'tool:call'
  | 'tool:result';

// Log entry format
interface ProgressLogEntry {
  timestamp: number;
  sessionKey: string;
  event: EventType;
  stage: string;
  summary: string;
  source: 'openclaw-hook';
  metadata?: Record<string, unknown>;
}

// Map event to stage
const eventStageMap: Record<EventType, string> = {
  'message:received': 'receiving',
  'message:preprocessed': 'processing',
  'message:sent': 'responding',
  'agent:bootstrap': 'initializing',
  'session:patch': 'updating',
  'tool:call': 'tool_calling',
  'tool:result': 'tool_complete',
};

// Map event to summary
const eventSummaryMap: Record<EventType, string> = {
  'message:received': 'Message received from user',
  'message:preprocessed': 'Message preprocessed',
  'message:sent': 'Response sent to user',
  'agent:bootstrap': 'Agent session initialized',
  'session:patch': 'Session state updated',
  'tool:call': 'Tool invocation started',
  'tool:result': 'Tool invocation completed',
};

/**
 * Get runs directory path
 */
function getRunsDir(): string {
  // Use OPENCLAW_WORKSPACE_PATH or default
  const workspace = process.env.OPENCLAW_WORKSPACE_PATH || path.join(process.env.HOME || '~', '.openclaw', 'workspace');
  return path.join(workspace, 'runs');
}

/**
 * Ensure runs directory exists
 */
function ensureRunsDir(): void {
  const runsDir = getRunsDir();
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true });
  }
}

/**
 * Extract sessionKey from event context
 * OCAAS uses format: hook:ocaas:task-{taskId} or hook:ocaas:job-{jobId}
 */
function extractSessionKey(context: Record<string, unknown>): string | null {
  // Try sessionKey directly
  if (typeof context.sessionKey === 'string') {
    return context.sessionKey;
  }

  // Try sessionId
  if (typeof context.sessionId === 'string') {
    return context.sessionId;
  }

  // Try from metadata
  if (context.metadata && typeof context.metadata === 'object') {
    const meta = context.metadata as Record<string, unknown>;
    if (typeof meta.sessionKey === 'string') {
      return meta.sessionKey;
    }
  }

  return null;
}

/**
 * Sanitize sessionKey for filename
 */
function sanitizeForFilename(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Append log entry to session file
 */
function appendLogEntry(entry: ProgressLogEntry): void {
  try {
    ensureRunsDir();
    const filename = `${sanitizeForFilename(entry.sessionKey)}.jsonl`;
    const filepath = path.join(getRunsDir(), filename);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filepath, line, 'utf8');
  } catch (err) {
    // Silent fail - observability should not break the system
    console.error('[progress-tracker] Failed to write log:', err);
  }
}

/**
 * Handle incoming event
 * This is the main entry point called by OpenClaw
 */
export async function handle(
  event: EventType,
  context: Record<string, unknown>
): Promise<void> {
  // Extract sessionKey - only log OCAAS sessions
  const sessionKey = extractSessionKey(context);

  // Skip if no sessionKey or not an OCAAS session
  if (!sessionKey || !sessionKey.startsWith('hook:ocaas:')) {
    return;
  }

  // Build log entry
  const entry: ProgressLogEntry = {
    timestamp: Date.now(),
    sessionKey,
    event,
    stage: eventStageMap[event] || 'unknown',
    summary: eventSummaryMap[event] || `Event: ${event}`,
    source: 'openclaw-hook',
  };

  // Add minimal metadata if available (no sensitive data)
  if (event === 'tool:call' && typeof context.toolName === 'string') {
    entry.summary = `Tool call: ${context.toolName}`;
    entry.metadata = { toolName: context.toolName };
  }

  if (event === 'tool:result' && typeof context.toolName === 'string') {
    entry.summary = `Tool result: ${context.toolName}`;
    entry.metadata = {
      toolName: context.toolName,
      success: context.success !== false,
    };
  }

  // Write log entry (async, non-blocking)
  appendLogEntry(entry);
}

/**
 * Hook lifecycle - called when hook is loaded
 */
export function init(): void {
  console.log('[progress-tracker] Hook initialized');
  ensureRunsDir();
}

/**
 * Hook lifecycle - called when hook is unloaded
 */
export function cleanup(): void {
  console.log('[progress-tracker] Hook cleanup');
}

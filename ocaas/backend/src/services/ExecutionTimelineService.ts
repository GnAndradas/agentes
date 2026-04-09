/**
 * ExecutionTimelineService
 *
 * Unifies the 3 observability layers into a single chronological timeline.
 * Does NOT synthesize or infer - only aggregates existing events.
 *
 * Layers:
 * 1. ocaas_internal - TaskStateManager orchestrator state
 * 2. openclaw_status - OpenClaw session status (limited API)
 * 3. openclaw_runtime - Real hook events from progress-tracker
 */

import { integrationLogger } from '../utils/logger.js';

const logger = integrationLogger.child({ component: 'ExecutionTimelineService' });

// =============================================================================
// TYPES
// =============================================================================

export type TimelineLayer = 'ocaas_internal' | 'openclaw_status' | 'openclaw_runtime';

/**
 * Unified timeline event - preserves source layer
 */
export interface TimelineEvent {
  timestamp: number;
  layer: TimelineLayer;
  event: string;
  stage: string;
  summary: string;
  source: string;
  taskId: string;
  jobId?: string;
  sessionKey?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Execution timeline response
 */
export interface ExecutionTimelineResponse {
  taskId: string;
  sessionKey: string | null;
  jobId: string | null;
  events: TimelineEvent[];
  layers: {
    ocaas_internal: { available: boolean; eventCount: number };
    openclaw_status: { available: boolean; eventCount: number };
    openclaw_runtime: { available: boolean; eventCount: number };
  };
  totalEvents: number;
}

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Build unified execution timeline for a task
 */
export async function getExecutionTimeline(taskId: string): Promise<ExecutionTimelineResponse> {
  const events: TimelineEvent[] = [];
  let sessionKey: string | null = null;
  let jobId: string | null = null;

  const layerStats = {
    ocaas_internal: { available: false, eventCount: 0 },
    openclaw_status: { available: false, eventCount: 0 },
    openclaw_runtime: { available: false, eventCount: 0 },
  };

  // =========================================================================
  // Layer 1: OCAAS Internal Progress
  // =========================================================================
  try {
    const { getTaskStateManager } = await import('../execution/TaskStateManager/index.js');
    const taskStateManager = getTaskStateManager();
    const state = await taskStateManager.getState(taskId);

    if (state) {
      sessionKey = state.sessionKey || null;
      layerStats.ocaas_internal.available = true;

      // state_initialized
      events.push({
        timestamp: state.createdAt,
        layer: 'ocaas_internal',
        event: 'state_initialized',
        stage: 'initializing',
        summary: 'OCAAS state initialized',
        source: 'ocaas_orchestrator',
        taskId,
        sessionKey: state.sessionKey,
      });

      // Steps
      for (const step of state.steps) {
        if (!jobId && step.jobId) {
          jobId = step.jobId;
        }

        if (step.startedAt) {
          events.push({
            timestamp: step.startedAt,
            layer: 'ocaas_internal',
            event: 'step_started',
            stage: 'executing',
            summary: `Step started: ${step.name}`,
            source: 'ocaas_orchestrator',
            taskId,
            jobId: step.jobId,
            sessionKey: state.sessionKey,
            metadata: { stepId: step.id, stepName: step.name },
          });
        }

        if (step.completedAt && step.status === 'completed') {
          events.push({
            timestamp: step.completedAt,
            layer: 'ocaas_internal',
            event: 'step_completed',
            stage: 'executing',
            summary: `Step completed: ${step.name}`,
            source: 'ocaas_orchestrator',
            taskId,
            jobId: step.jobId,
            sessionKey: state.sessionKey,
            metadata: { stepId: step.id, stepName: step.name },
          });
        }

        if (step.status === 'failed' && step.error) {
          events.push({
            timestamp: step.completedAt || state.updatedAt,
            layer: 'ocaas_internal',
            event: 'step_failed',
            stage: 'failed',
            summary: `Step failed: ${step.name}`,
            source: 'ocaas_orchestrator',
            taskId,
            jobId: step.jobId,
            sessionKey: state.sessionKey,
            metadata: { stepId: step.id, stepName: step.name, error: step.error },
          });
        }
      }

      // Checkpoints
      for (const cp of state.checkpoints) {
        events.push({
          timestamp: cp.createdAt,
          layer: 'ocaas_internal',
          event: 'checkpoint_created',
          stage: 'executing',
          summary: `Checkpoint: ${cp.label}`,
          source: 'ocaas_orchestrator',
          taskId,
          sessionKey: state.sessionKey,
          metadata: { checkpointId: cp.id, auto: cp.auto, reason: cp.reason },
        });
      }

      // Terminal states
      if (state.phase === 'completed') {
        events.push({
          timestamp: state.updatedAt,
          layer: 'ocaas_internal',
          event: 'task_completed',
          stage: 'completed',
          summary: 'Task completed',
          source: 'ocaas_orchestrator',
          taskId,
          sessionKey: state.sessionKey,
        });
      } else if (state.phase === 'failed') {
        events.push({
          timestamp: state.updatedAt,
          layer: 'ocaas_internal',
          event: 'task_failed',
          stage: 'failed',
          summary: 'Task failed',
          source: 'ocaas_orchestrator',
          taskId,
          sessionKey: state.sessionKey,
        });
      } else if (state.phase === 'paused') {
        events.push({
          timestamp: state.updatedAt,
          layer: 'ocaas_internal',
          event: 'task_paused',
          stage: 'paused',
          summary: `Task paused${state.pausedReason ? `: ${state.pausedReason}` : ''}`,
          source: 'ocaas_orchestrator',
          taskId,
          sessionKey: state.sessionKey,
        });
      }

      layerStats.ocaas_internal.eventCount = events.filter(e => e.layer === 'ocaas_internal').length;
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to fetch internal progress');
  }

  // =========================================================================
  // Layer 2: OpenClaw Session Status
  // =========================================================================
  try {
    const { getGateway } = await import('../openclaw/gateway.js');
    const gateway = getGateway();

    if (gateway.isWsConnected()) {
      const sessions = await gateway.listSessions();
      const matchingSession = sessionKey
        ? sessions.find(s => s.id === sessionKey || s.id.includes(taskId))
        : sessions.find(s => s.id.includes(taskId));

      if (matchingSession) {
        layerStats.openclaw_status.available = true;

        events.push({
          timestamp: matchingSession.createdAt,
          layer: 'openclaw_status',
          event: 'session_found',
          stage: matchingSession.status === 'active' ? 'executing' : matchingSession.status,
          summary: `OpenClaw session: ${matchingSession.status}`,
          source: 'openclaw_runtime',
          taskId,
          sessionId: matchingSession.id,
          sessionKey: sessionKey || undefined,
        });

        layerStats.openclaw_status.eventCount = 1;
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to fetch session status');
  }

  // =========================================================================
  // Layer 3: OpenClaw Runtime Events (from hook)
  // =========================================================================
  try {
    const { getRuntimeEvents } = await import('./RuntimeEventsService.js');
    const runtimeResult = await getRuntimeEvents(taskId, sessionKey || undefined);

    if (runtimeResult.hasEvents && runtimeResult.events.length > 0) {
      layerStats.openclaw_runtime.available = true;

      for (const evt of runtimeResult.events) {
        events.push({
          timestamp: evt.timestamp,
          layer: 'openclaw_runtime',
          event: evt.event,
          stage: evt.stage,
          summary: evt.summary,
          source: evt.source,
          taskId,
          sessionKey: evt.sessionKey,
          metadata: evt.metadata,
        });
      }

      layerStats.openclaw_runtime.eventCount = runtimeResult.events.length;
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to fetch runtime events');
  }

  // =========================================================================
  // Sort chronologically
  // =========================================================================
  events.sort((a, b) => a.timestamp - b.timestamp);

  logger.debug({
    taskId,
    totalEvents: events.length,
    layers: layerStats,
  }, 'Built execution timeline');

  return {
    taskId,
    sessionKey,
    jobId,
    events,
    layers: layerStats,
    totalEvents: events.length,
  };
}

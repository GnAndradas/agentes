import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { getServices } from '../../services/index.js';
import { getTaskRouter } from '../../orchestrator/index.js';
import { getDiagnosticService } from '../../services/DiagnosticService.js';
import { db, schema } from '../../db/index.js';
import { nowTimestamp } from '../../utils/helpers.js';
import { CreateTaskSchema, UpdateTaskSchema, AssignTaskSchema, CompleteTaskSchema, FailTaskSchema, ListTasksQuery } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import type { TaskStatus } from '../../types/domain.js';

type IdParam = { Params: { id: string } };

export async function list(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = ListTasksQuery.safeParse(req.query);
    const opts = parsed.success ? parsed.data : {};
    const { taskService } = getServices();
    const data = await taskService.list({
      status: opts.status as TaskStatus | undefined,
      agentId: opts.agentId,
      limit: opts.limit,
    });
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { taskService } = getServices();
    const data = await taskService.create(parsed.data);

    // Auto-submit to orchestrator for processing
    const taskRouter = getTaskRouter();
    await taskRouter.submit(data);

    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { taskService } = getServices();
    const data = await taskService.update(req.params.id, parsed.data);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    await taskService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function assign(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = AssignTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { taskService } = getServices();
    const data = await taskService.assign(req.params.id, parsed.data.agentId);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function queue(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.queue(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function start(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.start(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function complete(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = CompleteTaskSchema.safeParse(req.body);
    const output = parsed.success ? parsed.data.output : undefined;
    const { taskService } = getServices();
    const data = await taskService.complete(req.params.id, output);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function fail(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = FailTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { taskService } = getServices();
    const data = await taskService.fail(req.params.id, parsed.data.error);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function cancel(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.cancel(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function retry(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const task = await taskService.getById(req.params.id);

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      return reply.status(400).send({ error: 'Can only retry failed or cancelled tasks' });
    }

    if (task.retryCount >= task.maxRetries) {
      return reply.status(400).send({
        error: `Task has reached maximum retries (${task.maxRetries})`,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
      });
    }

    // Reset task to pending and increment retry count
    await db.update(schema.tasks).set({
      status: 'pending',
      retryCount: task.retryCount + 1,
      error: null,
      output: null,
      startedAt: null,
      completedAt: null,
      updatedAt: nowTimestamp(),
    }).where(eq(schema.tasks.id, req.params.id));

    const retried = await taskService.getById(req.params.id);

    // Re-submit to queue for processing
    const taskRouter = getTaskRouter();
    await taskRouter.submit(retried);

    return reply.send({ data: retried });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getPending(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.getPending();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getRunning(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.getRunning();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getSubtasks(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    // Verify parent exists
    await taskService.getById(req.params.id);
    const data = await taskService.getSubtasks(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// BLOQUE 11: DIAGNOSTICS
// ============================================================================

/**
 * Get complete diagnostics for a task
 * BLOQUE 11: Returns full observability data
 */
export async function getDiagnostics(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const diagnosticService = getDiagnosticService();
    const data = await diagnosticService.getTaskDiagnostics(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get timeline for a task
 * BLOQUE 11: Returns structured timeline
 */
export async function getTimeline(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const diagnosticService = getDiagnosticService();
    const diagnostics = await diagnosticService.getTaskDiagnostics(req.params.id);
    return reply.send({
      data: {
        task_id: diagnostics.task_id,
        timeline: diagnostics.timeline,
        ai_usage: diagnostics.ai_usage,
        execution_summary: diagnostics.execution_summary,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get decision trace for a task
 *
 * Returns structured traceability explaining WHY a task was/wasn't assigned.
 * Covers:
 * - NO_AGENTS_REGISTERED: No agents in system
 * - NO_ACTIVE_AGENTS: Agents exist but none active
 * - NO_AGENT_MATCHING_CAPABILITIES: Active agents but no capability match
 * - ASSIGNED: Successfully assigned to an agent
 */
export async function getDecisionTrace(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    // Lazy import to avoid circular dependencies
    const { getDecisionTraceStore } = await import('../../orchestrator/decision/DecisionTrace.js');
    const traceStore = getDecisionTraceStore();
    const trace = traceStore.get(req.params.id);

    if (!trace) {
      return reply.status(404).send({
        success: false,
        error: 'Decision trace not found',
        message: 'No decision trace exists for this task. The task may not have gone through the decision engine yet.',
      });
    }

    return reply.send({
      success: true,
      data: trace,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get decision trace statistics
 *
 * Returns aggregate statistics about decision outcomes.
 */
export async function getDecisionTraceStats(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { getDecisionTraceStore } = await import('../../orchestrator/decision/DecisionTrace.js');
    const traceStore = getDecisionTraceStore();
    const stats = traceStore.getStats();

    return reply.send({
      success: true,
      data: stats,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// P0-02: GENERATION TRACEABILITY
// ============================================================================

/**
 * Get generation trace for a task
 *
 * Returns REAL traceability of what happened during execution:
 * - execution_mode (hooks_session | chat_completion | stub)
 * - ai_requested, ai_attempted, ai_succeeded
 * - fallback_used, fallback_reason
 * - raw_output (truncated), final_output
 */
export async function getGenerationTrace(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getGenerationTraceService } = await import('../../execution/GenerationTraceService.js');
    const traceService = getGenerationTraceService();
    const trace = traceService.getByTask(req.params.id);

    if (!trace) {
      return reply.status(404).send({
        success: false,
        error: 'Generation trace not found',
        message: 'No generation trace exists for this task. The task may not have been executed yet.',
      });
    }

    return reply.send({
      success: true,
      data: trace,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get all generation traces for a task (history)
 */
export async function getGenerationTraceHistory(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getGenerationTraceService } = await import('../../execution/GenerationTraceService.js');
    const traceService = getGenerationTraceService();
    const traces = traceService.listByTask(req.params.id);

    return reply.send({
      success: true,
      data: traces,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// PROGRESS TRACKING (PROMPT: HOOKS ALTERNATIVE)
// ============================================================================

/**
 * Internal progress event from TaskStateManager (OCAAS orchestrator state)
 * NOT OpenClaw runtime events - only OCAAS internal state tracking.
 */
export interface InternalProgressEvent {
  timestamp: number;
  event: string;
  stage: string;
  summary: string;
  source: 'ocaas_orchestrator';
  stepId?: string;
  stepName?: string;
  jobId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get OCAAS internal progress for a task
 *
 * Returns OCAAS orchestrator state from TaskStateManager.
 * This is INTERNAL OCAAS tracking only - NOT OpenClaw runtime events.
 *
 * Events tracked:
 * - state_initialized
 * - step_started, step_completed, step_failed
 * - phase_changed
 * - checkpoint_created
 * - task_paused, task_resumed, task_completed, task_failed
 */
export async function getInternalProgress(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getTaskStateManager } = await import('../../execution/TaskStateManager/index.js');
    const taskStateManager = getTaskStateManager();
    const taskId = req.params.id;

    // Get current state
    const state = await taskStateManager.getState(taskId);

    if (!state) {
      return reply.send({
        success: true,
        data: {
          taskId,
          hasProgress: false,
          events: [],
          currentPhase: 'pending',
          progressPct: 0,
          message: 'No OCAAS internal state yet. Task may be pending or queued.',
          source: 'ocaas_orchestrator',
        },
      });
    }

    // Build internal progress events from OCAAS state
    const events: InternalProgressEvent[] = [];

    events.push({
      timestamp: state.createdAt,
      event: 'state_initialized',
      stage: 'initializing',
      summary: 'OCAAS state initialized',
      source: 'ocaas_orchestrator',
    });

    for (const step of state.steps) {
      if (step.startedAt) {
        events.push({
          timestamp: step.startedAt,
          event: 'step_started',
          stage: 'executing',
          summary: `OCAAS step started: ${step.name}`,
          source: 'ocaas_orchestrator',
          stepId: step.id,
          stepName: step.name,
          jobId: step.jobId,
        });
      }

      if (step.completedAt && step.status === 'completed') {
        events.push({
          timestamp: step.completedAt,
          event: 'step_completed',
          stage: 'executing',
          summary: `OCAAS step completed: ${step.name}`,
          source: 'ocaas_orchestrator',
          stepId: step.id,
          stepName: step.name,
          jobId: step.jobId,
        });
      }

      if (step.status === 'failed' && step.error) {
        events.push({
          timestamp: step.completedAt || state.updatedAt,
          event: 'step_failed',
          stage: 'failed',
          summary: `OCAAS step failed: ${step.name} - ${step.error}`,
          source: 'ocaas_orchestrator',
          stepId: step.id,
          stepName: step.name,
          jobId: step.jobId,
          metadata: { error: step.error },
        });
      }
    }

    for (const cp of state.checkpoints) {
      events.push({
        timestamp: cp.createdAt,
        event: 'checkpoint_created',
        stage: 'executing',
        summary: `OCAAS checkpoint: ${cp.label}${cp.reason ? ` (${cp.reason})` : ''}`,
        source: 'ocaas_orchestrator',
        metadata: { auto: cp.auto, checkpointId: cp.id },
      });
    }

    if (state.phase === 'completed') {
      events.push({
        timestamp: state.updatedAt,
        event: 'task_completed',
        stage: 'completed',
        summary: 'OCAAS task completed',
        source: 'ocaas_orchestrator',
      });
    } else if (state.phase === 'failed') {
      events.push({
        timestamp: state.updatedAt,
        event: 'task_failed',
        stage: 'failed',
        summary: 'OCAAS task failed',
        source: 'ocaas_orchestrator',
      });
    } else if (state.phase === 'paused') {
      events.push({
        timestamp: state.updatedAt,
        event: 'task_paused',
        stage: 'paused',
        summary: `OCAAS task paused: ${state.pausedReason || 'No reason provided'}`,
        source: 'ocaas_orchestrator',
      });
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    const currentStep = state.steps.find(s => s.id === state.currentStepId);

    return reply.send({
      success: true,
      data: {
        taskId,
        hasProgress: true,
        events,
        currentPhase: state.phase,
        currentStep: currentStep ? {
          id: currentStep.id,
          name: currentStep.name,
          status: currentStep.status,
        } : undefined,
        progressPct: state.progressPct,
        completedSteps: state.steps.filter(s => s.status === 'completed').length,
        totalSteps: state.steps.length,
        sessionKey: state.sessionKey,
        lastUpdate: state.lastMeaningfulUpdateAt,
        toolCallsCount: state.toolCallsCount,
        warnings: state.warnings,
        source: 'ocaas_orchestrator',
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// RUNTIME PROGRESS - OpenClaw Runtime Events (HONEST LIMITATIONS)
// ============================================================================

/**
 * Runtime progress event from OpenClaw
 * IMPORTANT: OpenClaw does NOT expose runtime events via API.
 * This endpoint provides session status only, NOT execution details.
 */
export interface RuntimeProgressEvent {
  timestamp: number;
  event: string;
  stage: string;
  summary: string;
  source: 'openclaw_runtime';
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get OpenClaw runtime progress for a task
 *
 * LIMITATION: OpenClaw's WebSocket RPC only supports:
 * - sessions.list (list active sessions)
 * - chat.abort (cancel session)
 * - sessions.patch (update session)
 * - cron.list/patch
 *
 * There is NO API for runtime events (tool_use, message_delta, etc.)
 * This endpoint provides session status only.
 */
export async function getRuntimeProgress(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getGateway } = await import('../../openclaw/gateway.js');
    const { getTaskStateManager } = await import('../../execution/TaskStateManager/index.js');
    const gateway = getGateway();
    const taskStateManager = getTaskStateManager();
    const taskId = req.params.id;

    // Get task state to find sessionKey
    const state = await taskStateManager.getState(taskId);
    const sessionKey = state?.sessionKey;

    // Check if WebSocket is connected
    const wsConnected = gateway.isWsConnected();

    if (!wsConnected) {
      return reply.send({
        success: true,
        data: {
          taskId,
          hasRuntimeProgress: false,
          events: [],
          sessionKey: sessionKey || null,
          sessionStatus: 'unknown',
          limitation: 'WebSocket RPC not connected to OpenClaw',
          source: 'openclaw_runtime',
        },
      });
    }

    // Try to find session in OpenClaw
    const sessions = await gateway.listSessions();
    const matchingSession = sessionKey
      ? sessions.find(s => s.id === sessionKey || s.id.includes(taskId))
      : sessions.find(s => s.id.includes(taskId));

    // Build minimal runtime events (only what we can verify)
    const events: RuntimeProgressEvent[] = [];

    if (matchingSession) {
      events.push({
        timestamp: matchingSession.createdAt,
        event: 'session_found',
        stage: matchingSession.status === 'active' ? 'executing' : matchingSession.status,
        summary: `OpenClaw session: ${matchingSession.status}`,
        source: 'openclaw_runtime',
        sessionId: matchingSession.id,
      });
    }

    return reply.send({
      success: true,
      data: {
        taskId,
        hasRuntimeProgress: events.length > 0,
        events,
        sessionKey: sessionKey || null,
        sessionStatus: matchingSession?.status || 'not_found',
        sessionId: matchingSession?.id || null,
        limitation: 'OpenClaw does not expose runtime events (tool_use, message_delta) via API. Only session status is available.',
        availableApis: ['sessions.list', 'chat.abort', 'sessions.patch'],
        missingApis: ['sessions.events', 'tool_use.stream', 'message.stream'],
        source: 'openclaw_runtime',
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// RUNTIME EVENTS - Real OpenClaw Hook Events (from progress-tracker hook)
// ============================================================================

/**
 * Get runtime events from OpenClaw progress-tracker hook
 *
 * Reads events from: $OPENCLAW_WORKSPACE_PATH/runs/<sessionKey>.jsonl
 *
 * These are REAL runtime events captured by the progress-tracker hook
 * installed in OpenClaw. Not inferred, not heuristic.
 */
export async function getRuntimeEvents(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getRuntimeEvents: fetchEvents } = await import('../../services/RuntimeEventsService.js');
    const { getTaskStateManager } = await import('../../execution/TaskStateManager/index.js');
    const taskStateManager = getTaskStateManager();
    const taskId = req.params.id;

    // Get task state to find sessionKey (if available)
    const state = await taskStateManager.getState(taskId);
    const sessionKey = state?.sessionKey;

    // Fetch runtime events from hook log
    const result = await fetchEvents(taskId, sessionKey);

    return reply.send({
      success: true,
      data: result,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// EXECUTION TIMELINE - Unified view of all 3 observability layers
// ============================================================================

/**
 * Get unified execution timeline for a task
 *
 * Aggregates events from:
 * 1. OCAAS Internal Progress (orchestrator state)
 * 2. OpenClaw Session Status (limited API)
 * 3. OpenClaw Runtime Events (progress-tracker hook)
 *
 * Does NOT synthesize or infer - only aggregates existing events.
 */
export async function getExecutionTimeline(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getExecutionTimeline: fetchTimeline } = await import('../../services/ExecutionTimelineService.js');
    const taskId = req.params.id;
    const result = await fetchTimeline(taskId);

    return reply.send({
      success: true,
      data: result,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// DEBUG SUMMARY - Operational debugging for failed/blocked/anomalous tasks
// ============================================================================

/**
 * Get debug summary for a task
 *
 * Provides structured debugging information across all layers:
 * - ocaas_internal: TaskStateManager state
 * - openclaw_runtime: Session status
 * - openclaw_hook: Runtime events
 * - ai_generation: GenerationTrace
 * - resource_contract: Resource injection/usage
 * - gateway: Transport/connectivity
 *
 * Does NOT invent causes - only reports evidenced issues.
 */
export async function getDebugSummary(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { getTaskDebugSummary } = await import('../../services/TaskDebugSummaryService.js');
    const taskId = req.params.id;
    const result = await getTaskDebugSummary(taskId);

    return reply.send({
      success: true,
      data: result,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// TOOL USAGE VERIFICATION - Determine if tools were actually executed
// ============================================================================

/**
 * Verify tool usage for a task using only verifiable system evidence.
 *
 * 7-Phase Protocol:
 * 1. IDENTIFY_TASK - taskId, sessionKey, agentId
 * 2. RUNTIME_EVENTS - Check .jsonl for tool:call/tool:result
 * 3. CONTRACTUAL_RESOURCE_CHECK - Check resources_usage.verified
 * 4. DEBUG_SUMMARY - Contextual only
 * 5. EXECUTION_TIMELINE - Correlation only
 * 6. FINAL_RESULT - Determine tools_used
 * 7. VALIDATION - Check for false positives
 *
 * RULES:
 * - NO inferring tool usage from text
 * - NO heuristics
 * - NO assuming "complex response" = tool usage
 * - Result: tools_used = true | false | unknown
 */
export async function getToolUsageVerification(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { toolUsageVerificationService } = await import('../../services/ToolUsageVerificationService.js');
    const taskId = req.params.id;

    // Optional query params for sessionKey and agentId
    const query = req.query as { sessionKey?: string; agentId?: string };

    const result = await toolUsageVerificationService.verifyToolUsage(
      taskId,
      query.sessionKey,
      query.agentId
    );

    return reply.send({
      success: true,
      data: result,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

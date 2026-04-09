/**
 * TaskDebugSummaryService
 *
 * Provides operational debugging summaries for failed/blocked/anomalous tasks.
 * Uses existing data sources - does NOT invent causes.
 *
 * Layers covered:
 * - ocaas_internal: TaskStateManager state
 * - openclaw_runtime: Session status
 * - openclaw_hook: Runtime events from progress-tracker
 * - ai_generation: GenerationTrace
 * - resource_contract: Resource injection/usage
 * - gateway: Transport/connectivity
 */

import { integrationLogger } from '../utils/logger.js';

const logger = integrationLogger.child({ component: 'TaskDebugSummaryService' });

// =============================================================================
// TYPES
// =============================================================================

export type DebugLayer =
  | 'ocaas_internal'
  | 'openclaw_runtime'
  | 'openclaw_hook'
  | 'ai_generation'
  | 'resource_contract'
  | 'gateway';

export type DebugSeverity = 'info' | 'warning' | 'error';
export type DebugStatus = 'pass' | 'degraded' | 'fail' | 'unknown';

export interface DebugIssue {
  layer: DebugLayer;
  severity: DebugSeverity;
  status: DebugStatus;
  summary: string;
  evidence: string;
  suggested_next_check?: string;
}

export interface LastUsefulEvent {
  timestamp: number;
  layer: string;
  event: string;
  summary: string;
}

export interface TaskDebugSummary {
  taskId: string;
  taskStatus: string;
  overall_status: DebugStatus;
  issues: DebugIssue[];
  last_useful_event: LastUsefulEvent | null;
  layers_checked: DebugLayer[];
}

// =============================================================================
// SERVICE
// =============================================================================

export async function getTaskDebugSummary(taskId: string): Promise<TaskDebugSummary> {
  const issues: DebugIssue[] = [];
  const layersChecked: DebugLayer[] = [];
  let lastUsefulEvent: LastUsefulEvent | null = null;
  let taskStatus = 'unknown';

  // =========================================================================
  // Get task basic info
  // =========================================================================
  try {
    const { getServices } = await import('./index.js');
    const { taskService } = getServices();
    const task = await taskService.getById(taskId);
    taskStatus = task.status;
  } catch {
    // Task not found - still continue with available data
  }

  // =========================================================================
  // Layer 1: OCAAS Internal (TaskStateManager)
  // =========================================================================
  try {
    layersChecked.push('ocaas_internal');
    const { getTaskStateManager } = await import('../execution/TaskStateManager/index.js');
    const taskStateManager = getTaskStateManager();
    const state = await taskStateManager.getState(taskId);

    if (!state) {
      issues.push({
        layer: 'ocaas_internal',
        severity: 'info',
        status: 'unknown',
        summary: 'No OCAAS state initialized',
        evidence: 'TaskStateManager returned null',
        suggested_next_check: 'Task may be pending or not yet processed',
      });
    } else {
      // Check for failed steps
      const failedSteps = state.steps.filter(s => s.status === 'failed');
      if (failedSteps.length > 0) {
        const lastFailed = failedSteps[failedSteps.length - 1]!;
        issues.push({
          layer: 'ocaas_internal',
          severity: 'error',
          status: 'fail',
          summary: `Step failed: ${lastFailed.name}`,
          evidence: lastFailed.error || 'No error message',
          suggested_next_check: 'Check step error details in timeline',
        });
      }

      // Check phase
      if (state.phase === 'failed') {
        issues.push({
          layer: 'ocaas_internal',
          severity: 'error',
          status: 'fail',
          summary: 'Task phase is failed',
          evidence: `Phase: ${state.phase}`,
        });
      } else if (state.phase === 'paused') {
        issues.push({
          layer: 'ocaas_internal',
          severity: 'warning',
          status: 'degraded',
          summary: 'Task is paused',
          evidence: state.pausedReason || 'No reason provided',
          suggested_next_check: 'Resume task or check pause reason',
        });
      } else if (state.phase === 'completed') {
        issues.push({
          layer: 'ocaas_internal',
          severity: 'info',
          status: 'pass',
          summary: 'OCAAS state completed',
          evidence: `Phase: ${state.phase}, ${state.steps.filter(s => s.status === 'completed').length}/${state.steps.length} steps`,
        });
      }

      // Warnings
      if (state.warnings && state.warnings.length > 0) {
        issues.push({
          layer: 'ocaas_internal',
          severity: 'warning',
          status: 'degraded',
          summary: `${state.warnings.length} warning(s)`,
          evidence: state.warnings.join('; '),
        });
      }

      // Update last useful event
      if (state.updatedAt) {
        lastUsefulEvent = {
          timestamp: state.updatedAt,
          layer: 'ocaas_internal',
          event: 'state_update',
          summary: `Phase: ${state.phase}`,
        };
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check ocaas_internal');
  }

  // =========================================================================
  // Layer 2: OpenClaw Runtime (Session Status)
  // =========================================================================
  try {
    layersChecked.push('openclaw_runtime');
    const { getGateway } = await import('../openclaw/gateway.js');
    const gateway = getGateway();

    const wsConnected = gateway.isWsConnected();
    if (!wsConnected) {
      issues.push({
        layer: 'openclaw_runtime',
        severity: 'warning',
        status: 'degraded',
        summary: 'WebSocket not connected',
        evidence: 'gateway.isWsConnected() = false',
        suggested_next_check: 'Check OpenClaw gateway connectivity',
      });
    } else {
      // Check session exists
      const { getTaskStateManager } = await import('../execution/TaskStateManager/index.js');
      const taskStateManager = getTaskStateManager();
      const state = await taskStateManager.getState(taskId);
      const sessionKey = state?.sessionKey;

      const sessions = await gateway.listSessions();
      const matchingSession = sessionKey
        ? sessions.find(s => s.id === sessionKey || s.id.includes(taskId))
        : sessions.find(s => s.id.includes(taskId));

      if (!matchingSession) {
        issues.push({
          layer: 'openclaw_runtime',
          severity: 'info',
          status: 'unknown',
          summary: 'Session not found in OpenClaw',
          evidence: sessionKey ? `sessionKey: ${sessionKey}` : 'No sessionKey',
          suggested_next_check: 'Session may have ended or never started',
        });
      } else {
        issues.push({
          layer: 'openclaw_runtime',
          severity: 'info',
          status: matchingSession.status === 'active' ? 'pass' : 'unknown',
          summary: `Session: ${matchingSession.status}`,
          evidence: `sessionId: ${matchingSession.id}`,
        });
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check openclaw_runtime');
  }

  // =========================================================================
  // Layer 3: OpenClaw Hook (Runtime Events)
  // =========================================================================
  try {
    layersChecked.push('openclaw_hook');
    const { getRuntimeEvents } = await import('./RuntimeEventsService.js');
    const { getTaskStateManager } = await import('../execution/TaskStateManager/index.js');
    const taskStateManager = getTaskStateManager();
    const state = await taskStateManager.getState(taskId);

    const runtimeResult = await getRuntimeEvents(taskId, state?.sessionKey);

    if (!runtimeResult.logExists) {
      issues.push({
        layer: 'openclaw_hook',
        severity: 'info',
        status: 'unknown',
        summary: 'Hook log not found',
        evidence: runtimeResult.limitation || 'Log file does not exist',
        suggested_next_check: 'Verify progress-tracker hook is installed',
      });
    } else if (!runtimeResult.hasEvents) {
      issues.push({
        layer: 'openclaw_hook',
        severity: 'warning',
        status: 'degraded',
        summary: 'Log exists but no events',
        evidence: `logPath: ${runtimeResult.logPath}`,
        suggested_next_check: 'Session may not have started execution',
      });
    } else {
      const lastEvent = runtimeResult.events[runtimeResult.events.length - 1]!;
      issues.push({
        layer: 'openclaw_hook',
        severity: 'info',
        status: 'pass',
        summary: `${runtimeResult.events.length} runtime events captured`,
        evidence: `Last: ${lastEvent.event}`,
      });

      // Update last useful event if newer
      if (!lastUsefulEvent || lastEvent.timestamp > lastUsefulEvent.timestamp) {
        lastUsefulEvent = {
          timestamp: lastEvent.timestamp,
          layer: 'openclaw_hook',
          event: lastEvent.event,
          summary: lastEvent.summary,
        };
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check openclaw_hook');
  }

  // =========================================================================
  // Layer 4: AI Generation (GenerationTrace)
  // =========================================================================
  try {
    layersChecked.push('ai_generation');
    const { getGenerationTraceService } = await import('../execution/GenerationTraceService.js');
    const traceService = getGenerationTraceService();
    const trace = traceService.getByTask(taskId);

    if (!trace) {
      issues.push({
        layer: 'ai_generation',
        severity: 'info',
        status: 'unknown',
        summary: 'No generation trace',
        evidence: 'Task may not have executed yet',
      });
    } else {
      // Check execution mode
      if (trace.executionMode === 'stub') {
        issues.push({
          layer: 'ai_generation',
          severity: 'warning',
          status: 'degraded',
          summary: 'Executed in stub mode',
          evidence: `executionMode: stub`,
          suggested_next_check: 'Verify agent is materialized and runtime_ready',
        });
      }

      // Check fallback
      if (trace.fallbackUsed) {
        issues.push({
          layer: 'ai_generation',
          severity: 'warning',
          status: 'degraded',
          summary: 'Fallback was used',
          evidence: trace.fallbackReason || 'No reason specified',
          suggested_next_check: 'Check primary execution path',
        });
      }

      // Check AI success
      if (trace.aiRequested && !trace.aiSucceeded) {
        issues.push({
          layer: 'ai_generation',
          severity: 'error',
          status: 'fail',
          summary: 'AI execution failed',
          evidence: trace.error || 'AI was requested but did not succeed',
          suggested_next_check: 'Check gateway connectivity and model availability',
        });
      } else if (trace.aiSucceeded) {
        issues.push({
          layer: 'ai_generation',
          severity: 'info',
          status: 'pass',
          summary: `AI execution succeeded (${trace.executionMode})`,
          evidence: trace.model ? `model: ${trace.model}` : 'Response received',
        });
      }

      // Check for error
      if (trace.error) {
        issues.push({
          layer: 'ai_generation',
          severity: 'error',
          status: 'fail',
          summary: 'Generation error',
          evidence: trace.error,
        });
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check ai_generation');
  }

  // =========================================================================
  // Layer 5: Resource Contract
  // =========================================================================
  try {
    layersChecked.push('resource_contract');
    const { getDiagnosticService } = await import('./DiagnosticService.js');
    const diagnosticService = getDiagnosticService();
    const diagnostics = await diagnosticService.getTaskDiagnostics(taskId);

    const resources = diagnostics.execution_summary?.resources;
    if (resources) {
      if (!resources.usage_verified) {
        issues.push({
          layer: 'resource_contract',
          severity: 'info',
          status: 'unknown',
          summary: 'Resource usage not verified',
          evidence: resources.unverified_reason || 'No structured confirmation from runtime',
          suggested_next_check: 'Cannot confirm tools/skills were actually used',
        });
      } else {
        issues.push({
          layer: 'resource_contract',
          severity: 'info',
          status: 'pass',
          summary: 'Resource usage verified',
          evidence: `tools: ${resources.tools_used?.length || 0}, skills: ${resources.skills_used?.length || 0}`,
        });
      }

      // Check injection mode
      if (resources.injection_mode === 'none') {
        issues.push({
          layer: 'resource_contract',
          severity: 'warning',
          status: 'degraded',
          summary: 'No resources injected',
          evidence: 'injection_mode: none',
        });
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check resource_contract');
  }

  // =========================================================================
  // Layer 6: Gateway
  // =========================================================================
  try {
    layersChecked.push('gateway');
    const { getDiagnosticService } = await import('./DiagnosticService.js');
    const diagnosticService = getDiagnosticService();
    const diagnostics = await diagnosticService.getTaskDiagnostics(taskId);

    const execSummary = diagnostics.execution_summary;
    if (execSummary) {
      if (execSummary.transport_success === false) {
        issues.push({
          layer: 'gateway',
          severity: 'error',
          status: 'fail',
          summary: 'Transport failed',
          evidence: execSummary.gap || execSummary.fallback_reason || 'transport_success: false',
          suggested_next_check: 'Check OpenClaw gateway health',
        });
      } else if (execSummary.transport_success === true) {
        issues.push({
          layer: 'gateway',
          severity: 'info',
          status: 'pass',
          summary: 'Transport succeeded',
          evidence: execSummary.session_id ? `session: ${execSummary.session_id}` : 'Connection established',
        });
      }
    }
  } catch (err) {
    logger.debug({ err, taskId }, 'Failed to check gateway');
  }

  // =========================================================================
  // Calculate overall status
  // =========================================================================
  const hasError = issues.some(i => i.status === 'fail');
  const hasDegraded = issues.some(i => i.status === 'degraded');
  const hasPass = issues.some(i => i.status === 'pass');
  const allUnknown = issues.every(i => i.status === 'unknown');

  let overallStatus: DebugStatus = 'unknown';
  if (hasError) {
    overallStatus = 'fail';
  } else if (hasDegraded) {
    overallStatus = 'degraded';
  } else if (hasPass) {
    overallStatus = 'pass';
  } else if (allUnknown) {
    overallStatus = 'unknown';
  }

  logger.debug({
    taskId,
    taskStatus,
    overallStatus,
    issueCount: issues.length,
    layersChecked,
  }, 'Built debug summary');

  return {
    taskId,
    taskStatus,
    overall_status: overallStatus,
    issues,
    last_useful_event: lastUsefulEvent,
    layers_checked: layersChecked,
  };
}

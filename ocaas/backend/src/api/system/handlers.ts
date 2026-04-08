import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getServices } from '../../services/index.js';
import { toErrorResponse } from '../../utils/errors.js';
import {
  getAutonomyConfig,
  saveAutonomyConfig,
  loadAutonomyConfig,
} from '../../config/autonomy.js';
import { getTaskRouter, getFeedbackService } from '../../orchestrator/index.js';
import { getOpenClawAdapter } from '../../integrations/openclaw/index.js';
import { getSystemDiagnosticsService, getTaskTimelineService } from '../../system/index.js';
// NOTE: Gateway import kept ONLY for getDiagnostic() which needs full diagnostic object
// All other methods use the adapter
import { getGateway } from '../../openclaw/gateway.js';
import { getRuntimeInfo, getRuntimeSummary, checkEnvironment } from '../../utils/runtime.js';
import { getJobSafetyService } from '../../execution/JobSafetyService.js';
import { getJobDispatcherService } from '../../execution/JobDispatcherService.js';
import { queryLogs, getErrorLogs, getRecentLogs } from '../../utils/dbLogger.js';
import { getAIClient } from '../../generator/AIClient.js';

/**
 * Backend health check - includes runtime metadata for observability
 */
export async function health(_req: FastifyRequest, reply: FastifyReply) {
  const summary = getRuntimeSummary();
  return reply.send({
    status: 'ok',
    timestamp: Date.now(),
    ...summary,
  });
}

/**
 * Full runtime info - detailed system information
 * GET /api/system/runtime
 */
export async function runtimeInfo(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const info = getRuntimeInfo();
    const envCheck = checkEnvironment();

    return reply.send({
      data: {
        ...info,
        environment: envCheck,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Environment check - detect runtime issues
 * GET /api/system/environment
 */
export async function environmentCheck(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as { refresh?: string };
    const forceRefresh = query.refresh === 'true';
    const envCheck = checkEnvironment(forceRefresh);

    return reply.send({ data: envCheck });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * OpenClaw Gateway diagnostic - full connectivity test
 * Returns detailed status of REST API, Webhooks, Generation, and WebSocket
 */
export async function gatewayDiagnostic(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const gateway = getGateway();
    const diagnostic = await gateway.getDiagnostic();

    return reply.send({
      data: diagnostic,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Quick gateway status - for StatusBar polling
 *
 * HONEST: Uses getQuickStatus() which makes REAL requests.
 * Returns QuickStatus format that frontend expects (with probe, hooks.probed, etc.)
 */
export async function gatewayStatus(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const gateway = getGateway();
    const status = await gateway.getQuickStatus();

    return reply.send({
      data: status,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function stats(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { agentService, taskService, generationService, approvalService } = getServices();
    const feedbackService = getFeedbackService();

    const [agents, tasks, generations, approvals, feedback] = await Promise.all([
      agentService.list(),
      taskService.list({ limit: 1000 }),
      generationService.list(),
      approvalService.list(),
      feedbackService.getAll(),
    ]);

    const agentStats = {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
      inactive: agents.filter(a => a.status === 'inactive').length,
      busy: agents.filter(a => a.status === 'busy').length,
      error: agents.filter(a => a.status === 'error').length,
    };

    // Separate parent tasks from subtasks
    const parentTasks = tasks.filter(t => !t.parentTaskId);
    const subtasks = tasks.filter(t => t.parentTaskId);
    const decomposedTasks = parentTasks.filter(t => t.metadata?._decomposed);

    const taskStats = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      queued: tasks.filter(t => t.status === 'queued').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      // Additional metrics
      parentTasks: parentTasks.length,
      subtasks: subtasks.length,
      decomposed: decomposedTasks.length,
      subtasksCompleted: subtasks.filter(t => t.status === 'completed').length,
      subtasksFailed: subtasks.filter(t => t.status === 'failed').length,
    };

    const generationStats = {
      total: generations.length,
      pending: generations.filter(g => g.status === 'pending_approval').length,
      approved: generations.filter(g => g.status === 'approved' || g.status === 'active').length,
      rejected: generations.filter(g => g.status === 'rejected').length,
      active: generations.filter(g => g.status === 'active').length,
      failed: generations.filter(g => g.status === 'failed').length,
    };

    const approvalStats = {
      total: approvals.length,
      pending: approvals.filter(a => a.status === 'pending').length,
      approved: approvals.filter(a => a.status === 'approved').length,
      rejected: approvals.filter(a => a.status === 'rejected').length,
      expired: approvals.filter(a => a.status === 'expired').length,
    };

    const feedbackStats = {
      total: feedback.length,
      processed: feedback.filter(f => f.processed).length,
      unprocessed: feedback.filter(f => !f.processed).length,
      byType: {
        missingTool: feedback.filter(f => f.type === 'missing_tool').length,
        missingSkill: feedback.filter(f => f.type === 'missing_skill').length,
        missingCapability: feedback.filter(f => f.type === 'missing_capability').length,
        blocked: feedback.filter(f => f.type === 'blocked').length,
      },
    };

    // Get orchestrator status
    const taskRouter = getTaskRouter();
    const orchestratorStatus = taskRouter.getStatus();

    // Get gateway status via adapter
    const adapter = getOpenClawAdapter();

    return reply.send({
      agents: agentStats,
      tasks: taskStats,
      generations: generationStats,
      approvals: approvalStats,
      feedback: feedbackStats,
      orchestrator: {
        running: orchestratorStatus.running,
        queueSize: orchestratorStatus.queueSize,
        processing: orchestratorStatus.processing,
        sequentialMode: orchestratorStatus.sequentialMode,
      },
      gateway: {
        restConnected: adapter.isConnected(),
        wsConnected: adapter.isWsConnected(),
      },
      system: {
        uptime: process.uptime() * 1000,
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function events(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as { limit?: string; category?: string };
    const { eventService } = getServices();
    const data = await eventService.list({
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      category: query.category,
    });
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// Autonomy config schema
const UpdateAutonomySchema = z.object({
  level: z.enum(['manual', 'supervised', 'autonomous']).optional(),
  canCreateAgents: z.boolean().optional(),
  canGenerateSkills: z.boolean().optional(),
  canGenerateTools: z.boolean().optional(),
  requireApprovalFor: z.object({
    taskExecution: z.enum(['none', 'high_priority', 'all']).optional(),
    agentCreation: z.boolean().optional(),
    skillGeneration: z.boolean().optional(),
    toolGeneration: z.boolean().optional(),
  }).optional(),
  humanTimeout: z.number().positive().optional(),
  fallbackBehavior: z.enum(['pause', 'reject', 'auto_approve']).optional(),
  sequentialExecution: z.boolean().optional(),
});

export async function getAutonomy(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const config = await loadAutonomyConfig();
    const taskRouter = getTaskRouter();
    const routerStatus = taskRouter.getStatus();

    return reply.send({
      data: {
        ...config,
        orchestrator: {
          running: routerStatus.running,
          queueSize: routerStatus.queueSize,
          processing: routerStatus.processing,
        },
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function updateAutonomy(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = UpdateAutonomySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const updated = await saveAutonomyConfig(parsed.data);

    // Apply sequential mode to TaskRouter
    const taskRouter = getTaskRouter();
    taskRouter.setSequentialMode(updated.sequentialExecution);

    return reply.send({ data: updated });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getOrchestratorStatus(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const taskRouter = getTaskRouter();
    const status = taskRouter.getStatus();
    const autonomy = getAutonomyConfig();

    return reply.send({
      data: {
        ...status,
        autonomyLevel: autonomy.level,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// SYSTEM DIAGNOSTICS
// =============================================================================

/**
 * GET /api/system/diagnostics
 * Full system health diagnostics
 */
export async function systemDiagnostics(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const diagnostics = getSystemDiagnosticsService();
    const result = await diagnostics.getSystemHealth();
    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/readiness
 * Production readiness report
 */
export async function systemReadiness(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const diagnostics = getSystemDiagnosticsService();
    const result = await diagnostics.getReadinessReport();
    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/issues
 * Get only critical issues and warnings
 */
export async function systemIssues(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const diagnostics = getSystemDiagnosticsService();
    const [critical, warnings] = await Promise.all([
      diagnostics.getCriticalIssues(),
      diagnostics.getWarnings(),
    ]);
    return reply.send({
      data: {
        critical,
        warnings,
        totalCritical: critical.length,
        totalWarnings: warnings.length,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/metrics
 * Current system metrics snapshot
 */
export async function systemMetrics(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const diagnostics = getSystemDiagnosticsService();
    const result = await diagnostics.getMetrics();
    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// TASK TIMELINE & OBSERVABILITY
// =============================================================================

/**
 * GET /api/system/overview
 * Comprehensive system overview with problem detection
 */
export async function systemOverview(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const timeline = getTaskTimelineService();
    const result = await timeline.getSystemOverview();
    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/tasks/:taskId/timeline
 * Get complete timeline for a specific task
 */
export async function taskTimeline(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { taskId } = req.params as { taskId: string };
    const timeline = getTaskTimelineService();
    const result = await timeline.getTaskTimeline(taskId);

    if (!result) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/problems/stuck
 * Get all stuck tasks
 */
export async function stuckTasks(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const timeline = getTaskTimelineService();
    const result = await timeline.getStuckTasks();
    return reply.send({
      data: result,
      count: result.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/problems/high-retry
 * Get tasks with high retry counts
 */
export async function highRetryTasks(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const timeline = getTaskTimelineService();
    const result = await timeline.getHighRetryTasks();
    return reply.send({
      data: result,
      count: result.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/problems/blocked
 * Get blocked tasks
 */
export async function blockedTasks(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const timeline = getTaskTimelineService();
    const result = await timeline.getBlockedTasks();
    return reply.send({
      data: result,
      count: result.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/problems
 * Get all problem tasks combined
 */
export async function allProblems(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const timeline = getTaskTimelineService();
    const [stuck, highRetry, blocked] = await Promise.all([
      timeline.getStuckTasks(),
      timeline.getHighRetryTasks(),
      timeline.getBlockedTasks(),
    ]);

    return reply.send({
      data: {
        stuck,
        highRetry,
        blocked,
      },
      counts: {
        stuck: stuck.length,
        highRetry: highRetry.length,
        blocked: blocked.length,
        total: stuck.length + highRetry.length + blocked.length,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// SAFETY & LOGS (Production Hardening)
// =============================================================================

/**
 * GET /api/system/safety
 * Job safety status (failsafe, retries, whitelist)
 */
export async function getSafetyStatus(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const safety = getJobSafetyService();
    const failsafe = safety.getFailsafeState();
    const whitelist = safety.getWhitelist();

    return reply.send({
      data: {
        failsafe: {
          active: failsafe.active,
          reason: failsafe.reason,
          activatedAt: failsafe.activatedAt,
          consecutiveFailures: failsafe.consecutiveFailures,
        },
        toolWhitelist: {
          enabled: whitelist.length > 0,
          tools: whitelist,
        },
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * POST /api/system/safety/failsafe/deactivate
 * Manually deactivate failsafe mode
 */
export async function deactivateFailsafe(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const safety = getJobSafetyService();
    safety.deactivateFailsafe();
    return reply.send({ data: { deactivated: true } });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/logs
 * Query system logs
 */
export async function getLogs(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as {
      level?: string;
      source?: string;
      jobId?: string;
      limit?: string;
    };

    const logs = queryLogs({
      level: query.level as 'debug' | 'info' | 'warn' | 'error' | 'fatal' | undefined,
      source: query.source,
      jobId: query.jobId,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
    });

    return reply.send({
      data: logs,
      count: logs.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/logs/errors
 * Get recent error logs
 */
export async function getLogsErrors(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as { limit?: string };
    const logs = getErrorLogs(query.limit ? parseInt(query.limit, 10) : 50);

    return reply.send({
      data: logs,
      count: logs.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/system/logs/recent
 * Get recent logs (last N minutes)
 */
export async function getLogsRecent(req: FastifyRequest, reply: FastifyReply) {
  try {
    const query = req.query as { minutes?: string; limit?: string };
    const logs = getRecentLogs(
      query.minutes ? parseInt(query.minutes, 10) : 60,
      query.limit ? parseInt(query.limit, 10) : 200
    );

    return reply.send({
      data: logs,
      count: logs.length,
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// FULL DIAGNOSTICS (PROMPT 20 + 20B)
// =============================================================================

/**
 * PROMPT 20B: Full system diagnostics with REAL E2E tests
 * GET /api/system/full-diagnostics
 *
 * Runs actual tests, not just state checks:
 * - gateway: Real REST API call
 * - hooks: Real hooks/agent ping
 * - ai_generation: Real AI generation test with trace
 * - agents: Agent counts and materialization status
 * - pipeline: Real pipeline test (creates diagnostic task)
 */
export async function fullDiagnostics(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const adapter = getOpenClawAdapter();
    const { agentService, taskService } = getServices();
    const jobDispatcher = getJobDispatcherService();
    const taskRouter = getTaskRouter();
    const aiClient = getAIClient();

    const startTime = Date.now();

    // 1. Gateway test (REAL REST API call)
    let gatewayResult: {
      ok: boolean;
      reachable: boolean;
      authenticated: boolean;
      latency_ms: number;
      error?: string;
    };
    try {
      const gwStart = Date.now();
      const testResult = await adapter.testConnection();
      gatewayResult = {
        ok: testResult.success,
        reachable: testResult.success,
        authenticated: testResult.success,
        latency_ms: Date.now() - gwStart,
        error: testResult.error?.message,
      };
    } catch (err) {
      gatewayResult = {
        ok: false,
        reachable: false,
        authenticated: false,
        latency_ms: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 2. Hooks test (REAL hooks/agent ping)
    let hooksResult: {
      ok: boolean;
      configured: boolean;
      reached_gateway: boolean;
      accepted: boolean;
      latency_ms: number;
      error?: string;
    };
    try {
      const hooksStart = Date.now();
      const hooksConfigured = adapter.isHooksConfigured();

      if (!hooksConfigured) {
        hooksResult = {
          ok: false,
          configured: false,
          reached_gateway: false,
          accepted: false,
          latency_ms: Date.now() - hooksStart,
          error: 'Hooks not configured',
        };
      } else {
        // REAL hooks test: send ping via hooks
        const pingResult = await adapter.executeViaHooks({
          agentId: 'diagnostic-ping',
          prompt: 'DIAGNOSTIC PING - respond with "pong"',
          name: `OCAAS Diagnostic Ping ${Date.now()}`,
        });

        hooksResult = {
          ok: pingResult.success,
          configured: true,
          reached_gateway: true, // If we got a response, we reached gateway
          accepted: pingResult.accepted ?? false,
          latency_ms: Date.now() - hooksStart,
          error: pingResult.error?.message,
        };
      }
    } catch (err) {
      hooksResult = {
        ok: false,
        configured: adapter.isHooksConfigured(),
        reached_gateway: false,
        accepted: false,
        latency_ms: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 3. AI Generation test (REAL generation with trace)
    let aiGenerationResult: {
      ok: boolean;
      runtime: 'agent' | 'chat_completion' | 'unavailable';
      reached_gateway: boolean;
      response_received: boolean;
      content_usable: boolean;
      latency_ms: number;
      error_stage?: string;
      error_message?: string;
    };
    try {
      const aiStart = Date.now();

      if (!aiClient.isConfigured()) {
        aiGenerationResult = {
          ok: false,
          runtime: 'unavailable',
          reached_gateway: false,
          response_received: false,
          content_usable: false,
          latency_ms: Date.now() - aiStart,
          error_stage: 'not_configured',
          error_message: 'AI client not configured',
        };
      } else {
        // REAL AI test: minimal generation
        try {
          const response = await aiClient.generate<{ test: string }>({
            type: 'tool',
            name: 'diagnostic-test',
            description: 'Diagnostic test',
            prompt: 'Generate a minimal JSON: {"test": "ok"}',
          });

          aiGenerationResult = {
            ok: true,
            runtime: response.runtime ?? 'chat_completion',
            reached_gateway: response.reachedGateway ?? true,
            response_received: response.rawResponseReceived ?? true,
            content_usable: response.contentUsable ?? true,
            latency_ms: Date.now() - aiStart,
          };
        } catch (aiErr: unknown) {
          // Extract trace from error
          const err = aiErr as {
            errorStage?: string;
            message?: string;
          };
          aiGenerationResult = {
            ok: false,
            runtime: 'unavailable',
            reached_gateway: err.errorStage !== 'gateway_unreachable',
            response_received: err.errorStage === 'parse_failed' || err.errorStage === 'invalid_shape',
            content_usable: false,
            latency_ms: Date.now() - aiStart,
            error_stage: err.errorStage ?? 'unknown',
            error_message: err.message ?? 'Unknown AI error',
          };
        }
      }
    } catch (err) {
      aiGenerationResult = {
        ok: false,
        runtime: 'unavailable',
        reached_gateway: false,
        response_received: false,
        content_usable: false,
        latency_ms: 0,
        error_stage: 'exception',
        error_message: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 4. Agents status
    let agentsResult: {
      ok: boolean;
      total: number;
      active: number;
      materialized: number;
      runtime_ready: number;
      error?: string;
    };
    try {
      const agents = await agentService.list();
      const activeAgents = agents.filter(a => a.status === 'active');

      // Check materialization status in config
      let materialized = 0;
      let runtimeReady = 0;
      for (const agent of agents) {
        const mat = (agent.config as Record<string, unknown>)?._materialization as Record<string, unknown> | undefined;
        if (mat) {
          if (mat.db_record && mat.workspace_exists) materialized++;
          if (mat.runtime_possible || mat.openclaw_session) runtimeReady++;
        }
      }

      agentsResult = {
        ok: activeAgents.length > 0,
        total: agents.length,
        active: activeAgents.length,
        materialized,
        runtime_ready: runtimeReady,
      };
    } catch (err) {
      agentsResult = {
        ok: false,
        total: 0,
        active: 0,
        materialized: 0,
        runtime_ready: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 5. Pipeline test (REAL - create diagnostic task, check job creation)
    let pipelineResult: {
      ok: boolean;
      orchestrator_running: boolean;
      task_created: boolean;
      job_created: boolean;
      queue_size: number;
      stuck_tasks: number;
      error?: string;
    };
    try {
      const routerStatus = taskRouter.getStatus();
      const tasks = await taskService.list({ limit: 100 });

      // Find stuck tasks (running > 15 min without update)
      const now = Date.now();
      const stuckTasks = tasks.filter(t =>
        t.status === 'running' &&
        (now - t.updatedAt * 1000) > 15 * 60 * 1000
      );

      // REAL pipeline test: create a diagnostic task
      let taskCreated = false;
      let jobCreated = false;
      let diagnosticTaskId: string | null = null;

      if (routerStatus.running && agentsResult.active > 0) {
        try {
          // Create diagnostic task
          const diagnosticTask = await taskService.create({
            title: `[DIAGNOSTIC] Pipeline test ${nanoid(6)}`,
            description: 'Automated diagnostic task - can be deleted',
            type: 'diagnostic',
            priority: 1,
            metadata: {
              _diagnostic: true,
              _diagnostic_created_at: Date.now(),
            },
          });
          diagnosticTaskId = diagnosticTask.id;
          taskCreated = true;

          // Queue and process briefly
          await taskRouter.submit(diagnosticTask);

          // Wait a short time for job creation (max 500ms)
          await new Promise(resolve => setTimeout(resolve, 500));

          // Check if job was created
          const jobs = jobDispatcher.getJobsByTask(diagnosticTask.id);
          jobCreated = jobs.length > 0;

          // Clean up: cancel the diagnostic task
          try {
            await taskService.cancel(diagnosticTask.id);
          } catch {
            // Ignore cleanup errors
          }
        } catch (pipelineErr) {
          // Pipeline test failed, but we still report what we found
          pipelineResult = {
            ok: false,
            orchestrator_running: routerStatus.running,
            task_created: taskCreated,
            job_created: jobCreated,
            queue_size: routerStatus.queueSize,
            stuck_tasks: stuckTasks.length,
            error: pipelineErr instanceof Error ? pipelineErr.message : 'Pipeline test failed',
          };
        }
      }

      pipelineResult = {
        ok: routerStatus.running && stuckTasks.length === 0 && (agentsResult.active === 0 || jobCreated),
        orchestrator_running: routerStatus.running,
        task_created: taskCreated,
        job_created: jobCreated,
        queue_size: routerStatus.queueSize,
        stuck_tasks: stuckTasks.length,
      };
    } catch (err) {
      pipelineResult = {
        ok: false,
        orchestrator_running: false,
        task_created: false,
        job_created: false,
        queue_size: 0,
        stuck_tasks: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Calculate overall status
    const allOk = gatewayResult.ok && hooksResult.ok && aiGenerationResult.ok && agentsResult.ok && pipelineResult.ok;
    const partialOk = gatewayResult.ok || aiGenerationResult.ok; // At least gateway or AI works

    return reply.send({
      data: {
        status: allOk ? 'healthy' : (partialOk ? 'degraded' : 'critical'),
        gateway: gatewayResult,
        hooks: hooksResult,
        ai_generation: aiGenerationResult,
        agents: agentsResult,
        pipeline: pipelineResult,
        duration_ms: Date.now() - startTime,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

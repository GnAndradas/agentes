import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getServices } from '../../services/index.js';
import { toErrorResponse } from '../../utils/errors.js';
import {
  getAutonomyConfig,
  saveAutonomyConfig,
  loadAutonomyConfig,
} from '../../config/autonomy.js';
import { getTaskRouter, getFeedbackService } from '../../orchestrator/index.js';
import { getOpenClawAdapter } from '../../integrations/openclaw/index.js';
import { getSystemDiagnosticsService } from '../../system/index.js';
// NOTE: Gateway import kept ONLY for getDiagnostic() which needs full diagnostic object
// All other methods use the adapter
import { getGateway } from '../../openclaw/gateway.js';

/**
 * Backend health check - just checks if OCAAS backend is running
 */
export async function health(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ status: 'ok', timestamp: Date.now() });
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

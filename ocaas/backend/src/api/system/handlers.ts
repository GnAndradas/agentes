import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getServices } from '../../services/index.js';
import { toErrorResponse } from '../../utils/errors.js';
import {
  getAutonomyConfig,
  saveAutonomyConfig,
  loadAutonomyConfig,
  type AutonomyConfig,
} from '../../config/autonomy.js';
import { getTaskRouter } from '../../orchestrator/index.js';

export async function health(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ status: 'ok', timestamp: Date.now() });
}

export async function stats(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { agentService, taskService, generationService } = getServices();

    const [agents, tasks, generations] = await Promise.all([
      agentService.list(),
      taskService.list({ limit: 500 }),
      generationService.list(),
    ]);

    const agentStats = {
      total: agents.length,
      active: agents.filter(a => a.status === 'active').length,
      inactive: agents.filter(a => a.status === 'inactive').length,
      busy: agents.filter(a => a.status === 'busy').length,
      error: agents.filter(a => a.status === 'error').length,
    };

    const taskStats = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      queued: tasks.filter(t => t.status === 'queued').length,
      running: tasks.filter(t => t.status === 'running').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
    };

    const generationStats = {
      total: generations.length,
      pending: generations.filter(g => g.status === 'pending_approval').length,
      approved: generations.filter(g => g.status === 'approved' || g.status === 'active').length,
      rejected: generations.filter(g => g.status === 'rejected').length,
    };

    return reply.send({
      agents: agentStats,
      tasks: taskStats,
      generations: generationStats,
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

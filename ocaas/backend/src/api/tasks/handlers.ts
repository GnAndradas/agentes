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

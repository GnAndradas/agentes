/**
 * Jobs API Handlers
 *
 * Endpoints for job visibility and control
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getJobDispatcherService } from '../../execution/JobDispatcherService.js';
import { resolveBlockedJob, scheduleRetry, cancelPendingRetry } from '../../execution/JobResolutionService.js';
import { toErrorResponse } from '../../utils/errors.js';
import type { JobStatus, BlockingSuggestion } from '../../execution/types.js';

/**
 * List all jobs with optional filters
 */
export async function listJobs(
  req: FastifyRequest<{
    Querystring: {
      status?: JobStatus;
      taskId?: string;
      agentId?: string;
      limit?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    let jobs = dispatcher.getAllJobs();

    // Apply filters
    if (req.query.status) {
      jobs = jobs.filter((j) => j.status === req.query.status);
    }
    if (req.query.taskId) {
      jobs = jobs.filter((j) => j.payload.taskId === req.query.taskId);
    }
    if (req.query.agentId) {
      jobs = jobs.filter((j) => j.payload.agent.agentId === req.query.agentId);
    }

    // Sort by most recent first
    jobs.sort((a, b) => b.createdAt - a.createdAt);

    // Apply limit
    const limit = parseInt(req.query.limit || '50', 10);
    jobs = jobs.slice(0, limit);

    // Map to API response format
    const data = jobs.map((job) => ({
      id: job.id,
      taskId: job.payload.taskId,
      agentId: job.payload.agent.agentId,
      agentName: job.payload.agent.name,
      agentRole: job.payload.agent.role,
      goal: job.payload.goal,
      status: job.status,
      sessionId: job.sessionId,
      result: job.response?.result
        ? {
            output: job.response.result.output?.slice(0, 500),
            actionsSummary: job.response.result.actionsSummary,
            toolsUsed: job.response.result.toolsUsed,
          }
        : null,
      error: job.response?.error,
      blocked: job.response?.blocked,
      metrics: job.response?.metrics,
      eventsCount: job.events.length,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.response?.completedAt,
    }));

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get single job by ID
 */
export async function getJob(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const job = dispatcher.getJob(req.params.id);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return reply.send({
      data: {
        id: job.id,
        taskId: job.payload.taskId,
        agentId: job.payload.agent.agentId,
        agentName: job.payload.agent.name,
        agentRole: job.payload.agent.role,
        goal: job.payload.goal,
        description: job.payload.description,
        status: job.status,
        sessionId: job.sessionId,
        payload: job.payload,
        response: job.response,
        events: job.events,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get jobs for a specific task
 */
export async function getJobsByTask(
  req: FastifyRequest<{ Params: { taskId: string } }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const jobs = dispatcher.getJobsByTask(req.params.taskId);

    const data = jobs.map((job) => ({
      id: job.id,
      agentId: job.payload.agent.agentId,
      agentName: job.payload.agent.name,
      agentRole: job.payload.agent.role,
      status: job.status,
      sessionId: job.sessionId,
      result: job.response?.result
        ? {
            output: job.response.result.output?.slice(0, 500),
            actionsSummary: job.response.result.actionsSummary,
          }
        : null,
      error: job.response?.error,
      blocked: job.response?.blocked,
      createdAt: job.createdAt,
      completedAt: job.response?.completedAt,
    }));

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get jobs for a specific agent
 */
export async function getJobsByAgent(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const jobs = dispatcher.getJobsByAgent(req.params.agentId);

    const data = jobs.map((job) => ({
      id: job.id,
      taskId: job.payload.taskId,
      goal: job.payload.goal,
      status: job.status,
      sessionId: job.sessionId,
      createdAt: job.createdAt,
      completedAt: job.response?.completedAt,
    }));

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Abort a running job
 */
export async function abortJob(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const success = await dispatcher.abort(req.params.id);

    if (!success) {
      return reply.status(400).send({ error: 'Job cannot be aborted (not running or not found)' });
    }

    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Retry a failed job
 */
export async function retryJob(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const result = await dispatcher.retry(req.params.id);

    if (!result) {
      return reply.status(400).send({ error: 'Job cannot be retried (running or not found)' });
    }

    return reply.send({
      data: {
        newJobId: result.jobId,
        dispatched: result.dispatched,
        error: result.error,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get job stats summary
 */
export async function getJobStats(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const dispatcher = getJobDispatcherService();
    const allJobs = dispatcher.getAllJobs();

    const stats = {
      total: allJobs.length,
      pending: allJobs.filter((j) => j.status === 'pending').length,
      running: allJobs.filter((j) => j.status === 'running').length,
      completed: allJobs.filter((j) => j.status === 'completed').length,
      failed: allJobs.filter((j) => j.status === 'failed').length,
      blocked: allJobs.filter((j) => j.status === 'blocked').length,
      cancelled: allJobs.filter((j) => j.status === 'cancelled').length,
      timeout: allJobs.filter((j) => j.status === 'timeout').length,
    };

    return reply.send({ data: stats });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get active/running jobs
 */
export async function getActiveJobs(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const dispatcher = getJobDispatcherService();
    const jobs = dispatcher.getActiveJobs();

    const data = jobs.map((job) => ({
      id: job.id,
      taskId: job.payload.taskId,
      agentId: job.payload.agent.agentId,
      agentName: job.payload.agent.name,
      goal: job.payload.goal,
      sessionId: job.sessionId,
      createdAt: job.createdAt,
      runningFor: Date.now() - job.createdAt,
    }));

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get blocked jobs
 */
export async function getBlockedJobs(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const dispatcher = getJobDispatcherService();
    const jobs = dispatcher.getBlockedJobs();

    const data = jobs.map((job) => ({
      id: job.id,
      taskId: job.payload.taskId,
      agentId: job.payload.agent.agentId,
      agentName: job.payload.agent.name,
      goal: job.payload.goal,
      blocked: job.response?.blocked,
      createdAt: job.createdAt,
    }));

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Resolve a blocked job by applying a suggestion
 */
export async function resolveJob(
  req: FastifyRequest<{
    Params: { id: string };
    Body: { suggestionIndex: number; autoApprove?: boolean };
  }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const job = dispatcher.getJob(req.params.id);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    if (job.status !== 'blocked' || !job.response?.blocked) {
      return reply.status(400).send({ error: 'Job is not blocked' });
    }

    const suggestion = job.response.blocked.suggestions[req.body.suggestionIndex];
    if (!suggestion) {
      return reply.status(400).send({ error: 'Invalid suggestion index' });
    }

    const result = await resolveBlockedJob({
      jobId: job.id,
      suggestion,
      autoApprove: req.body.autoApprove,
    });

    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Schedule retry for a job
 */
export async function scheduleJobRetry(
  req: FastifyRequest<{
    Params: { id: string };
    Body: { delayMs?: number; reason?: string };
  }>,
  reply: FastifyReply
) {
  try {
    const dispatcher = getJobDispatcherService();
    const job = dispatcher.getJob(req.params.id);

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    scheduleRetry(job.id, req.body.delayMs || 1000, req.body.reason || 'manual');

    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Cancel scheduled retry
 */
export async function cancelJobRetry(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const cancelled = cancelPendingRetry(req.params.id);
    return reply.send({ success: true, wasPending: cancelled });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

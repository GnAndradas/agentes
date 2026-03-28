import type { FastifyRequest, FastifyReply } from 'fastify';
import { getFeedbackService } from '../../orchestrator/feedback/index.js';
import { CreateFeedbackSchema, ListFeedbackQuerySchema } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

type IdParam = { Params: { id: string } };
type TaskIdParam = { Params: { taskId: string } };
type QueryParam = { Querystring: Record<string, string | undefined> };

/**
 * POST /api/feedback
 * Receive feedback from an agent during task execution
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const feedbackService = getFeedbackService();
    const feedback = await feedbackService.receiveFeedback(parsed.data);

    return reply.status(201).send({ data: feedback });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/feedback
 * List feedback with optional filters
 */
export async function list(req: FastifyRequest<QueryParam>, reply: FastifyReply) {
  try {
    const parsed = ListFeedbackQuerySchema.safeParse(req.query);
    const opts = parsed.success ? parsed.data : {};

    const feedbackService = getFeedbackService();
    let data;

    if (opts.taskId) {
      data = await feedbackService.getByTask(opts.taskId);
    } else if (opts.processed === 'false') {
      data = await feedbackService.getUnprocessed();
    } else {
      // Return all feedback with optional filters
      data = await feedbackService.getAll({
        type: opts.type,
        processed: opts.processed === 'true' ? true : opts.processed === 'false' ? false : undefined,
      });
    }

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/feedback/:id
 * Get specific feedback by ID
 */
export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const feedbackService = getFeedbackService();
    const data = await feedbackService.getById(req.params.id);

    if (!data) {
      return reply.status(404).send({ error: 'Feedback not found' });
    }

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/feedback/task/:taskId
 * Get all feedback for a specific task
 */
export async function getByTask(req: FastifyRequest<TaskIdParam>, reply: FastifyReply) {
  try {
    const feedbackService = getFeedbackService();
    const data = await feedbackService.getByTask(req.params.taskId);

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * DELETE /api/feedback/task/:taskId
 * Clear feedback for a completed task
 */
export async function clearForTask(req: FastifyRequest<TaskIdParam>, reply: FastifyReply) {
  try {
    const feedbackService = getFeedbackService();
    await feedbackService.clearForTask(req.params.taskId);

    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

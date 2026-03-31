import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  IngestBodySchema,
  GetUserTasksParamsSchema,
  GetUserTasksQuerySchema,
  type IngestBody,
} from './schemas.js';
import type { ChannelType } from '../../services/ChannelService.js';

const logger = createLogger('channels-api');

/**
 * POST /api/channels/ingest
 * Ingest a message from an external channel and create a task
 */
export async function ingest(
  request: FastifyRequest<{ Body: IngestBody }>,
  reply: FastifyReply
) {
  const parsed = IngestBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: 'Invalid request body',
      details: parsed.error.issues,
    });
  }

  const { channelService } = getServices();

  try {
    const result = await channelService.ingest(parsed.data);

    logger.info({
      channel: parsed.data.channel,
      userId: parsed.data.userId,
      taskId: result.taskId,
    }, 'Channel message ingested');

    return reply.status(201).send(result);
  } catch (error) {
    logger.error({ error, body: parsed.data }, 'Failed to ingest channel message');
    return reply.status(500).send({
      error: 'Failed to ingest message',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * GET /api/channels/:channel/users/:userId/tasks
 * Get tasks for a specific channel user
 */
export async function getUserTasks(
  request: FastifyRequest<{
    Params: { channel: string; userId: string };
    Querystring: { limit?: number };
  }>,
  reply: FastifyReply
) {
  const paramsParsed = GetUserTasksParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return reply.status(400).send({
      error: 'Invalid params',
      details: paramsParsed.error.issues,
    });
  }

  const queryParsed = GetUserTasksQuerySchema.safeParse(request.query);
  if (!queryParsed.success) {
    return reply.status(400).send({
      error: 'Invalid query params',
      details: queryParsed.error.issues,
    });
  }

  const { channelService } = getServices();

  try {
    const tasks = await channelService.getTasksForUser(
      paramsParsed.data.channel as ChannelType,
      paramsParsed.data.userId,
      queryParsed.data.limit
    );

    return reply.send(tasks);
  } catch (error) {
    logger.error({ error, params: request.params }, 'Failed to get user tasks');
    return reply.status(500).send({
      error: 'Failed to get tasks',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

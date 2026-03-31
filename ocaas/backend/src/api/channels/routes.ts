import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';
import { verifyChannelSecret } from './middleware.js';

export async function channelRoutes(fastify: FastifyInstance) {
  // Apply channel secret verification to all routes
  fastify.addHook('preHandler', verifyChannelSecret);

  // Ingest endpoint - receives messages from external channels
  fastify.post('/ingest', h.ingest);

  // Get tasks for a specific channel user
  fastify.get('/:channel/users/:userId/tasks', h.getUserTasks);
}

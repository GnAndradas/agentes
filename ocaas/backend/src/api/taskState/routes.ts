/**
 * Task State API Routes (Fastify)
 */

import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function taskStateRoutes(fastify: FastifyInstance) {
  // State access
  fastify.get('/:id/state', h.getTaskState);
  fastify.get('/:id/state/snapshot', h.getTaskStateSnapshot);
  fastify.post('/:id/state/init', h.initTaskState);

  // Checkpoints
  fastify.get('/:id/checkpoints', h.getTaskCheckpoints);
  fastify.post('/:id/checkpoint', h.createCheckpoint);

  // Pause/Resume
  fastify.post('/:id/pause', h.pauseTask);
  fastify.post('/:id/resume', h.resumeTask);
}

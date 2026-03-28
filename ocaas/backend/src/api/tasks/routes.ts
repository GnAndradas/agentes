import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function taskRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/pending', h.getPending);
  fastify.get('/running', h.getRunning);
  fastify.get('/:id', h.get);
  fastify.get('/:id/subtasks', h.getSubtasks);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);
  fastify.post('/:id/assign', h.assign);
  fastify.post('/:id/queue', h.queue);
  fastify.post('/:id/start', h.start);
  fastify.post('/:id/complete', h.complete);
  fastify.post('/:id/fail', h.fail);
  fastify.post('/:id/cancel', h.cancel);
  fastify.post('/:id/retry', h.retry);
}

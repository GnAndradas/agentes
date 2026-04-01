import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function escalationRoutes(fastify: FastifyInstance) {
  // Human inbox (main entry point for DIOS)
  fastify.get('/inbox', h.inbox);
  fastify.get('/pending', h.pending);
  fastify.get('/stats', h.stats);

  // CRUD
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.get('/task/:taskId', h.getByTask);
  fastify.post('/', h.create);

  // Acknowledgment
  fastify.post('/:id/acknowledge', h.acknowledge);

  // Resolution actions
  fastify.post('/:id/approve', h.approve);
  fastify.post('/:id/reject', h.reject);
  fastify.post('/:id/provide-resource', h.provideResource);
  fastify.post('/:id/override', h.override);

  // Maintenance
  fastify.post('/process-expired', h.processExpired);
  fastify.post('/cleanup', h.cleanup);
}

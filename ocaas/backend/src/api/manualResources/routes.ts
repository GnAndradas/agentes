import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function manualResourceRoutes(fastify: FastifyInstance) {
  // CRUD
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.put('/:id', h.update);
  fastify.delete('/:id', h.remove);

  // Workflow actions
  fastify.post('/:id/submit', h.submit);
  fastify.post('/:id/approve', h.approve);
  fastify.post('/:id/reject', h.reject);
  fastify.post('/:id/activate', h.activate);
  fastify.post('/:id/deactivate', h.deactivate);
}

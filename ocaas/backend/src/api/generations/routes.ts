import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function generationRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/pending', h.getPending);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.delete('/:id', h.remove);
  fastify.post('/:id/approve', h.approve);
  fastify.post('/:id/reject', h.reject);
  fastify.post('/:id/activate', h.activate);
}

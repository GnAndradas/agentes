import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function approvalRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/pending', h.getPending);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.post('/:id/approve', h.approve);
  fastify.post('/:id/reject', h.reject);
  fastify.post('/:id/respond', h.respond);
  fastify.delete('/:id', h.remove);
}

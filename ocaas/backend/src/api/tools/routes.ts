import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function toolRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);
  fastify.post('/:id/assign', h.assign);
  fastify.delete('/:id/assign/:agentId', h.unassign);
}

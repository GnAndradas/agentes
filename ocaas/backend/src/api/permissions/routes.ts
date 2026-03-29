import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function permissionRoutes(fastify: FastifyInstance) {
  // Literal routes first
  fastify.get('/', h.list);
  fastify.post('/', h.create);
  fastify.post('/check', h.check);
  fastify.get('/agent/:agentId', h.getForAgent);
  // Parameterized routes after
  fastify.get('/:id', h.get);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);
}

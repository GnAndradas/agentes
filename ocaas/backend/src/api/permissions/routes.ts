import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function permissionRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);
  fastify.post('/check', h.check);
  fastify.get('/agent/:agentId', h.getForAgent);
}

import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function agentRoutes(fastify: FastifyInstance) {
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);
  fastify.post('/:id/activate', h.activate);
  fastify.post('/:id/deactivate', h.deactivate);
  fastify.get('/:id/skills', h.getSkills);
  fastify.get('/:id/tools', h.getTools);
  fastify.get('/:id/tasks', h.getTasks);
}

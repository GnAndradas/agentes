import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function toolRoutes(fastify: FastifyInstance) {
  // CRUD operations
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);

  // Assignment operations
  fastify.post('/:id/assign', h.assign);
  fastify.delete('/:id/assign/:agentId', h.unassign);

  // Validation operations (NEW)
  fastify.post('/validate', h.validateNew);           // Validate without saving
  fastify.post('/validate-config', h.validateConfig); // Validate just config
  fastify.post('/:id/validate', h.validateExisting);  // Validate existing tool
}

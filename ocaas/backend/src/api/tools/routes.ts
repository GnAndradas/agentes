import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function toolRoutes(fastify: FastifyInstance) {
  // IMPORTANT: Static routes MUST come BEFORE parameterized routes
  // Otherwise Fastify treats "validate" as an :id parameter

  // Validation operations (static paths first)
  fastify.post('/validate', h.validateNew);           // Validate without saving
  fastify.post('/validate-config', h.validateConfig); // Validate just config

  // CRUD operations
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);

  // Assignment operations (parameterized)
  fastify.post('/:id/assign', h.assign);
  fastify.delete('/:id/assign/:agentId', h.unassign);

  // Validation for existing tool (parameterized)
  fastify.post('/:id/validate', h.validateExisting);  // Validate existing tool
}

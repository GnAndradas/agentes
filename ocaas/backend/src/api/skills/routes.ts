import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function skillRoutes(fastify: FastifyInstance) {
  // CRUD operations
  fastify.get('/', h.list);
  fastify.get('/:id', h.get);
  fastify.post('/', h.create);
  fastify.patch('/:id', h.update);
  fastify.delete('/:id', h.remove);

  // Agent assignment
  fastify.post('/:id/assign', h.assign);
  fastify.delete('/:id/assign/:agentId', h.unassign);

  // Skill-Tool composition
  fastify.get('/:id/tools', h.getTools);          // Get linked tools
  fastify.put('/:id/tools', h.setTools);          // Replace all tools
  fastify.post('/:id/tools', h.addTool);          // Add a tool
  fastify.patch('/:id/tools/:toolId', h.updateToolLink);  // Update tool link
  fastify.delete('/:id/tools/:toolId', h.removeTool);     // Remove tool

  // Skill Execution
  fastify.post('/:id/execute', h.executeSkill);              // Execute skill
  fastify.post('/:id/validate-execution', h.validateExecution);  // Validate execution
  fastify.get('/:id/execution-preview', h.getExecutionPreview);  // Get preview
}

/**
 * Resource API Routes
 *
 * GET /api/resources          - List all resources (skills + tools)
 * GET /api/resources/:id      - Get resource by ID
 * GET /api/resources/counts   - Get resource counts
 * GET /api/resources/search   - Search resources by name
 * GET /api/resources/agent/:agentId - Get resources assigned to agent
 */

import type { FastifyInstance } from 'fastify';
import {
  listResources,
  getResourceById,
  getResourceCounts,
  searchResources,
  getAgentResources,
} from './handlers.js';

export async function resourceRoutes(app: FastifyInstance) {
  // List all resources
  app.get('/', listResources);

  // Get resource counts (must be before /:id to avoid conflict)
  app.get('/counts', getResourceCounts);

  // Search resources
  app.get('/search', searchResources);

  // Get resources for a specific agent
  app.get('/agent/:agentId', getAgentResources);

  // Get resource by ID
  app.get('/:id', getResourceById);
}

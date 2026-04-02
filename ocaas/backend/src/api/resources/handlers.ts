/**
 * Resource API Handlers
 *
 * Unified endpoint for accessing Skills and Tools.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getResourceService } from '../../resources/index.js';
import { RESOURCE_TYPE, type ResourceType } from '../../resources/ResourceTypes.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('api:resources');

// =============================================================================
// QUERY PARAMS
// =============================================================================

interface ListResourcesQuery {
  type?: ResourceType;
  status?: string;
  search?: string;
  activeOnly?: string;
}

interface GetResourceParams {
  id: string;
}

// =============================================================================
// HANDLERS
// =============================================================================

/**
 * GET /api/resources
 *
 * Returns all resources (skills and tools) in a unified response.
 *
 * Query params:
 *   - type: 'skill' | 'tool' (optional)
 *   - status: 'active' | 'inactive' | 'deprecated' (optional)
 *   - search: name search pattern (optional)
 *   - activeOnly: 'true' to filter only active resources
 */
export async function listResources(
  request: FastifyRequest<{ Querystring: ListResourcesQuery }>,
  reply: FastifyReply
) {
  const resourceService = getResourceService();
  const { type, status, search, activeOnly } = request.query;

  // If filters are provided, use filtered query
  if (type || status || search || activeOnly === 'true') {
    const resources = await resourceService.getResourcesFiltered({
      type: type as ResourceType | undefined,
      status,
      namePattern: search,
      activeOnly: activeOnly === 'true',
    });

    // Group by type for consistent response format
    const skills = resources.filter(r => r.type === RESOURCE_TYPE.SKILL);
    const tools = resources.filter(r => r.type === RESOURCE_TYPE.TOOL);

    return reply.send({
      data: {
        skills,
        tools,
        total: resources.length,
      },
    });
  }

  // Default: return all resources
  const result = await resourceService.getAllResources();

  return reply.send({
    data: result,
  });
}

/**
 * GET /api/resources/:id
 *
 * Get a single resource by ID.
 * Searches both skills and tools.
 */
export async function getResourceById(
  request: FastifyRequest<{ Params: GetResourceParams }>,
  reply: FastifyReply
) {
  const resourceService = getResourceService();
  const { id } = request.params;

  const resource = await resourceService.getResourceById(id);

  return reply.send({
    data: resource,
  });
}

/**
 * GET /api/resources/counts
 *
 * Get resource counts by type.
 */
export async function getResourceCounts(
  _request: FastifyRequest,
  reply: FastifyReply
) {
  const resourceService = getResourceService();

  const [total, active] = await Promise.all([
    resourceService.getResourceCounts(),
    resourceService.getActiveResourceCounts(),
  ]);

  return reply.send({
    data: {
      total,
      active,
    },
  });
}

/**
 * GET /api/resources/search
 *
 * Search resources by name.
 *
 * Query params:
 *   - q: search query (required)
 */
export async function searchResources(
  request: FastifyRequest<{ Querystring: { q?: string } }>,
  reply: FastifyReply
) {
  const resourceService = getResourceService();
  const { q } = request.query;

  if (!q || q.trim().length === 0) {
    return reply.status(400).send({
      error: 'Search query is required',
      code: 'MISSING_QUERY',
    });
  }

  const resources = await resourceService.searchByName(q);

  return reply.send({
    data: {
      resources,
      total: resources.length,
      query: q,
    },
  });
}

/**
 * GET /api/resources/agent/:agentId
 *
 * Get resources assigned to an agent.
 */
export async function getAgentResources(
  request: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  const resourceService = getResourceService();
  const { agentId } = request.params;

  const resources = await resourceService.getAgentResources(agentId);

  return reply.send({
    data: {
      ...resources,
      total: resources.skills.length + resources.tools.length,
    },
  });
}

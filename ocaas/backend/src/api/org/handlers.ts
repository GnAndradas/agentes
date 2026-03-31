/**
 * Organization API Handlers
 *
 * Endpoints for managing organizational structure:
 * - Work profiles
 * - Agent hierarchy
 * - Policy queries
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getWorkProfileStore } from '../../organization/WorkProfileStore.js';
import { getAgentHierarchyStore } from '../../organization/AgentHierarchyStore.js';
import { getOrganizationalPolicyService } from '../../organization/OrganizationalPolicyService.js';
import { toErrorResponse } from '../../utils/errors.js';
import type { RoleType, WorkProfile } from '../../organization/types.js';

// =============================================================================
// WORK PROFILES
// =============================================================================

/**
 * List all work profiles
 */
export async function listProfiles(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const store = getWorkProfileStore();
    const profiles = store.list();
    return reply.send({ data: profiles });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get work profile by ID
 */
export async function getProfile(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getWorkProfileStore();
    const profile = store.get(req.params.id);

    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' });
    }

    return reply.send({ data: profile });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Create custom work profile
 */
export async function createProfile(
  req: FastifyRequest<{ Body: Omit<WorkProfile, 'id' | 'editable' | 'createdAt' | 'updatedAt'> }>,
  reply: FastifyReply
) {
  try {
    const store = getWorkProfileStore();
    const profile = store.create(req.body);
    return reply.status(201).send({ data: profile });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Update work profile
 */
export async function updateProfile(
  req: FastifyRequest<{ Params: { id: string }; Body: Partial<WorkProfile> }>,
  reply: FastifyReply
) {
  try {
    const store = getWorkProfileStore();
    const profile = store.update(req.params.id, req.body);

    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found or not editable' });
    }

    return reply.send({ data: profile });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Delete custom work profile
 */
export async function deleteProfile(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getWorkProfileStore();
    const deleted = store.delete(req.params.id);

    if (!deleted) {
      return reply.status(404).send({ error: 'Profile not found or cannot be deleted' });
    }

    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// HIERARCHY
// =============================================================================

/**
 * List all agent org profiles
 */
export async function listHierarchy(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const store = getAgentHierarchyStore();
    const profiles = store.list();
    return reply.send({ data: profiles });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get agent org profile
 */
export async function getAgentProfile(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const profile = store.get(req.params.agentId);

    if (!profile) {
      return reply.status(404).send({ error: 'Agent org profile not found' });
    }

    return reply.send({ data: profile });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Create or update agent org profile
 */
export async function upsertAgentProfile(
  req: FastifyRequest<{
    Params: { agentId: string };
    Body: {
      roleType: RoleType;
      supervisorAgentId?: string | null;
      workProfileId: string;
      department?: string;
    };
  }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const profile = store.create({
      agentId: req.params.agentId,
      roleType: req.body.roleType,
      supervisorAgentId: req.body.supervisorAgentId ?? null,
      workProfileId: req.body.workProfileId,
      department: req.body.department,
    });

    return reply.send({ data: profile });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Delete agent org profile
 */
export async function deleteAgentProfile(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const deleted = store.delete(req.params.agentId);

    if (!deleted) {
      return reply.status(400).send({ error: 'Cannot delete profile (has subordinates or not found)' });
    }

    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get hierarchy tree
 */
export async function getHierarchyTree(
  req: FastifyRequest<{ Querystring: { rootAgentId?: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const tree = store.getHierarchyTree(req.query.rootAgentId);
    return reply.send({ data: tree });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get escalation chain for agent
 */
export async function getEscalationChain(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const chain = store.getEscalationChain(req.params.agentId);
    return reply.send({ data: chain });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get subordinates for agent
 */
export async function getSubordinates(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const store = getAgentHierarchyStore();
    const subordinates = store.getSubordinates(req.params.agentId);
    return reply.send({ data: subordinates });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// POLICIES
// =============================================================================

/**
 * Get policy decisions for a task/agent combination
 */
export async function getPolicyDecisions(
  req: FastifyRequest<{
    Body: {
      taskId: string;
      agentId: string;
      failureContext?: {
        failureCount: number;
        lastError?: string;
        missingResource?: string;
        blockedReason?: string;
      };
    };
  }>,
  reply: FastifyReply
) {
  try {
    const policyService = getOrganizationalPolicyService();
    const context = await policyService.buildContext(req.body.taskId, req.body.agentId);

    // Add failure context if provided
    if (req.body.failureContext) {
      context.failureContext = req.body.failureContext;
    }

    const decisions = await policyService.getFullPolicyDecisions(context);

    // Convert Map to object for JSON response
    const result: Record<string, unknown> = {};
    for (const [key, value] of decisions) {
      result[key] = value;
    }

    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get effective policies for an agent
 */
export async function getEffectivePolicies(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
) {
  try {
    const hierarchyStore = getAgentHierarchyStore();

    const autonomyPolicy = hierarchyStore.getEffectiveAutonomyPolicy(req.params.agentId);
    const escalationPolicy = hierarchyStore.getEffectiveEscalationPolicy(req.params.agentId);

    return reply.send({
      data: {
        autonomy: autonomyPolicy,
        escalation: escalationPolicy,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

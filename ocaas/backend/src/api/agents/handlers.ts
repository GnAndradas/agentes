import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { CreateAgentSchema, UpdateAgentSchema } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

type IdParam = { Params: { id: string } };

export async function list(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const data = await agentService.list();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const data = await agentService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { agentService } = getServices();
    const data = await agentService.create(parsed.data);
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { agentService } = getServices();
    const data = await agentService.update(req.params.id, parsed.data);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    await agentService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function activate(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const data = await agentService.activate(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function deactivate(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const data = await agentService.deactivate(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getSkills(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    const data = await skillService.getAgentSkills(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getTools(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    const data = await toolService.getAgentTools(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getTasks(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { taskService } = getServices();
    const data = await taskService.getByAgent(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// ============================================================================
// BLOQUE 9: MATERIALIZATION STATUS
// ============================================================================

/**
 * Get materialization status for an agent
 * BLOQUE 9: Returns lifecycle state, runtime readiness, etc.
 */
export async function getMaterializationStatus(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const status = await agentService.getMaterializationStatus(req.params.id);
    const lifecycle = await agentService.getLifecycleState(req.params.id);

    return reply.send({
      data: {
        ...status,
        lifecycle: lifecycle,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * List all agents with their materialization status
 * BLOQUE 9: Includes lifecycle state for each agent
 */
export async function listWithStatus(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { agentService } = getServices();
    const data = await agentService.listWithMaterializationStatus();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

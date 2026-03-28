import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { CreateSkillSchema, UpdateSkillSchema, AssignSkillSchema } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

type IdParam = { Params: { id: string } };
type IdAgentParam = { Params: { id: string; agentId: string } };

export async function list(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    const data = await skillService.list();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    const data = await skillService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { skillService } = getServices();
    const data = await skillService.create(parsed.data);
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { skillService } = getServices();
    const data = await skillService.update(req.params.id, parsed.data);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    await skillService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function assign(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = AssignSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { skillService } = getServices();
    await skillService.assignToAgent(req.params.id, parsed.data.agentId);
    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function unassign(req: FastifyRequest<IdAgentParam>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    await skillService.unassignFromAgent(req.params.id, req.params.agentId);
    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { CreatePermissionSchema, UpdatePermissionSchema, CheckPermissionSchema } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import type { ResourceType, PermissionLevel } from '../../types/domain.js';

type IdParam = { Params: { id: string } };
type AgentIdParam = { Params: { agentId: string } };
type Query = { Querystring: { agentId?: string } };

export async function list(req: FastifyRequest<Query>, reply: FastifyReply) {
  try {
    const { permissionService } = getServices();
    const data = await permissionService.list(req.query.agentId);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { permissionService } = getServices();
    const data = await permissionService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreatePermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { permissionService } = getServices();
    const data = await permissionService.create({
      ...parsed.data,
      resourceType: parsed.data.resourceType as ResourceType,
      level: parsed.data.level as PermissionLevel,
    });
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdatePermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { permissionService } = getServices();
    const data = await permissionService.update(req.params.id, {
      ...parsed.data,
      level: parsed.data.level as PermissionLevel | undefined,
      expiresAt: parsed.data.expiresAt ?? undefined,
    });
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { permissionService } = getServices();
    await permissionService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function check(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CheckPermissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { permissionService } = getServices();
    const hasPermission = await permissionService.check(
      parsed.data.agentId,
      parsed.data.resourceType as ResourceType,
      parsed.data.resourceId ?? null,
      parsed.data.requiredLevel as PermissionLevel
    );
    return reply.send({ data: { hasPermission } });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getForAgent(req: FastifyRequest<AgentIdParam>, reply: FastifyReply) {
  try {
    const { permissionService } = getServices();
    const data = await permissionService.getForAgent(req.params.agentId);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

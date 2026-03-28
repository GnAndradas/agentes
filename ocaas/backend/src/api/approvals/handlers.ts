import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import {
  CreateApprovalSchema,
  RespondApprovalSchema,
  ListApprovalsQuerySchema,
} from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

type IdParam = { Params: { id: string } };
type QueryParam = { Querystring: Record<string, string | undefined> };

export async function list(req: FastifyRequest<QueryParam>, reply: FastifyReply) {
  try {
    const parsed = ListApprovalsQuerySchema.safeParse(req.query);
    const opts = parsed.success ? parsed.data : {};

    const { approvalService } = getServices();
    const data = await approvalService.list(opts);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { approvalService } = getServices();
    const data = await approvalService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getPending(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { approvalService } = getServices();
    const data = await approvalService.getPending();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { approvalService } = getServices();
    const data = await approvalService.create(parsed.data);
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function approve(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { approvalService } = getServices();
    // TODO: get respondedBy from auth when implemented
    const respondedBy = 'human:panel';
    const data = await approvalService.approve(req.params.id, respondedBy);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function reject(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RespondApprovalSchema.safeParse(req.body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    const { approvalService } = getServices();
    // TODO: get respondedBy from auth when implemented
    const respondedBy = 'human:panel';
    const data = await approvalService.reject(req.params.id, respondedBy, reason);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function respond(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RespondApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { approvalService } = getServices();
    // TODO: get respondedBy from auth when implemented
    const respondedBy = 'human:panel';

    const data = await approvalService.respond(req.params.id, {
      approved: parsed.data.approved,
      respondedBy,
      reason: parsed.data.reason,
    });

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { approvalService } = getServices();
    await approvalService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

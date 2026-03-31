import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { createLogger } from '../../utils/logger.js';
import {
  CreateApprovalSchema,
  RespondApprovalSchema,
  ListApprovalsQuerySchema,
} from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

const logger = createLogger('approvals-handler');

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

/**
 * Approve an approval using the central workflow service
 * This ensures consistent behavior with Telegram and other entry points
 */
export async function approve(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { activationWorkflow } = getServices();
    const respondedBy = 'human:panel';

    const result = await activationWorkflow.approveApproval(req.params.id, respondedBy);

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    if (result.error) {
      // Partial success (approval ok, but generation failed)
      logger.warn({ approvalId: req.params.id, error: result.error }, 'Approval succeeded with warning');
    }

    return reply.send({ data: result.approval });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Reject an approval using the central workflow service
 */
export async function reject(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RespondApprovalSchema.safeParse(req.body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    const { activationWorkflow } = getServices();
    const respondedBy = 'human:panel';

    const result = await activationWorkflow.rejectApproval(req.params.id, respondedBy, reason);

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    return reply.send({ data: result.approval });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Respond to an approval (approve or reject) using the central workflow service
 */
export async function respond(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RespondApprovalSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { activationWorkflow } = getServices();
    const respondedBy = 'human:panel';

    const result = parsed.data.approved
      ? await activationWorkflow.approveApproval(req.params.id, respondedBy)
      : await activationWorkflow.rejectApproval(req.params.id, respondedBy, parsed.data.reason);

    if (!result.success) {
      return reply.status(400).send({ error: result.error });
    }

    return reply.send({ data: result.approval });
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

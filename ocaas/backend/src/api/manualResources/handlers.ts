import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import {
  CreateDraftSchema,
  UpdateDraftSchema,
  ListQuerySchema,
  RejectBodySchema,
  ActionBodySchema,
} from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import type { ResourceType, DraftStatus } from '../../db/schema/drafts.js';
import type { DraftContent } from '../../services/ManualResourceService.js';

type IdParam = { Params: { id: string } };

export async function list(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid query parameters',
      });
    }

    const { manualResourceService } = getServices();
    const data = await manualResourceService.list({
      resourceType: parsed.data.resourceType as ResourceType | undefined,
      status: parsed.data.status as DraftStatus | undefined,
    });

    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { manualResourceService } = getServices();
    const data = await manualResourceService.getById(req.params.id);
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const { manualResourceService } = getServices();
    const data = await manualResourceService.createDraft({
      resourceType: parsed.data.resourceType as ResourceType,
      name: parsed.data.name,
      description: parsed.data.description,
      content: parsed.data.content as DraftContent,
      metadata: parsed.data.metadata,
      createdBy: parsed.data.createdBy,
    });

    return reply.status(201).send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten(),
      });
    }

    const { manualResourceService } = getServices();
    const data = await manualResourceService.updateDraft(req.params.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      content: parsed.data.content as DraftContent | undefined,
      metadata: parsed.data.metadata,
    });
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { manualResourceService } = getServices();
    await manualResourceService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function submit(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ActionBodySchema.safeParse(req.body ?? {});
    const submittedBy = parsed.success ? parsed.data.user : undefined;

    const { manualResourceService } = getServices();
    const data = await manualResourceService.submitForApproval(req.params.id, submittedBy);
    return reply.send({ success: true, data });
  } catch (err) {
    // FSM errors are ValidationErrors with status 400
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function approve(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ActionBodySchema.safeParse(req.body ?? {});
    const approvedBy = parsed.success && parsed.data.user ? parsed.data.user : 'api';

    const { manualResourceService } = getServices();
    const data = await manualResourceService.approve(req.params.id, approvedBy);
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function reject(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RejectBodySchema.safeParse(req.body ?? {});
    const reason = parsed.success ? parsed.data.reason : undefined;

    // Get user from query or default
    const userParsed = ActionBodySchema.safeParse(req.body ?? {});
    const rejectedBy = userParsed.success && userParsed.data.user ? userParsed.data.user : 'api';

    const { manualResourceService } = getServices();
    const data = await manualResourceService.reject(req.params.id, rejectedBy, reason);
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function activate(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { manualResourceService } = getServices();
    const data = await manualResourceService.activate(req.params.id);
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

export async function deactivate(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { manualResourceService } = getServices();
    const data = await manualResourceService.deactivate(req.params.id);
    return reply.send({ success: true, data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send({ success: false, error: body.error });
  }
}

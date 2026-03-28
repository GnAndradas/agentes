import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { getAgentGenerator } from '../../generator/AgentGenerator.js';
import { getSkillGenerator } from '../../generator/SkillGenerator.js';
import { getToolGenerator } from '../../generator/ToolGenerator.js';
import { createLogger } from '../../utils/logger.js';
import { EVENT_TYPE } from '../../config/constants.js';
import {
  CreateApprovalSchema,
  RespondApprovalSchema,
  ListApprovalsQuerySchema,
} from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';

const logger = createLogger('approvals-handler');

/**
 * After approving an approval, activate the associated generation if applicable
 * This completes the loop: human approves → generation activates → task retries
 */
async function activateGenerationForApproval(approvalId: string): Promise<void> {
  const { approvalService, generationService, eventService } = getServices();

  const approval = await approvalService.getById(approvalId);

  // Only process agent/skill/tool approvals with a resourceId (generationId)
  if (!approval.resourceId) {
    logger.debug({ approvalId }, 'Approval has no resourceId, skipping activation');
    return;
  }

  if (!['agent', 'skill', 'tool'].includes(approval.type)) {
    logger.debug({ approvalId, type: approval.type }, 'Approval type does not require generation activation');
    return;
  }

  try {
    // Emit ACTION_APPROVED event
    await eventService.emit({
      type: EVENT_TYPE.ACTION_APPROVED,
      category: 'orchestrator',
      severity: 'info',
      message: `Action ${approval.type} approved by ${approval.respondedBy || 'human'}`,
      resourceType: 'approval',
      resourceId: approvalId,
      data: {
        type: approval.type,
        generationId: approval.resourceId,
        approvedBy: approval.respondedBy,
      },
    });

    // First approve the generation (changes status to 'approved')
    await generationService.approve(approval.resourceId, approval.respondedBy || 'human:panel');

    // Then activate it (creates the resource and triggers callback)
    switch (approval.type) {
      case 'agent':
        await getAgentGenerator().activate(approval.resourceId);
        break;
      case 'skill':
        await getSkillGenerator().activate(approval.resourceId);
        break;
      case 'tool':
        await getToolGenerator().activate(approval.resourceId);
        break;
    }

    logger.info({
      approvalId,
      type: approval.type,
      generationId: approval.resourceId
    }, 'Generation activated after human approval');
  } catch (err) {
    // Log but don't fail the approval - the approval itself succeeded
    logger.error({
      err,
      approvalId,
      type: approval.type,
      generationId: approval.resourceId
    }, 'Failed to activate generation after approval');
  }
}

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

    // Activate the associated generation (completes the autonomous loop)
    await activateGenerationForApproval(req.params.id);

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

    // If approved, activate the associated generation
    if (parsed.data.approved) {
      await activateGenerationForApproval(req.params.id);
    }

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

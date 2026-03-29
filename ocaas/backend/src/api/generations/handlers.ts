import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { CreateGenerationSchema, ApproveSchema, RejectSchema, ListGenerationsQuery } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { getAgentGenerator } from '../../generator/AgentGenerator.js';
import { getSkillGenerator } from '../../generator/SkillGenerator.js';
import { getToolGenerator } from '../../generator/ToolGenerator.js';
import type { GenerationStatus, GenerationType } from '../../types/domain.js';

const logger = createLogger('GenerationsHandler');

type IdParam = { Params: { id: string } };

export async function list(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = ListGenerationsQuery.safeParse(req.query);
    const opts = parsed.success ? parsed.data : {};
    const { generationService } = getServices();
    const data = await generationService.list({
      status: opts.status as GenerationStatus | undefined,
      type: opts.type as GenerationType | undefined,
    });
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { generationService } = getServices();
    const data = await generationService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateGenerationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { generationService } = getServices();
    const data = await generationService.create({
      ...parsed.data,
      type: parsed.data.type as GenerationType,
    });
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { generationService } = getServices();
    await generationService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function approve(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { generationService } = getServices();
    const generationId = req.params.id;

    // First approve the generation
    const generation = await generationService.approve(generationId, parsed.data.approvedBy);

    // Then automatically activate it (create the resource)
    try {
      switch (generation.type) {
        case 'agent':
          await getAgentGenerator().activate(generationId);
          break;
        case 'skill':
          await getSkillGenerator().activate(generationId);
          break;
        case 'tool':
          await getToolGenerator().activate(generationId);
          break;
      }
      logger.info({ generationId, type: generation.type }, 'Generation approved and activated');
    } catch (activationErr) {
      // Log activation error but don't fail the approval
      logger.error({ err: activationErr, generationId }, 'Failed to activate after approval');
    }

    // Return updated generation
    const data = await generationService.getById(generationId);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function reject(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { generationService } = getServices();
    const data = await generationService.reject(req.params.id, parsed.data.reason);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function activate(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { generationService } = getServices();
    const data = await generationService.activate(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function getPending(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { generationService } = getServices();
    const data = await generationService.getPendingApprovals();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

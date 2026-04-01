/**
 * Escalations API Handlers
 *
 * Provides endpoints for the human inbox ("DIOS") to view and respond to escalations.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getHumanEscalationService } from '../../hitl/index.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorResponse } from '../../utils/errors.js';
import {
  CreateEscalationSchema,
  ApproveEscalationSchema,
  RejectEscalationSchema,
  ProvideResourceSchema,
  OverrideEscalationSchema,
  AcknowledgeEscalationSchema,
  ListEscalationsQuerySchema,
} from './schemas.js';

const logger = createLogger('escalations-handler');

type IdParam = { Params: { id: string } };
type TaskIdParam = { Params: { taskId: string } };
type QueryParam = { Querystring: Record<string, string | undefined> };

// =============================================================================
// INBOX
// =============================================================================

/**
 * Get human inbox with pending and acknowledged escalations
 * This is the main entry point for the "DIOS" panel
 */
export async function inbox(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const data = await service.getHumanInbox();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get all pending human actions (simplified list)
 */
export async function pending(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const data = await service.getPendingHumanActions();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get escalation statistics
 */
export async function stats(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const data = await service.getStats();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// CRUD
// =============================================================================

/**
 * List escalations with filtering
 */
export async function list(req: FastifyRequest<QueryParam>, reply: FastifyReply) {
  try {
    const parsed = ListEscalationsQuerySchema.safeParse(req.query);
    const opts = parsed.success ? parsed.data : {};

    const service = getHumanEscalationService();
    const data = await service.list(opts);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get a single escalation by ID
 */
export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const data = await service.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Get escalations for a specific task
 */
export async function getByTask(req: FastifyRequest<TaskIdParam>, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const data = await service.getByTask(req.params.taskId);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Create a new escalation
 */
export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateEscalationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const service = getHumanEscalationService();
    const data = await service.escalate(parsed.data);
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// ACKNOWLEDGMENT
// =============================================================================

/**
 * Acknowledge an escalation (human has seen it)
 */
export async function acknowledge(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = AcknowledgeEscalationSchema.safeParse(req.body);
    const acknowledgedBy = parsed.success ? parsed.data.acknowledgedBy : 'human:panel';

    const service = getHumanEscalationService();
    const data = await service.acknowledge(req.params.id, acknowledgedBy);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// RESOLUTION
// =============================================================================

/**
 * Approve an escalation
 */
export async function approve(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ApproveEscalationSchema.safeParse(req.body);
    const approvedBy = parsed.success ? parsed.data.approvedBy : 'human:panel';
    const details = parsed.success ? parsed.data.details : undefined;

    const service = getHumanEscalationService();
    const data = await service.approve(req.params.id, approvedBy, details);

    logger.info({ escalationId: req.params.id, approvedBy }, 'Escalation approved via API');
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Reject an escalation
 */
export async function reject(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = RejectEscalationSchema.safeParse(req.body);
    const rejectedBy = parsed.success ? parsed.data.rejectedBy : 'human:panel';
    const reason = parsed.success ? parsed.data.reason : undefined;

    const service = getHumanEscalationService();
    const data = await service.reject(req.params.id, rejectedBy, reason);

    logger.info({ escalationId: req.params.id, rejectedBy, reason }, 'Escalation rejected via API');
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Provide a resource to resolve an escalation
 */
export async function provideResource(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ProvideResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const service = getHumanEscalationService();
    const data = await service.provideResource(
      req.params.id,
      parsed.data.providedBy,
      parsed.data.resourceId,
      parsed.data.resourceType
    );

    logger.info({
      escalationId: req.params.id,
      providedBy: parsed.data.providedBy,
      resourceId: parsed.data.resourceId,
      resourceType: parsed.data.resourceType,
    }, 'Resource provided via API');

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Override an escalation with human decision
 */
export async function override(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = OverrideEscalationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const service = getHumanEscalationService();
    const data = await service.override(
      req.params.id,
      parsed.data.overriddenBy,
      parsed.data.decision,
      parsed.data.details
    );

    logger.info({
      escalationId: req.params.id,
      overriddenBy: parsed.data.overriddenBy,
      decision: parsed.data.decision,
    }, 'Escalation overridden via API');

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// MAINTENANCE
// =============================================================================

/**
 * Process expired escalations (trigger timeout handling)
 */
export async function processExpired(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const service = getHumanEscalationService();
    const processed = await service.processExpired();
    return reply.send({ data: { processed } });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * Cleanup old resolved/expired escalations
 */
export async function cleanup(req: FastifyRequest, reply: FastifyReply) {
  try {
    const maxAgeMs = (req.query as { maxAgeMs?: string }).maxAgeMs
      ? parseInt((req.query as { maxAgeMs?: string }).maxAgeMs!, 10)
      : undefined;

    const service = getHumanEscalationService();
    const cleaned = await service.cleanup(maxAgeMs);
    return reply.send({ data: { cleaned } });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

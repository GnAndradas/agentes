import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { CreateToolSchema, UpdateToolSchema, AssignToolSchema, ValidateToolSchema } from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import { getToolValidationService } from '../../services/ToolValidationService.js';
import { validateToolConfig, type ToolType } from '../../types/tool-config.js';

type IdParam = { Params: { id: string } };
type IdAgentParam = { Params: { id: string; agentId: string } };

export async function list(_req: FastifyRequest, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    const data = await toolService.list();
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function get(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    const data = await toolService.getById(req.params.id);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = CreateToolSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { toolService } = getServices();
    const data = await toolService.create(parsed.data);
    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function update(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateToolSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { toolService } = getServices();
    const data = await toolService.update(req.params.id, parsed.data);
    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function remove(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    await toolService.delete(req.params.id);
    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function assign(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = AssignToolSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { toolService } = getServices();
    await toolService.assignToAgent(req.params.id, parsed.data.agentId);
    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

export async function unassign(req: FastifyRequest<IdAgentParam>, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    await toolService.unassignFromAgent(req.params.id, req.params.agentId);
    return reply.send({ success: true });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// VALIDATION ENDPOINT
// =============================================================================

/**
 * POST /api/tools/:id/validate
 *
 * Validate an existing tool's structure without modifying it.
 * Returns detailed validation report.
 */
export async function validateExisting(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const { toolService } = getServices();
    const tool = await toolService.getById(req.params.id);

    const validationService = getToolValidationService();
    const result = validationService.validateTool(tool);

    return reply.send({
      data: {
        toolId: tool.id,
        toolName: tool.name,
        ...result,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * POST /api/tools/validate
 *
 * Validate a tool definition without saving it.
 * Useful for previewing validation before create/update.
 */
export async function validateNew(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = ValidateToolSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Schema validation failed',
        details: parsed.error.flatten(),
      });
    }

    const validationService = getToolValidationService();
    const result = validationService.validateTool(parsed.data);

    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * POST /api/tools/validate-config
 *
 * Validate just the config portion against a tool type.
 */
export async function validateConfig(
  req: FastifyRequest<{ Body: { type: string; config: unknown } }>,
  reply: FastifyReply
) {
  try {
    const { type, config } = req.body as { type?: string; config?: unknown };

    if (!type || !['script', 'binary', 'api'].includes(type)) {
      return reply.status(400).send({
        error: 'Invalid type',
        message: 'type must be one of: script, binary, api',
      });
    }

    const result = validateToolConfig(type as ToolType, config);

    if (result.valid) {
      return reply.send({
        data: {
          valid: true,
          config: result.config,
        },
      });
    }

    return reply.send({
      data: {
        valid: false,
        errors: result.errors,
      },
    });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

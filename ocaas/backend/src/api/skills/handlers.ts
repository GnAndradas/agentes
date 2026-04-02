import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import {
  CreateSkillSchema,
  UpdateSkillSchema,
  AssignSkillSchema,
  AddToolToSkillSchema,
  UpdateToolLinkSchema,
  SetSkillToolsSchema,
  ExecuteSkillSchema,
  ValidateExecutionSchema,
} from './schemas.js';
import { toErrorResponse } from '../../utils/errors.js';
import {
  getSkillExecutionService,
  EXECUTION_MODE,
  type ExecutionMode,
} from '../../skills/execution/index.js';

type IdParam = { Params: { id: string } };
type IdAgentParam = { Params: { id: string; agentId: string } };
type IdToolParam = { Params: { id: string; toolId: string } };
type ExpandQuery = { Querystring: { expand?: string } };

export async function list(req: FastifyRequest<ExpandQuery>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    const includeToolCounts = req.query.expand === 'toolCount' || req.query.expand === 'tools';
    const data = includeToolCounts
      ? await skillService.listWithToolCounts()
      : await skillService.list();
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

// =============================================================================
// SKILL-TOOL COMPOSITION ENDPOINTS
// =============================================================================

/**
 * GET /api/skills/:id/tools
 *
 * Get tools linked to a skill.
 * Query param ?expand=tool to include full tool details.
 */
export async function getTools(req: FastifyRequest<IdParam & ExpandQuery>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    const expand = req.query.expand === 'tool';

    const data = expand
      ? await skillService.getSkillToolsExpanded(req.params.id)
      : await skillService.getSkillTools(req.params.id);

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * PUT /api/skills/:id/tools
 *
 * Replace all tools for a skill.
 */
export async function setTools(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = SetSkillToolsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { skillService } = getServices();
    const data = await skillService.setTools(req.params.id, parsed.data.tools);

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * POST /api/skills/:id/tools
 *
 * Add a tool to a skill.
 */
export async function addTool(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = AddToolToSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { skillService } = getServices();
    const data = await skillService.addTool(req.params.id, parsed.data.toolId, {
      orderIndex: parsed.data.orderIndex,
      required: parsed.data.required,
      role: parsed.data.role,
      config: parsed.data.config,
    });

    return reply.status(201).send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * PATCH /api/skills/:id/tools/:toolId
 *
 * Update a tool link in a skill.
 */
export async function updateToolLink(req: FastifyRequest<IdToolParam>, reply: FastifyReply) {
  try {
    const parsed = UpdateToolLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { skillService } = getServices();
    const data = await skillService.updateToolLink(req.params.id, req.params.toolId, parsed.data);

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * DELETE /api/skills/:id/tools/:toolId
 *
 * Remove a tool from a skill.
 */
export async function removeTool(req: FastifyRequest<IdToolParam>, reply: FastifyReply) {
  try {
    const { skillService } = getServices();
    await skillService.removeTool(req.params.id, req.params.toolId);

    return reply.status(204).send();
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

// =============================================================================
// SKILL EXECUTION ENDPOINTS
// =============================================================================

/**
 * POST /api/skills/:id/execute
 *
 * Execute a skill as a pipeline of tools.
 *
 * Request body:
 * - mode: 'run' | 'validate' | 'dry_run' (default: 'run')
 * - input: initial input data for the pipeline
 * - context: additional context available to all tools
 * - timeoutMs: optional timeout override
 * - stopOnError: whether to stop on first error (default: true)
 * - caller: optional caller identification
 */
export async function executeSkill(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ExecuteSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const executionService = getSkillExecutionService();

    const result = await executionService.execute({
      skillId: req.params.id,
      mode: parsed.data.mode as ExecutionMode,
      input: parsed.data.input,
      context: parsed.data.context,
      timeoutMs: parsed.data.timeoutMs,
      stopOnError: parsed.data.stopOnError,
      caller: parsed.data.caller,
    });

    // Return appropriate status based on execution result
    const statusCode = result.status === 'success' ? 200 :
                       result.status === 'failed' ? 422 : 200;

    return reply.status(statusCode).send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * POST /api/skills/:id/validate-execution
 *
 * Validate if a skill can be executed without actually executing it.
 * Returns validation errors and warnings.
 */
export async function validateExecution(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const parsed = ValidateExecutionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const executionService = getSkillExecutionService();

    const result = await executionService.validate({
      skillId: req.params.id,
      mode: EXECUTION_MODE.VALIDATE,
      input: parsed.data.input,
    });

    return reply.send({ data: result });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

/**
 * GET /api/skills/:id/execution-preview
 *
 * Get a preview of what executing this skill would do.
 * Shows the pipeline of tools and any blockers/warnings.
 */
export async function getExecutionPreview(req: FastifyRequest<IdParam>, reply: FastifyReply) {
  try {
    const executionService = getSkillExecutionService();
    const data = await executionService.getPreview(req.params.id);

    return reply.send({ data });
  } catch (err) {
    const { statusCode, body } = toErrorResponse(err);
    return reply.status(statusCode).send(body);
  }
}

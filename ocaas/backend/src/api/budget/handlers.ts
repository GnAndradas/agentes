/**
 * Budget API Handlers (Fastify)
 *
 * Exposes budget diagnostics and configuration endpoints.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { getGlobalBudgetManager } from '../../budget/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('BudgetHandlers');

/**
 * GET /api/budget/diagnostics
 *
 * Returns current budget status, costs, and metrics.
 */
export async function getBudgetDiagnostics(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const budgetManager = getGlobalBudgetManager();
    const diagnostics = budgetManager.getDiagnostics();

    reply.send({
      success: true,
      data: diagnostics,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get budget diagnostics');
    reply.status(500).send({ success: false, error: 'Failed to get diagnostics' });
  }
}

/**
 * GET /api/budget/config
 *
 * Returns current budget configuration.
 */
export async function getBudgetConfig(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const budgetManager = getGlobalBudgetManager();
    const config = budgetManager.getConfig();

    reply.send({
      success: true,
      data: config,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get budget config');
    reply.status(500).send({ success: false, error: 'Failed to get config' });
  }
}

/**
 * PATCH /api/budget/config
 *
 * Updates budget configuration.
 * Body: Partial<BudgetConfig>
 */
export async function updateBudgetConfig(
  request: FastifyRequest<{ Body: Record<string, unknown> }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const budgetManager = getGlobalBudgetManager();
    const updates = request.body || {};

    // Validate updates
    const allowedKeys = [
      'max_cost_per_task_usd',
      'max_cost_per_agent_daily_usd',
      'max_cost_daily_usd',
      'max_tokens_per_task',
      'soft_warning_threshold_pct',
      'hard_stop_enabled',
      'auto_degrade_enabled',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (key in updates) {
        sanitized[key] = updates[key];
      }
    }

    budgetManager.updateConfig(sanitized);
    const config = budgetManager.getConfig();

    logger.info({ updates: sanitized }, 'Budget config updated via API');

    reply.send({
      success: true,
      data: config,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update budget config');
    reply.status(500).send({ success: false, error: 'Failed to update config' });
  }
}

/**
 * GET /api/budget/cost/task/:taskId
 *
 * Returns accumulated cost for a specific task.
 */
export async function getTaskCost(
  request: FastifyRequest<{ Params: { taskId: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { taskId } = request.params;
    const budgetManager = getGlobalBudgetManager();
    const cost = budgetManager.getTaskCost(taskId);

    reply.send({
      success: true,
      data: {
        task_id: taskId,
        ...cost,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get task cost');
    reply.status(500).send({ success: false, error: 'Failed to get task cost' });
  }
}

/**
 * GET /api/budget/cost/agent/:agentId
 *
 * Returns accumulated daily cost for a specific agent.
 */
export async function getAgentDailyCost(
  request: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { agentId } = request.params;
    const budgetManager = getGlobalBudgetManager();
    const cost = budgetManager.getAgentDailyCost(agentId);

    reply.send({
      success: true,
      data: {
        agent_id: agentId,
        ...cost,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get agent cost');
    reply.status(500).send({ success: false, error: 'Failed to get agent cost' });
  }
}

/**
 * GET /api/budget/global
 *
 * Returns global daily accumulated cost.
 */
export async function getGlobalCost(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const budgetManager = getGlobalBudgetManager();
    const cost = budgetManager.getGlobalDailyCost();

    reply.send({
      success: true,
      data: cost,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get global cost');
    reply.status(500).send({ success: false, error: 'Failed to get global cost' });
  }
}

/**
 * POST /api/budget/reset
 *
 * Resets budget tracking (for testing/admin).
 */
export async function resetBudget(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const budgetManager = getGlobalBudgetManager();
    budgetManager.reset();

    logger.info('Budget manager reset via API');

    reply.send({
      success: true,
      message: 'Budget tracking reset',
    });
  } catch (err) {
    logger.error({ err }, 'Failed to reset budget');
    reply.status(500).send({ success: false, error: 'Failed to reset budget' });
  }
}

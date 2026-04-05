/**
 * Task State API Handlers (Fastify)
 *
 * Exposes task execution state, checkpoints, pause/resume.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { getTaskStateManager } from '../../execution/TaskStateManager/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TaskStateHandlers');

/**
 * GET /api/tasks/:id/state
 *
 * Returns current execution state for a task.
 */
export async function getTaskState(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const stateManager = getTaskStateManager();
    const state = await stateManager.getState(id);

    if (!state) {
      reply.status(404).send({
        success: false,
        error: 'Task state not found',
      });
      return;
    }

    reply.send({
      success: true,
      data: state,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get task state');
    reply.status(500).send({ success: false, error: 'Failed to get state' });
  }
}

/**
 * GET /api/tasks/:id/state/snapshot
 *
 * Returns lightweight snapshot for diagnostics.
 */
export async function getTaskStateSnapshot(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const stateManager = getTaskStateManager();
    const snapshot = await stateManager.getSnapshot(id);

    if (!snapshot) {
      reply.status(404).send({
        success: false,
        error: 'Task state not found',
      });
      return;
    }

    reply.send({
      success: true,
      data: snapshot,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get task state snapshot');
    reply.status(500).send({ success: false, error: 'Failed to get snapshot' });
  }
}

/**
 * GET /api/tasks/:id/checkpoints
 *
 * Returns all checkpoints for a task.
 */
export async function getTaskCheckpoints(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const stateManager = getTaskStateManager();
    const checkpoints = await stateManager.getCheckpoints(id);

    reply.send({
      success: true,
      data: checkpoints,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get checkpoints');
    reply.status(500).send({ success: false, error: 'Failed to get checkpoints' });
  }
}

/**
 * POST /api/tasks/:id/pause
 *
 * Pause task execution.
 * Body: { reason: string }
 */
export async function pauseTask(
  request: FastifyRequest<{
    Params: { id: string };
    Body: { reason?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const { reason = 'Manual pause' } = request.body || {};

    const stateManager = getTaskStateManager();
    const state = await stateManager.pause(id, reason);

    logger.info({ taskId: id, reason }, 'Task paused via API');

    reply.send({
      success: true,
      data: state,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to pause task');
    reply.status(500).send({ success: false, error: 'Failed to pause task' });
  }
}

/**
 * POST /api/tasks/:id/resume
 *
 * Resume task execution.
 * Body: { fromCheckpointId?: string }
 */
export async function resumeTask(
  request: FastifyRequest<{
    Params: { id: string };
    Body: { fromCheckpointId?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const { fromCheckpointId } = request.body || {};

    const stateManager = getTaskStateManager();
    const state = await stateManager.resume(id, fromCheckpointId);

    logger.info({ taskId: id, fromCheckpointId }, 'Task resumed via API');

    reply.send({
      success: true,
      data: state,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to resume task');
    reply.status(500).send({ success: false, error: 'Failed to resume task' });
  }
}

/**
 * POST /api/tasks/:id/checkpoint
 *
 * Create a manual checkpoint.
 * Body: { label: string }
 */
export async function createCheckpoint(
  request: FastifyRequest<{
    Params: { id: string };
    Body: { label?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const { label = 'Manual checkpoint' } = request.body || {};

    const stateManager = getTaskStateManager();
    const checkpoint = await stateManager.createCheckpoint(id, label, false, 'Created via API');

    logger.info({ taskId: id, checkpointId: checkpoint.id }, 'Checkpoint created via API');

    reply.send({
      success: true,
      data: checkpoint,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to create checkpoint');
    reply.status(500).send({ success: false, error: 'Failed to create checkpoint' });
  }
}

/**
 * POST /api/tasks/:id/state/init
 *
 * Initialize task state (if not exists).
 */
export async function initTaskState(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const { id } = request.params;
    const stateManager = getTaskStateManager();
    const state = await stateManager.initState(id);

    reply.send({
      success: true,
      data: state,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to init task state');
    reply.status(500).send({ success: false, error: 'Failed to init state' });
  }
}

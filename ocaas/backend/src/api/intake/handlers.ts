/**
 * Intent Router Handlers
 *
 * POST /api/intake/router
 * Receives classified intents from OpenClaw and processes accordingly:
 * - consult: Direct answer (no task created)
 * - task: Create task in OCAAS
 * - ambiguous: Request clarification
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { getServices } from '../../services/index.js';
import { createLogger } from '../../utils/logger.js';
import type {
  IntentRouterPayload,
  IntentRouterResponse,
} from '../../types/contracts.js';

const logger = createLogger('IntentRouter');

/**
 * Validate incoming router payload
 */
function validatePayload(body: unknown): {
  valid: boolean;
  payload?: IntentRouterPayload;
  error?: string;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be an object' };
  }

  const p = body as Record<string, unknown>;

  // Required fields
  if (typeof p.source !== 'string' || !p.source) {
    return { valid: false, error: 'Missing required field: source' };
  }
  if (typeof p.channel_user_id !== 'string') {
    return { valid: false, error: 'Missing required field: channel_user_id' };
  }
  if (typeof p.conversation_id !== 'string') {
    return { valid: false, error: 'Missing required field: conversation_id' };
  }
  if (typeof p.message_id !== 'string') {
    return { valid: false, error: 'Missing required field: message_id' };
  }
  if (typeof p.raw_message !== 'string') {
    return { valid: false, error: 'Missing required field: raw_message' };
  }
  if (!['consult', 'task', 'ambiguous'].includes(p.intent as string)) {
    return { valid: false, error: 'Invalid intent: must be consult, task, or ambiguous' };
  }
  if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
    return { valid: false, error: 'Invalid confidence: must be number 0-1' };
  }
  if (!['low', 'medium', 'high', 'critical'].includes(p.risk_level as string)) {
    return { valid: false, error: 'Invalid risk_level: must be low, medium, high, or critical' };
  }
  if (typeof p.requires_confirmation !== 'boolean') {
    return { valid: false, error: 'Missing required field: requires_confirmation' };
  }
  if (typeof p.summary !== 'string') {
    return { valid: false, error: 'Missing required field: summary' };
  }

  // task_payload required if intent === 'task'
  if (p.intent === 'task') {
    if (!p.task_payload || typeof p.task_payload !== 'object') {
      return { valid: false, error: 'task_payload required when intent is task' };
    }
    const tp = p.task_payload as Record<string, unknown>;
    if (typeof tp.title !== 'string' || !tp.title) {
      return { valid: false, error: 'task_payload.title is required' };
    }
    if (typeof tp.description !== 'string') {
      return { valid: false, error: 'task_payload.description is required' };
    }
  }

  return { valid: true, payload: p as unknown as IntentRouterPayload };
}

/**
 * POST /api/intake/router
 *
 * Main entry point for intent routing from OpenClaw
 */
export async function handleIntentRouter(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const trackingId = randomUUID();
  const startTime = Date.now();

  logger.info(
    { trackingId, body: request.body },
    '[IntentRouter] Received router request'
  );

  // Validate payload
  const validation = validatePayload(request.body);
  if (!validation.valid || !validation.payload) {
    logger.warn(
      { trackingId, error: validation.error },
      '[IntentRouter] Invalid payload'
    );
    reply.status(400).send({
      accepted: false,
      status: 'rejected',
      message: validation.error || 'Invalid payload',
      tracking_id: trackingId,
      processed_at: Date.now(),
    } satisfies IntentRouterResponse);
    return;
  }

  const payload = validation.payload;

  try {
    // Route based on intent
    switch (payload.intent) {
      case 'consult':
        await handleConsult(payload, trackingId, reply);
        break;

      case 'task':
        await handleTask(payload, trackingId, reply);
        break;

      case 'ambiguous':
        await handleAmbiguous(payload, trackingId, reply);
        break;

      default:
        // Should never reach here due to validation
        reply.status(400).send({
          accepted: false,
          status: 'rejected',
          message: `Unknown intent: ${payload.intent}`,
          tracking_id: trackingId,
          processed_at: Date.now(),
        } satisfies IntentRouterResponse);
    }
  } catch (err) {
    logger.error(
      { trackingId, err, intent: payload.intent },
      '[IntentRouter] Error processing intent'
    );
    reply.status(500).send({
      accepted: false,
      status: 'rejected',
      message: 'Internal error processing intent',
      tracking_id: trackingId,
      processed_at: Date.now(),
    } satisfies IntentRouterResponse);
  }

  const elapsed = Date.now() - startTime;
  logger.info(
    { trackingId, intent: payload.intent, elapsed_ms: elapsed },
    '[IntentRouter] Request processed'
  );
}

/**
 * Handle CONSULT intent
 * No task created - just log and acknowledge
 */
async function handleConsult(
  payload: IntentRouterPayload,
  trackingId: string,
  reply: FastifyReply
): Promise<void> {
  logger.info(
    {
      trackingId,
      source: payload.source,
      user: payload.channel_user_id,
      summary: payload.summary,
    },
    '[IntentRouter] Consult intent - no task needed'
  );

  // For consults, OpenClaw already provided the answer
  // We just acknowledge receipt
  reply.send({
    accepted: true,
    status: 'answered',
    message: 'Consult processed - answer provided by router',
    direct_answer: payload.direct_answer,
    tracking_id: trackingId,
    processed_at: Date.now(),
  } satisfies IntentRouterResponse);
}

/**
 * Handle TASK intent
 * Create task in OCAAS from task_payload
 */
async function handleTask(
  payload: IntentRouterPayload,
  trackingId: string,
  reply: FastifyReply
): Promise<void> {
  const { taskService } = getServices();
  const taskPayload = payload.task_payload!;

  logger.info(
    {
      trackingId,
      source: payload.source,
      user: payload.channel_user_id,
      title: taskPayload.title,
      risk: payload.risk_level,
      requires_confirmation: payload.requires_confirmation,
    },
    '[IntentRouter] Task intent - creating task'
  );

  // Determine initial status based on risk/confirmation
  const initialStatus = payload.requires_confirmation ? 'pending' : 'queued';

  // Create task
  const task = await taskService.create({
    title: taskPayload.title,
    description: taskPayload.description,
    type: taskPayload.type || 'general',
    priority: taskPayload.priority || 3,
    input: {
      raw_message: payload.raw_message,
      summary: payload.summary,
      extracted_params: taskPayload.extracted_params,
      channel_user_id: payload.channel_user_id,
      conversation_id: payload.conversation_id,
      message_id: payload.message_id,
      router_tracking_id: trackingId,
      openclaw_session_id: payload.openclaw_session_id,
    },
    metadata: {
      source: payload.source,
      intent_classification: {
        intent: payload.intent,
        confidence: payload.confidence,
        risk_level: payload.risk_level,
        requires_confirmation: payload.requires_confirmation,
        classified_at: payload.timestamp || Date.now(),
      },
      required_capabilities: taskPayload.required_capabilities,
      deadline: taskPayload.deadline,
    },
  });

  logger.info(
    { trackingId, taskId: task.id, status: initialStatus },
    '[IntentRouter] Task created'
  );

  reply.send({
    accepted: true,
    task_id: task.id,
    status: initialStatus === 'pending' ? 'created' : 'queued',
    message: payload.requires_confirmation
      ? 'Task created, awaiting confirmation'
      : 'Task created and queued for execution',
    tracking_id: trackingId,
    processed_at: Date.now(),
  } satisfies IntentRouterResponse);
}

/**
 * Handle AMBIGUOUS intent
 * No task created - request clarification
 */
async function handleAmbiguous(
  payload: IntentRouterPayload,
  trackingId: string,
  reply: FastifyReply
): Promise<void> {
  logger.info(
    {
      trackingId,
      source: payload.source,
      user: payload.channel_user_id,
      confidence: payload.confidence,
      summary: payload.summary,
    },
    '[IntentRouter] Ambiguous intent - clarification needed'
  );

  reply.send({
    accepted: true,
    status: 'clarification_needed',
    message: 'Unable to determine intent - clarification needed',
    clarification_question:
      payload.clarification_question ||
      'Could you please clarify what you would like me to do?',
    tracking_id: trackingId,
    processed_at: Date.now(),
  } satisfies IntentRouterResponse);
}

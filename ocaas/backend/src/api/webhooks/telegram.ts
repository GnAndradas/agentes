import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { TelegramChannel } from '../../notifications/TelegramChannel.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import crypto from 'crypto';

const logger = createLogger('TelegramWebhook');

/**
 * Validate the webhook secret token.
 *
 * Telegram sends the secret in X-Telegram-Bot-Api-Secret-Token header
 * when you set it up via setWebhook with secret_token parameter.
 *
 * @see https://core.telegram.org/bots/api#setwebhook
 */
function validateWebhookSecret(req: FastifyRequest): boolean {
  const configuredSecret = config.telegram.webhookSecret;

  // If no secret configured, reject all requests (secure by default)
  if (!configuredSecret) {
    logger.warn('TELEGRAM_WEBHOOK_SECRET not configured - webhook disabled for security');
    return false;
  }

  // Telegram sends the secret in this header
  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];

  if (!providedSecret || typeof providedSecret !== 'string') {
    logger.warn('Missing X-Telegram-Bot-Api-Secret-Token header');
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(configuredSecret, 'utf8'),
      Buffer.from(providedSecret, 'utf8')
    );
  } catch {
    // Buffer lengths don't match
    return false;
  }
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
      first_name?: string;
    };
    data?: string;
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
  };
  message?: {
    message_id: number;
    from: {
      id: number;
      username?: string;
    };
    chat: {
      id: number;
    };
    text?: string;
  };
}

/**
 * Check if a Telegram user ID is allowed to perform approval actions.
 *
 * SECURITY: If TELEGRAM_ALLOWED_USER_IDS is not configured, NO ONE is allowed.
 * This is secure-by-default behavior.
 */
function isUserAllowed(userId: number): boolean {
  const allowedUserIds = config.telegram.allowedUserIds;

  // SECURE BY DEFAULT: If no allowed users configured, reject all
  if (allowedUserIds.length === 0) {
    logger.warn('TELEGRAM_ALLOWED_USER_IDS not configured - rejecting all approval requests');
    return false;
  }

  return allowedUserIds.includes(String(userId));
}

export async function handleTelegramWebhook(
  req: FastifyRequest<{ Body: TelegramUpdate }>,
  reply: FastifyReply
) {
  // SECURITY: Validate webhook secret FIRST
  if (!validateWebhookSecret(req)) {
    logger.warn({ ip: req.ip }, 'Telegram webhook rejected: invalid or missing secret');
    // Return 401 to indicate auth failure (Telegram will stop retrying)
    return reply.status(401).send({ ok: false, error: 'Unauthorized' });
  }

  try {
    const update = req.body;

    // Handle callback queries (button presses)
    if (update.callback_query?.data) {
      const userId = update.callback_query.from.id;

      // Verify user is allowed to perform approval actions
      if (!isUserAllowed(userId)) {
        logger.warn({ userId, username: update.callback_query.from.username }, 'Unauthorized Telegram user attempted approval action');
        await answerCallback(update.callback_query.id, 'No autorizado');
        return reply.status(200).send({ ok: true });
      }

      const callbackData = TelegramChannel.parseCallbackData(update.callback_query.data);

      if (callbackData) {
        const { action, approvalId, generationId } = callbackData;
        const respondedBy = `telegram:${update.callback_query.from.username ?? userId}`;

        try {
          // Handle generation approvals (direct generation approval flow)
          if (generationId) {
            await handleGenerationApproval(generationId, action, respondedBy, update.callback_query.id);
          }
          // Handle generic approvals
          else if (approvalId) {
            await handleGenericApproval(approvalId, action, respondedBy, update.callback_query.id);
          }
        } catch (err) {
          logger.error({ err, approvalId, generationId }, 'Failed to process Telegram callback');
          await answerCallback(update.callback_query.id, 'Error al procesar');
        }
      }
    }

    // Always respond with 200 to Telegram
    return reply.status(200).send({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Telegram webhook error');
    // Still return 200 to prevent Telegram from retrying
    return reply.status(200).send({ ok: true });
  }
}

/**
 * Handle approval/rejection of a generation via Telegram
 * Uses the central workflow service for consistent flow
 */
async function handleGenerationApproval(
  generationId: string,
  action: string,
  respondedBy: string,
  callbackQueryId: string
): Promise<void> {
  const { activationWorkflow } = getServices();

  if (action === 'approve') {
    const result = await activationWorkflow.approveGeneration(generationId, respondedBy);

    if (!result.success) {
      logger.warn({ generationId, error: result.error }, 'Generation approval failed via Telegram');
      await answerCallback(callbackQueryId, result.error || 'Error al aprobar');
      return;
    }

    if (result.alreadyProcessed) {
      logger.info({ generationId, respondedBy }, 'Generation already approved (idempotent)');
      await answerCallback(callbackQueryId, 'Ya estaba aprobado');
      return;
    }

    logger.info({ generationId, type: result.generation?.type, respondedBy }, 'Generation approved and activated via Telegram');
    await answerCallback(callbackQueryId, `${result.generation?.type ?? 'recurso'} aprobado y activado`);
  } else if (action === 'reject') {
    const result = await activationWorkflow.rejectGeneration(generationId, `Rejected via Telegram by ${respondedBy}`);

    if (!result.success) {
      logger.warn({ generationId, error: result.error }, 'Generation rejection failed via Telegram');
      await answerCallback(callbackQueryId, result.error || 'Error al rechazar');
      return;
    }

    if (result.alreadyProcessed) {
      logger.info({ generationId, respondedBy }, 'Generation already rejected (idempotent)');
      await answerCallback(callbackQueryId, 'Ya estaba rechazado');
      return;
    }

    logger.info({ generationId, respondedBy }, 'Generation rejected via Telegram');
    await answerCallback(callbackQueryId, 'Rechazado');
  }
}

/**
 * Handle generic approval (not generation-specific)
 * Uses the central workflow service for consistent flow
 */
async function handleGenericApproval(
  approvalId: string,
  action: string,
  respondedBy: string,
  callbackQueryId: string
): Promise<void> {
  const { activationWorkflow } = getServices();

  if (action === 'approve') {
    const result = await activationWorkflow.approveApproval(approvalId, respondedBy);

    if (!result.success) {
      logger.warn({ approvalId, error: result.error }, 'Approval failed via Telegram');
      await answerCallback(callbackQueryId, result.error || 'Error al aprobar');
      return;
    }

    if (result.alreadyProcessed) {
      logger.info({ approvalId, respondedBy }, 'Approval already processed (idempotent)');
      await answerCallback(callbackQueryId, 'Ya estaba aprobado');
      return;
    }

    logger.info({ approvalId, respondedBy }, 'Approval approved via Telegram');
    await answerCallback(callbackQueryId, 'Aprobado');
  } else if (action === 'reject') {
    const result = await activationWorkflow.rejectApproval(approvalId, respondedBy, 'Rejected via Telegram');

    if (!result.success) {
      logger.warn({ approvalId, error: result.error }, 'Approval rejection failed via Telegram');
      await answerCallback(callbackQueryId, result.error || 'Error al rechazar');
      return;
    }

    if (result.alreadyProcessed) {
      logger.info({ approvalId, respondedBy }, 'Approval already rejected (idempotent)');
      await answerCallback(callbackQueryId, 'Ya estaba rechazado');
      return;
    }

    logger.info({ approvalId, respondedBy }, 'Approval rejected via Telegram');
    await answerCallback(callbackQueryId, 'Rechazado');
  }
}

async function answerCallback(callbackQueryId: string, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
      }),
    });
  } catch {
    // Ignore errors in callback answer
  }
}

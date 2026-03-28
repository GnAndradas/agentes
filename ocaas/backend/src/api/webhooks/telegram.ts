import type { FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services/index.js';
import { TelegramChannel } from '../../notifications/TelegramChannel.js';
import { createLogger } from '../../utils/logger.js';
import { toErrorResponse } from '../../utils/errors.js';

const logger = createLogger('TelegramWebhook');

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

export async function handleTelegramWebhook(
  req: FastifyRequest<{ Body: TelegramUpdate }>,
  reply: FastifyReply
) {
  try {
    const update = req.body;

    // Handle callback queries (button presses)
    if (update.callback_query?.data) {
      const callbackData = TelegramChannel.parseCallbackData(update.callback_query.data);

      if (callbackData) {
        const { action, approvalId } = callbackData;
        const { approvalService } = getServices();
        const respondedBy = `telegram:${update.callback_query.from.username ?? update.callback_query.from.id}`;

        try {
          if (action === 'approve') {
            await approvalService.approve(approvalId, respondedBy);
            logger.info({ approvalId, respondedBy }, 'Approval approved via Telegram');
          } else if (action === 'reject') {
            await approvalService.reject(approvalId, respondedBy, 'Rejected via Telegram');
            logger.info({ approvalId, respondedBy }, 'Approval rejected via Telegram');
          }

          // Answer callback to remove loading state
          await answerCallback(update.callback_query.id, action === 'approve' ? 'Aprobado' : 'Rechazado');
        } catch (err) {
          logger.error({ err, approvalId }, 'Failed to process Telegram callback');
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

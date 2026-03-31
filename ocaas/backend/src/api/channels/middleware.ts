import type { FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '../../utils/logger.js';
import { timingSafeEqual } from 'crypto';

const logger = createLogger('channel-auth');

const CHANNEL_SECRET = process.env.CHANNEL_SECRET_KEY || process.env.API_SECRET_KEY;

/**
 * Middleware to verify X-CHANNEL-SECRET header
 * Protects channel endpoints from unauthorized access
 */
export async function verifyChannelSecret(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip validation if no secret is configured (development mode)
  if (!CHANNEL_SECRET) {
    logger.warn('CHANNEL_SECRET_KEY not configured - channel endpoints unprotected');
    return;
  }

  const providedSecret = request.headers['x-channel-secret'];

  if (!providedSecret) {
    logger.warn({
      ip: request.ip,
      path: request.url,
    }, 'Missing X-CHANNEL-SECRET header');

    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing X-CHANNEL-SECRET header',
    });
  }

  if (typeof providedSecret !== 'string') {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid X-CHANNEL-SECRET header format',
    });
  }

  // Timing-safe comparison to prevent timing attacks
  const secretBuffer = Buffer.from(CHANNEL_SECRET);
  const providedBuffer = Buffer.from(providedSecret);

  if (secretBuffer.length !== providedBuffer.length) {
    logger.warn({
      ip: request.ip,
      path: request.url,
    }, 'Invalid channel secret (length mismatch)');

    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid X-CHANNEL-SECRET',
    });
  }

  if (!timingSafeEqual(secretBuffer, providedBuffer)) {
    logger.warn({
      ip: request.ip,
      path: request.url,
    }, 'Invalid channel secret');

    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid X-CHANNEL-SECRET',
    });
  }

  // Secret is valid, continue
  logger.debug({ path: request.url }, 'Channel secret verified');
}

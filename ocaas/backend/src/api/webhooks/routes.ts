import type { FastifyInstance } from 'fastify';
import { handleTelegramWebhook } from './telegram.js';

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post('/telegram', handleTelegramWebhook);
}

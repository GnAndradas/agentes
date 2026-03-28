import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { registerRoutes } from './api/index.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('app');

export async function createApp() {
  const app = Fastify({
    logger: false,
  });

  // CORS
  await app.register(cors, {
    origin: config.server.isDev ? true : ['http://localhost:5173'],
    credentials: true,
  });

  // Routes
  await registerRoutes(app);

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Unhandled error');
    reply.status(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}

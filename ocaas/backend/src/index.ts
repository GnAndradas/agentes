import { config } from './config/index.js';
import { loadAutonomyConfig } from './config/autonomy.js';
import { initDatabase } from './db/index.js';
import { initServices } from './services/index.js';
import { initOpenClaw } from './openclaw/index.js';
import { initOrchestrator, shutdownOrchestrator } from './orchestrator/index.js';
import { initGenerator } from './generator/index.js';
import { initWebSocket, shutdownWebSocket } from './websocket/index.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('main');

async function main() {
  try {
    // Initialize database
    await initDatabase();

    // Initialize services
    initServices();

    // Load autonomy configuration
    const autonomyConfig = await loadAutonomyConfig();
    logger.info({ level: autonomyConfig.level }, 'Autonomy config loaded');

    // Initialize OpenClaw adapter
    await initOpenClaw();

    // Initialize generator
    initGenerator();

    // Create Fastify app
    const app = await createApp();

    // Start server first to get the HTTP server instance
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    // Initialize WebSocket using Fastify's internal HTTP server
    initWebSocket(app.server);

    // Initialize orchestrator
    await initOrchestrator();

    logger.info(`Server running at http://${config.server.host}:${config.server.port}`);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      shutdownOrchestrator();
      shutdownWebSocket();
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();

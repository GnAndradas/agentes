import { config } from './config/index.js';
import { EVENT_TYPE } from './config/constants.js';
import { loadAutonomyConfig } from './config/autonomy.js';
import { initDatabase } from './db/index.js';
import { initServices, getServices } from './services/index.js';
import { initOpenClaw } from './openclaw/index.js';
import { initOrchestrator, shutdownOrchestrator } from './orchestrator/index.js';
import { initGenerator } from './generator/index.js';
import { initWebSocket, shutdownWebSocket } from './websocket/index.js';
import { initChannelBridge, shutdownChannelBridge } from './services/ChannelBridge.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';
import { validateOrExit } from './bootstrap/validate.js';
import { runProductionChecks } from './bootstrap/productionChecks.js';
import { ensureDefaultAgent } from './bootstrap/AgentBootstrap.js';
import { getJobSafetyService } from './execution/JobSafetyService.js';
import { cleanupOldLogs } from './utils/dbLogger.js';

const logger = createLogger('main');

async function main() {
  try {
    // Validate startup configuration before doing anything else
    await validateOrExit({
      info: (msg) => logger.info(msg),
      error: (msg) => logger.error(msg),
      warn: (msg) => logger.warn(msg),
    });

    // Initialize database
    await initDatabase();

    // Initialize services
    initServices();

    // Load autonomy configuration
    const autonomyConfig = await loadAutonomyConfig();
    logger.info({ level: autonomyConfig.level }, 'Autonomy config loaded');

    // Initialize OpenClaw adapter
    await initOpenClaw();

    // Initialize Job Safety Service (production hardening)
    const jobSafety = getJobSafetyService();
    jobSafety.initialize();

    // Ensure at least one active agent exists (auto-seed if needed)
    await ensureDefaultAgent();

    // Run production checks
    await runProductionChecks();

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

    // Initialize channel bridge (routes responses back to external channels)
    const { eventService } = getServices();
    initChannelBridge(eventService);

    // Emit system started event
    eventService.emit({
      type: EVENT_TYPE.SYSTEM_STARTED,
      category: 'system',
      message: 'OCAAS system started',
      data: {
        port: config.server.port,
        host: config.server.host,
        timestamp: Date.now(),
      },
    });

    logger.info(`Server running at http://${config.server.host}:${config.server.port}`);

    // Periodic log cleanup (every 24 hours)
    setInterval(() => {
      const deleted = cleanupOldLogs(7);
      if (deleted > 0) {
        logger.info({ deleted }, 'Cleaned up old logs');
      }
    }, 24 * 60 * 60 * 1000);

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      jobSafety.shutdown();
      shutdownChannelBridge();
      await shutdownOrchestrator();
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

export * from './types.js';
export { OpenClawGateway, getGateway } from './gateway.js';
export { SessionManager, getSessionManager } from './session.js';
export { WorkspaceSync, getWorkspaceSync } from './sync.js';

import { getGateway } from './gateway.js';
import { getSessionManager } from './session.js';
import { getWorkspaceSync } from './sync.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('openclaw');

export async function initOpenClaw(): Promise<boolean> {
  const gateway = getGateway();
  const sync = getWorkspaceSync();

  // Try to connect to gateway
  const connected = await gateway.connect();

  // Sync workspace regardless of gateway status
  try {
    sync.ensureDirectories();
    await sync.fullSync();
  } catch (err) {
    logger.warn({ err }, 'Workspace sync failed');
  }

  // Sync sessions if connected
  if (connected) {
    const sessionManager = getSessionManager();
    await sessionManager.syncSessions();
  }

  logger.info({ connected }, 'OpenClaw initialized');
  return connected;
}

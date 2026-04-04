export * from './types.js';
// NOTE: Gateway export kept for backwards compatibility and for getDiagnostic()
// New code should use getOpenClawAdapter() from integrations/openclaw
export { OpenClawGateway, getGateway } from './gateway.js';
export { SessionManager, getSessionManager } from './session.js';
export { WorkspaceSync, getWorkspaceSync } from './sync.js';

// BLOQUE 8: OpenClaw Compatibility
export {
  // Types
  type OpenClawRealUsage,
  type CompatibilityCheck,
  type IgnoredFieldsMap,
  type StructureValidation,
  // Constants
  OPENCLAW_REAL_USAGE,
  SKILL_REQUIRED_FILES,
  TOOL_REQUIREMENTS,
  AGENT_REQUIRED_FILES,
  IGNORED_FIELDS,
  // Functions
  checkSkillCompatibility,
  checkToolCompatibility,
  checkAgentCompatibility,
  validateSkillStructure,
  validateToolStructure,
  validateAgentStructure,
  getCompatibilitySummary,
  logCompatibilitySummary,
  logIgnoredFieldsWarning,
} from './OpenClawCompatibility.js';

import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
import { getSessionManager } from './session.js';
import { getWorkspaceSync } from './sync.js';
import { logCompatibilitySummary } from './OpenClawCompatibility.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('openclaw');

export async function initOpenClaw(): Promise<boolean> {
  const adapter = getOpenClawAdapter();
  const sync = getWorkspaceSync();

  // BLOQUE 8: Log compatibility summary
  logCompatibilitySummary();

  // Try to connect via adapter
  const connected = await adapter.initialize();

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

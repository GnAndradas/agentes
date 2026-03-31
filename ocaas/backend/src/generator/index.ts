export * from './types.js';
export { getValidator } from './Validator.js';
export { getAIClient } from './AIClient.js';
export { getSkillGenerator } from './SkillGenerator.js';
export { getToolGenerator } from './ToolGenerator.js';
export { getAgentGenerator } from './AgentGenerator.js';
export * from './templates/index.js';

import { getAIClient } from './AIClient.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('generator');

export async function initGenerator(): Promise<void> {
  const aiClient = getAIClient();

  // Check if gateway is configured (has API key)
  if (!aiClient.isConfigured()) {
    logger.warn('AI Generator running in template-only mode (OPENCLAW_API_KEY not configured)');
    return;
  }

  // Check actual connectivity
  const available = await aiClient.isAvailable();
  if (available) {
    logger.info('AI Generator initialized via OpenClaw Gateway');
  } else {
    logger.warn('AI Generator: Gateway configured but not reachable. Will retry on each generation.');
  }
}

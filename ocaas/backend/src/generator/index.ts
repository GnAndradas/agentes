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

export function initGenerator(): void {
  const aiClient = getAIClient();

  if (aiClient.isAvailable()) {
    logger.info('AI Generator initialized via OpenClaw Gateway');
  } else {
    logger.warn('AI Generator running in template-only mode (gateway not connected)');
  }
}

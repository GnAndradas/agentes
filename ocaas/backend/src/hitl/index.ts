/**
 * Human-in-the-Loop (HITL) Module
 *
 * Provides escalation management for human intervention in the agent system.
 */

export {
  HumanEscalationService,
  getHumanEscalationService,
  // Types
  type EscalationDTO,
  type CreateEscalationInput,
  type ResolveEscalationInput,
  type HumanInbox,
  type EscalationStats,
  // Constants
  ESCALATION_TYPE,
  ESCALATION_STATUS,
  ESCALATION_PRIORITY,
  RESOLUTION_TYPE,
  FALLBACK_ACTION,
} from './HumanEscalationService.js';

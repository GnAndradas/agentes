// Agent status
export const AGENT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BUSY: 'busy',
  ERROR: 'error',
} as const;

// Task status
export const TASK_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

// Task priority
export const TASK_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

// Generation status (estados obligatorios del sistema)
export const GENERATION_STATUS = {
  DRAFT: 'draft',
  GENERATED: 'generated',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  FAILED: 'failed',
} as const;

// Generation types
export const GENERATION_TYPE = {
  AGENT: 'agent',
  SKILL: 'skill',
  TOOL: 'tool',
} as const;

// Permission levels
export const PERMISSION_LEVEL = {
  NONE: 0,
  READ: 1,
  EXECUTE: 2,
  WRITE: 3,
  ADMIN: 4,
} as const;

// Event types
export const EVENT_TYPE = {
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DELETED: 'agent.deleted',
  AGENT_ACTIVATED: 'agent.activated',
  AGENT_DEACTIVATED: 'agent.deactivated',

  TASK_CREATED: 'task.created',
  TASK_ASSIGNED: 'task.assigned',
  TASK_STARTED: 'task.started',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED: 'task.failed',
  TASK_CANCELLED: 'task.cancelled',

  SKILL_CREATED: 'skill.created',
  SKILL_UPDATED: 'skill.updated',
  SKILL_SYNCED: 'skill.synced',

  TOOL_CREATED: 'tool.created',
  TOOL_UPDATED: 'tool.updated',
  TOOL_EXECUTED: 'tool.executed',

  GENERATION_STARTED: 'generation.started',
  GENERATION_COMPLETED: 'generation.completed',
  GENERATION_FAILED: 'generation.failed',
  GENERATION_APPROVED: 'generation.approved',
  GENERATION_REJECTED: 'generation.rejected',
  GENERATION_ACTIVATED: 'generation.activated',

  SYSTEM_STARTED: 'system.started',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_INFO: 'system.info',
  SYSTEM_WARNING: 'system.warning',
  OPENCLAW_CONNECTED: 'openclaw.connected',
  OPENCLAW_DISCONNECTED: 'openclaw.disconnected',

  // Action executor events
  ACTION_CREATED: 'action.created',
  ACTION_APPROVED: 'action.approved',
  ACTION_EXECUTED: 'action.executed',
  ACTION_FAILED: 'action.failed',
  TASK_RETRY_TRIGGERED: 'task.retry_triggered',

  // Agent feedback events
  AGENT_FEEDBACK_RECEIVED: 'agent.feedback_received',
  AGENT_BLOCKED: 'agent.blocked',
  AGENT_MISSING_TOOL: 'agent.missing_tool',
  AGENT_MISSING_SKILL: 'agent.missing_skill',
  AGENT_MISSING_CAPABILITY: 'agent.missing_capability',

  // Task analysis events (Fase 6: Jefe Inteligente)
  TASK_ANALYSIS_STARTED: 'task.analysis_started',
  TASK_ANALYSIS_COMPLETED: 'task.analysis_completed',
  TASK_ANALYSIS_FAILED: 'task.analysis_failed',
  INTELLIGENT_AGENT_SELECTED: 'orchestrator.intelligent_agent_selected',
  MISSING_CAPABILITY_DETECTED: 'orchestrator.missing_capability_detected',

  // Task decomposition events (Fase 7: Subdivisión automática)
  TASK_DECOMPOSITION_STARTED: 'task.decomposition_started',
  TASK_DECOMPOSITION_COMPLETED: 'task.decomposition_completed',
  TASK_DECOMPOSITION_FAILED: 'task.decomposition_failed',
  SUBTASK_CREATED: 'task.subtask_created',
  SUBTASK_STARTED: 'task.subtask_started',
  SUBTASK_COMPLETED: 'task.subtask_completed',
  PARENT_TASK_COMPLETED: 'task.parent_completed',
} as const;

export type EventType = typeof EVENT_TYPE[keyof typeof EVENT_TYPE];

// WebSocket channels
export const WS_CHANNEL = {
  SYSTEM: 'system',
  AGENTS: 'agents',
  TASKS: 'tasks',
  GENERATIONS: 'generations',
  EVENTS: 'events',
  APPROVALS: 'approvals',
} as const;

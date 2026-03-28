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
  OPENCLAW_CONNECTED: 'openclaw.connected',
  OPENCLAW_DISCONNECTED: 'openclaw.disconnected',
} as const;

// WebSocket channels
export const WS_CHANNEL = {
  SYSTEM: 'system',
  AGENTS: 'agents',
  TASKS: 'tasks',
  GENERATIONS: 'generations',
  EVENTS: 'events',
} as const;

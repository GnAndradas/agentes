export type AgentStatus = 'active' | 'inactive' | 'busy' | 'error';
export type AgentType = 'general' | 'specialist' | 'orchestrator';

export type TaskStatus = 'pending' | 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 1 | 2 | 3 | 4;

export const TASK_PRIORITY = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export type SkillStatus = 'active' | 'inactive' | 'deprecated';
export type ToolType = 'script' | 'binary' | 'api';
export type ToolStatus = 'active' | 'inactive' | 'deprecated';

export type GenerationStatus = 'draft' | 'generated' | 'pending_approval' | 'approved' | 'rejected' | 'active' | 'failed';
export type GenerationType = 'agent' | 'skill' | 'tool';

export interface Agent {
  id: string;
  name: string;
  description?: string;
  type: AgentType;
  status: AgentStatus;
  capabilities?: string[];
  config?: Record<string, unknown>;
  sessionId?: string;
  lastActiveAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: TaskStatus;
  priority: TaskPriority;
  agentId?: string;
  parentTaskId?: string;
  batchId?: string;
  dependsOn?: string[];
  sequenceOrder?: number;
  retryCount: number;
  maxRetries: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  version: string;
  path: string;
  status: SkillStatus;
  capabilities?: string[];
  requirements?: string[];
  config?: Record<string, unknown>;
  syncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tool {
  id: string;
  name: string;
  description?: string;
  version: string;
  path: string;
  type: ToolType;
  status: ToolStatus;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
  executionCount: number;
  lastExecutedAt?: number;
  syncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Generation {
  id: string;
  type: GenerationType;
  name: string;
  description?: string;
  status: GenerationStatus;
  prompt: string;
  generatedContent?: Record<string, unknown>;
  validationResult?: Record<string, unknown>;
  targetPath?: string;
  errorMessage?: string;
  approvedBy?: string;
  approvedAt?: number;
  activatedAt?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface SystemStats {
  agents: {
    total: number;
    active: number;
    inactive: number;
    busy: number;
    error: number;
  };
  tasks: {
    total: number;
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    parentTasks: number;
    subtasks: number;
    decomposed: number;
    subtasksCompleted: number;
    subtasksFailed: number;
  };
  generations: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    active: number;
    failed: number;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
  };
  feedback: {
    total: number;
    processed: number;
    unprocessed: number;
    byType: {
      missingTool: number;
      missingSkill: number;
      missingCapability: number;
      blocked: number;
    };
  };
  orchestrator: {
    running: boolean;
    queueSize: number;
    processing: number;
    sequentialMode: boolean;
  };
  system: {
    uptime: number;
    memoryUsage: number;
  };
}

export interface WSEvent {
  type: string;
  channel: string;
  payload: {
    entityType: string | null;
    entityId: string | null;
    data: unknown;
  };
  timestamp: number;
}

// Approval types
export type ApprovalType = 'task' | 'agent' | 'skill' | 'tool';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Approval {
  id: string;
  type: ApprovalType;
  resourceId?: string;
  status: ApprovalStatus;
  requestedAt: number;
  expiresAt?: number;
  respondedAt?: number;
  respondedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// Autonomy types
export type AutonomyLevel = 'manual' | 'supervised' | 'autonomous';
export type FallbackBehavior = 'pause' | 'reject' | 'auto_approve';
export type TaskApprovalPolicy = 'none' | 'high_priority' | 'all';

export interface AutonomyConfig {
  level: AutonomyLevel;
  canCreateAgents: boolean;
  canGenerateSkills: boolean;
  canGenerateTools: boolean;
  requireApprovalFor: {
    taskExecution: TaskApprovalPolicy;
    agentCreation: boolean;
    skillGeneration: boolean;
    toolGeneration: boolean;
  };
  humanTimeout: number;
  fallbackBehavior: FallbackBehavior;
  sequentialExecution: boolean;
}

export interface OrchestratorStatus {
  running: boolean;
  queueSize: number;
  processing: number;
  sequentialMode: boolean;
  autonomyLevel: AutonomyLevel;
}

// Feedback types
export type FeedbackType = 'missing_tool' | 'missing_skill' | 'missing_capability' | 'blocked' | 'cannot_continue';

export interface AgentFeedback {
  id: string;
  type: FeedbackType;
  agentId: string;
  taskId: string;
  sessionId?: string;
  message: string;
  requirement?: string;
  context?: Record<string, unknown>;
  createdAt: number;
  processed: boolean;
  processingResult?: {
    action?: string;
    generationId?: string;
    approvalId?: string;
    error?: string;
  };
}

// Event types
export interface SystemEvent {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  resourceType?: string;
  resourceId?: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Organizational Layer Types
 *
 * Define roles, hierarchy, work profiles, and policy structures
 */

// =============================================================================
// ROLE TYPES
// =============================================================================

export type RoleType = 'ceo' | 'manager' | 'supervisor' | 'worker' | 'specialist';

export const ROLE_HIERARCHY: Record<RoleType, number> = {
  ceo: 1,
  manager: 2,
  supervisor: 3,
  specialist: 4,
  worker: 5,
};

export interface EscalationPolicy {
  /** Allow escalation to supervisor */
  canEscalate: boolean;
  /** Max retries before escalating */
  maxRetriesBeforeEscalate: number;
  /** Auto-escalate on specific error types */
  escalateOnErrors: string[];
  /** Timeout (ms) before auto-escalate */
  escalateTimeoutMs: number;
  /** Skip to human if no supervisor available */
  skipToHumanIfNoSupervisor: boolean;
}

export interface AutonomyPolicy {
  /** Can create resources (agents/skills/tools) autonomously */
  canCreateResources: boolean;
  /** Can delegate tasks to subordinates */
  canDelegate: boolean;
  /** Can split tasks into subtasks */
  canSplitTasks: boolean;
  /** Can escalate directly to human */
  canEscalateToHuman: boolean;
  /** Max task complexity this role can handle (1-10) */
  maxComplexity: number;
  /** Max priority tasks this role can handle (1-4) */
  maxPriority: number;
  /** Can approve resources created by subordinates */
  canApproveSubordinates: boolean;
}

export interface AgentOrgProfile {
  /** Agent ID */
  agentId: string;
  /** Role type */
  roleType: RoleType;
  /** Supervisor agent ID (null for CEO) */
  supervisorAgentId: string | null;
  /** Work profile ID */
  workProfileId: string;
  /** Escalation policy override (uses profile default if null) */
  escalationPolicy: EscalationPolicy | null;
  /** Autonomy policy override (uses profile default if null) */
  autonomyPolicy: AutonomyPolicy | null;
  /** Department/team (optional grouping) */
  department: string | null;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

// =============================================================================
// WORK PROFILES
// =============================================================================

export type WorkProfilePreset =
  | 'conservative'
  | 'balanced'
  | 'aggressive'
  | 'human_first'
  | 'autonomous_first';

export interface WorkProfile {
  /** Profile ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Preset type or 'custom' */
  preset: WorkProfilePreset | 'custom';
  /** Is this editable by users */
  editable: boolean;

  // Retry behavior
  retry: {
    /** Max retries before giving up or escalating */
    maxRetries: number;
    /** Delay between retries (ms) */
    retryDelayMs: number;
    /** Backoff multiplier for retry delay */
    backoffMultiplier: number;
  };

  // Delegation
  delegation: {
    /** How aggressively to delegate (0-1) */
    aggressiveness: number;
    /** Prefer delegation over self-execution */
    preferDelegation: boolean;
    /** Max delegation depth */
    maxDepth: number;
  };

  // Task splitting
  splitting: {
    /** Enable automatic task splitting */
    enabled: boolean;
    /** Min complexity to trigger split (1-10) */
    minComplexityToSplit: number;
    /** Max subtasks per split */
    maxSubtasks: number;
  };

  // Resource creation
  resourceCreation: {
    /** Auto-create missing resources */
    autoCreate: boolean;
    /** Types that can be auto-created */
    allowedTypes: ('agent' | 'skill' | 'tool')[];
    /** Require approval before activation */
    requireApproval: boolean;
  };

  // Escalation
  escalation: {
    /** When to escalate (failure_count, timeout, complexity, manual) */
    triggers: ('failure_count' | 'timeout' | 'complexity' | 'blocked')[];
    /** Failure count threshold */
    failureThreshold: number;
    /** Timeout threshold (ms) */
    timeoutThreshold: number;
    /** Auto-notify human on escalation */
    notifyHuman: boolean;
  };

  // Human approval thresholds
  humanApproval: {
    /** Tasks above this priority require human approval */
    priorityThreshold: number;
    /** Tasks above this complexity require human approval */
    complexityThreshold: number;
    /** Always require human for these task types */
    requiredForTypes: string[];
  };

  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

// =============================================================================
// POLICY DECISIONS
// =============================================================================

export type PolicyDecisionType =
  | 'delegate'
  | 'split'
  | 'escalate'
  | 'create_resource'
  | 'notify_human'
  | 'continue'
  | 'wait'
  | 'reject';

export interface PolicyDecision {
  /** Decision type */
  type: PolicyDecisionType;
  /** Should execute this decision */
  allowed: boolean;
  /** Reason for decision */
  reason: string;
  /** Target (agentId, resource type, etc.) */
  target?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface PolicyContext {
  /** Task being processed */
  taskId: string;
  /** Current agent handling task */
  agentId: string;
  /** Agent's org profile */
  agentProfile: AgentOrgProfile;
  /** Active work profile */
  workProfile: WorkProfile;
  /** Global autonomy mode */
  autonomyMode: 'manual' | 'supervised' | 'autonomous';
  /** Current failure context */
  failureContext?: {
    failureCount: number;
    lastError?: string;
    missingResource?: string;
    blockedReason?: string;
  };
  /** Task analysis if available */
  taskAnalysis?: {
    complexity: 'low' | 'medium' | 'high';
    taskType: string;
    requiredCapabilities: string[];
  };
}

// =============================================================================
// TASK MEMORY
// =============================================================================

export interface TaskDecision {
  /** Timestamp */
  timestamp: number;
  /** Decision made */
  decision: PolicyDecisionType;
  /** Agent that made decision */
  agentId: string;
  /** Reason */
  reason: string;
  /** Outcome */
  outcome: 'success' | 'failed' | 'pending';
}

export interface EscalationRecord {
  /** Timestamp */
  timestamp: number;
  /** From agent */
  fromAgentId: string;
  /** To agent (or 'human') */
  toAgentId: string | 'human';
  /** Reason for escalation */
  reason: string;
  /** Was it resolved at this level */
  resolved: boolean;
}

export interface TaskMemory {
  /** Task ID */
  taskId: string;
  /** Executive summary */
  summary: string;
  /** All decisions made */
  decisions: TaskDecision[];
  /** Agents that worked on this task */
  assignedAgentIds: string[];
  /** Resources created for this task */
  createdResources: Array<{
    type: 'agent' | 'skill' | 'tool';
    id: string;
    name: string;
  }>;
  /** Escalation history */
  escalationHistory: EscalationRecord[];
  /** Last known blockers */
  lastKnownBlockers: string[];
  /** Retry history */
  retryHistory: Array<{
    timestamp: number;
    attempt: number;
    error?: string;
  }>;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

// =============================================================================
// EVENTS
// =============================================================================

export interface OrgEventPayload {
  taskId: string;
  actorAgentId?: string;
  targetAgentId?: string;
  roleType?: RoleType;
  profile?: string;
  autonomyMode?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// DEFAULT PROFILES
// =============================================================================

export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  canEscalate: true,
  maxRetriesBeforeEscalate: 2,
  escalateOnErrors: ['timeout', 'blocked', 'capability_missing'],
  escalateTimeoutMs: 300000, // 5 minutes
  skipToHumanIfNoSupervisor: true,
};

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  canCreateResources: false,
  canDelegate: false,
  canSplitTasks: false,
  canEscalateToHuman: true,
  maxComplexity: 5,
  maxPriority: 2,
  canApproveSubordinates: false,
};

export const ROLE_DEFAULT_AUTONOMY: Record<RoleType, Partial<AutonomyPolicy>> = {
  ceo: {
    canCreateResources: true,
    canDelegate: true,
    canSplitTasks: true,
    canEscalateToHuman: true,
    maxComplexity: 10,
    maxPriority: 4,
    canApproveSubordinates: true,
  },
  manager: {
    canCreateResources: true,
    canDelegate: true,
    canSplitTasks: true,
    canEscalateToHuman: true,
    maxComplexity: 8,
    maxPriority: 4,
    canApproveSubordinates: true,
  },
  supervisor: {
    canCreateResources: false,
    canDelegate: true,
    canSplitTasks: true,
    canEscalateToHuman: true,
    maxComplexity: 6,
    maxPriority: 3,
    canApproveSubordinates: false,
  },
  specialist: {
    canCreateResources: false,
    canDelegate: false,
    canSplitTasks: false,
    canEscalateToHuman: true,
    maxComplexity: 8,
    maxPriority: 3,
    canApproveSubordinates: false,
  },
  worker: {
    canCreateResources: false,
    canDelegate: false,
    canSplitTasks: false,
    canEscalateToHuman: true,
    maxComplexity: 4,
    maxPriority: 2,
    canApproveSubordinates: false,
  },
};

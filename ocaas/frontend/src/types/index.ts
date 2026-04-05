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

// Tool config types by tool type
export interface ScriptToolConfig {
  entrypoint?: string;
  runtime?: string;
  argsTemplate?: string;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  timeoutMs?: number;
  captureStderr?: boolean;
}

export interface BinaryToolConfig {
  binaryPath?: string;
  argsTemplate?: string;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  timeoutMs?: number;
  shell?: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiToolConfig {
  method?: HttpMethod;
  url?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  queryTemplate?: Record<string, string>;
  timeoutMs?: number;
  followRedirects?: boolean;
  responseType?: 'json' | 'text' | 'binary';
  auth?: {
    type: 'bearer' | 'basic' | 'api_key';
    value?: string;
    headerName?: string;
  };
}

export type ToolConfig = ScriptToolConfig | BinaryToolConfig | ApiToolConfig;

// Validation result types
export interface ToolValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ToolValidationResult {
  valid: boolean;
  score: number;
  issues: ToolValidationIssue[];
  suggestions: string[];
}

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

/**
 * Delegation record for task assignment history
 */
export interface DelegationRecord {
  fromAgentId: string | null;
  toAgentId: string;
  reason: 'initial' | 'escalation' | 'delegation' | 'reassignment' | 'failure_recovery';
  timestamp: number;
  jobId?: string;
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
  delegationHistory?: DelegationRecord[];
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Skill-Tool link representing a tool associated with a skill
 */
export interface SkillToolLink {
  toolId: string;
  orderIndex: number;
  required: boolean;
  role?: string;
  config?: Record<string, unknown>;
  createdAt?: number; // Optional - backend assigns if not provided
}

/**
 * Skill-Tool link with expanded tool details
 */
export interface SkillToolExpanded extends SkillToolLink {
  tool: Tool;
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
  // Tool composition (optional - populated when requested)
  linkedTools?: SkillToolLink[];
  toolCount?: number;
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

// =============================================================================
// SKILL EXECUTION TYPES
// =============================================================================

export type ExecutionMode = 'run' | 'validate' | 'dry_run';
export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled';

export interface ToolExecutionResult {
  toolId: string;
  toolName: string;
  status: ExecutionStatus;
  output?: Record<string, unknown>;
  error?: string;
  errorStack?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  required: boolean;
  role?: string;
  orderIndex: number;
}

export interface SkillExecutionResult {
  executionId: string;
  skillId: string;
  skillName: string;
  mode: ExecutionMode;
  status: ExecutionStatus;
  toolResults: ToolExecutionResult[];
  output?: Record<string, unknown>;
  error?: string;
  toolsExecuted: number;
  toolsSucceeded: number;
  toolsFailed: number;
  toolsSkipped: number;
  totalDurationMs: number;
  startedAt: number;
  completedAt: number;
  caller?: {
    type: 'agent' | 'user' | 'system';
    id: string;
    name?: string;
  };
}

export interface SkillExecutionPreview {
  skillId: string;
  skillName: string;
  canExecute: boolean;
  blockers: string[];
  warnings: string[];
  pipeline: {
    orderIndex: number;
    toolId: string;
    toolName: string;
    toolType: string;
    required: boolean;
    role?: string;
    status: 'active' | 'inactive' | 'deprecated' | 'missing';
    estimatedDurationMs?: number;
  }[];
  estimatedTotalDurationMs?: number;
}

export interface SkillValidationResult {
  valid: boolean;
  skillId: string;
  errors: { code: string; message: string; toolId?: string; field?: string }[];
  warnings: { code: string; message: string; toolId?: string; field?: string }[];
  toolsChecked: number;
  toolsWithIssues: number;
}

// =============================================================================
// ORGANIZATION TYPES
// =============================================================================

export type RoleType = 'ceo' | 'manager' | 'supervisor' | 'worker' | 'specialist';

export interface AgentOrgProfile {
  agentId: string;
  roleType: RoleType;
  supervisorAgentId: string | null;
  workProfileId: string;
  department: string | null;
  escalationPolicy: EscalationPolicy | null;
  autonomyPolicy: OrgAutonomyPolicy | null;
  createdAt: number;
  updatedAt: number;
}

export interface EscalationPolicy {
  canEscalate: boolean;
  maxRetriesBeforeEscalate: number;
  escalateOnErrors: string[];
  escalateTimeoutMs: number;
  skipToHumanIfNoSupervisor: boolean;
}

export interface OrgAutonomyPolicy {
  canCreateResources: boolean;
  canDelegate: boolean;
  canSplitTasks: boolean;
  canEscalateToHuman: boolean;
  maxComplexity: number;
  maxPriority: number;
  canApproveSubordinates: boolean;
}

export interface WorkProfile {
  id: string;
  name: string;
  description: string;
  preset: 'conservative' | 'balanced' | 'aggressive' | 'human_first' | 'autonomous_first' | 'custom';
  editable: boolean;
  retry: { maxRetries: number; retryDelayMs: number; backoffMultiplier: number };
  delegation: { aggressiveness: number; preferDelegation: boolean; maxDepth: number };
  splitting: { enabled: boolean; minComplexityToSplit: number; maxSubtasks: number };
  resourceCreation: { autoCreate: boolean; allowedTypes: ('agent' | 'skill' | 'tool')[]; requireApproval: boolean };
  escalation: { triggers: string[]; failureThreshold: number; timeoutThreshold: number; notifyHuman: boolean };
  humanApproval: { priorityThreshold: number; complexityThreshold: number; costThreshold: number };
}

export interface HierarchyNode {
  agentId: string;
  roleType: RoleType;
  subordinates: HierarchyNode[];
}

export interface EffectivePolicies {
  autonomy: OrgAutonomyPolicy;
  escalation: EscalationPolicy;
}

// =============================================================================
// JOB TYPES
// =============================================================================

export type JobStatus = 'pending' | 'running' | 'accepted' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'timeout';

export interface JobBlocked {
  reason: string;
  description: string;
  missing: Array<{
    type: 'tool' | 'skill' | 'capability' | 'permission' | 'data';
    identifier: string;
    reason: string;
    required: boolean;
  }>;
  suggestions: Array<{
    type: 'create_tool' | 'create_skill' | 'request_permission' | 'provide_data' | 'manual_action';
    target: string;
    description: string;
    canAutoGenerate: boolean;
    priority: 'required' | 'recommended' | 'optional';
  }>;
  canAutoResolve: boolean;
  requiresHuman: boolean;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
  suggestedAction?: string;
}

export interface JobResult {
  output?: string;
  actionsSummary?: string;
  toolsUsed?: string[];
}

export interface JobSummary {
  id: string;
  taskId: string;
  agentId: string;
  agentName: string;
  agentRole: RoleType;
  goal: string;
  status: JobStatus;
  sessionId?: string;
  result: JobResult | null;
  error?: JobError;
  blocked?: JobBlocked;
  metrics?: { executionTimeMs: number; toolCalls?: number };
  eventsCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface JobStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  timeout: number;
}

// Simplified job format returned by getJobsByAgent
export interface AgentJobSummary {
  id: string;
  taskId: string;
  goal: string;
  status: JobStatus;
  sessionId?: string;
  createdAt: number;
  completedAt?: number;
}

// =============================================================================
// TASK EXECUTION STATE TYPES
// =============================================================================

/** Outcome of task execution attempt */
export type TaskExecutionOutcome = 'completed_sync' | 'accepted_async' | 'failed';

/** Execution phase for task state tracking */
export type ExecutionPhase =
  | 'pending'
  | 'initializing'
  | 'planning'
  | 'executing'
  | 'waiting_human'
  | 'waiting_resource'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'failed';

/** Step status in task execution */
export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Individual step in task execution */
export interface TaskStep {
  id: string;
  name: string;
  type: 'action' | 'decision' | 'delegation' | 'tool_call' | 'llm_call' | 'human_input' | 'checkpoint';
  status: TaskStepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/** Checkpoint for task state recovery */
export interface TaskCheckpoint {
  id: string;
  taskId: string;
  label: string;
  phase: ExecutionPhase;
  stepIndex: number;
  state: Record<string, unknown>;
  isAutomatic: boolean;
  reason?: string;
  createdAt: number;
}

/** Full task execution state */
export interface TaskExecutionState {
  taskId: string;
  phase: ExecutionPhase;
  currentStepIndex: number;
  steps: TaskStep[];
  context: Record<string, unknown>;
  errors: Array<{ stepId?: string; error: string; timestamp: number; recoverable: boolean }>;
  pausedAt?: number;
  pauseReason?: string;
  checkpoints: TaskCheckpoint[];
  metrics: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    totalDurationMs: number;
    llmCalls: number;
    toolCalls: number;
  };
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** Lightweight snapshot for diagnostics */
export interface TaskStateSnapshot {
  taskId: string;
  phase: ExecutionPhase;
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  isPaused: boolean;
  hasCheckpoints: boolean;
  lastCheckpointAt?: number;
  updatedAt: number;
}

/** Timeline event for task execution history */
export interface TaskTimelineEvent {
  id: string;
  taskId: string;
  type: 'phase_change' | 'step_start' | 'step_complete' | 'step_fail' | 'checkpoint' | 'pause' | 'resume' | 'error' | 'delegation';
  timestamp: number;
  data: {
    phase?: ExecutionPhase;
    stepId?: string;
    stepName?: string;
    checkpointId?: string;
    error?: string;
    fromAgentId?: string;
    toAgentId?: string;
    reason?: string;
  };
}

/** Backend timeline response (contains timeline array + metadata) */
export interface TaskTimelineResponse {
  task_id: string;
  timeline: TaskTimelineEvent[];
  ai_usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
  };
  execution_summary?: {
    outcome?: TaskExecutionOutcome;
    hooks_session?: string;
    execution_time_ms?: number;
  };
}

/** Execution summary returned by diagnostics endpoint */
export interface ExecutionSummary {
  lastJobId?: string;
  lastJobStatus?: JobStatus;
  outcome?: TaskExecutionOutcome;
  result?: JobResult;
  error?: string;
  hooks_session?: string;
  executionTimeMs?: number;
  toolCalls?: number;
}

/** Full task diagnostics */
export interface TaskDiagnostics {
  task: Task;
  execution: ExecutionSummary;
  state?: TaskStateSnapshot;
  timeline: TaskTimelineEvent[];
  delegationChain: Array<{
    agentId: string;
    agentName: string;
    jobId: string;
    status: JobStatus;
    startedAt: number;
    completedAt?: number;
  }>;
  subtasks?: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    agentId?: string;
  }>;
}

// =============================================================================
// BUDGET TYPES
// =============================================================================

/** Budget decision types */
export type BudgetDecision = 'allow' | 'warn' | 'block' | 'degrade';

/** Budget scope for cost tracking */
export type BudgetScope = 'task' | 'agent_daily' | 'global_daily';

/** Budget configuration */
export interface BudgetConfig {
  enabled: boolean;
  limits: {
    perTask: number;
    perAgentDaily: number;
    globalDaily: number;
  };
  thresholds: {
    warnAt: number;      // 0.0-1.0
    blockAt: number;     // 0.0-1.0
    degradeAt: number;   // 0.0-1.0
  };
  degradation: {
    fallbackModel?: string;
    maxTokensReduction?: number;
    disableTools?: boolean;
  };
  resetHour: number; // UTC hour for daily reset (0-23)
}

/** Cost entry for tracking */
export interface BudgetCostEntry {
  id: string;
  scope: BudgetScope;
  scopeId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/** Budget check result */
export interface BudgetCheckResult {
  decision: BudgetDecision;
  scope: BudgetScope;
  currentCost: number;
  limit: number;
  percentUsed: number;
  message?: string;
  degradationConfig?: BudgetConfig['degradation'];
}

/** Cost summary for a scope */
export interface BudgetCostSummary {
  scope: BudgetScope;
  scopeId: string;
  totalCost: number;
  limit: number;
  percentUsed: number;
  entryCount: number;
  breakdown?: {
    byModel: Record<string, number>;
    byHour?: Record<number, number>;
  };
  periodStart: number;
  periodEnd?: number;
}

/** Full budget diagnostics */
export interface BudgetDiagnostics {
  config: BudgetConfig;
  global: BudgetCostSummary;
  agents: BudgetCostSummary[];
  recentTasks: BudgetCostSummary[];
  warnings: Array<{
    scope: BudgetScope;
    scopeId: string;
    message: string;
    percentUsed: number;
    timestamp: number;
  }>;
  blocks: Array<{
    scope: BudgetScope;
    scopeId: string;
    message: string;
    timestamp: number;
  }>;
}

// =============================================================================
// AGENT MATERIALIZATION TYPES
// =============================================================================

/** Agent materialization status */
export type MaterializationStatus =
  | 'not_materialized'
  | 'materializing'
  | 'materialized'
  | 'failed'
  | 'expired';

/** Agent runtime status with materialization info */
export interface AgentRuntimeStatus {
  agentId: string;
  materialization: MaterializationStatus;
  sessionId?: string;
  lastPing?: number;
  uptime?: number;
  memoryUsage?: number;
  activeJobs: number;
  totalJobsProcessed: number;
  errorCount: number;
  lastError?: string;
  capabilities: string[];
  version?: string;
}

/** Extended agent with runtime status */
export interface AgentWithStatus extends Agent {
  runtime?: AgentRuntimeStatus;
}

// =============================================================================
// GENERATION TRACEABILITY TYPES
// =============================================================================

/** Generation traceability for auditing */
export interface GenerationTraceability {
  generationId: string;
  type: GenerationType;
  trigger: {
    source: 'user' | 'agent' | 'system' | 'feedback';
    sourceId?: string;
    feedbackId?: string;
    taskId?: string;
  };
  llmCalls: Array<{
    callId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    timestamp: number;
    duration: number;
  }>;
  validation: {
    attempts: number;
    lastResult?: Record<string, unknown>;
    errors: string[];
  };
  approval?: {
    status: ApprovalStatus;
    approvedBy?: string;
    approvedAt?: number;
    reason?: string;
  };
  deployment?: {
    deployedAt?: number;
    path?: string;
    version?: string;
    rollbackAvailable: boolean;
  };
  totalCost: number;
  createdAt: number;
  updatedAt: number;
}

/** Extended generation with traceability */
export interface GenerationWithTraceability extends Generation {
  traceability?: GenerationTraceability;
}

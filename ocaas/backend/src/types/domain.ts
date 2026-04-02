import { z } from 'zod';

// Agent
export const AgentStatusSchema = z.enum(['active', 'inactive', 'busy', 'error']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentTypeSchema = z.enum(['general', 'specialist', 'orchestrator']);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export interface AgentDTO {
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

// Task
export const TaskStatusSchema = z.enum([
  'pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled'
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.number().min(1).max(4);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/**
 * Delegation record for task assignment history
 */
export interface DelegationRecord {
  fromAgentId: string | null;  // null = initial assignment
  toAgentId: string;
  reason: 'initial' | 'escalation' | 'delegation' | 'reassignment' | 'failure_recovery';
  timestamp: number;
  jobId?: string;  // Job that triggered the delegation
}

export interface TaskDTO {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: TaskStatus;
  priority: TaskPriority;
  agentId?: string;
  parentTaskId?: string;
  // Dependencias y secuenciación
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

// Skill
export const SkillStatusSchema = z.enum(['active', 'inactive', 'deprecated']);
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

/**
 * Skill-Tool link representing a tool associated with a skill
 */
export interface SkillToolLink {
  toolId: string;
  orderIndex: number;
  required: boolean;
  role?: string;
  config?: Record<string, unknown>;
  createdAt: number;
}

/**
 * Skill-Tool link with expanded tool details
 */
export interface SkillToolExpanded extends SkillToolLink {
  tool: ToolDTO;
}

export interface SkillDTO {
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

// Tool
export const ToolTypeSchema = z.enum(['script', 'binary', 'api']);
export type ToolType = z.infer<typeof ToolTypeSchema>;

export const ToolStatusSchema = z.enum(['active', 'inactive', 'deprecated']);
export type ToolStatus = z.infer<typeof ToolStatusSchema>;

export interface ToolDTO {
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

// Permission
export const ResourceTypeSchema = z.enum(['tool', 'skill', 'task_type', 'system']);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const PermissionLevelSchema = z.number().min(0).max(4);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

export interface PermissionDTO {
  id: string;
  agentId: string;
  resourceType: ResourceType;
  resourceId?: string;
  level: PermissionLevel;
  constraints?: Record<string, unknown>;
  expiresAt?: number;
  grantedBy?: string;
  createdAt: number;
  updatedAt: number;
}

// Generation
export const GenerationStatusSchema = z.enum([
  'draft', 'generated', 'pending_approval', 'approved', 'rejected', 'active', 'failed'
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const GenerationTypeSchema = z.enum(['agent', 'skill', 'tool']);
export type GenerationType = z.infer<typeof GenerationTypeSchema>;

export interface GenerationDTO {
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

// Event
export const EventSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

export interface EventDTO {
  id: string;
  type: string;
  category: string;
  severity: EventSeverity;
  message: string;
  resourceType?: string;
  resourceId?: string;
  agentId?: string;
  data?: Record<string, unknown>;
  createdAt: number;
}

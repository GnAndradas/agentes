import type { TaskDTO, AgentDTO } from '../types/domain.js';

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  score: number;
  reason: string;
}

export interface CapabilityMatch {
  agentId: string;
  capabilities: string[];
  matchScore: number;
}

export interface QueuedTask {
  task: TaskDTO;
  addedAt: number;
  attempts: number;
}

export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  taskTimeout: number; // seconds
  retryAttempts: number;
  autoAssign: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrentTasks: 5,
  taskTimeout: 300,
  retryAttempts: 3,
  autoAssign: true,
};

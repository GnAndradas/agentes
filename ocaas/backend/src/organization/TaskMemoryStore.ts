/**
 * Task Memory Store
 *
 * Manages extended task context and memory
 */

import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import type {
  TaskMemory,
  TaskDecision,
  EscalationRecord,
  PolicyDecisionType,
} from './types.js';

const logger = createLogger('TaskMemoryStore');

export class TaskMemoryStore {
  private memories = new Map<string, TaskMemory>();

  /**
   * Get memory for a task
   */
  get(taskId: string): TaskMemory | null {
    return this.memories.get(taskId) ?? null;
  }

  /**
   * Get or create task memory
   */
  getOrCreate(taskId: string): TaskMemory {
    const existing = this.memories.get(taskId);
    if (existing) return existing;

    const now = nowTimestamp();
    const memory: TaskMemory = {
      taskId,
      summary: '',
      decisions: [],
      assignedAgentIds: [],
      createdResources: [],
      escalationHistory: [],
      lastKnownBlockers: [],
      retryHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    this.memories.set(taskId, memory);
    return memory;
  }

  /**
   * Update summary
   */
  updateSummary(taskId: string, summary: string): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.summary = summary;
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Record a decision
   */
  recordDecision(
    taskId: string,
    decision: PolicyDecisionType,
    agentId: string,
    reason: string,
    outcome: 'success' | 'failed' | 'pending' = 'pending'
  ): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.decisions.push({
      timestamp: nowTimestamp(),
      decision,
      agentId,
      reason,
      outcome,
    });
    memory.updatedAt = nowTimestamp();

    logger.debug({
      taskId,
      decision,
      agentId,
      outcome,
    }, 'Decision recorded');

    return memory;
  }

  /**
   * Update last decision outcome
   */
  updateLastDecisionOutcome(
    taskId: string,
    outcome: 'success' | 'failed' | 'pending'
  ): TaskMemory | null {
    const memory = this.memories.get(taskId);
    if (!memory || memory.decisions.length === 0) return null;

    memory.decisions[memory.decisions.length - 1]!.outcome = outcome;
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Record agent assignment
   */
  recordAssignment(taskId: string, agentId: string): TaskMemory {
    const memory = this.getOrCreate(taskId);
    if (!memory.assignedAgentIds.includes(agentId)) {
      memory.assignedAgentIds.push(agentId);
      memory.updatedAt = nowTimestamp();
    }
    return memory;
  }

  /**
   * Record resource creation
   */
  recordResourceCreation(
    taskId: string,
    type: 'agent' | 'skill' | 'tool',
    id: string,
    name: string
  ): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.createdResources.push({ type, id, name });
    memory.updatedAt = nowTimestamp();

    logger.info({
      taskId,
      resourceType: type,
      resourceId: id,
      resourceName: name,
    }, 'Resource creation recorded');

    return memory;
  }

  /**
   * Record escalation
   */
  recordEscalation(
    taskId: string,
    fromAgentId: string,
    toAgentId: string | 'human',
    reason: string
  ): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.escalationHistory.push({
      timestamp: nowTimestamp(),
      fromAgentId,
      toAgentId,
      reason,
      resolved: false,
    });
    memory.updatedAt = nowTimestamp();

    logger.info({
      taskId,
      fromAgentId,
      toAgentId,
      reason,
    }, 'Escalation recorded');

    return memory;
  }

  /**
   * Mark last escalation as resolved
   */
  markEscalationResolved(taskId: string): TaskMemory | null {
    const memory = this.memories.get(taskId);
    if (!memory || memory.escalationHistory.length === 0) return null;

    const lastEscalation = memory.escalationHistory[memory.escalationHistory.length - 1]!;
    lastEscalation.resolved = true;
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Update blockers
   */
  updateBlockers(taskId: string, blockers: string[]): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.lastKnownBlockers = blockers;
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Clear blockers
   */
  clearBlockers(taskId: string): TaskMemory | null {
    const memory = this.memories.get(taskId);
    if (!memory) return null;

    memory.lastKnownBlockers = [];
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Record retry attempt
   */
  recordRetry(taskId: string, attempt: number, error?: string): TaskMemory {
    const memory = this.getOrCreate(taskId);
    memory.retryHistory.push({
      timestamp: nowTimestamp(),
      attempt,
      error,
    });
    memory.updatedAt = nowTimestamp();
    return memory;
  }

  /**
   * Get current escalation level
   */
  getEscalationLevel(taskId: string): number {
    const memory = this.memories.get(taskId);
    if (!memory) return 0;
    return memory.escalationHistory.filter(e => !e.resolved).length;
  }

  /**
   * Get total retry count
   */
  getRetryCount(taskId: string): number {
    const memory = this.memories.get(taskId);
    if (!memory) return 0;
    return memory.retryHistory.length;
  }

  /**
   * Check if task has been escalated to human
   */
  hasEscalatedToHuman(taskId: string): boolean {
    const memory = this.memories.get(taskId);
    if (!memory) return false;
    return memory.escalationHistory.some(e => e.toAgentId === 'human');
  }

  /**
   * Get task history summary
   */
  getHistorySummary(taskId: string): {
    assignmentCount: number;
    decisionCount: number;
    escalationCount: number;
    retryCount: number;
    resourcesCreated: number;
    hasActiveBlockers: boolean;
  } {
    const memory = this.memories.get(taskId);
    if (!memory) {
      return {
        assignmentCount: 0,
        decisionCount: 0,
        escalationCount: 0,
        retryCount: 0,
        resourcesCreated: 0,
        hasActiveBlockers: false,
      };
    }

    return {
      assignmentCount: memory.assignedAgentIds.length,
      decisionCount: memory.decisions.length,
      escalationCount: memory.escalationHistory.length,
      retryCount: memory.retryHistory.length,
      resourcesCreated: memory.createdResources.length,
      hasActiveBlockers: memory.lastKnownBlockers.length > 0,
    };
  }

  /**
   * Delete task memory
   */
  delete(taskId: string): boolean {
    return this.memories.delete(taskId);
  }

  /**
   * Cleanup old memories (tasks completed > X hours ago)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = nowTimestamp() - maxAgeMs;
    let cleaned = 0;

    for (const [taskId, memory] of this.memories) {
      if (memory.updatedAt < cutoff) {
        this.memories.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, maxAgeMs }, 'Task memories cleaned up');
    }

    return cleaned;
  }
}

// Singleton
let storeInstance: TaskMemoryStore | null = null;

export function getTaskMemoryStore(): TaskMemoryStore {
  if (!storeInstance) {
    storeInstance = new TaskMemoryStore();
  }
  return storeInstance;
}

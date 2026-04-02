/**
 * Organization-Aware Decision Engine
 *
 * Wraps the existing DecisionEngine to integrate organizational hierarchy,
 * policies, and delegation logic into the task assignment process.
 *
 * This is the new entry point for task decisions that respects:
 * - Agent hierarchy (CEO → Manager → Supervisor → Worker)
 * - Work profiles (delegation aggressiveness, escalation policies)
 * - Role-based autonomy (who can delegate, split, create resources)
 *
 * BACKWARD COMPATIBLE: Falls back to DecisionEngine when org data is missing.
 */

import { orchestratorLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getDecisionEngine } from './DecisionEngine.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import {
  getOrganizationalPolicyService,
  getAgentHierarchyStore,
  getWorkProfileStore,
  getTaskMemoryStore,
} from '../organization/index.js';
import type { TaskDTO, AgentDTO } from '../types/domain.js';
import type {
  IntelligentDecision,
  TaskAssignment,
  TaskAnalysis,
} from './types.js';
import type {
  PolicyContext,
  PolicyDecision,
  AgentOrgProfile,
  RoleType,
} from '../organization/types.js';

const logger = orchestratorLogger.child({ component: 'OrgAwareDecisionEngine' });

// Decision modes
export type OrgDecisionMode = 'hierarchy_first' | 'capability_first' | 'balanced';

export interface OrgDecisionConfig {
  /** Decision mode */
  mode: OrgDecisionMode;
  /** Minimum score for hierarchical match to override capability */
  hierarchyScoreThreshold: number;
  /** Enable delegation even without explicit hierarchy setup */
  enableImplicitHierarchy: boolean;
  /** Max delegation depth */
  maxDelegationDepth: number;
}

const DEFAULT_CONFIG: OrgDecisionConfig = {
  mode: 'balanced',
  hierarchyScoreThreshold: 60,
  enableImplicitHierarchy: true,
  maxDelegationDepth: 3,
};

export interface OrgAwareDecision extends IntelligentDecision {
  /** Was org hierarchy used in decision */
  usedHierarchy: boolean;
  /** Delegation info if applicable */
  delegation?: {
    fromAgentId: string;
    fromRole: RoleType;
    toAgentId: string;
    toRole: RoleType;
    reason: string;
  };
  /** Escalation info if applicable */
  escalation?: {
    fromAgentId: string;
    toTarget: string | 'human';
    reason: string;
  };
  /** Policy decisions made */
  policyDecisions?: Map<string, PolicyDecision>;
}

export class OrgAwareDecisionEngine {
  private config: OrgDecisionConfig;
  private delegationDepth = new Map<string, number>(); // taskId → depth

  constructor(config: Partial<OrgDecisionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main entry point - make an org-aware decision for a task
   *
   * Flow:
   * 1. Check if task has an "owner" (assigned agent or default CEO)
   * 2. Build policy context
   * 3. Check delegation possibility
   * 4. Check escalation if there are failures
   * 5. Fall back to capability matching if needed
   */
  async decide(task: TaskDTO): Promise<OrgAwareDecision> {
    const hierarchyStore = getAgentHierarchyStore();
    const policyService = getOrganizationalPolicyService();
    const decisionEngine = getDecisionEngine();

    // Track delegation depth to prevent infinite loops
    const currentDepth = this.delegationDepth.get(task.id) || 0;
    if (currentDepth >= this.config.maxDelegationDepth) {
      logger.warn({ taskId: task.id, depth: currentDepth }, 'Max delegation depth reached');
      // Fall back to standard decision
      const baseDecision = await decisionEngine.makeIntelligentDecision(task);
      return { ...baseDecision, usedHierarchy: false };
    }

    // 1. Find task "owner" - who is responsible for this task?
    const owner = await this.findTaskOwner(task);

    if (!owner) {
      // No hierarchy set up - use standard decision
      logger.debug({ taskId: task.id }, 'No hierarchy owner found, using standard decision');
      const baseDecision = await decisionEngine.makeIntelligentDecision(task);
      return { ...baseDecision, usedHierarchy: false };
    }

    // 2. Build policy context for owner
    const context = await policyService.buildContext(task.id, owner.agentId);

    // Enrich context with task analysis
    const baseDecision = await decisionEngine.makeIntelligentDecision(task);
    if (baseDecision.analysis) {
      context.taskAnalysis = {
        complexity: baseDecision.analysis.complexity,
        taskType: baseDecision.analysis.taskType,
        requiredCapabilities: baseDecision.analysis.requiredCapabilities,
      };
    }

    // Check for failure context
    const taskMemory = getTaskMemoryStore().get(task.id);
    if (taskMemory && taskMemory.retryHistory.length > 0) {
      context.failureContext = {
        failureCount: taskMemory.retryHistory.length,
        lastError: taskMemory.retryHistory[taskMemory.retryHistory.length - 1]?.error,
        blockedReason: taskMemory.lastKnownBlockers[0],
      };
    }

    // 3. Get all policy decisions
    const policyDecisions = await policyService.getFullPolicyDecisions(context);

    // 4. Check escalation first (if there are failures)
    const escalateDecision = policyDecisions.get('escalate');
    if (escalateDecision?.allowed && context.failureContext) {
      return this.handleEscalation(task, owner, escalateDecision, baseDecision, policyDecisions);
    }

    // 5. Check delegation
    const delegateDecision = policyDecisions.get('delegate');
    if (delegateDecision?.allowed && delegateDecision.target) {
      return this.handleDelegation(task, owner, delegateDecision, baseDecision, policyDecisions);
    }

    // 6. Check if owner can handle it themselves
    if (baseDecision.assignment) {
      // Standard decision found an agent - check if it respects hierarchy
      const assigneeProfile = hierarchyStore.get(baseDecision.assignment.agentId);
      if (assigneeProfile) {
        // Enrich with hierarchy info
        return {
          ...baseDecision,
          usedHierarchy: true,
          policyDecisions,
        };
      }
    }

    // 7. Try to find suitable subordinate by capabilities
    const subordinateAssignment = await this.findSubordinateByCapability(
      owner,
      task,
      baseDecision.analysis
    );

    if (subordinateAssignment) {
      const subordinateProfile = hierarchyStore.get(subordinateAssignment.agentId);
      return {
        ...baseDecision,
        assignment: subordinateAssignment,
        usedHierarchy: true,
        delegation: {
          fromAgentId: owner.agentId,
          fromRole: owner.roleType,
          toAgentId: subordinateAssignment.agentId,
          toRole: subordinateProfile?.roleType || 'worker',
          reason: subordinateAssignment.reason || 'Capability match in hierarchy',
        },
        policyDecisions,
      };
    }

    // 8. Fall back to standard decision
    return {
      ...baseDecision,
      usedHierarchy: hierarchyStore.list().length > 0,
      policyDecisions,
    };
  }

  /**
   * Find who "owns" this task
   * Priority: assigned agent → parent task owner → CEO → first manager
   */
  private async findTaskOwner(task: TaskDTO): Promise<AgentOrgProfile | null> {
    const hierarchyStore = getAgentHierarchyStore();
    const { agentService, taskService } = getServices();

    // 1. If task has an assigned agent, they're the current owner
    if (task.agentId) {
      const profile = hierarchyStore.get(task.agentId);
      if (profile) return profile;
    }

    // 2. Check parent task owner (for subtasks)
    if (task.parentTaskId) {
      const parentTask = await taskService.getById(task.parentTaskId);
      if (parentTask?.agentId) {
        const profile = hierarchyStore.get(parentTask.agentId);
        if (profile) return profile;
      }
    }

    // 3. Find CEO or top-level manager
    const ceos = hierarchyStore.getCEOs();
    if (ceos.length > 0) {
      return ceos[0]!;
    }

    // 4. Find any manager
    const managers = hierarchyStore.getByRole('manager');
    if (managers.length > 0) {
      return managers[0]!;
    }

    // 5. If implicit hierarchy enabled, use first active agent as owner
    if (this.config.enableImplicitHierarchy) {
      const activeAgents = await agentService.getActive();
      if (activeAgents.length > 0) {
        // Create implicit profile for first agent
        return hierarchyStore.getOrCreate(activeAgents[0]!.id);
      }
    }

    return null;
  }

  /**
   * Handle delegation to subordinate
   */
  private async handleDelegation(
    task: TaskDTO,
    owner: AgentOrgProfile,
    decision: PolicyDecision,
    baseDecision: IntelligentDecision,
    policyDecisions: Map<string, PolicyDecision>
  ): Promise<OrgAwareDecision> {
    const hierarchyStore = getAgentHierarchyStore();
    const policyService = getOrganizationalPolicyService();
    const targetAgentId = decision.target!;
    const targetProfile = hierarchyStore.get(targetAgentId);

    // Track delegation
    this.delegationDepth.set(task.id, (this.delegationDepth.get(task.id) || 0) + 1);

    // Execute delegation (record in memory, emit event)
    const context = await policyService.buildContext(task.id, owner.agentId);
    await policyService.executeDelegation(context, targetAgentId, decision.reason);

    // Build assignment
    const assignment: TaskAssignment = {
      taskId: task.id,
      agentId: targetAgentId,
      score: (decision.metadata?.delegationScore as number) || 80,
      reason: `Delegated from ${owner.roleType} to ${targetProfile?.roleType || 'subordinate'}`,
    };

    logger.info({
      taskId: task.id,
      fromAgent: owner.agentId,
      fromRole: owner.roleType,
      toAgent: targetAgentId,
      toRole: targetProfile?.roleType,
    }, 'Task delegated via hierarchy');

    return {
      ...baseDecision,
      assignment,
      usedHierarchy: true,
      delegation: {
        fromAgentId: owner.agentId,
        fromRole: owner.roleType,
        toAgentId: targetAgentId,
        toRole: targetProfile?.roleType || 'worker',
        reason: decision.reason,
      },
      policyDecisions,
    };
  }

  /**
   * Handle escalation to supervisor or human
   */
  private async handleEscalation(
    task: TaskDTO,
    owner: AgentOrgProfile,
    decision: PolicyDecision,
    baseDecision: IntelligentDecision,
    policyDecisions: Map<string, PolicyDecision>
  ): Promise<OrgAwareDecision> {
    const hierarchyStore = getAgentHierarchyStore();
    const policyService = getOrganizationalPolicyService();
    const target = decision.target!;

    // Execute escalation
    const context = await policyService.buildContext(task.id, owner.agentId);
    await policyService.executeEscalation(context, target, decision.reason);

    logger.info({
      taskId: task.id,
      fromAgent: owner.agentId,
      toTarget: target,
      reason: decision.reason,
    }, 'Task escalated via hierarchy');

    // If escalating to another agent, assign to them
    if (target !== 'human') {
      const targetProfile = hierarchyStore.get(target);
      const assignment: TaskAssignment = {
        taskId: task.id,
        agentId: target,
        score: 70,
        reason: `Escalated from ${owner.roleType} due to: ${decision.reason}`,
      };

      return {
        ...baseDecision,
        assignment,
        usedHierarchy: true,
        escalation: {
          fromAgentId: owner.agentId,
          toTarget: target,
          reason: decision.reason,
        },
        policyDecisions,
      };
    }

    // Escalating to human - no assignment, just record
    return {
      ...baseDecision,
      assignment: null,
      usedHierarchy: true,
      escalation: {
        fromAgentId: owner.agentId,
        toTarget: 'human',
        reason: decision.reason,
      },
      policyDecisions,
    };
  }

  /**
   * Find a subordinate that matches required capabilities
   */
  private async findSubordinateByCapability(
    owner: AgentOrgProfile,
    task: TaskDTO,
    analysis?: TaskAnalysis
  ): Promise<TaskAssignment | null> {
    const hierarchyStore = getAgentHierarchyStore();
    const { agentService } = getServices();

    // Get owner's subordinates
    const subordinates = hierarchyStore.getSubordinates(owner.agentId);
    if (subordinates.length === 0) return null;

    // Get agent details for subordinates
    const subordinateAgents: AgentDTO[] = [];
    for (const sub of subordinates) {
      try {
        const agent = await agentService.getById(sub.agentId);
        if (agent.status === 'active') {
          subordinateAgents.push(agent);
        }
      } catch {
        // Agent might not exist in DB
      }
    }

    if (subordinateAgents.length === 0) return null;

    // Score each subordinate
    const scored: Array<{ agent: AgentDTO; profile: AgentOrgProfile; score: number }> = [];

    for (const agent of subordinateAgents) {
      const profile = subordinates.find(s => s.agentId === agent.id)!;
      const score = this.scoreSubordinate(agent, profile, task, analysis);
      if (score > 0) {
        scored.push({ agent, profile, score });
      }
    }

    if (scored.length === 0) return null;

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;

    return {
      taskId: task.id,
      agentId: best.agent.id,
      score: best.score,
      reason: `Hierarchical match: ${best.profile.roleType} with score ${best.score}`,
    };
  }

  /**
   * Score a subordinate for task assignment
   */
  private scoreSubordinate(
    agent: AgentDTO,
    profile: AgentOrgProfile,
    task: TaskDTO,
    analysis?: TaskAnalysis
  ): number {
    let score = 50; // Base score

    const agentCaps = (agent.capabilities || []).map(c => c.toLowerCase());
    const requiredCaps = analysis?.requiredCapabilities || [task.type.toLowerCase()];

    // Capability match
    for (const reqCap of requiredCaps) {
      const matches = agentCaps.filter(c => c.includes(reqCap) || reqCap.includes(c));
      score += matches.length * 15;
    }

    // Role-based scoring
    const hierarchyStore = getAgentHierarchyStore();
    const autonomy = hierarchyStore.getEffectiveAutonomyPolicy(agent.id);

    // Check if task complexity is within agent's range
    if (analysis) {
      const complexityMap = { low: 3, medium: 6, high: 9 };
      const taskComplexity = complexityMap[analysis.complexity] || 5;

      if (taskComplexity <= autonomy.maxComplexity) {
        score += 20;
      } else {
        score -= 30; // Task too complex for this agent
      }
    }

    // Specialist bonus
    if (agent.type === 'specialist') {
      const taskType = analysis?.taskType || task.type;
      if (agentCaps.some(c => taskType.toLowerCase().includes(c))) {
        score += 25;
      }
    }

    // Status penalty
    if (agent.status === 'busy') {
      score -= 40;
    }

    // Priority handling
    if (task.priority >= 4 && autonomy.maxPriority >= 4) {
      score += 15;
    } else if (task.priority > autonomy.maxPriority) {
      score -= 20;
    }

    return Math.max(0, score);
  }

  /**
   * Manually trigger escalation for a task
   */
  async escalateTask(
    taskId: string,
    currentAgentId: string,
    reason: string
  ): Promise<{ escalated: boolean; target?: string }> {
    const hierarchyStore = getAgentHierarchyStore();
    const policyService = getOrganizationalPolicyService();

    const profile = hierarchyStore.get(currentAgentId);
    if (!profile) {
      return { escalated: false };
    }

    const target = hierarchyStore.getNextEscalationTarget(currentAgentId);
    if (!target) {
      return { escalated: false };
    }

    const context = await policyService.buildContext(taskId, currentAgentId);
    await policyService.executeEscalation(
      context,
      target.type === 'human' ? 'human' : target.agentId!,
      reason
    );

    return {
      escalated: true,
      target: target.type === 'human' ? 'human' : target.agentId,
    };
  }

  /**
   * Clear delegation tracking for a task
   */
  clearTaskTracking(taskId: string): void {
    this.delegationDepth.delete(taskId);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OrgDecisionConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'OrgAwareDecisionEngine config updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): OrgDecisionConfig {
    return { ...this.config };
  }
}

// Singleton
let instance: OrgAwareDecisionEngine | null = null;

export function getOrgAwareDecisionEngine(): OrgAwareDecisionEngine {
  if (!instance) {
    instance = new OrgAwareDecisionEngine();
  }
  return instance;
}

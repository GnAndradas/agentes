/**
 * Organizational Policy Service
 *
 * Central decision-making engine for organizational behavior.
 * ALL policy decisions flow through this service.
 */

import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import { getAgentHierarchyStore } from './AgentHierarchyStore.js';
import { getWorkProfileStore } from './WorkProfileStore.js';
import { getTaskMemoryStore } from './TaskMemoryStore.js';
import { ROLE_HIERARCHY } from './types.js';
import type {
  PolicyContext,
  PolicyDecision,
  PolicyDecisionType,
  RoleType,
  WorkProfile,
  AgentOrgProfile,
  OrgEventPayload,
} from './types.js';

const logger = createLogger('OrganizationalPolicyService');

export class OrganizationalPolicyService {
  // ============================================================================
  // MAIN DECISION METHODS
  // ============================================================================

  /**
   * Should delegate this task to a subordinate?
   */
  async shouldDelegate(context: PolicyContext): Promise<PolicyDecision> {
    const { agentProfile, workProfile, taskAnalysis, autonomyMode } = context;

    // Manual mode: no automatic delegation
    if (autonomyMode === 'manual') {
      return {
        type: 'delegate',
        allowed: false,
        reason: 'Manual autonomy mode - delegation requires human approval',
      };
    }

    // Get effective autonomy policy
    const hierarchyStore = getAgentHierarchyStore();
    const autonomyPolicy = hierarchyStore.getEffectiveAutonomyPolicy(agentProfile.agentId);

    // Check if agent can delegate
    if (!autonomyPolicy.canDelegate) {
      return {
        type: 'delegate',
        allowed: false,
        reason: `Role ${agentProfile.roleType} cannot delegate tasks`,
      };
    }

    // Check delegation aggressiveness
    const delegationThreshold = workProfile.delegation.aggressiveness;
    const shouldPrefer = workProfile.delegation.preferDelegation;

    // Get subordinates
    const subordinates = hierarchyStore.getSubordinates(agentProfile.agentId);
    if (subordinates.length === 0) {
      return {
        type: 'delegate',
        allowed: false,
        reason: 'No subordinates available for delegation',
      };
    }

    // Check complexity - delegate if task is below agent's level
    if (taskAnalysis) {
      const complexityMap = { low: 3, medium: 6, high: 9 };
      const taskComplexity = complexityMap[taskAnalysis.complexity] ?? 5;

      // Delegate if task complexity is significantly below agent's max
      if (taskComplexity < autonomyPolicy.maxComplexity - 2 || shouldPrefer) {
        // Find suitable subordinate
        const suitable = subordinates.find(sub => {
          const subPolicy = hierarchyStore.getEffectiveAutonomyPolicy(sub.agentId);
          return subPolicy.maxComplexity >= taskComplexity;
        });

        if (suitable) {
          return {
            type: 'delegate',
            allowed: true,
            reason: `Task complexity ${taskComplexity} suitable for subordinate`,
            target: suitable.agentId,
            metadata: {
              subordinateRole: suitable.roleType,
              taskComplexity,
              delegationScore: delegationThreshold,
            },
          };
        }
      }
    }

    // Delegate if prefer delegation is enabled and we have subordinates
    if (shouldPrefer && Math.random() < delegationThreshold) {
      const randomSubordinate = subordinates[Math.floor(Math.random() * subordinates.length)]!;
      return {
        type: 'delegate',
        allowed: true,
        reason: 'Delegation preferred by work profile',
        target: randomSubordinate.agentId,
      };
    }

    return {
      type: 'delegate',
      allowed: false,
      reason: 'Task suitable for current agent',
    };
  }

  /**
   * Should split this task into subtasks?
   */
  async shouldSplit(context: PolicyContext): Promise<PolicyDecision> {
    const { agentProfile, workProfile, taskAnalysis, autonomyMode } = context;

    // Manual mode: no automatic splitting
    if (autonomyMode === 'manual') {
      return {
        type: 'split',
        allowed: false,
        reason: 'Manual autonomy mode - task splitting requires human approval',
      };
    }

    // Check if splitting is enabled in profile
    if (!workProfile.splitting.enabled) {
      return {
        type: 'split',
        allowed: false,
        reason: 'Task splitting disabled in work profile',
      };
    }

    // Check autonomy policy
    const hierarchyStore = getAgentHierarchyStore();
    const autonomyPolicy = hierarchyStore.getEffectiveAutonomyPolicy(agentProfile.agentId);

    if (!autonomyPolicy.canSplitTasks) {
      return {
        type: 'split',
        allowed: false,
        reason: `Role ${agentProfile.roleType} cannot split tasks`,
      };
    }

    // Check complexity threshold
    if (taskAnalysis) {
      const complexityMap = { low: 3, medium: 6, high: 9 };
      const taskComplexity = complexityMap[taskAnalysis.complexity] ?? 5;

      if (taskComplexity >= workProfile.splitting.minComplexityToSplit) {
        return {
          type: 'split',
          allowed: true,
          reason: `Task complexity ${taskComplexity} exceeds split threshold ${workProfile.splitting.minComplexityToSplit}`,
          metadata: {
            taskComplexity,
            maxSubtasks: workProfile.splitting.maxSubtasks,
          },
        };
      }
    }

    return {
      type: 'split',
      allowed: false,
      reason: 'Task complexity below split threshold',
    };
  }

  /**
   * Should escalate this task?
   */
  async shouldEscalate(context: PolicyContext): Promise<PolicyDecision> {
    const { agentProfile, workProfile, failureContext, taskId } = context;
    const hierarchyStore = getAgentHierarchyStore();
    const taskMemoryStore = getTaskMemoryStore();

    const escalationPolicy = hierarchyStore.getEffectiveEscalationPolicy(agentProfile.agentId);

    // Check if escalation is allowed
    if (!escalationPolicy.canEscalate) {
      return {
        type: 'escalate',
        allowed: false,
        reason: 'Escalation not allowed by policy',
      };
    }

    // Check triggers
    let shouldEscalate = false;
    let escalationReason = '';

    // Failure count trigger
    if (failureContext) {
      if (
        workProfile.escalation.triggers.includes('failure_count') &&
        failureContext.failureCount >= workProfile.escalation.failureThreshold
      ) {
        shouldEscalate = true;
        escalationReason = `Failure count ${failureContext.failureCount} exceeds threshold ${workProfile.escalation.failureThreshold}`;
      }

      // Blocked trigger
      if (
        workProfile.escalation.triggers.includes('blocked') &&
        failureContext.blockedReason
      ) {
        shouldEscalate = true;
        escalationReason = `Task blocked: ${failureContext.blockedReason}`;
      }
    }

    // Check retry history
    const memory = taskMemoryStore.get(taskId);
    if (memory) {
      const retryCount = memory.retryHistory.length;
      if (retryCount >= escalationPolicy.maxRetriesBeforeEscalate) {
        shouldEscalate = true;
        escalationReason = `Retry count ${retryCount} exceeds escalation threshold`;
      }
    }

    if (!shouldEscalate) {
      return {
        type: 'escalate',
        allowed: false,
        reason: 'No escalation triggers met',
      };
    }

    // Find escalation target
    const target = hierarchyStore.getNextEscalationTarget(agentProfile.agentId);

    if (!target) {
      return {
        type: 'escalate',
        allowed: false,
        reason: 'No escalation target available',
      };
    }

    return {
      type: 'escalate',
      allowed: true,
      reason: escalationReason,
      target: target.type === 'human' ? 'human' : target.agentId,
      metadata: {
        escalationType: target.type,
        fromRole: agentProfile.roleType,
      },
    };
  }

  /**
   * Should create a resource for missing capability?
   */
  async shouldCreateResource(
    context: PolicyContext,
    resourceType: 'agent' | 'skill' | 'tool'
  ): Promise<PolicyDecision> {
    const { agentProfile, workProfile, autonomyMode } = context;

    // Manual mode: never auto-create
    if (autonomyMode === 'manual') {
      return {
        type: 'create_resource',
        allowed: false,
        reason: 'Manual autonomy mode - resource creation requires human action',
      };
    }

    // Check work profile settings
    if (!workProfile.resourceCreation.autoCreate) {
      return {
        type: 'create_resource',
        allowed: false,
        reason: 'Auto resource creation disabled in work profile',
      };
    }

    if (!workProfile.resourceCreation.allowedTypes.includes(resourceType)) {
      return {
        type: 'create_resource',
        allowed: false,
        reason: `Resource type ${resourceType} not allowed in work profile`,
      };
    }

    // Check autonomy policy
    const hierarchyStore = getAgentHierarchyStore();
    const autonomyPolicy = hierarchyStore.getEffectiveAutonomyPolicy(agentProfile.agentId);

    if (!autonomyPolicy.canCreateResources) {
      return {
        type: 'create_resource',
        allowed: false,
        reason: `Role ${agentProfile.roleType} cannot create resources`,
      };
    }

    // Determine if approval is required
    const requiresApproval = workProfile.resourceCreation.requireApproval || autonomyMode === 'supervised';

    return {
      type: 'create_resource',
      allowed: true,
      reason: `Resource creation allowed for ${resourceType}`,
      metadata: {
        resourceType,
        requiresApproval,
        approverRole: requiresApproval ? this.findApproverRole(agentProfile) : null,
      },
    };
  }

  /**
   * Should notify human?
   */
  async shouldNotifyHuman(context: PolicyContext): Promise<PolicyDecision> {
    const { agentProfile, workProfile, failureContext, taskAnalysis, autonomyMode } = context;
    const hierarchyStore = getAgentHierarchyStore();

    // Check autonomy policy
    const autonomyPolicy = hierarchyStore.getEffectiveAutonomyPolicy(agentProfile.agentId);
    if (!autonomyPolicy.canEscalateToHuman) {
      return {
        type: 'notify_human',
        allowed: false,
        reason: 'Human escalation not allowed by policy',
      };
    }

    // Always notify in manual mode on issues
    if (autonomyMode === 'manual' && failureContext) {
      return {
        type: 'notify_human',
        allowed: true,
        reason: 'Manual mode - notifying human of issue',
        metadata: { failureContext },
      };
    }

    // Check if escalation policy says to notify
    if (!workProfile.escalation.notifyHuman) {
      return {
        type: 'notify_human',
        allowed: false,
        reason: 'Human notification disabled in work profile',
      };
    }

    // Check priority threshold
    if (taskAnalysis) {
      // High complexity tasks may need human notification
      const complexityMap = { low: 3, medium: 6, high: 9 };
      const taskComplexity = complexityMap[taskAnalysis.complexity] ?? 5;

      if (taskComplexity >= workProfile.humanApproval.complexityThreshold) {
        return {
          type: 'notify_human',
          allowed: true,
          reason: `Task complexity ${taskComplexity} requires human notification`,
        };
      }
    }

    // Notify on failures if configured
    if (failureContext && workProfile.escalation.triggers.includes('failure_count')) {
      if (failureContext.failureCount >= workProfile.escalation.failureThreshold) {
        return {
          type: 'notify_human',
          allowed: true,
          reason: `Failure threshold exceeded: ${failureContext.failureCount} failures`,
          metadata: { failureContext },
        };
      }
    }

    return {
      type: 'notify_human',
      allowed: false,
      reason: 'No notification triggers met',
    };
  }

  /**
   * Should continue with next task (leave current one pending)?
   */
  async shouldContinueWithNext(context: PolicyContext): Promise<PolicyDecision> {
    const { agentProfile, workProfile, failureContext, taskId } = context;
    const taskMemoryStore = getTaskMemoryStore();

    // If there are blockers, allow continuing with other tasks
    const memory = taskMemoryStore.get(taskId);

    if (failureContext?.blockedReason || (memory && memory.lastKnownBlockers.length > 0)) {
      return {
        type: 'continue',
        allowed: true,
        reason: 'Task blocked - can proceed with other tasks',
        metadata: {
          blockers: failureContext?.blockedReason || memory?.lastKnownBlockers,
        },
      };
    }

    // If waiting for resource creation
    if (failureContext?.missingResource) {
      return {
        type: 'continue',
        allowed: true,
        reason: `Waiting for resource: ${failureContext.missingResource}`,
        metadata: {
          missingResource: failureContext.missingResource,
        },
      };
    }

    return {
      type: 'continue',
      allowed: false,
      reason: 'No reason to skip current task',
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Build policy context from task and agent
   */
  async buildContext(taskId: string, agentId: string): Promise<PolicyContext> {
    const hierarchyStore = getAgentHierarchyStore();
    const workProfileStore = getWorkProfileStore();
    const autonomyConfig = getAutonomyConfig();

    const agentProfile = hierarchyStore.getOrCreate(agentId);
    const workProfile = workProfileStore.get(agentProfile.workProfileId) ||
      workProfileStore.get(workProfileStore.getDefaultProfileId())!;

    return {
      taskId,
      agentId,
      agentProfile,
      workProfile,
      autonomyMode: autonomyConfig.level as 'manual' | 'supervised' | 'autonomous',
    };
  }

  /**
   * Find appropriate approver for resource
   */
  private findApproverRole(agentProfile: AgentOrgProfile): RoleType | 'human' {
    const hierarchyStore = getAgentHierarchyStore();

    // Walk up the chain to find someone who can approve
    const chain = hierarchyStore.getEscalationChain(agentProfile.agentId);

    for (const { agentId, roleType } of chain) {
      const autonomy = hierarchyStore.getEffectiveAutonomyPolicy(agentId);
      if (autonomy.canApproveSubordinates) {
        return roleType;
      }
    }

    return 'human';
  }

  /**
   * Execute escalation
   */
  async executeEscalation(
    context: PolicyContext,
    targetAgentId: string | 'human',
    reason: string
  ): Promise<void> {
    const { eventService } = getServices();
    const taskMemoryStore = getTaskMemoryStore();

    // Record in task memory
    taskMemoryStore.recordEscalation(
      context.taskId,
      context.agentId,
      targetAgentId,
      reason
    );

    // Record decision
    taskMemoryStore.recordDecision(
      context.taskId,
      'escalate',
      context.agentId,
      reason,
      'pending'
    );

    // Emit event
    await this.emitOrgEvent('org.task_escalated', {
      taskId: context.taskId,
      actorAgentId: context.agentId,
      targetAgentId: targetAgentId === 'human' ? undefined : targetAgentId,
      roleType: context.agentProfile.roleType,
      profile: context.workProfile.name,
      autonomyMode: context.autonomyMode,
      reason,
      metadata: {
        escalationTarget: targetAgentId,
      },
    });

    logger.info({
      taskId: context.taskId,
      fromAgent: context.agentId,
      toTarget: targetAgentId,
      reason,
    }, 'Task escalated');
  }

  /**
   * Execute delegation
   */
  async executeDelegation(
    context: PolicyContext,
    targetAgentId: string,
    reason: string
  ): Promise<void> {
    const { eventService } = getServices();
    const taskMemoryStore = getTaskMemoryStore();

    // Record in task memory
    taskMemoryStore.recordDecision(
      context.taskId,
      'delegate',
      context.agentId,
      reason,
      'pending'
    );

    taskMemoryStore.recordAssignment(context.taskId, targetAgentId);

    // Emit event
    await this.emitOrgEvent('org.task_delegated', {
      taskId: context.taskId,
      actorAgentId: context.agentId,
      targetAgentId,
      roleType: context.agentProfile.roleType,
      profile: context.workProfile.name,
      autonomyMode: context.autonomyMode,
      reason,
    });

    logger.info({
      taskId: context.taskId,
      fromAgent: context.agentId,
      toAgent: targetAgentId,
      reason,
    }, 'Task delegated');
  }

  /**
   * Emit organizational event
   */
  private async emitOrgEvent(
    type: string,
    payload: OrgEventPayload
  ): Promise<void> {
    const { eventService } = getServices();

    await eventService.emit({
      type,
      category: 'organization',
      severity: 'info',
      message: `${type}: ${payload.reason}`,
      resourceType: 'task',
      resourceId: payload.taskId,
      agentId: payload.actorAgentId,
      data: payload as unknown as Record<string, unknown>,
    });
  }

  /**
   * Get full decision for a task
   */
  async getFullPolicyDecisions(
    context: PolicyContext
  ): Promise<Map<PolicyDecisionType, PolicyDecision>> {
    const decisions = new Map<PolicyDecisionType, PolicyDecision>();

    const [delegate, split, escalate, notifyHuman, continueNext] = await Promise.all([
      this.shouldDelegate(context),
      this.shouldSplit(context),
      this.shouldEscalate(context),
      this.shouldNotifyHuman(context),
      this.shouldContinueWithNext(context),
    ]);

    decisions.set('delegate', delegate);
    decisions.set('split', split);
    decisions.set('escalate', escalate);
    decisions.set('notify_human', notifyHuman);
    decisions.set('continue', continueNext);

    return decisions;
  }
}

// Singleton
let serviceInstance: OrganizationalPolicyService | null = null;

export function getOrganizationalPolicyService(): OrganizationalPolicyService {
  if (!serviceInstance) {
    serviceInstance = new OrganizationalPolicyService();
  }
  return serviceInstance;
}

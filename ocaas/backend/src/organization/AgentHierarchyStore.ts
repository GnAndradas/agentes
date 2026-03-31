/**
 * Agent Hierarchy Store
 *
 * Manages agent organizational profiles and hierarchy
 */

import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getWorkProfileStore } from './WorkProfileStore.js';
import {
  DEFAULT_AUTONOMY_POLICY,
  DEFAULT_ESCALATION_POLICY,
  ROLE_DEFAULT_AUTONOMY,
  ROLE_HIERARCHY,
} from './types.js';
import type {
  AgentOrgProfile,
  AutonomyPolicy,
  EscalationPolicy,
  RoleType,
} from './types.js';

const logger = createLogger('AgentHierarchyStore');

export class AgentHierarchyStore {
  private profiles = new Map<string, AgentOrgProfile>();

  /**
   * Get org profile for an agent
   */
  get(agentId: string): AgentOrgProfile | null {
    return this.profiles.get(agentId) ?? null;
  }

  /**
   * Get or create profile with defaults
   */
  getOrCreate(agentId: string): AgentOrgProfile {
    const existing = this.profiles.get(agentId);
    if (existing) return existing;

    // Create default worker profile
    return this.create({
      agentId,
      roleType: 'worker',
      supervisorAgentId: null,
      workProfileId: getWorkProfileStore().getDefaultProfileId(),
    });
  }

  /**
   * Create or update agent org profile
   */
  create(input: {
    agentId: string;
    roleType: RoleType;
    supervisorAgentId: string | null;
    workProfileId: string;
    department?: string;
    escalationPolicy?: EscalationPolicy | null;
    autonomyPolicy?: AutonomyPolicy | null;
  }): AgentOrgProfile {
    const now = nowTimestamp();

    // Validate supervisor hierarchy (can't supervise yourself, can't report to subordinate)
    if (input.supervisorAgentId === input.agentId) {
      throw new Error('Agent cannot supervise itself');
    }

    // Check for circular hierarchy
    if (input.supervisorAgentId) {
      this.validateNoCircularHierarchy(input.agentId, input.supervisorAgentId);
    }

    const profile: AgentOrgProfile = {
      agentId: input.agentId,
      roleType: input.roleType,
      supervisorAgentId: input.supervisorAgentId,
      workProfileId: input.workProfileId,
      department: input.department ?? null,
      escalationPolicy: input.escalationPolicy ?? null,
      autonomyPolicy: input.autonomyPolicy ?? null,
      createdAt: this.profiles.get(input.agentId)?.createdAt ?? now,
      updatedAt: now,
    };

    this.profiles.set(input.agentId, profile);
    logger.info({
      agentId: input.agentId,
      roleType: input.roleType,
      supervisorAgentId: input.supervisorAgentId,
    }, 'Agent org profile created/updated');

    return profile;
  }

  /**
   * Update specific fields
   */
  update(
    agentId: string,
    updates: Partial<Omit<AgentOrgProfile, 'agentId' | 'createdAt' | 'updatedAt'>>
  ): AgentOrgProfile | null {
    const existing = this.profiles.get(agentId);
    if (!existing) return null;

    // Validate if changing supervisor
    if (updates.supervisorAgentId !== undefined && updates.supervisorAgentId !== existing.supervisorAgentId) {
      if (updates.supervisorAgentId === agentId) {
        throw new Error('Agent cannot supervise itself');
      }
      if (updates.supervisorAgentId) {
        this.validateNoCircularHierarchy(agentId, updates.supervisorAgentId);
      }
    }

    const updated: AgentOrgProfile = {
      ...existing,
      ...updates,
      updatedAt: nowTimestamp(),
    };

    this.profiles.set(agentId, updated);
    logger.info({ agentId, updates: Object.keys(updates) }, 'Agent org profile updated');
    return updated;
  }

  /**
   * Delete agent profile
   */
  delete(agentId: string): boolean {
    // Check if agent has subordinates
    const subordinates = this.getSubordinates(agentId);
    if (subordinates.length > 0) {
      logger.warn({ agentId, subordinateCount: subordinates.length }, 'Cannot delete agent with subordinates');
      return false;
    }

    const deleted = this.profiles.delete(agentId);
    if (deleted) {
      logger.info({ agentId }, 'Agent org profile deleted');
    }
    return deleted;
  }

  /**
   * List all profiles
   */
  list(): AgentOrgProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get agent's supervisor
   */
  getSupervisor(agentId: string): AgentOrgProfile | null {
    const profile = this.profiles.get(agentId);
    if (!profile?.supervisorAgentId) return null;
    return this.profiles.get(profile.supervisorAgentId) ?? null;
  }

  /**
   * Get all agents supervised by given agent
   */
  getSubordinates(agentId: string): AgentOrgProfile[] {
    return Array.from(this.profiles.values()).filter(
      p => p.supervisorAgentId === agentId
    );
  }

  /**
   * Get escalation chain from agent up to CEO/human
   */
  getEscalationChain(agentId: string): Array<{ agentId: string; roleType: RoleType }> {
    const chain: Array<{ agentId: string; roleType: RoleType }> = [];
    let current = this.profiles.get(agentId);

    while (current?.supervisorAgentId) {
      const supervisor = this.profiles.get(current.supervisorAgentId);
      if (!supervisor) break;
      chain.push({ agentId: supervisor.agentId, roleType: supervisor.roleType });
      current = supervisor;
    }

    return chain;
  }

  /**
   * Get next escalation target
   */
  getNextEscalationTarget(agentId: string): { type: 'agent' | 'human'; agentId?: string } | null {
    const profile = this.profiles.get(agentId);
    if (!profile) return { type: 'human' };

    // Get effective escalation policy
    const policy = this.getEffectiveEscalationPolicy(agentId);

    if (profile.supervisorAgentId) {
      return { type: 'agent', agentId: profile.supervisorAgentId };
    }

    if (policy.skipToHumanIfNoSupervisor) {
      return { type: 'human' };
    }

    return null;
  }

  /**
   * Get agents by role type
   */
  getByRole(roleType: RoleType): AgentOrgProfile[] {
    return Array.from(this.profiles.values()).filter(p => p.roleType === roleType);
  }

  /**
   * Get CEO agents
   */
  getCEOs(): AgentOrgProfile[] {
    return this.getByRole('ceo');
  }

  /**
   * Check if agent can supervise another
   */
  canSupervise(supervisorId: string, subordinateId: string): boolean {
    const supervisor = this.profiles.get(supervisorId);
    const subordinate = this.profiles.get(subordinateId);

    if (!supervisor || !subordinate) return false;

    // Check role hierarchy
    const supervisorRank = ROLE_HIERARCHY[supervisor.roleType];
    const subordinateRank = ROLE_HIERARCHY[subordinate.roleType];

    // Lower rank number = higher in hierarchy
    return supervisorRank < subordinateRank;
  }

  /**
   * Get effective escalation policy (agent override or work profile default)
   */
  getEffectiveEscalationPolicy(agentId: string): EscalationPolicy {
    const profile = this.profiles.get(agentId);
    if (!profile) return DEFAULT_ESCALATION_POLICY;

    if (profile.escalationPolicy) {
      return profile.escalationPolicy;
    }

    // Use work profile defaults
    const workProfile = getWorkProfileStore().get(profile.workProfileId);
    if (workProfile) {
      return {
        // Escalation is always possible (to supervisor/human), notifyHuman controls notification
        canEscalate: true,
        maxRetriesBeforeEscalate: workProfile.escalation.failureThreshold,
        escalateOnErrors: workProfile.escalation.triggers,
        escalateTimeoutMs: workProfile.escalation.timeoutThreshold,
        skipToHumanIfNoSupervisor: true,
      };
    }

    return DEFAULT_ESCALATION_POLICY;
  }

  /**
   * Get effective autonomy policy (agent override + role defaults)
   */
  getEffectiveAutonomyPolicy(agentId: string): AutonomyPolicy {
    const profile = this.profiles.get(agentId);
    if (!profile) return DEFAULT_AUTONOMY_POLICY;

    const roleDefaults = ROLE_DEFAULT_AUTONOMY[profile.roleType] || {};

    if (profile.autonomyPolicy) {
      return {
        ...DEFAULT_AUTONOMY_POLICY,
        ...roleDefaults,
        ...profile.autonomyPolicy,
      };
    }

    return {
      ...DEFAULT_AUTONOMY_POLICY,
      ...roleDefaults,
    };
  }

  /**
   * Validate no circular hierarchy
   */
  private validateNoCircularHierarchy(agentId: string, newSupervisorId: string): void {
    let current: string | null = newSupervisorId;
    const visited = new Set<string>([agentId]);

    while (current) {
      if (visited.has(current)) {
        throw new Error('Circular hierarchy detected');
      }
      visited.add(current);
      const profile = this.profiles.get(current);
      current = profile?.supervisorAgentId ?? null;
    }
  }

  /**
   * Get hierarchy tree starting from a node
   */
  getHierarchyTree(rootAgentId?: string): HierarchyNode[] {
    const buildTree = (agentId: string): HierarchyNode => {
      const profile = this.profiles.get(agentId);
      if (!profile) {
        return { agentId, roleType: 'worker', subordinates: [] };
      }

      const subordinates = this.getSubordinates(agentId);
      return {
        agentId: profile.agentId,
        roleType: profile.roleType,
        subordinates: subordinates.map(s => buildTree(s.agentId)),
      };
    };

    if (rootAgentId) {
      return [buildTree(rootAgentId)];
    }

    // Get all root agents (no supervisor)
    const roots = Array.from(this.profiles.values()).filter(p => !p.supervisorAgentId);
    return roots.map(r => buildTree(r.agentId));
  }
}

export interface HierarchyNode {
  agentId: string;
  roleType: RoleType;
  subordinates: HierarchyNode[];
}

// Singleton
let storeInstance: AgentHierarchyStore | null = null;

export function getAgentHierarchyStore(): AgentHierarchyStore {
  if (!storeInstance) {
    storeInstance = new AgentHierarchyStore();
  }
  return storeInstance;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getWorkProfileStore,
  getAgentHierarchyStore,
  getTaskMemoryStore,
  getOrganizationalPolicyService,
  ROLE_HIERARCHY,
  type RoleType,
  type PolicyContext,
} from '../src/organization/index.js';

// Mock services
vi.mock('../src/services/index.js', () => ({
  getServices: vi.fn(() => ({
    eventService: {
      emit: vi.fn(),
    },
  })),
}));

vi.mock('../src/config/autonomy.js', () => ({
  getAutonomyConfig: vi.fn(() => ({
    level: 'supervised',
  })),
}));

describe('Organization Module', () => {
  describe('WorkProfileStore', () => {
    beforeEach(() => {
      // Get fresh store (singleton is reused but profiles reset)
    });

    it('should list preset profiles', () => {
      const store = getWorkProfileStore();
      const profiles = store.getPresets();

      expect(profiles.length).toBeGreaterThan(0);
      expect(profiles.map(p => p.preset)).toContain('conservative');
      expect(profiles.map(p => p.preset)).toContain('balanced');
      expect(profiles.map(p => p.preset)).toContain('aggressive');
      expect(profiles.map(p => p.preset)).toContain('human_first');
      expect(profiles.map(p => p.preset)).toContain('autonomous_first');
    });

    it('should get profile by ID', () => {
      const store = getWorkProfileStore();
      const profile = store.get('balanced');

      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('Balanced');
      expect(profile?.editable).toBe(false);
    });

    it('should create custom profile', () => {
      const store = getWorkProfileStore();
      const customProfile = store.create({
        name: 'My Custom Profile',
        description: 'Test custom profile',
        preset: 'custom',
        retry: { maxRetries: 5, retryDelayMs: 10000, backoffMultiplier: 1.5 },
        delegation: { aggressiveness: 0.7, preferDelegation: true, maxDepth: 4 },
        splitting: { enabled: true, minComplexityToSplit: 5, maxSubtasks: 8 },
        resourceCreation: { autoCreate: true, allowedTypes: ['skill'], requireApproval: true },
        escalation: {
          triggers: ['failure_count', 'blocked'],
          failureThreshold: 4,
          timeoutThreshold: 400000,
          notifyHuman: true,
        },
        humanApproval: {
          priorityThreshold: 3,
          complexityThreshold: 6,
          requiredForTypes: ['security'],
        },
      });

      expect(customProfile.id).toMatch(/^custom_/);
      expect(customProfile.editable).toBe(true);
      expect(customProfile.name).toBe('My Custom Profile');

      // Verify it can be retrieved
      const retrieved = store.get(customProfile.id);
      expect(retrieved).toEqual(customProfile);
    });

    it('should not allow updating preset profiles', () => {
      const store = getWorkProfileStore();
      const result = store.update('balanced', { name: 'Changed Name' });

      expect(result).toBeNull();
    });

    it('should not allow deleting preset profiles', () => {
      const store = getWorkProfileStore();
      const result = store.delete('balanced');

      expect(result).toBe(false);
    });

    it('should clone profile', () => {
      const store = getWorkProfileStore();
      const cloned = store.clone('aggressive', 'My Aggressive Clone');

      expect(cloned).not.toBeNull();
      expect(cloned?.name).toBe('My Aggressive Clone');
      expect(cloned?.delegation.aggressiveness).toBe(0.8); // Same as aggressive
      expect(cloned?.editable).toBe(true);
    });
  });

  describe('AgentHierarchyStore', () => {
    let store: ReturnType<typeof getAgentHierarchyStore>;

    beforeEach(() => {
      store = getAgentHierarchyStore();
      // Clean up any existing profiles from previous tests
      for (const profile of store.list()) {
        try {
          store.delete(profile.agentId);
        } catch {
          // Ignore errors from deleting profiles with subordinates
        }
      }
    });

    it('should create agent org profile', () => {
      const profile = store.create({
        agentId: 'agent-1',
        roleType: 'worker',
        supervisorAgentId: null,
        workProfileId: 'balanced',
      });

      expect(profile.agentId).toBe('agent-1');
      expect(profile.roleType).toBe('worker');
      expect(profile.workProfileId).toBe('balanced');
    });

    it('should establish supervisor hierarchy', () => {
      // Create CEO
      store.create({
        agentId: 'ceo-1',
        roleType: 'ceo',
        supervisorAgentId: null,
        workProfileId: 'aggressive',
      });

      // Create manager reporting to CEO
      store.create({
        agentId: 'manager-1',
        roleType: 'manager',
        supervisorAgentId: 'ceo-1',
        workProfileId: 'balanced',
      });

      // Create worker reporting to manager
      store.create({
        agentId: 'worker-1',
        roleType: 'worker',
        supervisorAgentId: 'manager-1',
        workProfileId: 'conservative',
      });

      // Verify relationships
      const managerSupervisor = store.getSupervisor('manager-1');
      expect(managerSupervisor?.agentId).toBe('ceo-1');

      const workerSupervisor = store.getSupervisor('worker-1');
      expect(workerSupervisor?.agentId).toBe('manager-1');

      const ceoSubordinates = store.getSubordinates('ceo-1');
      expect(ceoSubordinates.map(s => s.agentId)).toContain('manager-1');

      const managerSubordinates = store.getSubordinates('manager-1');
      expect(managerSubordinates.map(s => s.agentId)).toContain('worker-1');
    });

    it('should get escalation chain', () => {
      // Setup hierarchy: worker -> supervisor -> manager -> ceo
      store.create({ agentId: 'ceo-2', roleType: 'ceo', supervisorAgentId: null, workProfileId: 'balanced' });
      store.create({ agentId: 'manager-2', roleType: 'manager', supervisorAgentId: 'ceo-2', workProfileId: 'balanced' });
      store.create({ agentId: 'supervisor-2', roleType: 'supervisor', supervisorAgentId: 'manager-2', workProfileId: 'balanced' });
      store.create({ agentId: 'worker-2', roleType: 'worker', supervisorAgentId: 'supervisor-2', workProfileId: 'balanced' });

      const chain = store.getEscalationChain('worker-2');

      expect(chain.length).toBe(3);
      expect(chain[0]?.agentId).toBe('supervisor-2');
      expect(chain[1]?.agentId).toBe('manager-2');
      expect(chain[2]?.agentId).toBe('ceo-2');
    });

    it('should prevent circular hierarchy', () => {
      store.create({ agentId: 'agent-a', roleType: 'manager', supervisorAgentId: null, workProfileId: 'balanced' });
      store.create({ agentId: 'agent-b', roleType: 'supervisor', supervisorAgentId: 'agent-a', workProfileId: 'balanced' });

      // Try to make agent-a report to agent-b (circular)
      expect(() => {
        store.update('agent-a', { supervisorAgentId: 'agent-b' });
      }).toThrow('Circular hierarchy');
    });

    it('should prevent self-supervision', () => {
      expect(() => {
        store.create({
          agentId: 'self-supervisor',
          roleType: 'worker',
          supervisorAgentId: 'self-supervisor',
          workProfileId: 'balanced',
        });
      }).toThrow('Agent cannot supervise itself');
    });

    it('should get effective autonomy policy by role', () => {
      store.create({ agentId: 'test-ceo', roleType: 'ceo', supervisorAgentId: null, workProfileId: 'balanced' });
      store.create({ agentId: 'test-worker', roleType: 'worker', supervisorAgentId: null, workProfileId: 'balanced' });

      const ceoPolicy = store.getEffectiveAutonomyPolicy('test-ceo');
      const workerPolicy = store.getEffectiveAutonomyPolicy('test-worker');

      // CEO should have more permissions
      expect(ceoPolicy.canCreateResources).toBe(true);
      expect(ceoPolicy.canDelegate).toBe(true);
      expect(ceoPolicy.maxComplexity).toBe(10);

      // Worker should have limited permissions
      expect(workerPolicy.canCreateResources).toBe(false);
      expect(workerPolicy.canDelegate).toBe(false);
      expect(workerPolicy.maxComplexity).toBe(4);
    });

    it('should get next escalation target', () => {
      store.create({ agentId: 'esc-ceo', roleType: 'ceo', supervisorAgentId: null, workProfileId: 'balanced' });
      store.create({ agentId: 'esc-worker', roleType: 'worker', supervisorAgentId: 'esc-ceo', workProfileId: 'balanced' });

      const workerTarget = store.getNextEscalationTarget('esc-worker');
      expect(workerTarget?.type).toBe('agent');
      expect(workerTarget?.agentId).toBe('esc-ceo');

      const ceoTarget = store.getNextEscalationTarget('esc-ceo');
      expect(ceoTarget?.type).toBe('human');
    });
  });

  describe('TaskMemoryStore', () => {
    let store: ReturnType<typeof getTaskMemoryStore>;

    beforeEach(() => {
      store = getTaskMemoryStore();
      store.delete('test-task-1');
    });

    it('should create task memory', () => {
      const memory = store.getOrCreate('test-task-1');

      expect(memory.taskId).toBe('test-task-1');
      expect(memory.decisions).toEqual([]);
      expect(memory.escalationHistory).toEqual([]);
    });

    it('should record decisions', () => {
      store.recordDecision('test-task-1', 'delegate', 'agent-1', 'Task too complex', 'pending');
      store.recordDecision('test-task-1', 'escalate', 'agent-2', 'Agent blocked', 'success');

      const memory = store.get('test-task-1');
      expect(memory?.decisions.length).toBe(2);
      expect(memory?.decisions[0]?.decision).toBe('delegate');
      expect(memory?.decisions[1]?.outcome).toBe('success');
    });

    it('should record escalations', () => {
      store.recordEscalation('test-task-1', 'worker-1', 'supervisor-1', 'Task failed');
      store.recordEscalation('test-task-1', 'supervisor-1', 'human', 'Needs approval');

      const memory = store.get('test-task-1');
      expect(memory?.escalationHistory.length).toBe(2);
      expect(memory?.escalationHistory[1]?.toAgentId).toBe('human');
    });

    it('should track blockers', () => {
      store.updateBlockers('test-task-1', ['missing-skill', 'waiting-approval']);

      const memory = store.get('test-task-1');
      expect(memory?.lastKnownBlockers).toContain('missing-skill');

      store.clearBlockers('test-task-1');
      const cleared = store.get('test-task-1');
      expect(cleared?.lastKnownBlockers.length).toBe(0);
    });

    it('should record resource creation', () => {
      store.recordResourceCreation('test-task-1', 'skill', 'skill-1', 'coding-skill');

      const memory = store.get('test-task-1');
      expect(memory?.createdResources.length).toBe(1);
      expect(memory?.createdResources[0]?.type).toBe('skill');
    });

    it('should track escalation level', () => {
      store.recordEscalation('test-task-1', 'agent-1', 'agent-2', 'First escalation');
      store.recordEscalation('test-task-1', 'agent-2', 'agent-3', 'Second escalation');

      expect(store.getEscalationLevel('test-task-1')).toBe(2);

      store.markEscalationResolved('test-task-1');
      expect(store.getEscalationLevel('test-task-1')).toBe(1);
    });

    it('should check if escalated to human', () => {
      expect(store.hasEscalatedToHuman('test-task-1')).toBe(false);

      store.recordEscalation('test-task-1', 'agent-1', 'human', 'Need human');
      expect(store.hasEscalatedToHuman('test-task-1')).toBe(true);
    });
  });

  describe('OrganizationalPolicyService', () => {
    let policyService: ReturnType<typeof getOrganizationalPolicyService>;
    let hierarchyStore: ReturnType<typeof getAgentHierarchyStore>;
    let workProfileStore: ReturnType<typeof getWorkProfileStore>;

    beforeEach(() => {
      policyService = getOrganizationalPolicyService();
      hierarchyStore = getAgentHierarchyStore();
      workProfileStore = getWorkProfileStore();

      // Setup test hierarchy
      try {
        hierarchyStore.delete('policy-ceo');
        hierarchyStore.delete('policy-manager');
        hierarchyStore.delete('policy-worker');
      } catch {
        // Ignore
      }

      hierarchyStore.create({
        agentId: 'policy-ceo',
        roleType: 'ceo',
        supervisorAgentId: null,
        workProfileId: 'aggressive',
      });

      hierarchyStore.create({
        agentId: 'policy-manager',
        roleType: 'manager',
        supervisorAgentId: 'policy-ceo',
        workProfileId: 'balanced',
      });

      hierarchyStore.create({
        agentId: 'policy-worker',
        roleType: 'worker',
        supervisorAgentId: 'policy-manager',
        workProfileId: 'conservative',
      });
    });

    const buildMockContext = (agentId: string, overrides: Partial<PolicyContext> = {}): PolicyContext => {
      const agentProfile = hierarchyStore.getOrCreate(agentId);
      const workProfile = workProfileStore.get(agentProfile.workProfileId)!;

      return {
        taskId: 'test-task',
        agentId,
        agentProfile,
        workProfile,
        autonomyMode: 'supervised',
        ...overrides,
      };
    };

    it('should allow delegation for manager role', async () => {
      const context = buildMockContext('policy-manager', {
        taskAnalysis: {
          complexity: 'low',
          taskType: 'coding',
          requiredCapabilities: ['typescript'],
        },
      });

      const decision = await policyService.shouldDelegate(context);

      expect(decision.type).toBe('delegate');
      expect(decision.allowed).toBe(true);
      expect(decision.target).toBe('policy-worker');
    });

    it('should not allow delegation for worker role', async () => {
      const context = buildMockContext('policy-worker');
      const decision = await policyService.shouldDelegate(context);

      expect(decision.type).toBe('delegate');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('cannot delegate');
    });

    it('should allow escalation on failure threshold', async () => {
      const context = buildMockContext('policy-worker', {
        failureContext: {
          failureCount: 5,
          lastError: 'Task failed',
        },
      });

      const decision = await policyService.shouldEscalate(context);

      expect(decision.type).toBe('escalate');
      expect(decision.allowed).toBe(true);
      expect(decision.target).toBe('policy-manager');
    });

    it('should escalate to human from CEO', async () => {
      // CEO uses 'aggressive' profile with failureThreshold=5
      // Need to exceed that threshold
      const context = buildMockContext('policy-ceo', {
        failureContext: {
          failureCount: 6,
          lastError: 'Cannot resolve',
        },
      });

      const decision = await policyService.shouldEscalate(context);

      expect(decision.type).toBe('escalate');
      expect(decision.allowed).toBe(true);
      expect(decision.target).toBe('human');
    });

    it('should allow task split for manager with high complexity', async () => {
      const context = buildMockContext('policy-manager', {
        taskAnalysis: {
          complexity: 'high',
          taskType: 'project',
          requiredCapabilities: [],
        },
      });

      const decision = await policyService.shouldSplit(context);

      expect(decision.type).toBe('split');
      expect(decision.allowed).toBe(true);
    });

    it('should not allow task split for worker', async () => {
      const context = buildMockContext('policy-worker', {
        taskAnalysis: {
          complexity: 'high',
          taskType: 'project',
          requiredCapabilities: [],
        },
      });

      const decision = await policyService.shouldSplit(context);

      expect(decision.type).toBe('split');
      expect(decision.allowed).toBe(false);
    });

    it('should allow resource creation for CEO', async () => {
      const context = buildMockContext('policy-ceo');
      const decision = await policyService.shouldCreateResource(context, 'skill');

      expect(decision.type).toBe('create_resource');
      expect(decision.allowed).toBe(true);
    });

    it('should not allow resource creation for worker', async () => {
      const context = buildMockContext('policy-worker');
      const decision = await policyService.shouldCreateResource(context, 'skill');

      expect(decision.type).toBe('create_resource');
      expect(decision.allowed).toBe(false);
    });

    it('should allow continuing with next task when blocked', async () => {
      const context = buildMockContext('policy-worker', {
        failureContext: {
          failureCount: 1,
          lastError: 'Missing resource',
          blockedReason: 'Waiting for skill creation',
        },
      });

      const decision = await policyService.shouldContinueWithNext(context);

      expect(decision.type).toBe('continue');
      expect(decision.allowed).toBe(true);
    });

    it('should not allow delegation in manual autonomy mode', async () => {
      const context = buildMockContext('policy-manager', {
        autonomyMode: 'manual',
      });

      const decision = await policyService.shouldDelegate(context);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Manual');
    });

    it('should notify human on high failure count', async () => {
      const context = buildMockContext('policy-worker', {
        failureContext: {
          failureCount: 5,
          lastError: 'Multiple failures',
        },
      });

      const decision = await policyService.shouldNotifyHuman(context);

      expect(decision.type).toBe('notify_human');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('Role Hierarchy', () => {
    it('should have correct hierarchy order', () => {
      // Lower number = higher in hierarchy
      expect(ROLE_HIERARCHY.ceo).toBeLessThan(ROLE_HIERARCHY.manager);
      expect(ROLE_HIERARCHY.manager).toBeLessThan(ROLE_HIERARCHY.supervisor);
      expect(ROLE_HIERARCHY.supervisor).toBeLessThan(ROLE_HIERARCHY.worker);
    });

    it('should place specialist between supervisor and worker', () => {
      expect(ROLE_HIERARCHY.specialist).toBeGreaterThan(ROLE_HIERARCHY.supervisor);
      expect(ROLE_HIERARCHY.specialist).toBeLessThan(ROLE_HIERARCHY.worker);
    });
  });
});

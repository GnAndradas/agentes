import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock functions outside modules
const mockEventEmit = vi.fn().mockResolvedValue({});
const mockTaskGetById = vi.fn();
const mockDraftGetBySlug = vi.fn();
const mockDraftGetById = vi.fn();
const mockDraftCreate = vi.fn();
const mockDraftSubmit = vi.fn();
const mockDraftApprove = vi.fn();
const mockDraftActivate = vi.fn();
const mockDraftList = vi.fn().mockResolvedValue([]);

// Mock db before imports
vi.mock('../src/db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  },
  schema: {
    resourceDrafts: {
      id: 'id',
      resourceType: 'resource_type',
      name: 'name',
      slug: 'slug',
      status: 'status',
    },
  },
}));

// Mock services module
vi.mock('../src/services/index.js', () => ({
  getServices: () => ({
    eventService: {
      emit: mockEventEmit,
    },
    taskService: {
      getById: mockTaskGetById,
    },
    manualResourceService: {
      getBySlug: mockDraftGetBySlug,
      getById: mockDraftGetById,
      createDraft: mockDraftCreate,
      submitForApproval: mockDraftSubmit,
      approve: mockDraftApprove,
      activate: mockDraftActivate,
      list: mockDraftList,
    },
  }),
}));

// Mock autonomy with a function that returns different values
let mockAutonomyLevel = 'supervised';
vi.mock('../src/config/autonomy.js', () => ({
  getAutonomyConfig: () => ({
    level: mockAutonomyLevel,
    canCreateAgents: true,
    canGenerateSkills: true,
    canGenerateTools: true,
    requireApprovalFor: {
      taskExecution: mockAutonomyLevel === 'manual' ? 'all' : 'high_priority',
      agentCreation: mockAutonomyLevel !== 'autonomous',
      skillGeneration: mockAutonomyLevel !== 'autonomous',
      toolGeneration: mockAutonomyLevel !== 'autonomous',
    },
    humanTimeout: 300000,
    fallbackBehavior: mockAutonomyLevel === 'autonomous' ? 'auto_approve' : 'pause',
    sequentialExecution: mockAutonomyLevel !== 'autonomous',
  }),
}));

import { ResourceRetryService } from '../src/orchestrator/ResourceRetryService.js';
import type { MissingCapabilityReport, CapabilitySuggestion } from '../src/orchestrator/types.js';

function createMissingReport(suggestions: Partial<CapabilitySuggestion>[]): MissingCapabilityReport {
  return {
    taskId: 'task-1',
    createdAt: Date.now(),
    missingCapabilities: suggestions.map(s => s.name || 'capability'),
    suggestions: suggestions.map(s => ({
      type: s.type || 'skill',
      name: s.name || 'test-skill',
      description: s.description || 'Test skill',
      reason: s.reason || 'Missing capability',
      canAutoGenerate: s.canAutoGenerate ?? true,
      priority: s.priority || 'required',
    })),
    requiresApproval: true,
  };
}

function setupDefaultMocks() {
  mockDraftGetBySlug.mockResolvedValue(null);
  mockTaskGetById.mockResolvedValue({
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    status: 'queued',
    input: {},
  });
  mockDraftSubmit.mockResolvedValue({ id: 'draft-1', status: 'pending_approval' });
  mockDraftApprove.mockResolvedValue({ id: 'draft-1', status: 'approved' });
  mockDraftActivate.mockResolvedValue({ id: 'draft-1', status: 'active', activeResourceId: 'skill-1' });
}

describe('ResourceRetryService Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAutonomyLevel = 'supervised';
    setupDefaultMocks();
  });

  describe('Anti-loops (FASE 1)', () => {
    it('should NOT create more resources after MAX_RETRIES (3) exceeded', async () => {
      const service = new ResourceRetryService();
      const taskId = 'task-loop-test';

      // First 3 attempts for SAME task should increment retryCount
      for (let i = 0; i < 3; i++) {
        const report = createMissingReport([{ type: 'skill', name: `loop-skill-${i}` }]);
        mockDraftCreate.mockResolvedValueOnce({
          id: `draft-${i}`,
          resourceType: 'skill',
          name: `loop-skill-${i}`,
          slug: `loop-skill-${i}`,
          status: 'draft',
        });

        await service.handleMissingResource(taskId, report);
      }

      // 4th attempt for same task should be blocked
      mockDraftCreate.mockClear();
      mockEventEmit.mockClear();
      const report4 = createMissingReport([{ type: 'skill', name: 'loop-skill-4' }]);
      const result = await service.handleMissingResource(taskId, report4);

      expect(result.draftIds).toHaveLength(0);
      expect(result.requiresHuman).toBe(true);
      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.retry_exhausted',
        })
      );
    });

    it('should NOT create duplicate resource with same slug (DB check)', async () => {
      const service = new ResourceRetryService();
      const report = createMissingReport([{ type: 'skill', name: 'duplicate-skill' }]);

      // First call creates the draft
      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-dup-1',
        resourceType: 'skill',
        name: 'duplicate-skill',
        slug: 'duplicate-skill',
        status: 'draft',
      });

      await service.handleMissingResource('task-1', report);
      expect(mockDraftCreate).toHaveBeenCalledTimes(1);

      // Second call - DB returns existing draft
      mockDraftCreate.mockClear();
      mockDraftGetBySlug.mockResolvedValueOnce({
        id: 'draft-dup-1',
        resourceType: 'skill',
        name: 'duplicate-skill',
        status: 'pending_approval',
      });

      const result2 = await service.handleMissingResource('task-2', report);

      // Should NOT create a new draft (reuses existing)
      expect(mockDraftCreate).not.toHaveBeenCalled();
      expect(result2.draftIds).toContain('draft-dup-1');
    });

    it('should deduplicate by resourceKey hash (in-memory)', async () => {
      const service = new ResourceRetryService();

      // Ensure mocks are reset for this test
      mockDraftGetBySlug.mockReset();
      mockDraftCreate.mockReset();
      mockDraftGetBySlug.mockResolvedValue(null);
      mockDraftCreate.mockResolvedValue({
        id: 'draft-same',
        resourceType: 'skill',
        name: 'same-skill',
        slug: 'same-skill',
        status: 'draft',
      });

      const report1 = createMissingReport([{
        type: 'skill',
        name: 'same-skill',
        reason: 'same reason'
      }]);

      await service.handleMissingResource('task-1', report1);
      const createCalls1 = mockDraftCreate.mock.calls.length;
      expect(createCalls1).toBe(1);

      // Second call with same key should skip creation (resourceKey cached)
      const report2 = createMissingReport([{
        type: 'skill',
        name: 'same-skill',
        reason: 'same reason'
      }]);

      await service.handleMissingResource('task-2', report2);

      // Should not create because resourceKey already tracked in memory
      const createCalls2 = mockDraftCreate.mock.calls.length;
      expect(createCalls2).toBe(1); // Still 1, no new calls
    });
  });

  describe('Locking (FASE 3)', () => {
    it('should prevent concurrent handleMissingResource for same task', async () => {
      const service = new ResourceRetryService();
      const report = createMissingReport([{ type: 'skill', name: 'concurrent-skill' }]);

      // Simulate slow create
      let createResolve: () => void;
      const createPromise = new Promise<void>(r => { createResolve = r; });

      mockDraftCreate.mockImplementationOnce(async () => {
        await createPromise;
        return {
          id: 'draft-slow',
          resourceType: 'skill',
          name: 'concurrent-skill',
          slug: 'concurrent-skill',
          status: 'draft',
        };
      });

      // Start first call (will be slow)
      const call1 = service.handleMissingResource('task-concurrent', report);

      // Start second call immediately (should be blocked by lock)
      const call2 = service.handleMissingResource('task-concurrent', report);

      // Second call should return empty (locked)
      const result2 = await call2;
      expect(result2.draftIds).toHaveLength(0);

      // Now resolve first call
      createResolve!();
      const result1 = await call1;
      expect(result1.draftIds.length).toBeGreaterThan(0);
    });

    it('should prevent double retry execution for same task+draft', async () => {
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-double',
        resourceType: 'skill',
        name: 'double-retry-skill',
        slug: 'double-retry-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'double-retry-skill' }]);
      await service.handleMissingResource('task-double', report);

      // First retry should work
      const result1 = await service.onResourceActivated('draft-double');
      expect(result1).toContain('task-double');

      // Second retry for same task+draft should not retry again
      // (would need to re-register the pending, but it was deleted on first activation)
      const result2 = await service.onResourceActivated('draft-double');
      expect(result2).toHaveLength(0);
    });
  });

  describe('Task Visibility (FASE 4)', () => {
    it('should track retryCount, lastRetryAt, pendingResources', async () => {
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-visible',
        resourceType: 'skill',
        name: 'visibility-skill',
        slug: 'visibility-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'visibility-skill' }]);
      await service.handleMissingResource('task-visible', report);

      const info = service.getTaskRetryInfo('task-visible');

      expect(info.retryCount).toBe(1);
      expect(info.lastRetryAt).toBeDefined();
      expect(info.pendingResources).toContain('draft-visible');
      expect(info.lastFailureReason).toBeUndefined();
    });

    it('should track lastFailureReason on error', async () => {
      const service = new ResourceRetryService();
      mockDraftCreate.mockRejectedValueOnce(new Error('DB connection failed'));

      const report = createMissingReport([{ type: 'skill', name: 'fail-skill' }]);
      await service.handleMissingResource('task-fail', report);

      const info = service.getTaskRetryInfo('task-fail');
      expect(info.lastFailureReason).toBeDefined();
      expect(info.lastFailureReason).toContain('DB connection failed');
    });
  });

  describe('Telemetry (FASE 5)', () => {
    it('should emit full payload with autonomyMode and retryCount', async () => {
      mockAutonomyLevel = 'autonomous';
      const service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'skill', name: 'telemetry-skill' }]);
      await service.handleMissingResource('task-telemetry', report);

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.missing_resource',
          data: expect.objectContaining({
            autonomyMode: 'autonomous',
            retryCount: 0,
          }),
        })
      );
    });

    it('should emit TASK_RETRYING with full context', async () => {
      mockAutonomyLevel = 'supervised';
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-retrying',
        resourceType: 'skill',
        name: 'retrying-skill',
        slug: 'retrying-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'retrying-skill' }]);
      await service.handleMissingResource('task-retrying', report);

      mockEventEmit.mockClear();
      await service.onResourceActivated('draft-retrying');

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.retrying',
          data: expect.objectContaining({
            resourceType: 'skill',
            resourceName: 'retrying-skill',
            autonomyMode: 'supervised',
          }),
        })
      );
    });
  });

  describe('Recovery (FASE 6)', () => {
    it('should reconstruct state from database on startup', async () => {
      const service = new ResourceRetryService();

      mockDraftList.mockResolvedValueOnce([
        {
          id: 'draft-recovered',
          resourceType: 'skill',
          name: 'recovered-skill',
          status: 'pending_approval',
          metadata: { taskId: 'task-recovered', autoCreated: true, resourceKey: 'abc123' },
        },
      ]);

      mockTaskGetById.mockResolvedValueOnce({
        id: 'task-recovered',
        status: 'queued',
        title: 'Recovered Task',
      });

      const recovery = await service.recoverState();

      expect(recovery.pendingDrafts).toBe(1);
      expect(recovery.tasksWaiting).toBe(1);
      expect(service.hasPendingResource('task-recovered')).toBe(true);
    });

    it('should identify approved-but-not-activated resources', async () => {
      const service = new ResourceRetryService();

      mockDraftList.mockResolvedValueOnce([
        {
          id: 'draft-approved',
          resourceType: 'skill',
          name: 'approved-skill',
          status: 'approved',
          metadata: { taskId: 'task-approved', autoCreated: true },
        },
      ]);

      mockTaskGetById.mockResolvedValueOnce({
        id: 'task-approved',
        status: 'queued',
        title: 'Approved Task',
      });

      const recovery = await service.recoverState();

      expect(recovery.resourcesNeedingRetry).toContain('draft-approved');
    });
  });

  describe('Status and Cleanup', () => {
    it('should return accurate status with lock counts', async () => {
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-status-1',
        resourceType: 'skill',
        name: 'status-skill',
        slug: 'status-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'status-skill' }]);
      await service.handleMissingResource('task-status-1', report);

      const status = service.getStatus();

      expect(status.pendingRetries).toBeGreaterThanOrEqual(1);
      expect(status.tasksWaiting).toBeGreaterThanOrEqual(1);
      expect(status.activeLocks).toBeDefined();
      expect(typeof status.activeLocks.tasks).toBe('number');
      expect(typeof status.activeLocks.resources).toBe('number');
    });

    it('should clear all tracking when task completes', async () => {
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-clear',
        resourceType: 'skill',
        name: 'clear-skill',
        slug: 'clear-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'clear-skill' }]);
      await service.handleMissingResource('task-clear', report);

      expect(service.hasPendingResource('task-clear')).toBe(true);
      expect(service.getRetryCount('task-clear')).toBe(1);

      service.clearForTask('task-clear');

      expect(service.hasPendingResource('task-clear')).toBe(false);
      expect(service.getRetryCount('task-clear')).toBe(0);
    });
  });

  describe('Failure handling', () => {
    it('should not break if activation fails', async () => {
      const service = new ResourceRetryService();

      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-fail-activate',
        resourceType: 'skill',
        name: 'fail-activate-skill',
        slug: 'fail-activate-skill',
        status: 'draft',
      });

      const report = createMissingReport([{ type: 'skill', name: 'fail-activate-skill' }]);
      await service.handleMissingResource('task-fail-activate', report);

      // Make task lookup fail during activation
      mockTaskGetById.mockRejectedValueOnce(new Error('Task not found'));
      mockEventEmit.mockClear();

      // Should not throw
      const result = await service.onResourceActivated('draft-fail-activate');

      // Should have emitted TASK_RETRY_FAILED
      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.retry_failed',
        })
      );

      // Should return empty (retry failed gracefully)
      expect(result).toEqual([]);
    });
  });
});

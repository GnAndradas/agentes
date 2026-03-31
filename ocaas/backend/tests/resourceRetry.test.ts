import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions outside modules
const mockEventEmit = vi.fn().mockResolvedValue({});
const mockTaskGetById = vi.fn();
const mockDraftGetBySlug = vi.fn().mockResolvedValue(null);
const mockDraftCreate = vi.fn();
const mockDraftSubmit = vi.fn();
const mockDraftApprove = vi.fn();
const mockDraftActivate = vi.fn();

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
      createDraft: mockDraftCreate,
      submitForApproval: mockDraftSubmit,
      approve: mockDraftApprove,
      activate: mockDraftActivate,
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

describe('ResourceRetryService', () => {
  let service: ResourceRetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAutonomyLevel = 'supervised';
    service = new ResourceRetryService();

    // Default mock implementations
    mockTaskGetById.mockResolvedValue({
      id: 'task-1',
      title: 'Test Task',
      description: 'Test description',
      status: 'queued',
      input: {},
    });

    mockDraftGetBySlug.mockResolvedValue(null);

    mockDraftCreate.mockResolvedValue({
      id: 'draft-1',
      resourceType: 'skill',
      name: 'test-skill',
      slug: 'test-skill',
      status: 'draft',
    });

    mockDraftSubmit.mockResolvedValue({
      id: 'draft-1',
      status: 'pending_approval',
    });

    mockDraftApprove.mockResolvedValue({
      id: 'draft-1',
      status: 'approved',
    });

    mockDraftActivate.mockResolvedValue({
      id: 'draft-1',
      status: 'active',
      activeResourceId: 'skill-1',
    });
  });

  describe('handleMissingResource', () => {
    it('should create draft for missing skill in supervised mode', async () => {
      const report = createMissingReport([{ type: 'skill', name: 'coding-skill' }]);

      const result = await service.handleMissingResource('task-1', report);

      expect(result.draftIds).toHaveLength(1);
      expect(result.requiresHuman).toBe(true);
      expect(mockDraftCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'skill',
          name: 'coding-skill',
        })
      );
      expect(mockDraftSubmit).toHaveBeenCalled();
    });

    it('should auto-activate in autonomous mode', async () => {
      mockAutonomyLevel = 'autonomous';
      // Need to recreate service after changing autonomy
      service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'skill', name: 'auto-skill' }]);

      const result = await service.handleMissingResource('task-1', report);

      expect(result.draftIds).toHaveLength(1);
      expect(result.requiresHuman).toBe(false);
      expect(mockDraftSubmit).toHaveBeenCalled();
      expect(mockDraftApprove).toHaveBeenCalled();
      expect(mockDraftActivate).toHaveBeenCalled();
    });

    it('should only create draft in manual mode', async () => {
      mockAutonomyLevel = 'manual';
      service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'agent', name: 'helper-agent' }]);

      const result = await service.handleMissingResource('task-1', report);

      expect(result.draftIds).toHaveLength(1);
      expect(result.requiresHuman).toBe(true);
      expect(mockDraftCreate).toHaveBeenCalled();
      expect(mockDraftSubmit).not.toHaveBeenCalled();
    });
  });

  describe('onResourceActivated', () => {
    it('should return waiting task IDs when resource is activated', async () => {
      mockAutonomyLevel = 'supervised';
      service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'skill', name: 'activated-skill' }]);

      // Create pending resource
      await service.handleMissingResource('task-1', report);

      // Simulate activation
      const taskIds = await service.onResourceActivated('draft-1');

      expect(taskIds).toContain('task-1');
    });

    it('should return empty array if no pending retry', async () => {
      const taskIds = await service.onResourceActivated('nonexistent-draft');

      expect(taskIds).toHaveLength(0);
    });
  });

  describe('hasPendingResource', () => {
    it('should return true when task has pending resource', async () => {
      mockAutonomyLevel = 'supervised';
      service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'tool', name: 'pending-tool' }]);
      await service.handleMissingResource('task-2', report);

      expect(service.hasPendingResource('task-2')).toBe(true);
      expect(service.hasPendingResource('task-unknown')).toBe(false);
    });
  });

  describe('clearForTask', () => {
    it('should clear all tracking for a task', async () => {
      mockAutonomyLevel = 'supervised';
      service = new ResourceRetryService();

      const report = createMissingReport([{ type: 'skill', name: 'clear-skill' }]);
      await service.handleMissingResource('task-3', report);

      expect(service.hasPendingResource('task-3')).toBe(true);

      service.clearForTask('task-3');

      expect(service.hasPendingResource('task-3')).toBe(false);
      expect(service.getRetryCount('task-3')).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return accurate status summary', async () => {
      mockAutonomyLevel = 'supervised';
      service = new ResourceRetryService();

      // First resource
      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-1',
        resourceType: 'skill',
        name: 'status-skill',
        slug: 'status-skill',
        status: 'draft',
      });

      // Second resource
      mockDraftCreate.mockResolvedValueOnce({
        id: 'draft-2',
        resourceType: 'tool',
        name: 'status-tool',
        slug: 'status-tool',
        status: 'draft',
      });

      const report1 = createMissingReport([{ type: 'skill', name: 'status-skill' }]);
      const report2 = createMissingReport([{ type: 'tool', name: 'status-tool' }]);
      report2.taskId = 'task-5';

      await service.handleMissingResource('task-4', report1);
      await service.handleMissingResource('task-5', report2);

      const status = service.getStatus();

      expect(status.pendingRetries).toBe(2);
      expect(status.tasksWaiting).toBe(2);
    });
  });
});

describe('ResourceRetryService Integration Scenarios', () => {
  let service: ResourceRetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAutonomyLevel = 'supervised';
    service = new ResourceRetryService();

    mockTaskGetById.mockResolvedValue({
      id: 'task-workflow',
      title: 'Workflow Task',
      description: 'Test',
      status: 'queued',
      input: {},
    });

    mockDraftGetBySlug.mockResolvedValue(null);

    mockDraftCreate.mockResolvedValue({
      id: 'draft-workflow',
      resourceType: 'skill',
      name: 'workflow-skill',
      slug: 'workflow-skill',
      status: 'draft',
    });

    mockDraftSubmit.mockResolvedValue({
      id: 'draft-workflow',
      status: 'pending_approval',
    });
  });

  describe('full workflow: missing skill → create draft → approve → activate → retry task', () => {
    it('should emit TASK_MISSING_RESOURCE event', async () => {
      const report = createMissingReport([{ type: 'skill', name: 'workflow-skill' }]);

      await service.handleMissingResource('task-workflow', report);

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.missing_resource',
        })
      );
    });

    it('should emit TASK_RETRYING event on activation', async () => {
      const report = createMissingReport([{ type: 'skill', name: 'workflow-skill' }]);
      report.taskId = 'task-workflow';

      // Create pending resource
      await service.handleMissingResource('task-workflow', report);

      // Reset mock to check next call
      mockEventEmit.mockClear();

      // Simulate activation
      await service.onResourceActivated('draft-workflow');

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.retrying',
        })
      );
    });
  });
});

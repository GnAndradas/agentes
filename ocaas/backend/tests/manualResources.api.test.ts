import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db module before importing anything that uses it
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

import { ManualResourceService } from '../src/services/ManualResourceService.js';
import type { EventService } from '../src/services/EventService.js';
import type { AgentService } from '../src/services/AgentService.js';
import type { SkillService } from '../src/services/SkillService.js';
import type { ToolService } from '../src/services/ToolService.js';
import type { ResourceDraftDTO, CreateDraftInput } from '../src/services/ManualResourceService.js';

// Mock draft factory
function mockDraft(overrides: Partial<ResourceDraftDTO> = {}): ResourceDraftDTO {
  return {
    id: 'draft-1',
    resourceType: 'agent',
    name: 'Test Agent',
    slug: 'test-agent',
    description: 'Test description',
    status: 'draft',
    content: { type: 'general', capabilities: ['test'] },
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('ManualResourceService', () => {
  let service: ManualResourceService;
  let eventService: EventService;
  let agentService: AgentService;
  let skillService: SkillService;
  let toolService: ToolService;

  beforeEach(() => {
    vi.clearAllMocks();

    eventService = {
      emit: vi.fn().mockResolvedValue({}),
    } as unknown as EventService;

    agentService = {
      create: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Test Agent' }),
    } as unknown as AgentService;

    skillService = {
      create: vi.fn().mockResolvedValue({ id: 'skill-1', name: 'Test Skill' }),
    } as unknown as SkillService;

    toolService = {
      create: vi.fn().mockResolvedValue({ id: 'tool-1', name: 'Test Tool' }),
    } as unknown as ToolService;

    service = new ManualResourceService(eventService, agentService, skillService, toolService);
  });

  describe('FSM transitions', () => {
    it('should reject submit from non-draft status', async () => {
      const draft = mockDraft({ status: 'pending_approval' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(service.submitForApproval('draft-1')).rejects.toThrow(
        "Cannot submit draft in status 'pending_approval'. Expected 'draft'."
      );
    });

    it('should reject approve from non-pending_approval status', async () => {
      const draft = mockDraft({ status: 'draft' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(service.approve('draft-1', 'user')).rejects.toThrow(
        "Cannot approve draft in status 'draft'. Expected 'pending_approval'."
      );
    });

    it('should reject activation from non-approved status', async () => {
      const draft = mockDraft({ status: 'pending_approval' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(service.activate('draft-1')).rejects.toThrow(
        "Cannot activate draft in status 'pending_approval'. Expected 'approved'."
      );
    });

    it('should reject deactivation from non-active status', async () => {
      const draft = mockDraft({ status: 'approved' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(service.deactivate('draft-1')).rejects.toThrow(
        "Cannot deactivate draft in status 'approved'. Expected 'active'."
      );
    });

    it('should be idempotent for approve on already approved', async () => {
      const draft = mockDraft({ status: 'approved' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      const result = await service.approve('draft-1', 'user');
      expect(result.status).toBe('approved');
    });

    it('should be idempotent for reject on already rejected', async () => {
      const draft = mockDraft({ status: 'rejected' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      const result = await service.reject('draft-1', 'user', 'reason');
      expect(result.status).toBe('rejected');
    });

    it('should be idempotent for activate on already active', async () => {
      const draft = mockDraft({ status: 'active', activeResourceId: 'agent-1' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      const result = await service.activate('draft-1');
      expect(result.status).toBe('active');
    });
  });

  describe('content validation', () => {
    it('should reject skill without files', async () => {
      const input: CreateDraftInput = {
        resourceType: 'skill',
        name: 'Test Skill',
        content: { files: {} } as any,
      };

      await expect(service.createDraft(input)).rejects.toThrow('Skill content must include files');
    });

    it('should reject tool without script', async () => {
      const input: CreateDraftInput = {
        resourceType: 'tool',
        name: 'Test Tool',
        content: { type: 'sh', script: '' } as any,
      };

      await expect(service.createDraft(input)).rejects.toThrow('Tool content must include script');
    });

    it('should reject tool with invalid type', async () => {
      const input: CreateDraftInput = {
        resourceType: 'tool',
        name: 'Test Tool',
        content: { type: 'invalid', script: 'echo hello' } as any,
      };

      await expect(service.createDraft(input)).rejects.toThrow("Tool content must specify type: 'sh' or 'py'");
    });
  });

  describe('update restrictions', () => {
    it('should reject update in pending_approval status', async () => {
      const draft = mockDraft({ status: 'pending_approval' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(
        service.updateDraft('draft-1', { name: 'Updated Name' })
      ).rejects.toThrow("Cannot update draft in status 'pending_approval'");
    });

    it('should reject update in approved status', async () => {
      const draft = mockDraft({ status: 'approved' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(
        service.updateDraft('draft-1', { name: 'Updated Name' })
      ).rejects.toThrow("Cannot update draft in status 'approved'");
    });

    it('should reject update in active status', async () => {
      const draft = mockDraft({ status: 'active' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(
        service.updateDraft('draft-1', { name: 'Updated Name' })
      ).rejects.toThrow("Cannot update draft in status 'active'");
    });
  });

  describe('delete restrictions', () => {
    it('should reject delete in pending_approval status', async () => {
      const draft = mockDraft({ status: 'pending_approval' });
      vi.spyOn(service, 'getById').mockResolvedValue(draft);

      await expect(service.delete('draft-1')).rejects.toThrow(
        "Cannot delete draft in status 'pending_approval'"
      );
    });
  });
});

describe('ManualResourceService Integration Scenarios', () => {
  let service: ManualResourceService;
  let eventService: EventService;
  let agentService: AgentService;
  let skillService: SkillService;
  let toolService: ToolService;

  beforeEach(() => {
    vi.clearAllMocks();

    eventService = {
      emit: vi.fn().mockResolvedValue({}),
    } as unknown as EventService;

    agentService = {
      create: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'Test Agent' }),
    } as unknown as AgentService;

    skillService = {
      create: vi.fn().mockResolvedValue({ id: 'skill-1', name: 'Test Skill' }),
    } as unknown as SkillService;

    toolService = {
      create: vi.fn().mockResolvedValue({ id: 'tool-1', name: 'Test Tool' }),
    } as unknown as ToolService;

    service = new ManualResourceService(eventService, agentService, skillService, toolService);
  });

  describe('full workflow: draft → active', () => {
    it('should emit correct events through workflow', async () => {
      const draft = mockDraft({ status: 'pending_approval' });
      const approvedDraft = { ...draft, status: 'approved' as const };

      vi.spyOn(service, 'getById')
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(approvedDraft);

      await service.approve('draft-1', 'admin');

      expect(eventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'manual_resource.approved',
          category: 'manual_resource',
        })
      );
    });
  });

  describe('agent activation', () => {
    it('should delegate to AgentService.create', async () => {
      const draft = mockDraft({
        status: 'approved',
        resourceType: 'agent',
        content: { type: 'specialist', capabilities: ['code'] },
      });
      const activatedDraft = { ...draft, status: 'active' as const, activeResourceId: 'agent-1' };

      vi.spyOn(service, 'getById')
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce(activatedDraft);

      await service.activate('draft-1');

      expect(agentService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Agent',
          type: 'specialist',
          capabilities: ['code'],
          source: 'api',
        })
      );
    });
  });
});

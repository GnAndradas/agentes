import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivationWorkflowService } from '../src/services/ActivationWorkflowService.js';
import type { EventService } from '../src/services/EventService.js';
import type { GenerationService } from '../src/services/GenerationService.js';
import type { ApprovalService } from '../src/approval/ApprovalService.js';
import type { GenerationDTO } from '../src/types/domain.js';
import type { ApprovalDTO } from '../src/approval/types.js';

// Mock generation factory
function mockGeneration(overrides: Partial<GenerationDTO> = {}): GenerationDTO {
  return {
    id: 'gen-1',
    type: 'agent',
    name: 'Test Agent',
    description: 'Test description',
    prompt: 'Generate a test agent',
    status: 'pending_approval',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Mock approval factory
function mockApproval(overrides: Partial<ApprovalDTO> = {}): ApprovalDTO {
  return {
    id: 'appr-1',
    type: 'agent',
    resourceId: 'gen-1',
    title: 'Approve Agent',
    description: 'Approve test agent',
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    ...overrides,
  };
}

describe('ActivationWorkflowService', () => {
  let workflow: ActivationWorkflowService;
  let eventService: EventService;
  let generationService: GenerationService;
  let approvalService: ApprovalService;
  let activateCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mocks
    eventService = {
      emit: vi.fn().mockResolvedValue({}),
    } as unknown as EventService;

    generationService = {
      getById: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      activate: vi.fn(),
      markFailed: vi.fn(),
    } as unknown as GenerationService;

    approvalService = {
      getById: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as ApprovalService;

    activateCallback = vi.fn().mockResolvedValue(undefined);

    workflow = new ActivationWorkflowService(eventService, generationService, approvalService);
    workflow.setActivateCallback(activateCallback);
  });

  describe('approveGeneration FSM', () => {
    it('should approve generation in pending_approval status', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const approvedGen = { ...gen, status: 'approved' as const };
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue(approvedGen);
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(true);
      expect(generationService.approve).toHaveBeenCalledWith('gen-1', 'human:test');
      expect(activateCallback).toHaveBeenCalledWith('gen-1', 'agent');
      expect(generationService.activate).toHaveBeenCalledWith('gen-1');
    });

    it('should return already processed for active generation', async () => {
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
      expect(generationService.approve).not.toHaveBeenCalled();
    });

    it('should reject approval for draft generation', async () => {
      const gen = mockGeneration({ status: 'draft' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot approve generation in status 'draft'");
      expect(result.failedStep).toBe('check_status');
    });

    it('should reject approval for rejected generation', async () => {
      const gen = mockGeneration({ status: 'rejected' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot approve generation in status 'rejected'");
    });
  });

  describe('rejectGeneration FSM', () => {
    it('should reject generation in pending_approval status', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      const result = await workflow.rejectGeneration('gen-1', 'human:test', 'Not needed');

      expect(result.success).toBe(true);
      expect(generationService.reject).toHaveBeenCalledWith('gen-1', 'Not needed');
    });

    it('should reject generation in generated status', async () => {
      const gen = mockGeneration({ status: 'generated' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      const result = await workflow.rejectGeneration('gen-1', 'human:test', 'Not needed');

      expect(result.success).toBe(true);
    });

    it('should return already processed for rejected generation', async () => {
      const gen = mockGeneration({ status: 'rejected' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.rejectGeneration('gen-1', 'human:test', 'Not needed');

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
    });

    it('should not reject active generation', async () => {
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.rejectGeneration('gen-1', 'human:test', 'Too late');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot reject generation in status 'active'");
      expect(result.failedStep).toBe('check_status');
    });
  });

  describe('approveApproval FSM', () => {
    it('should approve approval in pending status', async () => {
      const appr = mockApproval({ status: 'pending' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);
      vi.mocked(approvalService.approve).mockResolvedValue({ ...appr, status: 'approved' });

      // Mock generation for linked approval
      const gen = mockGeneration({ status: 'pending_approval' });
      const activeGen = { ...gen, status: 'active' as const };
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue({ ...gen, status: 'approved' });
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(true);
      expect(approvalService.approve).toHaveBeenCalledWith('appr-1', 'human:test');
    });

    it('should return already processed for approved approval', async () => {
      const appr = mockApproval({ status: 'approved' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);

      // Mock generation as already active
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
      expect(approvalService.approve).not.toHaveBeenCalled();
    });

    it('should not approve rejected approval', async () => {
      const appr = mockApproval({ status: 'rejected' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot approve approval in status 'rejected'");
      expect(result.failedStep).toBe('check_status');
    });

    it('should not approve expired approval', async () => {
      const appr = mockApproval({ status: 'expired' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot approve approval in status 'expired'");
    });
  });

  describe('rejectApproval FSM', () => {
    it('should reject approval in pending status', async () => {
      const appr = mockApproval({ status: 'pending' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);
      vi.mocked(approvalService.reject).mockResolvedValue({ ...appr, status: 'rejected' });

      // Mock linked generation
      const gen = mockGeneration({ status: 'pending_approval' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      const result = await workflow.rejectApproval('appr-1', 'human:test', 'Not approved');

      expect(result.success).toBe(true);
      expect(approvalService.reject).toHaveBeenCalledWith('appr-1', 'human:test', 'Not approved');
    });

    it('should return already processed for rejected approval', async () => {
      const appr = mockApproval({ status: 'rejected' });
      vi.mocked(approvalService.getById).mockResolvedValue(appr);

      const result = await workflow.rejectApproval('appr-1', 'human:test', 'reason');

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
    });
  });

  describe('activateGeneration FSM', () => {
    it('should activate generation in approved status', async () => {
      const gen = mockGeneration({ status: 'approved' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.activate).mockResolvedValue({ ...gen, status: 'active' });

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(true);
      expect(activateCallback).toHaveBeenCalledWith('gen-1', 'agent');
      expect(generationService.activate).toHaveBeenCalledWith('gen-1');
    });

    it('should return already processed for active generation', async () => {
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
      expect(activateCallback).not.toHaveBeenCalled();
    });

    it('should not activate pending_approval generation (use approveGeneration instead)', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot activate generation in status 'pending_approval'");
      expect(result.error).toContain('Use approveGeneration()');
      expect(result.failedStep).toBe('check_status');
    });

    it('should fail if activate callback not set', async () => {
      const workflow2 = new ActivationWorkflowService(eventService, generationService, approvalService);
      // No callback set

      const gen = mockGeneration({ status: 'approved' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.markFailed).mockResolvedValue({ ...gen, status: 'failed' });

      const result = await workflow2.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Activation callback not configured');
      expect(result.failedStep).toBe('activate_generation');
    });
  });

  // ============= FASE 2.5: CONSISTENCY AND ATOMICITY TESTS =============

  describe('activation failure leaves consistent state', () => {
    it('should mark generation as failed if activation callback throws', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const approvedGen = { ...gen, status: 'approved' as const };

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue(approvedGen);
      activateCallback.mockRejectedValue(new Error('Resource creation failed'));
      vi.mocked(generationService.markFailed).mockResolvedValue({ ...gen, status: 'failed' });

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('activation failed');
      expect(result.error).toContain('marked as failed');
      expect(result.failedStep).toBe('activate_generation');
      expect(generationService.markFailed).toHaveBeenCalledWith('gen-1', expect.stringContaining('Resource creation failed'));
    });

    it('should mark generation as failed if generationService.activate throws', async () => {
      const gen = mockGeneration({ status: 'approved' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.activate).mockRejectedValue(new Error('DB error'));
      vi.mocked(generationService.markFailed).mockResolvedValue({ ...gen, status: 'failed' });

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.failedStep).toBe('activate_generation');
      expect(generationService.markFailed).toHaveBeenCalled();
    });
  });

  describe('inconsistent state detection and recovery', () => {
    it('should detect approved-but-not-active state and attempt recovery', async () => {
      const gen = mockGeneration({ status: 'approved' }); // Inconsistent: approved but not active
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      // Should succeed after recovery
      expect(result.success).toBe(true);
      expect(activateCallback).toHaveBeenCalledWith('gen-1', 'agent');
      // Should emit events about recovery
      expect(eventService.emit).toHaveBeenCalled();
    });

    it('should report inconsistent state if recovery fails', async () => {
      const gen = mockGeneration({ status: 'approved' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      activateCallback.mockRejectedValue(new Error('Still broken'));
      vi.mocked(generationService.markFailed).mockResolvedValue({ ...gen, status: 'failed' });

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.inconsistentState).toBe(true);
      expect(result.error).toContain('inconsistent state');
      expect(generationService.markFailed).toHaveBeenCalled();
    });

    it('should complete generation workflow when approval already approved but generation pending', async () => {
      const appr = mockApproval({ status: 'approved', resourceId: 'gen-1' });
      const gen = mockGeneration({ status: 'pending_approval' }); // Inconsistent
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(approvalService.getById).mockResolvedValue(appr);
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue({ ...gen, status: 'approved' });
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(true);
      expect(generationService.approve).toHaveBeenCalled();
      expect(generationService.activate).toHaveBeenCalled();
    });
  });

  describe('double approval handling', () => {
    it('should handle rapid double approval gracefully (idempotent)', async () => {
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      // Simulate two rapid approvals
      const [result1, result2] = await Promise.all([
        workflow.approveGeneration('gen-1', 'human:panel'),
        workflow.approveGeneration('gen-1', 'telegram:user'),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.alreadyProcessed || result2.alreadyProcessed).toBe(true);
    });

    it('should handle approval after generation already active', async () => {
      const appr = mockApproval({ status: 'pending', resourceId: 'gen-1' });
      const gen = mockGeneration({ status: 'active' }); // Already active

      vi.mocked(approvalService.getById).mockResolvedValue(appr);
      vi.mocked(approvalService.approve).mockResolvedValue({ ...appr, status: 'approved' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.approveApproval('appr-1', 'human:test');

      expect(result.success).toBe(true);
      // Generation workflow should report already processed
      expect(result.generation?.status).toBe('active');
    });
  });

  describe('Telegram vs Panel equivalence', () => {
    it('should produce same result from Telegram and Panel for approve', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue({ ...gen, status: 'approved' });
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const panelResult = await workflow.approveGeneration('gen-1', 'human:panel');

      // Reset mocks
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue({ ...gen, status: 'approved' });
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      const telegramResult = await workflow.approveGeneration('gen-1', 'telegram:user123');

      // Both should succeed with same structure
      expect(panelResult.success).toBe(telegramResult.success);
      expect(panelResult.generation?.status).toBe(telegramResult.generation?.status);
    });

    it('should produce same result from Telegram and Panel for reject', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      const panelResult = await workflow.rejectGeneration('gen-1', 'human:panel', 'Not needed');

      vi.mocked(generationService.getById).mockResolvedValue({ ...gen }); // Fresh mock
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      const telegramResult = await workflow.rejectGeneration('gen-1', 'telegram:user', 'Rejected via Telegram');

      expect(panelResult.success).toBe(telegramResult.success);
      expect(panelResult.generation?.status).toBe(telegramResult.generation?.status);
    });
  });

  describe('activation without approval', () => {
    it('should fail to activate generation in draft status', async () => {
      const gen = mockGeneration({ status: 'draft' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot activate generation in status 'draft'");
      expect(result.failedStep).toBe('check_status');
      expect(activateCallback).not.toHaveBeenCalled();
    });

    it('should fail to activate generation in pending_approval status', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Use approveGeneration()');
      expect(activateCallback).not.toHaveBeenCalled();
    });

    it('should fail to activate generation in generated status', async () => {
      const gen = mockGeneration({ status: 'generated' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      const result = await workflow.activateGeneration('gen-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot activate generation in status 'generated'");
      expect(activateCallback).not.toHaveBeenCalled();
    });
  });

  describe('race condition protection', () => {
    it('should detect when generation becomes active during activation (race guard)', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const approvedGen = { ...gen, status: 'approved' as const };
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(generationService.getById)
        .mockResolvedValueOnce(gen) // Initial check
        .mockResolvedValueOnce(activeGen); // Race guard check - another request activated it
      vi.mocked(generationService.approve).mockResolvedValue(approvedGen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      // Should succeed as idempotent (detected race)
      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
      // Callback should NOT have been called
      expect(activateCallback).not.toHaveBeenCalled();
    });

    it('should detect when generation becomes failed during activation (parallel failure)', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const approvedGen = { ...gen, status: 'approved' as const };
      const failedGen = { ...gen, status: 'failed' as const };

      vi.mocked(generationService.getById)
        .mockResolvedValueOnce(gen) // Initial check
        .mockResolvedValueOnce(failedGen); // Race guard check - another request marked it failed
      vi.mocked(generationService.approve).mockResolvedValue(approvedGen);

      const result = await workflow.approveGeneration('gen-1', 'human:test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('marked as failed by parallel request');
      expect(activateCallback).not.toHaveBeenCalled();
    });
  });

  describe('markFailed FSM guard', () => {
    it('should not mark active generation as failed', async () => {
      const gen = mockGeneration({ status: 'active' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      // markFailed now has FSM guard - should be idempotent/no-op for terminal states
      vi.mocked(generationService.markFailed).mockResolvedValue(gen);

      // Simulate activation failure after generation is already active
      activateCallback.mockRejectedValue(new Error('Late failure'));

      // This should not mark as failed since it's already active
      const result = await workflow.activateGeneration('gen-1');

      // Should return idempotent success since already active
      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(true);
    });
  });

  describe('workflow events', () => {
    it('should emit workflow.started event on approveGeneration', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      const activeGen = { ...gen, status: 'active' as const };

      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.approve).mockResolvedValue({ ...gen, status: 'approved' });
      vi.mocked(generationService.activate).mockResolvedValue(activeGen);

      await workflow.approveGeneration('gen-1', 'human:test');

      expect(eventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.started',
          category: 'workflow',
        })
      );
    });

    it('should emit workflow.failed event on failure', async () => {
      const gen = mockGeneration({ status: 'draft' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);

      await workflow.approveGeneration('gen-1', 'human:test');

      expect(eventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.failed',
          severity: 'error',
        })
      );
    });

    it('should emit workflow.rejected event on reject', async () => {
      const gen = mockGeneration({ status: 'pending_approval' });
      vi.mocked(generationService.getById).mockResolvedValue(gen);
      vi.mocked(generationService.reject).mockResolvedValue({ ...gen, status: 'rejected' });

      await workflow.rejectGeneration('gen-1', 'human:test', 'reason');

      expect(eventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow.rejected',
          severity: 'warning',
        })
      );
    });
  });
});

import { createLogger } from '../utils/logger.js';
import { EVENT_TYPE, GENERATION_STATUS } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { GenerationService } from './GenerationService.js';
import type { ApprovalService } from '../approval/ApprovalService.js';
import type { GenerationDTO, GenerationType } from '../types/domain.js';
import type { ApprovalDTO } from '../approval/types.js';

const logger = createLogger('ActivationWorkflowService');

/**
 * Workflow step identifiers for debugging
 */
export type WorkflowStep =
  | 'check_status'
  | 'approve_approval'
  | 'approve_generation'
  | 'activate_generation'
  | 'reject_approval'
  | 'reject_generation';

/**
 * Result of an activation workflow operation
 */
export interface WorkflowResult {
  success: boolean;
  generation?: GenerationDTO;
  approval?: ApprovalDTO;
  error?: string;
  alreadyProcessed?: boolean;
  /** Step where the workflow failed (for debugging) */
  failedStep?: WorkflowStep;
  /** Whether the state was left inconsistent */
  inconsistentState?: boolean;
}

/**
 * Callback to perform actual resource creation (agent/skill/tool)
 */
export type ActivateResourceCallback = (generationId: string, type: GenerationType) => Promise<void>;

/**
 * Central service for approval and activation workflows.
 *
 * This is the ONLY entry point for:
 * - Approving generations (panel, Telegram)
 * - Approving approvals linked to generations
 * - Activating approved generations
 * - Rejecting generations/approvals
 *
 * Guarantees:
 * 1. FSM enforcement: transitions only from valid states
 * 2. Idempotency: already-processed items return success without re-executing
 * 3. Consistency: detects and reports inconsistent states
 * 4. Atomicity: if activation fails, marks generation as failed (not left in approved)
 * 5. Order: approval → generation → activation
 *
 * FSM rules:
 * - approval: pending → approved/rejected/expired
 * - generation: draft → generated → pending_approval → approved → active
 *                                                    → rejected
 *                                        → failed
 */
export class ActivationWorkflowService {
  private activateCallback: ActivateResourceCallback | null = null;

  constructor(
    private eventService: EventService,
    private generationService: GenerationService,
    private approvalService: ApprovalService
  ) {}

  /**
   * Register the callback that creates actual resources
   * Should be called at startup with generators
   */
  setActivateCallback(callback: ActivateResourceCallback): void {
    this.activateCallback = callback;
  }

  /**
   * Approve and activate a generation directly
   * Used by: generations/handlers.ts approve endpoint, Telegram
   *
   * Flow: pending_approval → approved → active
   * If activation fails: approved → failed (no inconsistent state)
   */
  async approveGeneration(
    generationId: string,
    respondedBy: string
  ): Promise<WorkflowResult> {
    // Emit workflow started
    await this.emitWorkflowEvent('started', generationId, { respondedBy, action: 'approve' });

    try {
      const generation = await this.generationService.getById(generationId);

      // Check for inconsistent state: approved but not active
      if (generation.status === GENERATION_STATUS.APPROVED) {
        logger.warn({ generationId }, 'Found generation in approved state (incomplete activation), attempting recovery');
        // Attempt to complete the activation
        const activationResult = await this.executeActivation(generationId, generation.type);
        if (activationResult.success) {
          await this.emitWorkflowEvent('activated', generationId, { respondedBy, recovered: true });
          return { success: true, generation: activationResult.generation };
        }
        // Activation still failed - mark as failed to avoid stuck state
        await this.markGenerationFailed(generationId, `Activation failed during recovery: ${activationResult.error}`);
        await this.emitWorkflowEvent('failed', generationId, {
          respondedBy,
          step: 'activate_generation',
          error: activationResult.error,
          originalStatus: 'approved',
          finalStatus: 'failed',
          inconsistentState: true,
        });
        return {
          success: false,
          error: `Generation was in inconsistent state (approved but not active). Recovery failed: ${activationResult.error}`,
          failedStep: 'activate_generation',
          inconsistentState: true,
        };
      }

      // Already active - idempotent success
      if (generation.status === GENERATION_STATUS.ACTIVE) {
        logger.info({ generationId }, 'Generation already active (idempotent)');
        return { success: true, generation, alreadyProcessed: true };
      }

      // FSM check: can only approve from pending_approval
      if (generation.status !== GENERATION_STATUS.PENDING_APPROVAL) {
        const error = `Cannot approve generation in status '${generation.status}'. Expected 'pending_approval'.`;
        await this.emitWorkflowEvent('failed', generationId, {
          respondedBy,
          step: 'check_status',
          error,
          originalStatus: generation.status,
          finalStatus: generation.status, // No change
        });
        return { success: false, error, failedStep: 'check_status' };
      }

      // Step 1: Approve the generation
      const approved = await this.generationService.approve(generationId, respondedBy);
      await this.emitWorkflowEvent('approved', generationId, { respondedBy, type: approved.type });

      // Step 2: Activate (create the actual resource)
      const activationResult = await this.executeActivation(generationId, approved.type);

      if (!activationResult.success) {
        // CRITICAL: Don't leave in approved state - mark as failed
        await this.markGenerationFailed(generationId, `Activation failed: ${activationResult.error}`);
        await this.emitWorkflowEvent('failed', generationId, {
          respondedBy,
          step: 'activate_generation',
          error: activationResult.error,
          originalStatus: 'approved',
          finalStatus: 'failed',
        });

        return {
          success: false,
          error: `Approved but activation failed: ${activationResult.error}. Generation marked as failed.`,
          failedStep: 'activate_generation',
        };
      }

      // Propagate alreadyProcessed from race guard detection
      if (activationResult.alreadyProcessed) {
        return { success: true, generation: activationResult.generation, alreadyProcessed: true };
      }

      await this.emitWorkflowEvent('activated', generationId, { respondedBy, type: approved.type });
      return { success: true, generation: activationResult.generation };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, generationId }, 'Workflow failed during approveGeneration');
      await this.emitWorkflowEvent('failed', generationId, {
        respondedBy,
        step: 'approve_generation',
        error: message,
        // Status unknown at exception time, will be enriched by emitWorkflowEvent
      });
      return { success: false, error: message, failedStep: 'approve_generation' };
    }
  }

  /**
   * Reject a generation
   * Used by: generations/handlers.ts reject endpoint, Telegram
   */
  async rejectGeneration(
    generationId: string,
    respondedBy: string,
    reason?: string
  ): Promise<WorkflowResult> {
    try {
      const generation = await this.generationService.getById(generationId);

      // Already rejected - idempotent
      if (generation.status === GENERATION_STATUS.REJECTED) {
        return { success: true, generation, alreadyProcessed: true };
      }

      // FSM check: can only reject from pending_approval or generated
      const rejectableStatuses = [GENERATION_STATUS.PENDING_APPROVAL, GENERATION_STATUS.GENERATED];
      if (!rejectableStatuses.includes(generation.status as typeof rejectableStatuses[number])) {
        const error = `Cannot reject generation in status '${generation.status}'. Expected 'pending_approval' or 'generated'.`;
        return { success: false, error, failedStep: 'check_status' };
      }

      const rejectReason = reason || `Rejected by ${respondedBy}`;
      const rejected = await this.generationService.reject(generationId, rejectReason);

      await this.emitWorkflowEvent('rejected', generationId, { respondedBy, reason: rejectReason });
      return { success: true, generation: rejected };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, generationId }, 'Failed to reject generation');
      return { success: false, error: message, failedStep: 'reject_generation' };
    }
  }

  /**
   * Activate an already-approved generation
   * Used by: generations/handlers.ts activate endpoint (manual activation)
   *
   * IMPORTANT: This should only be called for generations that are already approved.
   * Normal flow goes through approveGeneration which handles both.
   */
  async activateGeneration(generationId: string): Promise<WorkflowResult> {
    try {
      const generation = await this.generationService.getById(generationId);

      // Already active - idempotent
      if (generation.status === GENERATION_STATUS.ACTIVE) {
        return { success: true, generation, alreadyProcessed: true };
      }

      // FSM check: can only activate from approved
      if (generation.status !== GENERATION_STATUS.APPROVED) {
        const error = `Cannot activate generation in status '${generation.status}'. Expected 'approved'. Use approveGeneration() for pending_approval generations.`;
        return { success: false, error, failedStep: 'check_status' };
      }

      // Execute activation
      const result = await this.executeActivation(generationId, generation.type);

      if (!result.success) {
        // Mark as failed to avoid stuck approved state
        await this.markGenerationFailed(generationId, `Activation failed: ${result.error}`);
        return {
          success: false,
          error: `Activation failed: ${result.error}. Generation marked as failed.`,
          failedStep: 'activate_generation',
        };
      }

      await this.emitWorkflowEvent('activated', generationId, { type: generation.type, manual: true });
      return { success: true, generation: result.generation };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, generationId }, 'Failed to activate generation');
      return { success: false, error: message, failedStep: 'activate_generation' };
    }
  }

  /**
   * Approve an approval record and activate associated generation if applicable
   * Used by: approvals/handlers.ts, Telegram handleGenericApproval
   *
   * Flow: approval(pending→approved) → generation(pending_approval→approved→active)
   */
  async approveApproval(
    approvalId: string,
    respondedBy: string
  ): Promise<WorkflowResult> {
    try {
      const approval = await this.approvalService.getById(approvalId);

      // Already approved - check if linked generation is complete
      if (approval.status === 'approved') {
        // Check if there's a linked generation that needs completion
        if (approval.resourceId && ['agent', 'skill', 'tool'].includes(approval.type)) {
          const genResult = await this.checkAndCompleteGeneration(approval.resourceId, respondedBy);
          if (genResult.inconsistentState) {
            return genResult; // Report the inconsistency
          }
        }
        return { success: true, approval, alreadyProcessed: true };
      }

      // FSM check: can only approve from pending
      if (approval.status !== 'pending') {
        const error = `Cannot approve approval in status '${approval.status}'. Expected 'pending'.`;
        return { success: false, error, failedStep: 'check_status' };
      }

      // Step 1: Approve the approval record
      const approved = await this.approvalService.approve(approvalId, respondedBy);

      // Step 2: If linked to a generation, approve and activate it
      if (approved.resourceId && ['agent', 'skill', 'tool'].includes(approved.type)) {
        await this.eventService.emit({
          type: EVENT_TYPE.ACTION_APPROVED,
          category: 'orchestrator',
          severity: 'info',
          message: `Action ${approved.type} approved by ${respondedBy}`,
          resourceType: 'approval',
          resourceId: approvalId,
          data: { type: approved.type, generationId: approved.resourceId, approvedBy: respondedBy },
        });

        const genResult = await this.approveGeneration(approved.resourceId, respondedBy);

        if (!genResult.success && !genResult.alreadyProcessed) {
          // Approval succeeded but generation failed
          // The approval stays approved, but we report the generation failure
          logger.error({
            approvalId,
            generationId: approved.resourceId,
            error: genResult.error,
            failedStep: genResult.failedStep,
          }, 'Generation workflow failed after approval');

          return {
            success: false,
            approval: approved,
            error: `Approval succeeded but generation workflow failed at step '${genResult.failedStep}': ${genResult.error}`,
            failedStep: genResult.failedStep,
          };
        }

        return { success: true, approval: approved, generation: genResult.generation };
      }

      return { success: true, approval: approved };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, approvalId }, 'Failed to approve approval');
      return { success: false, error: message, failedStep: 'approve_approval' };
    }
  }

  /**
   * Reject an approval record
   * Used by: approvals/handlers.ts, Telegram
   */
  async rejectApproval(
    approvalId: string,
    respondedBy: string,
    reason?: string
  ): Promise<WorkflowResult> {
    try {
      const approval = await this.approvalService.getById(approvalId);

      // Already rejected - idempotent
      if (approval.status === 'rejected') {
        return { success: true, approval, alreadyProcessed: true };
      }

      // FSM check: can only reject from pending
      if (approval.status !== 'pending') {
        const error = `Cannot reject approval in status '${approval.status}'. Expected 'pending'.`;
        return { success: false, error, failedStep: 'check_status' };
      }

      const rejected = await this.approvalService.reject(approvalId, respondedBy, reason);

      // If linked to generation, reject it too
      if (rejected.resourceId && ['agent', 'skill', 'tool'].includes(rejected.type)) {
        await this.rejectGeneration(
          rejected.resourceId,
          respondedBy,
          reason || `Rejected via approval ${approvalId}`
        );
      }

      return { success: true, approval: rejected };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, approvalId }, 'Failed to reject approval');
      return { success: false, error: message, failedStep: 'reject_approval' };
    }
  }

  /**
   * Check and complete a generation that might be in inconsistent state
   * Used when an approval is already approved but generation might not be active
   */
  private async checkAndCompleteGeneration(
    generationId: string,
    respondedBy: string
  ): Promise<WorkflowResult> {
    try {
      const generation = await this.generationService.getById(generationId);

      if (generation.status === GENERATION_STATUS.ACTIVE) {
        return { success: true, generation, alreadyProcessed: true };
      }

      if (generation.status === GENERATION_STATUS.APPROVED) {
        // Inconsistent: approval approved but generation not activated
        logger.warn({ generationId }, 'Detected inconsistent state: approval approved but generation not active');
        const result = await this.executeActivation(generationId, generation.type);
        if (!result.success) {
          await this.markGenerationFailed(generationId, `Recovery activation failed: ${result.error}`);
          return {
            success: false,
            error: `Inconsistent state detected. Recovery activation failed: ${result.error}`,
            inconsistentState: true,
            failedStep: 'activate_generation',
          };
        }
        logger.info({ generationId }, 'Recovered inconsistent state: generation now active');
        return { success: true, generation: result.generation };
      }

      if (generation.status === GENERATION_STATUS.PENDING_APPROVAL) {
        // Approval approved but generation still pending - complete the workflow
        return this.approveGeneration(generationId, respondedBy);
      }

      // Other states (rejected, failed) - just report
      return { success: true, generation, alreadyProcessed: true };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message, failedStep: 'check_status' };
    }
  }

  /**
   * Execute the actual activation (resource creation)
   * Separated for testability and reuse
   *
   * RACE PROTECTION: Re-reads state before executing callback to prevent
   * double activation in case of parallel requests.
   */
  private async executeActivation(
    generationId: string,
    type: GenerationType
  ): Promise<WorkflowResult> {
    if (!this.activateCallback) {
      return { success: false, error: 'Activation callback not configured', failedStep: 'activate_generation' };
    }

    try {
      // RACE GUARD: Re-read state immediately before activation
      // This minimizes the window where parallel requests can both proceed
      const currentState = await this.generationService.getById(generationId);

      if (currentState.status === GENERATION_STATUS.ACTIVE) {
        // Another request already completed activation
        logger.info({ generationId }, 'Generation already active (race detected, idempotent)');
        return { success: true, generation: currentState, alreadyProcessed: true };
      }

      if (currentState.status === GENERATION_STATUS.FAILED) {
        // Another request marked it as failed
        logger.warn({ generationId }, 'Generation already failed (race detected)');
        return { success: false, error: 'Generation was marked as failed by parallel request', failedStep: 'activate_generation' };
      }

      // Execute the type-specific activation (creates agent/skill/tool)
      await this.activateCallback(generationId, type);

      // Mark as active in DB (GenerationService.activate has its own FSM guard)
      const activated = await this.generationService.activate(generationId);

      logger.info({ generationId, type }, 'Generation activated via workflow');
      return { success: true, generation: activated };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, generationId, type }, 'Activation callback failed');
      return { success: false, error: message, failedStep: 'activate_generation' };
    }
  }

  /**
   * Mark a generation as failed
   * Used when activation fails to prevent stuck approved state
   */
  private async markGenerationFailed(generationId: string, reason: string): Promise<void> {
    try {
      await this.generationService.markFailed(generationId, reason);
      logger.warn({ generationId, reason }, 'Generation marked as failed to prevent inconsistent state');
    } catch (err) {
      logger.error({ err, generationId }, 'Failed to mark generation as failed');
    }
  }

  /**
   * Emit workflow event for monitoring and debugging
   *
   * For 'failed' events, enriches with current generation status for debugging
   */
  private async emitWorkflowEvent(
    event: 'started' | 'approved' | 'activated' | 'rejected' | 'failed',
    generationId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const eventTypeMap = {
      started: EVENT_TYPE.WORKFLOW_STARTED,
      approved: EVENT_TYPE.WORKFLOW_APPROVED,
      activated: EVENT_TYPE.WORKFLOW_ACTIVATED,
      rejected: EVENT_TYPE.WORKFLOW_REJECTED,
      failed: EVENT_TYPE.WORKFLOW_FAILED,
    };

    const severityMap = {
      started: 'info' as const,
      approved: 'info' as const,
      activated: 'info' as const,
      rejected: 'warning' as const,
      failed: 'error' as const,
    };

    try {
      // For failed events, enrich with current state for debugging
      const enrichedData: Record<string, unknown> = { ...data, event, generationId };

      if (event === 'failed') {
        try {
          const gen = await this.generationService.getById(generationId);
          enrichedData.currentStatus = gen.status;
          enrichedData.generationType = gen.type;
          enrichedData.generationName = gen.name;
        } catch {
          // Generation might not exist, continue without enrichment
        }
      }

      await this.eventService.emit({
        type: eventTypeMap[event],
        category: 'workflow',
        severity: severityMap[event],
        message: event === 'failed'
          ? `Workflow failed for generation ${generationId}: ${data.error ?? 'unknown error'}`
          : `Workflow ${event} for generation ${generationId}`,
        resourceType: 'generation',
        resourceId: generationId,
        data: enrichedData,
      });
    } catch (err) {
      logger.error({ err, event, generationId }, 'Failed to emit workflow event');
    }
  }
}

let workflowInstance: ActivationWorkflowService | null = null;

export function initActivationWorkflow(
  eventService: EventService,
  generationService: GenerationService,
  approvalService: ApprovalService
): ActivationWorkflowService {
  workflowInstance = new ActivationWorkflowService(eventService, generationService, approvalService);
  return workflowInstance;
}

export function getActivationWorkflow(): ActivationWorkflowService {
  if (!workflowInstance) {
    throw new Error('ActivationWorkflowService not initialized');
  }
  return workflowInstance;
}

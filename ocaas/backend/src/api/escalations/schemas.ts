import { z } from 'zod';
import {
  ESCALATION_TYPE,
  ESCALATION_STATUS,
  ESCALATION_PRIORITY,
  FALLBACK_ACTION,
} from '../../hitl/index.js';

export const CreateEscalationSchema = z.object({
  type: z.enum([
    ESCALATION_TYPE.APPROVAL_REQUIRED,
    ESCALATION_TYPE.RESOURCE_MISSING,
    ESCALATION_TYPE.PERMISSION_DENIED,
    ESCALATION_TYPE.EXECUTION_FAILURE,
    ESCALATION_TYPE.UNCERTAINTY,
    ESCALATION_TYPE.BLOCKED,
    ESCALATION_TYPE.TIMEOUT,
    ESCALATION_TYPE.POLICY_VIOLATION,
  ]),
  priority: z.enum([
    ESCALATION_PRIORITY.LOW,
    ESCALATION_PRIORITY.NORMAL,
    ESCALATION_PRIORITY.HIGH,
    ESCALATION_PRIORITY.CRITICAL,
  ]).optional(),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  reason: z.string().min(1, 'Reason is required'),
  context: z.record(z.unknown()).optional(),
  checkpointStage: z.string().optional(),
  expiresIn: z.number().positive().optional(),
  fallbackAction: z.enum([
    FALLBACK_ACTION.RETRY,
    FALLBACK_ACTION.FAIL,
    FALLBACK_ACTION.ESCALATE_HIGHER,
    FALLBACK_ACTION.AUTO_APPROVE,
    FALLBACK_ACTION.PAUSE,
  ]).optional(),
  linkedApprovalId: z.string().optional(),
  linkedFeedbackId: z.string().optional(),
  linkedGenerationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ResolveEscalationSchema = z.object({
  resolvedBy: z.string().min(1, 'resolvedBy is required'),
  details: z.record(z.unknown()).optional(),
});

export const ApproveEscalationSchema = z.object({
  approvedBy: z.string().optional().default('human:panel'),
  details: z.record(z.unknown()).optional(),
});

export const RejectEscalationSchema = z.object({
  rejectedBy: z.string().optional().default('human:panel'),
  reason: z.string().optional(),
});

export const ProvideResourceSchema = z.object({
  providedBy: z.string().optional().default('human:panel'),
  resourceId: z.string().min(1, 'resourceId is required'),
  resourceType: z.string().min(1, 'resourceType is required'),
});

export const OverrideEscalationSchema = z.object({
  overriddenBy: z.string().optional().default('human:panel'),
  decision: z.string().min(1, 'Decision is required'),
  details: z.record(z.unknown()).optional(),
});

export const AcknowledgeEscalationSchema = z.object({
  acknowledgedBy: z.string().optional().default('human:panel'),
});

export const ListEscalationsQuerySchema = z.object({
  status: z.enum([
    ESCALATION_STATUS.PENDING,
    ESCALATION_STATUS.ACKNOWLEDGED,
    ESCALATION_STATUS.RESOLVED,
    ESCALATION_STATUS.EXPIRED,
    ESCALATION_STATUS.CANCELLED,
  ]).optional(),
  type: z.enum([
    ESCALATION_TYPE.APPROVAL_REQUIRED,
    ESCALATION_TYPE.RESOURCE_MISSING,
    ESCALATION_TYPE.PERMISSION_DENIED,
    ESCALATION_TYPE.EXECUTION_FAILURE,
    ESCALATION_TYPE.UNCERTAINTY,
    ESCALATION_TYPE.BLOCKED,
    ESCALATION_TYPE.TIMEOUT,
    ESCALATION_TYPE.POLICY_VIOLATION,
  ]).optional(),
  priority: z.enum([
    ESCALATION_PRIORITY.LOW,
    ESCALATION_PRIORITY.NORMAL,
    ESCALATION_PRIORITY.HIGH,
    ESCALATION_PRIORITY.CRITICAL,
  ]).optional(),
  taskId: z.string().optional(),
  limit: z.coerce.number().positive().optional(),
});

export type CreateEscalationInput = z.infer<typeof CreateEscalationSchema>;
export type ListEscalationsQuery = z.infer<typeof ListEscalationsQuerySchema>;

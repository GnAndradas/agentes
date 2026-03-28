import { z } from 'zod';

export const CreateApprovalSchema = z.object({
  type: z.enum(['task', 'agent', 'skill', 'tool']),
  resourceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  expiresIn: z.number().positive().optional(),
});

export const RespondApprovalSchema = z.object({
  approved: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const ListApprovalsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'expired']).optional(),
  type: z.enum(['task', 'agent', 'skill', 'tool']).optional(),
});

export type CreateApprovalBody = z.infer<typeof CreateApprovalSchema>;
export type RespondApprovalBody = z.infer<typeof RespondApprovalSchema>;
export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuerySchema>;

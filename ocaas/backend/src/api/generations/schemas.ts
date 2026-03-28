import { z } from 'zod';

export const CreateGenerationSchema = z.object({
  type: z.enum(['agent', 'skill', 'tool']),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  prompt: z.string().min(10).max(10000),
  metadata: z.record(z.unknown()).optional(),
});

export const ApproveSchema = z.object({
  approvedBy: z.string().min(1).max(100),
});

export const RejectSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const ListGenerationsQuery = z.object({
  status: z.enum(['draft', 'generated', 'pending_approval', 'approved', 'rejected', 'active', 'failed']).optional(),
  type: z.enum(['agent', 'skill', 'tool']).optional(),
});

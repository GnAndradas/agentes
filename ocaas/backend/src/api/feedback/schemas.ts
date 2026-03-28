import { z } from 'zod';

export const CreateFeedbackSchema = z.object({
  type: z.enum(['missing_tool', 'missing_skill', 'missing_capability', 'blocked', 'cannot_continue']),
  agentId: z.string().min(1),
  taskId: z.string().min(1),
  sessionId: z.string().optional(),
  message: z.string().min(1).max(1000),
  requirement: z.string().max(200).optional(),
  context: z.record(z.unknown()).optional(),
});

export const ListFeedbackQuerySchema = z.object({
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  processed: z.enum(['true', 'false']).optional(),
});

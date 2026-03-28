import { z } from 'zod';

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  type: z.enum(['general', 'specialist', 'orchestrator']).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  type: z.enum(['general', 'specialist', 'orchestrator']).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

export type CreateAgentBody = z.infer<typeof CreateAgentSchema>;
export type UpdateAgentBody = z.infer<typeof UpdateAgentSchema>;

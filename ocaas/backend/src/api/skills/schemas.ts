import { z } from 'zod';

export const CreateSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const UpdateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1).optional(),
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
  capabilities: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const AssignSkillSchema = z.object({
  agentId: z.string().min(1),
});

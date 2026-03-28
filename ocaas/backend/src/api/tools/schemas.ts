import { z } from 'zod';

export const CreateToolSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1),
  type: z.enum(['script', 'binary', 'api']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const UpdateToolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1).optional(),
  type: z.enum(['script', 'binary', 'api']).optional(),
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const AssignToolSchema = z.object({
  agentId: z.string().min(1),
});

import { z } from 'zod';

// Resource types
const ResourceTypeEnum = z.enum(['agent', 'skill', 'tool']);

// Content schemas per resource type
const AgentContentSchema = z.object({
  type: z.enum(['general', 'specialist', 'orchestrator']).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  skillIds: z.array(z.string()).optional(),
  toolIds: z.array(z.string()).optional(),
  supervisorId: z.string().optional(),
});

const SkillContentSchema = z.object({
  files: z.record(z.string(), z.string()),
  capabilities: z.array(z.string()).optional(),
  version: z.string().optional(),
  requirements: z.array(z.string()).optional(),
});

const ToolContentSchema = z.object({
  type: z.enum(['sh', 'py']),
  script: z.string().min(1, 'Script content required'),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  version: z.string().optional(),
});

// Create draft schema
export const CreateDraftSchema = z.object({
  resourceType: ResourceTypeEnum,
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  content: z.union([AgentContentSchema, SkillContentSchema, ToolContentSchema]),
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().optional(),
});

// Update draft schema
export const UpdateDraftSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  content: z.union([AgentContentSchema, SkillContentSchema, ToolContentSchema]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Query params for list
export const ListQuerySchema = z.object({
  resourceType: ResourceTypeEnum.optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'active']).optional(),
});

// Reject body
export const RejectBodySchema = z.object({
  reason: z.string().max(1000).optional(),
});

// Action body (for approve/submit with optional user)
export const ActionBodySchema = z.object({
  user: z.string().optional(),
});

export type CreateDraftBody = z.infer<typeof CreateDraftSchema>;
export type UpdateDraftBody = z.infer<typeof UpdateDraftSchema>;
export type ListQuery = z.infer<typeof ListQuerySchema>;
export type RejectBody = z.infer<typeof RejectBodySchema>;
export type ActionBody = z.infer<typeof ActionBodySchema>;

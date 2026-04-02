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

// =============================================================================
// SKILL-TOOL COMPOSITION SCHEMAS
// =============================================================================

/**
 * Schema for a single tool link
 */
export const SkillToolLinkSchema = z.object({
  toolId: z.string().min(1),
  orderIndex: z.number().int().min(0).optional(),
  required: z.boolean().optional().default(true),
  role: z.string().max(50).optional(),
  config: z.record(z.unknown()).optional(),
});

/**
 * Schema for adding a tool to a skill
 */
export const AddToolToSkillSchema = z.object({
  toolId: z.string().min(1),
  orderIndex: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
  role: z.string().max(50).optional(),
  config: z.record(z.unknown()).optional(),
});

/**
 * Schema for updating a tool link
 */
export const UpdateToolLinkSchema = z.object({
  orderIndex: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
  role: z.string().max(50).optional(),
  config: z.record(z.unknown()).optional(),
});

/**
 * Schema for replacing all tools (PUT)
 */
export const SetSkillToolsSchema = z.object({
  tools: z.array(SkillToolLinkSchema),
});

// =============================================================================
// SKILL EXECUTION SCHEMAS
// =============================================================================

/**
 * Schema for skill execution request
 */
export const ExecuteSkillSchema = z.object({
  mode: z.enum(['run', 'validate', 'dry_run']).optional().default('run'),
  input: z.record(z.unknown()).optional().default({}),
  context: z.record(z.unknown()).optional(),
  timeoutMs: z.number().positive().max(300000).optional(), // Max 5 minutes
  stopOnError: z.boolean().optional(),
  caller: z.object({
    type: z.enum(['agent', 'user', 'system']),
    id: z.string().min(1),
    name: z.string().optional(),
  }).optional(),
});

/**
 * Schema for validate-execution request (subset of execute)
 */
export const ValidateExecutionSchema = z.object({
  input: z.record(z.unknown()).optional().default({}),
});

export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;
export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;
export type AddToolToSkillInput = z.infer<typeof AddToolToSkillSchema>;
export type UpdateToolLinkInput = z.infer<typeof UpdateToolLinkSchema>;
export type SetSkillToolsInput = z.infer<typeof SetSkillToolsSchema>;
export type ExecuteSkillInput = z.infer<typeof ExecuteSkillSchema>;
export type ValidateExecutionInput = z.infer<typeof ValidateExecutionSchema>;

import { z } from 'zod';
import {
  ScriptToolConfigSchema,
  BinaryToolConfigSchema,
  ApiToolConfigSchema,
  LegacyToolConfigSchema,
} from '../../types/tool-config.js';

// =============================================================================
// TOOL TYPE
// =============================================================================

export const ToolTypeSchema = z.enum(['script', 'binary', 'api']);

// =============================================================================
// CONFIG SCHEMAS (accepts typed or legacy)
// =============================================================================

/**
 * Config validation is flexible:
 * - Accepts typed config matching the tool type
 * - Accepts legacy untyped config for backwards compatibility
 * - Additional validation happens in ToolValidationService
 */
const FlexibleConfigSchema = z.union([
  ScriptToolConfigSchema,
  BinaryToolConfigSchema,
  ApiToolConfigSchema,
  LegacyToolConfigSchema,
]).optional();

// =============================================================================
// CREATE/UPDATE SCHEMAS
// =============================================================================

export const CreateToolSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1),
  type: ToolTypeSchema.optional().default('script'),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  config: FlexibleConfigSchema,
});

export const UpdateToolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  path: z.string().min(1).optional(),
  type: ToolTypeSchema.optional(),
  status: z.enum(['active', 'inactive', 'deprecated']).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  config: FlexibleConfigSchema,
});

// =============================================================================
// OTHER SCHEMAS
// =============================================================================

export const AssignToolSchema = z.object({
  agentId: z.string().min(1),
});

export const ValidateToolSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1),
  type: ToolTypeSchema.optional(),
  description: z.string().max(1000).optional(),
  version: z.string().max(20).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  config: FlexibleConfigSchema,
});

export type CreateToolInput = z.infer<typeof CreateToolSchema>;
export type UpdateToolInput = z.infer<typeof UpdateToolSchema>;
export type ValidateToolInput = z.infer<typeof ValidateToolSchema>;

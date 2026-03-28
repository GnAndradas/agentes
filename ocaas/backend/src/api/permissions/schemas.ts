import { z } from 'zod';

export const CreatePermissionSchema = z.object({
  agentId: z.string().min(1),
  resourceType: z.enum(['tool', 'skill', 'task_type', 'system']),
  resourceId: z.string().optional(),
  level: z.number().min(0).max(4),
  constraints: z.record(z.unknown()).optional(),
  expiresAt: z.number().optional(),
  grantedBy: z.string().optional(),
});

export const UpdatePermissionSchema = z.object({
  level: z.number().min(0).max(4).optional(),
  constraints: z.record(z.unknown()).optional(),
  expiresAt: z.number().nullable().optional(),
});

export const CheckPermissionSchema = z.object({
  agentId: z.string().min(1),
  resourceType: z.enum(['tool', 'skill', 'task_type', 'system']),
  resourceId: z.string().nullable().optional(),
  requiredLevel: z.number().min(0).max(4),
});

import { z } from 'zod';

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.string().max(50).optional(),
  priority: z.number().min(1).max(4).optional(),
  agentId: z.string().optional(),
  parentTaskId: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  // PROMPT 10: Enriched task creation fields
  objective: z.string().max(2000).optional(),
  constraints: z.string().max(2000).optional(),
  details: z.union([z.string(), z.record(z.unknown())]).optional(),
  expectedOutput: z.string().max(2000).optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  type: z.string().max(50).optional(),
  priority: z.number().min(1).max(4).optional(),
  agentId: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  // PROMPT 10: Enriched task fields
  objective: z.string().max(2000).optional(),
  constraints: z.string().max(2000).optional(),
  details: z.union([z.string(), z.record(z.unknown())]).optional(),
  expectedOutput: z.string().max(2000).optional(),
});

export const AssignTaskSchema = z.object({
  agentId: z.string().min(1),
});

export const CompleteTaskSchema = z.object({
  output: z.record(z.unknown()).optional(),
});

export const FailTaskSchema = z.object({
  error: z.string().min(1),
});

export const ListTasksQuery = z.object({
  status: z.enum(['pending', 'queued', 'assigned', 'running', 'completed', 'failed', 'cancelled']).optional(),
  agentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).optional(),
});

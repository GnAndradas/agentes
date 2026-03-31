import { z } from 'zod';

// Channel types supported
export const ChannelTypeSchema = z.enum([
  'telegram',
  'whatsapp',
  'web',
  'api',
  'slack',
  'discord',
]);

// POST /api/channels/ingest
export const IngestBodySchema = z.object({
  channel: ChannelTypeSchema,
  userId: z.string().min(1, 'userId is required'),
  message: z.string().min(1, 'message is required'),
  metadata: z.record(z.unknown()).optional(),
});

export type IngestBody = z.infer<typeof IngestBodySchema>;

// GET /api/channels/:channel/users/:userId/tasks
export const GetUserTasksParamsSchema = z.object({
  channel: ChannelTypeSchema,
  userId: z.string().min(1),
});

export const GetUserTasksQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
});

// Response schemas
export const IngestResponseSchema = z.object({
  taskId: z.string(),
  status: z.string(),
  title: z.string(),
});

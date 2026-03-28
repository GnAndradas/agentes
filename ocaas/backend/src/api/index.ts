import type { FastifyInstance } from 'fastify';
import { agentRoutes } from './agents/routes.js';
import { taskRoutes } from './tasks/routes.js';
import { skillRoutes } from './skills/routes.js';
import { toolRoutes } from './tools/routes.js';
import { permissionRoutes } from './permissions/routes.js';
import { generationRoutes } from './generations/routes.js';
import { systemRoutes, rootHealthRoute } from './system/routes.js';
import { approvalRoutes } from './approvals/routes.js';
import { webhookRoutes } from './webhooks/routes.js';
import { feedbackRoutes } from './feedback/routes.js';

export async function registerRoutes(app: FastifyInstance) {
  // Root-level health endpoint for quick checks
  await app.register(rootHealthRoute);

  // API routes
  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(agentRoutes, { prefix: '/api/agents' });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  await app.register(skillRoutes, { prefix: '/api/skills' });
  await app.register(toolRoutes, { prefix: '/api/tools' });
  await app.register(permissionRoutes, { prefix: '/api/permissions' });
  await app.register(generationRoutes, { prefix: '/api/generations' });
  await app.register(approvalRoutes, { prefix: '/api/approvals' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(feedbackRoutes, { prefix: '/api/feedback' });
}

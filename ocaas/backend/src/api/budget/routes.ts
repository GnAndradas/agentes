/**
 * Budget API Routes (Fastify)
 */

import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

export async function budgetRoutes(fastify: FastifyInstance) {
  // Diagnostics
  fastify.get('/diagnostics', h.getBudgetDiagnostics);

  // Configuration
  fastify.get('/config', h.getBudgetConfig);
  fastify.patch('/config', h.updateBudgetConfig);

  // Cost queries
  fastify.get('/global', h.getGlobalCost);
  fastify.get('/cost/task/:taskId', h.getTaskCost);
  fastify.get('/cost/agent/:agentId', h.getAgentDailyCost);

  // Admin
  fastify.post('/reset', h.resetBudget);
}

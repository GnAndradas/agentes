import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

// Root-level health check (no prefix)
export async function rootHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', h.health);
}

export async function systemRoutes(fastify: FastifyInstance) {
  // Backend health & runtime
  fastify.get('/system/health', h.health);
  fastify.get('/system/runtime', h.runtimeInfo);
  fastify.get('/system/environment', h.environmentCheck);
  fastify.get('/system/stats', h.stats);
  fastify.get('/system/events', h.events);

  // Gateway diagnostics
  fastify.get('/system/gateway', h.gatewayStatus);
  fastify.get('/system/gateway/diagnostic', h.gatewayDiagnostic);

  // Autonomy & orchestrator
  fastify.get('/system/autonomy', h.getAutonomy);
  fastify.put('/system/autonomy', h.updateAutonomy);
  fastify.get('/system/orchestrator', h.getOrchestratorStatus);

  // System diagnostics
  fastify.get('/system/diagnostics', h.systemDiagnostics);
  fastify.get('/system/readiness', h.systemReadiness);
  fastify.get('/system/issues', h.systemIssues);
  fastify.get('/system/metrics', h.systemMetrics);

  // Task timeline & observability
  fastify.get('/system/overview', h.systemOverview);
  fastify.get('/system/tasks/:taskId/timeline', h.taskTimeline);

  // Problem detection
  fastify.get('/system/problems', h.allProblems);
  fastify.get('/system/problems/stuck', h.stuckTasks);
  fastify.get('/system/problems/high-retry', h.highRetryTasks);
  fastify.get('/system/problems/blocked', h.blockedTasks);

  // Safety & logs (production hardening)
  fastify.get('/system/safety', h.getSafetyStatus);
  fastify.post('/system/safety/failsafe/deactivate', h.deactivateFailsafe);
  fastify.get('/system/logs', h.getLogs);
  fastify.get('/system/logs/errors', h.getLogsErrors);
  fastify.get('/system/logs/recent', h.getLogsRecent);
}

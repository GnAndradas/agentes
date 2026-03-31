import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

// Root-level health check (no prefix)
export async function rootHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', h.health);
}

export async function systemRoutes(fastify: FastifyInstance) {
  // Backend health
  fastify.get('/system/health', h.health);
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
}

import type { FastifyInstance } from 'fastify';
import * as h from './handlers.js';

// Root-level health check (no prefix)
export async function rootHealthRoute(fastify: FastifyInstance) {
  fastify.get('/health', h.health);
}

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.get('/system/health', h.health);
  fastify.get('/system/stats', h.stats);
  fastify.get('/system/events', h.events);
  fastify.get('/system/autonomy', h.getAutonomy);
  fastify.put('/system/autonomy', h.updateAutonomy);
  fastify.get('/system/orchestrator', h.getOrchestratorStatus);
}

/**
 * Intake Routes
 *
 * Entry points for external systems to send intents/tasks to OCAAS.
 * Primary endpoint: POST /api/intake/router (from OpenClaw Intent Router)
 */

import type { FastifyInstance } from 'fastify';
import { handleIntentRouter } from './handlers.js';

export async function intakeRoutes(fastify: FastifyInstance) {
  // Main router endpoint - receives classified intents from OpenClaw
  fastify.post('/router', handleIntentRouter);
}

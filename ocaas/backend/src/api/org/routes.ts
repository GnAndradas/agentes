/**
 * Organization API Routes
 *
 * /api/org/profiles - Work profiles management
 * /api/org/hierarchy - Agent hierarchy management
 * /api/org/policies - Policy queries
 */

import type { FastifyInstance } from 'fastify';
import * as handlers from './handlers.js';

export default async function orgRoutes(fastify: FastifyInstance) {
  // ==========================================================================
  // WORK PROFILES
  // ==========================================================================

  // List all profiles
  fastify.get('/profiles', handlers.listProfiles);

  // Get profile by ID
  fastify.get('/profiles/:id', handlers.getProfile);

  // Create custom profile
  fastify.post('/profiles', handlers.createProfile);

  // Update profile
  fastify.put('/profiles/:id', handlers.updateProfile);

  // Delete custom profile
  fastify.delete('/profiles/:id', handlers.deleteProfile);

  // ==========================================================================
  // HIERARCHY
  // ==========================================================================

  // List all agent org profiles
  fastify.get('/hierarchy', handlers.listHierarchy);

  // Get hierarchy tree
  fastify.get('/hierarchy/tree', handlers.getHierarchyTree);

  // Get agent org profile
  fastify.get('/hierarchy/:agentId', handlers.getAgentProfile);

  // Create/update agent org profile
  fastify.put('/hierarchy/:agentId', handlers.upsertAgentProfile);

  // Delete agent org profile
  fastify.delete('/hierarchy/:agentId', handlers.deleteAgentProfile);

  // Get escalation chain
  fastify.get('/hierarchy/:agentId/escalation-chain', handlers.getEscalationChain);

  // Get subordinates
  fastify.get('/hierarchy/:agentId/subordinates', handlers.getSubordinates);

  // ==========================================================================
  // POLICIES
  // ==========================================================================

  // Get policy decisions for task/agent
  fastify.post('/policies/decisions', handlers.getPolicyDecisions);

  // Get effective policies for agent
  fastify.get('/policies/agent/:agentId', handlers.getEffectivePolicies);
}

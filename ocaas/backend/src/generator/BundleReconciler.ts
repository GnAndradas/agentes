/**
 * BundleReconciler
 *
 * Ensures resources are properly linked after activation.
 * Handles cases where individual approvals bypass the bundle linking flow.
 *
 * Main functions:
 * - reconcileBundle(bundleId): Links all resources in a bundle
 * - reconcileGeneration(generationId): Links resources for a single generation
 *
 * Called from:
 * - ActivationWorkflowService after successful activation
 * - SystemicGeneratorService for bundle completeness
 */

import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import type { GenerationType } from '../types/domain.js';

const logger = createLogger('BundleReconciler');

// =============================================================================
// TYPES
// =============================================================================

export type ReconcileStatus = 'complete' | 'partial' | 'failed' | 'not_applicable';

export interface ReconcileResult {
  status: ReconcileStatus;
  bundleId?: string;
  generationId?: string;
  linksCreated: {
    skillToTool: string[];
    agentToSkill: string[];
  };
  linksSkipped: {
    skillToTool: string[];
    agentToSkill: string[];
  };
  errors: string[];
}

// =============================================================================
// RECONCILE BUNDLE
// =============================================================================

/**
 * Reconcile all resources in a bundle.
 * Finds all generations with the same bundleId and ensures proper linking.
 *
 * Links:
 * - tool → skill (via skill_tools table)
 * - skill → agent (via agent_skills table)
 */
export async function reconcileBundle(bundleId: string): Promise<ReconcileResult> {
  const { generationService, skillService } = getServices();

  const result: ReconcileResult = {
    status: 'complete',
    bundleId,
    linksCreated: { skillToTool: [], agentToSkill: [] },
    linksSkipped: { skillToTool: [], agentToSkill: [] },
    errors: [],
  };

  try {
    // Get all generations in this bundle
    const allGenerations = await generationService.list();
    const bundleGenerations = allGenerations.filter(
      (g) => g.metadata?.bundleId === bundleId && g.status === 'active'
    );

    if (bundleGenerations.length === 0) {
      logger.info({ bundleId }, 'No active generations found for bundle');
      result.status = 'not_applicable';
      return result;
    }

    // Extract resource IDs by type
    const toolIds: string[] = [];
    const skillIds: string[] = [];
    const agentIds: string[] = [];

    for (const gen of bundleGenerations) {
      const resourceId = (gen.metadata?.resourceId || gen.metadata?.toolId || gen.metadata?.skillId || gen.metadata?.agentId) as string;
      if (!resourceId) continue;

      switch (gen.type) {
        case 'tool':
          toolIds.push(resourceId);
          break;
        case 'skill':
          skillIds.push(resourceId);
          break;
        case 'agent':
          agentIds.push(resourceId);
          break;
      }
    }

    logger.info({
      bundleId,
      toolCount: toolIds.length,
      skillCount: skillIds.length,
      agentCount: agentIds.length,
    }, 'Reconciling bundle');

    // Link tools to skills
    for (const skillId of skillIds) {
      for (const toolId of toolIds) {
        try {
          await skillService.addTool(skillId, toolId);
          result.linksCreated.skillToTool.push(`${skillId}:${toolId}`);
          logger.info({ skillId, toolId, bundleId }, 'Linked tool to skill');
        } catch (err) {
          // ConflictError means already linked - that's OK
          if (err instanceof Error && err.message.includes('already linked')) {
            result.linksSkipped.skillToTool.push(`${skillId}:${toolId}`);
          } else {
            result.errors.push(`skill-tool(${skillId}:${toolId}): ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }
    }

    // Link skills to agents
    for (const agentId of agentIds) {
      for (const skillId of skillIds) {
        try {
          await skillService.assignToAgent(skillId, agentId);
          result.linksCreated.agentToSkill.push(`${agentId}:${skillId}`);
          logger.info({ agentId, skillId, bundleId }, 'Assigned skill to agent');
        } catch (err) {
          // Already assigned - that's OK
          if (err instanceof Error && err.message.includes('already')) {
            result.linksSkipped.agentToSkill.push(`${agentId}:${skillId}`);
          } else {
            result.errors.push(`agent-skill(${agentId}:${skillId}): ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }
    }

    // Update bundle status in all generations
    const totalLinks = result.linksCreated.skillToTool.length + result.linksCreated.agentToSkill.length;
    const totalSkipped = result.linksSkipped.skillToTool.length + result.linksSkipped.agentToSkill.length;
    const bundleStatus = result.errors.length > 0 ? 'partial' : 'complete';

    for (const gen of bundleGenerations) {
      await generationService.updateMetadata(gen.id, {
        bundleStatus,
        bundleReconciledAt: Date.now(),
        bundleLinksCreated: totalLinks,
        bundleLinksSkipped: totalSkipped,
      });
    }

    result.status = result.errors.length > 0 ? 'partial' : 'complete';

    logger.info({
      bundleId,
      status: result.status,
      linksCreated: totalLinks,
      linksSkipped: totalSkipped,
      errors: result.errors.length,
    }, 'Bundle reconciliation complete');

    return result;

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, bundleId }, 'Bundle reconciliation failed');
    result.status = 'failed';
    result.errors.push(message);
    return result;
  }
}

// =============================================================================
// RECONCILE SINGLE GENERATION
// =============================================================================

/**
 * Reconcile a single generation.
 * Creates links based on metadata (linkedToolId, linkedSkillId, etc.)
 *
 * Called after each activation to ensure proper linking.
 */
export async function reconcileGeneration(generationId: string): Promise<ReconcileResult> {
  const { generationService, skillService } = getServices();

  const result: ReconcileResult = {
    status: 'complete',
    generationId,
    linksCreated: { skillToTool: [], agentToSkill: [] },
    linksSkipped: { skillToTool: [], agentToSkill: [] },
    errors: [],
  };

  try {
    const generation = await generationService.getById(generationId);

    if (generation.status !== 'active') {
      result.status = 'not_applicable';
      return result;
    }

    const meta = generation.metadata || {};
    const resourceId = (meta.resourceId || meta.toolId || meta.skillId || meta.agentId) as string;

    if (!resourceId) {
      result.status = 'not_applicable';
      return result;
    }

    // If part of a bundle, delegate to bundle reconciler
    if (meta.bundleId) {
      return reconcileBundle(meta.bundleId as string);
    }

    // Handle individual linking based on type and metadata
    switch (generation.type) {
      case 'skill': {
        // Link tool to skill if linkedToolId in metadata
        const linkedToolId = meta.linkedToolId as string;
        if (linkedToolId) {
          try {
            await skillService.addTool(resourceId, linkedToolId);
            result.linksCreated.skillToTool.push(`${resourceId}:${linkedToolId}`);
            logger.info({ skillId: resourceId, toolId: linkedToolId }, 'Linked tool to skill (via metadata)');
          } catch (err) {
            if (err instanceof Error && err.message.includes('already linked')) {
              result.linksSkipped.skillToTool.push(`${resourceId}:${linkedToolId}`);
            } else {
              result.errors.push(`skill-tool: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }
        }
        // Also check tools array
        const linkedTools = meta.tools as string[] | undefined;
        if (linkedTools && Array.isArray(linkedTools)) {
          for (const toolId of linkedTools) {
            try {
              await skillService.addTool(resourceId, toolId);
              result.linksCreated.skillToTool.push(`${resourceId}:${toolId}`);
            } catch (err) {
              if (err instanceof Error && err.message.includes('already linked')) {
                result.linksSkipped.skillToTool.push(`${resourceId}:${toolId}`);
              } else {
                result.errors.push(`skill-tool: ${err instanceof Error ? err.message : 'Unknown error'}`);
              }
            }
          }
        }
        break;
      }

      case 'agent': {
        // Assign skill to agent if linkedSkillId in metadata
        const linkedSkillId = meta.linkedSkillId as string;
        if (linkedSkillId) {
          try {
            await skillService.assignToAgent(linkedSkillId, resourceId);
            result.linksCreated.agentToSkill.push(`${resourceId}:${linkedSkillId}`);
            logger.info({ agentId: resourceId, skillId: linkedSkillId }, 'Assigned skill to agent (via metadata)');
          } catch (err) {
            if (err instanceof Error && err.message.includes('already')) {
              result.linksSkipped.agentToSkill.push(`${resourceId}:${linkedSkillId}`);
            } else {
              result.errors.push(`agent-skill: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }
        }
        // Also check skills array
        const linkedSkills = meta.skills as string[] | undefined;
        if (linkedSkills && Array.isArray(linkedSkills)) {
          for (const skillId of linkedSkills) {
            try {
              await skillService.assignToAgent(skillId, resourceId);
              result.linksCreated.agentToSkill.push(`${resourceId}:${skillId}`);
            } catch (err) {
              if (err instanceof Error && err.message.includes('already')) {
                result.linksSkipped.agentToSkill.push(`${resourceId}:${skillId}`);
              } else {
                result.errors.push(`agent-skill: ${err instanceof Error ? err.message : 'Unknown error'}`);
              }
            }
          }
        }
        break;
      }

      case 'tool':
        // Tools don't have outgoing links, but might be referenced by skills
        // The skill should handle this during its reconciliation
        result.status = 'not_applicable';
        break;
    }

    // Update metadata with reconciliation info
    await generationService.updateMetadata(generationId, {
      reconciledAt: Date.now(),
      linksCreated: result.linksCreated.skillToTool.length + result.linksCreated.agentToSkill.length,
      linksSkipped: result.linksSkipped.skillToTool.length + result.linksSkipped.agentToSkill.length,
    });

    result.status = result.errors.length > 0 ? 'partial' : 'complete';

    logger.info({
      generationId,
      type: generation.type,
      status: result.status,
      linksCreated: result.linksCreated,
    }, 'Generation reconciliation complete');

    return result;

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, generationId }, 'Generation reconciliation failed');
    result.status = 'failed';
    result.errors.push(message);
    return result;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const BundleReconciler = {
  reconcileBundle,
  reconcileGeneration,
};

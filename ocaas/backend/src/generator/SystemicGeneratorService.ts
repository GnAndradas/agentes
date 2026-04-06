/**
 * Systemic Generator Service (PROMPT 9 + 9B + 9C)
 *
 * Orchestrates creation of related tool + skill + agent bundles
 * using existing generators. Does NOT duplicate generator logic.
 *
 * PROMPT 9B: Added bundleId, consistent metadata via GenerationService
 * PROMPT 9C: Added bundleStatus ('partial' | 'complete') for consistency tracking
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getToolGenerator } from './ToolGenerator.js';
import { getSkillGenerator } from './SkillGenerator.js';
import { getAgentGenerator } from './AgentGenerator.js';
import type { GenerationOutput } from './types.js';

const logger = createLogger('SystemicGenerator');

// ============================================================================
// TYPES
// ============================================================================

export interface BundleInput {
  /** Base name for all resources (will be prefixed) */
  name: string;
  /** Shared description/objective */
  description: string;
  /** What the bundle should accomplish */
  objective: string;
  /** Optional capabilities for agent */
  capabilities?: string[];
}

/** PROMPT 9C: Bundle status for consistency tracking */
export type BundleStatus = 'partial' | 'complete';

export interface BundleOutput {
  success: boolean;
  /** Unique bundle identifier (shared across all generations) */
  bundleId?: string;
  /** PROMPT 9C: Bundle completion status */
  bundleStatus?: BundleStatus;
  /** Generation IDs for each resource */
  toolGenerationId?: string;
  skillGenerationId?: string;
  agentGenerationId?: string;
  /** Resource IDs after activation */
  toolId?: string;
  skillId?: string;
  agentId?: string;
  /** Bundle metadata */
  metadata: {
    bundle: true;
    bundleId?: string;
    bundleStatus?: BundleStatus;
    name: string;
    toolGenerationId?: string;
    skillGenerationId?: string;
    agentGenerationId?: string;
    toolId?: string;
    skillId?: string;
    agentId?: string;
  };
  error?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class SystemicGeneratorService {
  /**
   * Generate a complete bundle: tool → skill → agent
   * All resources are linked together after creation.
   *
   * PROMPT 9B: Consistent error handling, bundleId shared across all generations
   */
  async generateBundle(input: BundleInput): Promise<BundleOutput> {
    const toolGenerator = getToolGenerator();
    const skillGenerator = getSkillGenerator();
    const agentGenerator = getAgentGenerator();
    const { generationService, skillService } = getServices();

    // PROMPT 9B: Generate unique bundleId upfront
    const bundleId = `bundle_${nanoid(12)}`;

    // PROMPT 9C: Initialize with bundleStatus='partial' - only set to 'complete' at end
    const metadata: BundleOutput['metadata'] = {
      bundle: true,
      bundleId,
      bundleStatus: 'partial',
      name: input.name,
    };

    logger.info({ name: input.name, bundleId }, 'Starting bundle generation');

    // =========================================================================
    // STEP 1: Generate TOOL
    // =========================================================================
    let toolOutput: GenerationOutput;
    try {
      toolOutput = await toolGenerator.generate({
        type: 'tool',
        name: `${input.name}-tool`,
        description: `Tool for ${input.description}`,
        prompt: `Create a tool that helps accomplish: ${input.objective}`,
        requirements: ['shell', 'simple'],
      });

      metadata.toolGenerationId = toolOutput.metadata.generationId as string;

      // PROMPT 9B: Update metadata immediately with bundleId
      // PROMPT 9C: bundleStatus='partial' until fully complete
      await generationService.updateMetadata(metadata.toolGenerationId, {
        bundle: true,
        bundleId,
        bundleName: input.name,
        bundleType: 'tool',
        bundleStatus: 'partial',
      });

      logger.info({ generationId: metadata.toolGenerationId, bundleId }, 'Tool generated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool generation failed';
      logger.error({ err, name: input.name, bundleId }, 'Bundle failed at tool generation');
      return { success: false, bundleId, metadata, error: `Tool generation failed: ${message}` };
    }

    // =========================================================================
    // STEP 2: Generate SKILL
    // =========================================================================
    let skillOutput: GenerationOutput;
    try {
      skillOutput = await skillGenerator.generate({
        type: 'skill',
        name: `${input.name}-skill`,
        description: `Skill for ${input.description}`,
        prompt: `Create a skill that uses ${input.name}-tool to accomplish: ${input.objective}`,
        requirements: input.capabilities || ['default'],
      });

      metadata.skillGenerationId = skillOutput.metadata.generationId as string;

      // PROMPT 9B: Update metadata immediately with bundleId
      // PROMPT 9C: bundleStatus='partial' until fully complete
      await generationService.updateMetadata(metadata.skillGenerationId, {
        bundle: true,
        bundleId,
        bundleName: input.name,
        bundleType: 'skill',
        bundleStatus: 'partial',
      });

      logger.info({ generationId: metadata.skillGenerationId, bundleId }, 'Skill generated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Skill generation failed';
      logger.error({ err, name: input.name, bundleId }, 'Bundle failed at skill generation');
      return {
        success: false,
        bundleId,
        metadata,
        toolGenerationId: metadata.toolGenerationId,
        error: `Skill generation failed: ${message}`,
      };
    }

    // =========================================================================
    // STEP 3: Generate AGENT
    // =========================================================================
    let agentOutput: GenerationOutput;
    try {
      agentOutput = await agentGenerator.generate({
        type: 'agent',
        name: `${input.name}-agent`,
        description: `Agent for ${input.description}`,
        prompt: `Create an agent that uses ${input.name}-skill to accomplish: ${input.objective}`,
        requirements: input.capabilities || ['general'],
      });

      metadata.agentGenerationId = agentOutput.metadata.generationId as string;

      // PROMPT 9B: Update metadata immediately with bundleId
      // PROMPT 9C: bundleStatus='partial' until fully complete
      await generationService.updateMetadata(metadata.agentGenerationId, {
        bundle: true,
        bundleId,
        bundleName: input.name,
        bundleType: 'agent',
        bundleStatus: 'partial',
      });

      logger.info({ generationId: metadata.agentGenerationId, bundleId }, 'Agent generated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent generation failed';
      logger.error({ err, name: input.name, bundleId }, 'Bundle failed at agent generation');
      return {
        success: false,
        bundleId,
        metadata,
        toolGenerationId: metadata.toolGenerationId,
        skillGenerationId: metadata.skillGenerationId,
        error: `Agent generation failed: ${message}`,
      };
    }

    // =========================================================================
    // STEP 4: Approve and Activate all (in order)
    // =========================================================================
    try {
      // Approve and activate tool
      await generationService.approve(metadata.toolGenerationId!, 'system:bundle');
      await toolGenerator.activate(metadata.toolGenerationId!);
      const toolGen = await generationService.getById(metadata.toolGenerationId!);
      metadata.toolId = (toolGen.metadata?.resourceId || toolGen.metadata?.toolId) as string;

      // Approve and activate skill
      await generationService.approve(metadata.skillGenerationId!, 'system:bundle');
      await skillGenerator.activate(metadata.skillGenerationId!);
      const skillGen = await generationService.getById(metadata.skillGenerationId!);
      metadata.skillId = (skillGen.metadata?.resourceId || skillGen.metadata?.skillId) as string;

      // Approve and activate agent
      await generationService.approve(metadata.agentGenerationId!, 'system:bundle');
      await agentGenerator.activate(metadata.agentGenerationId!);
      const agentGen = await generationService.getById(metadata.agentGenerationId!);
      metadata.agentId = (agentGen.metadata?.resourceId || agentGen.metadata?.agentId) as string;

      logger.info({
        bundleId,
        toolId: metadata.toolId,
        skillId: metadata.skillId,
        agentId: metadata.agentId,
      }, 'All resources activated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Activation failed';
      logger.error({ err, name: input.name, bundleId }, 'Bundle failed at activation');
      return {
        success: false,
        bundleId,
        metadata,
        toolGenerationId: metadata.toolGenerationId,
        skillGenerationId: metadata.skillGenerationId,
        agentGenerationId: metadata.agentGenerationId,
        error: `Activation failed: ${message}`,
      };
    }

    // =========================================================================
    // STEP 5: Link resources together
    // =========================================================================
    try {
      // Link tool to skill
      if (metadata.skillId && metadata.toolId) {
        await skillService.addTool(metadata.skillId, metadata.toolId);
        logger.info({ skillId: metadata.skillId, toolId: metadata.toolId, bundleId }, 'Tool linked to skill');
      }

      // Assign skill to agent
      if (metadata.agentId && metadata.skillId) {
        await skillService.assignToAgent(metadata.skillId, metadata.agentId);
        logger.info({ agentId: metadata.agentId, skillId: metadata.skillId, bundleId }, 'Skill assigned to agent');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Linking failed';
      logger.error({ err, name: input.name, bundleId }, 'Bundle failed at linking');
      return {
        success: false,
        bundleId,
        metadata,
        toolGenerationId: metadata.toolGenerationId,
        skillGenerationId: metadata.skillGenerationId,
        agentGenerationId: metadata.agentGenerationId,
        toolId: metadata.toolId,
        skillId: metadata.skillId,
        agentId: metadata.agentId,
        error: `Linking failed: ${message}`,
      };
    }

    // =========================================================================
    // STEP 6: Final metadata update with cross-references + bundleStatus='complete'
    // =========================================================================
    try {
      // PROMPT 9B: Use GenerationService.updateMetadata for all updates
      // PROMPT 9C: Mark bundleStatus='complete' now that all steps succeeded
      await generationService.updateMetadata(metadata.toolGenerationId!, {
        bundleSkillId: metadata.skillId,
        bundleAgentId: metadata.agentId,
        bundleStatus: 'complete',
      });

      await generationService.updateMetadata(metadata.skillGenerationId!, {
        bundleToolId: metadata.toolId,
        bundleAgentId: metadata.agentId,
        bundleStatus: 'complete',
      });

      await generationService.updateMetadata(metadata.agentGenerationId!, {
        bundleToolId: metadata.toolId,
        bundleSkillId: metadata.skillId,
        bundleStatus: 'complete',
      });

      // PROMPT 9C: Update local metadata to reflect completion
      metadata.bundleStatus = 'complete';
    } catch (err) {
      // Non-fatal for cross-refs, but bundleStatus remains 'partial' if this fails
      logger.warn({ err, bundleId }, 'Failed to update final bundle metadata (non-fatal)');
    }

    logger.info({
      bundleId,
      name: input.name,
      toolId: metadata.toolId,
      skillId: metadata.skillId,
      agentId: metadata.agentId,
    }, 'Bundle generation completed');

    return {
      success: true,
      bundleId,
      bundleStatus: metadata.bundleStatus,
      toolGenerationId: metadata.toolGenerationId,
      skillGenerationId: metadata.skillGenerationId,
      agentGenerationId: metadata.agentGenerationId,
      toolId: metadata.toolId,
      skillId: metadata.skillId,
      agentId: metadata.agentId,
      metadata,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: SystemicGeneratorService | null = null;

export function getSystemicGenerator(): SystemicGeneratorService {
  if (!instance) {
    instance = new SystemicGeneratorService();
  }
  return instance;
}

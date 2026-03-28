import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getWorkspaceSync } from '../openclaw/index.js';
import { getAIClient } from './AIClient.js';
import { getValidator } from './Validator.js';
import { skillTemplate } from './templates/index.js';
import { ForbiddenError } from '../utils/errors.js';
import {
  canGenerateSkillAutonomously,
  requiresApprovalForSkillGeneration,
} from '../config/autonomy.js';
import type { GenerationRequest, GeneratedFile, GenerationOutput } from './types.js';

const logger = createLogger('SkillGenerator');

export type GenerationSource = 'api' | 'system' | 'orchestrator';

export class SkillGenerator {
  async generate(request: GenerationRequest, source: GenerationSource = 'api'): Promise<GenerationOutput> {
    // Check autonomy permissions for non-human sources
    if (source !== 'api') {
      if (!canGenerateSkillAutonomously()) {
        throw new ForbiddenError('Autonomous skill generation is disabled by autonomy policy');
      }
    }

    const { generationService } = getServices();
    const aiClient = getAIClient();
    const validator = getValidator();

    // Create generation record
    const generation = await generationService.create({
      type: 'skill',
      name: request.name,
      description: request.description,
      prompt: request.prompt,
    });

    try {
      let files: GeneratedFile[];
      let capabilities: string[] = [];

      if (aiClient.isAvailable()) {
        // Use AI to generate
        const response = await aiClient.generate({
          type: 'skill',
          name: request.name,
          description: request.description,
          requirements: request.requirements,
        });

        const parsed = JSON.parse(response.content);
        files = Object.entries(parsed.files).map(([path, content]) => ({
          path,
          content: content as string,
        }));
        capabilities = parsed.capabilities || [];
      } else {
        // Use template fallback
        logger.info({ name: request.name }, 'Using template fallback (AI not available)');
        const templateFiles = skillTemplate(
          request.name,
          request.description,
          request.requirements || ['default']
        );
        files = Object.entries(templateFiles).map(([path, content]) => ({
          path,
          content,
        }));
        capabilities = request.requirements || ['default'];
      }

      // Validate
      const validation = validator.validateSkill(files);

      if (!validation.valid) {
        await generationService.markFailed(generation.id, validation.errors.join('; '));
        return {
          files: [],
          metadata: { validation, generationId: generation.id },
        };
      }

      // Mark as generated
      const targetPath = `skills/${request.name}`;
      await generationService.markGenerated(generation.id, {
        files: files.map(f => ({ path: f.path, size: f.content.length })),
        capabilities,
      }, targetPath);

      // Move to pending approval
      await generationService.markPendingApproval(generation.id, {
        valid: true,
        warnings: validation.warnings,
        filesCount: files.length,
      });

      logger.info({ generationId: generation.id, name: request.name }, 'Skill generation completed');

      return {
        files,
        metadata: {
          generationId: generation.id,
          capabilities,
          validation,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await generationService.markFailed(generation.id, message);
      throw err;
    }
  }

  async activate(generationId: string): Promise<void> {
    const { generationService, skillService } = getServices();
    const workspaceSync = getWorkspaceSync();

    const generation = await generationService.getById(generationId);

    if (generation.status !== 'approved') {
      throw new Error('Can only activate approved generations');
    }

    const content = generation.generatedContent as { files: Array<{ path: string; size: number }>; capabilities: string[] };
    const files: Record<string, string> = {};

    // Reconstruct files from stored content
    // In production, files would be stored properly
    const templateFiles = skillTemplate(
      generation.name,
      generation.description || '',
      content.capabilities || []
    );

    for (const [path, fileContent] of Object.entries(templateFiles)) {
      files[path] = fileContent;
    }

    // Write to workspace
    const skillPath = await workspaceSync.writeSkill(generation.name, files);

    // Create skill in DB
    await skillService.create({
      name: generation.name,
      description: generation.description,
      path: skillPath,
      capabilities: content.capabilities,
    });

    // Mark generation as active
    await generationService.activate(generationId);

    logger.info({ generationId, name: generation.name }, 'Skill activated');
  }

  // Check if generation requires approval
  requiresApproval(source: GenerationSource): boolean {
    if (source === 'api') return false; // Human-initiated via API doesn't need approval
    return requiresApprovalForSkillGeneration();
  }
}

let skillGeneratorInstance: SkillGenerator | null = null;

export function getSkillGenerator(): SkillGenerator {
  if (!skillGeneratorInstance) {
    skillGeneratorInstance = new SkillGenerator();
  }
  return skillGeneratorInstance;
}

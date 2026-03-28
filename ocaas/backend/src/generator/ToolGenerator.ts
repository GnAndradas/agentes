import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getWorkspaceSync } from '../openclaw/index.js';
import { getAIClient } from './AIClient.js';
import { getValidator } from './Validator.js';
import { toolTemplateShell, toolTemplatePython } from './templates/index.js';
import { ForbiddenError } from '../utils/errors.js';
import {
  canGenerateToolAutonomously,
  requiresApprovalForToolGeneration,
} from '../config/autonomy.js';
import type { GenerationRequest, GenerationOutput } from './types.js';

export type GenerationSource = 'api' | 'system' | 'orchestrator';

const logger = createLogger('ToolGenerator');

export class ToolGenerator {
  async generate(request: GenerationRequest, source: GenerationSource = 'api'): Promise<GenerationOutput> {
    // Check autonomy permissions for non-human sources
    if (source !== 'api') {
      if (!canGenerateToolAutonomously()) {
        throw new ForbiddenError('Autonomous tool generation is disabled by autonomy policy');
      }
    }

    const { generationService } = getServices();
    const aiClient = getAIClient();
    const validator = getValidator();

    const generation = await generationService.create({
      type: 'tool',
      name: request.name,
      description: request.description,
      prompt: request.prompt,
    });

    try {
      let content: string;
      let toolType: 'sh' | 'py' = 'sh';
      let inputSchema: Record<string, unknown> | undefined;
      let outputSchema: Record<string, unknown> | undefined;

      if (aiClient.isAvailable()) {
        const response = await aiClient.generate({
          type: 'tool',
          name: request.name,
          description: request.description,
          requirements: request.requirements,
        });

        const parsed = JSON.parse(response.content);
        content = parsed.content;
        toolType = parsed.type || 'sh';
        inputSchema = parsed.inputSchema;
        outputSchema = parsed.outputSchema;
      } else {
        logger.info({ name: request.name }, 'Using template fallback');
        // Determine type from requirements
        const usePython = request.requirements?.some(r =>
          r.toLowerCase().includes('python') || r.toLowerCase().includes('json')
        );
        toolType = usePython ? 'py' : 'sh';
        content = toolType === 'py'
          ? toolTemplatePython(request.name, request.description)
          : toolTemplateShell(request.name, request.description);
      }

      // Validate
      const validation = validator.validateTool(content, toolType);

      if (!validation.valid) {
        await generationService.markFailed(generation.id, validation.errors.join('; '));
        return {
          files: [],
          metadata: { validation, generationId: generation.id },
        };
      }

      const targetPath = `tools/${request.name}.${toolType}`;
      await generationService.markGenerated(generation.id, {
        type: toolType,
        size: content.length,
        inputSchema,
        outputSchema,
      }, targetPath);

      await generationService.markPendingApproval(generation.id, {
        valid: true,
        warnings: validation.warnings,
        type: toolType,
      });

      logger.info({ generationId: generation.id, name: request.name, type: toolType }, 'Tool generation completed');

      return {
        files: [{ path: `${request.name}.${toolType}`, content }],
        metadata: {
          generationId: generation.id,
          type: toolType,
          inputSchema,
          outputSchema,
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
    const { generationService, toolService } = getServices();
    const workspaceSync = getWorkspaceSync();

    const generation = await generationService.getById(generationId);

    if (generation.status !== 'approved') {
      throw new Error('Can only activate approved generations');
    }

    const content = generation.generatedContent as {
      type: 'sh' | 'py';
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    };

    // Regenerate content (in production, store actual content)
    const toolContent = content.type === 'py'
      ? toolTemplatePython(generation.name, generation.description || '')
      : toolTemplateShell(generation.name, generation.description || '');

    // Write to workspace
    const toolPath = await workspaceSync.writeTool(generation.name, toolContent, content.type);

    // Create tool in DB
    await toolService.create({
      name: generation.name,
      description: generation.description,
      path: toolPath,
      type: 'script',
      inputSchema: content.inputSchema,
      outputSchema: content.outputSchema,
    });

    await generationService.activate(generationId);

    logger.info({ generationId, name: generation.name }, 'Tool activated');
  }

  // Check if generation requires approval
  requiresApproval(source: GenerationSource): boolean {
    if (source === 'api') return false; // Human-initiated via API doesn't need approval
    return requiresApprovalForToolGeneration();
  }
}

let toolGeneratorInstance: ToolGenerator | null = null;

export function getToolGenerator(): ToolGenerator {
  if (!toolGeneratorInstance) {
    toolGeneratorInstance = new ToolGenerator();
  }
  return toolGeneratorInstance;
}

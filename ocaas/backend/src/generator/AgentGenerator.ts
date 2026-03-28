import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getAIClient } from './AIClient.js';
import { getValidator } from './Validator.js';
import { agentTemplate } from './templates/index.js';
import type { GenerationRequest, GenerationOutput } from './types.js';
import type { AgentType } from '../types/domain.js';

const logger = createLogger('AgentGenerator');

export class AgentGenerator {
  async generate(request: GenerationRequest): Promise<GenerationOutput> {
    const { generationService } = getServices();
    const aiClient = getAIClient();
    const validator = getValidator();

    const generation = await generationService.create({
      type: 'agent',
      name: request.name,
      description: request.description,
      prompt: request.prompt,
    });

    try {
      let agentType: AgentType = 'general';
      let capabilities: string[] = [];
      let config: Record<string, unknown> = {};

      if (aiClient.isAvailable()) {
        const response = await aiClient.generate({
          type: 'agent',
          name: request.name,
          description: request.description,
          requirements: request.requirements,
        });

        const parsed = JSON.parse(response.content);
        agentType = parsed.type || 'general';
        capabilities = parsed.capabilities || [];
        config = parsed.config || {};
      } else {
        logger.info({ name: request.name }, 'Using template fallback');
        const template = agentTemplate(
          request.name,
          request.description,
          'specialist',
          request.requirements || []
        );
        agentType = template.type;
        capabilities = template.capabilities;
        config = template.config;
      }

      // Validate
      const validation = validator.validateAgent({
        name: request.name,
        type: agentType,
        capabilities,
        config,
      });

      if (!validation.valid) {
        await generationService.markFailed(generation.id, validation.errors.join('; '));
        return {
          files: [],
          metadata: { validation, generationId: generation.id },
        };
      }

      await generationService.markGenerated(generation.id, {
        type: agentType,
        capabilities,
        config,
      }, `agents/${request.name}`);

      await generationService.markPendingApproval(generation.id, {
        valid: true,
        warnings: validation.warnings,
        type: agentType,
        capabilitiesCount: capabilities.length,
      });

      logger.info({ generationId: generation.id, name: request.name, type: agentType }, 'Agent generation completed');

      return {
        files: [],
        metadata: {
          generationId: generation.id,
          type: agentType,
          capabilities,
          config,
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
    const { generationService, agentService } = getServices();

    const generation = await generationService.getById(generationId);

    if (generation.status !== 'approved') {
      throw new Error('Can only activate approved generations');
    }

    const content = generation.generatedContent as {
      type: AgentType;
      capabilities: string[];
      config: Record<string, unknown>;
    };

    // Create agent in DB
    await agentService.create({
      name: generation.name,
      description: generation.description,
      type: content.type,
      capabilities: content.capabilities,
      config: content.config,
    });

    await generationService.activate(generationId);

    logger.info({ generationId, name: generation.name }, 'Agent activated');
  }
}

let agentGeneratorInstance: AgentGenerator | null = null;

export function getAgentGenerator(): AgentGenerator {
  if (!agentGeneratorInstance) {
    agentGeneratorInstance = new AgentGenerator();
  }
  return agentGeneratorInstance;
}

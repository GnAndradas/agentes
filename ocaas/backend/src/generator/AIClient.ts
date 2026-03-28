import { getGateway } from '../openclaw/gateway.js';
import { createLogger } from '../utils/logger.js';
import { GenerationError } from '../utils/errors.js';

const logger = createLogger('AIClient');

export interface AIGenerationRequest {
  type: 'skill' | 'tool' | 'agent';
  name: string;
  description: string;
  requirements?: string[];
}

export interface AIGenerationResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export class AIClient {
  isAvailable(): boolean {
    return getGateway().isConnected();
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResponse> {
    const gateway = getGateway();

    if (!gateway.isConnected()) {
      throw new GenerationError('OpenClaw Gateway not connected. Cannot generate.');
    }

    const systemPrompt = this.buildSystemPrompt(request.type);
    const userPrompt = this.buildUserPrompt(request);

    const result = await gateway.generate({
      systemPrompt,
      userPrompt,
      maxTokens: 4096,
    });

    if (!result.success || !result.content) {
      throw new GenerationError(`Generation failed: ${result.error ?? 'No content returned'}`);
    }

    logger.info({
      type: request.type,
      name: request.name,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    }, 'AI generation completed via OpenClaw Gateway');

    return {
      content: result.content,
      usage: result.usage,
    };
  }

  private buildSystemPrompt(type: 'skill' | 'tool' | 'agent'): string {
    const base = `You are an expert at generating OpenClaw artifacts. Generate clean, production-ready code following best practices.

Output ONLY the requested content in the exact format specified. Do not include explanations or markdown code blocks.`;

    switch (type) {
      case 'skill':
        return `${base}

For skills, generate a JSON object with this structure:
{
  "files": {
    "SKILL.md": "markdown content",
    "agent-instructions.md": "markdown content"
  },
  "capabilities": ["cap1", "cap2"]
}`;

      case 'tool':
        return `${base}

For tools, generate a JSON object with this structure:
{
  "type": "sh" or "py",
  "content": "script content with proper shebang",
  "inputSchema": { JSON schema for inputs },
  "outputSchema": { JSON schema for outputs }
}`;

      case 'agent':
        return `${base}

For agents, generate a JSON object with this structure:
{
  "type": "general" | "specialist" | "orchestrator",
  "capabilities": ["cap1", "cap2"],
  "config": { configuration object }
}`;
    }
  }

  private buildUserPrompt(request: AIGenerationRequest): string {
    let prompt = `Generate a ${request.type} named "${request.name}".

Description: ${request.description}`;

    if (request.requirements && request.requirements.length > 0) {
      prompt += `\n\nRequirements:\n${request.requirements.map(r => `- ${r}`).join('\n')}`;
    }

    return prompt;
  }
}

let aiClientInstance: AIClient | null = null;

export function getAIClient(): AIClient {
  if (!aiClientInstance) {
    aiClientInstance = new AIClient();
  }
  return aiClientInstance;
}

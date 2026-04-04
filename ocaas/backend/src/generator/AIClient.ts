import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
import { createLogger } from '../utils/logger.js';
import { GenerationError, BudgetExceededError } from '../utils/errors.js';
import { parseJsonFromLLM } from '../utils/helpers.js';
import { getGlobalBudgetManager } from '../budget/index.js';

const logger = createLogger('AIClient');

export interface AIGenerationRequest {
  type: 'skill' | 'tool' | 'agent';
  name: string;
  description: string;
  prompt: string; // User-provided prompt - primary source for generation
  requirements?: string[];
}

export interface AIGenerationResponse<T = unknown> {
  content: string; // Raw LLM response
  parsed: T; // Parsed JSON object
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Response structures for each type
export interface SkillAIResponse {
  files: Record<string, string>;
  capabilities: string[];
}

export interface ToolAIResponse {
  type: 'sh' | 'py';
  content: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface AgentAIResponse {
  type: 'general' | 'specialist' | 'orchestrator';
  capabilities: string[];
  config: Record<string, unknown>;
}

export class AIClient {
  /**
   * Check if AI generation is available.
   * This performs a REAL async check - not cached state.
   * For sync checks, use isConfigured() instead.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const status = await getOpenClawAdapter().getStatus();
      return status.rest.reachable && status.rest.authenticated;
    } catch {
      return false;
    }
  }

  /**
   * Sync check if gateway is configured (has API key).
   * Does NOT guarantee connectivity - use isAvailable() for real check.
   */
  isConfigured(): boolean {
    return getOpenClawAdapter().isConfigured();
  }

  /**
   * Generate content using OpenClaw LLM
   *
   * Uses request.prompt as the primary input (user-provided)
   * Adds structured system prompt based on type to ensure JSON output
   *
   * IMPORTANT: No precheck of connectivity. The real request determines
   * if the gateway is available. This avoids blocking on stale cached state.
   *
   * BUDGET INTEGRATION: Checks budget before generation.
   * May block if budget exceeded.
   */
  async generate<T>(request: AIGenerationRequest, taskId?: string, agentId?: string): Promise<AIGenerationResponse<T>> {
    const adapter = getOpenClawAdapter();
    const budgetManager = getGlobalBudgetManager();

    // BUDGET CHECK: Generation uses 'deep' tier (large output)
    const budgetCheck = budgetManager.checkBudget({
      task_id: taskId,
      agent_id: agentId,
      tier: 'deep', // Generation typically uses more tokens
      operation: 'generation',
    });

    if (budgetCheck.decision === 'block') {
      logger.warn({
        type: request.type,
        name: request.name,
        budget_decision: 'block',
        reason: budgetCheck.reason,
        current_cost: budgetCheck.current_cost_usd,
        limit: budgetCheck.limit_usd,
      }, 'BUDGET BLOCK: AI generation blocked due to budget limit');

      throw new BudgetExceededError(
        `Generation blocked: ${budgetCheck.reason}`,
        budgetCheck.scope,
        budgetCheck.current_cost_usd,
        budgetCheck.limit_usd
      );
    }

    if (budgetCheck.decision === 'warn') {
      logger.warn({
        type: request.type,
        name: request.name,
        budget_decision: 'warn',
        reason: budgetCheck.reason,
        usage_pct: budgetCheck.usage_pct,
      }, 'BUDGET WARNING: Approaching budget limit for generation');
    }

    // No precheck - let the actual request determine connectivity
    const systemPrompt = this.buildSystemPrompt(request.type);
    const userPrompt = this.buildUserPrompt(request);

    const result = await adapter.generate({
      systemPrompt,
      userPrompt,
      maxTokens: 8192, // Increased for larger generations
    });

    if (!result.success || !result.content) {
      throw new GenerationError(`Generation failed: ${result.error?.message ?? 'No content returned'}`);
    }

    // BUDGET: Record actual cost
    const inputTokens = result.usage?.inputTokens || 1200; // deep tier estimate
    const outputTokens = result.usage?.outputTokens || 800;
    budgetManager.recordCost({
      task_id: taskId,
      agent_id: agentId,
      operation: 'generation',
      tier: 'deep',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: budgetCheck.estimated_cost_usd,
      budget_decision: budgetCheck.decision,
    });

    // Parse JSON from LLM response (handles markdown fences, etc.)
    let parsed: T;
    try {
      parsed = parseJsonFromLLM<T>(result.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'JSON parse error';
      logger.error({ content: result.content.slice(0, 500) }, `Failed to parse LLM response: ${message}`);
      throw new GenerationError(`Invalid LLM response: ${message}`);
    }

    logger.info({
      type: request.type,
      name: request.name,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      budget_decision: budgetCheck.decision,
    }, 'AI generation completed via OpenClaw Gateway');

    return {
      content: result.content,
      parsed,
      usage: result.usage,
    };
  }

  private buildSystemPrompt(type: 'skill' | 'tool' | 'agent'): string {
    const base = `You are an expert at generating OpenClaw artifacts. Generate clean, production-ready code following best practices.

IMPORTANT: Output ONLY valid JSON in the exact structure specified below. No markdown, no explanations, just the JSON object.`;

    switch (type) {
      case 'skill':
        return `${base}

Generate a JSON object with this exact structure:
{
  "files": {
    "SKILL.md": "# Skill Name\\n\\nComplete markdown documentation for the skill...",
    "agent-instructions.md": "# Instructions\\n\\nDetailed instructions for how an agent should use this skill..."
  },
  "capabilities": ["capability1", "capability2"]
}

The files object must contain at least SKILL.md and agent-instructions.md with real, useful content.
Capabilities should be specific, actionable strings describing what this skill enables.`;

      case 'tool':
        return `${base}

Generate a JSON object with this exact structure:
{
  "type": "sh" or "py",
  "content": "#!/bin/bash\\n\\n# Complete script content with proper error handling...",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [...]
  },
  "outputSchema": {
    "type": "object",
    "properties": { ... }
  }
}

The content must be a complete, executable script with proper shebang.
Use "py" for Python scripts (#!/usr/bin/env python3) or "sh" for shell scripts.
Include proper error handling and input validation in the script.`;

      case 'agent':
        return `${base}

Generate a JSON object with this exact structure:
{
  "type": "general" | "specialist" | "orchestrator",
  "capabilities": ["capability1", "capability2"],
  "config": {
    "model": "claude-3-sonnet",
    "temperature": 0.7,
    "maxTokens": 4096,
    ... other configuration
  }
}

Type should be:
- "general" for versatile agents handling varied tasks
- "specialist" for agents focused on specific domains
- "orchestrator" for agents that coordinate other agents

Capabilities should describe specific abilities.
Config should include model settings and any agent-specific parameters.`;
    }
  }

  private buildUserPrompt(request: AIGenerationRequest): string {
    // Use the user-provided prompt as primary content
    let prompt = request.prompt;

    // Append context if not already in prompt
    if (!prompt.includes(request.name)) {
      prompt = `Name: ${request.name}\n\n${prompt}`;
    }

    if (request.description && !prompt.includes(request.description)) {
      prompt = `Description: ${request.description}\n\n${prompt}`;
    }

    if (request.requirements && request.requirements.length > 0) {
      const reqText = request.requirements.map(r => `- ${r}`).join('\n');
      if (!prompt.includes(reqText)) {
        prompt += `\n\nAdditional Requirements:\n${reqText}`;
      }
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

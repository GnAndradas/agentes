import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
import { createLogger } from '../utils/logger.js';
import { GenerationError, BudgetExceededError, AIGenerationError } from '../utils/errors.js';
import { parseJsonFromLLM } from '../utils/helpers.js';
import { getGlobalBudgetManager } from '../budget/index.js';
import type { AIErrorStage, AIErrorType } from '../types/contracts.js';

// Re-export for convenience
export { AIGenerationError } from '../utils/errors.js';

const logger = createLogger('AIClient');

// PROMPT 16B: Default agent for generation via agent runtime
const GENERATOR_AGENT_ID = 'default-general-agent';

export interface AIGenerationRequest {
  type: 'skill' | 'tool' | 'agent';
  name: string;
  description: string;
  prompt: string; // User-provided prompt - primary source for generation
  requirements?: string[];
}

/**
 * PROMPT 19: Detailed AI error info for traceability
 */
export interface AIErrorInfo {
  type: AIErrorType;
  stage: AIErrorStage;
  message: string;
  code?: string;
  rawResponseSnippet?: string;
}

export interface AIGenerationResponse<T = unknown> {
  content: string; // Raw LLM response
  parsed: T; // Parsed JSON object
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** PROMPT 16B: Runtime mode used */
  runtime?: 'agent' | 'chat_completion';
  // PROMPT 19: Detailed tracking fields
  /** Request was started */
  requestStarted?: boolean;
  /** Request reached gateway */
  reachedGateway?: boolean;
  /** Raw response was received */
  rawResponseReceived?: boolean;
  /** Content was usable */
  contentUsable?: boolean;
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
   * PROMPT 16B: Primary path is now agent runtime via /hooks/agent.
   * Falls back to /v1/chat/completions if agent runtime fails.
   *
   * Uses request.prompt as the primary input (user-provided)
   * Adds structured system prompt based on type to ensure JSON output
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

    const systemPrompt = this.buildSystemPrompt(request.type);
    const userPrompt = this.buildUserPrompt(request);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

    // PROMPT 16B: Try agent runtime first (PRIMARY PATH)
    let content: string | undefined;
    let runtime: 'agent' | 'chat_completion' = 'chat_completion';

    if (adapter.isHooksConfigured()) {
      logger.debug({
        type: request.type,
        name: request.name,
        agentId: GENERATOR_AGENT_ID,
      }, 'Attempting generation via agent runtime (PRIMARY)');

      try {
        const agentResult = await adapter.executeViaHooks({
          agentId: GENERATOR_AGENT_ID,
          prompt: fullPrompt,
          name: `OCAAS Generator: ${request.type}/${request.name}`,
        });

        if (agentResult.success && agentResult.response) {
          // Validate response is usable (non-empty, can be parsed)
          const trimmed = agentResult.response.trim();
          if (trimmed.length > 10) {
            content = trimmed;
            runtime = 'agent';
            logger.info({
              type: request.type,
              name: request.name,
              executionMode: agentResult.executionMode,
              responseLength: content.length,
            }, 'Generation succeeded via agent runtime');
          } else {
            logger.warn({
              type: request.type,
              name: request.name,
              responseLength: trimmed.length,
            }, 'Agent runtime returned empty/short response, falling back');
          }
        } else {
          logger.warn({
            type: request.type,
            name: request.name,
            error: agentResult.error?.message,
            fallbackReason: agentResult.fallbackReason,
          }, 'Agent runtime failed, falling back to chat_completion');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.warn({
          type: request.type,
          name: request.name,
          error: errMsg,
        }, 'Agent runtime threw exception, falling back to chat_completion');
      }
    } else {
      logger.debug({
        type: request.type,
        name: request.name,
      }, 'Hooks not configured, using chat_completion directly');
    }

    // PROMPT 19: Track detailed state for traceability
    let requestStarted = false;
    let reachedGateway = false;
    let rawResponseReceived = false;

    // FALLBACK: Use /v1/chat/completions if agent runtime didn't produce content
    if (!content) {
      requestStarted = true;

      try {
        const result = await adapter.generate({
          systemPrompt,
          userPrompt,
          maxTokens: 8192,
        });

        // PROMPT 19: We reached gateway if we got any response (success or error)
        reachedGateway = true;

        if (!result.success) {
          // PROMPT 19: Technical error from gateway/provider
          const errMsg = result.error?.message ?? 'Unknown gateway error';
          throw AIGenerationError.technical(
            'provider_error',
            `Gateway error: ${errMsg}`,
            result.error?.code
          );
        }

        if (!result.content) {
          // PROMPT 19: No response content
          throw AIGenerationError.technical('no_response', 'Gateway returned success but no content');
        }

        rawResponseReceived = true;
        content = result.content;
        runtime = 'chat_completion';

        logger.info({
          type: request.type,
          name: request.name,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        }, 'Generation completed via chat_completion (fallback)');
      } catch (err) {
        // Re-throw AIGenerationError as-is
        if (err instanceof AIGenerationError) {
          throw err;
        }
        // PROMPT 19: Connection/network error
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND') || errMsg.includes('fetch')) {
          throw AIGenerationError.technical('gateway_unreachable', `Cannot reach gateway: ${errMsg}`);
        }
        if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
          throw AIGenerationError.technical('timeout', `Request timed out: ${errMsg}`);
        }
        throw AIGenerationError.technical('unknown', `Unexpected error: ${errMsg}`);
      }
    } else {
      // Agent runtime succeeded - mark all as successful
      requestStarted = true;
      reachedGateway = true;
      rawResponseReceived = true;
    }

    // BUDGET: Record cost (estimate for agent runtime, actual for chat_completion)
    const inputTokens = 1200; // deep tier estimate
    const outputTokens = 800;
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
      parsed = parseJsonFromLLM<T>(content);
    } catch (err) {
      // PROMPT 19: Parse failed - unusable response
      const message = err instanceof Error ? err.message : 'JSON parse error';
      logger.error({ content: content.slice(0, 500), runtime }, `Failed to parse LLM response: ${message}`);
      throw AIGenerationError.unusableResponse(
        'parse_failed',
        `Invalid JSON in LLM response: ${message}`,
        content.slice(0, 500)
      );
    }

    logger.info({
      type: request.type,
      name: request.name,
      runtime,
      budget_decision: budgetCheck.decision,
    }, `AI generation completed via OpenClaw (${runtime})`);

    return {
      content,
      parsed,
      runtime,
      // PROMPT 19: Detailed tracking
      requestStarted,
      reachedGateway,
      rawResponseReceived,
      contentUsable: true, // If we got here, content is usable
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

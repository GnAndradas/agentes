/**
 * Prompt Tiers for LLM Invocation
 *
 * Three tiers of prompts for controlled LLM usage:
 * - SHORT: Quick classification (~100 tokens)
 * - MEDIUM: Standard decision (~500 tokens)
 * - DEEP: Complex planning (~1500 tokens)
 */

import type { PromptTier, TaskClassification } from './types.js';
import { PROMPT_TIER, PROMPT_TIER_CONFIGS } from './types.js';

// =============================================================================
// SYSTEM PROMPTS BY TIER
// =============================================================================

const SYSTEM_PROMPT_SHORT = `You are a task classifier. Respond with JSON only.
Classify the task into: simple, moderate, complex, or requires_planning.
Output: {"category":"...", "taskType":"...", "complexity":"low|medium|high", "requiredCapabilities":["..."], "mayNeedDecomposition":bool, "mayNeedHumanReview":bool, "confidence":0.0-1.0}`;

const SYSTEM_PROMPT_MEDIUM = `You are a task decision assistant for an AI agent system.
Analyze the task and decide the best course of action.

DECISION TYPES:
- assign: Task can be assigned to an agent
- subdivide: Task should be broken into subtasks
- create_resource: Need to create new agent/skill/tool
- escalate: Needs human intervention
- wait: Waiting for approval/dependency

OUTPUT JSON:
{
  "decisionType": "assign|subdivide|create_resource|escalate|wait",
  "reasoning": "Brief explanation (1-2 sentences)",
  "confidence": 0.0-1.0,
  "requiredCapabilities": ["capability1", "capability2"],
  "suggestedAgent": "agent_id or null",
  "needsHumanReview": boolean,
  "subtaskCount": number (if subdivide)
}

Be decisive. Prefer assigning over subdividing for simple tasks.`;

const SYSTEM_PROMPT_DEEP = `You are an expert task planner for an AI agent orchestration system.
Your job is to deeply analyze complex tasks and provide comprehensive execution plans.

TASK TYPES:
- coding, testing, research, analysis, deployment, documentation, design, security, orchestration, generic

COMPLEXITY FACTORS:
- low: Single action, clear outcome
- medium: Multiple steps, some decisions needed
- high: Many steps, dependencies, or uncertainty

CAPABILITY GUIDELINES:
- Use lowercase, hyphenated terms (e.g., "code-review", "api-integration")
- Be specific but not overly narrow

DECOMPOSITION:
- Only subdivide if task has 2+ distinct phases
- Each subtask should be independently executable
- Mark dependencies between subtasks

OUTPUT JSON:
{
  "intent": "Core goal of the task (1-2 sentences)",
  "taskType": "category",
  "complexity": "low|medium|high",
  "complexityReason": "Why this complexity level",
  "requiredCapabilities": ["cap1", "cap2"],
  "optionalCapabilities": ["nice-to-have"],
  "suggestedTools": ["tool1", "tool2"],
  "canBeSubdivided": boolean,
  "subdivisionReason": "Why/why not",
  "suggestedSubtasks": [
    {
      "title": "Subtask title",
      "description": "What to do",
      "type": "category",
      "requiredCapabilities": ["caps"],
      "order": 1,
      "dependsOnPrevious": boolean,
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "riskFactors": ["potential blockers"],
  "estimatedDuration": "quick|normal|long",
  "requiresHumanReview": boolean,
  "humanReviewReason": "Why/why not",
  "confidence": 0.0-1.0
}

Be thorough but practical. Focus on actionable recommendations.`;

// =============================================================================
// USER PROMPT BUILDERS
// =============================================================================

export interface TaskContext {
  id: string;
  title: string;
  description?: string;
  type: string;
  priority: number;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  parentTaskId?: string;
  retryCount?: number;
}

export interface AgentContext {
  id: string;
  name: string;
  type: string;
  status: string;
  capabilities: string[];
}

export interface DecisionContext {
  task: TaskContext;
  agents: AgentContext[];
  previousDecision?: {
    type: string;
    reason: string;
  };
}

/**
 * Build user prompt for SHORT tier (classification)
 */
function buildShortPrompt(ctx: DecisionContext): string {
  return `Classify this task:
Title: ${ctx.task.title}
Type: ${ctx.task.type}
Priority: ${ctx.task.priority}/4
${ctx.task.description ? `Description: ${ctx.task.description}` : ''}`;
}

/**
 * Build user prompt for MEDIUM tier (decision)
 */
function buildMediumPrompt(ctx: DecisionContext): string {
  const activeAgents = ctx.agents.filter(a => a.status === 'active');

  const parts = [
    `Task: ${ctx.task.title}`,
    `Type: ${ctx.task.type}`,
    `Priority: ${ctx.task.priority}/4`,
  ];

  if (ctx.task.description) {
    parts.push(`Description: ${ctx.task.description}`);
  }

  if (activeAgents.length > 0) {
    parts.push(`\nAvailable Agents (${activeAgents.length}):`);
    for (const agent of activeAgents.slice(0, 5)) { // Limit to 5 for prompt size
      parts.push(`- ${agent.name} (${agent.type}): ${agent.capabilities.join(', ')}`);
    }
  } else {
    parts.push('\nNo active agents available.');
  }

  if (ctx.task.retryCount && ctx.task.retryCount > 0) {
    parts.push(`\nNote: Task has been retried ${ctx.task.retryCount} times.`);
  }

  return parts.join('\n');
}

/**
 * Build user prompt for DEEP tier (planning)
 */
function buildDeepPrompt(ctx: DecisionContext): string {
  const parts = [
    `=== TASK DETAILS ===`,
    `Title: ${ctx.task.title}`,
    `Type (declared): ${ctx.task.type}`,
    `Priority: ${ctx.task.priority} (1=low, 4=critical)`,
  ];

  if (ctx.task.description) {
    parts.push(`Description: ${ctx.task.description}`);
  }

  if (ctx.task.input && Object.keys(ctx.task.input).length > 0) {
    parts.push(`\nInput Data:\n${JSON.stringify(ctx.task.input, null, 2)}`);
  }

  if (ctx.task.metadata && Object.keys(ctx.task.metadata).length > 0) {
    // Filter out internal metadata
    const relevantMeta = Object.fromEntries(
      Object.entries(ctx.task.metadata).filter(([k]) => !k.startsWith('_'))
    );
    if (Object.keys(relevantMeta).length > 0) {
      parts.push(`\nMetadata:\n${JSON.stringify(relevantMeta, null, 2)}`);
    }
  }

  if (ctx.task.parentTaskId) {
    parts.push(`\nNote: This is a subtask of parent ${ctx.task.parentTaskId}`);
  }

  // Agent context
  parts.push(`\n=== AVAILABLE RESOURCES ===`);
  const activeAgents = ctx.agents.filter(a => a.status === 'active');

  if (activeAgents.length > 0) {
    parts.push(`Active Agents (${activeAgents.length}):`);
    for (const agent of activeAgents) {
      parts.push(`- ${agent.name} [${agent.type}]: ${agent.capabilities.join(', ')}`);
    }
  } else {
    parts.push('No active agents available.');
  }

  // Previous decision context
  if (ctx.previousDecision) {
    parts.push(`\n=== PREVIOUS DECISION ===`);
    parts.push(`Type: ${ctx.previousDecision.type}`);
    parts.push(`Reason: ${ctx.previousDecision.reason}`);
  }

  if (ctx.task.retryCount && ctx.task.retryCount > 0) {
    parts.push(`\n=== WARNING ===`);
    parts.push(`Task has been retried ${ctx.task.retryCount} times. Consider alternative approaches.`);
  }

  return parts.join('\n');
}

// =============================================================================
// RESPONSE PARSERS
// =============================================================================

export interface ShortResponse {
  category: 'simple' | 'moderate' | 'complex' | 'requires_planning';
  taskType: string;
  complexity: 'low' | 'medium' | 'high';
  requiredCapabilities: string[];
  mayNeedDecomposition: boolean;
  mayNeedHumanReview: boolean;
  confidence: number;
}

export interface MediumResponse {
  decisionType: 'assign' | 'subdivide' | 'create_resource' | 'escalate' | 'wait';
  reasoning: string;
  confidence: number;
  requiredCapabilities: string[];
  suggestedAgent: string | null;
  needsHumanReview: boolean;
  subtaskCount?: number;
}

export interface DeepResponse {
  intent: string;
  taskType: string;
  complexity: 'low' | 'medium' | 'high';
  complexityReason?: string;
  requiredCapabilities: string[];
  optionalCapabilities?: string[];
  suggestedTools?: string[];
  canBeSubdivided: boolean;
  subdivisionReason?: string;
  suggestedSubtasks?: Array<{
    title: string;
    description: string;
    type: string;
    requiredCapabilities?: string[];
    order: number;
    dependsOnPrevious: boolean;
    estimatedComplexity?: 'low' | 'medium' | 'high';
  }>;
  riskFactors?: string[];
  estimatedDuration?: 'quick' | 'normal' | 'long';
  requiresHumanReview: boolean;
  humanReviewReason?: string;
  confidence: number;
}

/**
 * Parse LLM response safely
 */
function parseJsonResponse<T>(content: string, validator: (obj: unknown) => obj is T): T | null {
  try {
    let jsonStr = content.trim();

    // Handle markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!.trim();
    }

    // Find JSON object
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    if (validator(parsed)) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

// Type guards
function isShortResponse(obj: unknown): obj is ShortResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.category === 'string' &&
    typeof o.taskType === 'string' &&
    typeof o.complexity === 'string' &&
    Array.isArray(o.requiredCapabilities)
  );
}

function isMediumResponse(obj: unknown): obj is MediumResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.decisionType === 'string' &&
    typeof o.reasoning === 'string' &&
    typeof o.confidence === 'number'
  );
}

function isDeepResponse(obj: unknown): obj is DeepResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.intent === 'string' &&
    typeof o.taskType === 'string' &&
    typeof o.complexity === 'string' &&
    Array.isArray(o.requiredCapabilities) &&
    typeof o.canBeSubdivided === 'boolean'
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export interface PromptBundle {
  tier: PromptTier;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeout: number;
}

/**
 * Get complete prompt bundle for a tier
 */
export function getPromptBundle(tier: PromptTier, ctx: DecisionContext): PromptBundle {
  const config = PROMPT_TIER_CONFIGS[tier];

  let systemPrompt: string;
  let userPrompt: string;

  switch (tier) {
    case PROMPT_TIER.SHORT:
      systemPrompt = SYSTEM_PROMPT_SHORT;
      userPrompt = buildShortPrompt(ctx);
      break;
    case PROMPT_TIER.MEDIUM:
      systemPrompt = SYSTEM_PROMPT_MEDIUM;
      userPrompt = buildMediumPrompt(ctx);
      break;
    case PROMPT_TIER.DEEP:
      systemPrompt = SYSTEM_PROMPT_DEEP;
      userPrompt = buildDeepPrompt(ctx);
      break;
    default:
      systemPrompt = SYSTEM_PROMPT_MEDIUM;
      userPrompt = buildMediumPrompt(ctx);
  }

  return {
    tier,
    systemPrompt,
    userPrompt,
    maxTokens: config.maxTokens,
    timeout: config.timeout,
  };
}

/**
 * Parse response for a tier
 */
export function parseResponse(
  tier: PromptTier,
  content: string
): ShortResponse | MediumResponse | DeepResponse | null {
  switch (tier) {
    case PROMPT_TIER.SHORT:
      return parseJsonResponse(content, isShortResponse);
    case PROMPT_TIER.MEDIUM:
      return parseJsonResponse(content, isMediumResponse);
    case PROMPT_TIER.DEEP:
      return parseJsonResponse(content, isDeepResponse);
    default:
      return null;
  }
}

/**
 * Determine which tier to use based on context
 */
export function determineTier(ctx: DecisionContext): PromptTier {
  // Deep for high priority or complex looking tasks
  if (ctx.task.priority >= 4) {
    return PROMPT_TIER.DEEP;
  }

  // Deep for tasks with significant input data
  if (ctx.task.input && Object.keys(ctx.task.input).length > 3) {
    return PROMPT_TIER.DEEP;
  }

  // Medium for most tasks
  if (ctx.task.description && ctx.task.description.length > 100) {
    return PROMPT_TIER.MEDIUM;
  }

  // Short for simple classification
  if (ctx.agents.length > 0 && ctx.task.type !== 'generic') {
    return PROMPT_TIER.SHORT;
  }

  return PROMPT_TIER.MEDIUM;
}

export {
  SYSTEM_PROMPT_SHORT,
  SYSTEM_PROMPT_MEDIUM,
  SYSTEM_PROMPT_DEEP,
  parseJsonResponse,
  isShortResponse,
  isMediumResponse,
  isDeepResponse,
};

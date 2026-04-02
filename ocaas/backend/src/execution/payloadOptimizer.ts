/**
 * Payload Optimizer
 *
 * Minimizes token usage in job payloads and prompts.
 * Key strategies:
 * 1. Strip redundant fields
 * 2. Compress arrays to essential elements
 * 3. Shorten descriptions
 * 4. Use compact format for previous results
 */

import type { JobPayload, JobContext, JobAgentContext, JobResult } from './types.js';

const MAX_DESCRIPTION_LENGTH = 200;
const MAX_OUTPUT_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 150;
const MAX_PREVIOUS_RESULTS = 3;

/**
 * Optimize payload for minimal tokens
 */
export function optimizePayload(payload: JobPayload): JobPayload {
  return {
    ...payload,
    description: truncate(payload.description, MAX_DESCRIPTION_LENGTH),
    agent: optimizeAgentContext(payload.agent),
    context: payload.context ? optimizeContext(payload.context) : undefined,
    // Remove null/undefined fields
    ...removeNulls({
      subtaskId: payload.subtaskId,
      parentJobId: payload.parentJobId,
      input: payload.input,
    }),
  };
}

/**
 * Optimize agent context
 */
function optimizeAgentContext(agent: JobAgentContext): JobAgentContext {
  return {
    agentId: agent.agentId,
    name: agent.name,
    type: agent.type,
    role: agent.role,
    // Only include non-empty capabilities
    capabilities: agent.capabilities.length > 0 ? agent.capabilities : [],
    // Truncate long system prompts
    systemPrompt: truncateRequired(agent.systemPrompt, 1000),
    // Only include if set
    ...(agent.model && { model: agent.model }),
    ...(agent.temperature !== undefined && { temperature: agent.temperature }),
  };
}

/**
 * Optimize job context
 */
function optimizeContext(ctx: JobContext): JobContext {
  const optimized: JobContext = {};

  // Keep only recent previous results
  if (ctx.previousResults && ctx.previousResults.length > 0) {
    optimized.previousResults = ctx.previousResults
      .slice(-MAX_PREVIOUS_RESULTS)
      .map(r => ({
        jobId: r.jobId,
        summary: truncateRequired(r.summary, MAX_SUMMARY_LENGTH),
        // Remove output data to save tokens
      }));
  }

  // Truncate task context
  if (ctx.taskContext) {
    optimized.taskContext = {
      title: ctx.taskContext.title,
      description: truncate(ctx.taskContext.description, MAX_DESCRIPTION_LENGTH),
      // Only include if set
      ...(ctx.taskContext.totalSubtasks && { totalSubtasks: ctx.taskContext.totalSubtasks }),
      ...(ctx.taskContext.completedSubtasks && { completedSubtasks: ctx.taskContext.completedSubtasks }),
    };
  }

  // Truncate user context
  if (ctx.userContext) {
    optimized.userContext = truncate(ctx.userContext, MAX_DESCRIPTION_LENGTH);
  }

  // Only include environment if needed
  if (ctx.environment && Object.keys(ctx.environment).length > 0) {
    optimized.environment = ctx.environment;
  }

  return optimized;
}

/**
 * Optimize job result for storage
 */
export function optimizeResult(result: JobResult): JobResult {
  return {
    output: truncateRequired(result.output, MAX_OUTPUT_LENGTH),
    actionsSummary: truncate(result.actionsSummary, MAX_SUMMARY_LENGTH),
    // Only keep first 5 tools used
    toolsUsed: result.toolsUsed?.slice(0, 5),
    // Only keep first 3 skills
    skillsInvoked: result.skillsInvoked?.slice(0, 3),
    // Keep structured data but limit depth
    data: result.data ? limitObjectDepth(result.data, 2) : undefined,
    // Keep first 3 artifacts
    artifacts: result.artifacts?.slice(0, 3),
  };
}

/**
 * Build compact prompt from payload
 */
export function buildCompactPrompt(payload: JobPayload): string {
  const lines: string[] = [];

  // Goal (required)
  lines.push(`GOAL: ${payload.goal}`);

  // Description if short
  if (payload.description && payload.description.length <= MAX_DESCRIPTION_LENGTH) {
    lines.push(`DESC: ${payload.description}`);
  }

  // Tools available (compact)
  if (payload.allowedResources.tools.length > 0) {
    lines.push(`TOOLS: ${payload.allowedResources.tools.slice(0, 10).join(', ')}`);
  }

  // Constraints (compact)
  const constraints: string[] = [];
  if (payload.constraints.requireConfirmation) constraints.push('confirm');
  if (!payload.constraints.canCreateResources) constraints.push('no-create');
  if (!payload.constraints.canDelegate) constraints.push('no-delegate');
  if (constraints.length > 0) {
    lines.push(`CONSTRAINTS: ${constraints.join(', ')}`);
  }

  // Previous context (compact)
  if (payload.context?.previousResults?.length) {
    const prev = payload.context.previousResults
      .map(r => r.summary)
      .join(' | ');
    lines.push(`PREV: ${truncate(prev, 200)}`);
  }

  return lines.join('\n');
}

// ============================================================================
// HELPERS
// ============================================================================

function truncate(str: string | undefined, max: number): string | undefined {
  if (!str) return undefined;
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function truncateRequired(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function removeNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function limitObjectDepth(obj: Record<string, unknown>, maxDepth: number): Record<string, unknown> {
  if (maxDepth <= 0) return { _truncated: true };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      result[key] = limitObjectDepth(value as Record<string, unknown>, maxDepth - 1);
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, 5); // Limit arrays
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Estimate token count (rough approximation)
 */
export function estimateTokens(payload: JobPayload): number {
  const json = JSON.stringify(payload);
  // Rough estimate: 4 chars per token
  return Math.ceil(json.length / 4);
}

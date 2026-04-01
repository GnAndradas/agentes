/**
 * Heuristic Rules for Decision Engine
 *
 * Rules are evaluated in priority order (lower = first).
 * If a rule can make a decision with sufficient confidence, LLM is skipped.
 */

import type { HeuristicRule, HeuristicContext, HeuristicDecisionResult, DecisionAction } from './types.js';

// =============================================================================
// CAPABILITY MATCHING UTILITIES
// =============================================================================

/**
 * Semantic capability groups - capabilities that are related
 */
const CAPABILITY_SYNONYMS: Record<string, string[]> = {
  // Development
  'coding': ['programming', 'development', 'code', 'software', 'engineer', 'implement', 'dev'],
  'typescript': ['javascript', 'js', 'ts', 'nodejs', 'node'],
  'python': ['py', 'python3'],
  'frontend': ['ui', 'react', 'vue', 'angular', 'web', 'client'],
  'backend': ['api', 'server', 'rest', 'graphql'],

  // Testing
  'testing': ['test', 'qa', 'quality', 'unit-test', 'e2e', 'integration'],
  'debugging': ['debug', 'troubleshoot', 'diagnose', 'fix'],

  // DevOps
  'deployment': ['deploy', 'release', 'publish', 'ci-cd', 'devops'],
  'docker': ['container', 'kubernetes', 'k8s'],
  'cloud': ['aws', 'azure', 'gcp', 'serverless'],

  // Data
  'analysis': ['analyze', 'analytics', 'data', 'insight', 'report'],
  'database': ['db', 'sql', 'postgres', 'mysql', 'mongodb'],

  // Documentation
  'documentation': ['docs', 'document', 'readme', 'spec', 'writing'],

  // Security
  'security': ['auth', 'authentication', 'authorization', 'encrypt'],

  // Research
  'research': ['investigate', 'explore', 'gather', 'search'],
};

/**
 * Check if two capabilities match (exact or semantic)
 */
function capabilitiesMatch(cap1: string, cap2: string): boolean {
  const c1 = cap1.toLowerCase().trim();
  const c2 = cap2.toLowerCase().trim();

  // Exact match
  if (c1 === c2) return true;

  // Substring match (min 4 chars)
  if (c1.length >= 4 && c2.includes(c1)) return true;
  if (c2.length >= 4 && c1.includes(c2)) return true;

  // Synonym match
  for (const [key, synonyms] of Object.entries(CAPABILITY_SYNONYMS)) {
    const allTerms = [key, ...synonyms];
    const c1InGroup = allTerms.some(t => c1.includes(t) || t.includes(c1));
    const c2InGroup = allTerms.some(t => c2.includes(t) || t.includes(c2));
    if (c1InGroup && c2InGroup) return true;
  }

  return false;
}

/**
 * Find agents that match required capabilities
 */
function findMatchingAgents(
  agents: HeuristicContext['agents'],
  requiredCaps: string[]
): Array<{ agent: HeuristicContext['agents'][0]; matchCount: number; matchedCaps: string[] }> {
  const results: Array<{ agent: HeuristicContext['agents'][0]; matchCount: number; matchedCaps: string[] }> = [];

  for (const agent of agents) {
    if (agent.status !== 'active') continue;

    const matchedCaps: string[] = [];
    for (const reqCap of requiredCaps) {
      const matched = agent.capabilities.some(agentCap => capabilitiesMatch(agentCap, reqCap));
      if (matched) {
        matchedCaps.push(reqCap);
      }
    }

    if (matchedCaps.length > 0) {
      results.push({ agent, matchCount: matchedCaps.length, matchedCaps });
    }
  }

  // Sort by match count descending
  results.sort((a, b) => b.matchCount - a.matchCount);
  return results;
}

/**
 * Infer required capabilities from task
 */
function inferCapabilities(task: HeuristicContext['task']): string[] {
  const caps: Set<string> = new Set();
  const text = `${task.title} ${task.description || ''} ${task.type}`.toLowerCase();

  // Keyword-based inference
  const keywordMap: Record<string, string[]> = {
    'code': ['coding'],
    'test': ['testing'],
    'deploy': ['deployment'],
    'debug': ['debugging'],
    'fix': ['debugging', 'coding'],
    'document': ['documentation'],
    'analyze': ['analysis'],
    'research': ['research'],
    'api': ['backend', 'api'],
    'frontend': ['frontend'],
    'backend': ['backend'],
    'database': ['database'],
    'security': ['security'],
    'auth': ['security'],
    'docker': ['docker'],
    'kubernetes': ['docker'],
    'aws': ['cloud'],
    'cloud': ['cloud'],
  };

  for (const [keyword, capabilities] of Object.entries(keywordMap)) {
    if (text.includes(keyword)) {
      capabilities.forEach(c => caps.add(c));
    }
  }

  // Add task type as capability
  if (task.type && task.type !== 'generic') {
    caps.add(task.type.toLowerCase());
  }

  return Array.from(caps);
}

// =============================================================================
// HEURISTIC RULES
// =============================================================================

/**
 * Rule 1: Direct type match - task type exactly matches agent capability
 */
const directTypeMatchRule: HeuristicRule = {
  id: 'direct_type_match',
  name: 'Direct Type Match',
  priority: 1,
  minConfidence: 0.85,

  condition: (ctx) => {
    if (ctx.task.type === 'generic') return false;
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    return activeAgents.some(a =>
      a.capabilities.some(c => c.toLowerCase() === ctx.task.type.toLowerCase())
    );
  },

  decide: (ctx) => {
    const taskType = ctx.task.type.toLowerCase();
    const activeAgents = ctx.agents.filter(a => a.status === 'active');

    // Find agent with exact capability match
    const exactMatch = activeAgents.find(a =>
      a.capabilities.some(c => c.toLowerCase() === taskType)
    );

    if (!exactMatch) {
      return { canDecide: false, confidence: 0, reasoning: 'No exact match found' };
    }

    return {
      canDecide: true,
      decisionType: 'assign',
      targetAgent: exactMatch.id,
      confidence: 0.9,
      reasoning: `Agent "${exactMatch.name}" has exact capability match for task type "${ctx.task.type}"`,
      actions: [{
        type: 'assign',
        targetId: exactMatch.id,
        priority: 1,
        reason: `Direct capability match: ${taskType}`,
        metadata: { matchType: 'exact' },
      }],
    };
  },
};

/**
 * Rule 2: Single active agent - if only one agent is active, use it for simple tasks
 */
const singleAgentRule: HeuristicRule = {
  id: 'single_agent',
  name: 'Single Active Agent',
  priority: 2,
  minConfidence: 0.7,

  condition: (ctx) => {
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    // Only for low-medium priority tasks
    return activeAgents.length === 1 && ctx.task.priority <= 3;
  },

  decide: (ctx) => {
    const activeAgent = ctx.agents.find(a => a.status === 'active')!;

    return {
      canDecide: true,
      decisionType: 'assign',
      targetAgent: activeAgent.id,
      confidence: 0.75,
      reasoning: `Only one active agent available ("${activeAgent.name}"), assigning by default`,
      actions: [{
        type: 'assign',
        targetId: activeAgent.id,
        priority: 1,
        reason: 'Single active agent available',
        metadata: { matchType: 'default' },
      }],
    };
  },
};

/**
 * Rule 3: Specialist match - specialist agent matches inferred capabilities
 */
const specialistMatchRule: HeuristicRule = {
  id: 'specialist_match',
  name: 'Specialist Match',
  priority: 3,
  minConfidence: 0.8,

  condition: (ctx) => {
    const specialists = ctx.agents.filter(a => a.status === 'active' && a.type === 'specialist');
    if (specialists.length === 0) return false;

    const inferredCaps = inferCapabilities(ctx.task);
    if (inferredCaps.length === 0) return false;

    const matches = findMatchingAgents(specialists, inferredCaps);
    return matches.length > 0 && matches[0]!.matchCount >= 1;
  },

  decide: (ctx) => {
    const specialists = ctx.agents.filter(a => a.status === 'active' && a.type === 'specialist');
    const inferredCaps = inferCapabilities(ctx.task);
    const matches = findMatchingAgents(specialists, inferredCaps);

    if (matches.length === 0) {
      return { canDecide: false, confidence: 0, reasoning: 'No specialist match' };
    }

    const best = matches[0]!;
    const coverageRatio = best.matchCount / inferredCaps.length;
    const confidence = Math.min(0.9, 0.7 + coverageRatio * 0.2);

    return {
      canDecide: true,
      decisionType: 'assign',
      targetAgent: best.agent.id,
      confidence,
      reasoning: `Specialist "${best.agent.name}" matches ${best.matchCount}/${inferredCaps.length} inferred capabilities: ${best.matchedCaps.join(', ')}`,
      actions: [{
        type: 'assign',
        targetId: best.agent.id,
        priority: 1,
        reason: `Specialist match: ${best.matchedCaps.join(', ')}`,
        metadata: {
          matchType: 'specialist',
          matchedCapabilities: best.matchedCaps,
          coverage: coverageRatio,
        },
      }],
    };
  },
};

/**
 * Rule 4: No active agents - must escalate or create
 */
const noAgentsRule: HeuristicRule = {
  id: 'no_agents',
  name: 'No Active Agents',
  priority: 4,
  minConfidence: 0.95,

  condition: (ctx) => {
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    return activeAgents.length === 0;
  },

  decide: (ctx) => {
    const actions: DecisionAction[] = [];

    // If any agents exist but inactive
    const inactiveAgents = ctx.agents.filter(a => a.status !== 'active');
    if (inactiveAgents.length > 0) {
      actions.push({
        type: 'escalate',
        priority: 1,
        reason: `No active agents. ${inactiveAgents.length} agent(s) exist but are inactive.`,
        metadata: { inactiveCount: inactiveAgents.length },
      });
    } else {
      // No agents at all
      actions.push({
        type: 'create_resource',
        resourceType: 'agent',
        priority: 1,
        reason: 'No agents available in the system',
        metadata: { suggestedType: ctx.task.type },
      });
    }

    return {
      canDecide: true,
      decisionType: 'escalate',
      confidence: 0.95,
      reasoning: 'No active agents available to handle the task',
      actions: actions,
    };
  },
};

/**
 * Rule 5: Critical task - high priority tasks need best match or escalation
 */
const criticalTaskRule: HeuristicRule = {
  id: 'critical_task',
  name: 'Critical Task Handling',
  priority: 5,
  minConfidence: 0.6,

  condition: (ctx) => ctx.task.priority >= 4,

  decide: (ctx) => {
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    const inferredCaps = inferCapabilities(ctx.task);
    const matches = findMatchingAgents(activeAgents, inferredCaps);

    // For critical tasks, need good coverage
    if (matches.length > 0 && matches[0]!.matchCount >= Math.ceil(inferredCaps.length * 0.5)) {
      const best = matches[0]!;
      return {
        canDecide: true,
        decisionType: 'assign',
        targetAgent: best.agent.id,
        confidence: 0.7,
        reasoning: `Critical task assigned to best matching agent "${best.agent.name}" (${best.matchCount}/${inferredCaps.length} capabilities)`,
        actions: [{
          type: 'assign',
          targetId: best.agent.id,
          priority: 1,
          reason: `Best available match for critical task`,
          metadata: { critical: true },
        }],
      };
    }

    // No good match for critical task - escalate
    return {
      canDecide: true,
      decisionType: 'escalate',
      confidence: 0.85,
      reasoning: 'Critical task requires human review - no agent has sufficient capability match',
      actions: [{
        type: 'escalate',
        priority: 1,
        reason: 'Critical task without confident agent match',
        metadata: { taskPriority: ctx.task.priority, needsHumanReview: true },
      }],
    };
  },
};

/**
 * Rule 6: Subtask - if task has parent, match parent's agent
 */
const subtaskRule: HeuristicRule = {
  id: 'subtask_match',
  name: 'Subtask Agent Match',
  priority: 6,
  minConfidence: 0.75,

  condition: (ctx) => !!ctx.task.parentTaskId,

  decide: (ctx) => {
    // For subtasks, we prefer to use similar logic but this rule just marks it
    // The actual parent-agent matching would need TaskService access
    // For now, use best capability match
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    const inferredCaps = inferCapabilities(ctx.task);
    const matches = findMatchingAgents(activeAgents, inferredCaps);

    if (matches.length > 0) {
      const best = matches[0]!;
      return {
        canDecide: true,
        decisionType: 'assign',
        targetAgent: best.agent.id,
        confidence: 0.75,
        reasoning: `Subtask assigned to "${best.agent.name}" based on capability match`,
        actions: [{
          type: 'assign',
          targetId: best.agent.id,
          priority: 1,
          reason: 'Subtask capability match',
          metadata: { isSubtask: true, parentTaskId: ctx.task.parentTaskId },
        }],
      };
    }

    return { canDecide: false, confidence: 0, reasoning: 'No match for subtask' };
  },
};

/**
 * Rule 7: Retry limit - tasks with too many retries should escalate
 */
const retryLimitRule: HeuristicRule = {
  id: 'retry_limit',
  name: 'Retry Limit Reached',
  priority: 7,
  minConfidence: 0.9,

  condition: (ctx) => (ctx.task.retryCount ?? 0) >= 3,

  decide: (ctx) => {
    const retryCount = ctx.task.retryCount ?? 0;
    return {
      canDecide: true,
      decisionType: 'escalate',
      confidence: 0.9,
      reasoning: `Task has been retried ${retryCount} times - requires human review`,
      actions: [{
        type: 'escalate',
        priority: 1,
        reason: `Retry limit reached (${retryCount} retries)`,
        metadata: { retryCount, needsHumanReview: true },
      }],
    };
  },
};

/**
 * Rule 8: General capability match - any agent with matching capabilities
 */
const generalCapabilityRule: HeuristicRule = {
  id: 'general_capability',
  name: 'General Capability Match',
  priority: 8,
  minConfidence: 0.6,

  condition: (ctx) => {
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    if (activeAgents.length === 0) return false;

    const inferredCaps = inferCapabilities(ctx.task);
    if (inferredCaps.length === 0) return true; // Generic task

    const matches = findMatchingAgents(activeAgents, inferredCaps);
    return matches.length > 0;
  },

  decide: (ctx) => {
    const activeAgents = ctx.agents.filter(a => a.status === 'active');
    const inferredCaps = inferCapabilities(ctx.task);

    // Generic task - use any active agent
    if (inferredCaps.length === 0) {
      const generalAgent = activeAgents.find(a => a.type === 'general') || activeAgents[0]!;
      return {
        canDecide: true,
        decisionType: 'assign',
        targetAgent: generalAgent.id,
        confidence: 0.6,
        reasoning: `Generic task assigned to "${generalAgent.name}" (no specific capabilities required)`,
        actions: [{
          type: 'assign',
          targetId: generalAgent.id,
          priority: 1,
          reason: 'Generic task default assignment',
          metadata: { matchType: 'generic' },
        }],
      };
    }

    const matches = findMatchingAgents(activeAgents, inferredCaps);
    if (matches.length === 0) {
      return { canDecide: false, confidence: 0, reasoning: 'No capability match' };
    }

    const best = matches[0]!;
    const coverageRatio = best.matchCount / inferredCaps.length;
    const confidence = Math.max(0.5, Math.min(0.75, 0.4 + coverageRatio * 0.35));

    return {
      canDecide: true,
      decisionType: 'assign',
      targetAgent: best.agent.id,
      confidence,
      reasoning: `Agent "${best.agent.name}" matches ${best.matchCount}/${inferredCaps.length} capabilities`,
      actions: [{
        type: 'assign',
        targetId: best.agent.id,
        priority: 1,
        reason: `Capability match: ${best.matchedCaps.join(', ')}`,
        metadata: {
          matchType: 'general',
          matchedCapabilities: best.matchedCaps,
          coverage: coverageRatio,
        },
      }],
    };
  },
};

// =============================================================================
// RULE REGISTRY
// =============================================================================

/**
 * All heuristic rules in priority order
 */
export const HEURISTIC_RULES: HeuristicRule[] = [
  directTypeMatchRule,
  singleAgentRule,
  specialistMatchRule,
  noAgentsRule,
  criticalTaskRule,
  subtaskRule,
  retryLimitRule,
  generalCapabilityRule,
].sort((a, b) => a.priority - b.priority);

/**
 * Evaluate all rules and return first successful decision
 */
export function evaluateHeuristics(context: HeuristicContext): {
  success: boolean;
  result?: HeuristicDecisionResult;
  ruleId?: string;
  rulesEvaluated: string[];
} {
  const rulesEvaluated: string[] = [];

  for (const rule of HEURISTIC_RULES) {
    rulesEvaluated.push(rule.id);

    if (rule.condition(context)) {
      const result = rule.decide(context);

      if (result.canDecide && result.confidence >= rule.minConfidence) {
        return {
          success: true,
          result,
          ruleId: rule.id,
          rulesEvaluated,
        };
      }
    }
  }

  return {
    success: false,
    rulesEvaluated,
  };
}

/**
 * Utility exports for external use
 */
export { inferCapabilities, findMatchingAgents, capabilitiesMatch };

/**
 * Match capabilities and return a coverage score (0-1)
 */
export function matchCapabilities(required: string[], available: string[]): number {
  if (required.length === 0 || available.length === 0) return 0;

  let matched = 0;
  for (const req of required) {
    if (available.some(avail => capabilitiesMatch(req, avail))) {
      matched++;
    }
  }

  return matched / required.length;
}

/**
 * Find synonyms for a capability
 */
export function findCapabilitySynonyms(capability: string): string[] {
  const cap = capability.toLowerCase().trim();

  // Check if it's a key
  if (CAPABILITY_SYNONYMS[cap]) {
    return CAPABILITY_SYNONYMS[cap];
  }

  // Check if it's in any synonym list
  for (const [key, synonyms] of Object.entries(CAPABILITY_SYNONYMS)) {
    if (synonyms.includes(cap)) {
      return [key, ...synonyms.filter(s => s !== cap)];
    }
  }

  return [];
}

// Export the synonyms map for testing
export { CAPABILITY_SYNONYMS };

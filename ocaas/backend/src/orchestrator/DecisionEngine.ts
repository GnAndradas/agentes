import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import {
  getAutonomyConfig,
  canGenerateSkillAutonomously,
  canGenerateToolAutonomously,
  canCreateAgentAutonomously,
  requiresApprovalForAgentCreation,
  requiresApprovalForSkillGeneration,
  requiresApprovalForToolGeneration,
} from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import { getTaskAnalyzer } from './TaskAnalyzer.js';
import type { TaskDTO, AgentDTO } from '../types/domain.js';
import type {
  TaskAssignment,
  TaskAnalysis,
  MissingCapabilityReport,
  CapabilitySuggestion,
  IntelligentDecision,
  SuggestedAction,
} from './types.js';

const logger = createLogger('DecisionEngine');

export class DecisionEngine {
  // ============================================
  // NEW: Intelligent Decision (AI-powered)
  // ============================================

  /**
   * Action priority order (lower = higher priority)
   */
  private readonly ACTION_PRIORITY: Record<SuggestedAction['action'], number> = {
    assign: 1,           // Best case - can assign immediately
    subdivide: 2,        // Task needs decomposition first
    create_agent: 3,     // Need to create resources
    create_skill: 4,
    create_tool: 5,
    wait_approval: 6,    // Blocked on human
    reject: 7,           // Last resort
  };

  /**
   * Main intelligent decision method - uses AI analysis when available
   * Falls back to basic logic if AI unavailable
   */
  async makeIntelligentDecision(task: TaskDTO): Promise<IntelligentDecision> {
    const decidedAt = Date.now();
    const taskAnalyzer = getTaskAnalyzer();

    // Try AI analysis first
    let analysis = await taskAnalyzer.analyze(task);
    let usedFallback = false;
    let fallbackReason: string | undefined;

    if (!analysis) {
      // Use fallback analysis
      analysis = taskAnalyzer.createFallbackAnalysis(task);
      usedFallback = true;
      fallbackReason = 'AI analysis unavailable, using basic heuristics';
      logger.info({ taskId: task.id }, 'Using fallback analysis');
    }

    // Try to find best agent using intelligent matching
    const assignment = await this.findBestAgentWithAnalysis(task, analysis);

    // Build suggested actions (will be deduplicated and prioritized)
    const rawActions: SuggestedAction[] = [];

    // Generate missing capability report if no suitable agent
    let missingReport: MissingCapabilityReport | undefined;

    if (assignment) {
      rawActions.push({
        action: 'assign',
        reason: `Agent "${assignment.agentId}" matches with score ${assignment.score}${assignment.reason ? ` (${assignment.reason})` : ''}`,
        metadata: {
          agentId: assignment.agentId,
          score: assignment.score,
          confidence: analysis.confidence,
        },
      });
    } else {
      // No agent found - generate missing capability report
      missingReport = await this.generateMissingCapabilityReport(task, analysis);

      // Add suggested actions based on report - group by type
      const actionsByType: Map<string, SuggestedAction> = new Map();

      for (const suggestion of missingReport.suggestions) {
        if (suggestion.priority === 'required' || suggestion.priority === 'recommended') {
          const actionKey = `create_${suggestion.type}`;
          const existing = actionsByType.get(actionKey);

          if (existing) {
            // Merge with existing - add to metadata
            const existingNames = (existing.metadata?.names as string[]) || [existing.metadata?.name as string];
            existingNames.push(suggestion.name);
            existing.metadata = {
              ...existing.metadata,
              names: existingNames,
              count: existingNames.length,
            };
            existing.reason = `Need ${existingNames.length} ${suggestion.type}(s): ${existingNames.join(', ')}`;
          } else {
            actionsByType.set(actionKey, {
              action: `create_${suggestion.type}` as 'create_agent' | 'create_skill' | 'create_tool',
              reason: suggestion.reason,
              metadata: {
                type: suggestion.type,
                name: suggestion.name,
                names: [suggestion.name],
                description: suggestion.description,
                canAutoGenerate: suggestion.canAutoGenerate,
                priority: suggestion.priority,
              },
            });
          }
        }
      }

      rawActions.push(...actionsByType.values());

      // If requires approval, add that action (only once)
      if (missingReport.requiresApproval) {
        rawActions.push({
          action: 'wait_approval',
          reason: 'Autonomy configuration requires human approval before creating new resources',
          metadata: {
            requiredFor: missingReport.suggestions.map(s => s.type).filter((v, i, a) => a.indexOf(v) === i),
          },
        });
      }
    }

    // Check if task should be subdivided (higher priority for complex tasks)
    if (analysis.canBeSubdivided && analysis.suggestedSubtasks && analysis.suggestedSubtasks.length > 1) {
      // Only suggest subdivision if we have enough subtasks and it makes sense
      const worthSubdividing = analysis.complexity !== 'low' || analysis.suggestedSubtasks.length >= 3;

      if (worthSubdividing) {
        rawActions.push({
          action: 'subdivide',
          reason: analysis.subdivisionReason ||
            `Task can be split into ${analysis.suggestedSubtasks.length} subtasks for better parallel execution`,
          metadata: {
            subtaskCount: analysis.suggestedSubtasks.length,
            subtasks: analysis.suggestedSubtasks,
            complexity: analysis.complexity,
          },
        });
      }
    }

    // Check human review requirement (don't duplicate if already have wait_approval)
    if (analysis.requiresHumanReview) {
      const hasWaitApproval = rawActions.some(a => a.action === 'wait_approval');
      if (!hasWaitApproval) {
        rawActions.push({
          action: 'wait_approval',
          reason: analysis.humanReviewReason || 'Task analysis indicates human review is recommended',
          metadata: { source: 'analysis' },
        });
      }
    }

    // Deduplicate and prioritize actions
    const suggestedActions = this.deduplicateAndPrioritizeActions(rawActions);

    const decision: IntelligentDecision = {
      taskId: task.id,
      decidedAt,
      analysis,
      assignment,
      missingReport,
      suggestedActions,
      usedFallback,
      fallbackReason,
    };

    logger.info({
      taskId: task.id,
      hasAssignment: !!assignment,
      hasMissingReport: !!missingReport,
      actionsCount: suggestedActions.length,
      actions: suggestedActions.map(a => a.action),
      usedFallback,
      confidence: analysis.confidence,
    }, 'Intelligent decision made');

    return decision;
  }

  /**
   * Deduplicate and prioritize suggested actions
   */
  private deduplicateAndPrioritizeActions(actions: SuggestedAction[]): SuggestedAction[] {
    // Deduplicate by action type
    const actionMap = new Map<string, SuggestedAction>();

    for (const action of actions) {
      const key = action.action;
      const existing = actionMap.get(key);

      if (!existing) {
        actionMap.set(key, action);
      } else {
        // Merge metadata if same action type
        actionMap.set(key, {
          ...existing,
          reason: existing.reason.length > action.reason.length ? existing.reason : action.reason,
          metadata: { ...existing.metadata, ...action.metadata },
        });
      }
    }

    // Convert to array and sort by priority
    const deduplicated = Array.from(actionMap.values());

    deduplicated.sort((a, b) => {
      const priorityA = this.ACTION_PRIORITY[a.action] ?? 99;
      const priorityB = this.ACTION_PRIORITY[b.action] ?? 99;
      return priorityA - priorityB;
    });

    return deduplicated;
  }

  /**
   * Find best agent using AI analysis for smarter matching
   */
  async findBestAgentWithAnalysis(task: TaskDTO, analysis: TaskAnalysis): Promise<TaskAssignment | null> {
    const { agentService, eventService } = getServices();
    const activeAgents = await agentService.getActive();

    if (activeAgents.length === 0) {
      logger.warn({ taskId: task.id }, 'No active agents available');
      return null;
    }

    const scored: TaskAssignment[] = [];

    for (const agent of activeAgents) {
      const score = this.scoreAgentWithAnalysis(agent, task, analysis);
      if (score > 0) {
        scored.push({
          taskId: task.id,
          agentId: agent.id,
          score,
          reason: this.getMatchReasonWithAnalysis(agent, analysis),
        });
      }
    }

    if (scored.length === 0) {
      logger.warn({ taskId: task.id, taskType: analysis.taskType }, 'No suitable agents found');
      return null;
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;

    logger.info({
      taskId: task.id,
      agentId: best.agentId,
      score: best.score,
      reason: best.reason,
    }, 'Best agent selected with analysis');

    // Emit intelligent agent selection event
    await eventService.emit({
      type: EVENT_TYPE.INTELLIGENT_AGENT_SELECTED,
      category: 'orchestrator',
      severity: 'info',
      message: `Agent "${best.agentId}" selected for task (score: ${best.score})`,
      resourceType: 'task',
      resourceId: task.id,
      data: {
        agentId: best.agentId,
        score: best.score,
        reason: best.reason,
        taskType: analysis.taskType,
        confidence: analysis.confidence,
        candidatesCount: scored.length,
      },
    });

    return best;
  }

  /**
   * Scoring weights for agent selection
   */
  private readonly SCORING_WEIGHTS = {
    baseScore: 30,
    // Capability matching
    exactCapabilityMatch: 25,
    semanticCapabilityMatch: 15,
    capabilityCoverage: 35,
    // Agent type bonuses
    specialistTypeMatch: 20,
    orchestratorMatch: 30,
    generalPurpose: 10,
    // Complexity & experience
    complexityMatch: 15,
    experienceBonus: 10,
    // Availability
    busyPenalty: -50,
    activePriority: 10,
    // Priority handling
    criticalTaskBoost: 15,
    highPriorityBoost: 10,
    // Tool suggestions
    suggestedToolMatch: 10,
    // Confidence scaling
    minConfidenceMultiplier: 0.6,
    maxConfidenceMultiplier: 1.0,
  };

  /**
   * Score agent using AI analysis - comprehensive weighted scoring
   */
  private scoreAgentWithAnalysis(agent: AgentDTO, task: TaskDTO, analysis: TaskAnalysis): number {
    const weights = this.SCORING_WEIGHTS;
    let score = weights.baseScore;
    const scoreBreakdown: Record<string, number> = { base: weights.baseScore };

    const agentCaps = (agent.capabilities || []).map(c => c.toLowerCase());
    const requiredCaps = analysis.requiredCapabilities;

    // 1. Capability Matching (weighted by match quality)
    let totalCapabilityScore = 0;
    let matchedCount = 0;
    const matchDetails: Array<{ required: string; agent: string; score: number }> = [];

    for (const reqCap of requiredCaps) {
      let bestMatchScore = 0;
      let bestMatchCap = '';

      for (const agentCap of agentCaps) {
        const matchScore = this.getCapabilityMatchScore(agentCap, reqCap);
        if (matchScore > bestMatchScore) {
          bestMatchScore = matchScore;
          bestMatchCap = agentCap;
        }
      }

      if (bestMatchScore > 0) {
        matchedCount++;
        // Exact matches get full points, semantic matches get partial
        const capPoints = bestMatchScore >= 0.9
          ? weights.exactCapabilityMatch
          : Math.round(weights.semanticCapabilityMatch * bestMatchScore);
        totalCapabilityScore += capPoints;
        matchDetails.push({ required: reqCap, agent: bestMatchCap, score: capPoints });
      }
    }

    score += totalCapabilityScore;
    scoreBreakdown.capabilities = totalCapabilityScore;

    // 2. Coverage Bonus (percentage of requirements met)
    if (requiredCaps.length > 0) {
      const coverage = matchedCount / requiredCaps.length;
      const coverageBonus = Math.round(coverage * weights.capabilityCoverage);
      score += coverageBonus;
      scoreBreakdown.coverage = coverageBonus;

      // Perfect coverage bonus
      if (coverage === 1.0) {
        score += 10;
        scoreBreakdown.perfectCoverage = 10;
      }
    }

    // 3. Agent Type Scoring
    const taskType = analysis.taskType.toLowerCase();

    if (agent.type === 'specialist') {
      // Specialist bonus when their specialty matches
      const specialtyMatch = agentCaps.some(c =>
        this.getCapabilityMatchScore(c, taskType) > 0.5
      );
      if (specialtyMatch) {
        score += weights.specialistTypeMatch;
        scoreBreakdown.specialistMatch = weights.specialistTypeMatch;
      }
    } else if (agent.type === 'orchestrator') {
      if (taskType === 'orchestration' || taskType === 'coordination' || taskType === 'planning') {
        score += weights.orchestratorMatch;
        scoreBreakdown.orchestratorMatch = weights.orchestratorMatch;
      }
    } else if (agent.type === 'general') {
      // General agents get small bonus for generic/unknown tasks
      if (taskType === 'generic' || requiredCaps.length === 0) {
        score += weights.generalPurpose;
        scoreBreakdown.generalPurpose = weights.generalPurpose;
      }
    }

    // 4. Complexity Matching
    if (analysis.complexity === 'high') {
      if (agent.type === 'specialist') {
        score += weights.complexityMatch;
        scoreBreakdown.complexityMatch = weights.complexityMatch;
      }
    } else if (analysis.complexity === 'low') {
      // For simple tasks, prefer available agents over specialists
      if (agent.status === 'active') {
        score += 5;
        scoreBreakdown.simpleTaskAvailable = 5;
      }
    }

    // 5. Tool Suggestions Match
    if (analysis.suggestedTools && analysis.suggestedTools.length > 0) {
      const toolMatchCount = analysis.suggestedTools.filter(tool =>
        agentCaps.some(c => this.getCapabilityMatchScore(c, tool) > 0.5)
      ).length;
      if (toolMatchCount > 0) {
        const toolBonus = Math.min(toolMatchCount * 5, weights.suggestedToolMatch);
        score += toolBonus;
        scoreBreakdown.toolMatch = toolBonus;
      }
    }

    // 6. Availability & Status
    if (agent.status === 'busy') {
      score += weights.busyPenalty;
      scoreBreakdown.busyPenalty = weights.busyPenalty;
    } else if (agent.status === 'active') {
      score += weights.activePriority;
      scoreBreakdown.activePriority = weights.activePriority;
    }

    // 7. Task Priority Handling
    if (task.priority >= 4) {
      score += weights.criticalTaskBoost;
      scoreBreakdown.criticalBoost = weights.criticalTaskBoost;
    } else if (task.priority >= 3) {
      score += weights.highPriorityBoost;
      scoreBreakdown.highPriorityBoost = weights.highPriorityBoost;
    }

    // 8. Duration Estimation Match
    if (analysis.estimatedDuration === 'quick' && agent.status === 'active') {
      score += 5; // Quick tasks prefer immediately available agents
      scoreBreakdown.quickTaskBonus = 5;
    } else if (analysis.estimatedDuration === 'long' && agent.type === 'specialist') {
      score += 5; // Long tasks prefer specialists
      scoreBreakdown.longTaskSpecialist = 5;
    }

    // 9. Apply Confidence Factor (scales final score)
    const confidenceMultiplier = weights.minConfidenceMultiplier +
      (analysis.confidence * (weights.maxConfidenceMultiplier - weights.minConfidenceMultiplier));
    const preConfidenceScore = score;
    score = Math.round(score * confidenceMultiplier);
    scoreBreakdown.confidenceAdjustment = score - preConfidenceScore;

    // Log detailed scoring for debugging
    logger.debug({
      taskId: task.id,
      agentId: agent.id,
      finalScore: score,
      breakdown: scoreBreakdown,
      matchDetails,
    }, 'Agent scoring details');

    return Math.max(0, score);
  }

  /**
   * Semantic capability groups with weights for matching quality
   * Higher weight = stronger relationship
   */
  private readonly CAPABILITY_GROUPS: Array<{ terms: string[]; weight: number }> = [
    // Development & Programming
    { terms: ['coding', 'programming', 'development', 'code', 'dev', 'software', 'engineer', 'implement'], weight: 1.0 },
    { terms: ['typescript', 'javascript', 'python', 'java', 'go', 'rust', 'nodejs', 'react', 'vue', 'angular'], weight: 0.9 },
    { terms: ['frontend', 'backend', 'fullstack', 'web', 'api', 'rest', 'graphql'], weight: 0.85 },

    // Testing & QA
    { terms: ['testing', 'test', 'qa', 'quality', 'unit', 'integration', 'e2e', 'selenium', 'jest', 'pytest'], weight: 1.0 },
    { terms: ['debug', 'debugging', 'troubleshoot', 'diagnose', 'fix'], weight: 0.8 },

    // DevOps & Infrastructure
    { terms: ['deploy', 'deployment', 'devops', 'ci', 'cd', 'cicd', 'pipeline', 'release'], weight: 1.0 },
    { terms: ['docker', 'kubernetes', 'k8s', 'container', 'orchestration', 'infrastructure'], weight: 0.9 },
    { terms: ['aws', 'azure', 'gcp', 'cloud', 'serverless', 'lambda'], weight: 0.85 },
    { terms: ['monitor', 'monitoring', 'observability', 'logging', 'metrics', 'alerting'], weight: 0.8 },

    // Data & Analytics
    { terms: ['analysis', 'analyze', 'analytics', 'data', 'insight', 'report', 'statistics'], weight: 1.0 },
    { terms: ['sql', 'database', 'db', 'postgres', 'mysql', 'mongodb', 'redis'], weight: 0.9 },
    { terms: ['etl', 'pipeline', 'transform', 'process', 'aggregate'], weight: 0.85 },
    { terms: ['ml', 'machine-learning', 'ai', 'model', 'prediction', 'training'], weight: 0.9 },

    // Research & Investigation
    { terms: ['research', 'investigate', 'search', 'explore', 'discover', 'gather'], weight: 1.0 },
    { terms: ['scan', 'scrape', 'crawl', 'extract', 'fetch'], weight: 0.8 },

    // Documentation & Writing
    { terms: ['writing', 'write', 'documentation', 'docs', 'document', 'readme', 'spec'], weight: 1.0 },
    { terms: ['content', 'copy', 'text', 'article', 'blog', 'technical-writing'], weight: 0.85 },

    // Security
    { terms: ['security', 'secure', 'auth', 'authentication', 'authorization', 'oauth', 'jwt'], weight: 1.0 },
    { terms: ['vulnerability', 'audit', 'penetration', 'pentest', 'scan', 'compliance'], weight: 0.9 },
    { terms: ['encrypt', 'encryption', 'crypto', 'certificate', 'ssl', 'tls'], weight: 0.85 },

    // Communication & Coordination
    { terms: ['manage', 'orchestrate', 'coordinate', 'plan', 'organize', 'lead'], weight: 1.0 },
    { terms: ['communicate', 'notify', 'alert', 'email', 'slack', 'webhook'], weight: 0.85 },

    // Design & UX
    { terms: ['design', 'ui', 'ux', 'interface', 'visual', 'layout', 'wireframe'], weight: 1.0 },
    { terms: ['css', 'style', 'theme', 'responsive', 'accessibility', 'a11y'], weight: 0.85 },

    // File & Media
    { terms: ['file', 'filesystem', 'storage', 'upload', 'download', 'backup'], weight: 1.0 },
    { terms: ['image', 'video', 'audio', 'media', 'convert', 'compress'], weight: 0.85 },
  ];

  /**
   * Check if two capabilities are semantically related
   * Returns match weight (0 = no match, 1 = perfect match)
   */
  private areCapabilitiesRelated(cap1: string, cap2: string): boolean {
    return this.getCapabilityMatchScore(cap1, cap2) > 0;
  }

  /**
   * Minimum length for substring matching to avoid false positives
   */
  private readonly MIN_SUBSTRING_LENGTH = 4;

  /**
   * Get detailed match score between two capabilities
   * Returns 0-1 score indicating strength of relationship
   */
  private getCapabilityMatchScore(cap1: string, cap2: string): number {
    const c1 = cap1.toLowerCase();
    const c2 = cap2.toLowerCase();

    // Direct match
    if (c1 === c2) return 1.0;

    // Substring match - require minimum length to avoid false positives
    // e.g., "data" should not match "dat", but "typescript" should match "script"
    if (c2.length >= this.MIN_SUBSTRING_LENGTH && c1.includes(c2)) return 0.9;
    if (c1.length >= this.MIN_SUBSTRING_LENGTH && c2.includes(c1)) return 0.9;

    // Check semantic groups
    for (const group of this.CAPABILITY_GROUPS) {
      const inGroup1 = group.terms.some(t =>
        (c1.includes(t) && t.length >= this.MIN_SUBSTRING_LENGTH) ||
        (t.includes(c1) && c1.length >= this.MIN_SUBSTRING_LENGTH)
      );
      const inGroup2 = group.terms.some(t =>
        (c2.includes(t) && t.length >= this.MIN_SUBSTRING_LENGTH) ||
        (t.includes(c2) && c2.length >= this.MIN_SUBSTRING_LENGTH)
      );
      if (inGroup1 && inGroup2) {
        return group.weight;
      }
    }

    // Levenshtein-like similarity for typos/variants
    // Only apply to strings of similar length to avoid false matches
    if (Math.abs(c1.length - c2.length) <= 2 && this.stringSimilarity(c1, c2) > 0.75) {
      return 0.6;
    }

    return 0;
  }

  /**
   * Simple string similarity (Dice coefficient)
   */
  private stringSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1;
    if (s1.length < 2 || s2.length < 2) return 0;

    const bigrams1 = new Set<string>();
    const bigrams2 = new Set<string>();

    for (let i = 0; i < s1.length - 1; i++) {
      bigrams1.add(s1.substring(i, i + 2));
    }
    for (let i = 0; i < s2.length - 1; i++) {
      bigrams2.add(s2.substring(i, i + 2));
    }

    let intersection = 0;
    for (const bg of bigrams1) {
      if (bigrams2.has(bg)) intersection++;
    }

    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

  /**
   * Generate reason string for agent selection
   */
  private getMatchReasonWithAnalysis(agent: AgentDTO, analysis: TaskAnalysis): string {
    const reasons: string[] = [];
    const agentCaps = (agent.capabilities || []).map(c => c.toLowerCase());

    const matchedCaps = analysis.requiredCapabilities.filter(rc =>
      agentCaps.some(ac => ac.includes(rc) || rc.includes(ac) || this.areCapabilitiesRelated(ac, rc))
    );

    if (matchedCaps.length > 0) {
      reasons.push(`matches: ${matchedCaps.join(', ')}`);
    }
    if (agent.type === 'specialist') {
      reasons.push('specialist');
    }
    if (agent.status === 'active') {
      reasons.push('available');
    }
    if (analysis.confidence > 0.8) {
      reasons.push('high confidence');
    }

    return reasons.join(', ') || 'default';
  }

  /**
   * Generate report of missing capabilities and suggestions
   */
  async generateMissingCapabilityReport(task: TaskDTO, analysis: TaskAnalysis): Promise<MissingCapabilityReport> {
    const { agentService } = getServices();
    const allAgents = await agentService.list();

    const existingCapabilities = new Set<string>();
    for (const agent of allAgents) {
      if (agent.capabilities) {
        agent.capabilities.forEach(c => existingCapabilities.add(c.toLowerCase()));
      }
    }

    const missingCapabilities: string[] = [];
    for (const required of analysis.requiredCapabilities) {
      const found = [...existingCapabilities].some(ec =>
        ec.includes(required) || required.includes(ec) || this.areCapabilitiesRelated(ec, required)
      );
      if (!found) {
        missingCapabilities.push(required);
      }
    }

    const suggestions: CapabilitySuggestion[] = [];

    for (const missing of missingCapabilities) {
      const suggestion = this.suggestResourceForCapability(missing, analysis);
      suggestions.push(suggestion);
    }

    // If no specific missing but no active agents, suggest agent
    if (missingCapabilities.length === 0 && allAgents.filter(a => a.status === 'active').length === 0) {
      suggestions.push({
        type: 'agent',
        name: `${analysis.taskType}-agent`,
        description: `Agent for ${analysis.taskType} tasks`,
        reason: 'No active agents available',
        canAutoGenerate: canCreateAgentAutonomously(),
        priority: 'required',
      });
    }

    const requiresApproval = suggestions.some(s => {
      switch (s.type) {
        case 'agent': return requiresApprovalForAgentCreation();
        case 'skill': return requiresApprovalForSkillGeneration();
        case 'tool': return requiresApprovalForToolGeneration();
        default: return true;
      }
    });

    const report: MissingCapabilityReport = {
      taskId: task.id,
      createdAt: Date.now(),
      missingCapabilities,
      suggestions,
      requiresApproval,
    };

    if (suggestions.length > 0) {
      logger.info({
        taskId: task.id,
        missing: missingCapabilities,
        suggestionsCount: suggestions.length,
        requiresApproval,
      }, 'Missing capability report generated');

      // Emit missing capability detected event
      const { eventService } = getServices();
      await eventService.emit({
        type: EVENT_TYPE.MISSING_CAPABILITY_DETECTED,
        category: 'orchestrator',
        severity: 'warning',
        message: `Missing capabilities for task: ${missingCapabilities.join(', ') || 'no active agents'}`,
        resourceType: 'task',
        resourceId: task.id,
        data: {
          missingCapabilities,
          suggestions: suggestions.map(s => ({ type: s.type, name: s.name, canAutoGenerate: s.canAutoGenerate })),
          requiresApproval,
        },
      });
    }

    return report;
  }

  /**
   * Resource type inference rules with confidence scores
   */
  private readonly RESOURCE_TYPE_RULES: Array<{
    keywords: string[];
    type: 'agent' | 'skill' | 'tool';
    confidence: number;
  }> = [
    // Tools - executable operations, integrations, external services
    { keywords: ['deploy', 'deployment', 'release', 'publish'], type: 'tool', confidence: 0.9 },
    { keywords: ['build', 'compile', 'bundle', 'package'], type: 'tool', confidence: 0.9 },
    { keywords: ['test', 'testing', 'e2e', 'integration-test'], type: 'tool', confidence: 0.85 },
    { keywords: ['run', 'execute', 'spawn', 'invoke'], type: 'tool', confidence: 0.85 },
    { keywords: ['send', 'post', 'notify', 'webhook', 'email', 'slack'], type: 'tool', confidence: 0.9 },
    { keywords: ['fetch', 'get', 'download', 'scrape', 'crawl'], type: 'tool', confidence: 0.85 },
    { keywords: ['api', 'rest', 'graphql', 'http', 'request'], type: 'tool', confidence: 0.8 },
    { keywords: ['database', 'db', 'sql', 'query', 'migrate'], type: 'tool', confidence: 0.85 },
    { keywords: ['docker', 'kubernetes', 'container', 'k8s'], type: 'tool', confidence: 0.9 },
    { keywords: ['git', 'github', 'gitlab', 'version-control'], type: 'tool', confidence: 0.85 },
    { keywords: ['encrypt', 'decrypt', 'hash', 'sign', 'certificate'], type: 'tool', confidence: 0.9 },
    { keywords: ['upload', 'storage', 's3', 'blob', 'file-system'], type: 'tool', confidence: 0.85 },
    { keywords: ['monitor', 'alert', 'log', 'metric', 'trace'], type: 'tool', confidence: 0.8 },

    // Skills - cognitive abilities, processing, generation
    { keywords: ['code', 'coding', 'programming', 'develop'], type: 'skill', confidence: 0.9 },
    { keywords: ['write', 'writing', 'draft', 'compose'], type: 'skill', confidence: 0.9 },
    { keywords: ['analyze', 'analysis', 'evaluate', 'assess'], type: 'skill', confidence: 0.9 },
    { keywords: ['research', 'investigate', 'explore', 'discover'], type: 'skill', confidence: 0.9 },
    { keywords: ['review', 'audit', 'check', 'validate'], type: 'skill', confidence: 0.85 },
    { keywords: ['process', 'transform', 'convert', 'parse'], type: 'skill', confidence: 0.8 },
    { keywords: ['design', 'architect', 'plan', 'blueprint'], type: 'skill', confidence: 0.85 },
    { keywords: ['debug', 'troubleshoot', 'diagnose', 'fix'], type: 'skill', confidence: 0.85 },
    { keywords: ['refactor', 'optimize', 'improve', 'enhance'], type: 'skill', confidence: 0.85 },
    { keywords: ['document', 'documentation', 'readme', 'spec'], type: 'skill', confidence: 0.85 },
    { keywords: ['translate', 'localize', 'i18n'], type: 'skill', confidence: 0.9 },

    // Agents - coordination, orchestration, management
    { keywords: ['manage', 'management', 'oversee', 'supervise'], type: 'agent', confidence: 0.9 },
    { keywords: ['orchestrate', 'orchestration', 'coordinate'], type: 'agent', confidence: 0.95 },
    { keywords: ['plan', 'planning', 'schedule', 'prioritize'], type: 'agent', confidence: 0.85 },
    { keywords: ['delegate', 'assign', 'distribute'], type: 'agent', confidence: 0.9 },
    // Note: 'monitor' intentionally excluded here - handled by tool rules above
    { keywords: ['watch', 'observe', 'track', 'supervisor'], type: 'agent', confidence: 0.7 },
    { keywords: ['specialist', 'expert', 'domain'], type: 'agent', confidence: 0.85 },
  ];

  /**
   * Suggest what resource to create for a missing capability
   */
  private suggestResourceForCapability(capability: string, analysis: TaskAnalysis): CapabilitySuggestion {
    const lowerCap = capability.toLowerCase();

    // Find best matching rule
    let bestMatch: { type: 'agent' | 'skill' | 'tool'; confidence: number } | null = null;

    for (const rule of this.RESOURCE_TYPE_RULES) {
      const matchScore = rule.keywords.reduce((score, kw) => {
        if (lowerCap.includes(kw) || kw.includes(lowerCap)) {
          return Math.max(score, rule.confidence);
        }
        // Partial match for related terms
        if (this.getCapabilityMatchScore(lowerCap, kw) > 0.5) {
          return Math.max(score, rule.confidence * 0.7);
        }
        return score;
      }, 0);

      if (matchScore > 0 && (!bestMatch || matchScore > bestMatch.confidence)) {
        bestMatch = { type: rule.type, confidence: matchScore };
      }
    }

    // Default to skill if no clear match
    const type = bestMatch?.type ?? 'skill';

    // Check autonomy permissions
    let canAutoGenerate = false;
    switch (type) {
      case 'agent':
        canAutoGenerate = canCreateAgentAutonomously();
        break;
      case 'skill':
        canAutoGenerate = canGenerateSkillAutonomously();
        break;
      case 'tool':
        canAutoGenerate = canGenerateToolAutonomously();
        break;
    }

    // Generate descriptive name and description
    const cleanName = capability.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const typeName = type.charAt(0).toUpperCase() + type.slice(1);

    // Determine priority based on context
    let priority: 'required' | 'recommended' | 'optional' = 'required';
    if (analysis.optionalCapabilities?.includes(capability)) {
      priority = 'recommended';
    }

    return {
      type,
      name: `${cleanName}-${type}`,
      description: `${typeName} providing ${capability} capability for ${analysis.taskType} tasks`,
      reason: `Task requires "${capability}" capability which is not available in any active agent`,
      canAutoGenerate,
      priority,
    };
  }

  // ============================================
  // Legacy methods (backward compatibility)
  // ============================================

  async findBestAgent(task: TaskDTO): Promise<TaskAssignment | null> {
    const { agentService } = getServices();
    const activeAgents = await agentService.getActive();

    if (activeAgents.length === 0) {
      logger.warn({ taskId: task.id }, 'No active agents available');
      return null;
    }

    // Score each agent
    const scored: TaskAssignment[] = [];

    for (const agent of activeAgents) {
      const score = this.scoreAgentLegacy(agent, task);
      if (score > 0) {
        scored.push({
          taskId: task.id,
          agentId: agent.id,
          score,
          reason: this.getMatchReasonLegacy(agent, task),
        });
      }
    }

    if (scored.length === 0) {
      logger.warn({ taskId: task.id, taskType: task.type }, 'No suitable agents found');
      return null;
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0]!;
    logger.info({ taskId: task.id, agentId: best.agentId, score: best.score }, 'Best agent selected');
    return best;
  }

  private scoreAgentLegacy(agent: AgentDTO, task: TaskDTO): number {
    let score = 50; // Base score

    // Agent type bonus
    if (agent.type === 'specialist' && task.type !== 'generic') {
      score += 20;
    }
    if (agent.type === 'orchestrator' && task.type === 'orchestration') {
      score += 30;
    }

    // Capability matching
    if (agent.capabilities && agent.capabilities.length > 0) {
      const taskType = task.type.toLowerCase();
      const matched = agent.capabilities.filter(cap =>
        taskType.includes(cap.toLowerCase()) || cap.toLowerCase().includes(taskType)
      );
      score += matched.length * 15;
    }

    // Busy agent penalty
    if (agent.status === 'busy') {
      score -= 30;
    }

    // Priority boost for critical tasks
    if (task.priority >= 4) {
      score += 10;
    }

    return Math.max(0, score);
  }

  private getMatchReasonLegacy(agent: AgentDTO, task: TaskDTO): string {
    const reasons: string[] = [];

    if (agent.type === 'specialist') {
      reasons.push('specialist agent');
    }
    if (agent.capabilities?.some(c => task.type.toLowerCase().includes(c.toLowerCase()))) {
      reasons.push('capability match');
    }
    if (agent.status === 'active') {
      reasons.push('available');
    }

    return reasons.join(', ') || 'default selection';
  }

  async detectMissingCapability(task: TaskDTO): Promise<string | null> {
    const { agentService } = getServices();
    const allAgents = await agentService.list();

    const taskType = task.type.toLowerCase();
    const allCapabilities = new Set<string>();

    for (const agent of allAgents) {
      if (agent.capabilities) {
        agent.capabilities.forEach(c => allCapabilities.add(c.toLowerCase()));
      }
    }

    // Check if task type matches any capability
    const hasMatch = [...allCapabilities].some(cap =>
      taskType.includes(cap) || cap.includes(taskType)
    );

    if (!hasMatch && taskType !== 'generic') {
      logger.info({ taskType }, 'Missing capability detected');
      return taskType;
    }

    return null;
  }

  async suggestNewCapability(taskType: string): Promise<{
    type: 'agent' | 'skill' | 'tool';
    name: string;
    description: string;
    canAutoGenerate: boolean;
  } | null> {
    // Simple heuristics for what to suggest
    const suggestions: Record<string, { type: 'agent' | 'skill' | 'tool'; name: string; description: string }> = {
      coding: { type: 'skill', name: 'coding-assistant', description: 'Coding and code review capabilities' },
      testing: { type: 'skill', name: 'test-runner', description: 'Test execution and validation' },
      research: { type: 'skill', name: 'research-assistant', description: 'Information gathering and analysis' },
      deploy: { type: 'tool', name: 'deployment-tool', description: 'Deployment automation tool' },
      analysis: { type: 'agent', name: 'analyst-agent', description: 'Data analysis specialist agent' },
    };

    const lowerType = taskType.toLowerCase();
    let suggestion: { type: 'agent' | 'skill' | 'tool'; name: string; description: string } | null = null;

    for (const [key, s] of Object.entries(suggestions)) {
      if (lowerType.includes(key)) {
        suggestion = s;
        break;
      }
    }

    // Default suggestion
    if (!suggestion) {
      suggestion = {
        type: 'skill',
        name: `${taskType}-handler`,
        description: `Handler for ${taskType} type tasks`,
      };
    }

    // Check if autonomous generation is allowed
    let canAutoGenerate = false;
    switch (suggestion.type) {
      case 'agent':
        canAutoGenerate = canCreateAgentAutonomously();
        break;
      case 'skill':
        canAutoGenerate = canGenerateSkillAutonomously();
        break;
      case 'tool':
        canAutoGenerate = canGenerateToolAutonomously();
        break;
    }

    return {
      ...suggestion,
      canAutoGenerate,
    };
  }

  // Check if current autonomy config allows automatic decisions
  canMakeAutonomousDecisions(): boolean {
    const config = getAutonomyConfig();
    return config.level !== 'manual';
  }
}

let decisionEngineInstance: DecisionEngine | null = null;

export function getDecisionEngine(): DecisionEngine {
  if (!decisionEngineInstance) {
    decisionEngineInstance = new DecisionEngine();
  }
  return decisionEngineInstance;
}

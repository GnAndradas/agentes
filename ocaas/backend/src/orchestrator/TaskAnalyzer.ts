import { createLogger } from '../utils/logger.js';
import { getGateway } from '../openclaw/index.js';
import { getServices } from '../services/index.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { TaskDTO } from '../types/domain.js';
import type { TaskAnalysis, SubtaskSuggestion } from './types.js';

const logger = createLogger('TaskAnalyzer');

const ANALYSIS_SYSTEM_PROMPT = `You are an expert task analysis assistant for an AI agent orchestration system.
Your job is to deeply analyze tasks and provide structured information that helps:
1. Assign the task to the most capable agent
2. Decide whether to decompose into subtasks
3. Identify missing capabilities that need to be created

CAPABILITY GUIDELINES:
- Use lowercase, hyphenated terms (e.g., "code-review", "api-integration")
- Be specific but not overly narrow (e.g., "typescript" not "typescript-4.9")
- Common capability categories:
  * coding, testing, debugging, code-review
  * api-integration, database, frontend, backend
  * deployment, devops, ci-cd, monitoring
  * research, analysis, data-processing
  * documentation, technical-writing
  * security, authentication, encryption
  * design, ui-ux, accessibility

DECOMPOSITION GUIDELINES:
- Only set canBeSubdivided=true if the task has 2+ distinct phases
- Each subtask should be independently executable
- Subtasks should have clear dependencies marked
- Don't over-decompose simple tasks

Respond ONLY with a valid JSON object (no markdown, no code blocks, no explanation):
{
  "intent": "string - the core goal/intention behind this task (1-2 sentences)",
  "taskType": "string - primary category: coding | testing | research | analysis | deployment | documentation | design | security | orchestration | generic",
  "complexity": "low | medium | high",
  "complexityReason": "string - brief explanation of why this complexity level",
  "requiredCapabilities": ["array of 1-5 specific capability strings needed"],
  "optionalCapabilities": ["array of nice-to-have capabilities"],
  "suggestedTools": ["array of tool/technology names that could help"],
  "canBeSubdivided": true/false,
  "subdivisionReason": "string - why it should or shouldn't be divided",
  "suggestedSubtasks": [
    {
      "title": "string - concise subtask title",
      "description": "string - what needs to be done",
      "type": "string - category of this subtask",
      "requiredCapabilities": ["capabilities for this specific subtask"],
      "order": 1,
      "dependsOnPrevious": false,
      "estimatedComplexity": "low | medium | high"
    }
  ],
  "estimatedDuration": "quick | normal | long",
  "riskFactors": ["array of potential risks or blockers"],
  "requiresHumanReview": true/false,
  "humanReviewReason": "string - why human review is/isn't needed",
  "confidence": 0.0 to 1.0
}

Be precise and practical. Focus on actionable, specific capabilities.`;

export class TaskAnalyzer {
  private analysisCache: Map<string, TaskAnalysis> = new Map();
  private cacheMaxAge = 5 * 60 * 1000; // 5 minutes

  /**
   * Analyze a task using AI via OpenClaw Gateway
   * Returns structured analysis or null if AI unavailable
   */
  async analyze(task: TaskDTO): Promise<TaskAnalysis | null> {
    // Check cache first
    const cached = this.getCached(task.id);
    if (cached) {
      logger.debug({ taskId: task.id }, 'Using cached analysis');
      return cached;
    }

    const gateway = getGateway();
    const { eventService } = getServices();

    if (!gateway.isConnected()) {
      logger.warn({ taskId: task.id }, 'Gateway not connected, cannot analyze task');
      await eventService.emit({
        type: EVENT_TYPE.TASK_ANALYSIS_FAILED,
        category: 'orchestrator',
        severity: 'warning',
        message: `Task analysis failed: Gateway not connected`,
        resourceType: 'task',
        resourceId: task.id,
        data: { reason: 'gateway_disconnected' },
      });
      return null;
    }

    // Emit analysis started event
    await eventService.emit({
      type: EVENT_TYPE.TASK_ANALYSIS_STARTED,
      category: 'orchestrator',
      severity: 'info',
      message: `Analyzing task "${task.title}"`,
      resourceType: 'task',
      resourceId: task.id,
    });

    const userPrompt = this.buildAnalysisPrompt(task);

    try {
      const result = await gateway.generate({
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 1024,
      });

      if (!result.success || !result.content) {
        logger.warn({ taskId: task.id, error: result.error }, 'AI analysis failed');
        await eventService.emit({
          type: EVENT_TYPE.TASK_ANALYSIS_FAILED,
          category: 'orchestrator',
          severity: 'warning',
          message: `Task analysis failed: ${result.error || 'No content returned'}`,
          resourceType: 'task',
          resourceId: task.id,
          data: { error: result.error },
        });
        return null;
      }

      const analysis = this.parseAnalysisResponse(task.id, result.content);

      if (analysis) {
        this.cache(analysis);
        logger.info({
          taskId: task.id,
          taskType: analysis.taskType,
          complexity: analysis.complexity,
          capabilities: analysis.requiredCapabilities.length,
          confidence: analysis.confidence,
        }, 'Task analyzed successfully');

        // Emit analysis completed event
        await eventService.emit({
          type: EVENT_TYPE.TASK_ANALYSIS_COMPLETED,
          category: 'orchestrator',
          severity: 'info',
          message: `Task analyzed: ${analysis.taskType} (${analysis.complexity} complexity)`,
          resourceType: 'task',
          resourceId: task.id,
          data: {
            taskType: analysis.taskType,
            complexity: analysis.complexity,
            requiredCapabilities: analysis.requiredCapabilities,
            confidence: analysis.confidence,
            canBeSubdivided: analysis.canBeSubdivided,
          },
        });
      }

      return analysis;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId: task.id }, 'Error analyzing task');
      await eventService.emit({
        type: EVENT_TYPE.TASK_ANALYSIS_FAILED,
        category: 'orchestrator',
        severity: 'error',
        message: `Task analysis error: ${errorMsg}`,
        resourceType: 'task',
        resourceId: task.id,
        data: { error: errorMsg },
      });
      return null;
    }
  }

  /**
   * Build the prompt for task analysis
   */
  private buildAnalysisPrompt(task: TaskDTO): string {
    const parts = [
      `Task Title: ${task.title}`,
      `Task Type (declared): ${task.type}`,
      `Priority: ${task.priority} (1=low, 4=critical)`,
    ];

    if (task.description) {
      parts.push(`Description: ${task.description}`);
    }

    if (task.input && Object.keys(task.input).length > 0) {
      parts.push(`Input Data: ${JSON.stringify(task.input, null, 2)}`);
    }

    if (task.metadata && Object.keys(task.metadata).length > 0) {
      parts.push(`Metadata: ${JSON.stringify(task.metadata, null, 2)}`);
    }

    if (task.parentTaskId) {
      parts.push(`Note: This is a subtask of parent ${task.parentTaskId}`);
    }

    if (task.batchId) {
      parts.push(`Note: Part of batch ${task.batchId}, sequence order ${task.sequenceOrder}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Parse and validate AI response
   */
  private parseAnalysisResponse(taskId: string, content: string): TaskAnalysis | null {
    try {
      // Try to extract JSON from response (in case there's extra text)
      let jsonStr = content.trim();

      // Handle markdown code blocks
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1]!.trim();
      }

      // Also try to find JSON object if there's text around it
      const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.intent || !parsed.taskType || !parsed.complexity) {
        logger.warn({ taskId }, 'Invalid analysis response: missing required fields');
        return null;
      }

      // Normalize and construct analysis
      const analysis: TaskAnalysis = {
        taskId,
        analyzedAt: Date.now(),
        intent: String(parsed.intent),
        taskType: String(parsed.taskType).toLowerCase(),
        complexity: this.normalizeComplexity(parsed.complexity),
        complexityReason: parsed.complexityReason ? String(parsed.complexityReason) : undefined,
        requiredCapabilities: this.normalizeCapabilities(parsed.requiredCapabilities),
        optionalCapabilities: parsed.optionalCapabilities
          ? this.normalizeCapabilities(parsed.optionalCapabilities)
          : undefined,
        suggestedTools: this.normalizeArray(parsed.suggestedTools),
        canBeSubdivided: Boolean(parsed.canBeSubdivided),
        subdivisionReason: parsed.subdivisionReason ? String(parsed.subdivisionReason) : undefined,
        suggestedSubtasks: this.normalizeSubtasks(parsed.suggestedSubtasks),
        riskFactors: parsed.riskFactors ? this.normalizeArray(parsed.riskFactors) : undefined,
        estimatedDuration: this.normalizeDuration(parsed.estimatedDuration),
        requiresHumanReview: Boolean(parsed.requiresHumanReview),
        humanReviewReason: parsed.humanReviewReason ? String(parsed.humanReviewReason) : undefined,
        confidence: this.normalizeConfidence(parsed.confidence),
      };

      return analysis;
    } catch (err) {
      logger.warn({ err, taskId, content: content.substring(0, 200) }, 'Failed to parse analysis response');
      return null;
    }
  }

  private normalizeComplexity(value: unknown): 'low' | 'medium' | 'high' {
    const str = String(value).toLowerCase();
    if (str === 'low' || str === 'medium' || str === 'high') {
      return str;
    }
    return 'medium';
  }

  private normalizeDuration(value: unknown): 'quick' | 'normal' | 'long' {
    const str = String(value).toLowerCase();
    if (str === 'quick' || str === 'normal' || str === 'long') {
      return str;
    }
    return 'normal';
  }

  private normalizeArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(v => String(v).toLowerCase());
    }
    return [];
  }

  /**
   * Normalize capability strings - standardize format
   */
  private normalizeCapabilities(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
      .map(v => String(v).toLowerCase().trim())
      // Remove duplicates
      .filter((v, i, arr) => arr.indexOf(v) === i)
      // Standardize common variations
      .map(cap => {
        return cap
          .replace(/\s+/g, '-')           // spaces to hyphens
          .replace(/_/g, '-')             // underscores to hyphens
          .replace(/[^a-z0-9-]/g, '')     // remove special chars
          .replace(/-+/g, '-')            // collapse multiple hyphens
          .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
      })
      .filter(cap => cap.length > 0);     // remove empty
  }

  private normalizeSubtasks(value: unknown): SubtaskSuggestion[] | undefined {
    if (!Array.isArray(value) || value.length === 0) {
      return undefined;
    }

    return value
      .filter(s => s && typeof s === 'object' && s.title)
      .map((s, i) => ({
        title: String(s.title),
        description: String(s.description || ''),
        type: String(s.type || 'generic'),
        requiredCapabilities: s.requiredCapabilities
          ? this.normalizeCapabilities(s.requiredCapabilities)
          : undefined,
        order: Number(s.order) || i + 1,
        dependsOnPrevious: Boolean(s.dependsOnPrevious),
        estimatedComplexity: s.estimatedComplexity
          ? this.normalizeComplexity(s.estimatedComplexity)
          : undefined,
      }));
  }

  private normalizeConfidence(value: unknown): number {
    const num = Number(value);
    if (isNaN(num)) return 0.5;
    return Math.max(0, Math.min(1, num));
  }

  /**
   * Get cached analysis if still valid
   */
  private getCached(taskId: string): TaskAnalysis | null {
    const cached = this.analysisCache.get(taskId);
    if (cached && Date.now() - cached.analyzedAt < this.cacheMaxAge) {
      return cached;
    }
    return null;
  }

  /**
   * Cache analysis result
   */
  private cache(analysis: TaskAnalysis): void {
    this.analysisCache.set(analysis.taskId, analysis);

    // Cleanup old entries periodically
    if (this.analysisCache.size > 100) {
      const now = Date.now();
      for (const [id, a] of this.analysisCache.entries()) {
        if (now - a.analyzedAt > this.cacheMaxAge) {
          this.analysisCache.delete(id);
        }
      }
    }
  }

  /**
   * Clear cache for a specific task
   */
  clearCache(taskId: string): void {
    this.analysisCache.delete(taskId);
  }

  /**
   * Create a basic/fallback analysis without AI
   * Used when gateway is unavailable
   */
  createFallbackAnalysis(task: TaskDTO): TaskAnalysis {
    return {
      taskId: task.id,
      analyzedAt: Date.now(),
      intent: task.description || task.title,
      taskType: task.type,
      complexity: task.priority >= 4 ? 'high' : task.priority >= 3 ? 'medium' : 'low',
      requiredCapabilities: [task.type],
      suggestedTools: [],
      canBeSubdivided: false,
      estimatedDuration: 'normal',
      requiresHumanReview: task.priority >= 4,
      confidence: 0.3, // Low confidence for fallback
    };
  }
}

// Singleton
let taskAnalyzerInstance: TaskAnalyzer | null = null;

export function getTaskAnalyzer(): TaskAnalyzer {
  if (!taskAnalyzerInstance) {
    taskAnalyzerInstance = new TaskAnalyzer();
  }
  return taskAnalyzerInstance;
}

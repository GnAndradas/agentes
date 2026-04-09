/**
 * Diagnostic Service (BLOQUE 11)
 *
 * Provides complete observability for tasks from end to end.
 * Single point of access for all traceability information.
 *
 * Aggregates:
 * - Task intake traceability
 * - Decision traceability
 * - Generation traceability (if applicable)
 * - Materialization traceability (if applicable)
 * - Execution traceability
 */

import { createLogger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { parseJsonSafe } from '../utils/helpers.js';
import type { TaskDTO, TaskIntakeTraceability } from '../types/domain.js';
import type {
  DecisionTraceability,
  GenerationTraceability,
  ExecutionTraceability as ContractExecutionTraceability,
} from '../types/contracts.js';
import type { ExecutionTraceability } from '../execution/ExecutionTraceability.js';
import type { AgentMaterializationStatus, MaterializationTraceability } from '../generator/AgentMaterialization.js';
import { getTaskStateManager } from '../execution/TaskStateManager/index.js';

const logger = createLogger('DiagnosticService');

// ============================================================================
// TIMELINE
// ============================================================================

/**
 * Task timeline with all important timestamps
 */
export interface TaskTimeline {
  /** Task created */
  created_at: number;

  /** Task queued for processing */
  queued_at?: number;

  /** Decision made (agent assignment) */
  decision_at?: number;

  /** Generation started (if task triggered generation) */
  generation_at?: number;

  /** Materialization completed (if applicable) */
  materialization_at?: number;

  /** Execution started */
  execution_started_at?: number;

  /** Execution completed */
  execution_completed_at?: number;

  /** Task completed or failed */
  completed_at?: number;

  /** Task failed */
  failed_at?: number;

  /** Total duration (ms) from created to completed/failed */
  total_duration_ms?: number;

  /** Time spent in queue (ms) */
  queue_duration_ms?: number;

  /** Decision duration (ms) */
  decision_duration_ms?: number;

  /** Execution duration (ms) */
  execution_duration_ms?: number;
}

// ============================================================================
// AI VS FALLBACK VISIBILITY
// ============================================================================

/**
 * AI usage summary for a task
 */
export interface AIUsageSummary {
  /** Any AI was used */
  ai_used: boolean;

  /** Any fallback was used */
  fallback_used: boolean;

  /** Fallback reasons (if any) */
  fallback_reasons: string[];

  /** AI models used (if any) */
  ai_models_used: string[];

  /** Estimated cost (if available) */
  estimated_cost_usd?: number;

  /** Actual cost (if available) */
  actual_cost_usd?: number;

  /** Total tokens consumed */
  total_tokens?: {
    input: number;
    output: number;
  };

  /** Decision AI usage */
  decision: {
    ai_used: boolean;
    source: 'heuristic' | 'ai' | 'hybrid';
    confidence: number;
  };

  /** Generation AI usage (if applicable) */
  generation?: {
    ai_used: boolean;
    fallback_used: boolean;
    fallback_reason?: string;
    tokens?: { input: number; output: number };
  };
}

// ============================================================================
// EXECUTION VISIBILITY
// ============================================================================

/**
 * Execution summary for a task
 */
export interface ExecutionSummary {
  /** Execution mode used */
  execution_mode: 'hooks_session' | 'chat_completion' | 'stub' | 'real_agent';

  /** Agent was runtime_ready */
  runtime_ready: boolean;

  /** Transport succeeded */
  transport_success: boolean;

  /** Fallback was used */
  fallback_used: boolean;

  /** Fallback reason */
  fallback_reason?: string;

  /** Gap explanation */
  gap?: string;

  /** Session ID (if any) */
  session_id?: string;

  /** Session key (for hooks_session mode) */
  session_key?: string;

  /** Response received */
  response_received: boolean;

  /**
   * HOOKS MIGRATION: Async outcome tracking
   * - 'completed_sync': Response received immediately (chat_completion)
   * - 'accepted_async': Job accepted, awaiting async delivery (hooks_session)
   * - 'failed': Job failed
   */
  outcome?: 'completed_sync' | 'accepted_async' | 'failed';

  /**
   * Resource traceability for skills/tools
   *
   * IMPORTANT: usage_verified follows strict contractual verification.
   * Never assume injected = used. Never infer from text.
   */
  resources?: {
    /** Tools assigned to agent */
    assigned_tools: string[];
    /** Skills assigned to agent */
    assigned_skills: string[];
    /** How resources were injected: native (body), prompt (fallback), none */
    injection_mode?: 'native' | 'prompt' | 'none';
    /**
     * Is resource usage verified by structured runtime confirmation?
     * true ONLY if OpenClaw returned explicit resources_used field
     * false if no structured confirmation (current state)
     */
    usage_verified: boolean;
    /** Source of verification: 'runtime_receipt' | 'unverified' */
    verification_source: 'runtime_receipt' | 'unverified';
    /** Tools confirmed as used - ONLY populated if usage_verified = true */
    tools_used: string[];
    /** Skills confirmed as used - ONLY populated if usage_verified = true */
    skills_used: string[];
    /** Explanation when usage_verified = false */
    unverified_reason?: string;
  };
}

// ============================================================================
// FULL DIAGNOSTICS
// ============================================================================

/**
 * Task execution state snapshot for diagnostics
 */
export interface TaskStateInfo {
  /** Current execution phase */
  phase?: string;
  /** Current step ID */
  current_step_id?: string;
  /** Current step name */
  current_step_name?: string;
  /** Completed steps count */
  completed_steps: number;
  /** Total steps count */
  total_steps: number;
  /** Pending steps count */
  pending_steps: number;
  /** Failed steps count */
  failed_steps: number;
  /** Checkpoints count */
  checkpoints_count: number;
  /** Progress percentage */
  progress_pct: number;
  /** Paused reason (if paused) */
  paused_reason?: string;
  /** Resume from checkpoint ID */
  resume_from?: string;
  /** Last meaningful update */
  last_update_at?: number;
  /** State warnings */
  state_warnings: string[];
}

/**
 * Complete task diagnostics
 */
export interface TaskDiagnostics {
  /** Task ID */
  task_id: string;

  /** Task basic info */
  task: {
    title: string;
    status: string;
    type: string;
    priority: number;
    agent_id?: string;
  };

  /** Timeline */
  timeline: TaskTimeline;

  /** Intake traceability */
  intake?: TaskIntakeTraceability;

  /** Decision traceability */
  decision?: DecisionTraceability;

  /** Generation traceability (if task triggered generation) */
  generation?: GenerationTraceability;

  /** Materialization traceability (if applicable) */
  materialization?: MaterializationTraceability;

  /** Execution traceability */
  execution?: ExecutionTraceability;

  /** AI usage summary */
  ai_usage: AIUsageSummary;

  /** Execution summary */
  execution_summary?: ExecutionSummary;

  /** Task execution state (TASK STATE MANAGER) */
  task_state?: TaskStateInfo;

  /** All gaps detected */
  gaps: string[];

  /** Diagnostic warnings */
  warnings: string[];

  /** Diagnostic timestamp */
  diagnosed_at: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class DiagnosticService {
  /**
   * Get complete diagnostics for a task
   */
  async getTaskDiagnostics(taskId: string): Promise<TaskDiagnostics> {
    // Get task
    const taskRows = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    if (taskRows.length === 0) {
      throw new NotFoundError('Task', taskId);
    }
    const taskRow = taskRows[0]!;

    // Get associated job (if any)
    const jobRows = await db.select().from(schema.jobs).where(eq(schema.jobs.taskId, taskId)).limit(1);
    const jobRow = jobRows.length > 0 ? jobRows[0] : null;

    // Get associated generation (via metadata)
    const metadata = parseJsonSafe(taskRow.metadata) as Record<string, unknown> | undefined;
    const generationId = metadata?.generationId as string | undefined;
    let generationRow = null;
    if (generationId) {
      const genRows = await db.select().from(schema.generations).where(eq(schema.generations.id, generationId)).limit(1);
      generationRow = genRows.length > 0 ? genRows[0] : null;
    }

    // Build timeline
    const timeline = this.buildTimeline(taskRow, jobRow ?? null);

    // Extract traceabilities
    const intake = this.extractIntake(metadata);
    const decision = this.extractDecision(metadata);
    const generation = this.extractGeneration(generationRow ?? null);
    const materialization = this.extractMaterialization(metadata);
    const execution = this.extractExecution(jobRow ?? null);

    // Build AI usage summary
    const aiUsage = this.buildAIUsageSummary(decision, generation, execution);

    // Build execution summary
    const executionSummary = execution ? this.buildExecutionSummary(execution) : undefined;

    // Collect gaps
    const gaps = this.collectGaps(execution, generation, materialization);

    // Collect warnings
    const warnings = this.collectWarnings(taskRow, jobRow ?? null, decision, execution);

    // TASK STATE: Get execution state info
    const taskStateInfo = await this.getTaskStateInfo(taskId);

    const diagnostics: TaskDiagnostics = {
      task_id: taskId,
      task: {
        title: taskRow.title,
        status: taskRow.status,
        type: taskRow.type,
        priority: taskRow.priority,
        agent_id: taskRow.agentId ?? undefined,
      },
      timeline,
      intake,
      decision,
      generation,
      materialization,
      execution,
      ai_usage: aiUsage,
      execution_summary: executionSummary,
      task_state: taskStateInfo,
      gaps,
      warnings: [...warnings, ...(taskStateInfo?.state_warnings || [])],
      diagnosed_at: Date.now(),
    };

    logger.debug({ taskId, gaps: gaps.length, warnings: warnings.length }, 'Task diagnostics generated');

    return diagnostics;
  }

  /**
   * Get task state info for diagnostics
   */
  private async getTaskStateInfo(taskId: string): Promise<TaskStateInfo | undefined> {
    try {
      const stateManager = getTaskStateManager();
      const snapshot = await stateManager.getSnapshot(taskId);

      if (!snapshot) return undefined;

      return {
        phase: snapshot.phase,
        current_step_id: snapshot.currentStepId,
        current_step_name: snapshot.currentStepName,
        completed_steps: snapshot.completedStepsCount,
        total_steps: snapshot.totalStepsCount,
        pending_steps: snapshot.pendingStepsCount,
        failed_steps: snapshot.failedStepsCount,
        checkpoints_count: snapshot.checkpointsCount,
        progress_pct: snapshot.progressPct,
        paused_reason: snapshot.pausedReason,
        resume_from: snapshot.resumeFromCheckpointId,
        last_update_at: snapshot.lastMeaningfulUpdateAt,
        state_warnings: snapshot.warnings,
      };
    } catch (err) {
      logger.debug({ taskId, err }, 'No task state found');
      return undefined;
    }
  }

  /**
   * Build timeline from task and job data
   */
  private buildTimeline(
    taskRow: typeof schema.tasks.$inferSelect,
    jobRow: typeof schema.jobs.$inferSelect | null
  ): TaskTimeline {
    const metadata = parseJsonSafe(taskRow.metadata) as Record<string, unknown> | undefined;
    const intake = metadata?._intake as Record<string, unknown> | undefined;

    const timeline: TaskTimeline = {
      created_at: taskRow.createdAt,
    };

    // Queued at
    if (intake?.queued_at) {
      timeline.queued_at = intake.queued_at as number;
    }

    // Decision at (from metadata)
    const decisionTrace = metadata?._decision as Record<string, unknown> | undefined;
    if (decisionTrace?.decided_at) {
      timeline.decision_at = decisionTrace.decided_at as number;
    }

    // Generation at (from metadata)
    const genTrace = metadata?._generation as Record<string, unknown> | undefined;
    if (genTrace?.generated_at) {
      timeline.generation_at = genTrace.generated_at as number;
    }

    // Started at
    if (taskRow.startedAt) {
      timeline.execution_started_at = taskRow.startedAt;
    }

    // Completed/Failed at
    if (taskRow.completedAt) {
      if (taskRow.status === 'completed') {
        timeline.completed_at = taskRow.completedAt;
      } else if (taskRow.status === 'failed') {
        timeline.failed_at = taskRow.completedAt;
      }
    }

    // Job-level timestamps
    if (jobRow) {
      const jobResponse = parseJsonSafe(jobRow.response) as Record<string, unknown> | undefined;
      const traceability = jobResponse?.traceability as Record<string, unknown> | undefined;

      if (traceability?.execution_started_at) {
        timeline.execution_started_at = traceability.execution_started_at as number;
      }
      if (traceability?.execution_completed_at) {
        timeline.execution_completed_at = traceability.execution_completed_at as number;
      }
    }

    // Calculate durations
    const endTime = timeline.completed_at || timeline.failed_at;
    if (endTime) {
      timeline.total_duration_ms = endTime - timeline.created_at;
    }

    if (timeline.queued_at && timeline.decision_at) {
      timeline.queue_duration_ms = timeline.decision_at - timeline.queued_at;
    }

    if (timeline.execution_started_at && timeline.execution_completed_at) {
      timeline.execution_duration_ms = timeline.execution_completed_at - timeline.execution_started_at;
    }

    return timeline;
  }

  /**
   * Extract intake traceability from metadata
   */
  private extractIntake(metadata?: Record<string, unknown>): TaskIntakeTraceability | undefined {
    const intake = metadata?._intake as Record<string, unknown> | undefined;
    if (!intake) return undefined;

    return {
      ingress_mode: (intake.ingress_mode as string) as TaskIntakeTraceability['ingress_mode'],
      queued_at: intake.queued_at as number | undefined,
      source_channel: intake.source_channel as string | undefined,
      decomposed_from: intake.decomposed_from as string | undefined,
      batch_id: intake.batch_id as string | undefined,
    };
  }

  /**
   * Extract decision traceability from metadata
   */
  private extractDecision(metadata?: Record<string, unknown>): DecisionTraceability | undefined {
    const decision = metadata?._decision as Record<string, unknown> | undefined;
    if (!decision) return undefined;

    return {
      decision_source: (decision.decision_source || 'heuristic') as DecisionTraceability['decision_source'],
      decision_confidence: (decision.decision_confidence ?? 0) as number,
      decision_validated: (decision.decision_validated ?? false) as boolean,
      heuristic_method: decision.heuristic_method as string | undefined,
      ai_model: decision.ai_model as string | undefined,
      decided_at: (decision.decided_at ?? 0) as number,
      execution_time_ms: decision.execution_time_ms as number | undefined,
      decision_reason: decision.decision_reason as string | undefined,
    };
  }

  /**
   * Extract generation traceability from generation record
   */
  private extractGeneration(
    generationRow: typeof schema.generations.$inferSelect | null
  ): GenerationTraceability | undefined {
    if (!generationRow) return undefined;

    const content = parseJsonSafe(generationRow.generatedContent) as Record<string, unknown> | undefined;
    const traceability = content?._traceability as Record<string, unknown> | undefined;

    if (!traceability) {
      // Build basic traceability from generation record
      return {
        ai_requested: true,
        ai_available: generationRow.status !== 'failed',
        ai_generation_attempted: true,
        ai_generation_succeeded: generationRow.status === 'active',
        fallback_used: false,
        fallback_reason: null,
        fallback_template_name: null,
        generated_at: generationRow.createdAt,
      };
    }

    return {
      ai_requested: (traceability.ai_requested ?? false) as boolean,
      ai_available: (traceability.ai_available ?? false) as boolean,
      ai_generation_attempted: (traceability.ai_generation_attempted ?? false) as boolean,
      ai_generation_succeeded: (traceability.ai_generation_succeeded ?? false) as boolean,
      fallback_used: (traceability.fallback_used ?? false) as boolean,
      fallback_reason: traceability.fallback_reason as string | null,
      fallback_template_name: traceability.fallback_template_name as string | null,
      generated_at: (traceability.generated_at ?? generationRow.createdAt) as number,
      ai_model: traceability.ai_model as string | undefined,
      ai_tokens: traceability.ai_tokens as { input: number; output: number } | undefined,
    };
  }

  /**
   * Extract materialization traceability from metadata
   */
  private extractMaterialization(metadata?: Record<string, unknown>): MaterializationTraceability | undefined {
    const mat = metadata?._materialization as Record<string, unknown> | undefined;
    if (!mat) return undefined;

    return {
      attempted_at: (mat.attempted_at ?? 0) as number,
      source: (mat.source || 'system') as MaterializationTraceability['source'],
      steps_attempted: (mat.steps_attempted || []) as string[],
      steps_completed: (mat.steps_completed || []) as string[],
      steps_failed: (mat.steps_failed || []) as string[],
      final_state: (mat.final_state || 'record') as MaterializationTraceability['final_state'],
      runtime_ready: (mat.runtime_ready ?? false) as boolean,
      gap: mat.gap as string | undefined,
    };
  }

  /**
   * Extract execution traceability from job record
   */
  private extractExecution(
    jobRow: typeof schema.jobs.$inferSelect | null
  ): ExecutionTraceability | undefined {
    if (!jobRow) return undefined;

    const response = parseJsonSafe(jobRow.response) as Record<string, unknown> | undefined;
    const traceability = response?.traceability as Record<string, unknown> | undefined;

    if (!traceability) {
      // Build basic traceability from job
      return {
        execution_mode: 'chat_completion',
        transport: 'rest_api',
        target_agent_id: jobRow.agentId ?? '',
        openclaw_session_id: jobRow.sessionId ?? undefined,
        runtime_ready_at_execution: false,
        gateway_configured: true,
        gateway_connected: jobRow.status !== 'failed',
        websocket_connected: false,
        transport_success: jobRow.status === 'completed' || jobRow.status === 'accepted',
        accepted_async: jobRow.status === 'accepted',
        execution_fallback_used: false,
        execution_started_at: jobRow.createdAt,
        execution_completed_at: jobRow.updatedAt,
        response_received: jobRow.status === 'completed',
        ai_generated: jobRow.status === 'completed',
      };
    }

    return traceability as unknown as ExecutionTraceability;
  }

  /**
   * Build AI usage summary
   */
  private buildAIUsageSummary(
    decision?: DecisionTraceability,
    generation?: GenerationTraceability,
    _execution?: ExecutionTraceability
  ): AIUsageSummary {
    const fallbackReasons: string[] = [];
    const aiModelsUsed: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Decision AI usage
    const decisionAI = decision?.decision_source === 'ai' || decision?.decision_source === 'hybrid';
    if (decision?.ai_model) {
      aiModelsUsed.push(decision.ai_model);
    }

    // Generation AI usage
    let generationAI = false;
    if (generation) {
      generationAI = generation.ai_generation_succeeded;
      if (generation.fallback_used && generation.fallback_reason) {
        fallbackReasons.push(generation.fallback_reason);
      }
      if (generation.ai_model) {
        aiModelsUsed.push(generation.ai_model);
      }
      if (generation.ai_tokens) {
        totalInputTokens += generation.ai_tokens.input;
        totalOutputTokens += generation.ai_tokens.output;
      }
    }

    const aiUsed = decisionAI || generationAI;
    const fallbackUsed = fallbackReasons.length > 0;

    return {
      ai_used: aiUsed,
      fallback_used: fallbackUsed,
      fallback_reasons: fallbackReasons,
      ai_models_used: [...new Set(aiModelsUsed)],
      total_tokens: (totalInputTokens > 0 || totalOutputTokens > 0) ? {
        input: totalInputTokens,
        output: totalOutputTokens,
      } : undefined,
      decision: {
        ai_used: decisionAI,
        source: decision?.decision_source ?? 'heuristic',
        confidence: decision?.decision_confidence ?? 0,
      },
      generation: generation ? {
        ai_used: generationAI,
        fallback_used: generation.fallback_used,
        fallback_reason: generation.fallback_reason ?? undefined,
        tokens: generation.ai_tokens,
      } : undefined,
    };
  }

  /**
   * Build execution summary
   */
  private buildExecutionSummary(execution: ExecutionTraceability): ExecutionSummary {
    // HOOKS MIGRATION: Determine outcome based on mode and response
    let outcome: 'completed_sync' | 'accepted_async' | 'failed';
    if (!execution.transport_success) {
      outcome = 'failed';
    } else if (execution.execution_mode === 'hooks_session' && !execution.response_received) {
      // hooks_session with transport success but no response = accepted_async
      outcome = 'accepted_async';
    } else if (execution.response_received) {
      outcome = 'completed_sync';
    } else {
      outcome = 'failed';
    }

    // RESOURCE TRACEABILITY: Build resources object for UI
    // Uses strict contractual verification - never infer usage
    const resources = execution.resources_assigned || execution.resources_injected || execution.resources_usage
      ? {
          assigned_tools: execution.resources_assigned?.tools || [],
          assigned_skills: execution.resources_assigned?.skills || [],
          injection_mode: execution.resources_injected?.injection_mode,
          // STRICT VERIFICATION: Only true if OpenClaw confirms structurally
          usage_verified: execution.resources_usage?.verified ?? false,
          verification_source: execution.resources_usage?.verification_source || 'unverified',
          // Only populated if verified = true (enforced by builder)
          tools_used: execution.resources_usage?.tools_used || [],
          skills_used: execution.resources_usage?.skills_used || [],
          unverified_reason: execution.resources_usage?.unverified_reason,
        }
      : undefined;

    return {
      execution_mode: execution.execution_mode,
      runtime_ready: execution.runtime_ready_at_execution,
      transport_success: execution.transport_success,
      fallback_used: execution.execution_fallback_used,
      fallback_reason: execution.execution_fallback_reason,
      gap: execution.gap,
      session_id: execution.openclaw_session_id,
      session_key: execution.session_key,
      response_received: execution.response_received,
      outcome,
      resources,
    };
  }

  /**
   * Collect all gaps from traceabilities
   */
  private collectGaps(
    execution?: ExecutionTraceability,
    generation?: GenerationTraceability,
    materialization?: MaterializationTraceability
  ): string[] {
    const gaps: string[] = [];

    if (execution?.gap) {
      gaps.push(execution.gap);
    }

    if (materialization?.gap) {
      gaps.push(materialization.gap);
    }

    // Check for execution mode gap
    if (execution?.execution_mode === 'chat_completion') {
      gaps.push('Execution uses chat_completion, not real_agent. Each call is stateless.');
    }

    // Check for fallback gap
    if (generation?.fallback_used && generation.fallback_reason) {
      gaps.push(`Generation fallback: ${generation.fallback_reason}`);
    }

    return gaps;
  }

  /**
   * Collect warnings from diagnostics
   */
  private collectWarnings(
    taskRow: typeof schema.tasks.$inferSelect,
    jobRow: typeof schema.jobs.$inferSelect | null,
    decision?: DecisionTraceability,
    execution?: ExecutionTraceability
  ): string[] {
    const warnings: string[] = [];

    // No agent assigned
    if (!taskRow.agentId && taskRow.status !== 'pending') {
      warnings.push('Task has no agent assigned');
    }

    // No job created
    if (!jobRow && taskRow.status === 'running') {
      warnings.push('Task is running but no job record found');
    }

    // Low confidence decision
    if (decision && decision.decision_confidence < 0.5) {
      warnings.push(`Low decision confidence: ${(decision.decision_confidence * 100).toFixed(0)}%`);
    }

    // Execution fallback used
    if (execution?.execution_fallback_used) {
      warnings.push(`Execution fallback used: ${execution.execution_fallback_reason || 'unknown'}`);
    }

    // Transport failed (but not for accepted_async which is expected without immediate response)
    if (execution && !execution.transport_success && !execution.accepted_async) {
      warnings.push('Transport failed during execution');
    }

    // Not runtime ready
    if (execution && !execution.runtime_ready_at_execution) {
      warnings.push('Agent was not runtime_ready at execution time');
    }

    return warnings;
  }

  /**
   * Get diagnostics summary for multiple tasks
   */
  async getTasksDiagnosticsSummary(taskIds: string[]): Promise<{
    total: number;
    ai_used_count: number;
    fallback_used_count: number;
    execution_success_count: number;
    gaps_count: number;
    warnings_count: number;
  }> {
    let aiUsedCount = 0;
    let fallbackUsedCount = 0;
    let executionSuccessCount = 0;
    let totalGaps = 0;
    let totalWarnings = 0;

    for (const taskId of taskIds) {
      try {
        const diag = await this.getTaskDiagnostics(taskId);
        if (diag.ai_usage.ai_used) aiUsedCount++;
        if (diag.ai_usage.fallback_used) fallbackUsedCount++;
        if (diag.execution_summary?.transport_success) executionSuccessCount++;
        totalGaps += diag.gaps.length;
        totalWarnings += diag.warnings.length;
      } catch {
        // Skip tasks that can't be diagnosed
      }
    }

    return {
      total: taskIds.length,
      ai_used_count: aiUsedCount,
      fallback_used_count: fallbackUsedCount,
      execution_success_count: executionSuccessCount,
      gaps_count: totalGaps,
      warnings_count: totalWarnings,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: DiagnosticService | null = null;

export function getDiagnosticService(): DiagnosticService {
  if (!instance) {
    instance = new DiagnosticService();
  }
  return instance;
}

export function resetDiagnosticService(): void {
  instance = null;
}

/**
 * Job Dispatcher Service
 *
 * Orchestrates job execution by:
 * 1. Receiving decisions from OrgAwareDecisionEngine
 * 2. Building JobPayload from task + agent context
 * 3. Dispatching to OpenClawAdapter
 * 4. Processing responses (success, error, blocking)
 * 5. Creating resource proposals when blocked
 *
 * This is the bridge between OCAAS (control plane) and OpenClaw (runtime).
 */

import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getOpenClawAdapter } from '../integrations/openclaw/OpenClawAdapter.js';
import { getServices } from '../services/index.js';
import { getAgentHierarchyStore } from '../organization/AgentHierarchyStore.js';
import { db, schema } from '../db/index.js';
import { config } from '../config/index.js';
import type { OrgAwareDecision } from '../orchestrator/OrgAwareDecisionEngine.js';
import type { TaskDTO, AgentDTO } from '../types/domain.js';
import type {
  JobPayload,
  JobResponse,
  JobResult,
  JobError,
  JobBlocked,
  JobStatus,
  JobAgentContext,
  JobAllowedResources,
  JobConstraints,
  JobContext,
  JobRecord,
  JobEvent,
  DispatchOptions,
  DispatchResult,
  BlockingSuggestion,
  MissingResource,
} from './types.js';
import type { AutonomyPolicy } from '../organization/types.js';
import {
  createExecutionTraceability,
  detectExecutionMode,
  checkRuntimeReady,
  type ExecutionTraceability,
} from './ExecutionTraceability.js';
import {
  getGlobalBudgetManager,
  type BudgetCheckResult,
} from '../budget/index.js';
import { getTaskStateManager } from './TaskStateManager/index.js';
import { getToolExecutionService, type ToolExecutionResult } from './ToolExecutionService.js';
import { getGenerationTraceService } from './GenerationTraceService.js';

const logger = createLogger('JobDispatcherService');

// =============================================================================
// ASYNC TIMEOUT CONFIG
// =============================================================================

/**
 * Timeout for accepted_async execution before fallback/failure
 * When hooks_session accepts dispatch but no immediate response,
 * wait this long before triggering fallback or marking failed.
 */
const HOOKS_ASYNC_TIMEOUT_MS = 10000; // 10 seconds

// =============================================================================
// TOOL CALL DETECTION
// =============================================================================

/**
 * Pattern to detect tool call in IA response
 * Format: "run_command: <command>" or similar
 */
const TOOL_CALL_PATTERNS = [
  // run_command: echo hello
  /run_command:\s*(.+?)(?:\n|$)/i,
  // [run_command] echo hello
  /\[run_command\]\s*(.+?)(?:\n|$)/i,
  // ```run_command\necho hello\n```
  /```run_command\n(.+?)\n```/is,
  // <tool>run_command</tool><input>echo hello</input>
  /<tool>run_command<\/tool>\s*<input>(.+?)<\/input>/is,
];

interface DetectedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  rawMatch: string;
}

/**
 * Detect tool call intention in IA response
 */
function detectToolCall(response: string): DetectedToolCall | null {
  for (const pattern of TOOL_CALL_PATTERNS) {
    const match = response.match(pattern);
    if (match && match[1]) {
      const command = match[1].trim();
      if (command) {
        return {
          toolName: 'run_command',
          input: { command },
          rawMatch: match[0],
        };
      }
    }
  }
  return null;
}

/** Generate a unique ID with prefix */
function generateId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
}

/** Timeout error for job execution */
class JobTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Job execution timed out after ${timeoutMs}ms`);
    this.name = 'JobTimeoutError';
  }
}

/** Wraps a promise with timeout control */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController?: AbortController
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController?.abort();
      reject(new JobTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ============================================================================
// JOB STORE (SQLite persistent + in-memory cache for active jobs)
// ============================================================================

class JobStore {
  // Cache for active jobs (running, pending, blocked) for fast access
  private cache = new Map<string, JobRecord>();

  private rowToRecord(row: typeof schema.jobs.$inferSelect): JobRecord {
    return {
      id: row.id,
      payload: JSON.parse(row.payload) as JobPayload,
      status: row.status as JobStatus,
      sessionId: row.sessionId ?? undefined,
      response: row.response ? JSON.parse(row.response) as JobResponse : undefined,
      events: row.events ? JSON.parse(row.events) as Array<{ timestamp: number; event: JobEvent }> : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  create(payload: JobPayload): JobRecord {
    const now = nowTimestamp();
    const events: Array<{ timestamp: number; event: JobEvent }> = [{
      timestamp: now,
      event: { type: 'SUBMIT', payload },
    }];

    const record: JobRecord = {
      id: payload.jobId,
      payload,
      status: 'pending',
      events,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into DB
    db.insert(schema.jobs).values({
      id: record.id,
      taskId: payload.taskId,
      agentId: payload.agent.agentId,
      agentName: payload.agent.name,
      agentRole: payload.agent.role,
      goal: payload.goal,
      description: payload.description,
      status: record.status,
      payload: JSON.stringify(payload),
      events: JSON.stringify(events),
      createdAt: now,
      updatedAt: now,
    }).run();

    // Cache active job
    this.cache.set(record.id, record);
    return record;
  }

  get(jobId: string): JobRecord | null {
    // Check cache first
    const cached = this.cache.get(jobId);
    if (cached) return cached;

    // Query DB
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get();
    if (!row) return null;

    const record = this.rowToRecord(row);
    // Cache if still active
    if (['pending', 'running', 'blocked'].includes(record.status)) {
      this.cache.set(jobId, record);
    }
    return record;
  }

  update(jobId: string, updates: Partial<JobRecord>): JobRecord | null {
    const existing = this.get(jobId);
    if (!existing) return null;

    const now = nowTimestamp();
    const updated: JobRecord = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    // Update DB
    db.update(schema.jobs).set({
      status: updated.status,
      sessionId: updated.sessionId,
      response: updated.response ? JSON.stringify(updated.response) : null,
      events: JSON.stringify(updated.events),
      updatedAt: now,
      completedAt: updated.response?.completedAt,
    }).where(eq(schema.jobs.id, jobId)).run();

    // Update cache
    if (['pending', 'running', 'blocked'].includes(updated.status)) {
      this.cache.set(jobId, updated);
    } else {
      this.cache.delete(jobId);
    }

    return updated;
  }

  addEvent(jobId: string, event: JobEvent): void {
    const record = this.get(jobId);
    if (!record) return;

    const now = nowTimestamp();
    record.events.push({ timestamp: now, event });
    record.updatedAt = now;

    db.update(schema.jobs).set({
      events: JSON.stringify(record.events),
      updatedAt: now,
    }).where(eq(schema.jobs.id, jobId)).run();

    if (this.cache.has(jobId)) {
      this.cache.set(jobId, record);
    }
  }

  setStatus(jobId: string, status: JobStatus, sessionId?: string): void {
    const record = this.get(jobId);
    if (!record) return;

    const now = nowTimestamp();
    record.status = status;
    if (sessionId) record.sessionId = sessionId;
    record.updatedAt = now;

    db.update(schema.jobs).set({
      status,
      sessionId: sessionId ?? record.sessionId,
      updatedAt: now,
    }).where(eq(schema.jobs.id, jobId)).run();

    if (['pending', 'running', 'blocked'].includes(status)) {
      this.cache.set(jobId, record);
    } else {
      this.cache.delete(jobId);
    }
  }

  setResponse(jobId: string, response: JobResponse): void {
    const record = this.get(jobId);
    if (!record) return;

    const now = nowTimestamp();
    record.response = response;
    record.status = response.status;
    record.updatedAt = now;

    db.update(schema.jobs).set({
      response: JSON.stringify(response),
      status: response.status,
      updatedAt: now,
      completedAt: response.completedAt,
    }).where(eq(schema.jobs.id, jobId)).run();

    // Remove from cache if completed
    if (!['pending', 'running', 'blocked'].includes(response.status)) {
      this.cache.delete(jobId);
    } else {
      this.cache.set(jobId, record);
    }
  }

  list(limit = 100): JobRecord[] {
    const rows = db.select()
      .from(schema.jobs)
      .orderBy(desc(schema.jobs.createdAt))
      .limit(limit)
      .all();
    return rows.map(r => this.rowToRecord(r));
  }

  getByTask(taskId: string): JobRecord[] {
    const rows = db.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.taskId, taskId))
      .orderBy(desc(schema.jobs.createdAt))
      .all();
    return rows.map(r => this.rowToRecord(r));
  }

  getByAgent(agentId: string): JobRecord[] {
    const rows = db.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.agentId, agentId))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(50)
      .all();
    return rows.map(r => this.rowToRecord(r));
  }

  getByStatus(status: JobStatus): JobRecord[] {
    const rows = db.select()
      .from(schema.jobs)
      .where(eq(schema.jobs.status, status))
      .orderBy(desc(schema.jobs.createdAt))
      .all();
    return rows.map(r => this.rowToRecord(r));
  }

  // Get all active jobs from cache (fast)
  getActive(): JobRecord[] {
    return Array.from(this.cache.values()).filter(j =>
      j.status === 'running' || j.status === 'pending'
    );
  }

  // Load active jobs into cache on startup
  loadActiveIntoCache(): void {
    const activeStatuses = ['pending', 'running', 'blocked'];
    for (const status of activeStatuses) {
      const rows = db.select()
        .from(schema.jobs)
        .where(eq(schema.jobs.status, status))
        .all();
      for (const row of rows) {
        this.cache.set(row.id, this.rowToRecord(row));
      }
    }
    logger.info({ cachedJobs: this.cache.size }, 'Loaded active jobs into cache');
  }
}

// ============================================================================
// JOB DISPATCHER SERVICE
// ============================================================================

export interface JobDispatcherConfig {
  /** Default timeout for jobs (ms) */
  defaultTimeoutMs: number;
  /** Max concurrent jobs per agent */
  maxConcurrentPerAgent: number;
  /** Enable auto-proposal for missing resources */
  autoProposeMissingResources: boolean;
  /** Retry count for transient failures */
  retryCount: number;
  /** Retry delay (ms) */
  retryDelayMs: number;
}

const DEFAULT_CONFIG: JobDispatcherConfig = {
  defaultTimeoutMs: 5 * 60 * 1000, // 5 minutes
  maxConcurrentPerAgent: 3,
  autoProposeMissingResources: true,
  retryCount: 2,
  retryDelayMs: 1000,
};

export class JobDispatcherService {
  private config: JobDispatcherConfig;
  private jobStore: JobStore;
  private activeJobs = new Map<string, AbortController>(); // jobId → abort controller

  constructor(config: Partial<JobDispatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.jobStore = new JobStore();
    // Load active jobs from DB into cache for fast access
    this.jobStore.loadActiveIntoCache();
  }

  // ==========================================================================
  // MAIN DISPATCH FLOW
  // ==========================================================================

  /**
   * Dispatch a job based on OrgAwareDecision
   *
   * Flow:
   * 1. Validate decision has assignment
   * 2. Load task and agent details
   * 3. Build JobPayload
   * 4. Send to OpenClaw
   * 5. Process response
   */
  async dispatch(
    decision: OrgAwareDecision,
    task: TaskDTO,
    options: DispatchOptions = {}
  ): Promise<DispatchResult> {
    const jobId = generateId('job');

    // Validate assignment
    if (!decision.assignment) {
      logger.warn({ taskId: task.id }, 'No assignment in decision, cannot dispatch');
      return {
        jobId,
        dispatched: false,
        error: {
          code: 'invalid_input',
          message: 'Decision has no agent assignment',
          retryable: false,
        },
      };
    }

    const agentId = decision.assignment.agentId;

    // Check concurrent job limit
    const agentActiveJobs = this.jobStore.getByAgent(agentId)
      .filter(j => j.status === 'running' || j.status === 'pending');

    if (agentActiveJobs.length >= this.config.maxConcurrentPerAgent) {
      logger.warn({ agentId, activeCount: agentActiveJobs.length }, 'Agent at max concurrent jobs');
      return {
        jobId,
        dispatched: false,
        error: {
          code: 'rate_limited',
          message: `Agent has ${agentActiveJobs.length} active jobs (max: ${this.config.maxConcurrentPerAgent})`,
          retryable: true,
          suggestedAction: 'retry',
        },
      };
    }

    try {
      // Load agent details
      const { agentService } = getServices();
      const agent = await agentService.getById(agentId);

      // Build payload
      const payload = await this.buildPayload(jobId, task, agent, decision, options);

      // Store job
      this.jobStore.create(payload);

      // STRUCTURED LOG: JOB_CREATED
      logger.info({
        jobId,
        taskId: task.id,
        agentId,
        goal: payload.goal.slice(0, 100),
        event: 'JOB_CREATED',
      }, 'Job created');

      // Dispatch to OpenClaw
      return await this.executeJob(payload, options);
    } catch (err) {
      const error: JobError = {
        code: 'execution_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      };

      logger.error({ err, jobId, taskId: task.id }, 'Job dispatch failed');

      return {
        jobId,
        dispatched: false,
        error,
      };
    }
  }

  /**
   * Execute a prepared job payload
   * BLOQUE 10: Adds execution traceability and runtime_ready checks
   * HOOKS MIGRATION: Uses executeViaHooks as PRIMARY, executeAgent as FALLBACK
   */
  private async executeJob(
    payload: JobPayload,
    options: DispatchOptions
  ): Promise<DispatchResult> {
    const adapter = getOpenClawAdapter();
    const { jobId } = payload;
    const agentId = payload.agent.agentId;

    // BLOQUE 10: Initialize execution traceability
    const traceBuilder = createExecutionTraceability(agentId);

    // Get gateway status
    const gatewayConfigured = adapter.isConfigured();
    const gatewayConnected = adapter.isConnected();
    const hooksConfigured = adapter.isHooksConfigured();
    const wsConnected = false; // WebSocket RPC not yet implemented

    traceBuilder.gatewayStatus(gatewayConfigured, gatewayConnected, wsConnected);

    // HOOKS MIGRATION: Detect execution mode with hooks support
    const modeInfo = detectExecutionMode(gatewayConfigured, gatewayConnected, wsConnected, hooksConfigured);
    traceBuilder.mode(modeInfo.mode, modeInfo.transport);

    // BLOQUE 10: Check runtime_ready before execution
    // Pass execution mode to properly evaluate hooks_session requirements
    const runtimeCheck = checkRuntimeReady(
      payload.agent.name,
      undefined, // sessionId not known yet
      gatewayConfigured,
      gatewayConnected,
      modeInfo.mode
    );
    traceBuilder.runtimeReady(runtimeCheck.ready, runtimeCheck.materialization_status);

    // Log execution attempt - let executeViaHooks handle the full fallback chain:
    // 1. hooks_session (if OPENCLAW_HOOKS_TOKEN configured)
    // 2. chat_completion (if OPENCLAW_API_KEY configured)
    // 3. Returns stub mode if nothing available (we then use executeStubJob)
    logger.info({
      jobId,
      taskId: payload.taskId,
      gatewayConfigured,
      hooksConfigured,
    }, 'Attempting execution via OpenClaw fallback chain');

    // BLOQUE 10: Check runtime_ready
    if (!runtimeCheck.ready) {
      logger.warn({
        jobId,
        agentId,
        reason: runtimeCheck.reason,
        lifecycleState: runtimeCheck.lifecycle_state,
      }, 'Agent not runtime_ready - will use available fallback');

      traceBuilder.fallbackUsed(runtimeCheck.reason || 'Agent not runtime_ready');
    }

    // Setup abort controller
    const abortController = new AbortController();
    this.activeJobs.set(jobId, abortController);

    // BUDGET CHECK: Validate before execution
    const budgetManager = getGlobalBudgetManager();
    const budgetCheck = budgetManager.checkBudget({
      task_id: payload.taskId,
      agent_id: agentId,
      tier: 'medium', // Execution typically uses medium tier
      operation: 'execution',
    });

    // Handle budget block
    if (budgetCheck.decision === 'block') {
      logger.warn({
        jobId,
        taskId: payload.taskId,
        agentId,
        budget_decision: 'block',
        reason: budgetCheck.reason,
        current_cost: budgetCheck.current_cost_usd,
        limit: budgetCheck.limit_usd,
      }, 'BUDGET BLOCK: Job execution blocked due to budget limit');

      const error: JobError = {
        code: 'execution_failed',
        message: `Budget exceeded: ${budgetCheck.reason}`,
        retryable: false,
        suggestedAction: 'abort',
      };

      const response: JobResponse = {
        jobId,
        status: 'failed',
        error,
        completedAt: nowTimestamp(),
      };

      this.jobStore.setResponse(jobId, response);
      this.activeJobs.delete(jobId);

      return {
        jobId,
        dispatched: false,
        error,
      };
    }

    if (budgetCheck.decision === 'warn') {
      logger.warn({
        jobId,
        agentId,
        budget_decision: 'warn',
        reason: budgetCheck.reason,
        usage_pct: budgetCheck.usage_pct,
      }, 'BUDGET WARNING: Approaching budget limit for execution');
    }

    // Determine timeout - use config or default
    const timeoutMs = config.execution.jobTimeoutMs || this.config.defaultTimeoutMs;
    const executionStartTime = Date.now();

    try {
      // Update status to running
      this.jobStore.setStatus(jobId, 'running');
      this.jobStore.addEvent(jobId, { type: 'START', sessionId: '' });

      // STRUCTURED LOG: EXECUTION_STARTED
      logger.info({
        jobId,
        taskId: payload.taskId,
        agentId,
        timeoutMs,
        event: 'EXECUTION_STARTED',
      }, 'Job execution started');

      // TASK STATE: Track job start as a step
      const taskStateManager = getTaskStateManager();
      const stepId = `job-${jobId}`;
      await taskStateManager.addSteps(payload.taskId, [{
        id: stepId,
        name: `Job: ${payload.goal.slice(0, 50)}`,
        description: payload.description,
        status: 'pending',
        order: 1,
      }]);
      await taskStateManager.startStep(payload.taskId, stepId, jobId);

      // Build prompt from payload
      const prompt = this.buildPrompt(payload);

      // HOOKS MIGRATION: Use executeViaHooks as PRIMARY execution method
      // Fallback chain: hooks_session → chat_completion → stub mode
      // TIMEOUT: Wrap execution with timeout control
      const hooksResult = await withTimeout(
        adapter.executeViaHooks({
          agentId: payload.agent.agentId,
          taskId: payload.taskId,
          jobId: jobId,
          prompt,
          name: payload.agent.name,
          context: {
            tools: payload.allowedResources.tools,
            skills: payload.allowedResources.skills,
            maxTokens: payload.constraints.maxTokens,
            temperature: payload.agent.temperature,
          },
        }),
        timeoutMs,
        abortController
      );

      // If executeViaHooks returned stub mode with failure, use our executeStubJob
      // which produces a proper completed result with state/timeline/cost
      if (hooksResult.executionMode === 'stub' && !hooksResult.success) {
        logger.info({
          jobId,
          taskId: payload.taskId,
          reason: hooksResult.fallbackReason,
        }, 'OpenClaw unavailable, falling back to stub execution');

        // Clean up the step we started before falling back
        await taskStateManager.failStep(payload.taskId, stepId, 'Falling back to stub');
        this.activeJobs.delete(jobId);

        return this.executeStubJob(payload, traceBuilder);
      }

      // HOOKS MIGRATION: Update traceability based on execution result
      traceBuilder.mode(
        hooksResult.executionMode === 'hooks_session' ? 'hooks_session' :
        hooksResult.executionMode === 'chat_completion' ? 'chat_completion' : 'stub',
        hooksResult.executionMode === 'hooks_session' ? 'hooks_agent' : 'rest_api'
      );

      if (hooksResult.sessionKey) {
        traceBuilder.sessionKey(hooksResult.sessionKey);
      }

      if (hooksResult.fallbackUsed) {
        traceBuilder.fallbackUsed(hooksResult.fallbackReason || 'Unknown fallback reason');
      }

      // BLOQUE 10: Mark transport success
      traceBuilder.transportSuccess(hooksResult.success);

      // HOOKS MIGRATION: Mark accepted_async for hooks_session without immediate response
      if (hooksResult.success && hooksResult.accepted && !hooksResult.response && hooksResult.executionMode === 'hooks_session') {
        traceBuilder.acceptedAsync();
      }

      // BLOQUE 10: Track response
      if (hooksResult.response) {
        traceBuilder.responseReceived();
      }

      // =========================================================================
      // ASYNC TIMEOUT HANDLER: Fallback for accepted_async without response
      // =========================================================================
      // PROMPT 5: Track final execution state separately from initial hooks dispatch
      // This ensures we don't contaminate final result with initial accepted_async state
      let finalResponse = hooksResult.response;
      let finalSuccess = hooksResult.success;
      let finalAccepted = hooksResult.accepted;
      let finalExecutionMode = hooksResult.executionMode;
      let finalError = hooksResult.error;
      let usedAsyncFallback = false;

      // If accepted_async (hooks_session accepted but no immediate response),
      // wait briefly then fallback to chat_completion
      if (hooksResult.success && hooksResult.accepted && !hooksResult.response && hooksResult.executionMode === 'hooks_session') {
        logger.info({
          jobId,
          taskId: payload.taskId,
          timeoutMs: HOOKS_ASYNC_TIMEOUT_MS,
        }, 'accepted_async: waiting for async timeout before fallback');

        // Wait the timeout period (non-blocking via setTimeout wrapped in Promise)
        await new Promise(resolve => setTimeout(resolve, HOOKS_ASYNC_TIMEOUT_MS));

        // Check if job was already completed/cancelled during wait
        const currentJob = this.jobStore.get(jobId);
        if (currentJob && currentJob.status === 'running') {
          // Still running, no response received - trigger fallback
          logger.info({
            jobId,
            taskId: payload.taskId,
            event: 'ASYNC_TIMEOUT_FALLBACK',
          }, 'accepted_async timeout: triggering chat_completion fallback');

          traceBuilder.asyncTimeout(HOOKS_ASYNC_TIMEOUT_MS);

          // Execute fallback via chat_completion DIRECTLY (no hooks reentry)
          const sessionKey = hooksResult.sessionKey || `hook:ocaas:job-${jobId}`;
          const fallbackResult = await withTimeout(
            adapter.executeChatCompletionDirect(
              {
                agentId: payload.agent.agentId,
                taskId: payload.taskId,
                jobId: jobId,
                prompt,
                name: payload.agent.name,
                context: {
                  tools: payload.allowedResources.tools,
                  skills: payload.allowedResources.skills,
                  maxTokens: payload.constraints.maxTokens,
                  temperature: payload.agent.temperature,
                },
              },
              sessionKey,
              'async_timeout_fallback'
            ),
            timeoutMs,
            abortController
          );

          if (fallbackResult.success && fallbackResult.response) {
            // CASE B: accepted_async + fallback success
            // Final result = fallback result (NOT initial hooks result)
            finalResponse = fallbackResult.response;
            finalSuccess = true;
            finalAccepted = false; // Fallback resolved, not async-accepted
            finalExecutionMode = 'chat_completion';
            finalError = undefined;
            usedAsyncFallback = true;
            traceBuilder.fallbackUsed('async_timeout_fallback_to_chat_completion');
            traceBuilder.responseReceived();
            traceBuilder.mode('chat_completion', 'rest_api');

            logger.info({
              jobId,
              taskId: payload.taskId,
              event: 'ASYNC_FALLBACK_SUCCESS',
              outcome: 'completed',
            }, 'accepted_async fallback succeeded');
          } else if (fallbackResult.executionMode === 'stub') {
            // CASE D: accepted_async + no fallback available
            // PROMPT 8B: NO fallback_used - stub means fallback was NOT available
            finalResponse = undefined;
            finalSuccess = false;
            finalAccepted = false;
            finalExecutionMode = 'stub';
            finalError = { code: 'timeout' as const, message: 'Async timeout with no fallback available' };
            // PROMPT 8: Update mode to match finalExecutionMode
            traceBuilder.mode('stub', 'none');
            traceBuilder.gap('Async timeout: no fallback available (stub mode)');

            logger.warn({
              jobId,
              taskId: payload.taskId,
              event: 'ASYNC_FALLBACK_FAILED',
              outcome: 'failed',
              reason: 'async_timeout_no_response',
            }, 'accepted_async timeout: no fallback available');
          } else {
            // CASE C: accepted_async + fallback failed
            finalResponse = undefined;
            finalSuccess = false;
            finalAccepted = false;
            finalExecutionMode = 'chat_completion'; // Fallback was attempted
            finalError = fallbackResult.error || { code: 'execution_error' as const, message: 'Fallback failed after async timeout' };
            traceBuilder.fallbackUsed('fallback_failed_after_async_timeout');
            // PROMPT 8: Update mode to match finalExecutionMode
            traceBuilder.mode('chat_completion', 'rest_api');
            traceBuilder.gap('Async timeout: fallback_failed_after_async_timeout');

            logger.warn({
              jobId,
              taskId: payload.taskId,
              event: 'ASYNC_FALLBACK_FAILED',
              outcome: 'failed',
              reason: 'fallback_failed_after_async_timeout',
            }, 'accepted_async timeout: fallback failed');
          }
        } else {
          logger.info({
            jobId,
            taskId: payload.taskId,
            currentStatus: currentJob?.status,
          }, 'accepted_async: job already resolved during wait');
        }
      }

      // =========================================================================
      // TOOL-CALLING LOOP (Max 1 tool call per task)
      // =========================================================================
      let toolExecutionResult: ToolExecutionResult | null = null;

      if (finalResponse) {
        const detectedTool = detectToolCall(finalResponse);

        if (detectedTool) {
          logger.info({
            jobId,
            taskId: payload.taskId,
            toolName: detectedTool.toolName,
            input: detectedTool.input,
            event: 'TOOL_CALL_DETECTED',
          }, `[ToolLoop] Detected tool call: ${detectedTool.toolName}`);

          // Execute the tool
          const toolService = getToolExecutionService();
          toolExecutionResult = await toolService.execute({
            toolName: detectedTool.toolName,
            input: detectedTool.input,
            taskId: payload.taskId,
            agentId,
            jobId,
          });

          logger.info({
            jobId,
            taskId: payload.taskId,
            toolName: detectedTool.toolName,
            success: toolExecutionResult.success,
            durationMs: toolExecutionResult.durationMs,
            event: 'TOOL_CALL_EXECUTED',
          }, `[ToolLoop] Tool executed: ${toolExecutionResult.success ? 'success' : 'failed'}`);

          // Build follow-up prompt with tool result
          const toolResultContext = this.buildToolResultContext(detectedTool, toolExecutionResult);

          // Make follow-up IA call to interpret the result
          const followUpPrompt = `${prompt}\n\n${toolResultContext}`;

          logger.info({
            jobId,
            taskId: payload.taskId,
            event: 'TOOL_LOOP_FOLLOWUP',
          }, '[ToolLoop] Making follow-up IA call with tool result');

          const followUpResult = await withTimeout(
            adapter.executeViaHooks({
              agentId: payload.agent.agentId,
              taskId: payload.taskId,
              jobId: jobId,
              prompt: followUpPrompt,
              name: payload.agent.name,
              context: {
                tools: payload.allowedResources.tools,
                skills: payload.allowedResources.skills,
                maxTokens: payload.constraints.maxTokens,
                temperature: payload.agent.temperature,
              },
            }),
            timeoutMs,
            abortController
          );

          if (followUpResult.success && followUpResult.response) {
            // Use the follow-up response as final
            finalResponse = followUpResult.response;

            // Record additional cost for follow-up call
            const followUpInputTokens = Math.ceil(followUpPrompt.length / 4);
            const followUpOutputTokens = Math.ceil(followUpResult.response.length / 4);
            budgetManager.recordCost({
              task_id: payload.taskId,
              agent_id: agentId,
              operation: 'execution',
              tier: 'medium',
              input_tokens: followUpInputTokens,
              output_tokens: followUpOutputTokens,
              estimated_cost_usd: budgetCheck.estimated_cost_usd * 0.5, // Estimate half cost for follow-up
              budget_decision: budgetCheck.decision,
            });

            logger.info({
              jobId,
              taskId: payload.taskId,
              event: 'TOOL_LOOP_COMPLETED',
            }, '[ToolLoop] Follow-up IA call completed');
          } else {
            // Follow-up failed, include tool output directly in response
            const originalResponse = finalResponse || '';
            finalResponse = `${originalResponse}\n\n[Tool Execution Result]\n${toolResultContext}`;
            logger.warn({
              jobId,
              taskId: payload.taskId,
              event: 'TOOL_LOOP_FOLLOWUP_FAILED',
            }, '[ToolLoop] Follow-up IA call failed, using tool output directly');
          }
        }
      }

      // Build final traceability
      const trace = traceBuilder.completed().build();

      // Process result (adapt to expected format)
      // PROMPT 5: Use final execution state, not initial hooksResult
      // This ensures accepted_async + fallback produces correct final result
      const adaptedResult = {
        success: finalSuccess,
        sessionId: hooksResult.sessionKey, // Session key from initial dispatch
        response: finalResponse, // Final response (may include tool loop result)
        error: finalError,
        // Final state (NOT initial accepted_async state)
        accepted: finalAccepted,
        executionMode: finalExecutionMode,
      };

      const response = this.processExecutionResult(jobId, adaptedResult, payload);

      // Attach tool execution info to response if tool was used
      if (toolExecutionResult) {
        if (response.result) {
          response.result.toolsUsed = [toolExecutionResult.toolName];
          response.result.data = {
            ...response.result.data,
            toolExecution: {
              executionId: toolExecutionResult.executionId,
              toolName: toolExecutionResult.toolName,
              success: toolExecutionResult.success,
              output: toolExecutionResult.output,
              durationMs: toolExecutionResult.durationMs,
            },
          };
        }
      }

      // BUDGET: Record execution cost (estimate since hooks don't return tokens)
      // PROMPT 5: Use finalResponse for token estimation, not initial hooksResult.response
      const estimatedInputTokens = Math.ceil(prompt.length / 4); // ~4 chars per token
      const estimatedOutputTokens = finalResponse ? Math.ceil(finalResponse.length / 4) : 250;
      budgetManager.recordCost({
        task_id: payload.taskId,
        agent_id: agentId,
        operation: 'execution',
        tier: 'medium',
        input_tokens: estimatedInputTokens,
        output_tokens: estimatedOutputTokens,
        estimated_cost_usd: budgetCheck.estimated_cost_usd,
        budget_decision: budgetCheck.decision,
      });

      // BLOQUE 10: Attach traceability to response
      response.traceability = trace;

      // P0-02: Save generation trace for full traceability
      // PROMPT 5: Use final execution state for trace, preserve initial dispatch info
      const durationMs = Date.now() - executionStartTime;
      const generationTraceService = getGenerationTraceService();
      generationTraceService.save({
        taskId: payload.taskId,
        jobId,
        executionMode: trace.execution_mode, // Final execution mode from trace
        aiRequested: true, // We always request AI in executeJob
        aiAttempted: finalExecutionMode !== 'stub',
        aiSucceeded: finalSuccess && !!finalResponse,
        fallbackUsed: trace.execution_fallback_used,
        fallbackReason: trace.execution_fallback_reason,
        rawOutput: usedAsyncFallback ? undefined : hooksResult.response, // Only if hooks gave immediate response
        finalOutput: finalResponse, // May include tool loop result
        tokenUsage: {
          input: estimatedInputTokens,
          output: estimatedOutputTokens,
        },
        model: finalExecutionMode === 'chat_completion' ? 'gpt-4' : undefined,
        durationMs,
        error: finalError?.message,
      });

      this.jobStore.setResponse(jobId, response);

      // TASK STATE: Track job outcome
      if (response.status === 'completed') {
        await taskStateManager.completeStep(payload.taskId, stepId, response.result as Record<string, unknown> | undefined);
      } else if (response.status === 'accepted') {
        // Async accepted - step still running, set session key
        if (hooksResult.sessionKey) {
          await taskStateManager.setSessionKey(payload.taskId, hooksResult.sessionKey);
        }
      } else if (response.status === 'failed') {
        await taskStateManager.failStep(payload.taskId, stepId, response.error?.message || 'Unknown error');
      } else if (response.status === 'blocked') {
        await taskStateManager.block(payload.taskId, response.blocked?.description || 'Blocked');
      }

      // STRUCTURED LOG: EXECUTION_COMPLETED
      logger.info({
        jobId,
        taskId: payload.taskId,
        agentId,
        execution_mode: trace.execution_mode,
        outcome: response.status,
        durationMs,
        event: 'EXECUTION_COMPLETED',
      }, `Job ${response.status} in ${durationMs}ms`);

      // Handle blocking
      if (response.status === 'blocked' && response.blocked) {
        await this.handleBlocking(jobId, response.blocked, payload);
      }

      return {
        jobId,
        dispatched: true,
        sessionId: hooksResult.sessionKey,
        response,
      };
    } catch (err) {
      const durationMs = Date.now() - executionStartTime;
      const isTimeout = err instanceof JobTimeoutError;

      // BLOQUE 10: Mark transport failure
      traceBuilder.transportSuccess(false);
      const trace = traceBuilder.completed().build();

      const error: JobError = {
        code: isTimeout ? 'timeout' : 'execution_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: isTimeout ? false : this.isRetryableError(err),
      };

      const response: JobResponse = {
        jobId,
        status: isTimeout ? 'timeout' as JobStatus : 'failed',
        error,
        traceability: trace,
        completedAt: nowTimestamp(),
      };

      this.jobStore.setResponse(jobId, response);
      this.jobStore.addEvent(jobId, { type: isTimeout ? 'TIMEOUT' : 'FAIL', error });

      // P0-02: Save generation trace for failed/timeout execution
      const generationTraceService = getGenerationTraceService();
      generationTraceService.save({
        taskId: payload.taskId,
        jobId,
        executionMode: trace.execution_mode,
        aiRequested: true,
        aiAttempted: trace.execution_mode !== 'stub',
        aiSucceeded: false,
        fallbackUsed: trace.execution_fallback_used,
        fallbackReason: trace.execution_fallback_reason,
        rawOutput: undefined,
        finalOutput: undefined,
        durationMs,
        error: error.message,
      });

      // TASK STATE: Update state on failure/timeout
      const taskStateManager = getTaskStateManager();
      const stepId = `job-${jobId}`;
      await taskStateManager.failStep(
        payload.taskId,
        stepId,
        isTimeout ? `Execution timed out after ${timeoutMs}ms` : error.message
      );

      // STRUCTURED LOG: EXECUTION_FAILED or EXECUTION_TIMEOUT
      const event = isTimeout ? 'EXECUTION_TIMEOUT' : 'EXECUTION_FAILED';
      logger.error({
        jobId,
        taskId: payload.taskId,
        agentId,
        execution_mode: trace.execution_mode,
        durationMs,
        timeoutMs: isTimeout ? timeoutMs : undefined,
        errorCode: error.code,
        errorMessage: error.message,
        event,
      }, `Job ${isTimeout ? 'timed out' : 'failed'} after ${durationMs}ms: ${error.message}`);

      return {
        jobId,
        dispatched: true,
        response,
        error,
      };
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  // ==========================================================================
  // PAYLOAD BUILDING
  // ==========================================================================

  /**
   * Build JobPayload from task, agent, and decision
   */
  private async buildPayload(
    jobId: string,
    task: TaskDTO,
    agent: AgentDTO,
    decision: OrgAwareDecision,
    options: DispatchOptions
  ): Promise<JobPayload> {
    const hierarchyStore = getAgentHierarchyStore();
    const orgProfile = hierarchyStore.get(agent.id);

    // Build agent context (systemPrompt, model, temperature are in config)
    const agentConfig = agent.config || {};
    const agentContext: JobAgentContext = {
      agentId: agent.id,
      name: agent.name,
      type: agent.type as 'general' | 'specialist' | 'orchestrator',
      role: orgProfile?.roleType || 'worker',
      capabilities: agent.capabilities || [],
      systemPrompt: (agentConfig.systemPrompt as string) || this.buildDefaultSystemPrompt(agent),
      model: agentConfig.model as string | undefined,
      temperature: agentConfig.temperature as number | undefined,
    };

    // Build allowed resources
    const { toolService, skillService } = getServices();
    const agentTools = await toolService.getAgentTools(agent.id);
    const agentSkills = await skillService.getAgentSkills(agent.id);

    const allowedResources: JobAllowedResources = {
      tools: agentTools.map((t: { id: string }) => t.id),
      skills: agentSkills.map((s: { id: string }) => s.id),
      webSearch: agent.capabilities?.includes('web_search') || false,
      codeExecution: agent.capabilities?.includes('code_execution') || false,
      fileAccess: agent.capabilities?.includes('file_access') || false,
      apiAccess: agent.capabilities?.includes('api_access') || true,
    };

    // Build constraints from org profile
    const autonomyPolicy: AutonomyPolicy | null = orgProfile
      ? hierarchyStore.getEffectiveAutonomyPolicy(agent.id)
      : null;

    const constraints: JobConstraints = {
      autonomyLevel: this.mapAutonomyLevel(task.priority, autonomyPolicy),
      maxTokens: 4096,
      maxToolCalls: 20, // Default, could be configurable
      maxRetries: this.config.retryCount,
      requireConfirmation: task.priority >= 4 || !autonomyPolicy?.canCreateResources,
      priority: task.priority,
      canCreateResources: autonomyPolicy?.canCreateResources || false,
      canDelegate: autonomyPolicy?.canDelegate || false,
    };

    // Build context
    const jobContext: JobContext = {};

    // Add previous results if this is a continuation
    const previousJobs = this.jobStore.getByTask(task.id)
      .filter(j => j.status === 'completed' && j.response?.result);

    if (previousJobs.length > 0) {
      jobContext.previousResults = previousJobs.map(j => ({
        jobId: j.id,
        summary: j.response!.result!.actionsSummary || j.response!.result!.output.slice(0, 200),
        output: j.response!.result!.data,
      }));
    }

    // Add task context
    if (task.parentTaskId) {
      const { taskService } = getServices();
      const parentTask = await taskService.getById(task.parentTaskId);
      if (parentTask) {
        jobContext.taskContext = {
          title: parentTask.title,
          description: parentTask.description,
        };
      }
    }

    // Add user context from task input
    if (task.input && typeof task.input === 'object' && 'userContext' in task.input) {
      jobContext.userContext = String(task.input.userContext);
    }

    return {
      jobId,
      taskId: task.id,
      subtaskId: task.parentTaskId ? task.id : undefined,
      parentJobId: previousJobs.length > 0 ? previousJobs[previousJobs.length - 1]!.id : undefined,
      goal: task.title,
      description: task.description,
      input: task.input as Record<string, unknown>,
      agent: agentContext,
      allowedResources,
      constraints,
      context: Object.keys(jobContext).length > 0 ? jobContext : undefined,
      createdAt: nowTimestamp(),
      timeoutMs: options.waitTimeoutMs || this.config.defaultTimeoutMs,
    };
  }

  /**
   * Build prompt from JobPayload
   */
  private buildPrompt(payload: JobPayload): string {
    const parts: string[] = [];

    // Goal
    parts.push(`## Goal\n${payload.goal}`);

    // Description
    if (payload.description) {
      parts.push(`## Description\n${payload.description}`);
    }

    // Input data
    if (payload.input && Object.keys(payload.input).length > 0) {
      parts.push(`## Input Data\n\`\`\`json\n${JSON.stringify(payload.input, null, 2)}\n\`\`\``);
    }

    // Previous results
    if (payload.context?.previousResults && payload.context.previousResults.length > 0) {
      parts.push('## Previous Work');
      for (const prev of payload.context.previousResults) {
        parts.push(`- Job ${prev.jobId}: ${prev.summary}`);
      }
    }

    // Task context
    if (payload.context?.taskContext) {
      parts.push(`## Parent Task\n${payload.context.taskContext.title}`);
      if (payload.context.taskContext.description) {
        parts.push(payload.context.taskContext.description);
      }
    }

    // User context
    if (payload.context?.userContext) {
      parts.push(`## User Context\n${payload.context.userContext}`);
    }

    // Constraints reminder
    parts.push(`## Constraints`);
    parts.push(`- Autonomy: ${payload.constraints.autonomyLevel}`);
    parts.push(`- Max tool calls: ${payload.constraints.maxToolCalls}`);
    if (payload.constraints.requireConfirmation) {
      parts.push('- IMPORTANT: Destructive operations require confirmation');
    }

    return parts.join('\n\n');
  }

  /**
   * Build default system prompt for agent
   */
  private buildDefaultSystemPrompt(agent: AgentDTO): string {
    return `You are ${agent.name}, an AI agent with the following capabilities: ${(agent.capabilities || []).join(', ')}.

Your role is to complete tasks efficiently and accurately. Follow these guidelines:
1. Analyze the task thoroughly before starting
2. Use available tools appropriately
3. Report any blockers or missing resources
4. Provide clear summaries of completed work`;
  }

  // ==========================================================================
  // RESPONSE PROCESSING
  // ==========================================================================

  /**
   * Process OpenClaw execution result into JobResponse
   *
   * HOOKS MIGRATION: Now handles three outcomes:
   * 1. completed_sync: success=true, response present (chat_completion mode)
   * 2. accepted_async: success=true, accepted=true, no response (hooks_session mode)
   * 3. failed: success=false
   */
  private processExecutionResult(
    jobId: string,
    result: {
      success: boolean;
      sessionId?: string;
      response?: string;
      error?: { code: string; message: string };
      // HOOKS MIGRATION: New fields for async handling
      accepted?: boolean;
      executionMode?: 'hooks_session' | 'chat_completion' | 'stub';
    },
    payload: JobPayload
  ): JobResponse {
    // CASE 1: Success with response (completed_sync)
    if (result.success && result.response) {
      // Parse response for blocking indicators
      const blocking = this.detectBlocking(result.response, payload);

      if (blocking) {
        return {
          jobId,
          status: 'blocked',
          sessionId: result.sessionId,
          blocked: blocking,
          completedAt: nowTimestamp(),
        };
      }

      // Success - completed synchronously
      const jobResult: JobResult = {
        output: result.response,
        actionsSummary: this.extractSummary(result.response),
        toolsUsed: this.extractToolsUsed(result.response),
      };

      return {
        jobId,
        status: 'completed',
        sessionId: result.sessionId,
        result: jobResult,
        completedAt: nowTimestamp(),
      };
    }

    // CASE 2: Accepted async (hooks_session mode) - NOT a failure
    // hooks_session returns success=true but no immediate response
    // The response will come via channel (telegram, etc.)
    if (result.success && result.accepted && result.executionMode === 'hooks_session') {
      return {
        jobId,
        status: 'accepted', // NEW: Job accepted, awaiting async result
        sessionId: result.sessionId,
        result: {
          output: '[ASYNC] Job accepted by hooks_session. Response will be delivered via channel.',
          actionsSummary: 'Job dispatched to hooks_session, awaiting async delivery',
        },
        completedAt: nowTimestamp(),
      };
    }

    // CASE 3: Failure
    const error: JobError = {
      code: this.mapErrorCode(result.error?.code),
      message: result.error?.message || 'Execution failed',
      retryable: this.isRetryableErrorCode(result.error?.code),
    };

    return {
      jobId,
      status: 'failed',
      sessionId: result.sessionId,
      error,
      completedAt: nowTimestamp(),
    };
  }

  /**
   * Detect blocking from response content
   */
  private detectBlocking(response: string, payload: JobPayload): JobBlocked | null {
    const lowerResponse = response.toLowerCase();

    // Common blocking patterns
    const blockingPatterns = [
      { pattern: /cannot.*?(?:find|access|use).*?tool[:\s]+(\w+)/i, type: 'missing_tool' as const },
      { pattern: /missing.*?tool[:\s]+(\w+)/i, type: 'missing_tool' as const },
      { pattern: /need.*?(?:skill|capability)[:\s]+(\w+)/i, type: 'missing_skill' as const },
      { pattern: /missing.*?(?:skill|capability)[:\s]+(\w+)/i, type: 'missing_skill' as const },
      { pattern: /(?:need|require).*?permission.*?to\s+(\w+)/i, type: 'missing_permission' as const },
      { pattern: /(?:need|require).*?(?:data|information|input)[:\s]+(\w+)/i, type: 'missing_data' as const },
      { pattern: /waiting.*?(?:for|on)\s+(?:approval|confirmation)/i, type: 'awaiting_approval' as const },
    ];

    const missing: MissingResource[] = [];
    const suggestions: BlockingSuggestion[] = [];

    for (const { pattern, type } of blockingPatterns) {
      const match = response.match(pattern);
      if (match) {
        const identifier = match[1] || 'unknown';

        missing.push({
          type: type.replace('missing_', '') as 'tool' | 'skill' | 'capability' | 'permission' | 'data',
          identifier,
          reason: `Detected in response: "${match[0]}"`,
          required: true,
        });

        // Generate suggestion
        if (type === 'missing_tool') {
          suggestions.push({
            type: 'create_tool',
            target: identifier,
            description: `Create tool "${identifier}" for agent to use`,
            canAutoGenerate: true,
            priority: 'required',
            generationPrompt: `Generate a tool definition for: ${identifier}`,
          });
        } else if (type === 'missing_skill') {
          suggestions.push({
            type: 'create_skill',
            target: identifier,
            description: `Create skill "${identifier}" for agent to use`,
            canAutoGenerate: true,
            priority: 'required',
            generationPrompt: `Generate a skill definition for: ${identifier}`,
          });
        }
      }
    }

    if (missing.length === 0) {
      return null;
    }

    return {
      reason: missing[0]!.type === 'tool' ? 'missing_tool' : 'missing_skill',
      description: `Agent blocked: ${missing.map(m => `${m.type} "${m.identifier}"`).join(', ')}`,
      missing,
      suggestions,
      canAutoResolve: suggestions.some(s => s.canAutoGenerate),
      requiresHuman: suggestions.some(s => s.priority === 'required' && !s.canAutoGenerate),
    };
  }

  /**
   * Handle blocking by creating proposals
   */
  private async handleBlocking(
    jobId: string,
    blocked: JobBlocked,
    payload: JobPayload
  ): Promise<void> {
    if (!this.config.autoProposeMissingResources) {
      return;
    }

    logger.info({
      jobId,
      reason: blocked.reason,
      missing: blocked.missing.map(m => m.identifier),
    }, 'Job blocked, creating proposals');

    // TODO: Integrate with proposal system when available
    // For now, just log the suggestions
    for (const suggestion of blocked.suggestions) {
      if (suggestion.canAutoGenerate) {
        logger.info({
          jobId,
          type: suggestion.type,
          target: suggestion.target,
          prompt: suggestion.generationPrompt,
        }, 'Auto-generate suggestion available');
      }
    }
  }

  // ==========================================================================
  // JOB CONTROL
  // ==========================================================================

  /**
   * Abort a running job
   */
  async abort(jobId: string): Promise<boolean> {
    const record = this.jobStore.get(jobId);
    if (!record || record.status !== 'running') {
      return false;
    }

    // Signal abort to active execution
    const controller = this.activeJobs.get(jobId);
    if (controller) {
      controller.abort();
    }

    // Abort OpenClaw session
    if (record.sessionId) {
      const adapter = getOpenClawAdapter();
      await adapter.abortSession(record.sessionId);
    }

    this.jobStore.setStatus(jobId, 'cancelled');
    this.jobStore.addEvent(jobId, { type: 'CANCEL' });

    logger.info({ jobId }, 'Job aborted');
    return true;
  }

  /**
   * Retry a failed job
   */
  async retry(jobId: string): Promise<DispatchResult | null> {
    const record = this.jobStore.get(jobId);
    if (!record || record.status === 'running') {
      return null;
    }

    // Create new job with same payload
    const newJobId = generateId('job');
    const newPayload: JobPayload = {
      ...record.payload,
      jobId: newJobId,
      parentJobId: jobId,
      createdAt: nowTimestamp(),
    };

    this.jobStore.create(newPayload);
    return this.executeJob(newPayload, {});
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  getJob(jobId: string): JobRecord | null {
    return this.jobStore.get(jobId);
  }

  getJobsByTask(taskId: string): JobRecord[] {
    return this.jobStore.getByTask(taskId);
  }

  getJobsByAgent(agentId: string): JobRecord[] {
    return this.jobStore.getByAgent(agentId);
  }

  getActiveJobs(): JobRecord[] {
    return this.jobStore.getByStatus('running');
  }

  getPendingJobs(): JobRecord[] {
    return this.jobStore.getByStatus('pending');
  }

  getBlockedJobs(): JobRecord[] {
    return this.jobStore.getByStatus('blocked');
  }

  getAllJobs(): JobRecord[] {
    return this.jobStore.list();
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private mapAutonomyLevel(
    priority: number,
    policy: AutonomyPolicy | null
  ): 'manual' | 'supervised' | 'autonomous' {
    // Higher priority tasks need more supervision
    if (priority >= 4) return 'supervised';
    // If agent can't create resources, they need supervision for complex tasks
    if (!policy?.canCreateResources && priority >= 3) return 'supervised';
    return 'autonomous';
  }

  private mapErrorCode(code?: string): JobError['code'] {
    if (!code) return 'unknown';

    const mapping: Record<string, JobError['code']> = {
      timeout: 'timeout',
      rate_limited: 'rate_limited',
      auth_error: 'auth_error',
      invalid_input: 'invalid_input',
      tool_error: 'tool_error',
      skill_error: 'skill_error',
    };

    return mapping[code] || 'execution_failed';
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('timeout') ||
             msg.includes('rate') ||
             msg.includes('network') ||
             msg.includes('connect');
    }
    return false;
  }

  private isRetryableErrorCode(code?: string): boolean {
    return ['timeout', 'rate_limited', 'connection_error'].includes(code || '');
  }

  /**
   * Build context string with tool execution result for follow-up IA call
   */
  private buildToolResultContext(
    detectedTool: DetectedToolCall,
    result: ToolExecutionResult
  ): string {
    const parts: string[] = [];

    parts.push('## Tool Execution Result');
    parts.push(`Tool: ${detectedTool.toolName}`);
    parts.push(`Command: ${(detectedTool.input as { command?: string }).command || 'N/A'}`);
    parts.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

    if (result.output) {
      if (result.output.stdout) {
        const stdout = result.output.stdout.slice(0, 2000); // Limit output size
        parts.push(`\nOutput:\n\`\`\`\n${stdout}\n\`\`\``);
      }
      if (result.output.stderr && result.output.stderr.trim()) {
        const stderr = result.output.stderr.slice(0, 500);
        parts.push(`\nStderr:\n\`\`\`\n${stderr}\n\`\`\``);
      }
      if (result.output.exitCode !== undefined) {
        parts.push(`\nExit code: ${result.output.exitCode}`);
      }
    }

    if (result.error) {
      parts.push(`\nError: ${result.error.message}`);
    }

    parts.push('\nPlease interpret this result and provide your response.');

    return parts.join('\n');
  }

  private extractSummary(response: string): string {
    // Try to extract summary section
    const summaryMatch = response.match(/(?:summary|completed|done)[:\s]*(.{10,200})/i);
    if (summaryMatch) {
      return summaryMatch[1]!.trim();
    }

    // Fall back to first 200 chars
    return response.slice(0, 200).trim();
  }

  private extractToolsUsed(response: string): string[] {
    // Look for tool call patterns
    const toolPattern = /(?:called|used|executed|invoked)\s+(?:tool\s+)?["']?(\w+)["']?/gi;
    const tools = new Set<string>();

    let match;
    while ((match = toolPattern.exec(response)) !== null) {
      tools.add(match[1]!);
    }

    return Array.from(tools);
  }

  /**
   * Execute a stub job when OpenClaw is not configured.
   * Produces a minimal but complete execution with state, timeline, and cost.
   */
  private async executeStubJob(
    payload: JobPayload,
    traceBuilder: ReturnType<typeof createExecutionTraceability>
  ): Promise<DispatchResult> {
    const { jobId, taskId } = payload;
    const agentId = payload.agent.agentId;

    // Build trace with stub mode
    const trace = traceBuilder
      .mode('stub', 'none')
      .fallbackUsed('OpenClaw not configured - stub execution')
      .transportSuccess(true)
      .responseReceived()
      .completed()
      .build();

    // Update job status
    this.jobStore.setStatus(jobId, 'running');
    this.jobStore.addEvent(jobId, { type: 'START', sessionId: 'stub' });

    // TASK STATE: Create execution state
    const taskStateManager = getTaskStateManager();
    const stepId = `job-${jobId}`;
    await taskStateManager.addSteps(taskId, [{
      id: stepId,
      name: `Job: ${payload.goal.slice(0, 50)}`,
      description: payload.description || 'Stub execution',
      status: 'pending',
      order: 1,
    }]);
    await taskStateManager.startStep(taskId, stepId, jobId);

    // Generate stub response
    const stubOutput = `[STUB] Task "${payload.goal}" acknowledged.\n\nThis is a stub execution because OpenClaw is not configured.\n\nInput received:\n${JSON.stringify(payload.input, null, 2)}\n\nTo enable full execution, configure OPENCLAW_API_KEY environment variable.`;

    // Build successful result
    const result: JobResult = {
      output: stubOutput,
      actionsSummary: 'Stub execution completed - OpenClaw not configured',
      toolsUsed: [],
    };

    const response: JobResponse = {
      jobId,
      status: 'completed',
      sessionId: 'stub',
      result,
      traceability: trace,
      completedAt: nowTimestamp(),
    };

    // BUDGET: Record minimal cost for stub execution
    const budgetManager = getGlobalBudgetManager();
    budgetManager.recordCost({
      task_id: taskId,
      agent_id: agentId,
      operation: 'execution',
      tier: 'short',
      input_tokens: 100,  // Minimal stub tokens
      output_tokens: 50,
      estimated_cost_usd: 0.0001, // ~$0.0001 for stub
      budget_decision: 'allow',
    });

    // P0-02: Save generation trace for stub execution
    const generationTraceService = getGenerationTraceService();
    generationTraceService.save({
      taskId,
      jobId,
      executionMode: 'stub',
      aiRequested: true,
      aiAttempted: false, // Stub = no actual AI call
      aiSucceeded: false,
      fallbackUsed: true,
      fallbackReason: 'OpenClaw not configured - stub execution',
      rawOutput: undefined, // No AI output
      finalOutput: stubOutput,
      tokenUsage: { input: 100, output: 50 },
      durationMs: 0,
    });

    // Update job store
    this.jobStore.setResponse(jobId, response);
    this.jobStore.addEvent(jobId, { type: 'COMPLETE', result });

    // TASK STATE: Mark step as completed
    await taskStateManager.completeStep(taskId, stepId, { output: stubOutput });

    // STRUCTURED LOG: EXECUTION_COMPLETED (stub)
    logger.info({
      jobId,
      taskId,
      agentId,
      execution_mode: 'stub',
      outcome: 'completed',
      event: 'EXECUTION_COMPLETED',
    }, 'Stub job completed');

    return {
      jobId,
      dispatched: true,
      sessionId: 'stub',
      response,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<JobDispatcherConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'JobDispatcherService config updated');
  }
}

// Singleton
let instance: JobDispatcherService | null = null;

export function getJobDispatcherService(): JobDispatcherService {
  if (!instance) {
    instance = new JobDispatcherService();
  }
  return instance;
}

export function resetJobDispatcherService(): void {
  instance = null;
}

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

const logger = createLogger('JobDispatcherService');

/** Generate a unique ID with prefix */
function generateId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
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
      logger.info({ jobId, taskId: task.id, agentId }, 'Job created');

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
   */
  private async executeJob(
    payload: JobPayload,
    options: DispatchOptions
  ): Promise<DispatchResult> {
    const adapter = getOpenClawAdapter();
    const { jobId } = payload;

    // Check OpenClaw availability
    if (!adapter.isConfigured()) {
      this.jobStore.setStatus(jobId, 'failed');
      return {
        jobId,
        dispatched: false,
        error: {
          code: 'resource_error',
          message: 'OpenClaw not configured',
          retryable: false,
        },
      };
    }

    // Setup abort controller
    const abortController = new AbortController();
    this.activeJobs.set(jobId, abortController);

    try {
      // Update status to running
      this.jobStore.setStatus(jobId, 'running');
      this.jobStore.addEvent(jobId, { type: 'START', sessionId: '' });

      // Build prompt from payload
      const prompt = this.buildPrompt(payload);

      // Execute via OpenClaw
      const result = await adapter.executeAgent({
        agentId: payload.agent.agentId,
        taskId: payload.taskId,
        prompt,
        tools: payload.allowedResources.tools,
        skills: payload.allowedResources.skills,
        config: {
          maxTokens: payload.constraints.maxTokens,
          temperature: payload.agent.temperature,
        },
      });

      // Update session ID if we got one
      if (result.sessionId) {
        this.jobStore.setStatus(jobId, 'running', result.sessionId);
        this.jobStore.addEvent(jobId, { type: 'START', sessionId: result.sessionId });
      }

      // Process result
      const response = this.processExecutionResult(jobId, result, payload);
      this.jobStore.setResponse(jobId, response);

      // Handle blocking
      if (response.status === 'blocked' && response.blocked) {
        await this.handleBlocking(jobId, response.blocked, payload);
      }

      return {
        jobId,
        dispatched: true,
        sessionId: result.sessionId,
        response,
      };
    } catch (err) {
      const error: JobError = {
        code: 'execution_failed',
        message: err instanceof Error ? err.message : String(err),
        retryable: this.isRetryableError(err),
      };

      const response: JobResponse = {
        jobId,
        status: 'failed',
        error,
        completedAt: nowTimestamp(),
      };

      this.jobStore.setResponse(jobId, response);
      this.jobStore.addEvent(jobId, { type: 'FAIL', error });

      logger.error({ err, jobId }, 'Job execution failed');

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
   */
  private processExecutionResult(
    jobId: string,
    result: { success: boolean; sessionId?: string; response?: string; error?: { code: string; message: string } },
    payload: JobPayload
  ): JobResponse {
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

      // Success
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

    // Failure
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

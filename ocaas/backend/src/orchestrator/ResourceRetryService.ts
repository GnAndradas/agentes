import { createHash } from 'crypto';
import { orchestratorLogger, logError } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import { RESOURCE_TYPE, DRAFT_STATUS } from '../db/schema/drafts.js';
import type { ResourceType } from '../db/schema/drafts.js';
import type { MissingCapabilityReport, CapabilitySuggestion } from './types.js';

const logger = orchestratorLogger.child({ component: 'ResourceRetryService' });

// ============================================================================
// Configuration
// ============================================================================

const MAX_RESOURCE_RETRIES = 3;
const PENDING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const LOCK_TIMEOUT_MS = 30000; // 30 seconds max lock time

// ============================================================================
// Types
// ============================================================================

export interface PendingResourceRetry {
  taskId: string;
  draftId: string;
  resourceType: ResourceType;
  resourceName: string;
  resourceKey: string; // hash for deduplication
  attempt: number;
  createdAt: number;
  source: 'auto' | 'manual';
  lastRetryAt?: number;
  lastFailureReason?: string;
}

interface TaskLock {
  taskId: string;
  lockedAt: number;
  operation: 'create_draft' | 'retry';
}

interface ResourceLock {
  resourceKey: string;
  lockedAt: number;
  taskId: string;
}

export interface TaskRetryInfo {
  retryCount: number;
  lastRetryAt?: number;
  pendingResources: string[];
  lastFailureReason?: string;
}

// ============================================================================
// Service
// ============================================================================

/**
 * ResourceRetryService: Coordinates the loop between missing resources and task retry
 *
 * Flow:
 * 1. Task fails with missing_resource
 * 2. Creates draft via ManualResourceService
 * 3. Based on autonomy:
 *    - MANUAL: draft stays, waits for human
 *    - SUPERVISED: auto-submit, waits for approval
 *    - AUTONOMOUS: auto-approve, auto-activate
 * 4. On activation: retries the original task
 *
 * Protections:
 * - Max retries per task (prevents infinite loops)
 * - Deduplication by hash (prevents duplicate resource creation)
 * - Locking by taskId and resourceKey (prevents race conditions)
 * - Cleanup of old pending entries
 * - Recovery on restart
 */
export class ResourceRetryService {
  // Track pending retries: draftId -> PendingResourceRetry
  private pendingRetries = new Map<string, PendingResourceRetry>();

  // Track tasks with pending resource creation: taskId -> draftId[]
  private taskPendingDrafts = new Map<string, Set<string>>();

  // Track retry counts per task to prevent infinite loops
  private taskRetryCounts = new Map<string, number>();

  // Track last retry timestamp per task
  private taskLastRetryAt = new Map<string, number>();

  // Track last failure reason per task
  private taskLastFailure = new Map<string, string>();

  // Locks to prevent concurrent operations
  private taskLocks = new Map<string, TaskLock>();
  private resourceLocks = new Map<string, ResourceLock>();

  // Track tasks that have already been retried for a given draftId (prevent double execution)
  private retriedTasksForDraft = new Map<string, Set<string>>();

  // Track resource keys that already exist (deduplication cache)
  private existingResourceKeys = new Set<string>();

  /**
   * Generate a unique key for a resource based on type, name, and intent
   */
  private generateResourceKey(
    resourceType: ResourceType,
    name: string,
    intent?: string
  ): string {
    const data = `${resourceType}:${this.slugify(name)}:${intent || ''}`;
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Acquire a lock for a task operation
   * Returns true if lock acquired, false if already locked
   */
  private acquireTaskLock(taskId: string, operation: 'create_draft' | 'retry'): boolean {
    const existing = this.taskLocks.get(taskId);
    const now = Date.now();

    // Check if existing lock is expired
    if (existing && (now - existing.lockedAt) < LOCK_TIMEOUT_MS) {
      logger.debug({ taskId, existingOp: existing.operation, requestedOp: operation }, 'Task already locked');
      return false;
    }

    // Acquire lock
    this.taskLocks.set(taskId, { taskId, lockedAt: now, operation });
    return true;
  }

  /**
   * Release a task lock
   */
  private releaseTaskLock(taskId: string): void {
    this.taskLocks.delete(taskId);
  }

  /**
   * Acquire a lock for a resource key
   * Returns true if lock acquired, false if already locked
   */
  private acquireResourceLock(resourceKey: string, taskId: string): boolean {
    const existing = this.resourceLocks.get(resourceKey);
    const now = Date.now();

    // Check if existing lock is expired
    if (existing && (now - existing.lockedAt) < LOCK_TIMEOUT_MS) {
      logger.debug({ resourceKey, existingTask: existing.taskId, requestingTask: taskId }, 'Resource already locked');
      return false;
    }

    // Acquire lock
    this.resourceLocks.set(resourceKey, { resourceKey, lockedAt: now, taskId });
    return true;
  }

  /**
   * Release a resource lock
   */
  private releaseResourceLock(resourceKey: string): void {
    this.resourceLocks.delete(resourceKey);
  }

  /**
   * Handle missing resource detected during task routing
   * Creates a draft and manages the workflow based on autonomy level
   */
  async handleMissingResource(
    taskId: string,
    missingReport: MissingCapabilityReport
  ): Promise<{ draftIds: string[]; requiresHuman: boolean }> {
    const { eventService } = getServices();
    const autonomyConfig = getAutonomyConfig();

    // ========================================
    // PROTECTION 1: Acquire task lock
    // ========================================
    if (!this.acquireTaskLock(taskId, 'create_draft')) {
      logger.warn({ taskId }, 'Task locked, skipping duplicate handleMissingResource call');
      return { draftIds: [], requiresHuman: false };
    }

    try {
      const draftIds: string[] = [];
      let requiresHuman = false;

      // ========================================
      // PROTECTION 2: Check max retries
      // ========================================
      const currentRetries = this.taskRetryCounts.get(taskId) || 0;
      if (currentRetries >= MAX_RESOURCE_RETRIES) {
        logger.warn({ taskId, currentRetries, maxRetries: MAX_RESOURCE_RETRIES }, 'Max resource retries exceeded for task');

        this.taskLastFailure.set(taskId, `Max retries (${MAX_RESOURCE_RETRIES}) exceeded`);

        await eventService.emit({
          type: EVENT_TYPE.TASK_RETRY_EXHAUSTED,
          category: 'orchestrator',
          severity: 'warning',
          message: `Task ${taskId} exceeded max resource creation retries`,
          resourceType: 'task',
          resourceId: taskId,
          data: {
            maxRetries: MAX_RESOURCE_RETRIES,
            currentRetries,
            autonomyMode: autonomyConfig.level,
          },
        });

        return { draftIds: [], requiresHuman: true };
      }

      // Emit missing resource event with full payload
      await eventService.emit({
        type: EVENT_TYPE.TASK_MISSING_RESOURCE,
        category: 'orchestrator',
        severity: 'warning',
        message: `Task ${taskId} requires resources: ${missingReport.missingCapabilities.join(', ')}`,
        resourceType: 'task',
        resourceId: taskId,
        data: {
          missingCapabilities: missingReport.missingCapabilities,
          suggestions: missingReport.suggestions.map(s => s.name),
          retryCount: currentRetries,
          autonomyMode: autonomyConfig.level,
        },
      });

      // Process each suggestion
      for (const suggestion of missingReport.suggestions) {
        if (suggestion.priority === 'required' || suggestion.priority === 'recommended') {
          // ========================================
          // PROTECTION 3: Generate resource key for deduplication
          // ========================================
          const resourceKey = this.generateResourceKey(
            suggestion.type as ResourceType,
            suggestion.name,
            suggestion.reason
          );

          // ========================================
          // PROTECTION 4: Check if resource already exists/being created
          // ========================================
          if (this.existingResourceKeys.has(resourceKey)) {
            logger.info({ taskId, resourceKey, name: suggestion.name }, 'Resource already exists, skipping creation');
            // Find existing draft with this key and attach task
            const existingDraft = this.findDraftByResourceKey(resourceKey);
            if (existingDraft) {
              this.attachTaskToDraft(existingDraft, taskId);
              draftIds.push(existingDraft);
            }
            continue;
          }

          // ========================================
          // PROTECTION 5: Acquire resource lock
          // ========================================
          if (!this.acquireResourceLock(resourceKey, taskId)) {
            logger.info({ taskId, resourceKey }, 'Resource locked by another task, waiting');
            // Another task is creating this resource, we'll benefit from it
            continue;
          }

          try {
            const result = await this.createResourceDraft(
              taskId,
              suggestion,
              autonomyConfig.level,
              resourceKey
            );

            if (result.draftId) {
              draftIds.push(result.draftId);
              this.existingResourceKeys.add(resourceKey);
            }

            if (result.requiresHuman) {
              requiresHuman = true;
            }
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
            logger.error({ err, taskId, suggestion: suggestion.name }, 'Failed to create resource draft');

            this.taskLastFailure.set(taskId, `Failed to create ${suggestion.type}: ${error}`);

            await eventService.emit({
              type: EVENT_TYPE.TASK_RETRY_FAILED,
              category: 'orchestrator',
              severity: 'error',
              message: `Failed to create ${suggestion.type} draft: ${error}`,
              resourceType: 'task',
              resourceId: taskId,
              data: {
                suggestionName: suggestion.name,
                error,
                retryCount: currentRetries,
                autonomyMode: autonomyConfig.level,
              },
            });
          } finally {
            this.releaseResourceLock(resourceKey);
          }
        }
      }

      // Increment retry count and update timestamps
      this.taskRetryCounts.set(taskId, currentRetries + 1);
      this.taskLastRetryAt.set(taskId, Date.now());

      return { draftIds, requiresHuman };
    } finally {
      this.releaseTaskLock(taskId);
    }
  }

  /**
   * Find a draft ID by resource key
   */
  private findDraftByResourceKey(resourceKey: string): string | null {
    for (const [draftId, pending] of this.pendingRetries.entries()) {
      if (pending.resourceKey === resourceKey) {
        return draftId;
      }
    }
    return null;
  }

  /**
   * Attach an additional task to an existing draft
   */
  private attachTaskToDraft(draftId: string, taskId: string): void {
    const pending = this.pendingRetries.get(draftId);
    if (!pending) return;

    // Track task -> drafts mapping
    const taskDrafts = this.taskPendingDrafts.get(taskId) || new Set();
    taskDrafts.add(draftId);
    this.taskPendingDrafts.set(taskId, taskDrafts);

    logger.info({ draftId, taskId }, 'Attached additional task to existing draft');
  }

  /**
   * Create a resource draft and manage workflow based on autonomy
   */
  private async createResourceDraft(
    taskId: string,
    suggestion: CapabilitySuggestion,
    autonomyLevel: 'manual' | 'supervised' | 'autonomous',
    resourceKey: string
  ): Promise<{ draftId: string | null; requiresHuman: boolean }> {
    const { manualResourceService, taskService } = getServices();

    // Map suggestion type to ResourceType
    const resourceType = suggestion.type as ResourceType;

    // Check for existing draft with same slug to prevent duplicates
    const slug = this.slugify(suggestion.name);
    const existing = await manualResourceService.getBySlug(resourceType, slug);

    if (existing && existing.status !== DRAFT_STATUS.REJECTED) {
      logger.info({ taskId, slug, existingStatus: existing.status }, 'Draft already exists, reusing');

      // Track this task against existing draft
      this.trackPending(existing.id, taskId, resourceType, suggestion.name, resourceKey, 'auto');

      // If already active, trigger retry immediately
      if (existing.status === DRAFT_STATUS.ACTIVE) {
        await this.onResourceActivated(existing.id);
        return { draftId: existing.id, requiresHuman: false };
      }

      // If already approved, activate it
      if (existing.status === DRAFT_STATUS.APPROVED) {
        await manualResourceService.activate(existing.id);
        // onResourceActivated will be called by the callback
        return { draftId: existing.id, requiresHuman: false };
      }

      // Otherwise it's pending - mark as requiring human if not autonomous
      return { draftId: existing.id, requiresHuman: autonomyLevel !== 'autonomous' };
    }

    // Get task context for pre-filling draft
    const task = await taskService.getById(taskId);

    // Build content based on resource type
    const content = this.buildDraftContent(resourceType, suggestion, task);

    // Create draft
    const draft = await manualResourceService.createDraft({
      resourceType,
      name: suggestion.name,
      description: suggestion.description,
      content,
      metadata: {
        taskId,
        autoCreated: true,
        missingCapability: suggestion.reason,
        resourceKey,
      },
      createdBy: 'system:orchestrator',
    });

    // Track pending retry
    this.trackPending(draft.id, taskId, resourceType, suggestion.name, resourceKey, 'auto');

    logger.info({
      draftId: draft.id,
      taskId,
      resourceType,
      name: suggestion.name,
      resourceKey,
      autonomyLevel,
    }, 'Resource draft created for task');

    // Handle autonomy flow
    switch (autonomyLevel) {
      case 'autonomous':
        // Auto-submit, auto-approve, auto-activate
        await manualResourceService.submitForApproval(draft.id, 'system:auto');
        await manualResourceService.approve(draft.id, 'system:auto');
        await manualResourceService.activate(draft.id);
        // onResourceActivated will be called by the callback
        return { draftId: draft.id, requiresHuman: false };

      case 'supervised':
        // Auto-submit, wait for human approval
        await manualResourceService.submitForApproval(draft.id, 'system:auto');
        return { draftId: draft.id, requiresHuman: true };

      case 'manual':
      default:
        // Just create draft, wait for human to do everything
        return { draftId: draft.id, requiresHuman: true };
    }
  }

  /**
   * Build draft content based on resource type and suggestion
   */
  private buildDraftContent(
    resourceType: ResourceType,
    suggestion: CapabilitySuggestion,
    task: { title: string; description?: string; input?: Record<string, unknown> }
  ): Record<string, unknown> {
    switch (resourceType) {
      case RESOURCE_TYPE.AGENT:
        return {
          type: 'specialist',
          capabilities: [suggestion.name.replace(/-agent$/, '')],
          config: {
            systemPrompt: `You are an agent specialized in ${suggestion.description || suggestion.name}. Created to handle tasks like: ${task.title}`,
          },
        };

      case RESOURCE_TYPE.SKILL:
        return {
          files: {
            'SKILL.md': `# ${suggestion.name}\n\n${suggestion.description || 'Auto-generated skill'}\n\n## Purpose\n\nCreated to handle: ${task.title}`,
            'agent-instructions.md': `# Instructions\n\nUse this skill for ${suggestion.description || suggestion.name}.\n\n## Context\n\nTask: ${task.title}`,
          },
          capabilities: [suggestion.name.replace(/-skill$/, '')],
        };

      case RESOURCE_TYPE.TOOL:
        return {
          type: 'sh' as const,
          script: `#!/bin/bash\n# ${suggestion.name}\n# ${suggestion.description || 'Auto-generated tool'}\n# TODO: Implement tool logic\necho "Tool ${suggestion.name} executed"`,
        };

      default:
        return {};
    }
  }

  /**
   * Track a pending retry
   */
  private trackPending(
    draftId: string,
    taskId: string,
    resourceType: ResourceType,
    resourceName: string,
    resourceKey: string,
    source: 'auto' | 'manual'
  ): void {
    const pending: PendingResourceRetry = {
      taskId,
      draftId,
      resourceType,
      resourceName,
      resourceKey,
      attempt: (this.taskRetryCounts.get(taskId) || 0) + 1,
      createdAt: Date.now(),
      source,
    };

    this.pendingRetries.set(draftId, pending);

    // Track task -> drafts mapping
    const taskDrafts = this.taskPendingDrafts.get(taskId) || new Set();
    taskDrafts.add(draftId);
    this.taskPendingDrafts.set(taskId, taskDrafts);
  }

  /**
   * Called when a resource is activated (after approval workflow)
   * Triggers retry of waiting tasks
   *
   * PROTECTION: Ensures each task is only retried ONCE per draft activation
   */
  async onResourceActivated(draftId: string): Promise<string[]> {
    const pending = this.pendingRetries.get(draftId);
    if (!pending) {
      logger.debug({ draftId }, 'No pending retry for this draft');
      return [];
    }

    const { eventService, taskService } = getServices();
    const autonomyConfig = getAutonomyConfig();
    const retriedTasks: string[] = [];

    // ========================================
    // PROTECTION: Track which tasks have been retried for this draft
    // ========================================
    const alreadyRetried = this.retriedTasksForDraft.get(draftId) || new Set();

    // Get all tasks waiting on this draft
    const taskIds = new Set<string>();
    taskIds.add(pending.taskId);

    // Also find other tasks waiting on same resource
    for (const [id, p] of this.pendingRetries.entries()) {
      if (p.resourceName === pending.resourceName && p.resourceType === pending.resourceType) {
        taskIds.add(p.taskId);
        this.pendingRetries.delete(id);
      }
    }

    for (const taskId of taskIds) {
      // ========================================
      // PROTECTION: Skip if already retried
      // ========================================
      if (alreadyRetried.has(taskId)) {
        logger.debug({ taskId, draftId }, 'Task already retried for this draft, skipping');
        continue;
      }

      // ========================================
      // PROTECTION: Acquire retry lock
      // ========================================
      if (!this.acquireTaskLock(taskId, 'retry')) {
        logger.debug({ taskId }, 'Task locked for retry, skipping');
        continue;
      }

      try {
        const task = await taskService.getById(taskId);

        // Only retry if task is still in retriable state
        if (task.status !== 'queued' && task.status !== 'pending' && task.status !== 'assigned') {
          logger.info({ taskId, status: task.status }, 'Task no longer in retriable state');
          continue;
        }

        // Mark as retried BEFORE triggering retry
        alreadyRetried.add(taskId);
        this.retriedTasksForDraft.set(draftId, alreadyRetried);

        // Update last retry timestamp
        this.taskLastRetryAt.set(taskId, Date.now());

        // Emit retrying event with full payload
        await eventService.emit({
          type: EVENT_TYPE.TASK_RETRYING,
          category: 'orchestrator',
          severity: 'info',
          message: `Retrying task "${task.title}" after ${pending.resourceType} "${pending.resourceName}" was activated`,
          resourceType: 'task',
          resourceId: taskId,
          data: {
            draftId,
            resourceType: pending.resourceType,
            resourceName: pending.resourceName,
            resourceKey: pending.resourceKey,
            attempt: pending.attempt,
            retryCount: this.taskRetryCounts.get(taskId) || 0,
            autonomyMode: autonomyConfig.level,
          },
        });

        logger.info({
          taskId,
          draftId,
          resourceType: pending.resourceType,
          resourceName: pending.resourceName,
        }, 'Task retry triggered after resource activation');

        retriedTasks.push(taskId);

        // Clean up task's draft tracking
        const taskDrafts = this.taskPendingDrafts.get(taskId);
        if (taskDrafts) {
          taskDrafts.delete(draftId);
          if (taskDrafts.size === 0) {
            this.taskPendingDrafts.delete(taskId);
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err, taskId, draftId }, 'Failed to trigger task retry');

        this.taskLastFailure.set(taskId, `Retry failed: ${errorMsg}`);

        await eventService.emit({
          type: EVENT_TYPE.TASK_RETRY_FAILED,
          category: 'orchestrator',
          severity: 'error',
          message: `Failed to retry task ${taskId}: ${errorMsg}`,
          resourceType: 'task',
          resourceId: taskId,
          data: {
            draftId,
            error: errorMsg,
            retryCount: this.taskRetryCounts.get(taskId) || 0,
            autonomyMode: autonomyConfig.level,
          },
        });
      } finally {
        this.releaseTaskLock(taskId);
      }
    }

    // Clean up main pending entry
    this.pendingRetries.delete(draftId);

    return retriedTasks;
  }

  /**
   * Get tasks waiting on retry for a specific draft
   */
  getWaitingTasks(draftId: string): string[] {
    const pending = this.pendingRetries.get(draftId);
    if (!pending) return [];

    const tasks: string[] = [pending.taskId];

    // Find other tasks with same resource
    for (const [, p] of this.pendingRetries.entries()) {
      if (p.resourceName === pending.resourceName && p.resourceType === pending.resourceType) {
        if (!tasks.includes(p.taskId)) {
          tasks.push(p.taskId);
        }
      }
    }

    return tasks;
  }

  /**
   * Check if a task has pending resource creation
   */
  hasPendingResource(taskId: string): boolean {
    return this.taskPendingDrafts.has(taskId) && this.taskPendingDrafts.get(taskId)!.size > 0;
  }

  /**
   * Get pending drafts for a task
   */
  getPendingDraftsForTask(taskId: string): string[] {
    const drafts = this.taskPendingDrafts.get(taskId);
    return drafts ? Array.from(drafts) : [];
  }

  /**
   * Get retry count for a task
   */
  getRetryCount(taskId: string): number {
    return this.taskRetryCounts.get(taskId) || 0;
  }

  /**
   * Get full retry info for a task (for visibility/debugging)
   */
  getTaskRetryInfo(taskId: string): TaskRetryInfo {
    return {
      retryCount: this.taskRetryCounts.get(taskId) || 0,
      lastRetryAt: this.taskLastRetryAt.get(taskId),
      pendingResources: this.getPendingDraftsForTask(taskId),
      lastFailureReason: this.taskLastFailure.get(taskId),
    };
  }

  /**
   * Clear tracking for a completed/cancelled task
   */
  clearForTask(taskId: string): void {
    const drafts = this.taskPendingDrafts.get(taskId);
    if (drafts) {
      for (const draftId of drafts) {
        const pending = this.pendingRetries.get(draftId);
        if (pending) {
          this.existingResourceKeys.delete(pending.resourceKey);
        }
        this.pendingRetries.delete(draftId);
      }
    }
    this.taskPendingDrafts.delete(taskId);
    this.taskRetryCounts.delete(taskId);
    this.taskLastRetryAt.delete(taskId);
    this.taskLastFailure.delete(taskId);
    this.taskLocks.delete(taskId);
  }

  /**
   * Clean up old pending entries (older than 1 hour)
   */
  cleanupOld(): number {
    const oneHourAgo = Date.now() - PENDING_CLEANUP_INTERVAL_MS;
    let cleaned = 0;

    // Clean old pending retries
    for (const [draftId, pending] of this.pendingRetries.entries()) {
      if (pending.createdAt < oneHourAgo) {
        this.pendingRetries.delete(draftId);
        this.existingResourceKeys.delete(pending.resourceKey);

        // Also clean task mapping
        const taskDrafts = this.taskPendingDrafts.get(pending.taskId);
        if (taskDrafts) {
          taskDrafts.delete(draftId);
          if (taskDrafts.size === 0) {
            this.taskPendingDrafts.delete(pending.taskId);
            this.taskRetryCounts.delete(pending.taskId);
            this.taskLastRetryAt.delete(pending.taskId);
            this.taskLastFailure.delete(pending.taskId);
          }
        }

        cleaned++;
      }
    }

    // Clean old locks (expired)
    const now = Date.now();
    for (const [taskId, lock] of this.taskLocks.entries()) {
      if ((now - lock.lockedAt) > LOCK_TIMEOUT_MS) {
        this.taskLocks.delete(taskId);
      }
    }
    for (const [resourceKey, lock] of this.resourceLocks.entries()) {
      if ((now - lock.lockedAt) > LOCK_TIMEOUT_MS) {
        this.resourceLocks.delete(resourceKey);
      }
    }

    // Clean old retriedTasksForDraft entries (older than 1 hour based on pending)
    for (const [draftId] of this.retriedTasksForDraft.entries()) {
      if (!this.pendingRetries.has(draftId)) {
        // If the pending entry was cleaned, also clean this
        this.retriedTasksForDraft.delete(draftId);
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old pending resource retries');
    }

    return cleaned;
  }

  /**
   * Slugify a resource name
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Get status summary
   */
  getStatus(): {
    pendingRetries: number;
    tasksWaiting: number;
    retriesByType: Record<string, number>;
    activeLocks: { tasks: number; resources: number };
  } {
    const retriesByType: Record<string, number> = {};

    for (const pending of this.pendingRetries.values()) {
      retriesByType[pending.resourceType] = (retriesByType[pending.resourceType] || 0) + 1;
    }

    return {
      pendingRetries: this.pendingRetries.size,
      tasksWaiting: this.taskPendingDrafts.size,
      retriesByType,
      activeLocks: {
        tasks: this.taskLocks.size,
        resources: this.resourceLocks.size,
      },
    };
  }

  /**
   * RECOVERY: Reconstruct state from database on startup
   * Call this during orchestrator initialization
   */
  async recoverState(): Promise<{
    pendingDrafts: number;
    tasksWaiting: number;
    resourcesNeedingRetry: string[];
  }> {
    const { manualResourceService, taskService } = getServices();
    let pendingDrafts = 0;
    const tasksWaiting = new Set<string>();
    const resourcesNeedingRetry: string[] = [];

    try {
      // Get all non-terminal drafts
      const drafts = await manualResourceService.list({});

      for (const draft of drafts) {
        // Skip terminal states
        if (draft.status === DRAFT_STATUS.REJECTED || draft.status === DRAFT_STATUS.ACTIVE) {
          continue;
        }

        // Check if draft has associated task
        const metadata = draft.metadata as Record<string, unknown> | null;
        const taskId = metadata?.taskId as string | undefined;
        const resourceKey = metadata?.resourceKey as string | undefined;

        if (taskId) {
          try {
            const task = await taskService.getById(taskId);

            // If task is still in retriable state, re-track it
            if (task.status === 'queued' || task.status === 'pending' || task.status === 'assigned') {
              this.trackPending(
                draft.id,
                taskId,
                draft.resourceType,
                draft.name,
                resourceKey || this.generateResourceKey(draft.resourceType, draft.name),
                metadata?.autoCreated ? 'auto' : 'manual'
              );
              pendingDrafts++;
              tasksWaiting.add(taskId);

              // If draft is approved but not activated, it needs retry
              if (draft.status === DRAFT_STATUS.APPROVED) {
                resourcesNeedingRetry.push(draft.id);
              }
            }
          } catch {
            // Task not found, skip
            logger.debug({ draftId: draft.id, taskId }, 'Task not found during recovery, skipping');
          }
        }
      }

      logger.info({
        pendingDrafts,
        tasksWaiting: tasksWaiting.size,
        resourcesNeedingRetry: resourcesNeedingRetry.length,
      }, 'ResourceRetryService state recovered');

      return {
        pendingDrafts,
        tasksWaiting: tasksWaiting.size,
        resourcesNeedingRetry,
      };
    } catch (err) {
      // Handle table not existing gracefully (fresh install)
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errorMsg.includes('no such table') || errorMsg.includes('SQLITE_ERROR')) {
        logger.warn({ error: errorMsg }, 'ResourceRetryService recovery skipped - table may not exist yet (fresh install)');
      } else {
        logger.error({ err }, 'Failed to recover ResourceRetryService state');
      }
      return {
        pendingDrafts: 0,
        tasksWaiting: 0,
        resourcesNeedingRetry: [],
      };
    }
  }

  /**
   * Manually trigger retry for pending resources (called after recovery)
   */
  async triggerPendingRetries(draftIds: string[]): Promise<string[]> {
    const { manualResourceService } = getServices();
    const retriedTasks: string[] = [];

    for (const draftId of draftIds) {
      try {
        const draft = await manualResourceService.getById(draftId);

        if (draft.status === DRAFT_STATUS.APPROVED) {
          // Activate and trigger retry
          await manualResourceService.activate(draftId);
          // onResourceActivated will be called by the callback
        } else if (draft.status === DRAFT_STATUS.ACTIVE) {
          // Already active, just trigger retry
          const tasks = await this.onResourceActivated(draftId);
          retriedTasks.push(...tasks);
        }
      } catch (err) {
        logger.error({ err, draftId }, 'Failed to trigger pending retry');
      }
    }

    return retriedTasks;
  }
}

// Singleton
let resourceRetryServiceInstance: ResourceRetryService | null = null;

export function getResourceRetryService(): ResourceRetryService {
  if (!resourceRetryServiceInstance) {
    resourceRetryServiceInstance = new ResourceRetryService();
  }
  return resourceRetryServiceInstance;
}

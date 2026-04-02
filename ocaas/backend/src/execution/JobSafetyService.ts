/**
 * Job Safety Service
 *
 * Production hardening for job execution:
 * - Hard timeouts with auto-abort
 * - Max retries enforcement
 * - Failsafe mode when OpenClaw fails
 * - Tool whitelist validation
 */

import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import { getOpenClawAdapter } from '../integrations/openclaw/OpenClawAdapter.js';
import { getJobDispatcherService } from './JobDispatcherService.js';
import type { JobRecord, JobPayload } from './types.js';

const logger = createLogger('JobSafety');

// ============================================================================
// SAFETY CONFIG
// ============================================================================

export interface JobSafetyConfig {
  /** Hard timeout - job killed after this (ms) */
  hardTimeoutMs: number;
  /** Max retries per job before permanent fail */
  maxRetriesPerJob: number;
  /** Enable failsafe mode check */
  enableFailsafe: boolean;
  /** Tool whitelist (empty = all allowed) */
  toolWhitelist: string[];
  /** Auto-abort interval check (ms) */
  autoAbortCheckIntervalMs: number;
}

const DEFAULT_SAFETY_CONFIG: JobSafetyConfig = {
  hardTimeoutMs: 10 * 60 * 1000, // 10 minutes absolute max
  maxRetriesPerJob: 3,
  enableFailsafe: true,
  toolWhitelist: [], // Empty = all allowed
  autoAbortCheckIntervalMs: 30 * 1000, // Check every 30s
};

// ============================================================================
// FAILSAFE STATE
// ============================================================================

interface FailsafeState {
  active: boolean;
  reason: string | null;
  activatedAt: number | null;
  consecutiveFailures: number;
}

const failsafeState: FailsafeState = {
  active: false,
  reason: null,
  activatedAt: null,
  consecutiveFailures: 0,
};

const FAILSAFE_THRESHOLD = 3; // Consecutive failures to trigger

// ============================================================================
// JOB SAFETY SERVICE
// ============================================================================

export class JobSafetyService {
  private config: JobSafetyConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private jobRetryCount = new Map<string, number>(); // taskId → retry count

  constructor(config: Partial<JobSafetyConfig> = {}) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
  }

  // ==========================================================================
  // FAILSAFE MODE
  // ==========================================================================

  /**
   * Check if failsafe mode is active
   */
  isFailsafeActive(): boolean {
    return failsafeState.active;
  }

  /**
   * Get failsafe state
   */
  getFailsafeState(): FailsafeState {
    return { ...failsafeState };
  }

  /**
   * Activate failsafe mode
   */
  activateFailsafe(reason: string): void {
    if (failsafeState.active) return;

    failsafeState.active = true;
    failsafeState.reason = reason;
    failsafeState.activatedAt = nowTimestamp();

    logger.warn({ reason }, 'FAILSAFE MODE ACTIVATED - New jobs blocked');
  }

  /**
   * Deactivate failsafe mode
   */
  deactivateFailsafe(): void {
    if (!failsafeState.active) return;

    failsafeState.active = false;
    failsafeState.reason = null;
    failsafeState.activatedAt = null;
    failsafeState.consecutiveFailures = 0;

    logger.info('Failsafe mode deactivated');
  }

  /**
   * Report OpenClaw connection result
   */
  reportGatewayStatus(success: boolean): void {
    if (!this.config.enableFailsafe) return;

    if (success) {
      failsafeState.consecutiveFailures = 0;
      if (failsafeState.active) {
        this.deactivateFailsafe();
      }
    } else {
      failsafeState.consecutiveFailures++;
      if (failsafeState.consecutiveFailures >= FAILSAFE_THRESHOLD) {
        this.activateFailsafe('OpenClaw gateway unreachable');
      }
    }
  }

  /**
   * Check if new job can be dispatched
   */
  canDispatchJob(): { allowed: boolean; reason?: string } {
    if (failsafeState.active) {
      return {
        allowed: false,
        reason: `Failsafe mode active: ${failsafeState.reason}`,
      };
    }
    return { allowed: true };
  }

  // ==========================================================================
  // RETRY LIMITS
  // ==========================================================================

  /**
   * Check if task can retry
   */
  canRetry(taskId: string): { allowed: boolean; currentCount: number; maxRetries: number } {
    const currentCount = this.jobRetryCount.get(taskId) || 0;
    return {
      allowed: currentCount < this.config.maxRetriesPerJob,
      currentCount,
      maxRetries: this.config.maxRetriesPerJob,
    };
  }

  /**
   * Increment retry count for task
   */
  incrementRetry(taskId: string): number {
    const current = this.jobRetryCount.get(taskId) || 0;
    const newCount = current + 1;
    this.jobRetryCount.set(taskId, newCount);
    return newCount;
  }

  /**
   * Reset retry count for task
   */
  resetRetry(taskId: string): void {
    this.jobRetryCount.delete(taskId);
  }

  // ==========================================================================
  // TOOL WHITELIST
  // ==========================================================================

  /**
   * Validate tools against whitelist
   */
  validateTools(tools: string[]): { valid: boolean; blocked: string[] } {
    if (this.config.toolWhitelist.length === 0) {
      return { valid: true, blocked: [] };
    }

    const blocked = tools.filter(t => !this.config.toolWhitelist.includes(t));
    return {
      valid: blocked.length === 0,
      blocked,
    };
  }

  /**
   * Add tool to whitelist
   */
  addToWhitelist(toolId: string): void {
    if (!this.config.toolWhitelist.includes(toolId)) {
      this.config.toolWhitelist.push(toolId);
    }
  }

  /**
   * Remove tool from whitelist
   */
  removeFromWhitelist(toolId: string): void {
    this.config.toolWhitelist = this.config.toolWhitelist.filter(t => t !== toolId);
  }

  /**
   * Get current whitelist
   */
  getWhitelist(): string[] {
    return [...this.config.toolWhitelist];
  }

  // ==========================================================================
  // AUTO-ABORT
  // ==========================================================================

  /**
   * Start auto-abort checker
   */
  startAutoAbortChecker(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAndAbortTimedOut();
    }, this.config.autoAbortCheckIntervalMs);

    logger.info({ intervalMs: this.config.autoAbortCheckIntervalMs }, 'Auto-abort checker started');
  }

  /**
   * Stop auto-abort checker
   */
  stopAutoAbortChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check for timed out jobs and abort them
   */
  async checkAndAbortTimedOut(): Promise<number> {
    const dispatcher = getJobDispatcherService();
    const activeJobs = dispatcher.getActiveJobs();
    const now = nowTimestamp();
    let abortedCount = 0;

    for (const job of activeJobs) {
      const elapsed = now - job.createdAt;
      const timeout = job.payload.timeoutMs || this.config.hardTimeoutMs;

      if (elapsed > timeout) {
        logger.warn({
          jobId: job.id,
          elapsed,
          timeout,
        }, 'Job exceeded hard timeout, aborting');

        const aborted = await dispatcher.abort(job.id);
        if (aborted) {
          abortedCount++;
        }
      }
    }

    if (abortedCount > 0) {
      logger.info({ abortedCount }, 'Auto-aborted timed out jobs');
    }

    return abortedCount;
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate job payload before dispatch
   */
  validatePayload(payload: JobPayload): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check failsafe
    const dispatchCheck = this.canDispatchJob();
    if (!dispatchCheck.allowed) {
      errors.push(dispatchCheck.reason!);
    }

    // Check retry limit
    const retryCheck = this.canRetry(payload.taskId);
    if (!retryCheck.allowed) {
      errors.push(`Task exceeded max retries (${retryCheck.maxRetries})`);
    }

    // Check tool whitelist
    const toolCheck = this.validateTools(payload.allowedResources.tools);
    if (!toolCheck.valid) {
      errors.push(`Blocked tools: ${toolCheck.blocked.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Initialize service
   */
  initialize(): void {
    this.startAutoAbortChecker();
    logger.info('JobSafetyService initialized');
  }

  /**
   * Shutdown service
   */
  shutdown(): void {
    this.stopAutoAbortChecker();
    logger.info('JobSafetyService shutdown');
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<JobSafetyConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config: this.config }, 'JobSafetyService config updated');
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: JobSafetyService | null = null;

export function getJobSafetyService(): JobSafetyService {
  if (!instance) {
    instance = new JobSafetyService();
  }
  return instance;
}

export function resetJobSafetyService(): void {
  if (instance) {
    instance.shutdown();
  }
  instance = null;
}

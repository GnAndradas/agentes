/**
 * Execution Module
 *
 * Handles job execution lifecycle between OCAAS and OpenClaw.
 *
 * Exports:
 * - Types: Job payload, response, blocking, etc.
 * - JobDispatcherService: Main orchestrator for job dispatch
 */

// Types
export type {
  JobPayload,
  JobResponse,
  JobResult,
  JobError,
  JobErrorCode,
  JobBlocked,
  JobStatus,
  JobAgentContext,
  JobAllowedResources,
  JobConstraints,
  JobContext,
  JobRecord,
  JobEvent,
  JobStepLog,
  JobMetrics,
  DispatchOptions,
  DispatchResult,
  BlockingReason,
  BlockingSuggestion,
  MissingResource,
} from './types.js';

// Services
export {
  JobDispatcherService,
  getJobDispatcherService,
  resetJobDispatcherService,
  type JobDispatcherConfig,
} from './JobDispatcherService.js';

// Resolution
export {
  resolveBlockedJob,
  scheduleRetry,
  cancelPendingRetry,
  onApprovalCompleted,
  calculateRetryDelay,
  isRetryableError,
  DEFAULT_RETRY_CONFIG,
  type ResolutionRequest,
  type ResolutionResult,
  type RetryConfig,
} from './JobResolutionService.js';

// Payload optimization
export {
  optimizePayload,
  optimizeResult,
  buildCompactPrompt,
  estimateTokens,
} from './payloadOptimizer.js';

// Job-Aware Task Router
export {
  JobAwareTaskRouter,
  getJobAwareTaskRouter,
  resetJobAwareTaskRouter,
  type JobAwareConfig,
} from './JobAwareTaskRouter.js';

// Job Safety (Production Hardening)
export {
  JobSafetyService,
  getJobSafetyService,
  resetJobSafetyService,
  type JobSafetyConfig,
} from './JobSafetyService.js';

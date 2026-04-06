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

// BLOQUE 10: Execution Traceability
export {
  // Types
  type ExecutionMode,
  type ExecutionTransport,
  type ExecutionTraceability,
  type ExecutionModeInfo,
  type RuntimeReadyCheck,
  type ExecutionPoint,
  // Functions
  detectExecutionMode,
  isRealExecution,
  getExecutionModeDescription,
  checkRuntimeReady,
  createExecutionTraceability,
  getExecutionPoint,
  logExecutionMapSummary,
  // Constants
  DEFAULT_EXECUTION_TRACEABILITY,
  EXECUTION_POINTS,
  // Builder
  ExecutionTraceabilityBuilder,
} from './ExecutionTraceability.js';

// Tool Execution Service
export {
  ToolExecutionService,
  getToolExecutionService,
  resetToolExecutionService,
  type ToolExecutionInput,
  type ToolExecutionResult,
  type CommandExecutionInput,
  type CommandExecutionOutput,
} from './ToolExecutionService.js';

// Generation Trace Service (P0-02: End-to-end traceability)
export {
  getGenerationTraceService,
  resetGenerationTraceService,
  type GenerationTrace,
  type GenerationTraceInput,
} from './GenerationTraceService.js';

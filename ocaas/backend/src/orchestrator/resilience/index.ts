/**
 * Resilience Layer
 *
 * Fault tolerance, recovery, and checkpoint management
 */

// Types
export * from './types.js';

// Stores
export {
  CheckpointStore,
  getCheckpointStore,
  initializeCheckpointStore,
  shutdownCheckpointStore,
} from './CheckpointStore.js';
export { ExecutionLeaseStore, getExecutionLeaseStore } from './ExecutionLeaseStore.js';

// Error handling
export {
  OperationalError,
  isRetryableError,
  isRecoverableError,
  getRecoveryStrategy,
} from './OperationalError.js';

// Health & Circuit Breaker
export {
  HealthChecker,
  getHealthChecker,
  registerDefaultHealthChecks,
} from './HealthChecker.js';
export {
  CircuitBreaker,
  getCircuitBreaker,
  getAllCircuitBreakers,
  getCircuitBreakersSummary,
  allCircuitsHealthy,
} from './CircuitBreaker.js';

// Recovery
export {
  ExecutionRecoveryService,
  getExecutionRecoveryService,
} from './ExecutionRecoveryService.js';

// Pause/Resume
export {
  PauseResumeManager,
  getPauseResumeManager,
  type PauseResult,
  type ResumeResult,
} from './PauseResumeManager.js';

// Events
export {
  ResilienceEventEmitter,
  getResilienceEventEmitter,
} from './ResilienceEventEmitter.js';

// Convenience initializer
import { getHealthChecker, registerDefaultHealthChecks } from './HealthChecker.js';
import { getCircuitBreaker } from './CircuitBreaker.js';
import { getExecutionRecoveryService } from './ExecutionRecoveryService.js';
import { initializeCheckpointStore, shutdownCheckpointStore } from './CheckpointStore.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ResilienceInit');

/**
 * Initialize resilience layer
 */
export async function initializeResilience(): Promise<void> {
  logger.info('Initializing resilience layer...');

  // Load checkpoints from DB first
  const checkpointsLoaded = await initializeCheckpointStore();
  logger.info({ checkpointsLoaded }, 'Checkpoints loaded from DB');

  // Register default health checks
  const healthChecker = getHealthChecker();
  await registerDefaultHealthChecks(healthChecker);

  // Start periodic health checks
  healthChecker.startPeriodicChecks();

  // Initialize main circuit breaker
  getCircuitBreaker('main');
  getCircuitBreaker('openclaw');

  // Perform startup recovery
  const recoveryService = getExecutionRecoveryService();
  const result = await recoveryService.startupRecovery();

  logger.info({
    recovered: result.recovered.length,
    failed: result.failed.length,
    skipped: result.skipped.length,
  }, 'Resilience layer initialized');
}

/**
 * Graceful shutdown of resilience layer
 */
export async function shutdownResilience(): Promise<void> {
  logger.info('Shutting down resilience layer...');

  const healthChecker = getHealthChecker();
  healthChecker.stopPeriodicChecks();

  // Pause all running tasks
  const { getPauseResumeManager } = await import('./PauseResumeManager.js');
  const pauseManager = getPauseResumeManager();
  const results = pauseManager.pauseAllRunning('System shutdown');

  // Flush pending checkpoint writes to DB
  await shutdownCheckpointStore();

  logger.info({
    paused: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  }, 'Resilience layer shutdown complete');
}

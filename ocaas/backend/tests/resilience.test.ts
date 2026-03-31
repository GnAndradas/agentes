/**
 * Resilience Layer Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CheckpointStore,
  ExecutionLeaseStore,
  OperationalError,
  isRetryableError,
  isRecoverableError,
  getRecoveryStrategy,
  HealthChecker,
  CircuitBreaker,
  PauseResumeManager,
} from '../src/orchestrator/resilience/index.js';

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new CheckpointStore();
  });

  describe('create', () => {
    it('should create a checkpoint for a task', () => {
      const checkpoint = store.create('task-1', 'agent-1');

      expect(checkpoint.taskId).toBe('task-1');
      expect(checkpoint.assignedAgentId).toBe('agent-1');
      expect(checkpoint.currentStage).toBe('queued');
      expect(checkpoint.progressPercent).toBe(0);
      expect(checkpoint.resumable).toBe(true);
      expect(checkpoint.executionId).toMatch(/^exec_/);
    });

    it('should create checkpoint without agent', () => {
      const checkpoint = store.create('task-2');

      expect(checkpoint.taskId).toBe('task-2');
      expect(checkpoint.assignedAgentId).toBeNull();
    });
  });

  describe('updateStage', () => {
    it('should update checkpoint stage', () => {
      store.create('task-1');
      const updated = store.updateStage('task-1', 'executing', 'step-1', 25);

      expect(updated?.currentStage).toBe('executing');
      expect(updated?.lastCompletedStep).toBe('step-1');
      expect(updated?.progressPercent).toBe(25);
    });

    it('should return null for non-existent task', () => {
      const result = store.updateStage('non-existent', 'executing');
      expect(result).toBeNull();
    });
  });

  describe('markPaused', () => {
    it('should mark checkpoint as paused', () => {
      store.create('task-1');
      store.updateStage('task-1', 'executing');
      const paused = store.markPaused('task-1', 'User requested');

      expect(paused?.currentStage).toBe('paused');
      expect(paused?.lastKnownBlocker).toBe('User requested');
      expect(paused?.resumable).toBe(true);
    });
  });

  describe('markFailed', () => {
    it('should mark checkpoint as failed and not resumable', () => {
      store.create('task-1');
      const failed = store.markFailed('task-1', 'Critical error');

      expect(failed?.currentStage).toBe('failed');
      expect(failed?.lastKnownBlocker).toBe('Critical error');
      expect(failed?.resumable).toBe(false);
    });
  });

  describe('markCompleted', () => {
    it('should mark checkpoint as completed', () => {
      store.create('task-1');
      const completed = store.markCompleted('task-1');

      expect(completed?.currentStage).toBe('completed');
      expect(completed?.progressPercent).toBe(100);
      expect(completed?.resumable).toBe(false);
    });
  });

  describe('getResumable', () => {
    it('should return only resumable checkpoints', () => {
      store.create('task-1');
      store.create('task-2');
      store.create('task-3');

      store.markPaused('task-1', 'paused');
      store.markCompleted('task-2');

      const resumable = store.getResumable();

      expect(resumable.length).toBe(2); // task-1 (paused but resumable) and task-3 (queued)
      expect(resumable.some(c => c.taskId === 'task-1')).toBe(true);
      expect(resumable.some(c => c.taskId === 'task-3')).toBe(true);
    });
  });

  describe('getWaitingExternal', () => {
    it('should return checkpoints waiting for external actions', () => {
      store.create('task-1');
      store.create('task-2');
      store.create('task-3');

      store.updatePendingApproval('task-1', 'approval-1');
      store.updatePendingResources('task-2', ['resource-1']);

      const waiting = store.getWaitingExternal();

      expect(waiting.length).toBe(2);
      expect(waiting.some(c => c.currentStage === 'waiting_approval')).toBe(true);
      expect(waiting.some(c => c.currentStage === 'waiting_resource')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup old completed/failed checkpoints', () => {
      store.create('task-1');
      store.create('task-2');

      store.markCompleted('task-1');
      store.markFailed('task-2', 'error');

      // Manipulate timestamps to be old (timestamps are in SECONDS in OCAAS)
      const checkpoint1 = store.get('task-1');
      const checkpoint2 = store.get('task-2');
      const twoHoursAgoInSeconds = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago in seconds
      if (checkpoint1) checkpoint1.updatedAt = twoHoursAgoInSeconds;
      if (checkpoint2) checkpoint2.updatedAt = twoHoursAgoInSeconds;

      const cleaned = store.cleanup(3600_000); // 1 hour max age in ms

      expect(cleaned).toBe(2);
      expect(store.get('task-1')).toBeNull();
      expect(store.get('task-2')).toBeNull();
    });
  });

  describe('export/import', () => {
    it('should export and import checkpoint', () => {
      store.create('task-1', 'agent-1');
      store.updateStage('task-1', 'executing', 'step-1', 50);

      const exported = store.export('task-1');
      expect(exported).not.toBeNull();

      const store2 = new CheckpointStore();
      const imported = store2.import(exported!);

      expect(imported?.taskId).toBe('task-1');
      expect(imported?.currentStage).toBe('executing');
      expect(imported?.progressPercent).toBe(50);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      store.create('task-1');
      store.create('task-2');
      store.create('task-3');

      store.markPaused('task-1', 'paused');
      store.markCompleted('task-2');

      const stats = store.getStats();

      expect(stats.total).toBe(3);
      expect(stats.resumable).toBe(2);
    });
  });
});

describe('ExecutionLeaseStore', () => {
  let store: ExecutionLeaseStore;

  beforeEach(() => {
    store = new ExecutionLeaseStore(5000); // 5 second lease for testing
  });

  describe('acquire', () => {
    it('should acquire a lease for a task', () => {
      const lease = store.acquire('task-1', 'exec-1');

      expect(lease).not.toBeNull();
      expect(lease?.taskId).toBe('task-1');
      expect(lease?.executionId).toBe('exec-1');
      expect(lease?.active).toBe(true);
    });

    it('should reject duplicate lease acquisition', () => {
      store.acquire('task-1', 'exec-1');
      const duplicate = store.acquire('task-1', 'exec-2');

      expect(duplicate).toBeNull();
    });

    it('should allow same execution to re-acquire', () => {
      store.acquire('task-1', 'exec-1');
      const same = store.acquire('task-1', 'exec-1');

      expect(same).not.toBeNull();
      expect(same?.executionId).toBe('exec-1');
    });
  });

  describe('renew', () => {
    it('should renew an existing lease', () => {
      store.acquire('task-1', 'exec-1');
      const renewed = store.renew('task-1', 'exec-1');

      expect(renewed).not.toBeNull();
      expect(renewed?.lastRenewalAt).toBeGreaterThan(0);
    });

    it('should reject renewal from wrong execution', () => {
      store.acquire('task-1', 'exec-1');
      const wrongRenewal = store.renew('task-1', 'exec-2');

      expect(wrongRenewal).toBeNull();
    });
  });

  describe('release', () => {
    it('should release a lease', () => {
      store.acquire('task-1', 'exec-1');
      const released = store.release('task-1', 'exec-1');

      expect(released).toBe(true);
      expect(store.hasActiveLease('task-1')).toBe(false);
    });

    it('should reject release from wrong execution', () => {
      store.acquire('task-1', 'exec-1');
      const wrongRelease = store.release('task-1', 'exec-2');

      expect(wrongRelease).toBe(false);
      expect(store.hasActiveLease('task-1')).toBe(true);
    });
  });

  describe('ownsLease', () => {
    it('should check ownership correctly', () => {
      store.acquire('task-1', 'exec-1');

      expect(store.ownsLease('task-1', 'exec-1')).toBe(true);
      expect(store.ownsLease('task-1', 'exec-2')).toBe(false);
      expect(store.ownsLease('task-2', 'exec-1')).toBe(false);
    });
  });

  describe('getExpiredLeases', () => {
    // This test is timing-sensitive and may be flaky in CI environments
    it.skip('should detect expired leases', async () => {
      const shortStore = new ExecutionLeaseStore(50); // 50ms lease
      shortStore.acquire('task-1', 'exec-1');

      // Wait for expiration (with buffer)
      await new Promise(resolve => setTimeout(resolve, 150));

      const expired = shortStore.getExpiredLeases();
      expect(expired.length).toBe(1);
      expect(expired[0].taskId).toBe('task-1');
    });

    it('should track leases that will expire', () => {
      // Non-timing test: just verify the method exists and works
      const testStore = new ExecutionLeaseStore(1000);
      testStore.acquire('task-1', 'exec-1');

      // Force the lease to be expired by manipulating the internal state
      // ExecutionLeaseStore uses milliseconds (Date.now())
      const lease = testStore.get('task-1');
      if (lease) {
        lease.expiresAt = 1; // Very old timestamp (1ms since epoch)
      }

      const expired = testStore.getExpiredLeases();
      expect(expired.length).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      store.acquire('task-1', 'exec-1');
      store.acquire('task-2', 'exec-2');
      store.release('task-2', 'exec-2');

      const stats = store.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
    });
  });
});

describe('OperationalError', () => {
  describe('from', () => {
    it('should classify connection errors', () => {
      const error = new Error('ECONNREFUSED');
      const opError = OperationalError.from(error);

      expect(opError.type).toBe('connection_lost');
      expect(opError.retryable).toBe(true);
    });

    it('should classify timeout errors', () => {
      const error = new Error('Request timed out');
      const opError = OperationalError.from(error);

      expect(opError.type).toBe('timeout');
      expect(opError.retryable).toBe(true);
    });

    it('should classify rate limit errors', () => {
      const error = new Error('Rate limit exceeded (429)');
      const opError = OperationalError.from(error);

      expect(opError.type).toBe('rate_limit');
      expect(opError.retryable).toBe(true);
    });

    it('should classify unknown errors', () => {
      const error = new Error('Something weird happened');
      const opError = OperationalError.from(error);

      expect(opError.type).toBe('unknown_runtime_error');
      expect(opError.retryable).toBe(false);
    });
  });

  describe('static constructors', () => {
    it('should create gateway unavailable error', () => {
      const error = OperationalError.gatewayUnavailable('Gateway down');

      expect(error.type).toBe('gateway_unavailable');
      expect(error.suggestedStrategy).toBe('retry_with_backoff');
    });

    it('should create lease conflict error', () => {
      const error = OperationalError.leaseConflict('Another execution owns the lease');

      expect(error.type).toBe('lease_conflict');
      expect(error.recoverable).toBe(false);
      expect(error.suggestedStrategy).toBe('wait_for_resolution');
    });
  });

  describe('helper functions', () => {
    it('isRetryableError should work', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('Something weird'))).toBe(false);
    });

    it('isRecoverableError should work', () => {
      expect(isRecoverableError(OperationalError.timeout('timeout'))).toBe(true);
      expect(isRecoverableError(OperationalError.checkpointCorrupted('corrupted'))).toBe(false);
    });

    it('getRecoveryStrategy should work', () => {
      expect(getRecoveryStrategy(new Error('ECONNREFUSED'))).toBe('retry_with_backoff');
      expect(getRecoveryStrategy(OperationalError.processCrashed('crash'))).toBe('restart_from_checkpoint');
    });
  });

  describe('toJSON', () => {
    it('should serialize error correctly', () => {
      const error = OperationalError.timeout('Request timed out', { requestId: '123' });
      const json = error.toJSON();

      expect(json.type).toBe('timeout');
      expect(json.message).toBe('Request timed out');
      expect(json.context).toEqual({ requestId: '123' });
    });
  });
});

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker();
  });

  afterEach(() => {
    checker.stopPeriodicChecks();
  });

  describe('registerCheck', () => {
    it('should register a health check', () => {
      checker.registerCheck('test', async () => true);

      const health = checker.getComponentHealth('test');
      expect(health).not.toBeNull();
      expect(health?.status).toBe('unknown');
    });
  });

  describe('checkComponent', () => {
    it('should mark healthy on success', async () => {
      checker.registerCheck('test', async () => true);
      const health = await checker.checkComponent('test');

      expect(health.status).toBe('healthy');
      expect(health.consecutiveFailures).toBe(0);
    });

    it('should mark degraded on first failures', async () => {
      checker.registerCheck('test', async () => false);
      await checker.checkComponent('test');
      const health = await checker.checkComponent('test');

      expect(health.status).toBe('degraded');
      expect(health.consecutiveFailures).toBe(2);
    });

    it('should mark unhealthy after threshold failures', async () => {
      checker.registerCheck('test', async () => false);

      // 3 failures = unhealthy
      await checker.checkComponent('test');
      await checker.checkComponent('test');
      const health = await checker.checkComponent('test');

      expect(health.status).toBe('unhealthy');
      expect(health.consecutiveFailures).toBe(3);
    });

    it('should handle check exceptions', async () => {
      checker.registerCheck('test', async () => {
        throw new Error('Check failed');
      });

      const health = await checker.checkComponent('test');

      expect(health.status).toBe('degraded');
      expect(health.lastError).toBe('Check failed');
    });
  });

  describe('calculateOverallStatus', () => {
    it('should return healthy when all healthy', async () => {
      checker.registerCheck('test1', async () => true);
      checker.registerCheck('test2', async () => true);
      await checker.checkAll();

      expect(checker.calculateOverallStatus()).toBe('healthy');
    });

    it('should return unhealthy when any unhealthy', async () => {
      checker.registerCheck('test1', async () => true);
      checker.registerCheck('test2', async () => false);

      // Make test2 unhealthy
      for (let i = 0; i < 3; i++) {
        await checker.checkComponent('test2');
      }

      expect(checker.calculateOverallStatus()).toBe('unhealthy');
    });

    it('should return unknown when no components', () => {
      expect(checker.calculateOverallStatus()).toBe('unknown');
    });
  });

  describe('getSummary', () => {
    it('should return correct summary', async () => {
      checker.registerCheck('healthy', async () => true);
      checker.registerCheck('unhealthy', async () => false);

      await checker.checkComponent('healthy');
      for (let i = 0; i < 3; i++) {
        await checker.checkComponent('unhealthy');
      }

      const summary = checker.getSummary();

      expect(summary.healthyCount).toBe(1);
      expect(summary.unhealthyCount).toBe(1);
      expect(summary.components.length).toBe(2);
    });
  });
});

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      openDurationMs: 50, // Very short for testing
      halfOpenMaxAttempts: 3,
    });
  });

  describe('initial state', () => {
    it('should start closed', () => {
      expect(breaker.getState()).toBe('closed');
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('should open after threshold failures', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState()).toBe('open');
      expect(breaker.canExecute()).toBe(false);
    });

    it('should reset failures on success', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();

      expect(breaker.getState()).toBe('closed');
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('half-open state', () => {
    it('should transition to half-open after timeout', async () => {
      const localBreaker = new CircuitBreaker('half-open-test-1', {
        failureThreshold: 3,
        successThreshold: 2,
        openDurationMs: 50,
        halfOpenMaxAttempts: 3,
      });

      localBreaker.recordFailure();
      localBreaker.recordFailure();
      localBreaker.recordFailure();

      expect(localBreaker.getState()).toBe('open');

      // Wait for open duration
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(localBreaker.getState()).toBe('half_open');
      expect(localBreaker.canExecute()).toBe(true);
    });

    it('should close after successes in half-open', async () => {
      const localBreaker = new CircuitBreaker('half-open-test-2', {
        failureThreshold: 3,
        successThreshold: 2,
        openDurationMs: 50,
        halfOpenMaxAttempts: 3,
      });

      localBreaker.recordFailure();
      localBreaker.recordFailure();
      localBreaker.recordFailure();

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(localBreaker.getState()).toBe('half_open');

      localBreaker.recordSuccess();
      localBreaker.recordSuccess();

      expect(localBreaker.getState()).toBe('closed');
    });

    it('should re-open on failure in half-open', async () => {
      const localBreaker = new CircuitBreaker('half-open-test-3', {
        failureThreshold: 3,
        successThreshold: 2,
        openDurationMs: 50,
        halfOpenMaxAttempts: 3,
      });

      localBreaker.recordFailure();
      localBreaker.recordFailure();
      localBreaker.recordFailure();

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(localBreaker.getState()).toBe('half_open');

      localBreaker.recordFailure();

      expect(localBreaker.getState()).toBe('open');
    });
  });

  describe('execute', () => {
    it('should execute when closed', async () => {
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should throw when open', async () => {
      breaker.forceOpen();

      await expect(breaker.execute(async () => 'success')).rejects.toThrow(
        "Circuit breaker 'test' is open"
      );
    });

    it('should record success on successful execution', async () => {
      breaker.recordFailure();
      await breaker.execute(async () => 'success');

      const stats = breaker.getStats();
      expect(stats.failures).toBe(0); // Reset after success
    });

    it('should record failure on failed execution', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.failures).toBe(1);
    });
  });

  describe('force methods', () => {
    it('forceOpen should open circuit', () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe('open');
      expect(breaker.canExecute()).toBe(false);
    });

    it('forceClose should close circuit', () => {
      breaker.forceOpen();
      breaker.forceClose();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.canExecute()).toBe(true);
    });

    it('reset should clear all state', () => {
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.reset();

      const stats = breaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.state).toBe('closed');
    });
  });
});

describe('PauseResumeManager (isolated)', () => {
  // Test without external dependencies
  it('should instantiate', () => {
    const manager = new PauseResumeManager();
    expect(manager).toBeDefined();
  });

  it('should have getStats method', () => {
    const manager = new PauseResumeManager();
    const stats = manager.getStats();
    expect(stats).toHaveProperty('pausable');
    expect(stats).toHaveProperty('resumable');
    expect(stats).toHaveProperty('paused');
    expect(stats).toHaveProperty('waitingExternal');
  });
});

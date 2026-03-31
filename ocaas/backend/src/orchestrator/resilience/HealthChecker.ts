/**
 * Health Checker
 *
 * Monitors system health: OCAAS, OpenClaw, connectivity
 */

import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import type { HealthStatus, ComponentHealth } from './types.js';

const logger = createLogger('HealthChecker');

// Health check interval: 30 seconds
const DEFAULT_CHECK_INTERVAL_MS = 30_000;

// Unhealthy threshold: 3 consecutive failures
const UNHEALTHY_THRESHOLD = 3;

export class HealthChecker {
  private componentHealth = new Map<string, ComponentHealth>();
  private healthChecks = new Map<string, () => Promise<boolean>>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private lastOverallStatus: HealthStatus = 'healthy';

  /**
   * Register a health check for a component
   */
  registerCheck(componentId: string, check: () => Promise<boolean>): void {
    this.healthChecks.set(componentId, check);
    this.componentHealth.set(componentId, {
      componentId,
      status: 'unknown',
      lastCheckAt: 0,
      consecutiveFailures: 0,
      lastError: null,
    });
    logger.debug({ componentId }, 'Health check registered');
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(componentId: string): boolean {
    this.healthChecks.delete(componentId);
    this.componentHealth.delete(componentId);
    return true;
  }

  /**
   * Run health check for a specific component
   */
  async checkComponent(componentId: string): Promise<ComponentHealth> {
    const check = this.healthChecks.get(componentId);
    const health = this.componentHealth.get(componentId);

    if (!check || !health) {
      return {
        componentId,
        status: 'unknown',
        lastCheckAt: 0,
        consecutiveFailures: 0,
        lastError: 'Component not registered',
      };
    }

    const now = nowTimestamp();

    try {
      const result = await check();

      if (result) {
        health.status = 'healthy';
        health.consecutiveFailures = 0;
        health.lastError = null;
      } else {
        health.consecutiveFailures++;
        health.lastError = 'Check returned false';
        health.status = health.consecutiveFailures >= UNHEALTHY_THRESHOLD ? 'unhealthy' : 'degraded';
      }
    } catch (err) {
      health.consecutiveFailures++;
      health.lastError = err instanceof Error ? err.message : String(err);
      health.status = health.consecutiveFailures >= UNHEALTHY_THRESHOLD ? 'unhealthy' : 'degraded';

      logger.warn({
        componentId,
        error: health.lastError,
        consecutiveFailures: health.consecutiveFailures,
      }, 'Health check failed');
    }

    health.lastCheckAt = now;
    return { ...health };
  }

  /**
   * Run all health checks
   */
  async checkAll(): Promise<Map<string, ComponentHealth>> {
    const results = new Map<string, ComponentHealth>();

    const checks = Array.from(this.healthChecks.keys()).map(async (componentId) => {
      const health = await this.checkComponent(componentId);
      results.set(componentId, health);
    });

    await Promise.all(checks);

    // Update overall status
    this.lastOverallStatus = this.calculateOverallStatus();

    return results;
  }

  /**
   * Get health of a specific component
   */
  getComponentHealth(componentId: string): ComponentHealth | null {
    return this.componentHealth.get(componentId) ?? null;
  }

  /**
   * Get all component health
   */
  getAllHealth(): ComponentHealth[] {
    return Array.from(this.componentHealth.values());
  }

  /**
   * Calculate overall system health status
   */
  calculateOverallStatus(): HealthStatus {
    const components = Array.from(this.componentHealth.values());

    if (components.length === 0) {
      return 'unknown';
    }

    const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;
    const unknownCount = components.filter(c => c.status === 'unknown').length;

    // All unknown
    if (unknownCount === components.length) {
      return 'unknown';
    }

    // Any unhealthy = unhealthy
    if (unhealthyCount > 0) {
      return 'unhealthy';
    }

    // Any degraded = degraded
    if (degradedCount > 0) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get overall status
   */
  getOverallStatus(): HealthStatus {
    return this.lastOverallStatus;
  }

  /**
   * Check if system is healthy enough to accept new tasks
   */
  isHealthyForExecution(): boolean {
    return this.lastOverallStatus === 'healthy' || this.lastOverallStatus === 'degraded';
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs: number = DEFAULT_CHECK_INTERVAL_MS): void {
    if (this.checkInterval) {
      this.stopPeriodicChecks();
    }

    logger.info({ intervalMs }, 'Starting periodic health checks');

    // Run immediately
    this.checkAll().catch(err => {
      logger.error({ err }, 'Initial health check failed');
    });

    // Then periodically
    this.checkInterval = setInterval(() => {
      this.checkAll().catch(err => {
        logger.error({ err }, 'Periodic health check failed');
      });
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped periodic health checks');
    }
  }

  /**
   * Get health summary
   */
  getSummary(): {
    overall: HealthStatus;
    components: Array<{
      componentId: string;
      status: HealthStatus;
      lastCheckAt: number;
      consecutiveFailures: number;
    }>;
    healthyCount: number;
    degradedCount: number;
    unhealthyCount: number;
  } {
    const components = this.getAllHealth();

    return {
      overall: this.lastOverallStatus,
      components: components.map(c => ({
        componentId: c.componentId,
        status: c.status,
        lastCheckAt: c.lastCheckAt,
        consecutiveFailures: c.consecutiveFailures,
      })),
      healthyCount: components.filter(c => c.status === 'healthy').length,
      degradedCount: components.filter(c => c.status === 'degraded').length,
      unhealthyCount: components.filter(c => c.status === 'unhealthy').length,
    };
  }

  /**
   * Force set component health (for testing/manual override)
   */
  setComponentHealth(componentId: string, status: HealthStatus, error?: string): void {
    const health = this.componentHealth.get(componentId);
    if (health) {
      health.status = status;
      health.lastError = error ?? null;
      health.lastCheckAt = nowTimestamp();
      if (status === 'healthy') {
        health.consecutiveFailures = 0;
      }
    }
    this.lastOverallStatus = this.calculateOverallStatus();
  }
}

// Singleton
let checkerInstance: HealthChecker | null = null;

export function getHealthChecker(): HealthChecker {
  if (!checkerInstance) {
    checkerInstance = new HealthChecker();
  }
  return checkerInstance;
}

/**
 * Register default health checks for OCAAS components
 */
export async function registerDefaultHealthChecks(checker: HealthChecker): Promise<void> {
  // OCAAS internal health (always healthy if running)
  checker.registerCheck('ocaas_core', async () => true);

  // Memory check
  checker.registerCheck('memory', async () => {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const ratio = heapUsedMB / heapTotalMB;
    // Healthy if using less than 90% of heap
    return ratio < 0.9;
  });

  // Event loop lag check (basic)
  checker.registerCheck('event_loop', async () => {
    return new Promise((resolve) => {
      const start = Date.now();
      setImmediate(() => {
        const lag = Date.now() - start;
        // Healthy if lag is under 100ms
        resolve(lag < 100);
      });
    });
  });

  logger.info('Default health checks registered');
}

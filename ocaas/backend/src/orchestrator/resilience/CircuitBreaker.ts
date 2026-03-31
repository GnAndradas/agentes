/**
 * Circuit Breaker
 *
 * Prevents cascading failures by blocking executions when system is unstable
 */

import { createLogger } from '../../utils/logger.js';
import type { CircuitState, CircuitBreakerConfig, CircuitBreakerStats } from './types.js';

// Use Date.now() for millisecond precision in circuit breaker timing
const now = () => Date.now();

const logger = createLogger('CircuitBreaker');

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  openDurationMs: 60_000,
  halfOpenMaxAttempts: 3,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureAt = 0;
  private lastStateChangeAt = 0;
  private openedAt = 0;
  private halfOpenAttempts = 0;
  private config: CircuitBreakerConfig;
  private name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastStateChangeAt = now();
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.checkAutoTransition();
    return this.state;
  }

  /**
   * Check if circuit allows execution
   */
  canExecute(): boolean {
    this.checkAutoTransition();

    switch (this.state) {
      case 'closed':
        return true;

      case 'open':
        return false;

      case 'half_open':
        // Allow limited attempts in half-open state
        return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;

      default:
        return false;
    }
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {

    switch (this.state) {
      case 'closed':
        // Reset failure count on success
        this.failures = 0;
        break;

      case 'half_open':
        this.successes++;
        this.halfOpenAttempts++;

        // If we've had enough successes, close the circuit
        if (this.successes >= this.config.successThreshold) {
          this.transitionTo('closed');
          logger.info({ name: this.name, successes: this.successes }, 'Circuit closed after recovery');
        }
        break;

      case 'open':
        // Shouldn't happen, but record it
        logger.warn({ name: this.name }, 'Success recorded while circuit is open');
        break;
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure(): void {
    this.lastFailureAt = now();

    switch (this.state) {
      case 'closed':
        this.failures++;

        if (this.failures >= this.config.failureThreshold) {
          this.transitionTo('open');
          logger.warn({
            name: this.name,
            failures: this.failures,
            threshold: this.config.failureThreshold,
          }, 'Circuit opened due to failures');
        }
        break;

      case 'half_open':
        // Failure in half-open immediately opens circuit
        this.halfOpenAttempts++;
        this.transitionTo('open');
        logger.warn({ name: this.name }, 'Circuit re-opened after half-open failure');
        break;

      case 'open':
        // Already open, just update failure time
        break;
    }
  }

  /**
   * Check for automatic state transitions
   */
  private checkAutoTransition(): void {
    if (this.state === 'open') {
      const elapsed = now() - this.openedAt;

      if (elapsed >= this.config.openDurationMs) {
        this.transitionTo('half_open');
        logger.info({
          name: this.name,
          openDurationMs: elapsed,
        }, 'Circuit transitioned to half-open');
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeAt = now();

    switch (newState) {
      case 'closed':
        this.failures = 0;
        this.successes = 0;
        this.halfOpenAttempts = 0;
        break;

      case 'open':
        this.openedAt = now();
        this.successes = 0;
        this.halfOpenAttempts = 0;
        break;

      case 'half_open':
        this.successes = 0;
        this.halfOpenAttempts = 0;
        break;
    }

    logger.debug({
      name: this.name,
      oldState,
      newState,
    }, 'Circuit state changed');
  }

  /**
   * Force circuit to open state
   */
  forceOpen(): void {
    this.transitionTo('open');
    logger.info({ name: this.name }, 'Circuit force opened');
  }

  /**
   * Force circuit to closed state
   */
  forceClose(): void {
    this.transitionTo('closed');
    logger.info({ name: this.name }, 'Circuit force closed');
  }

  /**
   * Reset circuit to initial state
   */
  reset(): void {
    this.transitionTo('closed');
    this.failures = 0;
    this.successes = 0;
    this.lastFailureAt = 0;
    this.halfOpenAttempts = 0;
    logger.info({ name: this.name }, 'Circuit reset');
  }

  /**
   * Get circuit statistics
   */
  getStats(): CircuitBreakerStats {
    this.checkAutoTransition();

    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      lastStateChangeAt: this.lastStateChangeAt,
      openedAt: this.state === 'open' ? this.openedAt : 0,
      halfOpenAttempts: this.halfOpenAttempts,
      config: { ...this.config },
    };
  }

  /**
   * Execute with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`Circuit breaker '${this.name}' is open`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }
}

// Registry for multiple circuit breakers
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);

  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    circuitBreakers.set(name, breaker);
  }

  return breaker;
}

/**
 * Get all circuit breakers
 */
export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return circuitBreakers;
}

/**
 * Get aggregate circuit breaker stats
 */
export function getCircuitBreakersSummary(): {
  total: number;
  closed: number;
  open: number;
  halfOpen: number;
  breakers: Array<{ name: string; state: CircuitState; failures: number }>;
} {
  const breakers = Array.from(circuitBreakers.entries());

  const summary = {
    total: breakers.length,
    closed: 0,
    open: 0,
    halfOpen: 0,
    breakers: [] as Array<{ name: string; state: CircuitState; failures: number }>,
  };

  for (const [name, breaker] of breakers) {
    const state = breaker.getState();
    const stats = breaker.getStats();

    summary.breakers.push({
      name,
      state,
      failures: stats.failures,
    });

    switch (state) {
      case 'closed':
        summary.closed++;
        break;
      case 'open':
        summary.open++;
        break;
      case 'half_open':
        summary.halfOpen++;
        break;
    }
  }

  return summary;
}

/**
 * Check if all circuit breakers allow execution
 */
export function allCircuitsHealthy(): boolean {
  for (const breaker of circuitBreakers.values()) {
    if (!breaker.canExecute()) {
      return false;
    }
  }
  return true;
}

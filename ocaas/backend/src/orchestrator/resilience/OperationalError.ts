/**
 * Operational Error
 *
 * Normalized error taxonomy for operational/runtime errors
 */

import type { OperationalErrorType, RecoveryStrategy } from './types.js';

export class OperationalError extends Error {
  readonly type: OperationalErrorType;
  readonly recoverable: boolean;
  readonly retryable: boolean;
  readonly suggestedStrategy: RecoveryStrategy;
  readonly originalError?: Error;
  readonly context?: Record<string, unknown>;

  constructor(
    type: OperationalErrorType,
    message: string,
    options?: {
      originalError?: Error;
      context?: Record<string, unknown>;
      recoverable?: boolean;
      retryable?: boolean;
      suggestedStrategy?: RecoveryStrategy;
    }
  ) {
    super(message);
    this.name = 'OperationalError';
    this.type = type;
    this.originalError = options?.originalError;
    this.context = options?.context;

    // Determine defaults based on error type
    const defaults = getErrorDefaults(type);
    this.recoverable = options?.recoverable ?? defaults.recoverable;
    this.retryable = options?.retryable ?? defaults.retryable;
    this.suggestedStrategy = options?.suggestedStrategy ?? defaults.suggestedStrategy;

    // Maintain prototype chain
    Object.setPrototypeOf(this, OperationalError.prototype);
  }

  /**
   * Create from unknown error
   */
  static from(error: unknown, context?: Record<string, unknown>): OperationalError {
    if (error instanceof OperationalError) {
      return error;
    }

    if (error instanceof Error) {
      const type = classifyError(error);
      return new OperationalError(type, error.message, {
        originalError: error,
        context,
      });
    }

    return new OperationalError(
      'unknown_runtime_error',
      String(error),
      { context }
    );
  }

  /**
   * Create specific error types
   */
  static gatewayUnavailable(message: string, originalError?: Error): OperationalError {
    return new OperationalError('gateway_unavailable', message, { originalError });
  }

  static connectionLost(message: string, originalError?: Error): OperationalError {
    return new OperationalError('connection_lost', message, { originalError });
  }

  static timeout(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('timeout', message, { context });
  }

  static tokenExhausted(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('token_exhausted', message, { context });
  }

  static contextOverflow(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('context_overflow', message, { context });
  }

  static rateLimit(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('rate_limit', message, { context });
  }

  static processCrashed(message: string, originalError?: Error): OperationalError {
    return new OperationalError('process_crashed', message, { originalError });
  }

  static orphanExecution(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('orphan_execution', message, { context });
  }

  static leaseExpired(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('lease_expired', message, { context });
  }

  static leaseConflict(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('lease_conflict', message, { context });
  }

  static checkpointCorrupted(message: string, context?: Record<string, unknown>): OperationalError {
    return new OperationalError('checkpoint_corrupted', message, { context });
  }

  static recoveryFailed(message: string, originalError?: Error): OperationalError {
    return new OperationalError('recovery_failed', message, { originalError });
  }

  /**
   * Convert to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      recoverable: this.recoverable,
      retryable: this.retryable,
      suggestedStrategy: this.suggestedStrategy,
      context: this.context,
      originalError: this.originalError?.message,
    };
  }
}

/**
 * Get default behavior for error type
 */
function getErrorDefaults(type: OperationalErrorType): {
  recoverable: boolean;
  retryable: boolean;
  suggestedStrategy: RecoveryStrategy;
} {
  switch (type) {
    case 'gateway_unavailable':
      return { recoverable: true, retryable: true, suggestedStrategy: 'retry_with_backoff' };

    case 'connection_lost':
      return { recoverable: true, retryable: true, suggestedStrategy: 'retry_with_backoff' };

    case 'timeout':
      return { recoverable: true, retryable: true, suggestedStrategy: 'retry_with_backoff' };

    case 'token_exhausted':
      return { recoverable: false, retryable: false, suggestedStrategy: 'escalate_to_human' };

    case 'context_overflow':
      return { recoverable: true, retryable: false, suggestedStrategy: 'checkpoint_and_resume' };

    case 'rate_limit':
      return { recoverable: true, retryable: true, suggestedStrategy: 'retry_with_backoff' };

    case 'process_crashed':
      return { recoverable: true, retryable: true, suggestedStrategy: 'restart_from_checkpoint' };

    case 'orphan_execution':
      return { recoverable: true, retryable: false, suggestedStrategy: 'restart_from_checkpoint' };

    case 'lease_expired':
      return { recoverable: true, retryable: false, suggestedStrategy: 'restart_from_checkpoint' };

    case 'lease_conflict':
      return { recoverable: false, retryable: false, suggestedStrategy: 'wait_for_resolution' };

    case 'checkpoint_corrupted':
      return { recoverable: false, retryable: false, suggestedStrategy: 'escalate_to_human' };

    case 'recovery_failed':
      return { recoverable: false, retryable: false, suggestedStrategy: 'escalate_to_human' };

    case 'unknown_runtime_error':
    default:
      return { recoverable: false, retryable: false, suggestedStrategy: 'escalate_to_human' };
  }
}

/**
 * Classify an unknown error into operational error type
 */
function classifyError(error: Error): OperationalErrorType {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Connection/Network errors
  if (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('socket hang up')
  ) {
    return 'connection_lost';
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    name.includes('timeout')
  ) {
    return 'timeout';
  }

  // Rate limit
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429')
  ) {
    return 'rate_limit';
  }

  // Token/Context errors
  if (
    message.includes('token') ||
    message.includes('context length') ||
    message.includes('max_tokens')
  ) {
    if (message.includes('context') || message.includes('length')) {
      return 'context_overflow';
    }
    return 'token_exhausted';
  }

  // Gateway errors
  if (
    message.includes('gateway') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  ) {
    return 'gateway_unavailable';
  }

  // Process errors
  if (
    message.includes('crash') ||
    message.includes('killed') ||
    message.includes('sigterm') ||
    message.includes('sigkill')
  ) {
    return 'process_crashed';
  }

  return 'unknown_runtime_error';
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof OperationalError) {
    return error.retryable;
  }
  const opError = OperationalError.from(error);
  return opError.retryable;
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof OperationalError) {
    return error.recoverable;
  }
  const opError = OperationalError.from(error);
  return opError.recoverable;
}

/**
 * Get suggested recovery strategy for error
 */
export function getRecoveryStrategy(error: unknown): RecoveryStrategy {
  if (error instanceof OperationalError) {
    return error.suggestedStrategy;
  }
  const opError = OperationalError.from(error);
  return opError.suggestedStrategy;
}

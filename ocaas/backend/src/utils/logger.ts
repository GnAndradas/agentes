/**
 * Production-grade Logging System
 *
 * Features:
 * - Structured JSON logging
 * - Context correlation (taskId, executionId, agentId)
 * - Child loggers with inherited context
 * - Domain-specific log streams (system, orchestrator, integration, audit)
 * - File output with daily rotation support
 */

import pino, { Logger as PinoLogger, DestinationStream, LoggerOptions } from 'pino';
import { config } from '../config/index.js';
import fs from 'fs';
import path from 'path';

// =============================================================================
// LOG CONTEXT TYPES
// =============================================================================

export interface LogContext {
  /** Service identifier */
  service?: string;
  /** Logger context/domain */
  context?: string;
  /** Component within a domain */
  component?: string;
  /** Task ID for correlation */
  taskId?: string;
  /** Execution ID for correlation */
  executionId?: string;
  /** Agent ID */
  agentId?: string;
  /** Resource type (skill, tool, agent) */
  resourceType?: string;
  /** Resource ID */
  resourceId?: string;
  /** Error type from taxonomy */
  errorType?: string;
  /** Event type from constants */
  eventType?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Allow additional properties for pino bindings */
  [key: string]: unknown;
}

export interface StructuredLogEntry extends LogContext {
  timestamp: string;
  level: string;
  message: string;
}

// =============================================================================
// LOG DIRECTORY SETUP
// =============================================================================

const LOG_DIR = path.join(process.cwd(), 'logs');

function ensureLogDirectory(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Silently fail in environments where we can't create directories
  }
}

// =============================================================================
// LOG FILE ROTATION
// =============================================================================

/**
 * Get date suffix for log rotation (YYYY-MM-DD)
 */
function getDateSuffix(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Get rotated log file path
 */
function getRotatedLogPath(basename: string): string {
  const suffix = getDateSuffix();
  const ext = path.extname(basename);
  const name = path.basename(basename, ext);
  return path.join(LOG_DIR, `${name}-${suffix}${ext}`);
}

// =============================================================================
// PINO CONFIGURATION
// =============================================================================

function createBaseOptions(): LoggerOptions {
  return {
    level: config.logging.level,
    base: {
      service: 'ocaas',
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Redact sensitive fields
    redact: {
      paths: [
        'password',
        'apiKey',
        'token',
        'secret',
        'authorization',
        'cookie',
        '*.password',
        '*.apiKey',
        '*.token',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  };
}

function createDevTransport(): LoggerOptions['transport'] {
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

// =============================================================================
// MULTI-STREAM SETUP FOR PRODUCTION
// =============================================================================

interface LogStream {
  level: string;
  stream: DestinationStream;
}

type DomainStreamKey = 'system' | 'orchestrator' | 'integration' | 'audit';

const domainStreams: Map<DomainStreamKey, DestinationStream> = new Map();

function createFileStream(filename: string, rotate: boolean = true): DestinationStream {
  ensureLogDirectory();
  const filepath = rotate ? getRotatedLogPath(filename) : path.join(LOG_DIR, filename);
  return pino.destination({
    dest: filepath,
    sync: false,
    mkdir: true,
  });
}

/**
 * Get or create a domain-specific file stream
 */
function getDomainStream(domain: DomainStreamKey): DestinationStream {
  let stream = domainStreams.get(domain);
  if (!stream) {
    stream = createFileStream(`${domain}.log`);
    domainStreams.set(domain, stream);
  }
  return stream;
}

function createProductionStreams(): LogStream[] {
  ensureLogDirectory();

  return [
    // Main system log (all levels, all domains)
    {
      level: 'trace',
      stream: createFileStream('combined.log'),
    },
    // Console output for production
    {
      level: config.logging.level,
      stream: process.stdout as unknown as DestinationStream,
    },
  ];
}

// =============================================================================
// LOGGER CREATION
// =============================================================================

let baseLogger: PinoLogger;

if (config.server.isDev) {
  // Development: pretty printing to console
  baseLogger = pino({
    ...createBaseOptions(),
    transport: createDevTransport(),
  });
} else {
  // Production: multi-stream with file output
  try {
    const streams = createProductionStreams();
    baseLogger = pino(
      createBaseOptions(),
      pino.multistream(streams)
    );
  } catch {
    // Fallback to console-only if file streams fail
    baseLogger = pino(createBaseOptions());
  }
}

export const logger = baseLogger;

// =============================================================================
// DOMAIN-SPECIFIC LOGGER FACTORY
// =============================================================================

/**
 * Create a logger that writes to both combined and domain-specific log files
 */
function createDomainLogger(domain: DomainStreamKey): PinoLogger {
  if (config.server.isDev) {
    // Development: just use base logger with context
    return logger.child({ context: domain });
  }

  // Production: multistream to combined + domain file
  try {
    const streams: LogStream[] = [
      // Combined log
      {
        level: 'trace',
        stream: createFileStream('combined.log'),
      },
      // Domain-specific log
      {
        level: 'trace',
        stream: getDomainStream(domain),
      },
      // Console
      {
        level: config.logging.level,
        stream: process.stdout as unknown as DestinationStream,
      },
    ];

    return pino(
      { ...createBaseOptions(), base: { service: 'ocaas', context: domain } },
      pino.multistream(streams)
    );
  } catch {
    return logger.child({ context: domain });
  }
}

// =============================================================================
// ENHANCED LOGGER WITH CONTEXT
// =============================================================================

/**
 * Enhanced logger interface with context helpers
 * Extends pino base logger functionality
 */
export interface EnhancedLogger {
  // Core pino methods
  trace: PinoLogger['trace'];
  debug: PinoLogger['debug'];
  info: PinoLogger['info'];
  warn: PinoLogger['warn'];
  error: PinoLogger['error'];
  fatal: PinoLogger['fatal'];
  level: string;

  /**
   * Create a child logger with additional context
   */
  child(bindings: LogContext): EnhancedLogger;

  /**
   * Log with task context
   */
  withTask(taskId: string): EnhancedLogger;

  /**
   * Log with execution context
   */
  withExecution(taskId: string, executionId: string): EnhancedLogger;

  /**
   * Log with agent context
   */
  withAgent(agentId: string): EnhancedLogger;

  /**
   * Log with resource context
   */
  withResource(resourceType: string, resourceId: string): EnhancedLogger;

  /**
   * Log with full correlation context
   */
  withContext(ctx: LogContext): EnhancedLogger;
}

function enhanceLogger(pinoLogger: PinoLogger): EnhancedLogger {
  const enhanced = pinoLogger as unknown as EnhancedLogger;

  (enhanced as { withTask: EnhancedLogger['withTask'] }).withTask = function (taskId: string): EnhancedLogger {
    return enhanceLogger((this as unknown as PinoLogger).child({ taskId }));
  };

  (enhanced as { withExecution: EnhancedLogger['withExecution'] }).withExecution = function (taskId: string, executionId: string): EnhancedLogger {
    return enhanceLogger((this as unknown as PinoLogger).child({ taskId, executionId }));
  };

  (enhanced as { withAgent: EnhancedLogger['withAgent'] }).withAgent = function (agentId: string): EnhancedLogger {
    return enhanceLogger((this as unknown as PinoLogger).child({ agentId }));
  };

  (enhanced as { withResource: EnhancedLogger['withResource'] }).withResource = function (resourceType: string, resourceId: string): EnhancedLogger {
    return enhanceLogger((this as unknown as PinoLogger).child({ resourceType, resourceId }));
  };

  (enhanced as { withContext: EnhancedLogger['withContext'] }).withContext = function (ctx: LogContext): EnhancedLogger {
    return enhanceLogger((this as unknown as PinoLogger).child(ctx));
  };

  // Wrap original child to return enhanced logger
  const originalChild = pinoLogger.child.bind(pinoLogger);
  (enhanced as { child: EnhancedLogger['child'] }).child = function (bindings: LogContext): EnhancedLogger {
    return enhanceLogger(originalChild(bindings));
  };

  return enhanced;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Create a domain-specific logger
 */
export function createLogger(context: string): EnhancedLogger {
  return enhanceLogger(logger.child({ context }));
}

/**
 * Create a logger with full context
 */
export function createContextLogger(ctx: LogContext): EnhancedLogger {
  return enhanceLogger(logger.child(ctx));
}

/**
 * Create a task-scoped logger
 */
export function createTaskLogger(
  context: string,
  taskId: string,
  executionId?: string
): EnhancedLogger {
  const bindings: LogContext = { context, taskId };
  if (executionId) {
    bindings.executionId = executionId;
  }
  return enhanceLogger(logger.child(bindings));
}

// =============================================================================
// DOMAIN-SPECIFIC LOGGERS
// =============================================================================

/** System-level logger - writes to system.log + combined.log */
export const systemLogger = enhanceLogger(createDomainLogger('system'));

/** Orchestrator logger - writes to orchestrator.log + combined.log */
export const orchestratorLogger = enhanceLogger(createDomainLogger('orchestrator'));

/** Integration logger (OpenClaw, external services) - writes to integration.log + combined.log */
export const integrationLogger = enhanceLogger(createDomainLogger('integration'));

/** Audit logger for security-relevant events - writes to audit.log + combined.log */
export const auditLogger = enhanceLogger(createDomainLogger('audit'));

// =============================================================================
// AUDIT LOG HELPERS
// =============================================================================

export interface AuditEvent {
  action: string;
  actor: 'user' | 'system' | 'agent';
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  outcome: 'success' | 'failure';
  reason?: string;
}

/**
 * Log an audit event
 */
export function logAuditEvent(event: AuditEvent): void {
  auditLogger.info({
    eventType: `audit.${event.action}`,
    actor: event.actor,
    actorId: event.actorId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    outcome: event.outcome,
    reason: event.reason,
    metadata: event.details,
  }, `Audit: ${event.action} by ${event.actor} - ${event.outcome}`);
}

// =============================================================================
// ERROR LOGGING HELPERS
// =============================================================================

export interface ErrorLogContext extends LogContext {
  errorType?: string;
  stack?: string;
  originalError?: string;
  recoverable?: boolean;
  suggestedAction?: string;
}

/**
 * Log an error with full context
 */
export function logError(
  log: EnhancedLogger,
  error: Error | unknown,
  context?: Partial<ErrorLogContext>
): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  log.error({
    errorType: context?.errorType ?? 'unknown',
    errorMessage: errorObj.message,
    stack: errorObj.stack,
    taskId: context?.taskId,
    executionId: context?.executionId,
    agentId: context?.agentId,
    resourceType: context?.resourceType,
    resourceId: context?.resourceId,
    recoverable: context?.recoverable,
    suggestedAction: context?.suggestedAction,
    metadata: context?.metadata,
  }, errorObj.message);
}

// =============================================================================
// LOG FLUSH & CLEANUP
// =============================================================================

/**
 * Flush all log streams (useful for graceful shutdown)
 */
export async function flushLogs(): Promise<void> {
  // Flush domain streams
  for (const stream of domainStreams.values()) {
    if ('flushSync' in stream && typeof stream.flushSync === 'function') {
      try {
        stream.flushSync();
      } catch {
        // Ignore flush errors
      }
    }
  }
}

/**
 * Close all log streams (for shutdown)
 */
export async function closeLogs(): Promise<void> {
  await flushLogs();
  domainStreams.clear();
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Logger = EnhancedLogger;

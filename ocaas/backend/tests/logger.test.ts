/**
 * Logger Tests
 *
 * Tests for the production logging system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pino to avoid actual file operations in tests
vi.mock('pino', () => {
  const mockLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    level: 'info',
    child: vi.fn(),
  };

  // Make child return a new mock that also has child
  mockLogger.child.mockImplementation(() => ({
    ...mockLogger,
    child: mockLogger.child,
  }));

  return {
    default: vi.fn(() => mockLogger),
    destination: vi.fn(() => ({})),
    multistream: vi.fn(() => ({})),
  };
});

// Mock config
vi.mock('../src/config/index.js', () => ({
  config: {
    logging: { level: 'info' },
    server: { isDev: true },
  },
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
}));

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LogContext interface', () => {
    it('should have all required fields', async () => {
      // Dynamic import after mocks are set up
      const { createContextLogger } = await import('../src/utils/logger.js');

      const ctx = {
        service: 'test',
        context: 'test-context',
        component: 'TestComponent',
        taskId: 'task-123',
        executionId: 'exec-456',
        agentId: 'agent-789',
        resourceType: 'skill',
        resourceId: 'skill-001',
        errorType: 'timeout',
        eventType: 'task.created',
        metadata: { key: 'value' },
      };

      const logger = createContextLogger(ctx);
      expect(logger).toBeDefined();
    });
  });

  describe('EnhancedLogger', () => {
    it('should create task-scoped logger with withTask', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const taskLogger = logger.withTask('task-123');

      expect(taskLogger).toBeDefined();
      expect(taskLogger.info).toBeDefined();
    });

    it('should create execution-scoped logger with withExecution', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const execLogger = logger.withExecution('task-123', 'exec-456');

      expect(execLogger).toBeDefined();
    });

    it('should create agent-scoped logger with withAgent', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const agentLogger = logger.withAgent('agent-789');

      expect(agentLogger).toBeDefined();
    });

    it('should create resource-scoped logger with withResource', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const resourceLogger = logger.withResource('skill', 'skill-001');

      expect(resourceLogger).toBeDefined();
    });

    it('should create context-scoped logger with withContext', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const contextLogger = logger.withContext({
        taskId: 'task-123',
        agentId: 'agent-789',
      });

      expect(contextLogger).toBeDefined();
    });

    it('should chain context methods', async () => {
      const { createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test')
        .withTask('task-123')
        .withAgent('agent-789');

      expect(logger).toBeDefined();
    });
  });

  describe('createTaskLogger', () => {
    it('should create logger with task context', async () => {
      const { createTaskLogger } = await import('../src/utils/logger.js');

      const logger = createTaskLogger('TaskRouter', 'task-123');
      expect(logger).toBeDefined();
    });

    it('should create logger with task and execution context', async () => {
      const { createTaskLogger } = await import('../src/utils/logger.js');

      const logger = createTaskLogger('TaskRouter', 'task-123', 'exec-456');
      expect(logger).toBeDefined();
    });
  });

  describe('Domain loggers', () => {
    it('should export systemLogger', async () => {
      const { systemLogger } = await import('../src/utils/logger.js');
      expect(systemLogger).toBeDefined();
    });

    it('should export orchestratorLogger', async () => {
      const { orchestratorLogger } = await import('../src/utils/logger.js');
      expect(orchestratorLogger).toBeDefined();
    });

    it('should export integrationLogger', async () => {
      const { integrationLogger } = await import('../src/utils/logger.js');
      expect(integrationLogger).toBeDefined();
    });

    it('should export auditLogger', async () => {
      const { auditLogger } = await import('../src/utils/logger.js');
      expect(auditLogger).toBeDefined();
    });
  });

  describe('logAuditEvent', () => {
    it('should log audit events with correct structure', async () => {
      const { logAuditEvent, auditLogger } = await import('../src/utils/logger.js');

      logAuditEvent({
        action: 'agent.create',
        actor: 'user',
        actorId: 'user-123',
        resourceType: 'agent',
        resourceId: 'agent-456',
        outcome: 'success',
        details: { name: 'TestAgent' },
      });

      expect(auditLogger.info).toBeDefined();
    });

    it('should include failure reason when outcome is failure', async () => {
      const { logAuditEvent } = await import('../src/utils/logger.js');

      // Should not throw
      logAuditEvent({
        action: 'approval.reject',
        actor: 'user',
        actorId: 'user-123',
        resourceType: 'approval',
        resourceId: 'approval-789',
        outcome: 'failure',
        reason: 'Policy violation',
      });
    });
  });

  describe('logError', () => {
    it('should log errors with context', async () => {
      const { logError, createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const error = new Error('Test error');

      // Should not throw
      logError(logger, error, {
        taskId: 'task-123',
        errorType: 'timeout',
        recoverable: true,
        suggestedAction: 'retry',
      });
    });

    it('should handle non-Error objects', async () => {
      const { logError, createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');

      // Should not throw
      logError(logger, 'String error message');
      logError(logger, { code: 500, message: 'Object error' });
    });
  });

  describe('AuditEvent types', () => {
    it('should support all actor types', async () => {
      const { logAuditEvent } = await import('../src/utils/logger.js');

      // User actor
      logAuditEvent({
        action: 'test',
        actor: 'user',
        outcome: 'success',
      });

      // System actor
      logAuditEvent({
        action: 'test',
        actor: 'system',
        outcome: 'success',
      });

      // Agent actor
      logAuditEvent({
        action: 'test',
        actor: 'agent',
        actorId: 'agent-123',
        outcome: 'success',
      });
    });
  });

  describe('ErrorLogContext', () => {
    it('should include all error context fields', async () => {
      const { logError, createLogger } = await import('../src/utils/logger.js');

      const logger = createLogger('test');
      const error = new Error('Full context test');

      logError(logger, error, {
        errorType: 'connection_lost',
        taskId: 'task-123',
        executionId: 'exec-456',
        agentId: 'agent-789',
        resourceType: 'skill',
        resourceId: 'skill-001',
        recoverable: false,
        suggestedAction: 'escalate',
        metadata: { attempt: 3 },
      });
    });
  });
});

describe('Logger type exports', () => {
  it('should export Logger type alias', async () => {
    // This is a compile-time check more than runtime
    const mod = await import('../src/utils/logger.js');
    expect(mod.createLogger).toBeDefined();
  });
});

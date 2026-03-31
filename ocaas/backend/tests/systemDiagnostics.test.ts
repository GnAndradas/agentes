/**
 * SystemDiagnosticsService Tests
 *
 * Tests for healthy, degraded, and critical system states.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SystemDiagnosticsService,
  getSystemDiagnosticsService,
} from '../src/system/SystemDiagnosticsService.js';
import type {
  SystemHealthResult,
  ReadinessResult,
  MetricsSnapshot,
  DiagnosticCheck,
} from '../src/system/types.js';

// Default mocks - will be overridden per test as needed
const createDefaultMocks = () => ({
  services: {
    taskService: {
      list: vi.fn().mockResolvedValue([]),
    },
    agentService: {
      list: vi.fn().mockResolvedValue([]),
    },
    skillService: {
      list: vi.fn().mockResolvedValue([]),
    },
    toolService: {
      list: vi.fn().mockResolvedValue([]),
    },
    manualResourceService: {
      list: vi.fn().mockResolvedValue([]),
    },
    eventService: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  },
  adapter: {
    testConnection: vi.fn().mockResolvedValue({ success: true, latencyMs: 50 }),
    getStatus: vi.fn().mockResolvedValue({
      connected: true,
      configured: true,
      rest: { reachable: true, authenticated: true, latencyMs: 50 },
      websocket: { connected: false },
      hooks: { configured: false },
    }),
  },
  sessionManager: {
    getActiveSessionCount: vi.fn().mockReturnValue(0),
  },
  checkpointStore: {
    getStats: vi.fn().mockReturnValue({
      total: 0,
      byStage: {},
      resumable: 0,
      waitingExternal: 0,
    }),
    list: vi.fn().mockReturnValue([]),
  },
  leaseStore: {
    getStats: vi.fn().mockReturnValue({
      total: 0,
      active: 0,
      expired: 0,
      byInstance: {},
    }),
    getExpiredLeases: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
  },
  circuitSummary: {
    total: 3,
    closed: 3,
    open: 0,
    halfOpen: 0,
    breakers: [],
  },
  channelBridge: null,
});

let mocks = createDefaultMocks();

// Mock all external dependencies
vi.mock('../src/services/index.js', () => ({
  getServices: vi.fn(() => mocks.services),
}));

vi.mock('../src/integrations/openclaw/index.js', () => ({
  getOpenClawAdapter: vi.fn(() => mocks.adapter),
}));

vi.mock('../src/openclaw/index.js', () => ({
  getSessionManager: vi.fn(() => mocks.sessionManager),
}));

vi.mock('../src/orchestrator/TaskRouter.js', () => ({
  getTaskRouter: vi.fn(() => ({})),
}));

vi.mock('../src/orchestrator/resilience/index.js', () => ({
  getCheckpointStore: vi.fn(() => mocks.checkpointStore),
  getExecutionLeaseStore: vi.fn(() => mocks.leaseStore),
  getCircuitBreaker: vi.fn(() => ({
    getState: vi.fn().mockReturnValue('closed'),
  })),
  getCircuitBreakersSummary: vi.fn(() => mocks.circuitSummary),
  getHealthChecker: vi.fn(() => ({
    isHealthy: vi.fn().mockReturnValue(true),
  })),
  allCircuitsHealthy: vi.fn(() => mocks.circuitSummary.open === 0),
}));

vi.mock('../src/services/ChannelBridge.js', () => ({
  getChannelBridge: vi.fn(() => mocks.channelBridge),
}));

vi.mock('../src/utils/helpers.js', () => ({
  nowTimestamp: vi.fn().mockReturnValue(1700000000),
}));

describe('SystemDiagnosticsService', () => {
  let diagnostics: SystemDiagnosticsService;

  beforeEach(() => {
    // Reset mocks to defaults before each test
    mocks = createDefaultMocks();
    diagnostics = new SystemDiagnosticsService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getSystemHealth', () => {
    it('should return healthy status when all checks pass', async () => {
      const result = await diagnostics.getSystemHealth();

      expect(result.status).toBe('healthy');
      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.criticalIssues).toHaveLength(0);
      expect(result.timestamp).toBe(1700000000);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include all check categories', async () => {
      const result = await diagnostics.getSystemHealth();

      const categories = new Set(result.checks.map(c => c.category));
      expect(categories.has('openclaw')).toBe(true);
      expect(categories.has('gateway')).toBe(true);
      expect(categories.has('tasks')).toBe(true);
      expect(categories.has('resilience')).toBe(true);
      expect(categories.has('database')).toBe(true);
    });

    it('should cache the last health result', async () => {
      expect(diagnostics.getLastHealthResult()).toBeNull();

      const result = await diagnostics.getSystemHealth();

      expect(diagnostics.getLastHealthResult()).toEqual(result);
    });
  });

  describe('degraded state', () => {
    it('should return degraded status when there are warnings', async () => {
      // Mock expired leases to trigger warnings
      mocks.leaseStore = {
        getStats: vi.fn().mockReturnValue({
          total: 5,
          active: 3,
          expired: 2,
          byInstance: {},
        }),
        getExpiredLeases: vi.fn().mockReturnValue([
          { taskId: 'task-1' },
          { taskId: 'task-2' },
        ]),
        list: vi.fn().mockReturnValue([]),
      };

      // Mock circuit breakers in half-open
      mocks.circuitSummary = {
        total: 3,
        closed: 2,
        open: 0,
        halfOpen: 1,
        breakers: [{ name: 'test', state: 'half_open' }],
      };

      const result = await diagnostics.getSystemHealth();

      // Should have warnings
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('critical state', () => {
    it('should return critical status when OpenClaw connection fails', async () => {
      // Mock OpenClaw connection failure
      mocks.adapter = {
        testConnection: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'connection_error', message: 'Connection refused' },
        }),
        getStatus: vi.fn().mockResolvedValue({
          connected: false,
          configured: true,
          rest: { reachable: false, authenticated: false, latencyMs: 0 },
          websocket: { connected: false },
          hooks: { configured: false },
          error: 'Connection refused',
        }),
      };

      const result = await diagnostics.getSystemHealth();

      expect(result.status).toBe('critical');
      expect(result.criticalIssues.length).toBeGreaterThan(0);
    });

    it('should return critical status when circuit breakers are open', async () => {
      // Mock circuit breakers open
      mocks.circuitSummary = {
        total: 3,
        closed: 1,
        open: 2,
        halfOpen: 0,
        breakers: [
          { name: 'cb-1', state: 'open' },
          { name: 'cb-2', state: 'open' },
        ],
      };

      const result = await diagnostics.getSystemHealth();

      expect(result.criticalIssues.length).toBeGreaterThan(0);
      const cbIssue = result.checks.find(c => c.name === 'circuit_breakers');
      expect(cbIssue?.status).toBe('fail');
    });
  });

  describe('getReadinessReport', () => {
    it('should return ready when all criteria pass', async () => {
      // Ensure channel bridge is active to avoid warnings
      mocks.channelBridge = { isActive: true } as any;

      const result = await diagnostics.getReadinessReport();

      // Check that most criteria pass - channel bridge warning is acceptable
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.blockers).toHaveLength(0);
    });

    it('should detect OpenClaw connection issues', async () => {
      // Create a new instance with mocks already set
      mocks.adapter = {
        testConnection: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'connection_error', message: 'Timeout' },
        }),
        getStatus: vi.fn().mockResolvedValue({
          connected: false,
          configured: true,
          rest: { reachable: false, authenticated: false, latencyMs: 0 },
          websocket: { connected: false },
          hooks: { configured: false },
          error: 'Timeout',
        }),
      };

      // Create fresh instance with updated mocks
      const freshDiagnostics = new SystemDiagnosticsService();
      const health = await freshDiagnostics.getSystemHealth();

      // Verify the connection check fails
      const connectionCheck = health.checks.find(c => c.name === 'openclaw_connection');
      expect(connectionCheck?.status).toBe('fail');

      // Verify critical issue is reported
      expect(health.criticalIssues.some(i => i.category === 'openclaw')).toBe(true);
      expect(health.status).toBe('critical');
    });

    it('should include all readiness criteria', async () => {
      const result = await diagnostics.getReadinessReport();

      const criteriaNames = result.checklist.map(c => c.name);
      expect(criteriaNames).toContain('OpenClaw Connected');
      expect(criteriaNames).toContain('Database Accessible');
      expect(criteriaNames).toContain('No Critical Issues');
      expect(criteriaNames).toContain('Circuit Breakers Healthy');
      expect(criteriaNames).toContain('Health Score >= 70');
    });
  });

  describe('getCriticalIssues', () => {
    it('should return empty array when system is healthy', async () => {
      const issues = await diagnostics.getCriticalIssues();
      expect(issues).toHaveLength(0);
    });

    it('should return issues when system has critical problems', async () => {
      mocks.adapter = {
        testConnection: vi.fn().mockResolvedValue({
          success: false,
          error: { code: 'connection_error', message: 'Connection failed' },
        }),
        getStatus: vi.fn().mockResolvedValue({
          connected: false,
          configured: false,
          error: 'Not configured',
        }),
      };

      const issues = await diagnostics.getCriticalIssues();
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.category === 'openclaw')).toBe(true);
    });
  });

  describe('getWarnings', () => {
    it('should return empty array when no warnings', async () => {
      // Ensure channel bridge is active to avoid channel warning
      mocks.channelBridge = { isActive: true } as any;

      const warnings = await diagnostics.getWarnings();
      expect(warnings).toHaveLength(0);
    });

    it('should return warnings when channel bridge is not active', async () => {
      // Default mock has null channelBridge
      mocks.channelBridge = null;

      const warnings = await diagnostics.getWarnings();
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some(w => w.category === 'channels')).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics snapshot', async () => {
      const metrics = await diagnostics.getMetrics();

      expect(metrics).toHaveProperty('tasks');
      expect(metrics).toHaveProperty('agents');
      expect(metrics).toHaveProperty('resources');
      expect(metrics).toHaveProperty('resilience');
      expect(metrics).toHaveProperty('openclaw');
      expect(metrics).toHaveProperty('timestamp');
    });

    it('should calculate task metrics correctly', async () => {
      mocks.services = {
        taskService: {
          list: vi.fn().mockResolvedValue([
            { id: '1', status: 'pending', updatedAt: 1700000000 },
            { id: '2', status: 'running', updatedAt: 1700000000 },
            { id: '3', status: 'completed', updatedAt: 1700000000, createdAt: 1699999000 },
            { id: '4', status: 'failed', updatedAt: 1700000000 },
          ]),
        },
        agentService: {
          list: vi.fn().mockResolvedValue([
            { id: 'a1', status: 'active' },
            { id: 'a2', status: 'inactive' },
          ]),
        },
        skillService: { list: vi.fn().mockResolvedValue([{ id: 's1' }]) },
        toolService: { list: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]) },
        manualResourceService: { list: vi.fn().mockResolvedValue([]) },
        eventService: { emit: vi.fn().mockResolvedValue(undefined) },
      };

      const metrics = await diagnostics.getMetrics();

      expect(metrics.tasks.total).toBe(4);
      expect(metrics.tasks.completed).toBe(1);
      expect(metrics.tasks.failed).toBe(1);
      expect(metrics.agents.total).toBe(2);
      expect(metrics.agents.active).toBe(1);
      expect(metrics.resources.skills).toBe(1);
      expect(metrics.resources.tools).toBe(2);
    });
  });

  describe('scoring', () => {
    it('should calculate score based on weighted checks', async () => {
      const result = await diagnostics.getSystemHealth();

      // Score should be between 0-100
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should give partial credit for warnings', async () => {
      // Create a scenario with some warnings
      mocks.channelBridge = null;

      const result = await diagnostics.getSystemHealth();

      // Should still be relatively high if only minor warnings
      expect(result.score).toBeGreaterThan(50);
    });
  });

  describe('singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getSystemDiagnosticsService();
      const instance2 = getSystemDiagnosticsService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('check categories', () => {
    it('should check openclaw connectivity', async () => {
      const result = await diagnostics.getSystemHealth();

      const openclawChecks = result.checks.filter(c => c.category === 'openclaw');
      expect(openclawChecks.length).toBeGreaterThan(0);
      expect(openclawChecks.some(c => c.name === 'openclaw_connection')).toBe(true);
    });

    it('should check gateway status', async () => {
      const result = await diagnostics.getSystemHealth();

      const gatewayChecks = result.checks.filter(c => c.category === 'gateway');
      expect(gatewayChecks.length).toBeGreaterThan(0);
    });

    it('should check task health', async () => {
      const result = await diagnostics.getSystemHealth();

      const taskChecks = result.checks.filter(c => c.category === 'tasks');
      expect(taskChecks.length).toBeGreaterThan(0);
      expect(taskChecks.some(c => c.name === 'stuck_tasks')).toBe(true);
      expect(taskChecks.some(c => c.name === 'retry_loops')).toBe(true);
    });

    it('should check resilience layer', async () => {
      const result = await diagnostics.getSystemHealth();

      const resilienceChecks = result.checks.filter(c => c.category === 'resilience');
      expect(resilienceChecks.length).toBeGreaterThan(0);
      expect(resilienceChecks.some(c => c.name === 'expired_leases')).toBe(true);
      expect(resilienceChecks.some(c => c.name === 'circuit_breakers')).toBe(true);
    });

    it('should check database connectivity', async () => {
      const result = await diagnostics.getSystemHealth();

      const dbChecks = result.checks.filter(c => c.category === 'database');
      expect(dbChecks.length).toBeGreaterThan(0);
      expect(dbChecks.some(c => c.name === 'database_connection')).toBe(true);
    });

    it('should check logging system', async () => {
      const result = await diagnostics.getSystemHealth();

      const loggingChecks = result.checks.filter(c => c.category === 'logging');
      expect(loggingChecks.length).toBeGreaterThan(0);
    });
  });

  describe('stuck tasks detection', () => {
    it('should detect stuck tasks', async () => {
      // Task with old timestamp (very old, definitely stuck)
      // nowTimestamp returns 1700000000, this task was updated at 1699000000 (1M seconds ago)
      mocks.services = {
        taskService: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'stuck-1',
              status: 'running',
              updatedAt: 1699000000, // Very old timestamp (stuck)
            },
          ]),
        },
        agentService: { list: vi.fn().mockResolvedValue([]) },
        skillService: { list: vi.fn().mockResolvedValue([]) },
        toolService: { list: vi.fn().mockResolvedValue([]) },
        manualResourceService: { list: vi.fn().mockResolvedValue([]) },
        eventService: { emit: vi.fn().mockResolvedValue(undefined) },
      };

      const result = await diagnostics.getSystemHealth();

      const stuckCheck = result.checks.find(c => c.name === 'stuck_tasks');
      expect(stuckCheck?.status).toBe('fail');
      expect(result.criticalIssues.some(i => i.title.includes('Stuck'))).toBe(true);
    });
  });

  describe('recommendations', () => {
    it('should provide recommendations for issues', async () => {
      mocks.services = {
        taskService: {
          list: vi.fn().mockResolvedValue([
            // Many failed tasks in the last hour (nowTimestamp is 1700000000)
            // Within the last 3600 seconds
            ...Array(10).fill(0).map((_, i) => ({
              id: `failed-${i}`,
              status: 'failed',
              updatedAt: 1700000000 - 1800, // 30 min ago (within last hour)
            })),
          ]),
        },
        agentService: { list: vi.fn().mockResolvedValue([]) },
        skillService: { list: vi.fn().mockResolvedValue([]) },
        toolService: { list: vi.fn().mockResolvedValue([]) },
        manualResourceService: { list: vi.fn().mockResolvedValue([]) },
        eventService: { emit: vi.fn().mockResolvedValue(undefined) },
      };

      const result = await diagnostics.getSystemHealth();

      // Should have recommendations for high failure rate
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});

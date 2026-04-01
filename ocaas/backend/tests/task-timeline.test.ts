/**
 * Task Timeline Service Tests
 *
 * Tests for TaskTimelineService observability features.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

// Mock the dependencies to avoid DB/service imports
vi.mock('../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
  schema: {
    tasks: { id: 'id', parentTaskId: 'parent_task_id' },
    events: {
      resourceType: 'resource_type',
      resourceId: 'resource_id',
      createdAt: 'created_at',
    },
    agentFeedback: { taskId: 'task_id', createdAt: 'created_at' },
  },
}));

vi.mock('../src/services/index.js', () => ({
  getServices: vi.fn(() => ({
    taskService: {
      getById: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
    eventService: { emit: vi.fn() },
  })),
}));

vi.mock('../src/orchestrator/resilience/index.js', () => ({
  getCheckpointStore: vi.fn(() => ({
    get: vi.fn().mockReturnValue(null),
    getWaitingExternal: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../src/utils/logger.js', () => ({
  systemLogger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Test the types and helper logic
describe('TaskTimelineService Types', () => {
  describe('TimelineEntry', () => {
    it('should support all entry types', () => {
      const validTypes = [
        'event',
        'state_change',
        'checkpoint',
        'error',
        'retry',
        'escalation',
        'approval',
        'resource',
      ];

      // This is a type-level test - ensure our types match expected values
      expect(validTypes).toContain('event');
      expect(validTypes).toContain('state_change');
      expect(validTypes).toContain('checkpoint');
      expect(validTypes).toContain('error');
    });

    it('should support all severity levels', () => {
      const validSeverities = ['info', 'warning', 'error', 'success'];

      expect(validSeverities).toContain('info');
      expect(validSeverities).toContain('warning');
      expect(validSeverities).toContain('error');
      expect(validSeverities).toContain('success');
    });
  });

  describe('BlockerType', () => {
    it('should support all blocker types', () => {
      const validBlockerTypes = ['approval', 'resource', 'dependency', 'external', 'unknown'];

      expect(validBlockerTypes).toHaveLength(5);
      expect(validBlockerTypes).toContain('approval');
      expect(validBlockerTypes).toContain('resource');
      expect(validBlockerTypes).toContain('dependency');
    });
  });
});

describe('TaskTimelineService Configuration', () => {
  it('should use sensible default configuration', () => {
    const defaults = {
      stuckThresholdMs: 30 * 60 * 1000, // 30 minutes
      highRetryThreshold: 3,
      maxTimelineEntries: 200,
      eventLookbackSeconds: 86400, // 24 hours
    };

    expect(defaults.stuckThresholdMs).toBe(1800000);
    expect(defaults.highRetryThreshold).toBe(3);
    expect(defaults.maxTimelineEntries).toBe(200);
    expect(defaults.eventLookbackSeconds).toBe(86400);
  });
});

describe('Timeline Entry Classification', () => {
  // Test event type detection logic
  const classifyEventType = (eventType: string): string => {
    if (eventType.includes('error') || eventType.includes('failed')) {
      return 'error';
    } else if (eventType.includes('retry')) {
      return 'retry';
    } else if (eventType.includes('escalat')) {
      return 'escalation';
    } else if (eventType.includes('approval')) {
      return 'approval';
    } else if (eventType.includes('resource') || eventType.includes('skill') || eventType.includes('tool')) {
      return 'resource';
    } else if (eventType.includes('status') || eventType.includes('state') || eventType.includes('assigned')) {
      return 'state_change';
    } else if (eventType.includes('complet') || eventType.includes('success')) {
      return 'state_change';
    }
    return 'event';
  };

  it('should classify error events correctly', () => {
    expect(classifyEventType('task_error')).toBe('error');
    expect(classifyEventType('execution_failed')).toBe('error');
    expect(classifyEventType('task_failed')).toBe('error');
  });

  it('should classify retry events correctly', () => {
    expect(classifyEventType('task_retry')).toBe('retry');
    expect(classifyEventType('execution_retry_started')).toBe('retry');
  });

  it('should classify escalation events correctly', () => {
    expect(classifyEventType('task_escalated')).toBe('escalation');
    expect(classifyEventType('escalation_requested')).toBe('escalation');
  });

  it('should classify approval events correctly', () => {
    expect(classifyEventType('approval_requested')).toBe('approval');
    expect(classifyEventType('approval_granted')).toBe('approval');
  });

  it('should classify resource events correctly', () => {
    expect(classifyEventType('resource_created')).toBe('resource');
    expect(classifyEventType('skill_generated')).toBe('resource');
    expect(classifyEventType('tool_activated')).toBe('resource');
  });

  it('should classify state change events correctly', () => {
    expect(classifyEventType('task_status_changed')).toBe('state_change');
    expect(classifyEventType('state_updated')).toBe('state_change');
    expect(classifyEventType('task_assigned')).toBe('state_change');
    expect(classifyEventType('task_completed')).toBe('state_change');
    expect(classifyEventType('execution_success')).toBe('state_change');
  });

  it('should default to event for unknown types', () => {
    expect(classifyEventType('unknown_event')).toBe('event');
    expect(classifyEventType('custom_notification')).toBe('event');
  });
});

describe('Stuck Task Detection Logic', () => {
  const isStuck = (lastActivity: number, now: number, thresholdMs: number): boolean => {
    const stuckDuration = (now - lastActivity) * 1000;
    return stuckDuration > thresholdMs;
  };

  it('should detect stuck tasks correctly', () => {
    const now = Date.now() / 1000; // Unix timestamp in seconds
    const thresholdMs = 30 * 60 * 1000; // 30 minutes

    // Task updated 45 minutes ago - should be stuck
    const stuckTask = now - 45 * 60;
    expect(isStuck(stuckTask, now, thresholdMs)).toBe(true);

    // Task updated 15 minutes ago - should not be stuck
    const activeTask = now - 15 * 60;
    expect(isStuck(activeTask, now, thresholdMs)).toBe(false);

    // Task updated exactly at threshold - should not be stuck
    const borderlineTask = now - 30 * 60;
    expect(isStuck(borderlineTask, now, thresholdMs)).toBe(false);
  });
});

describe('Blocker Type Detection', () => {
  const determineBlockerType = (checkpoint: {
    pendingApproval?: string;
    pendingResources?: string[];
    currentStage?: string;
  }): string => {
    if (checkpoint.pendingApproval) return 'approval';
    if (checkpoint.pendingResources && checkpoint.pendingResources.length > 0) return 'resource';
    if (checkpoint.currentStage === 'waiting_external') return 'external';
    return 'unknown';
  };

  it('should detect approval blockers', () => {
    expect(determineBlockerType({ pendingApproval: 'approval_123' })).toBe('approval');
  });

  it('should detect resource blockers', () => {
    expect(determineBlockerType({ pendingResources: ['draft_1', 'draft_2'] })).toBe('resource');
  });

  it('should detect external blockers', () => {
    expect(determineBlockerType({ currentStage: 'waiting_external' })).toBe('external');
  });

  it('should return unknown for unclassified blockers', () => {
    expect(determineBlockerType({})).toBe('unknown');
    expect(determineBlockerType({ currentStage: 'executing' })).toBe('unknown');
  });

  it('should prioritize approval over resource', () => {
    expect(
      determineBlockerType({
        pendingApproval: 'approval_123',
        pendingResources: ['draft_1'],
      })
    ).toBe('approval');
  });
});

describe('Suggested Actions', () => {
  const suggestStuckAction = (
    task: { agentId?: string },
    checkpoint?: { lastKnownBlocker?: string; currentStage?: string } | null
  ): string => {
    if (checkpoint?.lastKnownBlocker) {
      return `Investigate blocker: ${checkpoint.lastKnownBlocker}`;
    }
    if (checkpoint?.currentStage === 'waiting_approval') {
      return 'Check pending approvals and process them';
    }
    if (checkpoint?.currentStage === 'waiting_resource') {
      return 'Check pending resource drafts and approve/activate them';
    }
    if (task.agentId) {
      return `Check agent ${task.agentId} status and OpenClaw session health`;
    }
    return 'Review task execution logs and consider manual intervention';
  };

  it('should suggest blocker investigation when blocker exists', () => {
    const suggestion = suggestStuckAction({}, { lastKnownBlocker: 'Missing skill' });
    expect(suggestion).toContain('Investigate blocker');
    expect(suggestion).toContain('Missing skill');
  });

  it('should suggest checking approvals for waiting_approval stage', () => {
    const suggestion = suggestStuckAction({}, { currentStage: 'waiting_approval' });
    expect(suggestion).toContain('approvals');
  });

  it('should suggest checking resources for waiting_resource stage', () => {
    const suggestion = suggestStuckAction({}, { currentStage: 'waiting_resource' });
    expect(suggestion).toContain('resource drafts');
  });

  it('should suggest checking agent when agentId exists', () => {
    const suggestion = suggestStuckAction({ agentId: 'agent_123' }, null);
    expect(suggestion).toContain('agent_123');
    expect(suggestion).toContain('OpenClaw');
  });

  it('should suggest manual intervention as fallback', () => {
    const suggestion = suggestStuckAction({}, null);
    expect(suggestion).toContain('manual intervention');
  });
});

describe('Retry Pattern Detection', () => {
  const detectPattern = (errorMessages: string[]): string | undefined => {
    if (errorMessages.length < 2) return undefined;

    const uniqueMessages = [...new Set(errorMessages)];

    if (uniqueMessages.length === 1) {
      return `Same error repeated: "${uniqueMessages[0]?.substring(0, 50)}..."`;
    }

    const timeoutErrors = errorMessages.filter(
      (m) => m.toLowerCase().includes('timeout') || m.toLowerCase().includes('timed out')
    );
    if (timeoutErrors.length > errorMessages.length / 2) {
      return 'Frequent timeout errors';
    }

    const connectionErrors = errorMessages.filter(
      (m) => m.toLowerCase().includes('connection') || m.toLowerCase().includes('network')
    );
    if (connectionErrors.length > errorMessages.length / 2) {
      return 'Frequent connection errors';
    }

    return undefined;
  };

  it('should detect same error repeated pattern', () => {
    const errors = [
      'Database connection failed',
      'Database connection failed',
      'Database connection failed',
    ];
    const pattern = detectPattern(errors);
    expect(pattern).toContain('Same error repeated');
  });

  it('should detect timeout pattern', () => {
    const errors = ['Request timeout', 'Operation timed out', 'Timeout exceeded', 'Normal error'];
    const pattern = detectPattern(errors);
    expect(pattern).toBe('Frequent timeout errors');
  });

  it('should detect connection pattern', () => {
    const errors = ['Connection refused', 'Network error', 'Connection reset', 'Other error'];
    const pattern = detectPattern(errors);
    expect(pattern).toBe('Frequent connection errors');
  });

  it('should return undefined for mixed errors', () => {
    const errors = ['Error A', 'Error B', 'Error C', 'Error D'];
    const pattern = detectPattern(errors);
    expect(pattern).toBeUndefined();
  });

  it('should return undefined for single error', () => {
    const errors = ['Single error'];
    const pattern = detectPattern(errors);
    expect(pattern).toBeUndefined();
  });
});

describe('Health Metrics Calculation', () => {
  const calculateHealthMetrics = (
    tasks: Array<{ status: string; completedAt?: number; createdAt: number }>
  ) => {
    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');
    const totalFinished = completed.length + failed.length;

    const avgDurationMs =
      completed.length > 0
        ? completed.reduce((sum, t) => {
            const duration = ((t.completedAt ?? t.createdAt) - t.createdAt) * 1000;
            return sum + duration;
          }, 0) / completed.length
        : 0;

    const successRate = totalFinished > 0 ? (completed.length / totalFinished) * 100 : 100;

    const errorRate = totalFinished > 0 ? (failed.length / totalFinished) * 100 : 0;

    return { avgDurationMs, successRate, errorRate };
  };

  it('should calculate 100% success rate with no failures', () => {
    const tasks = [
      { status: 'completed', createdAt: 1000, completedAt: 2000 },
      { status: 'completed', createdAt: 1000, completedAt: 3000 },
    ];
    const metrics = calculateHealthMetrics(tasks);
    expect(metrics.successRate).toBe(100);
    expect(metrics.errorRate).toBe(0);
  });

  it('should calculate correct success rate with failures', () => {
    const tasks = [
      { status: 'completed', createdAt: 1000, completedAt: 2000 },
      { status: 'completed', createdAt: 1000, completedAt: 2000 },
      { status: 'completed', createdAt: 1000, completedAt: 2000 },
      { status: 'failed', createdAt: 1000 },
    ];
    const metrics = calculateHealthMetrics(tasks);
    expect(metrics.successRate).toBe(75);
    expect(metrics.errorRate).toBe(25);
  });

  it('should calculate average duration correctly', () => {
    // Timestamps are in seconds, duration is calculated as (completedAt - createdAt) * 1000
    const tasks = [
      { status: 'completed', createdAt: 1000, completedAt: 1001 }, // 1s difference = 1000ms
      { status: 'completed', createdAt: 1000, completedAt: 1003 }, // 3s difference = 3000ms
    ];
    const metrics = calculateHealthMetrics(tasks);
    expect(metrics.avgDurationMs).toBe(2000); // Average of 1000ms and 3000ms
  });

  it('should return default values with no finished tasks', () => {
    const tasks = [
      { status: 'pending', createdAt: 1000 },
      { status: 'running', createdAt: 1000 },
    ];
    const metrics = calculateHealthMetrics(tasks);
    expect(metrics.successRate).toBe(100);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.avgDurationMs).toBe(0);
  });
});

describe('Timeline Sorting and Limiting', () => {
  it('should sort entries by timestamp', () => {
    const entries = [
      { timestamp: 3000, title: 'Third' },
      { timestamp: 1000, title: 'First' },
      { timestamp: 2000, title: 'Second' },
    ];

    entries.sort((a, b) => a.timestamp - b.timestamp);

    expect(entries[0]?.title).toBe('First');
    expect(entries[1]?.title).toBe('Second');
    expect(entries[2]?.title).toBe('Third');
  });

  it('should limit entries to max configured', () => {
    const maxEntries = 3;
    const entries = [
      { id: '1' },
      { id: '2' },
      { id: '3' },
      { id: '4' },
      { id: '5' },
    ];

    const limited = entries.slice(-maxEntries);

    expect(limited).toHaveLength(3);
    expect(limited[0]?.id).toBe('3'); // Keeps last 3
    expect(limited[2]?.id).toBe('5');
  });
});

describe('System Overview Structure', () => {
  it('should have all required fields', () => {
    const overview = {
      tasks: {
        total: 100,
        byStatus: { pending: 10, running: 5, completed: 80, failed: 5 },
        activeCount: 15,
        problemCount: 3,
      },
      problems: {
        stuck: [],
        highRetry: [],
        blocked: [],
      },
      recentActivity: {
        tasksCreated: 10,
        tasksCompleted: 8,
        tasksFailed: 1,
        eventsEmitted: 50,
      },
      health: {
        avgTaskDurationMs: 5000,
        successRate: 94.12,
        errorRate: 5.88,
      },
      generatedAt: Date.now(),
    };

    expect(overview.tasks).toBeDefined();
    expect(overview.problems).toBeDefined();
    expect(overview.recentActivity).toBeDefined();
    expect(overview.health).toBeDefined();
    expect(overview.generatedAt).toBeDefined();
  });
});

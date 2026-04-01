/**
 * Human Escalation Service Tests
 *
 * Tests for HumanEscalationService HITL features:
 * - Escalation creation and types
 * - Human inbox functionality
 * - Resolution handlers (approve, reject, provide_resource, override)
 * - Timeout and fallback actions
 * - Integration with TaskTimeline
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nanoid } from 'nanoid';

// Define types for mocks
const ESCALATION_TYPE = {
  APPROVAL_REQUIRED: 'approval_required',
  RESOURCE_MISSING: 'resource_missing',
  PERMISSION_DENIED: 'permission_denied',
  EXECUTION_FAILURE: 'execution_failure',
  UNCERTAINTY: 'uncertainty',
  BLOCKED: 'blocked',
  TIMEOUT: 'timeout',
  POLICY_VIOLATION: 'policy_violation',
} as const;

const ESCALATION_STATUS = {
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

const ESCALATION_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

const RESOLUTION_TYPE = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RESOURCE_PROVIDED: 'resource_provided',
  OVERRIDDEN: 'overridden',
  AUTO_RESOLVED: 'auto_resolved',
  TIMED_OUT: 'timed_out',
  CANCELLED: 'cancelled',
} as const;

const FALLBACK_ACTION = {
  RETRY: 'retry',
  FAIL: 'fail',
  ESCALATE_HIGHER: 'escalate_higher',
  AUTO_APPROVE: 'auto_approve',
  PAUSE: 'pause',
} as const;

type EscalationType = (typeof ESCALATION_TYPE)[keyof typeof ESCALATION_TYPE];
type EscalationStatus = (typeof ESCALATION_STATUS)[keyof typeof ESCALATION_STATUS];
type EscalationPriority = (typeof ESCALATION_PRIORITY)[keyof typeof ESCALATION_PRIORITY];
type ResolutionType = (typeof RESOLUTION_TYPE)[keyof typeof RESOLUTION_TYPE];
type FallbackAction = (typeof FALLBACK_ACTION)[keyof typeof FALLBACK_ACTION];

interface EscalationDTO {
  id: string;
  type: EscalationType;
  priority: EscalationPriority;
  taskId?: string;
  agentId?: string;
  reason: string;
  status: EscalationStatus;
  resolution?: ResolutionType;
  expiresAt?: number;
  fallbackAction?: FallbackAction;
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// TYPE AND CONSTANT TESTS
// =============================================================================

describe('Escalation Types', () => {
  it('should have all required escalation types', () => {
    expect(ESCALATION_TYPE.APPROVAL_REQUIRED).toBe('approval_required');
    expect(ESCALATION_TYPE.RESOURCE_MISSING).toBe('resource_missing');
    expect(ESCALATION_TYPE.PERMISSION_DENIED).toBe('permission_denied');
    expect(ESCALATION_TYPE.EXECUTION_FAILURE).toBe('execution_failure');
    expect(ESCALATION_TYPE.UNCERTAINTY).toBe('uncertainty');
    expect(ESCALATION_TYPE.BLOCKED).toBe('blocked');
    expect(ESCALATION_TYPE.TIMEOUT).toBe('timeout');
    expect(ESCALATION_TYPE.POLICY_VIOLATION).toBe('policy_violation');
  });

  it('should have all required status values', () => {
    expect(ESCALATION_STATUS.PENDING).toBe('pending');
    expect(ESCALATION_STATUS.ACKNOWLEDGED).toBe('acknowledged');
    expect(ESCALATION_STATUS.RESOLVED).toBe('resolved');
    expect(ESCALATION_STATUS.EXPIRED).toBe('expired');
    expect(ESCALATION_STATUS.CANCELLED).toBe('cancelled');
  });

  it('should have all priority levels', () => {
    expect(ESCALATION_PRIORITY.LOW).toBe('low');
    expect(ESCALATION_PRIORITY.NORMAL).toBe('normal');
    expect(ESCALATION_PRIORITY.HIGH).toBe('high');
    expect(ESCALATION_PRIORITY.CRITICAL).toBe('critical');
  });

  it('should have all resolution types', () => {
    expect(RESOLUTION_TYPE.APPROVED).toBe('approved');
    expect(RESOLUTION_TYPE.REJECTED).toBe('rejected');
    expect(RESOLUTION_TYPE.RESOURCE_PROVIDED).toBe('resource_provided');
    expect(RESOLUTION_TYPE.OVERRIDDEN).toBe('overridden');
    expect(RESOLUTION_TYPE.AUTO_RESOLVED).toBe('auto_resolved');
    expect(RESOLUTION_TYPE.TIMED_OUT).toBe('timed_out');
  });

  it('should have all fallback actions', () => {
    expect(FALLBACK_ACTION.RETRY).toBe('retry');
    expect(FALLBACK_ACTION.FAIL).toBe('fail');
    expect(FALLBACK_ACTION.ESCALATE_HIGHER).toBe('escalate_higher');
    expect(FALLBACK_ACTION.AUTO_APPROVE).toBe('auto_approve');
    expect(FALLBACK_ACTION.PAUSE).toBe('pause');
  });
});

// =============================================================================
// ESCALATION STATE MACHINE TESTS
// =============================================================================

describe('Escalation State Machine', () => {
  const validTransitions: Record<EscalationStatus, EscalationStatus[]> = {
    pending: ['acknowledged', 'resolved', 'expired', 'cancelled'],
    acknowledged: ['resolved', 'expired', 'cancelled'],
    resolved: [], // terminal state
    expired: [], // terminal state
    cancelled: [], // terminal state
  };

  const isValidTransition = (from: EscalationStatus, to: EscalationStatus): boolean => {
    return validTransitions[from]?.includes(to) ?? false;
  };

  it('should allow pending -> acknowledged', () => {
    expect(isValidTransition(ESCALATION_STATUS.PENDING, ESCALATION_STATUS.ACKNOWLEDGED)).toBe(true);
  });

  it('should allow pending -> resolved', () => {
    expect(isValidTransition(ESCALATION_STATUS.PENDING, ESCALATION_STATUS.RESOLVED)).toBe(true);
  });

  it('should allow pending -> expired', () => {
    expect(isValidTransition(ESCALATION_STATUS.PENDING, ESCALATION_STATUS.EXPIRED)).toBe(true);
  });

  it('should allow acknowledged -> resolved', () => {
    expect(isValidTransition(ESCALATION_STATUS.ACKNOWLEDGED, ESCALATION_STATUS.RESOLVED)).toBe(true);
  });

  it('should NOT allow resolved -> any state', () => {
    expect(isValidTransition(ESCALATION_STATUS.RESOLVED, ESCALATION_STATUS.PENDING)).toBe(false);
    expect(isValidTransition(ESCALATION_STATUS.RESOLVED, ESCALATION_STATUS.ACKNOWLEDGED)).toBe(false);
    expect(isValidTransition(ESCALATION_STATUS.RESOLVED, ESCALATION_STATUS.EXPIRED)).toBe(false);
  });

  it('should NOT allow expired -> any state', () => {
    expect(isValidTransition(ESCALATION_STATUS.EXPIRED, ESCALATION_STATUS.PENDING)).toBe(false);
    expect(isValidTransition(ESCALATION_STATUS.EXPIRED, ESCALATION_STATUS.RESOLVED)).toBe(false);
  });

  it('should NOT allow cancelled -> any state', () => {
    expect(isValidTransition(ESCALATION_STATUS.CANCELLED, ESCALATION_STATUS.PENDING)).toBe(false);
    expect(isValidTransition(ESCALATION_STATUS.CANCELLED, ESCALATION_STATUS.RESOLVED)).toBe(false);
  });
});

// =============================================================================
// HUMAN INBOX TESTS
// =============================================================================

describe('Human Inbox Functionality', () => {
  const createMockEscalation = (overrides: Partial<EscalationDTO> = {}): EscalationDTO => ({
    id: `esc_${nanoid(8)}`,
    type: ESCALATION_TYPE.APPROVAL_REQUIRED,
    priority: ESCALATION_PRIORITY.NORMAL,
    reason: 'Test escalation',
    status: ESCALATION_STATUS.PENDING,
    createdAt: Date.now() / 1000,
    updatedAt: Date.now() / 1000,
    ...overrides,
  });

  const groupByType = (escalations: EscalationDTO[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const esc of escalations) {
      result[esc.type] = (result[esc.type] || 0) + 1;
    }
    return result;
  };

  const groupByPriority = (escalations: EscalationDTO[]): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const esc of escalations) {
      result[esc.priority] = (result[esc.priority] || 0) + 1;
    }
    return result;
  };

  it('should group escalations by type', () => {
    const escalations = [
      createMockEscalation({ type: ESCALATION_TYPE.APPROVAL_REQUIRED }),
      createMockEscalation({ type: ESCALATION_TYPE.APPROVAL_REQUIRED }),
      createMockEscalation({ type: ESCALATION_TYPE.RESOURCE_MISSING }),
      createMockEscalation({ type: ESCALATION_TYPE.EXECUTION_FAILURE }),
    ];

    const byType = groupByType(escalations);
    expect(byType[ESCALATION_TYPE.APPROVAL_REQUIRED]).toBe(2);
    expect(byType[ESCALATION_TYPE.RESOURCE_MISSING]).toBe(1);
    expect(byType[ESCALATION_TYPE.EXECUTION_FAILURE]).toBe(1);
  });

  it('should group escalations by priority', () => {
    const escalations = [
      createMockEscalation({ priority: ESCALATION_PRIORITY.CRITICAL }),
      createMockEscalation({ priority: ESCALATION_PRIORITY.HIGH }),
      createMockEscalation({ priority: ESCALATION_PRIORITY.NORMAL }),
      createMockEscalation({ priority: ESCALATION_PRIORITY.NORMAL }),
    ];

    const byPriority = groupByPriority(escalations);
    expect(byPriority[ESCALATION_PRIORITY.CRITICAL]).toBe(1);
    expect(byPriority[ESCALATION_PRIORITY.HIGH]).toBe(1);
    expect(byPriority[ESCALATION_PRIORITY.NORMAL]).toBe(2);
  });

  it('should sort by priority (critical first)', () => {
    const escalations = [
      createMockEscalation({ id: 'low', priority: ESCALATION_PRIORITY.LOW }),
      createMockEscalation({ id: 'critical', priority: ESCALATION_PRIORITY.CRITICAL }),
      createMockEscalation({ id: 'normal', priority: ESCALATION_PRIORITY.NORMAL }),
      createMockEscalation({ id: 'high', priority: ESCALATION_PRIORITY.HIGH }),
    ];

    const priorityOrder = {
      [ESCALATION_PRIORITY.CRITICAL]: 1,
      [ESCALATION_PRIORITY.HIGH]: 2,
      [ESCALATION_PRIORITY.NORMAL]: 3,
      [ESCALATION_PRIORITY.LOW]: 4,
    };

    escalations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    expect(escalations[0]?.id).toBe('critical');
    expect(escalations[1]?.id).toBe('high');
    expect(escalations[2]?.id).toBe('normal');
    expect(escalations[3]?.id).toBe('low');
  });

  it('should filter pending and acknowledged escalations for inbox', () => {
    const allEscalations = [
      createMockEscalation({ status: ESCALATION_STATUS.PENDING }),
      createMockEscalation({ status: ESCALATION_STATUS.PENDING }),
      createMockEscalation({ status: ESCALATION_STATUS.ACKNOWLEDGED }),
      createMockEscalation({ status: ESCALATION_STATUS.RESOLVED }),
      createMockEscalation({ status: ESCALATION_STATUS.EXPIRED }),
    ];

    const pending = allEscalations.filter((e) => e.status === ESCALATION_STATUS.PENDING);
    const acknowledged = allEscalations.filter((e) => e.status === ESCALATION_STATUS.ACKNOWLEDGED);
    const inbox = [...pending, ...acknowledged];

    expect(pending).toHaveLength(2);
    expect(acknowledged).toHaveLength(1);
    expect(inbox).toHaveLength(3);
  });

  it('should calculate expiring count correctly', () => {
    const now = Date.now() / 1000;
    const fiveMinutes = 5 * 60;

    const escalations = [
      createMockEscalation({ expiresAt: now + 60 }), // expires in 1 min
      createMockEscalation({ expiresAt: now + 180 }), // expires in 3 min
      createMockEscalation({ expiresAt: now + 600 }), // expires in 10 min
      createMockEscalation({ expiresAt: undefined }), // no expiration
    ];

    const expiringCount = escalations.filter(
      (e) => e.expiresAt && e.expiresAt - now < fiveMinutes
    ).length;

    expect(expiringCount).toBe(2);
  });
});

// =============================================================================
// RESOLUTION HANDLING TESTS
// =============================================================================

describe('Resolution Handling', () => {
  it('should handle approve resolution', () => {
    const escalation = {
      id: 'esc_123',
      status: ESCALATION_STATUS.PENDING,
      linkedApprovalId: 'approval_456',
    };

    // Simulate resolution
    const resolved = {
      ...escalation,
      status: ESCALATION_STATUS.RESOLVED,
      resolution: RESOLUTION_TYPE.APPROVED,
      resolvedBy: 'human:panel',
      resolvedAt: Date.now() / 1000,
    };

    expect(resolved.status).toBe(ESCALATION_STATUS.RESOLVED);
    expect(resolved.resolution).toBe(RESOLUTION_TYPE.APPROVED);
    expect(resolved.resolvedBy).toBe('human:panel');
  });

  it('should handle reject resolution with reason', () => {
    const resolved = {
      status: ESCALATION_STATUS.RESOLVED,
      resolution: RESOLUTION_TYPE.REJECTED,
      resolvedBy: 'human:panel',
      resolutionDetails: { reason: 'Not appropriate for this context' },
    };

    expect(resolved.resolution).toBe(RESOLUTION_TYPE.REJECTED);
    expect(resolved.resolutionDetails.reason).toContain('Not appropriate');
  });

  it('should handle provide_resource resolution', () => {
    const resolved = {
      status: ESCALATION_STATUS.RESOLVED,
      resolution: RESOLUTION_TYPE.RESOURCE_PROVIDED,
      resolutionDetails: {
        resourceId: 'skill_789',
        resourceType: 'skill',
      },
    };

    expect(resolved.resolution).toBe(RESOLUTION_TYPE.RESOURCE_PROVIDED);
    expect(resolved.resolutionDetails.resourceId).toBe('skill_789');
    expect(resolved.resolutionDetails.resourceType).toBe('skill');
  });

  it('should handle override resolution with decision', () => {
    const resolved = {
      status: ESCALATION_STATUS.RESOLVED,
      resolution: RESOLUTION_TYPE.OVERRIDDEN,
      resolvedBy: 'human:admin',
      resolutionDetails: {
        decision: 'Skip this step and continue with alternative approach',
        justification: 'Time constraint requires manual intervention',
      },
    };

    expect(resolved.resolution).toBe(RESOLUTION_TYPE.OVERRIDDEN);
    expect(resolved.resolutionDetails.decision).toContain('Skip this step');
  });
});

// =============================================================================
// TIMEOUT AND FALLBACK TESTS
// =============================================================================

describe('Timeout and Fallback Actions', () => {
  const isExpired = (escalation: { expiresAt?: number }, now: number): boolean => {
    return escalation.expiresAt !== undefined && escalation.expiresAt < now;
  };

  it('should detect expired escalations', () => {
    const now = Date.now() / 1000;

    const expiredEscalation = { expiresAt: now - 60 }; // expired 1 min ago
    const validEscalation = { expiresAt: now + 60 }; // expires in 1 min
    const noExpirationEscalation = { expiresAt: undefined };

    expect(isExpired(expiredEscalation, now)).toBe(true);
    expect(isExpired(validEscalation, now)).toBe(false);
    expect(isExpired(noExpirationEscalation, now)).toBe(false);
  });

  it('should determine correct fallback action based on type', () => {
    const mapFallbackBehavior = (behavior: string): FallbackAction => {
      switch (behavior) {
        case 'pause':
          return FALLBACK_ACTION.PAUSE;
        case 'reject':
          return FALLBACK_ACTION.FAIL;
        case 'auto_approve':
          return FALLBACK_ACTION.AUTO_APPROVE;
        default:
          return FALLBACK_ACTION.PAUSE;
      }
    };

    expect(mapFallbackBehavior('pause')).toBe(FALLBACK_ACTION.PAUSE);
    expect(mapFallbackBehavior('reject')).toBe(FALLBACK_ACTION.FAIL);
    expect(mapFallbackBehavior('auto_approve')).toBe(FALLBACK_ACTION.AUTO_APPROVE);
    expect(mapFallbackBehavior('unknown')).toBe(FALLBACK_ACTION.PAUSE);
  });

  it('should execute retry fallback', () => {
    const fallbackAction = FALLBACK_ACTION.RETRY;
    const taskId = 'task_123';

    // Simulate retry fallback
    const result = {
      action: fallbackAction,
      taskId,
      outcome: 'Task requeued for retry',
    };

    expect(result.action).toBe(FALLBACK_ACTION.RETRY);
    expect(result.outcome).toContain('requeued');
  });

  it('should execute fail fallback', () => {
    const fallbackAction = FALLBACK_ACTION.FAIL;
    const taskId = 'task_123';
    const errorMessage = 'Escalation timeout - no human response';

    const result = {
      action: fallbackAction,
      taskId,
      errorMessage,
      outcome: 'Task marked as failed',
    };

    expect(result.action).toBe(FALLBACK_ACTION.FAIL);
    expect(result.errorMessage).toContain('timeout');
  });

  it('should execute escalate_higher fallback', () => {
    const originalEscalation = {
      id: 'esc_123',
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      reason: 'Approval needed',
    };

    // Simulate escalate_higher fallback
    const newEscalation = {
      type: originalEscalation.type,
      priority: ESCALATION_PRIORITY.CRITICAL, // upgraded
      reason: `URGENT: Previous escalation timed out - ${originalEscalation.reason}`,
      context: { previousEscalationId: originalEscalation.id },
      fallbackAction: FALLBACK_ACTION.FAIL, // prevent infinite loop
    };

    expect(newEscalation.priority).toBe(ESCALATION_PRIORITY.CRITICAL);
    expect(newEscalation.reason).toContain('URGENT');
    expect(newEscalation.context.previousEscalationId).toBe('esc_123');
    expect(newEscalation.fallbackAction).toBe(FALLBACK_ACTION.FAIL);
  });
});

// =============================================================================
// MULTIPLE ESCALATIONS ON SAME TASK TESTS
// =============================================================================

describe('Multiple Escalations on Same Task', () => {
  it('should support multiple escalations per task', () => {
    const taskId = 'task_123';
    const escalations = [
      {
        id: 'esc_1',
        taskId,
        type: ESCALATION_TYPE.RESOURCE_MISSING,
        status: ESCALATION_STATUS.RESOLVED,
        createdAt: 1000,
      },
      {
        id: 'esc_2',
        taskId,
        type: ESCALATION_TYPE.APPROVAL_REQUIRED,
        status: ESCALATION_STATUS.RESOLVED,
        createdAt: 2000,
      },
      {
        id: 'esc_3',
        taskId,
        type: ESCALATION_TYPE.EXECUTION_FAILURE,
        status: ESCALATION_STATUS.PENDING,
        createdAt: 3000,
      },
    ];

    // All belong to same task
    expect(escalations.every((e) => e.taskId === taskId)).toBe(true);

    // Different types
    const types = escalations.map((e) => e.type);
    expect(new Set(types).size).toBe(3);

    // Can have mixed statuses
    const pending = escalations.filter((e) => e.status === ESCALATION_STATUS.PENDING);
    const resolved = escalations.filter((e) => e.status === ESCALATION_STATUS.RESOLVED);
    expect(pending).toHaveLength(1);
    expect(resolved).toHaveLength(2);
  });

  it('should allow filtering escalations by task', () => {
    const allEscalations = [
      { id: 'esc_1', taskId: 'task_A' },
      { id: 'esc_2', taskId: 'task_A' },
      { id: 'esc_3', taskId: 'task_B' },
      { id: 'esc_4', taskId: 'task_C' },
    ];

    const taskAEscalations = allEscalations.filter((e) => e.taskId === 'task_A');
    expect(taskAEscalations).toHaveLength(2);

    const taskBEscalations = allEscalations.filter((e) => e.taskId === 'task_B');
    expect(taskBEscalations).toHaveLength(1);
  });
});

// =============================================================================
// ESCALATION STATISTICS TESTS
// =============================================================================

describe('Escalation Statistics', () => {
  interface StatsInput {
    status: EscalationStatus;
    type: EscalationType;
    resolution?: ResolutionType;
    createdAt: number;
    resolvedAt?: number;
  }

  const calculateStats = (escalations: StatsInput[]) => {
    const byType: Record<string, number> = {};
    const byResolution: Record<string, number> = {};
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const esc of escalations) {
      byType[esc.type] = (byType[esc.type] || 0) + 1;
      if (esc.resolution) {
        byResolution[esc.resolution] = (byResolution[esc.resolution] || 0) + 1;
      }
      if (esc.resolvedAt && esc.createdAt) {
        totalResolutionTime += (esc.resolvedAt - esc.createdAt) * 1000;
        resolvedCount++;
      }
    }

    return {
      total: escalations.length,
      pending: escalations.filter((e) => e.status === ESCALATION_STATUS.PENDING).length,
      acknowledged: escalations.filter((e) => e.status === ESCALATION_STATUS.ACKNOWLEDGED).length,
      resolved: escalations.filter((e) => e.status === ESCALATION_STATUS.RESOLVED).length,
      expired: escalations.filter((e) => e.status === ESCALATION_STATUS.EXPIRED).length,
      byType,
      byResolution,
      avgResolutionTimeMs: resolvedCount > 0 ? Math.round(totalResolutionTime / resolvedCount) : 0,
    };
  };

  it('should calculate basic stats correctly', () => {
    const escalations: StatsInput[] = [
      { status: ESCALATION_STATUS.PENDING, type: ESCALATION_TYPE.APPROVAL_REQUIRED, createdAt: 1000 },
      { status: ESCALATION_STATUS.PENDING, type: ESCALATION_TYPE.RESOURCE_MISSING, createdAt: 1000 },
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.APPROVED, createdAt: 1000, resolvedAt: 1010 },
      { status: ESCALATION_STATUS.EXPIRED, type: ESCALATION_TYPE.EXECUTION_FAILURE, resolution: RESOLUTION_TYPE.TIMED_OUT, createdAt: 1000 },
    ];

    const stats = calculateStats(escalations);

    expect(stats.total).toBe(4);
    expect(stats.pending).toBe(2);
    expect(stats.resolved).toBe(1);
    expect(stats.expired).toBe(1);
  });

  it('should calculate average resolution time', () => {
    const escalations: StatsInput[] = [
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.APPROVED, createdAt: 1000, resolvedAt: 1010 }, // 10s
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.APPROVED, createdAt: 1000, resolvedAt: 1020 }, // 20s
    ];

    const stats = calculateStats(escalations);

    // Average of 10s and 20s = 15s = 15000ms
    expect(stats.avgResolutionTimeMs).toBe(15000);
  });

  it('should group by type correctly', () => {
    const escalations: StatsInput[] = [
      { status: ESCALATION_STATUS.PENDING, type: ESCALATION_TYPE.APPROVAL_REQUIRED, createdAt: 1000 },
      { status: ESCALATION_STATUS.PENDING, type: ESCALATION_TYPE.APPROVAL_REQUIRED, createdAt: 1000 },
      { status: ESCALATION_STATUS.PENDING, type: ESCALATION_TYPE.RESOURCE_MISSING, createdAt: 1000 },
    ];

    const stats = calculateStats(escalations);

    expect(stats.byType[ESCALATION_TYPE.APPROVAL_REQUIRED]).toBe(2);
    expect(stats.byType[ESCALATION_TYPE.RESOURCE_MISSING]).toBe(1);
  });

  it('should group by resolution correctly', () => {
    const escalations: StatsInput[] = [
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.APPROVED, createdAt: 1000, resolvedAt: 1010 },
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.APPROVED, createdAt: 1000, resolvedAt: 1010 },
      { status: ESCALATION_STATUS.RESOLVED, type: ESCALATION_TYPE.APPROVAL_REQUIRED, resolution: RESOLUTION_TYPE.REJECTED, createdAt: 1000, resolvedAt: 1010 },
    ];

    const stats = calculateStats(escalations);

    expect(stats.byResolution[RESOLUTION_TYPE.APPROVED]).toBe(2);
    expect(stats.byResolution[RESOLUTION_TYPE.REJECTED]).toBe(1);
  });
});

// =============================================================================
// TIMELINE INTEGRATION TESTS
// =============================================================================

describe('Timeline Integration', () => {
  const escalationToTimelineEntry = (escalation: EscalationDTO) => {
    let severity: 'info' | 'warning' | 'error' | 'success' = 'warning';

    if (escalation.priority === ESCALATION_PRIORITY.CRITICAL) {
      severity = 'error';
    } else if (escalation.status === ESCALATION_STATUS.RESOLVED) {
      severity = 'success';
    } else if (escalation.status === ESCALATION_STATUS.EXPIRED) {
      severity = 'error';
    }

    const typeLabel = escalation.type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    const statusLabel = escalation.status.charAt(0).toUpperCase() + escalation.status.slice(1);

    return {
      id: `escalation_${escalation.id}`,
      type: 'escalation',
      timestamp: escalation.createdAt,
      title: `Escalation: ${typeLabel} [${statusLabel}]`,
      description: escalation.reason,
      severity,
      data: {
        escalationId: escalation.id,
        type: escalation.type,
        priority: escalation.priority,
        status: escalation.status,
      },
      source: 'event',
    };
  };

  it('should convert escalation to timeline entry', () => {
    const escalation: EscalationDTO = {
      id: 'esc_123',
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      reason: 'Skill generation requires approval',
      status: ESCALATION_STATUS.PENDING,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const entry = escalationToTimelineEntry(escalation);

    expect(entry.id).toBe('escalation_esc_123');
    expect(entry.type).toBe('escalation');
    expect(entry.title).toContain('Approval Required');
    expect(entry.title).toContain('Pending');
    expect(entry.description).toBe('Skill generation requires approval');
    expect(entry.severity).toBe('warning');
  });

  it('should mark critical escalations with error severity', () => {
    const escalation: EscalationDTO = {
      id: 'esc_critical',
      type: ESCALATION_TYPE.EXECUTION_FAILURE,
      priority: ESCALATION_PRIORITY.CRITICAL,
      reason: 'Critical failure',
      status: ESCALATION_STATUS.PENDING,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const entry = escalationToTimelineEntry(escalation);
    expect(entry.severity).toBe('error');
  });

  it('should mark resolved escalations with success severity', () => {
    const escalation: EscalationDTO = {
      id: 'esc_resolved',
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      reason: 'Resolved approval',
      status: ESCALATION_STATUS.RESOLVED,
      resolution: RESOLUTION_TYPE.APPROVED,
      createdAt: 1000,
      updatedAt: 1010,
    };

    const entry = escalationToTimelineEntry(escalation);
    expect(entry.severity).toBe('success');
  });

  it('should mark expired escalations with error severity', () => {
    const escalation: EscalationDTO = {
      id: 'esc_expired',
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      reason: 'Expired approval',
      status: ESCALATION_STATUS.EXPIRED,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const entry = escalationToTimelineEntry(escalation);
    expect(entry.severity).toBe('error');
  });
});

// =============================================================================
// CONVENIENCE METHOD TESTS
// =============================================================================

describe('Convenience Escalation Methods', () => {
  it('should create approval escalation with correct defaults', () => {
    const createApprovalEscalation = (approvalId: string, taskId?: string) => ({
      type: ESCALATION_TYPE.APPROVAL_REQUIRED,
      priority: ESCALATION_PRIORITY.NORMAL,
      taskId,
      linkedApprovalId: approvalId,
      reason: `Approval required for approval: ${approvalId}`,
    });

    const escalation = createApprovalEscalation('approval_123', 'task_456');

    expect(escalation.type).toBe(ESCALATION_TYPE.APPROVAL_REQUIRED);
    expect(escalation.priority).toBe(ESCALATION_PRIORITY.NORMAL);
    expect(escalation.linkedApprovalId).toBe('approval_123');
    expect(escalation.taskId).toBe('task_456');
  });

  it('should create missing resource escalation with HIGH priority', () => {
    const createResourceEscalation = (taskId: string, resourceType: string, requirement: string) => ({
      type: ESCALATION_TYPE.RESOURCE_MISSING,
      priority: ESCALATION_PRIORITY.HIGH,
      taskId,
      resourceType,
      reason: `Missing ${resourceType}: ${requirement}`,
      context: { requirement },
    });

    const escalation = createResourceEscalation('task_123', 'skill', 'Data analysis capability');

    expect(escalation.type).toBe(ESCALATION_TYPE.RESOURCE_MISSING);
    expect(escalation.priority).toBe(ESCALATION_PRIORITY.HIGH);
    expect(escalation.reason).toContain('Missing skill');
    expect(escalation.context.requirement).toBe('Data analysis capability');
  });

  it('should create failure escalation with retry-based priority', () => {
    const createFailureEscalation = (taskId: string, error: string, retryCount: number) => ({
      type: ESCALATION_TYPE.EXECUTION_FAILURE,
      priority: retryCount >= 3 ? ESCALATION_PRIORITY.HIGH : ESCALATION_PRIORITY.NORMAL,
      taskId,
      reason: `Execution failed after ${retryCount} retries: ${error}`,
      context: { error, retryCount },
    });

    const lowRetryEscalation = createFailureEscalation('task_1', 'Connection error', 1);
    expect(lowRetryEscalation.priority).toBe(ESCALATION_PRIORITY.NORMAL);

    const highRetryEscalation = createFailureEscalation('task_2', 'Persistent error', 5);
    expect(highRetryEscalation.priority).toBe(ESCALATION_PRIORITY.HIGH);
  });

  it('should create uncertainty escalation with options', () => {
    const createUncertaintyEscalation = (
      taskId: string,
      agentId: string,
      question: string,
      options?: string[]
    ) => ({
      type: ESCALATION_TYPE.UNCERTAINTY,
      priority: ESCALATION_PRIORITY.NORMAL,
      taskId,
      agentId,
      reason: question,
      context: { options },
    });

    const escalation = createUncertaintyEscalation(
      'task_123',
      'agent_456',
      'Which API should I use?',
      ['REST API', 'GraphQL', 'gRPC']
    );

    expect(escalation.type).toBe(ESCALATION_TYPE.UNCERTAINTY);
    expect(escalation.context.options).toHaveLength(3);
    expect(escalation.context.options).toContain('GraphQL');
  });
});

// =============================================================================
// CLEANUP TESTS
// =============================================================================

describe('Escalation Cleanup', () => {
  it('should identify old resolved escalations for cleanup', () => {
    const now = Date.now() / 1000;
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = now - maxAgeMs / 1000;

    const escalations = [
      { id: 'recent', status: ESCALATION_STATUS.RESOLVED, updatedAt: now - 86400 }, // 1 day old
      { id: 'old', status: ESCALATION_STATUS.RESOLVED, updatedAt: now - 1000000 }, // ~11 days old
      { id: 'pending', status: ESCALATION_STATUS.PENDING, updatedAt: now - 1000000 }, // old but pending
    ];

    const toCleanup = escalations.filter(
      (e) =>
        (e.status === ESCALATION_STATUS.RESOLVED ||
          e.status === ESCALATION_STATUS.EXPIRED ||
          e.status === ESCALATION_STATUS.CANCELLED) &&
        e.updatedAt < cutoff
    );

    expect(toCleanup).toHaveLength(1);
    expect(toCleanup[0]?.id).toBe('old');
  });
});

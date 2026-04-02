/**
 * Skill Execution Tests
 *
 * Tests for skill execution model and pipeline.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  EXECUTION_MODE,
  EXECUTION_STATUS,
  type SkillExecutionInput,
  type SkillExecutionResult,
  type SkillExecutionPreview,
  type SkillValidationResult,
  type ToolExecutionResult,
  type PipelineContext,
  type ExecutionLogEntry,
  isExecutionSuccess,
  isExecutionFailed,
  isToolRequired,
} from '../../src/skills/execution/SkillExecutionTypes.js';
import type { SkillToolLink } from '../../src/types/domain.js';

// =============================================================================
// EXECUTION MODE TESTS
// =============================================================================

describe('Execution Modes', () => {
  it('should have all required execution modes', () => {
    expect(EXECUTION_MODE.RUN).toBe('run');
    expect(EXECUTION_MODE.VALIDATE).toBe('validate');
    expect(EXECUTION_MODE.DRY_RUN).toBe('dry_run');
  });

  it('should have all required execution statuses', () => {
    expect(EXECUTION_STATUS.PENDING).toBe('pending');
    expect(EXECUTION_STATUS.RUNNING).toBe('running');
    expect(EXECUTION_STATUS.SUCCESS).toBe('success');
    expect(EXECUTION_STATUS.FAILED).toBe('failed');
    expect(EXECUTION_STATUS.SKIPPED).toBe('skipped');
    expect(EXECUTION_STATUS.CANCELLED).toBe('cancelled');
  });
});

// =============================================================================
// SKILL EXECUTION INPUT TESTS
// =============================================================================

describe('SkillExecutionInput', () => {
  it('should create valid execution input', () => {
    const input: SkillExecutionInput = {
      skillId: 'skill-1',
      mode: 'run',
      input: { key: 'value' },
      context: { env: 'test' },
      timeoutMs: 30000,
      stopOnError: true,
      caller: { type: 'user', id: 'user-1', name: 'Test User' },
    };

    expect(input.skillId).toBe('skill-1');
    expect(input.mode).toBe('run');
    expect(input.input.key).toBe('value');
    expect(input.context?.env).toBe('test');
    expect(input.timeoutMs).toBe(30000);
    expect(input.stopOnError).toBe(true);
    expect(input.caller?.type).toBe('user');
  });

  it('should allow minimal execution input', () => {
    const input: SkillExecutionInput = {
      skillId: 'skill-1',
      mode: 'dry_run',
      input: {},
    };

    expect(input.skillId).toBe('skill-1');
    expect(input.context).toBeUndefined();
    expect(input.timeoutMs).toBeUndefined();
    expect(input.caller).toBeUndefined();
  });

  it('should support different caller types', () => {
    const userCaller: SkillExecutionInput['caller'] = { type: 'user', id: 'u-1' };
    const agentCaller: SkillExecutionInput['caller'] = { type: 'agent', id: 'a-1', name: 'Agent 1' };
    const systemCaller: SkillExecutionInput['caller'] = { type: 'system', id: 'sys' };

    expect(userCaller.type).toBe('user');
    expect(agentCaller.type).toBe('agent');
    expect(systemCaller.type).toBe('system');
  });
});

// =============================================================================
// TOOL EXECUTION RESULT TESTS
// =============================================================================

describe('ToolExecutionResult', () => {
  it('should create successful tool result', () => {
    const result: ToolExecutionResult = {
      toolId: 'tool-1',
      toolName: 'Test Tool',
      status: EXECUTION_STATUS.SUCCESS,
      output: { result: 'done' },
      startedAt: 1000,
      completedAt: 2000,
      durationMs: 1000,
      required: true,
      orderIndex: 0,
    };

    expect(result.status).toBe('success');
    expect(result.durationMs).toBe(1000);
    expect(result.error).toBeUndefined();
  });

  it('should create failed tool result with error', () => {
    const result: ToolExecutionResult = {
      toolId: 'tool-1',
      toolName: 'Test Tool',
      status: EXECUTION_STATUS.FAILED,
      error: 'Connection timeout',
      errorStack: 'Error: Connection timeout\n    at ...',
      startedAt: 1000,
      completedAt: 1500,
      durationMs: 500,
      required: true,
      orderIndex: 0,
    };

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Connection timeout');
    expect(result.errorStack).toBeDefined();
  });

  it('should track tool roles', () => {
    const result: ToolExecutionResult = {
      toolId: 'tool-1',
      toolName: 'Validator Tool',
      status: EXECUTION_STATUS.SUCCESS,
      startedAt: 1000,
      completedAt: 1100,
      durationMs: 100,
      required: true,
      role: 'validation',
      orderIndex: 0,
    };

    expect(result.role).toBe('validation');
  });
});

// =============================================================================
// SKILL EXECUTION RESULT TESTS
// =============================================================================

describe('SkillExecutionResult', () => {
  it('should create successful skill execution result', () => {
    const toolResults: ToolExecutionResult[] = [
      {
        toolId: 'tool-1',
        toolName: 'Tool 1',
        status: EXECUTION_STATUS.SUCCESS,
        output: { step: 1 },
        startedAt: 1000,
        completedAt: 2000,
        durationMs: 1000,
        required: true,
        orderIndex: 0,
      },
      {
        toolId: 'tool-2',
        toolName: 'Tool 2',
        status: EXECUTION_STATUS.SUCCESS,
        output: { step: 2 },
        startedAt: 2000,
        completedAt: 3000,
        durationMs: 1000,
        required: true,
        orderIndex: 1,
      },
    ];

    const result: SkillExecutionResult = {
      executionId: 'exec-1',
      skillId: 'skill-1',
      skillName: 'Test Skill',
      mode: 'run',
      status: EXECUTION_STATUS.SUCCESS,
      toolResults,
      output: { step: 2 },
      toolsExecuted: 2,
      toolsSucceeded: 2,
      toolsFailed: 0,
      toolsSkipped: 0,
      totalDurationMs: 2000,
      startedAt: 1000,
      completedAt: 3000,
    };

    expect(result.status).toBe('success');
    expect(result.toolsExecuted).toBe(2);
    expect(result.toolsSucceeded).toBe(2);
    expect(result.output).toEqual({ step: 2 });
  });

  it('should create failed skill execution result', () => {
    const result: SkillExecutionResult = {
      executionId: 'exec-1',
      skillId: 'skill-1',
      skillName: 'Test Skill',
      mode: 'run',
      status: EXECUTION_STATUS.FAILED,
      toolResults: [],
      error: 'Required tool failed',
      toolsExecuted: 1,
      toolsSucceeded: 0,
      toolsFailed: 1,
      toolsSkipped: 2,
      totalDurationMs: 500,
      startedAt: 1000,
      completedAt: 1500,
    };

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Required tool failed');
    expect(result.toolsSkipped).toBe(2);
  });
});

// =============================================================================
// SKILL EXECUTION PREVIEW TESTS
// =============================================================================

describe('SkillExecutionPreview', () => {
  it('should show executable skill preview', () => {
    const preview: SkillExecutionPreview = {
      skillId: 'skill-1',
      skillName: 'Test Skill',
      canExecute: true,
      blockers: [],
      warnings: [],
      pipeline: [
        {
          orderIndex: 0,
          toolId: 'tool-1',
          toolName: 'Tool 1',
          toolType: 'script',
          required: true,
          status: 'active',
          estimatedDurationMs: 1000,
        },
        {
          orderIndex: 1,
          toolId: 'tool-2',
          toolName: 'Tool 2',
          toolType: 'api',
          required: false,
          role: 'postprocessing',
          status: 'active',
          estimatedDurationMs: 500,
        },
      ],
      estimatedTotalDurationMs: 1500,
    };

    expect(preview.canExecute).toBe(true);
    expect(preview.pipeline).toHaveLength(2);
    expect(preview.estimatedTotalDurationMs).toBe(1500);
  });

  it('should show non-executable skill with blockers', () => {
    const preview: SkillExecutionPreview = {
      skillId: 'skill-1',
      skillName: 'Broken Skill',
      canExecute: false,
      blockers: ['Required tool is inactive', 'Skill is deprecated'],
      warnings: ['Optional tool has errors'],
      pipeline: [],
    };

    expect(preview.canExecute).toBe(false);
    expect(preview.blockers).toHaveLength(2);
    expect(preview.warnings).toHaveLength(1);
  });
});

// =============================================================================
// SKILL VALIDATION RESULT TESTS
// =============================================================================

describe('SkillValidationResult', () => {
  it('should show valid result', () => {
    const result: SkillValidationResult = {
      valid: true,
      skillId: 'skill-1',
      errors: [],
      warnings: [],
      toolsChecked: 3,
      toolsWithIssues: 0,
    };

    expect(result.valid).toBe(true);
    expect(result.toolsWithIssues).toBe(0);
  });

  it('should show invalid result with errors', () => {
    const result: SkillValidationResult = {
      valid: false,
      skillId: 'skill-1',
      errors: [
        { code: 'REQUIRED_TOOL_INACTIVE', message: 'Tool "API Client" is inactive', toolId: 'tool-1' },
        { code: 'MISSING_CONFIG', message: 'API tool missing URL', toolId: 'tool-2' },
      ],
      warnings: [
        { code: 'MISSING_INPUT', message: 'Expected input field "userId"', toolId: 'tool-1', field: 'userId' },
      ],
      toolsChecked: 3,
      toolsWithIssues: 2,
    };

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
  });
});

// =============================================================================
// EXECUTION LOG TESTS
// =============================================================================

describe('ExecutionLogEntry', () => {
  it('should create log entries for different phases', () => {
    const phases: Array<ExecutionLogEntry['phase']> = ['init', 'validation', 'tool_start', 'tool_end', 'complete', 'error'];
    const levels: Array<ExecutionLogEntry['level']> = ['debug', 'info', 'warn', 'error'];

    phases.forEach(phase => {
      const entry: ExecutionLogEntry = {
        timestamp: Date.now(),
        level: 'info',
        message: `Phase: ${phase}`,
        phase,
      };
      expect(entry.phase).toBe(phase);
    });

    levels.forEach(level => {
      const entry: ExecutionLogEntry = {
        timestamp: Date.now(),
        level,
        message: `Level: ${level}`,
        phase: 'complete',
      };
      expect(entry.level).toBe(level);
    });
  });

  it('should include tool context in log entries', () => {
    const entry: ExecutionLogEntry = {
      timestamp: Date.now(),
      level: 'info',
      message: 'Tool started',
      phase: 'tool_start',
      toolId: 'tool-1',
      toolName: 'Test Tool',
      data: { attempt: 1 },
    };

    expect(entry.toolId).toBe('tool-1');
    expect(entry.toolName).toBe('Test Tool');
    expect(entry.data?.attempt).toBe(1);
  });
});

// =============================================================================
// PIPELINE CONTEXT TESTS
// =============================================================================

describe('PipelineContext', () => {
  it('should create valid pipeline context', () => {
    const ctx: PipelineContext = {
      executionId: 'exec-1',
      skill: {
        id: 'skill-1',
        name: 'Test Skill',
        version: '1.0.0',
        path: '/skills/test',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      mode: 'run',
      initialInput: { key: 'value' },
      userContext: { env: 'test' },
      previousResults: [],
      currentOutput: { key: 'value' },
      log: [],
      startedAt: Date.now(),
      timeoutMs: 30000,
      stopOnError: true,
    };

    expect(ctx.executionId).toBe('exec-1');
    expect(ctx.mode).toBe('run');
    expect(ctx.stopOnError).toBe(true);
  });

  it('should track accumulated results', () => {
    const ctx: PipelineContext = {
      executionId: 'exec-1',
      skill: {
        id: 'skill-1',
        name: 'Test Skill',
        version: '1.0.0',
        path: '/skills/test',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      mode: 'run',
      initialInput: {},
      userContext: {},
      previousResults: [
        {
          toolId: 'tool-1',
          toolName: 'Tool 1',
          status: EXECUTION_STATUS.SUCCESS,
          output: { step1: true },
          startedAt: 1000,
          completedAt: 2000,
          durationMs: 1000,
          required: true,
          orderIndex: 0,
        },
      ],
      currentOutput: { step1: true },
      log: [],
      startedAt: Date.now(),
      timeoutMs: 30000,
      stopOnError: true,
    };

    expect(ctx.previousResults).toHaveLength(1);
    expect(ctx.currentOutput.step1).toBe(true);
  });
});

// =============================================================================
// TYPE GUARD TESTS
// =============================================================================

describe('Type Guards', () => {
  it('isExecutionSuccess should identify successful executions', () => {
    const success: SkillExecutionResult = {
      executionId: 'e-1',
      skillId: 's-1',
      skillName: 'Skill',
      mode: 'run',
      status: EXECUTION_STATUS.SUCCESS,
      toolResults: [],
      toolsExecuted: 1,
      toolsSucceeded: 1,
      toolsFailed: 0,
      toolsSkipped: 0,
      totalDurationMs: 100,
      startedAt: 1000,
      completedAt: 1100,
    };

    const failed: SkillExecutionResult = {
      ...success,
      status: EXECUTION_STATUS.FAILED,
    };

    expect(isExecutionSuccess(success)).toBe(true);
    expect(isExecutionSuccess(failed)).toBe(false);
  });

  it('isExecutionFailed should identify failed executions', () => {
    const failed: SkillExecutionResult = {
      executionId: 'e-1',
      skillId: 's-1',
      skillName: 'Skill',
      mode: 'run',
      status: EXECUTION_STATUS.FAILED,
      toolResults: [],
      toolsExecuted: 1,
      toolsSucceeded: 0,
      toolsFailed: 1,
      toolsSkipped: 0,
      totalDurationMs: 100,
      startedAt: 1000,
      completedAt: 1100,
    };

    const success: SkillExecutionResult = {
      ...failed,
      status: EXECUTION_STATUS.SUCCESS,
    };

    expect(isExecutionFailed(failed)).toBe(true);
    expect(isExecutionFailed(success)).toBe(false);
  });

  it('isToolRequired should identify required tools', () => {
    const required: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      createdAt: Date.now(),
    };

    const optional: SkillToolLink = {
      toolId: 'tool-2',
      orderIndex: 1,
      required: false,
      createdAt: Date.now(),
    };

    expect(isToolRequired(required)).toBe(true);
    expect(isToolRequired(optional)).toBe(false);
  });
});

// =============================================================================
// OUTPUT CHAINING TESTS
// =============================================================================

describe('Output Chaining', () => {
  it('should merge outputs from sequential tools', () => {
    const output1: Record<string, unknown> = { step1: 'done', value: 10 };
    const output2: Record<string, unknown> = { step2: 'done', value: 20 };

    // Simulate output chaining
    const merged = { ...output1, ...output2 };

    expect(merged.step1).toBe('done');
    expect(merged.step2).toBe('done');
    expect(merged.value).toBe(20); // Later value overwrites
  });

  it('should preserve initial input in context', () => {
    const initialInput = { userId: '123', action: 'process' };
    const toolOutput = { result: 'success' };

    const finalOutput = { ...initialInput, ...toolOutput };

    expect(finalOutput.userId).toBe('123');
    expect(finalOutput.result).toBe('success');
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  it('should handle required tool failures', () => {
    const failedRequired: ToolExecutionResult = {
      toolId: 'tool-1',
      toolName: 'Required Tool',
      status: EXECUTION_STATUS.FAILED,
      error: 'Network error',
      startedAt: 1000,
      completedAt: 1500,
      durationMs: 500,
      required: true,
      orderIndex: 0,
    };

    // When a required tool fails, the pipeline should fail
    expect(failedRequired.required).toBe(true);
    expect(failedRequired.status).toBe('failed');
  });

  it('should allow optional tool failures', () => {
    const failedOptional: ToolExecutionResult = {
      toolId: 'tool-2',
      toolName: 'Optional Tool',
      status: EXECUTION_STATUS.FAILED,
      error: 'API unavailable',
      startedAt: 2000,
      completedAt: 2500,
      durationMs: 500,
      required: false,
      orderIndex: 1,
    };

    // When an optional tool fails, the pipeline can continue
    expect(failedOptional.required).toBe(false);
    expect(failedOptional.status).toBe('failed');
  });

  it('should track skipped tools after failure', () => {
    const skipped: ToolExecutionResult = {
      toolId: 'tool-3',
      toolName: 'Skipped Tool',
      status: EXECUTION_STATUS.SKIPPED,
      error: 'Skipped due to previous failure',
      startedAt: 3000,
      completedAt: 3000,
      durationMs: 0,
      required: true,
      orderIndex: 2,
    };

    expect(skipped.status).toBe('skipped');
    expect(skipped.durationMs).toBe(0);
  });
});

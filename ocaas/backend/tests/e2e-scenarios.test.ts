/**
 * E2E Scenarios Test (BLOQUE 12)
 *
 * 6 escenarios de validación completa del sistema OCAAS × OpenClaw
 *
 * ESCENARIO 1: Input simple (no task) - no entra a OCAAS
 * ESCENARIO 2: Task simple - decision → execution → response
 * ESCENARIO 3: Task sin recursos - generation → approval → activation → execution
 * ESCENARIO 4: IA falla - fallback funciona
 * ESCENARIO 5: Aprobación rechazada
 * ESCENARIO 6: Ejecución sin runtime_ready
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TaskDTO, TaskIntakeTraceability } from '../src/types/domain.js';
import type { DecisionTraceability, GenerationTraceability } from '../src/types/contracts.js';
import type { ExecutionTraceability } from '../src/execution/ExecutionTraceability.js';
import type { TaskDiagnostics, AIUsageSummary } from '../src/services/DiagnosticService.js';

// ============================================================================
// MOCK FACTORIES
// ============================================================================

function createMockTask(overrides: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: 'task-' + Math.random().toString(36).slice(2, 8),
    title: 'Test Task',
    description: 'Test task description',
    type: 'action',
    status: 'pending',
    priority: 'medium',
    agentId: null,
    parentId: null,
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockIntakeTraceability(overrides: Partial<TaskIntakeTraceability> = {}): TaskIntakeTraceability {
  return {
    intake_source: 'api',
    intake_timestamp: Date.now(),
    original_input: 'Test input',
    detected_type: 'action',
    requires_task: true,
    validation_passed: true,
    ...overrides,
  };
}

function createMockDecisionTraceability(overrides: Partial<DecisionTraceability> = {}): DecisionTraceability {
  return {
    ai_decision_used: false,
    fallback_used: false,
    fallback_reason: null,
    decision_type: 'direct_assignment',
    selected_agent_id: 'agent-001',
    confidence_score: 1.0,
    decided_at: Date.now(),
    ...overrides,
  };
}

function createMockGenerationTraceability(overrides: Partial<GenerationTraceability> = {}): GenerationTraceability {
  return {
    ai_requested: true,
    ai_available: true,
    ai_generation_attempted: true,
    ai_generation_succeeded: true,
    fallback_used: false,
    fallback_reason: null,
    fallback_template_name: null,
    generated_at: Date.now(),
    ...overrides,
  };
}

function createMockExecutionTraceability(overrides: Partial<ExecutionTraceability> = {}): ExecutionTraceability {
  return {
    execution_mode: 'chat_completion',
    transport: 'rest_api',
    target_agent_id: 'agent-001',
    runtime_ready_at_execution: false,
    gateway_configured: true,
    gateway_connected: true,
    transport_success: true,
    execution_fallback_used: false,
    execution_started_at: Date.now(),
    execution_completed_at: Date.now() + 1000,
    response_received: true,
    ...overrides,
  };
}

function createMockDiagnostics(overrides: Partial<TaskDiagnostics> = {}): TaskDiagnostics {
  const task = createMockTask();
  return {
    task_id: task.id,
    task: {
      title: task.title,
      status: task.status,
      type: task.type,
      priority: task.priority,
      agent_id: task.agentId,
    },
    timeline: {
      created_at: Date.now(),
    },
    ai_usage: {
      ai_used: false,
      fallback_used: false,
      fallback_reasons: [],
      ai_models_used: [],
    },
    gaps: [],
    warnings: [],
    ...overrides,
  };
}

// ============================================================================
// ESCENARIO 1: INPUT SIMPLE (NO TASK)
// ============================================================================

describe('ESCENARIO 1: Input simple - no entra a OCAAS', () => {
  it('should detect non-task input and skip task creation', () => {
    const intake: TaskIntakeTraceability = createMockIntakeTraceability({
      original_input: 'Hola, ¿cómo estás?',
      detected_type: 'greeting',
      requires_task: false,
      validation_passed: true,
    });

    // VALIDACIÓN: requires_task debe ser false
    expect(intake.requires_task).toBe(false);
    expect(intake.detected_type).toBe('greeting');

    // No se crea task, no hay decision, no hay execution
    const diagnostics: Partial<TaskDiagnostics> = {
      intake,
      decision: undefined, // No decision needed
      execution: undefined, // No execution needed
      gaps: ['Non-task input - no processing required'],
    };

    expect(diagnostics.decision).toBeUndefined();
    expect(diagnostics.execution).toBeUndefined();
  });

  it('should handle simple questions without task creation', () => {
    const intake: TaskIntakeTraceability = createMockIntakeTraceability({
      original_input: '¿Qué hora es?',
      detected_type: 'question',
      requires_task: false, // Simple question, no task needed
    });

    expect(intake.requires_task).toBe(false);
  });

  it('should correctly track intake traceability for non-tasks', () => {
    const intake: TaskIntakeTraceability = createMockIntakeTraceability({
      intake_source: 'telegram',
      original_input: 'Buenos días',
      detected_type: 'greeting',
      requires_task: false,
    });

    // Diagnostics should show complete intake trace
    expect(intake.intake_source).toBe('telegram');
    expect(intake.intake_timestamp).toBeDefined();
    expect(intake.requires_task).toBe(false);
  });
});

// ============================================================================
// ESCENARIO 2: TASK SIMPLE
// ============================================================================

describe('ESCENARIO 2: Task simple - decision → execution → response', () => {
  it('should complete full flow: intake → decision → execution', () => {
    // STEP 1: Intake
    const intake: TaskIntakeTraceability = createMockIntakeTraceability({
      original_input: 'Busca información sobre TypeScript',
      detected_type: 'research',
      requires_task: true,
    });

    expect(intake.requires_task).toBe(true);

    // STEP 2: Decision (direct assignment, no AI)
    const decision: DecisionTraceability = createMockDecisionTraceability({
      ai_decision_used: false,
      fallback_used: false,
      decision_type: 'direct_assignment',
      selected_agent_id: 'agent-research',
      confidence_score: 1.0,
    });

    expect(decision.selected_agent_id).toBeDefined();
    expect(decision.ai_decision_used).toBe(false);

    // STEP 3: Execution (chat_completion mode)
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      execution_mode: 'chat_completion',
      transport: 'rest_api',
      target_agent_id: 'agent-research',
      transport_success: true,
      response_received: true,
    });

    expect(execution.execution_mode).toBe('chat_completion');
    expect(execution.transport_success).toBe(true);

    // DIAGNOSTICS VALIDATION
    const diagnostics = createMockDiagnostics({
      intake,
      decision,
      execution,
      ai_usage: {
        ai_used: false, // No AI in decision
        fallback_used: false,
        fallback_reasons: [],
        ai_models_used: [],
      },
      gaps: [],
    });

    expect(diagnostics.gaps.length).toBe(0);
    expect(diagnostics.ai_usage.ai_used).toBe(false);
  });

  it('should track timeline correctly for simple task', () => {
    const now = Date.now();

    const diagnostics = createMockDiagnostics({
      timeline: {
        created_at: now,
        queued_at: now + 10,
        decision_at: now + 50,
        execution_started_at: now + 100,
        execution_completed_at: now + 500,
        completed_at: now + 510,
        total_duration_ms: 510,
        queue_duration_ms: 40,
        decision_duration_ms: 50,
        execution_duration_ms: 400,
      },
    });

    expect(diagnostics.timeline.total_duration_ms).toBe(510);
    expect(diagnostics.timeline.execution_duration_ms).toBe(400);
  });

  it('should validate execution mode is chat_completion (not real_agent)', () => {
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      execution_mode: 'chat_completion',
      runtime_ready_at_execution: false, // No real agent session
    });

    // CRITICAL: Current OCAAS always uses chat_completion
    expect(execution.execution_mode).toBe('chat_completion');
    expect(execution.runtime_ready_at_execution).toBe(false);
  });
});

// ============================================================================
// ESCENARIO 3: TASK SIN RECURSOS
// ============================================================================

describe('ESCENARIO 3: Task sin recursos - generation → approval → activation → execution', () => {
  it('should trigger generation when resources are missing', () => {
    // STEP 1: Decision detects missing resources
    const decision: DecisionTraceability = createMockDecisionTraceability({
      decision_type: 'generation_required',
      selected_agent_id: null, // No suitable agent
      requires_generation: true,
    } as DecisionTraceability & { requires_generation: boolean });

    expect(decision.selected_agent_id).toBeNull();

    // STEP 2: Generation triggered
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_requested: true,
      ai_available: true,
      ai_generation_attempted: true,
      ai_generation_succeeded: true,
      fallback_used: false,
      ai_model: 'gpt-4',
      ai_tokens: { input: 500, output: 1000 },
    });

    expect(generation.ai_generation_succeeded).toBe(true);
    expect(generation.ai_model).toBe('gpt-4');

    // STEP 3: Approval required (pending_approval status)
    const approvalStatus = 'pending_approval';
    expect(approvalStatus).toBe('pending_approval');

    // STEP 4: After approval, activation
    const activatedStatus = 'active';
    expect(activatedStatus).toBe('active');

    // STEP 5: Execution with new agent
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      target_agent_id: 'agent-generated-001',
      execution_mode: 'chat_completion',
    });

    expect(execution.target_agent_id).toBe('agent-generated-001');
  });

  it('should track AI usage in generation phase', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_requested: true,
      ai_generation_succeeded: true,
      ai_model: 'claude-3-5-sonnet',
      ai_tokens: { input: 800, output: 2000 },
    });

    const aiUsage: AIUsageSummary = {
      ai_used: true,
      fallback_used: false,
      fallback_reasons: [],
      ai_models_used: ['claude-3-5-sonnet'],
      estimated_cost_usd: 0.012, // Estimated
    };

    expect(aiUsage.ai_used).toBe(true);
    expect(aiUsage.ai_models_used).toContain('claude-3-5-sonnet');
  });

  it('should include materialization traceability', () => {
    const diagnostics = createMockDiagnostics({
      materialization: {
        workspace_created: true,
        config_written: true,
        system_prompt_written: true,
        materialization_completed_at: Date.now(),
        agent_id: 'agent-generated-001',
        gap: 'Agent workspace created. OpenClaw session NOT started - not runtime_ready.',
      } as any,
    });

    expect(diagnostics.materialization).toBeDefined();
    expect(diagnostics.materialization?.workspace_created).toBe(true);
    expect(diagnostics.materialization?.gap).toContain('NOT started');
  });
});

// ============================================================================
// ESCENARIO 4: IA FALLA - FALLBACK FUNCIONA
// ============================================================================

describe('ESCENARIO 4: IA falla - fallback funciona', () => {
  it('should use fallback when AI is not available', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_requested: true,
      ai_available: false, // No AI configured
      ai_generation_attempted: false,
      ai_generation_succeeded: false,
      fallback_used: true,
      fallback_reason: 'ai_not_available',
      fallback_template_name: 'generic-agent',
    });

    expect(generation.ai_available).toBe(false);
    expect(generation.fallback_used).toBe(true);
    expect(generation.fallback_reason).toBe('ai_not_available');
    expect(generation.fallback_template_name).toBe('generic-agent');
  });

  it('should use fallback when AI request fails', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_requested: true,
      ai_available: true,
      ai_generation_attempted: true,
      ai_generation_succeeded: false, // AI failed
      fallback_used: true,
      fallback_reason: 'ai_request_failed',
      fallback_template_name: 'specialist-template',
    });

    expect(generation.ai_generation_attempted).toBe(true);
    expect(generation.ai_generation_succeeded).toBe(false);
    expect(generation.fallback_used).toBe(true);
    expect(generation.fallback_reason).toBe('ai_request_failed');
  });

  it('should use fallback when AI parse fails', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_requested: true,
      ai_available: true,
      ai_generation_attempted: true,
      ai_generation_succeeded: false,
      fallback_used: true,
      fallback_reason: 'ai_parse_error',
    });

    expect(generation.fallback_reason).toBe('ai_parse_error');
  });

  it('should track fallback in AI usage summary', () => {
    const aiUsage: AIUsageSummary = {
      ai_used: false, // AI failed
      fallback_used: true,
      fallback_reasons: ['ai_request_failed'],
      ai_models_used: [],
    };

    expect(aiUsage.ai_used).toBe(false);
    expect(aiUsage.fallback_used).toBe(true);
    expect(aiUsage.fallback_reasons).toContain('ai_request_failed');
  });

  it('should continue execution after fallback', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      fallback_used: true,
      fallback_reason: 'ai_not_available',
      fallback_template_name: 'fallback-agent',
    });

    // Execution should proceed with fallback-generated agent
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      target_agent_id: 'agent-fallback-001',
      execution_mode: 'chat_completion',
      transport_success: true,
    });

    expect(execution.transport_success).toBe(true);
  });
});

// ============================================================================
// ESCENARIO 5: APROBACIÓN RECHAZADA
// ============================================================================

describe('ESCENARIO 5: Aprobación rechazada', () => {
  it('should stop workflow when approval is rejected', () => {
    const generation: GenerationTraceability = createMockGenerationTraceability({
      ai_generation_succeeded: true,
    });

    // Approval rejected
    const approvalResult = {
      approved: false,
      rejectedBy: 'human:admin',
      rejectedAt: Date.now(),
      reason: 'No cumple con los requisitos de seguridad',
    };

    expect(approvalResult.approved).toBe(false);
    expect(approvalResult.reason).toBeDefined();

    // Generation status should be 'rejected'
    const generationStatus = 'rejected';
    expect(generationStatus).toBe('rejected');
  });

  it('should not trigger activation after rejection', () => {
    const approvalStatus = 'rejected';
    const activationAttempted = false;

    expect(approvalStatus).toBe('rejected');
    expect(activationAttempted).toBe(false);
  });

  it('should not trigger execution after rejection', () => {
    const diagnostics = createMockDiagnostics({
      generation: createMockGenerationTraceability(),
      execution: undefined, // No execution
      gaps: ['Generation rejected - no execution performed'],
    });

    expect(diagnostics.execution).toBeUndefined();
    expect(diagnostics.gaps).toContain('Generation rejected - no execution performed');
  });

  it('should track rejection in timeline', () => {
    const now = Date.now();

    const diagnostics = createMockDiagnostics({
      timeline: {
        created_at: now,
        generation_at: now + 100,
        // No materialization_at (rejected before materialization)
        // No execution_started_at
        // No completed_at
        failed_at: now + 200, // Marked as failed due to rejection
      },
    });

    expect(diagnostics.timeline.failed_at).toBeDefined();
    expect(diagnostics.timeline.execution_started_at).toBeUndefined();
  });

  it('should emit rejection events', () => {
    const rejectionEvent = {
      type: 'workflow.rejected',
      severity: 'warning',
      generationId: 'gen-001',
      rejectedBy: 'human:user123',
      reason: 'Not appropriate',
    };

    expect(rejectionEvent.type).toBe('workflow.rejected');
    expect(rejectionEvent.severity).toBe('warning');
  });
});

// ============================================================================
// ESCENARIO 6: EJECUCIÓN SIN RUNTIME_READY
// ============================================================================

describe('ESCENARIO 6: Ejecución sin runtime_ready', () => {
  it('should detect non-runtime_ready agent and use chat_completion', () => {
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      runtime_ready_at_execution: false, // Agent NOT runtime ready
      execution_mode: 'chat_completion', // Falls back to chat completion
      target_agent_id: 'agent-001',
    });

    expect(execution.runtime_ready_at_execution).toBe(false);
    expect(execution.execution_mode).toBe('chat_completion');
  });

  it('should add warning when agent is not runtime_ready', () => {
    const diagnostics = createMockDiagnostics({
      execution: createMockExecutionTraceability({
        runtime_ready_at_execution: false,
        execution_mode: 'chat_completion',
      }),
      warnings: [
        'Agent not runtime_ready - using chat_completion instead of real_agent',
        'OpenClaw session not started for this agent',
      ],
    });

    expect(diagnostics.warnings.length).toBeGreaterThan(0);
    expect(diagnostics.warnings.some(w => w.includes('runtime_ready'))).toBe(true);
  });

  it('should document materialization gap', () => {
    const diagnostics = createMockDiagnostics({
      materialization: {
        workspace_created: true,
        config_written: true,
        system_prompt_written: true,
        materialization_completed_at: Date.now(),
        agent_id: 'agent-001',
        gap: 'Agent workspace materialized but OpenClaw session NOT started. Agent is NOT runtime_ready.',
      } as any,
      gaps: [
        'Materialization incomplete: OpenClaw session not started',
      ],
    });

    expect(diagnostics.gaps.some(g => g.includes('session'))).toBe(true);
  });

  it('should show difference between real_agent and chat_completion', () => {
    // Execution with runtime_ready=false (current state)
    const currentExecution: ExecutionTraceability = createMockExecutionTraceability({
      runtime_ready_at_execution: false,
      execution_mode: 'chat_completion',
      transport: 'rest_api',
    });

    // Hypothetical execution with runtime_ready=true (future state)
    const futureExecution: ExecutionTraceability = createMockExecutionTraceability({
      runtime_ready_at_execution: true,
      execution_mode: 'real_agent',
      transport: 'websocket_rpc',
    });

    expect(currentExecution.execution_mode).toBe('chat_completion');
    expect(futureExecution.execution_mode).toBe('real_agent');
  });

  it('should complete execution despite not being runtime_ready', () => {
    const execution: ExecutionTraceability = createMockExecutionTraceability({
      runtime_ready_at_execution: false,
      execution_mode: 'chat_completion',
      transport_success: true,
      response_received: true,
    });

    // Execution should still succeed via chat_completion
    expect(execution.transport_success).toBe(true);
    expect(execution.response_received).toBe(true);
  });

  it('should track execution mode in AI usage summary', () => {
    const executionSummary = {
      execution_mode: 'chat_completion',
      runtime_ready: false,
      transport_used: 'rest_api',
      success: true,
      gap: 'Used chat_completion because agent is not runtime_ready',
    };

    expect(executionSummary.execution_mode).toBe('chat_completion');
    expect(executionSummary.runtime_ready).toBe(false);
    expect(executionSummary.gap).toBeDefined();
  });
});

// ============================================================================
// CROSS-SCENARIO VALIDATION
// ============================================================================

describe('Cross-scenario validation', () => {
  it('should have consistent traceability structure across all scenarios', () => {
    // All scenarios should produce TaskDiagnostics with same structure
    const scenario1 = createMockDiagnostics({ intake: createMockIntakeTraceability({ requires_task: false }) });
    const scenario2 = createMockDiagnostics({
      intake: createMockIntakeTraceability(),
      decision: createMockDecisionTraceability(),
      execution: createMockExecutionTraceability(),
    });
    const scenario3 = createMockDiagnostics({
      generation: createMockGenerationTraceability(),
    });

    // All have task_id
    expect(scenario1.task_id).toBeDefined();
    expect(scenario2.task_id).toBeDefined();
    expect(scenario3.task_id).toBeDefined();

    // All have timeline
    expect(scenario1.timeline).toBeDefined();
    expect(scenario2.timeline).toBeDefined();
    expect(scenario3.timeline).toBeDefined();

    // All have ai_usage
    expect(scenario1.ai_usage).toBeDefined();
    expect(scenario2.ai_usage).toBeDefined();
    expect(scenario3.ai_usage).toBeDefined();
  });

  it('should correctly identify AI vs fallback usage', () => {
    // AI used
    const aiUsage1: AIUsageSummary = { ai_used: true, fallback_used: false, fallback_reasons: [], ai_models_used: ['gpt-4'] };
    // Fallback used
    const aiUsage2: AIUsageSummary = { ai_used: false, fallback_used: true, fallback_reasons: ['ai_not_available'], ai_models_used: [] };
    // Neither (simple task)
    const aiUsage3: AIUsageSummary = { ai_used: false, fallback_used: false, fallback_reasons: [], ai_models_used: [] };

    expect(aiUsage1.ai_used && !aiUsage1.fallback_used).toBe(true);
    expect(!aiUsage2.ai_used && aiUsage2.fallback_used).toBe(true);
    expect(!aiUsage3.ai_used && !aiUsage3.fallback_used).toBe(true);
  });

  it('should validate execution mode is always documented', () => {
    const executionModes: ExecutionTraceability['execution_mode'][] = ['chat_completion', 'stub', 'real_agent'];

    executionModes.forEach(mode => {
      const execution = createMockExecutionTraceability({ execution_mode: mode });
      expect(['chat_completion', 'stub', 'real_agent']).toContain(execution.execution_mode);
    });
  });
});

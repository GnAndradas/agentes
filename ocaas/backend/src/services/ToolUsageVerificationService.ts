/**
 * ToolUsageVerificationService
 *
 * Determines with certainty whether a task executed real tools or just
 * produced a model response, using ONLY verifiable system evidence.
 *
 * RULES (MANDATORY):
 * - NO inferring tool usage without structured evidence
 * - NO heuristics based on text
 * - NO assuming "complex response" = tool usage
 * - NO inventing steps
 *
 * Evidence sources (in order of priority):
 * 1. Runtime events from hook (.jsonl files) - tool:call, tool:result
 * 2. Execution traceability - resources_usage.verified
 * 3. Debug summary - contextual only, NOT proof
 * 4. Execution timeline - correlation only
 *
 * Result: tools_used = true | false | unknown
 */

import { getRuntimeEvents, buildSessionKeyFromTaskId, type RuntimeEvent } from './RuntimeEventsService.js';
import { getTaskDebugSummary, type TaskDebugSummary, type DebugIssue } from './TaskDebugSummaryService.js';
import { getExecutionTimeline, type TimelineEvent } from './ExecutionTimelineService.js';
import { db } from '../db/index.js';
import { jobs } from '../db/schema/index.js';
import { eq, desc } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ToolUsageVerificationService');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Tool usage verification result
 */
export interface ToolUsageVerificationResult {
  /** Task ID being verified */
  taskId: string;

  /** Session key used */
  sessionKey: string | null;

  /** Agent ID (if applicable) */
  agentId: string | null;

  // ==========================================================================
  // TOOL POLICY (NEW)
  // ==========================================================================

  /**
   * Tool execution policy that was active.
   * - 'standard': No specific tool preference
   * - 'tool_first': Tools were available and agent was instructed to prefer them
   */
  tool_policy: 'standard' | 'tool_first';

  /**
   * Were tools available for this execution?
   */
  tools_available: boolean;

  /**
   * Was a tool attempt detected in runtime events?
   * - true: Runtime events show tool:call or similar
   * - false: No tool events found
   * - 'unknown': No runtime events available to check
   */
  tool_attempted: boolean | 'unknown';

  /**
   * Reason if tools were not attempted when tool_first policy was active.
   */
  tool_not_attempted_reason?: string;

  // ==========================================================================
  // TOOL USAGE VERIFICATION (EXISTING)
  // ==========================================================================

  /**
   * Final determination:
   * - true: Explicit evidence of tool execution exists
   * - false: Explicit evidence confirms NO tool execution
   * - unknown: No contractual confirmation available
   */
  tools_used: boolean | 'unknown';

  /**
   * Source of evidence that determined the result
   */
  evidence_source: 'runtime_events' | 'execution_receipt' | 'none';

  /**
   * Specific evidence found
   */
  evidence: string;

  /**
   * Additional notes about limitations or context
   */
  notes: string;

  /**
   * Detailed breakdown by verification phase
   */
  phases: VerificationPhase[];

  /**
   * Tools explicitly confirmed (only if tools_used = true)
   */
  confirmed_tools?: string[];

  // ==========================================================================
  // TOOL ENFORCEMENT (NEW)
  // ==========================================================================

  /** Whether tool enforcement was active for this execution */
  tool_enforced?: boolean;

  /** Whether enforcement was triggered (model tried to respond without tool) */
  tool_enforcement_triggered?: boolean;

  /** Number of enforcement retry attempts made */
  enforcement_attempts?: number;

  /** Final enforcement result */
  enforcement_result?: 'success' | 'failed' | 'not_applicable';
}

/**
 * Individual verification phase result
 */
export interface VerificationPhase {
  phase: number;
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'inconclusive';
  evidence?: string;
  data?: Record<string, unknown>;
}

// ============================================================================
// INTERNAL PHASE CHECKERS
// ============================================================================

interface RuntimeCheckResult {
  toolsUsed: boolean | 'unknown';
  evidence: string;
  toolNames: string[];
  phase: VerificationPhase;
}

interface ContractCheckResult {
  toolsUsed: boolean | 'unknown';
  evidence: string;
  toolNames: string[];
  agentId: string | null;
  toolsAssigned: string[];
  toolPolicy: 'standard' | 'tool_first' | null;
  // Enforcement fields from traceability
  toolEnforced: boolean | null;
  toolEnforcementTriggered: boolean | null;
  enforcementAttempts: number | null;
  enforcementResult: 'success' | 'failed' | 'not_applicable' | null;
  // Tool attempt from traceability
  toolAttemptedFromTrace: boolean | null;
  toolNotAttemptedReason: string | null;
  phase: VerificationPhase;
}

interface DebugCheckResult {
  phase: VerificationPhase;
}

interface TimelineCheckResult {
  phase: VerificationPhase;
}

/**
 * FASE 2: Runtime Events Check
 */
async function checkRuntimeEvents(taskId: string, sessionKey: string): Promise<RuntimeCheckResult> {
  try {
    const runtimeEvents = await getRuntimeEvents(taskId, sessionKey);

    if (!runtimeEvents.logExists) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Runtime log file not found',
        toolNames: [],
        phase: {
          phase: 2,
          name: 'RUNTIME_EVENTS',
          status: 'skip',
          evidence: `Log not found at: ${runtimeEvents.logPath}`,
          data: { logExists: false },
        },
      };
    }

    if (!runtimeEvents.hasEvents || runtimeEvents.events.length === 0) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Runtime log exists but contains no events',
        toolNames: [],
        phase: {
          phase: 2,
          name: 'RUNTIME_EVENTS',
          status: 'inconclusive',
          evidence: 'Log exists but empty',
          data: { logExists: true, eventCount: 0 },
        },
      };
    }

    // Search for tool:call and tool:result events
    const toolCallEvents = runtimeEvents.events.filter(
      (e: RuntimeEvent) => e.event === 'tool:call' || e.event === 'tool_call'
    );
    const toolResultEvents = runtimeEvents.events.filter(
      (e: RuntimeEvent) => e.event === 'tool:result' || e.event === 'tool_result'
    );

    if (toolCallEvents.length > 0) {
      // Extract tool names from events
      const toolNames = toolCallEvents
        .map((e: RuntimeEvent) => {
          const meta = e.metadata as Record<string, unknown> | undefined;
          return (meta?.tool_name as string) || (meta?.toolName as string) || e.summary || 'unknown';
        })
        .filter((name: string, idx: number, arr: string[]) => arr.indexOf(name) === idx); // unique

      return {
        toolsUsed: true,
        evidence: `Found ${toolCallEvents.length} tool:call events, ${toolResultEvents.length} tool:result events`,
        toolNames,
        phase: {
          phase: 2,
          name: 'RUNTIME_EVENTS',
          status: 'pass',
          evidence: `tool:call=${toolCallEvents.length}, tool:result=${toolResultEvents.length}`,
          data: {
            logExists: true,
            totalEvents: runtimeEvents.events.length,
            toolCallCount: toolCallEvents.length,
            toolResultCount: toolResultEvents.length,
            toolNames,
          },
        },
      };
    }

    // Log exists with events but no tool events
    return {
      toolsUsed: 'unknown',
      evidence: `${runtimeEvents.events.length} runtime events found, but no tool:call/tool:result`,
      toolNames: [],
      phase: {
        phase: 2,
        name: 'RUNTIME_EVENTS',
        status: 'inconclusive',
        evidence: `Events present (${runtimeEvents.events.length}) but no tool events`,
        data: {
          logExists: true,
          totalEvents: runtimeEvents.events.length,
          eventTypes: [...new Set(runtimeEvents.events.map((e: RuntimeEvent) => e.event))],
        },
      },
    };
  } catch (err) {
    logger.error({ err, taskId }, 'Failed to check runtime events');
    return {
      toolsUsed: 'unknown',
      evidence: `Error reading runtime events: ${err instanceof Error ? err.message : 'unknown'}`,
      toolNames: [],
      phase: {
        phase: 2,
        name: 'RUNTIME_EVENTS',
        status: 'fail',
        evidence: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    };
  }
}

/**
 * FASE 3: Contractual Resource Check
 */
async function checkContractualResources(taskId: string): Promise<ContractCheckResult> {
  // Default values for new fields
  const defaultResult = {
    toolsAssigned: [] as string[],
    toolPolicy: null as 'standard' | 'tool_first' | null,
    // Enforcement defaults
    toolEnforced: null as boolean | null,
    toolEnforcementTriggered: null as boolean | null,
    enforcementAttempts: null as number | null,
    enforcementResult: null as 'success' | 'failed' | 'not_applicable' | null,
    // Tool attempt from trace
    toolAttemptedFromTrace: null as boolean | null,
    toolNotAttemptedReason: null as string | null,
  };

  try {
    // Get latest job for this task
    const jobRecords = await db
      .select()
      .from(jobs)
      .where(eq(jobs.taskId, taskId))
      .orderBy(desc(jobs.createdAt))
      .limit(1);

    if (jobRecords.length === 0) {
      return {
        toolsUsed: 'unknown',
        evidence: 'No job record found for task',
        toolNames: [],
        agentId: null,
        ...defaultResult,
        phase: {
          phase: 3,
          name: 'CONTRACTUAL_RESOURCE_CHECK',
          status: 'skip',
          evidence: 'No job record exists',
        },
      };
    }

    const job = jobRecords[0];
    if (!job) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Job record is undefined',
        toolNames: [],
        agentId: null,
        ...defaultResult,
        phase: {
          phase: 3,
          name: 'CONTRACTUAL_RESOURCE_CHECK',
          status: 'skip',
          evidence: 'Job record undefined',
        },
      };
    }

    const response = job.response as Record<string, unknown> | null;

    if (!response) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Job exists but no response recorded',
        toolNames: [],
        agentId: job.agentId,
        ...defaultResult,
        phase: {
          phase: 3,
          name: 'CONTRACTUAL_RESOURCE_CHECK',
          status: 'inconclusive',
          evidence: 'Job response is null',
        },
      };
    }

    // Check traceability
    const traceability = response.traceability as Record<string, unknown> | undefined;
    if (!traceability) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Job response has no traceability field',
        toolNames: [],
        agentId: job.agentId,
        ...defaultResult,
        phase: {
          phase: 3,
          name: 'CONTRACTUAL_RESOURCE_CHECK',
          status: 'inconclusive',
          evidence: 'No traceability in response',
        },
      };
    }

    // Extract tool_policy and resources_assigned from traceability
    const toolPolicy = (traceability.tool_policy as 'standard' | 'tool_first') || null;
    const resourcesAssigned = traceability.resources_assigned as { tools?: string[]; skills?: string[] } | undefined;
    const toolsAssigned = resourcesAssigned?.tools || [];

    // Extract enforcement fields from traceability
    const toolEnforced = traceability.tool_enforced as boolean | undefined ?? null;
    const toolEnforcementTriggered = traceability.tool_enforcement_triggered as boolean | undefined ?? null;
    const enforcementAttempts = traceability.enforcement_attempts as number | undefined ?? null;
    const enforcementResult = traceability.enforcement_result as 'success' | 'failed' | 'not_applicable' | undefined ?? null;

    // Extract tool_attempted from traceability (if set by enforcement gate)
    const toolAttemptedFromTrace = traceability.tool_attempted as boolean | undefined ?? null;
    const toolNotAttemptedReason = traceability.tool_not_attempted_reason as string | undefined ?? null;

    // Check resources_usage
    const resourcesUsage = traceability.resources_usage as Record<string, unknown> | undefined;

    if (!resourcesUsage) {
      return {
        toolsUsed: 'unknown',
        evidence: 'Traceability has no resources_usage field',
        toolNames: [],
        agentId: job.agentId,
        toolsAssigned,
        toolPolicy,
        toolEnforced,
        toolEnforcementTriggered,
        enforcementAttempts,
        enforcementResult,
        toolAttemptedFromTrace,
        toolNotAttemptedReason,
        phase: {
          phase: 3,
          name: 'CONTRACTUAL_RESOURCE_CHECK',
          status: 'inconclusive',
          evidence: 'resources_usage field missing',
          data: { traceability_keys: Object.keys(traceability), toolPolicy, toolsAssigned, toolEnforced, enforcementResult },
        },
      };
    }

    const verified = resourcesUsage.verified as boolean;
    const toolsUsedArr = resourcesUsage.tools_used as string[] | undefined;
    const verificationSource = resourcesUsage.verification_source as string;
    const unverifiedReason = resourcesUsage.unverified_reason as string | undefined;

    if (verified === true) {
      // VERIFIED = TRUE: OpenClaw returned explicit confirmation
      if (Array.isArray(toolsUsedArr) && toolsUsedArr.length > 0) {
        return {
          toolsUsed: true,
          evidence: `Verified tool usage: ${toolsUsedArr.join(', ')}`,
          toolNames: toolsUsedArr,
          agentId: job.agentId,
          toolsAssigned,
          toolPolicy,
          toolEnforced,
          toolEnforcementTriggered,
          enforcementAttempts,
          enforcementResult,
          toolAttemptedFromTrace,
          toolNotAttemptedReason,
          phase: {
            phase: 3,
            name: 'CONTRACTUAL_RESOURCE_CHECK',
            status: 'pass',
            evidence: `usage_verified=true, tools_used=[${toolsUsedArr.join(', ')}]`,
            data: { verified: true, toolsUsed: toolsUsedArr, verificationSource, toolPolicy, toolsAssigned, toolEnforced, enforcementResult },
          },
        };
      } else {
        return {
          toolsUsed: false,
          evidence: 'Verified: no tools were used',
          toolNames: [],
          agentId: job.agentId,
          toolsAssigned,
          toolPolicy,
          toolEnforced,
          toolEnforcementTriggered,
          enforcementAttempts,
          enforcementResult,
          toolAttemptedFromTrace,
          toolNotAttemptedReason,
          phase: {
            phase: 3,
            name: 'CONTRACTUAL_RESOURCE_CHECK',
            status: 'pass',
            evidence: 'usage_verified=true, tools_used=[]',
            data: { verified: true, toolsUsed: [], verificationSource, toolPolicy, toolsAssigned, toolEnforced, enforcementResult },
          },
        };
      }
    }

    // VERIFIED = FALSE: No structured confirmation
    return {
      toolsUsed: 'unknown',
      evidence: unverifiedReason || 'Execution completed but tool usage not verified',
      toolNames: [],
      agentId: job.agentId,
      toolsAssigned,
      toolPolicy,
      toolEnforced,
      toolEnforcementTriggered,
      enforcementAttempts,
      enforcementResult,
      toolAttemptedFromTrace,
      toolNotAttemptedReason,
      phase: {
        phase: 3,
        name: 'CONTRACTUAL_RESOURCE_CHECK',
        status: 'inconclusive',
        evidence: `usage_verified=false, reason: ${unverifiedReason || 'not specified'}`,
        data: {
          verified: false,
          verificationSource,
          unverifiedReason,
          resourcesInjected: traceability.resources_injected,
          toolPolicy,
          toolsAssigned,
          toolEnforced,
          enforcementResult,
        },
      },
    };
  } catch (err) {
    logger.error({ err, taskId }, 'Failed to check contractual resources');
    return {
      toolsUsed: 'unknown',
      evidence: `Error querying job records: ${err instanceof Error ? err.message : 'unknown'}`,
      toolNames: [],
      agentId: null,
      ...defaultResult,
      phase: {
        phase: 3,
        name: 'CONTRACTUAL_RESOURCE_CHECK',
        status: 'fail',
        evidence: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    };
  }
}

/**
 * FASE 4: Debug Summary (CONTEXTUAL ONLY)
 */
async function checkDebugSummary(taskId: string): Promise<DebugCheckResult> {
  try {
    const summary = await getTaskDebugSummary(taskId);

    if (!summary) {
      return {
        phase: {
          phase: 4,
          name: 'DEBUG_SUMMARY',
          status: 'skip',
          evidence: 'No debug summary available',
        },
      };
    }

    // Extract relevant context - DO NOT use for tool determination
    const relevantInfo: Record<string, unknown> = {
      overall_status: summary.overall_status,
      task_status: summary.taskStatus,
    };

    // Check for stub execution mode in issues
    if (Array.isArray(summary.issues)) {
      relevantInfo.execution_mode_stub = summary.issues.some(
        (i: DebugIssue) => i.summary?.includes('stub') || i.evidence?.includes('stub')
      );
    }

    return {
      phase: {
        phase: 4,
        name: 'DEBUG_SUMMARY',
        status: 'pass',
        evidence: `Context gathered: overall_status=${relevantInfo.overall_status}`,
        data: relevantInfo,
      },
    };
  } catch (err) {
    return {
      phase: {
        phase: 4,
        name: 'DEBUG_SUMMARY',
        status: 'fail',
        evidence: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    };
  }
}

/**
 * FASE 5: Execution Timeline
 */
async function checkExecutionTimeline(taskId: string): Promise<TimelineCheckResult> {
  try {
    const timeline = await getExecutionTimeline(taskId);

    if (!timeline || timeline.totalEvents === 0) {
      return {
        phase: {
          phase: 5,
          name: 'EXECUTION_TIMELINE',
          status: 'skip',
          evidence: 'No timeline events available',
        },
      };
    }

    // Check for tool events in timeline (correlation only)
    const toolEvents = timeline.events.filter(
      (e: TimelineEvent) =>
        e.event.toLowerCase().includes('tool') ||
        e.stage === 'tool_calling' ||
        e.stage === 'tool_complete'
    );

    return {
      phase: {
        phase: 5,
        name: 'EXECUTION_TIMELINE',
        status: 'pass',
        evidence: `${timeline.totalEvents} timeline events, ${toolEvents.length} potentially tool-related`,
        data: {
          totalEvents: timeline.totalEvents,
          toolRelatedEvents: toolEvents.length,
          layers: timeline.layers,
          sessionKey: timeline.sessionKey,
        },
      },
    };
  } catch (err) {
    return {
      phase: {
        phase: 5,
        name: 'EXECUTION_TIMELINE',
        status: 'fail',
        evidence: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
      },
    };
  }
}

/**
 * FASE 7: Determine Limitations
 */
function determineLimitations(
  runtimeResult: RuntimeCheckResult,
  contractResult: ContractCheckResult
): string {
  const limitations: string[] = [];

  if (runtimeResult.toolsUsed === 'unknown') {
    if (runtimeResult.evidence.includes('not found')) {
      limitations.push('Runtime hook log not found - hook may not be installed or session not started');
    } else if (runtimeResult.evidence.includes('no events')) {
      limitations.push('Runtime log exists but contains no tool events');
    }
  }

  if (contractResult.toolsUsed === 'unknown') {
    if (contractResult.evidence.includes('not verified')) {
      limitations.push('OpenClaw does not currently provide structured tool usage confirmation (runtime_receipt)');
    } else if (contractResult.evidence.includes('No job record')) {
      limitations.push('No job execution record found for this task');
    }
  }

  if (limitations.length === 0) {
    limitations.push('Verification completed but no explicit tool usage evidence found');
  }

  return limitations.join('. ');
}

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class ToolUsageVerificationService {
  /**
   * Verify tool usage for a task following the 7-phase protocol
   */
  async verifyToolUsage(
    taskId: string,
    sessionKey?: string,
    agentId?: string
  ): Promise<ToolUsageVerificationResult> {
    const resolvedSessionKey = sessionKey || buildSessionKeyFromTaskId(taskId);
    const phases: VerificationPhase[] = [];

    logger.debug({ taskId, sessionKey: resolvedSessionKey, agentId }, 'Starting tool usage verification');

    // FASE 1: Identify task (already done via params)
    phases.push({
      phase: 1,
      name: 'IDENTIFY_TASK',
      status: 'pass',
      evidence: `taskId=${taskId}, sessionKey=${resolvedSessionKey}, agentId=${agentId || 'not specified'}`,
    });

    // FASE 2: Runtime Events (PRIMARY SOURCE)
    const runtimeResult = await checkRuntimeEvents(taskId, resolvedSessionKey);
    phases.push(runtimeResult.phase);

    // FASE 3: Contractual Resource Check
    const contractResult = await checkContractualResources(taskId);
    phases.push(contractResult.phase);

    // FASE 4: Debug Summary (CONTEXTUAL ONLY)
    const debugResult = await checkDebugSummary(taskId);
    phases.push(debugResult.phase);

    // FASE 5: Execution Timeline
    const timelineResult = await checkExecutionTimeline(taskId);
    phases.push(timelineResult.phase);

    // ==========================================================================
    // DETERMINE TOOL POLICY AND ATTEMPT STATUS
    // ==========================================================================

    // Extract tool_policy and tools_available from traceability
    const traceability = contractResult.phase.data as Record<string, unknown> | undefined;
    const toolPolicy: 'standard' | 'tool_first' =
      (traceability?.toolPolicy as string) === 'tool_first' ? 'tool_first' :
      (contractResult.toolsAssigned && contractResult.toolsAssigned.length > 0) ? 'tool_first' : 'standard';

    const toolsAvailable = contractResult.toolsAssigned && contractResult.toolsAssigned.length > 0;

    // Determine tool_attempted - prefer traceability source (from enforcement gate), fallback to runtime events
    // Traceability is authoritative when enforcement gate was active
    let toolAttempted: boolean | 'unknown';
    if (contractResult.toolAttemptedFromTrace !== null) {
      // Use traceability value (set by enforcement gate)
      toolAttempted = contractResult.toolAttemptedFromTrace;
    } else {
      // Fallback to runtime events analysis
      toolAttempted =
        runtimeResult.phase.status === 'skip' ? 'unknown' :  // No runtime log
        runtimeResult.toolsUsed === true ? true :             // Tool calls found
        runtimeResult.phase.data?.totalEvents ? false :       // Events exist but no tool calls
        'unknown';                                            // No events
    }

    // Determine reason if not attempted when tool_first was active
    let toolNotAttemptedReason: string | undefined;
    if (contractResult.toolNotAttemptedReason) {
      // Use traceability reason (from enforcement gate)
      toolNotAttemptedReason = contractResult.toolNotAttemptedReason;
    } else if (toolPolicy === 'tool_first' && toolAttempted === false) {
      toolNotAttemptedReason = 'Runtime events show no tool:call attempts despite tool_first policy';
    } else if (toolPolicy === 'tool_first' && toolAttempted === 'unknown') {
      toolNotAttemptedReason = 'Cannot determine - no runtime events available';
    }

    // ==========================================================================
    // BUILD FINAL RESULT
    // ==========================================================================

    // FASE 6: Final Result
    const hasToolEvidence = runtimeResult.toolsUsed === true || contractResult.toolsUsed === true;
    const hasNoToolEvidence = contractResult.toolsUsed === false;

    phases.push({
      phase: 6,
      name: 'FINAL_RESULT',
      status: hasToolEvidence ? 'pass' : hasNoToolEvidence ? 'pass' : 'inconclusive',
      evidence: hasToolEvidence
        ? `Tools used: ${runtimeResult.toolNames?.join(', ') || contractResult.toolNames?.join(', ')}`
        : hasNoToolEvidence
          ? 'Verified: no tools were used'
          : 'No explicit tool usage evidence found',
      data: {
        tool_policy: toolPolicy,
        tools_available: toolsAvailable,
        tool_attempted: toolAttempted,
      },
    });

    // FASE 7: Validation
    const limitationNotes = determineLimitations(runtimeResult, contractResult);
    phases.push({
      phase: 7,
      name: 'VALIDATION',
      status: 'pass',
      evidence: limitationNotes,
    });

    // Determine final tools_used value
    let toolsUsed: boolean | 'unknown' = 'unknown';
    let evidenceSource: 'runtime_events' | 'execution_receipt' | 'none' = 'none';
    let evidence = 'No contractual confirmation of tool usage available';
    let confirmedTools: string[] | undefined;

    if (runtimeResult.toolsUsed === true) {
      toolsUsed = true;
      evidenceSource = 'runtime_events';
      evidence = runtimeResult.evidence;
      confirmedTools = runtimeResult.toolNames;
    } else if (contractResult.toolsUsed === true) {
      toolsUsed = true;
      evidenceSource = 'execution_receipt';
      evidence = contractResult.evidence;
      confirmedTools = contractResult.toolNames;
    } else if (contractResult.toolsUsed === false) {
      toolsUsed = false;
      evidenceSource = 'execution_receipt';
      evidence = contractResult.evidence;
    }

    return {
      taskId,
      sessionKey: resolvedSessionKey,
      agentId: contractResult.agentId || agentId || null,
      // Tool policy fields
      tool_policy: toolPolicy,
      tools_available: toolsAvailable || false,
      tool_attempted: toolAttempted,
      tool_not_attempted_reason: toolNotAttemptedReason,
      // Enforcement fields (from traceability)
      tool_enforced: contractResult.toolEnforced ?? undefined,
      tool_enforcement_triggered: contractResult.toolEnforcementTriggered ?? undefined,
      enforcement_attempts: contractResult.enforcementAttempts ?? undefined,
      enforcement_result: contractResult.enforcementResult ?? undefined,
      // Tool usage verification
      tools_used: toolsUsed,
      evidence_source: evidenceSource,
      evidence,
      notes: limitationNotes,
      phases,
      confirmed_tools: confirmedTools,
    };
  }
}

// Export singleton instance
export const toolUsageVerificationService = new ToolUsageVerificationService();

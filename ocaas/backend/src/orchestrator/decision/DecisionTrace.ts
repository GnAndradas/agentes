/**
 * DecisionTrace - Trazabilidad de decisiones Task → Agent → Job
 *
 * Permite auditar y explicar POR QUÉ una task no se ejecuta:
 * - NO_AGENTS_REGISTERED: No hay agentes en el sistema
 * - NO_ACTIVE_AGENTS: Hay agentes pero ninguno activo
 * - NO_AGENT_MATCHING_CAPABILITIES: Agentes activos pero sin match
 * - ASSIGNED: Se encontró un agente adecuado
 * - ERROR: Error durante el proceso de decisión
 *
 * PERSISTENCE: Now persists to SQLite for audit trail across restarts.
 */

import { eq, desc, sql } from 'drizzle-orm';
import { orchestratorLogger } from '../../utils/logger.js';
import { db, schema } from '../../db/index.js';

const logger = orchestratorLogger.child({ component: 'DecisionTrace' });

// =============================================================================
// TYPES
// =============================================================================

export type DecisionOutcome =
  | 'assigned'              // Se asignó a un agente
  | 'no_agents'             // No hay agentes registrados
  | 'no_active_agents'      // Hay agentes pero ninguno activo
  | 'no_match'              // Agentes activos pero sin match de capabilities
  | 'escalated'             // Escalado a humano o superior
  | 'waiting'               // Esperando recurso/aprobación
  | 'error';                // Error durante decisión

export type FailureReason =
  | 'NO_AGENTS_REGISTERED'
  | 'NO_ACTIVE_AGENTS'
  | 'NO_AGENT_MATCHING_CAPABILITIES'
  | 'BUDGET_BLOCKED'
  | 'MAX_RETRIES_EXCEEDED'
  | 'ESCALATED_TO_HUMAN'
  | 'WAITING_FOR_APPROVAL'
  | 'WAITING_FOR_RESOURCE'
  | 'DECISION_ERROR';

export interface EvaluatedAgent {
  agentId: string;
  agentName: string;
  status: 'active' | 'inactive' | 'busy' | 'error';
  capabilities: string[];
  match: boolean;
  matchScore: number;
  matchReason?: string;
  /** Why this agent was not selected (if not selected) */
  exclusionReason?: string;
}

export interface DecisionTrace {
  /** Unique trace ID */
  id: string;
  /** Task being decided */
  taskId: string;
  /** When trace was created */
  createdAt: number;

  // Decision outcome
  /** Final decision outcome */
  decision: DecisionOutcome;
  /** Reason for failure (if not assigned) */
  failureReason?: FailureReason;
  /** Human-readable explanation */
  explanation: string;

  // Agent evaluation
  /** All agents evaluated */
  evaluatedAgents: EvaluatedAgent[];
  /** Total agents in system */
  totalAgents: number;
  /** Active agents count */
  activeAgents: number;
  /** Agents that matched */
  matchingAgents: number;

  // Selection result
  /** Selected agent ID (if assigned) */
  selectedAgentId?: string;
  /** Selection score */
  selectionScore?: number;
  /** Why this agent was selected */
  selectionReason?: string;

  // Context
  /** Task type */
  taskType: string;
  /** Task priority */
  taskPriority: number;
  /** Required capabilities (inferred) */
  requiredCapabilities: string[];

  // Method
  /** How decision was made */
  decisionMethod: 'heuristic' | 'llm' | 'fallback' | 'cached';
  /** Decision confidence (0-1) */
  confidence: number;
  /** Processing time in ms */
  processingTimeMs: number;

  // Error info
  /** Error details if decision errored */
  error?: string;
}

// =============================================================================
// DECISION TRACE STORE (DB-backed with in-memory cache)
// =============================================================================

class DecisionTraceStore {
  /** In-memory cache: taskId → DecisionTrace (hot data) */
  private cache: Map<string, DecisionTrace> = new Map();
  private readonly maxCacheSize = 500;

  /**
   * Convert DecisionTrace to DB row format
   */
  private traceToRow(trace: DecisionTrace) {
    return {
      id: trace.id,
      taskId: trace.taskId,
      decision: trace.decision,
      failureReason: trace.failureReason || null,
      explanation: trace.explanation,
      selectedAgentId: trace.selectedAgentId || null,
      selectionScore: trace.selectionScore || null,
      selectionReason: trace.selectionReason || null,
      totalAgents: trace.totalAgents,
      activeAgents: trace.activeAgents,
      matchingAgents: trace.matchingAgents,
      evaluatedAgentsJson: JSON.stringify(trace.evaluatedAgents),
      taskType: trace.taskType,
      taskPriority: trace.taskPriority,
      requiredCapabilitiesJson: JSON.stringify(trace.requiredCapabilities),
      decisionMethod: trace.decisionMethod,
      confidence: trace.confidence,
      processingTimeMs: trace.processingTimeMs,
      error: trace.error || null,
      createdAt: trace.createdAt,
    };
  }

  /**
   * Convert DB row to DecisionTrace
   */
  private rowToTrace(row: typeof schema.decisionTraces.$inferSelect): DecisionTrace {
    return {
      id: row.id,
      taskId: row.taskId,
      decision: row.decision as DecisionOutcome,
      failureReason: row.failureReason as FailureReason | undefined,
      explanation: row.explanation,
      selectedAgentId: row.selectedAgentId || undefined,
      selectionScore: row.selectionScore || undefined,
      selectionReason: row.selectionReason || undefined,
      totalAgents: row.totalAgents,
      activeAgents: row.activeAgents,
      matchingAgents: row.matchingAgents,
      evaluatedAgents: row.evaluatedAgentsJson ? JSON.parse(row.evaluatedAgentsJson) : [],
      taskType: row.taskType,
      taskPriority: row.taskPriority,
      requiredCapabilities: row.requiredCapabilitiesJson ? JSON.parse(row.requiredCapabilitiesJson) : [],
      decisionMethod: (row.decisionMethod || 'heuristic') as DecisionTrace['decisionMethod'],
      confidence: row.confidence || 0,
      processingTimeMs: row.processingTimeMs || 0,
      error: row.error || undefined,
      createdAt: row.createdAt,
    };
  }

  /**
   * Record a new decision trace (persists to DB)
   */
  record(trace: DecisionTrace): void {
    // Persist to DB
    try {
      db.insert(schema.decisionTraces)
        .values(this.traceToRow(trace))
        .onConflictDoUpdate({
          target: schema.decisionTraces.id,
          set: this.traceToRow(trace),
        })
        .run();
    } catch (err) {
      logger.error({ err, traceId: trace.id }, 'Failed to persist decision trace to DB');
    }

    // Update cache
    this.cache.set(trace.taskId, trace);
    if (this.cache.size > this.maxCacheSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    // Structured logging
    logger.info({
      trace_id: trace.id,
      task_id: trace.taskId,
      decision: trace.decision,
      failure_reason: trace.failureReason,
      total_agents: trace.totalAgents,
      active_agents: trace.activeAgents,
      matching_agents: trace.matchingAgents,
      selected_agent: trace.selectedAgentId,
      confidence: trace.confidence,
      processing_ms: trace.processingTimeMs,
    }, `[DecisionTrace] ${trace.decision} ${trace.failureReason || ''}`);
  }

  /**
   * Get trace for a task (checks cache first, then DB)
   */
  get(taskId: string): DecisionTrace | null {
    // Check cache first
    const cached = this.cache.get(taskId);
    if (cached) return cached;

    // Query DB for latest trace for this task
    const row = db.select()
      .from(schema.decisionTraces)
      .where(eq(schema.decisionTraces.taskId, taskId))
      .orderBy(desc(schema.decisionTraces.createdAt))
      .limit(1)
      .get();

    if (!row) return null;

    const trace = this.rowToTrace(row);
    // Populate cache
    this.cache.set(taskId, trace);
    return trace;
  }

  /**
   * Get all traces from cache (for debugging - use getHistory for full data)
   */
  getAll(): DecisionTrace[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get recent history from DB
   */
  getHistory(limit: number = 100): DecisionTrace[] {
    const rows = db.select()
      .from(schema.decisionTraces)
      .orderBy(desc(schema.decisionTraces.createdAt))
      .limit(limit)
      .all();

    return rows.map(row => this.rowToTrace(row));
  }

  /**
   * Get traces by outcome from DB
   */
  getByOutcome(outcome: DecisionOutcome): DecisionTrace[] {
    const rows = db.select()
      .from(schema.decisionTraces)
      .where(eq(schema.decisionTraces.decision, outcome))
      .orderBy(desc(schema.decisionTraces.createdAt))
      .limit(100)
      .all();

    return rows.map(row => this.rowToTrace(row));
  }

  /**
   * Get statistics from DB
   */
  getStats(): {
    total: number;
    byOutcome: Record<DecisionOutcome, number>;
    byFailureReason: Record<string, number>;
    avgProcessingMs: number;
    avgConfidence: number;
  } {
    // Get counts by outcome
    const outcomeCounts = db.select({
      decision: schema.decisionTraces.decision,
      count: sql<number>`count(*)`,
    })
      .from(schema.decisionTraces)
      .groupBy(schema.decisionTraces.decision)
      .all();

    const byOutcome: Record<DecisionOutcome, number> = {
      assigned: 0,
      no_agents: 0,
      no_active_agents: 0,
      no_match: 0,
      escalated: 0,
      waiting: 0,
      error: 0,
    };

    for (const row of outcomeCounts) {
      if (row.decision in byOutcome) {
        byOutcome[row.decision as DecisionOutcome] = row.count;
      }
    }

    // Get counts by failure reason
    const failureCounts = db.select({
      failureReason: schema.decisionTraces.failureReason,
      count: sql<number>`count(*)`,
    })
      .from(schema.decisionTraces)
      .where(sql`${schema.decisionTraces.failureReason} IS NOT NULL`)
      .groupBy(schema.decisionTraces.failureReason)
      .all();

    const byFailureReason: Record<string, number> = {};
    for (const row of failureCounts) {
      if (row.failureReason) {
        byFailureReason[row.failureReason] = row.count;
      }
    }

    // Get averages
    const avgResult = db.select({
      total: sql<number>`count(*)`,
      avgProcessingMs: sql<number>`avg(${schema.decisionTraces.processingTimeMs})`,
      avgConfidence: sql<number>`avg(${schema.decisionTraces.confidence})`,
    })
      .from(schema.decisionTraces)
      .get();

    return {
      total: avgResult?.total || 0,
      byOutcome,
      byFailureReason,
      avgProcessingMs: avgResult?.avgProcessingMs || 0,
      avgConfidence: avgResult?.avgConfidence || 0,
    };
  }

  /**
   * Clear cache (for testing - does NOT clear DB)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove trace from cache for a task
   */
  remove(taskId: string): void {
    this.cache.delete(taskId);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: DecisionTraceStore | null = null;

export function getDecisionTraceStore(): DecisionTraceStore {
  if (!instance) {
    instance = new DecisionTraceStore();
  }
  return instance;
}

export function resetDecisionTraceStore(): void {
  instance?.clear();
  instance = null;
}

// =============================================================================
// BUILDER HELPER
// =============================================================================

export interface DecisionTraceBuilder {
  taskId: string;
  taskType: string;
  taskPriority: number;
  requiredCapabilities: string[];
  startTime: number;
}

/**
 * Create a decision trace from evaluation results
 */
export function buildDecisionTrace(
  builder: DecisionTraceBuilder,
  agents: Array<{
    id: string;
    name: string;
    status: string;
    capabilities: string[];
  }>,
  selectedAgentId: string | undefined,
  selectionScore: number | undefined,
  selectionReason: string | undefined,
  method: 'heuristic' | 'llm' | 'fallback' | 'cached',
  confidence: number,
  error?: string
): DecisionTrace {
  const now = Date.now();

  // Evaluate each agent
  const evaluatedAgents: EvaluatedAgent[] = agents.map(agent => {
    const isActive = agent.status === 'active';
    const matchScore = calculateMatchScore(builder.requiredCapabilities, agent.capabilities);
    const isMatch = matchScore > 0;
    const isSelected = agent.id === selectedAgentId;

    let exclusionReason: string | undefined;
    if (!isSelected) {
      if (!isActive) {
        exclusionReason = `Agent status is ${agent.status}`;
      } else if (!isMatch) {
        exclusionReason = 'No capability match';
      } else if (selectedAgentId) {
        exclusionReason = 'Lower score than selected agent';
      }
    }

    return {
      agentId: agent.id,
      agentName: agent.name,
      status: agent.status as EvaluatedAgent['status'],
      capabilities: agent.capabilities,
      match: isMatch,
      matchScore,
      matchReason: isMatch
        ? `Matches: ${builder.requiredCapabilities.filter(c =>
            agent.capabilities.some(ac => ac.toLowerCase().includes(c.toLowerCase()))
          ).join(', ')}`
        : undefined,
      exclusionReason,
    };
  });

  // Calculate counts
  const totalAgents = agents.length;
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const matchingAgents = evaluatedAgents.filter(a => a.match && a.status === 'active').length;

  // Determine decision outcome and failure reason
  let decision: DecisionOutcome;
  let failureReason: FailureReason | undefined;
  let explanation: string;

  if (error) {
    decision = 'error';
    failureReason = 'DECISION_ERROR';
    explanation = `Decision failed: ${error}`;
  } else if (selectedAgentId) {
    decision = 'assigned';
    explanation = `Task assigned to agent ${selectedAgentId}`;
  } else if (totalAgents === 0) {
    decision = 'no_agents';
    failureReason = 'NO_AGENTS_REGISTERED';
    explanation = 'No agents registered in the system';
  } else if (activeAgents === 0) {
    decision = 'no_active_agents';
    failureReason = 'NO_ACTIVE_AGENTS';
    explanation = `${totalAgents} agents registered but none are active`;
  } else if (matchingAgents === 0) {
    decision = 'no_match';
    failureReason = 'NO_AGENT_MATCHING_CAPABILITIES';
    explanation = `${activeAgents} active agents but none match required capabilities: ${builder.requiredCapabilities.join(', ')}`;
  } else {
    // Matching agents but none selected - likely escalation
    decision = 'escalated';
    failureReason = 'ESCALATED_TO_HUMAN';
    explanation = 'Task escalated for human review';
  }

  const trace: DecisionTrace = {
    id: `trace_${builder.taskId}_${now}`,
    taskId: builder.taskId,
    createdAt: now,
    decision,
    failureReason,
    explanation,
    evaluatedAgents,
    totalAgents,
    activeAgents,
    matchingAgents,
    selectedAgentId,
    selectionScore,
    selectionReason,
    taskType: builder.taskType,
    taskPriority: builder.taskPriority,
    requiredCapabilities: builder.requiredCapabilities,
    decisionMethod: method,
    confidence,
    processingTimeMs: now - builder.startTime,
    error,
  };

  return trace;
}

/**
 * Calculate capability match score
 */
function calculateMatchScore(required: string[], available: string[]): number {
  if (required.length === 0) return 0.5; // Neutral if no requirements

  const normalizedRequired = required.map(c => c.toLowerCase());
  const normalizedAvailable = available.map(c => c.toLowerCase());

  let matches = 0;
  for (const req of normalizedRequired) {
    if (normalizedAvailable.some(av => av.includes(req) || req.includes(av))) {
      matches++;
    }
  }

  return matches / normalizedRequired.length;
}

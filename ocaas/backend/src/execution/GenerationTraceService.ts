/**
 * Generation Trace Service
 *
 * Provides REAL traceability of what happened during task execution.
 * Eliminates the "black box" problem by tracking:
 * - execution_mode (hooks_session | chat_completion | stub)
 * - ai_requested, ai_attempted, ai_succeeded
 * - fallback_used, fallback_reason
 * - raw_output, final_output
 */

import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { nowTimestamp } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import type { ExecutionMode } from './ExecutionTraceability.js';

const logger = createLogger('GenerationTraceService');

// Max length for raw_output to prevent DB bloat
const MAX_RAW_OUTPUT_LENGTH = 10000;

/**
 * Generation trace input data
 */
export interface GenerationTraceInput {
  taskId: string;
  jobId?: string;
  executionMode: ExecutionMode;
  aiRequested: boolean;
  aiAttempted: boolean;
  aiSucceeded: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  rawOutput?: string;
  finalOutput?: string;
  tokenUsage?: { input: number; output: number };
  model?: string;
  durationMs?: number;
  error?: string;
}

/**
 * Generation trace record (stored in DB)
 */
export interface GenerationTrace {
  id: string;
  taskId: string;
  jobId?: string;
  executionMode: ExecutionMode;
  aiRequested: boolean;
  aiAttempted: boolean;
  aiSucceeded: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  rawOutput?: string;
  finalOutput?: string;
  tokenUsage?: { input: number; output: number };
  model?: string;
  durationMs?: number;
  error?: string;
  createdAt: number;
}

/**
 * Generation Trace Service singleton
 */
class GenerationTraceServiceImpl {
  /**
   * Save a generation trace
   */
  save(input: GenerationTraceInput): GenerationTrace {
    const id = `gt_${nanoid(12)}`;
    const now = nowTimestamp();

    // Truncate raw output if too long
    let rawOutput = input.rawOutput;
    if (rawOutput && rawOutput.length > MAX_RAW_OUTPUT_LENGTH) {
      rawOutput = rawOutput.slice(0, MAX_RAW_OUTPUT_LENGTH) + '\n...[truncated]';
    }

    const record = {
      id,
      taskId: input.taskId,
      jobId: input.jobId ?? null,
      executionMode: input.executionMode,
      aiRequested: input.aiRequested,
      aiAttempted: input.aiAttempted,
      aiSucceeded: input.aiSucceeded,
      fallbackUsed: input.fallbackUsed,
      fallbackReason: input.fallbackReason ?? null,
      rawOutput: rawOutput ?? null,
      finalOutput: input.finalOutput ?? null,
      tokenUsage: input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
      model: input.model ?? null,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
      createdAt: now,
    };

    db.insert(schema.generationTraces).values(record).run();

    logger.info({
      id,
      taskId: input.taskId,
      jobId: input.jobId,
      executionMode: input.executionMode,
      aiSucceeded: input.aiSucceeded,
      fallbackUsed: input.fallbackUsed,
    }, 'Generation trace saved');

    // Return directly constructed trace to avoid type issues
    return {
      id: record.id,
      taskId: record.taskId,
      jobId: record.jobId ?? undefined,
      executionMode: record.executionMode as ExecutionMode,
      aiRequested: record.aiRequested,
      aiAttempted: record.aiAttempted,
      aiSucceeded: record.aiSucceeded,
      fallbackUsed: record.fallbackUsed,
      fallbackReason: record.fallbackReason ?? undefined,
      rawOutput: record.rawOutput ?? undefined,
      finalOutput: record.finalOutput ?? undefined,
      tokenUsage: input.tokenUsage,
      model: record.model ?? undefined,
      durationMs: record.durationMs ?? undefined,
      error: record.error ?? undefined,
      createdAt: record.createdAt,
    };
  }

  /**
   * Get generation trace for a task (most recent)
   */
  getByTask(taskId: string): GenerationTrace | null {
    const row = db.select()
      .from(schema.generationTraces)
      .where(eq(schema.generationTraces.taskId, taskId))
      .orderBy(desc(schema.generationTraces.createdAt))
      .limit(1)
      .get();

    return row ? this.rowToTrace(row) : null;
  }

  /**
   * Get generation trace by job ID
   */
  getByJob(jobId: string): GenerationTrace | null {
    const row = db.select()
      .from(schema.generationTraces)
      .where(eq(schema.generationTraces.jobId, jobId))
      .orderBy(desc(schema.generationTraces.createdAt))
      .limit(1)
      .get();

    return row ? this.rowToTrace(row) : null;
  }

  /**
   * Get all traces for a task (history)
   */
  listByTask(taskId: string): GenerationTrace[] {
    const rows = db.select()
      .from(schema.generationTraces)
      .where(eq(schema.generationTraces.taskId, taskId))
      .orderBy(desc(schema.generationTraces.createdAt))
      .all();

    return rows.map(r => this.rowToTrace(r));
  }

  /**
   * Convert DB row to GenerationTrace
   */
  private rowToTrace(row: typeof schema.generationTraces.$inferSelect): GenerationTrace {
    return {
      id: row.id,
      taskId: row.taskId,
      jobId: row.jobId ?? undefined,
      executionMode: row.executionMode as ExecutionMode,
      aiRequested: Boolean(row.aiRequested),
      aiAttempted: Boolean(row.aiAttempted),
      aiSucceeded: Boolean(row.aiSucceeded),
      fallbackUsed: Boolean(row.fallbackUsed),
      fallbackReason: row.fallbackReason ?? undefined,
      rawOutput: row.rawOutput ?? undefined,
      finalOutput: row.finalOutput ?? undefined,
      tokenUsage: row.tokenUsage ? JSON.parse(row.tokenUsage) : undefined,
      model: row.model ?? undefined,
      durationMs: row.durationMs ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.createdAt,
    };
  }
}

// Singleton instance
let instance: GenerationTraceServiceImpl | null = null;

export function getGenerationTraceService(): GenerationTraceServiceImpl {
  if (!instance) {
    instance = new GenerationTraceServiceImpl();
  }
  return instance;
}

export function resetGenerationTraceService(): void {
  instance = null;
}

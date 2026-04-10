/**
 * ToolExecutionAuditService
 *
 * Persistent audit logging for all tool executions.
 * Creates immutable records for compliance, debugging, and forensics.
 *
 * Features:
 * - Writes to dedicated audit log file (separate from app logs)
 * - Each entry is immutable and timestamped
 * - Structured JSON format for easy parsing
 * - Sync writes to ensure durability
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';
import { nanoid } from 'nanoid';
import type { ToolExecutionAuditEntry } from './types.js';
import type { ToolExecutionResult, InputValidationResult, SecurityCheckResult } from './ToolExecutionService.js';

const logger = createLogger('ToolExecutionAuditService');

/** Default audit log directory */
const DEFAULT_AUDIT_DIR = './logs/audit';

/** Audit log file name */
const AUDIT_FILE_NAME = 'tool-execution-audit.jsonl';

/** Maximum entries to keep in memory buffer */
const MAX_BUFFER_SIZE = 100;

/**
 * ToolExecutionAuditService - Singleton
 */
export class ToolExecutionAuditService {
  private auditDir: string;
  private auditFilePath: string;
  private initialized: boolean = false;
  private buffer: ToolExecutionAuditEntry[] = [];
  private writeStream: fs.WriteStream | null = null;

  constructor(options?: { auditDir?: string }) {
    this.auditDir = options?.auditDir || DEFAULT_AUDIT_DIR;
    this.auditFilePath = path.join(this.auditDir, AUDIT_FILE_NAME);
  }

  /**
   * Initialize the audit service (create directory and file)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Create audit directory if it doesn't exist
      if (!fs.existsSync(this.auditDir)) {
        fs.mkdirSync(this.auditDir, { recursive: true });
        logger.info({ auditDir: this.auditDir }, '[Audit] Created audit directory');
      }

      // Open write stream for appending
      this.writeStream = fs.createWriteStream(this.auditFilePath, {
        flags: 'a',
        encoding: 'utf8',
      });

      this.initialized = true;
      logger.info({
        auditFilePath: this.auditFilePath,
        event: 'AUDIT_SERVICE_INITIALIZED',
      }, '[Audit] Service initialized');
    } catch (err) {
      logger.error({ err }, '[Audit] Failed to initialize audit service');
      // Don't throw - audit should not break execution
    }
  }

  /**
   * Record a tool execution for audit
   */
  async recordExecution(
    input: {
      executionId: string;
      toolName: string;
      toolType: ToolExecutionAuditEntry['toolType'];
      taskId: string;
      jobId?: string;
      agentId: string;
      inputSummary?: string;
    },
    result: ToolExecutionResult,
    validation?: InputValidationResult,
    security?: SecurityCheckResult
  ): Promise<void> {
    const entry: ToolExecutionAuditEntry = {
      id: `audit_${nanoid(12)}`,
      executionId: input.executionId,
      timestamp: Date.now(),
      toolName: input.toolName,
      toolType: input.toolType,
      taskId: input.taskId,
      jobId: input.jobId,
      agentId: input.agentId,
      success: result.success,
      durationMs: result.durationMs,
      inputSummary: input.inputSummary,
      outputSummary: this.summarizeOutput(result.output),
      errorCode: result.error?.code,
      errorMessage: result.error?.message,
      securityPassed: security?.passed,
      securityFailureCode: security?.failureCode,
      inputValidationPassed: validation?.valid,
      inputValidationErrors: validation?.errors,
    };

    await this.writeEntry(entry);
  }

  /**
   * Record a blocked execution (by limits or security)
   */
  async recordBlocked(
    input: {
      executionId: string;
      toolName: string;
      toolType: ToolExecutionAuditEntry['toolType'];
      taskId: string;
      jobId?: string;
      agentId: string;
    },
    reason: 'security' | 'limits' | 'validation',
    details: {
      securityFailureCode?: string;
      limitExceeded?: string;
      validationErrors?: string[];
    }
  ): Promise<void> {
    const entry: ToolExecutionAuditEntry = {
      id: `audit_${nanoid(12)}`,
      executionId: input.executionId,
      timestamp: Date.now(),
      toolName: input.toolName,
      toolType: input.toolType,
      taskId: input.taskId,
      jobId: input.jobId,
      agentId: input.agentId,
      success: false,
      durationMs: 0,
      errorCode: `blocked_${reason}`,
      errorMessage: `Execution blocked: ${reason}`,
      securityPassed: reason === 'security' ? false : undefined,
      securityFailureCode: details.securityFailureCode,
      inputValidationPassed: reason === 'validation' ? false : undefined,
      inputValidationErrors: details.validationErrors,
      blockedByLimits: reason === 'limits',
      limitExceeded: details.limitExceeded,
    };

    await this.writeEntry(entry);
  }

  /**
   * Write an entry to the audit log
   */
  private async writeEntry(entry: ToolExecutionAuditEntry): Promise<void> {
    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const line = JSON.stringify(entry) + '\n';

      if (this.writeStream && this.writeStream.writable) {
        // Write to stream (async but doesn't block)
        this.writeStream.write(line);
      } else {
        // Fallback to sync write if stream not available
        fs.appendFileSync(this.auditFilePath, line, 'utf8');
      }

      // Also keep in memory buffer for recent queries
      this.buffer.push(entry);
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.shift();
      }

      logger.debug({
        auditId: entry.id,
        executionId: entry.executionId,
        toolName: entry.toolName,
        success: entry.success,
        event: 'AUDIT_ENTRY_RECORDED',
      }, `[Audit] Recorded execution: ${entry.toolName}`);
    } catch (err) {
      logger.error({ err, entry }, '[Audit] Failed to write audit entry');
      // Don't throw - audit should not break execution
    }
  }

  /**
   * Get recent audit entries (from buffer)
   */
  getRecentEntries(limit: number = 50): ToolExecutionAuditEntry[] {
    return this.buffer.slice(-limit);
  }

  /**
   * Get audit entries for a specific task
   */
  getEntriesForTask(taskId: string): ToolExecutionAuditEntry[] {
    return this.buffer.filter(e => e.taskId === taskId);
  }

  /**
   * Flush and close the audit stream
   */
  async close(): Promise<void> {
    if (this.writeStream) {
      return new Promise((resolve) => {
        this.writeStream!.end(() => {
          this.writeStream = null;
          this.initialized = false;
          logger.info('[Audit] Service closed');
          resolve();
        });
      });
    }
  }

  /**
   * Summarize output for audit (truncate large outputs)
   */
  private summarizeOutput(output?: ToolExecutionResult['output']): string | undefined {
    if (!output) return undefined;

    const parts: string[] = [];
    if (output.stdout) {
      parts.push(`stdout:${output.stdout.slice(0, 50)}${output.stdout.length > 50 ? '...' : ''}`);
    }
    if (output.stderr) {
      parts.push(`stderr:${output.stderr.slice(0, 50)}${output.stderr.length > 50 ? '...' : ''}`);
    }
    if (output.exitCode !== undefined) {
      parts.push(`exit:${output.exitCode}`);
    }

    return parts.length > 0 ? parts.join('|') : undefined;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: ToolExecutionAuditService | null = null;

export function getToolExecutionAuditService(): ToolExecutionAuditService {
  if (!instance) {
    instance = new ToolExecutionAuditService();
  }
  return instance;
}

export function resetToolExecutionAuditService(): void {
  if (instance) {
    instance.close().catch(() => {});
  }
  instance = null;
}

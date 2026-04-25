import { createLogger } from '../utils/logger.js';
import type { TaskDTO } from '../types/domain.js';
import type { QueuedTask } from './types.js';

const logger = createLogger('QueueManager');

export class QueueManager {
  private queue: QueuedTask[] = [];
  private processing = new Set<string>();
  private processingBatches = new Set<string>(); // Batches with running tasks
  private sequentialMode = false; // Global sequential mode
  // Store processing tasks metadata for markDone/getTask lookups
  private processingTasks = new Map<string, QueuedTask>();

  setSequentialMode(enabled: boolean): void {
    this.sequentialMode = enabled;
    logger.info({ sequentialMode: enabled }, 'Sequential mode changed');
  }

  isSequentialMode(): boolean {
    return this.sequentialMode;
  }

  add(task: TaskDTO): void {
    if (this.has(task.id)) {
      logger.warn({ taskId: task.id }, 'Task already in queue');
      return;
    }

    this.queue.push({
      task,
      addedAt: Date.now(),
      attempts: 0,
    });

    // Sort by: priority (higher first), then sequenceOrder (lower first), then addedAt (older first)
    this.queue.sort((a, b) => {
      // First by priority
      if (b.task.priority !== a.task.priority) {
        return b.task.priority - a.task.priority;
      }
      // Then by sequence order within same batch
      if (a.task.batchId && a.task.batchId === b.task.batchId) {
        const seqA = a.task.sequenceOrder ?? 999;
        const seqB = b.task.sequenceOrder ?? 999;
        if (seqA !== seqB) return seqA - seqB;
      }
      // Finally by time added
      return a.addedAt - b.addedAt;
    });

    logger.info({
      taskId: task.id,
      priority: task.priority,
      batchId: task.batchId,
      sequenceOrder: task.sequenceOrder,
      queueSize: this.queue.length
    }, 'Task added to queue');
  }

  remove(taskId: string): boolean {
    const index = this.queue.findIndex(q => q.task.id === taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.processing.delete(taskId);
      return true;
    }
    return false;
  }

  has(taskId: string): boolean {
    return this.queue.some(q => q.task.id === taskId) || this.processing.has(taskId);
  }

  peek(): QueuedTask | null {
    // In sequential mode, only one task at a time globally
    if (this.sequentialMode && this.processing.size > 0) {
      return null;
    }

    for (const item of this.queue) {
      if (this.processing.has(item.task.id)) continue;

      // Check batch constraints: only one task per batch at a time
      if (item.task.batchId && this.processingBatches.has(item.task.batchId)) {
        continue;
      }

      return item;
    }
    return null;
  }

  pop(): QueuedTask | null {
    const item = this.peek();
    if (item) {
      const index = this.queue.findIndex(q => q.task.id === item.task.id);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
    }
    return item;
  }

  markProcessing(taskId: string): void {
    // FIX: Move task from queue to processing (not just add to processing set)
    // This prevents head-of-line blocking where a processing task still sits at queue[0]
    const index = this.queue.findIndex(q => q.task.id === taskId);
    if (index >= 0) {
      const item = this.queue[index]!;
      // Store metadata for later lookups (getTask, markDone, etc.)
      this.processingTasks.set(taskId, item);
      // Remove from queue
      this.queue.splice(index, 1);
      // Track batch lock
      if (item.task.batchId) {
        this.processingBatches.add(item.task.batchId);
      }
      logger.debug({ taskId, queueSize: this.queue.length }, 'Task moved from queue to processing');
    }
    this.processing.add(taskId);
  }

  markDone(taskId: string): void {
    // FIX: Get task from processingTasks first (where it should be after markProcessing)
    // Fall back to queue for safety
    const processingItem = this.processingTasks.get(taskId);
    const queueItem = this.queue.find(q => q.task.id === taskId);
    const item = processingItem || queueItem;
    const batchId = item?.task.batchId;

    // Clean up from all tracking structures
    this.processing.delete(taskId);
    this.processingTasks.delete(taskId);
    // Also remove from queue if somehow still there
    const index = this.queue.findIndex(q => q.task.id === taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }

    // FIX: Recalculate batch locks instead of simple delete
    // Only release batch lock if no other tasks from same batch are still processing
    if (batchId) {
      this.recalculateProcessingBatches();
    }

    logger.debug({ taskId, batchId, queueSize: this.queue.length, processingCount: this.processing.size }, 'Task marked done');
  }

  /**
   * Recalculate processingBatches based on tasks actually in processing
   * This ensures we don't prematurely release batch locks
   */
  private recalculateProcessingBatches(): void {
    this.processingBatches.clear();
    for (const [, item] of this.processingTasks) {
      if (item.task.batchId) {
        this.processingBatches.add(item.task.batchId);
      }
    }
  }

  incrementAttempts(taskId: string): number {
    const item = this.queue.find(q => q.task.id === taskId);
    if (item) {
      item.attempts++;
      return item.attempts;
    }
    return 0;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }

  getAll(): QueuedTask[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
    this.processing.clear();
    this.processingTasks.clear();
    this.processingBatches.clear();
  }

  getByBatch(batchId: string): QueuedTask[] {
    return this.queue.filter(q => q.task.batchId === batchId);
  }

  isBatchProcessing(batchId: string): boolean {
    return this.processingBatches.has(batchId);
  }

  getStatus(): {
    queueSize: number;
    processing: number;
    sequentialMode: boolean;
    batchesProcessing: number;
  } {
    return {
      queueSize: this.queue.length,
      processing: this.processing.size,
      sequentialMode: this.sequentialMode,
      batchesProcessing: this.processingBatches.size,
    };
  }

  /**
   * Get a specific task from queue or processing (for priority retry, etc.)
   */
  getTask(taskId: string): QueuedTask | null {
    // Check processingTasks first (task may have been moved there by markProcessing)
    const processingItem = this.processingTasks.get(taskId);
    if (processingItem) return processingItem;
    // Fall back to queue
    return this.queue.find(q => q.task.id === taskId) || null;
  }

  /**
   * Move a task to the front of its priority level (for retry after generation)
   */
  prioritizeTask(taskId: string): boolean {
    const index = this.queue.findIndex(q => q.task.id === taskId);
    if (index < 0) return false;

    const item = this.queue[index]!;
    // Move to front by setting addedAt to 0 (oldest)
    item.addedAt = 0;

    // Re-sort to move it to front of its priority level
    this.queue.sort((a, b) => {
      if (b.task.priority !== a.task.priority) {
        return b.task.priority - a.task.priority;
      }
      if (a.task.batchId && a.task.batchId === b.task.batchId) {
        const seqA = a.task.sequenceOrder ?? 999;
        const seqB = b.task.sequenceOrder ?? 999;
        if (seqA !== seqB) return seqA - seqB;
      }
      return a.addedAt - b.addedAt;
    });

    logger.info({ taskId }, 'Task prioritized for retry');
    return true;
  }
}

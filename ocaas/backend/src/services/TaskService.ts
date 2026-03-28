import { nanoid } from 'nanoid';
import { eq, desc, and, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { nowTimestamp, parseJsonSafe } from '../utils/helpers.js';
import { EVENT_TYPE, TASK_STATUS, TASK_PRIORITY } from '../config/constants.js';
import type { EventService } from './EventService.js';
import type { TaskDTO, TaskStatus, TaskPriority } from '../types/domain.js';

const logger = createLogger('TaskService');

export interface CreateTaskInput {
  title: string;
  description?: string;
  type?: string;
  priority?: TaskPriority;
  agentId?: string;
  parentTaskId?: string;
  batchId?: string;
  dependsOn?: string[];
  sequenceOrder?: number;
  maxRetries?: number;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  type?: string;
  priority?: TaskPriority;
  agentId?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function rowToDTO(row: typeof schema.tasks.$inferSelect): TaskDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    type: row.type,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    agentId: row.agentId ?? undefined,
    parentTaskId: row.parentTaskId ?? undefined,
    batchId: row.batchId ?? undefined,
    dependsOn: parseJsonSafe(row.dependsOn) as string[] | undefined,
    sequenceOrder: row.sequenceOrder ?? undefined,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    input: parseJsonSafe(row.input),
    output: parseJsonSafe(row.output),
    error: row.error ?? undefined,
    metadata: parseJsonSafe(row.metadata),
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TaskService {
  constructor(private eventService: EventService) {}

  async list(opts?: { status?: TaskStatus; agentId?: string; limit?: number }): Promise<TaskDTO[]> {
    const limit = opts?.limit ?? 100;
    const conditions = [];

    if (opts?.status) conditions.push(eq(schema.tasks.status, opts.status));
    if (opts?.agentId) conditions.push(eq(schema.tasks.agentId, opts.agentId));

    const query = conditions.length > 0
      ? db.select().from(schema.tasks).where(and(...conditions))
      : db.select().from(schema.tasks);

    const rows = await query.orderBy(desc(schema.tasks.createdAt)).limit(limit);
    return rows.map(rowToDTO);
  }

  async getById(id: string): Promise<TaskDTO> {
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundError('Task', id);
    return rowToDTO(rows[0]!);
  }

  async create(input: CreateTaskInput): Promise<TaskDTO> {
    const now = nowTimestamp();
    const id = nanoid();

    await db.insert(schema.tasks).values({
      id,
      title: input.title,
      description: input.description,
      type: input.type ?? 'generic',
      status: TASK_STATUS.PENDING,
      priority: input.priority ?? TASK_PRIORITY.NORMAL,
      agentId: input.agentId,
      parentTaskId: input.parentTaskId,
      batchId: input.batchId,
      dependsOn: input.dependsOn ? JSON.stringify(input.dependsOn) : null,
      sequenceOrder: input.sequenceOrder,
      maxRetries: input.maxRetries ?? 3,
      input: input.input ? JSON.stringify(input.input) : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ id, title: input.title, batchId: input.batchId, sequenceOrder: input.sequenceOrder }, 'Task created');

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_CREATED,
      category: 'task',
      message: `Task '${input.title}' created`,
      resourceType: 'task',
      resourceId: id,
    });

    return this.getById(id);
  }

  async update(id: string, input: UpdateTaskInput): Promise<TaskDTO> {
    await this.getById(id);
    const now = nowTimestamp();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.type !== undefined) updates.type = input.type;
    if (input.priority !== undefined) updates.priority = input.priority;
    if (input.agentId !== undefined) updates.agentId = input.agentId;
    if (input.input !== undefined) updates.input = JSON.stringify(input.input);
    if (input.metadata !== undefined) updates.metadata = JSON.stringify(input.metadata);

    await db.update(schema.tasks).set(updates).where(eq(schema.tasks.id, id));
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
  }

  async assign(id: string, agentId: string): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      agentId,
      status: TASK_STATUS.ASSIGNED,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_ASSIGNED,
      category: 'task',
      message: `Task '${task.title}' assigned`,
      resourceType: 'task',
      resourceId: id,
      agentId,
    });

    return this.getById(id);
  }

  async start(id: string): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      status: TASK_STATUS.RUNNING,
      startedAt: now,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_STARTED,
      category: 'task',
      message: `Task '${task.title}' started`,
      resourceType: 'task',
      resourceId: id,
      agentId: task.agentId,
    });

    return this.getById(id);
  }

  async complete(id: string, output?: Record<string, unknown>): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      status: TASK_STATUS.COMPLETED,
      output: output ? JSON.stringify(output) : null,
      completedAt: now,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_COMPLETED,
      category: 'task',
      message: `Task '${task.title}' completed`,
      resourceType: 'task',
      resourceId: id,
      agentId: task.agentId,
    });

    return this.getById(id);
  }

  async fail(id: string, error: string): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      status: TASK_STATUS.FAILED,
      error,
      completedAt: now,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_FAILED,
      category: 'task',
      severity: 'error',
      message: `Task '${task.title}' failed: ${error}`,
      resourceType: 'task',
      resourceId: id,
      agentId: task.agentId,
      data: { error },
    });

    return this.getById(id);
  }

  async cancel(id: string): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      status: TASK_STATUS.CANCELLED,
      completedAt: now,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    await this.eventService.emit({
      type: EVENT_TYPE.TASK_CANCELLED,
      category: 'task',
      message: `Task '${task.title}' cancelled`,
      resourceType: 'task',
      resourceId: id,
    });

    return this.getById(id);
  }

  async queue(id: string): Promise<TaskDTO> {
    const now = nowTimestamp();
    await db.update(schema.tasks).set({
      status: TASK_STATUS.QUEUED,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));
    return this.getById(id);
  }

  async getPending(): Promise<TaskDTO[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(inArray(schema.tasks.status, [TASK_STATUS.PENDING, TASK_STATUS.QUEUED]))
      .orderBy(desc(schema.tasks.priority), schema.tasks.createdAt);
    return rows.map(rowToDTO);
  }

  async getRunning(): Promise<TaskDTO[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, TASK_STATUS.RUNNING));
    return rows.map(rowToDTO);
  }

  async getByAgent(agentId: string): Promise<TaskDTO[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.agentId, agentId))
      .orderBy(desc(schema.tasks.createdAt))
      .limit(50);
    return rows.map(rowToDTO);
  }

  async getByBatch(batchId: string): Promise<TaskDTO[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.batchId, batchId))
      .orderBy(schema.tasks.sequenceOrder);
    return rows.map(rowToDTO);
  }

  async incrementRetry(id: string): Promise<TaskDTO> {
    const task = await this.getById(id);
    const now = nowTimestamp();

    await db.update(schema.tasks).set({
      retryCount: task.retryCount + 1,
      status: TASK_STATUS.PENDING, // Re-queue for retry
      error: null,
      updatedAt: now,
    }).where(eq(schema.tasks.id, id));

    logger.info({ id, retryCount: task.retryCount + 1 }, 'Task retry incremented');
    return this.getById(id);
  }

  async areDependenciesMet(task: TaskDTO): Promise<boolean> {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return true;
    }

    for (const depId of task.dependsOn) {
      const depTask = await this.getById(depId).catch(() => null);
      if (!depTask || depTask.status !== TASK_STATUS.COMPLETED) {
        return false;
      }
    }
    return true;
  }

  async getNextInSequence(batchId: string): Promise<TaskDTO | null> {
    const batchTasks = await this.getByBatch(batchId);

    // Find the first pending task in sequence order
    for (const task of batchTasks) {
      if (task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.QUEUED) {
        // Check if dependencies are met
        const canRun = await this.areDependenciesMet(task);
        if (canRun) {
          return task;
        }
      }
    }
    return null;
  }

  async isBatchComplete(batchId: string): Promise<boolean> {
    const tasks = await this.getByBatch(batchId);
    return tasks.every(t =>
      t.status === TASK_STATUS.COMPLETED ||
      t.status === TASK_STATUS.FAILED ||
      t.status === TASK_STATUS.CANCELLED
    );
  }

  /**
   * Get all subtasks for a parent task
   */
  async getSubtasks(parentTaskId: string): Promise<TaskDTO[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.parentTaskId, parentTaskId))
      .orderBy(schema.tasks.sequenceOrder, schema.tasks.createdAt);
    return rows.map(rowToDTO);
  }

  /**
   * Check if all subtasks of a parent are completed
   */
  async areSubtasksComplete(parentTaskId: string): Promise<boolean> {
    const subtasks = await this.getSubtasks(parentTaskId);
    if (subtasks.length === 0) return true;
    return subtasks.every(t =>
      t.status === TASK_STATUS.COMPLETED ||
      t.status === TASK_STATUS.FAILED ||
      t.status === TASK_STATUS.CANCELLED
    );
  }

  /**
   * Check if all subtasks completed successfully
   */
  async areSubtasksSuccessful(parentTaskId: string): Promise<boolean> {
    const subtasks = await this.getSubtasks(parentTaskId);
    if (subtasks.length === 0) return true;
    return subtasks.every(t => t.status === TASK_STATUS.COMPLETED);
  }

  /**
   * Get the next pending subtask for a parent
   */
  async getNextSubtask(parentTaskId: string): Promise<TaskDTO | null> {
    const subtasks = await this.getSubtasks(parentTaskId);
    for (const subtask of subtasks) {
      if (subtask.status === TASK_STATUS.PENDING || subtask.status === TASK_STATUS.QUEUED) {
        const canRun = await this.areDependenciesMet(subtask);
        if (canRun) return subtask;
      }
    }
    return null;
  }

  /**
   * Mark parent task as decomposed (add metadata flag)
   */
  async markAsDecomposed(parentTaskId: string, subtaskCount: number): Promise<TaskDTO> {
    const task = await this.getById(parentTaskId);
    const now = nowTimestamp();

    const metadata = {
      ...task.metadata,
      _decomposed: true,
      _subtaskCount: subtaskCount,
      _decomposedAt: now,
    };

    await db.update(schema.tasks).set({
      metadata: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(schema.tasks.id, parentTaskId));

    return this.getById(parentTaskId);
  }

  /**
   * Check if a task has been decomposed
   */
  isDecomposed(task: TaskDTO): boolean {
    return Boolean(task.metadata?._decomposed);
  }
}

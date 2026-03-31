import { nanoid } from 'nanoid';
import { orchestratorLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import { getTaskAnalyzer } from './TaskAnalyzer.js';
import { getAutonomyConfig } from '../config/autonomy.js';
import { EVENT_TYPE } from '../config/constants.js';
import type { TaskDTO } from '../types/domain.js';
import type { TaskAnalysis, SubtaskSuggestion } from './types.js';

const logger = orchestratorLogger.child({ component: 'TaskDecomposer' });

// Configuration
const MIN_CONFIDENCE_FOR_DECOMPOSITION = 0.6;
const MAX_SUBTASKS = 10;
const MIN_SUBTASKS = 2;

export interface DecompositionResult {
  decomposed: boolean;
  parentTaskId: string;
  subtaskIds: string[];
  reason: string;
}

export class TaskDecomposer {
  /**
   * Check if a task should be decomposed based on its analysis
   */
  shouldDecompose(task: TaskDTO, analysis: TaskAnalysis): boolean {
    // Don't decompose if already a subtask
    if (task.parentTaskId) {
      return false;
    }

    // Don't decompose if already decomposed
    if (task.metadata?._decomposed) {
      return false;
    }

    // Check analysis conditions
    if (!analysis.canBeSubdivided) {
      return false;
    }

    // Need suggested subtasks
    if (!analysis.suggestedSubtasks || analysis.suggestedSubtasks.length < MIN_SUBTASKS) {
      return false;
    }

    // Check confidence threshold
    if (analysis.confidence < MIN_CONFIDENCE_FOR_DECOMPOSITION) {
      logger.debug({
        taskId: task.id,
        confidence: analysis.confidence,
        threshold: MIN_CONFIDENCE_FOR_DECOMPOSITION,
      }, 'Confidence too low for decomposition');
      return false;
    }

    // Complex tasks are better candidates
    if (analysis.complexity === 'high') {
      return true;
    }

    // Medium complexity with multiple subtasks
    if (analysis.complexity === 'medium' && analysis.suggestedSubtasks.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * Decompose a task into subtasks
   */
  async decompose(task: TaskDTO, analysis: TaskAnalysis): Promise<DecompositionResult> {
    const { taskService, eventService } = getServices();
    const autonomyConfig = getAutonomyConfig();

    // Check autonomy level - manual mode requires explicit approval
    if (autonomyConfig.level === 'manual') {
      return {
        decomposed: false,
        parentTaskId: task.id,
        subtaskIds: [],
        reason: 'Manual mode - decomposition requires human approval',
      };
    }

    if (!analysis.suggestedSubtasks || analysis.suggestedSubtasks.length === 0) {
      return {
        decomposed: false,
        parentTaskId: task.id,
        subtaskIds: [],
        reason: 'No subtasks suggested by analysis',
      };
    }

    // Emit decomposition started event
    await eventService.emit({
      type: EVENT_TYPE.TASK_DECOMPOSITION_STARTED,
      category: 'orchestrator',
      severity: 'info',
      message: `Decomposing task "${task.title}" into ${analysis.suggestedSubtasks.length} subtasks`,
      resourceType: 'task',
      resourceId: task.id,
      data: {
        subtaskCount: analysis.suggestedSubtasks.length,
        complexity: analysis.complexity,
        taskType: analysis.taskType,
      },
    });

    const subtaskIds: string[] = [];
    const batchId = `decomp_${task.id}_${nanoid(6)}`;

    try {
      // Limit subtasks to prevent runaway decomposition
      const subtasksToCreate = analysis.suggestedSubtasks.slice(0, MAX_SUBTASKS);

      for (let i = 0; i < subtasksToCreate.length; i++) {
        const suggestion = subtasksToCreate[i]!;
        const prevSubtaskId = i > 0 ? subtaskIds[i - 1] : undefined;

        const subtask = await taskService.create({
          title: suggestion.title,
          description: suggestion.description,
          type: suggestion.type || task.type,
          priority: task.priority,
          parentTaskId: task.id,
          batchId,
          sequenceOrder: suggestion.order || i + 1,
          dependsOn: suggestion.dependsOnPrevious && prevSubtaskId ? [prevSubtaskId] : undefined,
          maxRetries: task.maxRetries,
          metadata: {
            _parentTitle: task.title,
            _fromDecomposition: true,
            _originalAnalysis: {
              taskType: analysis.taskType,
              requiredCapabilities: analysis.requiredCapabilities,
            },
          },
          input: task.input, // Inherit parent input
        });

        subtaskIds.push(subtask.id);

        // Emit subtask created event
        await eventService.emit({
          type: EVENT_TYPE.SUBTASK_CREATED,
          category: 'orchestrator',
          severity: 'info',
          message: `Subtask "${subtask.title}" created for parent "${task.title}"`,
          resourceType: 'task',
          resourceId: subtask.id,
          data: {
            parentTaskId: task.id,
            order: suggestion.order || i + 1,
            dependsOnPrevious: suggestion.dependsOnPrevious,
          },
        });

        logger.info({
          subtaskId: subtask.id,
          parentTaskId: task.id,
          order: suggestion.order || i + 1,
          title: subtask.title,
        }, 'Subtask created');
      }

      // Mark parent task as decomposed
      await taskService.markAsDecomposed(task.id, subtaskIds.length);

      // Emit decomposition completed event
      await eventService.emit({
        type: EVENT_TYPE.TASK_DECOMPOSITION_COMPLETED,
        category: 'orchestrator',
        severity: 'info',
        message: `Task "${task.title}" decomposed into ${subtaskIds.length} subtasks`,
        resourceType: 'task',
        resourceId: task.id,
        data: {
          subtaskIds,
          batchId,
          complexity: analysis.complexity,
        },
      });

      logger.info({
        parentTaskId: task.id,
        subtaskCount: subtaskIds.length,
        batchId,
      }, 'Task decomposed successfully');

      return {
        decomposed: true,
        parentTaskId: task.id,
        subtaskIds,
        reason: `Decomposed into ${subtaskIds.length} subtasks`,
      };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, taskId: task.id }, 'Failed to decompose task');

      await eventService.emit({
        type: EVENT_TYPE.TASK_DECOMPOSITION_FAILED,
        category: 'orchestrator',
        severity: 'error',
        message: `Failed to decompose task "${task.title}": ${errorMsg}`,
        resourceType: 'task',
        resourceId: task.id,
        data: { error: errorMsg },
      });

      return {
        decomposed: false,
        parentTaskId: task.id,
        subtaskIds,
        reason: `Decomposition failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Check if parent task should be completed after subtask completion
   */
  async checkParentCompletion(subtask: TaskDTO): Promise<void> {
    if (!subtask.parentTaskId) return;

    const { taskService, eventService } = getServices();

    const allComplete = await taskService.areSubtasksComplete(subtask.parentTaskId);
    if (!allComplete) return;

    const allSuccessful = await taskService.areSubtasksSuccessful(subtask.parentTaskId);
    const parent = await taskService.getById(subtask.parentTaskId);

    if (allSuccessful) {
      // Aggregate outputs from subtasks
      const subtasks = await taskService.getSubtasks(subtask.parentTaskId);
      const aggregatedOutput = {
        subtaskResults: subtasks.map(st => ({
          id: st.id,
          title: st.title,
          output: st.output,
        })),
        completedAt: Date.now(),
      };

      await taskService.complete(subtask.parentTaskId, aggregatedOutput);

      await eventService.emit({
        type: EVENT_TYPE.PARENT_TASK_COMPLETED,
        category: 'orchestrator',
        severity: 'info',
        message: `Parent task "${parent.title}" completed after all subtasks finished`,
        resourceType: 'task',
        resourceId: subtask.parentTaskId,
        data: {
          subtaskCount: subtasks.length,
          allSuccessful: true,
        },
      });

      logger.info({
        parentTaskId: subtask.parentTaskId,
        subtaskCount: subtasks.length,
      }, 'Parent task completed - all subtasks successful');

    } else {
      // Some subtasks failed
      const subtasks = await taskService.getSubtasks(subtask.parentTaskId);
      const failed = subtasks.filter(st => st.status === 'failed');

      await taskService.fail(
        subtask.parentTaskId,
        `${failed.length} of ${subtasks.length} subtasks failed`
      );

      await eventService.emit({
        type: EVENT_TYPE.PARENT_TASK_COMPLETED,
        category: 'orchestrator',
        severity: 'warning',
        message: `Parent task "${parent.title}" failed - ${failed.length} subtasks failed`,
        resourceType: 'task',
        resourceId: subtask.parentTaskId,
        data: {
          subtaskCount: subtasks.length,
          failedCount: failed.length,
          allSuccessful: false,
        },
      });

      logger.warn({
        parentTaskId: subtask.parentTaskId,
        failedCount: failed.length,
        totalCount: subtasks.length,
      }, 'Parent task failed - some subtasks failed');
    }
  }
}

// Singleton
let taskDecomposerInstance: TaskDecomposer | null = null;

export function getTaskDecomposer(): TaskDecomposer {
  if (!taskDecomposerInstance) {
    taskDecomposerInstance = new TaskDecomposer();
  }
  return taskDecomposerInstance;
}

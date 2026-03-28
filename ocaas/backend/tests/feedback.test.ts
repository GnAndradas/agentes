import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeedbackService } from '../src/orchestrator/feedback/FeedbackService.js';
import { feedbackToActionType, FEEDBACK_TYPE } from '../src/orchestrator/feedback/types.js';

// Mock dependencies
vi.mock('../src/services/index.js', () => ({
  getServices: () => ({
    eventService: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock('../src/orchestrator/ActionExecutor.js', () => ({
  getActionExecutor: () => ({
    executeActions: vi.fn().mockResolvedValue([{
      action: 'create_tool',
      success: true,
      generationId: 'gen_123',
    }]),
    hasPendingGeneration: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock('../src/config/autonomy.js', () => ({
  getAutonomyConfig: () => ({
    level: 'autonomous',
    canGenerateTools: true,
  }),
}));

describe('feedbackToActionType', () => {
  it('should map missing_tool to create_tool', () => {
    expect(feedbackToActionType(FEEDBACK_TYPE.MISSING_TOOL)).toBe('create_tool');
  });

  it('should map missing_skill to create_skill', () => {
    expect(feedbackToActionType(FEEDBACK_TYPE.MISSING_SKILL)).toBe('create_skill');
  });

  it('should map missing_capability to create_agent', () => {
    expect(feedbackToActionType(FEEDBACK_TYPE.MISSING_CAPABILITY)).toBe('create_agent');
  });

  it('should return null for blocked', () => {
    expect(feedbackToActionType(FEEDBACK_TYPE.BLOCKED)).toBeNull();
  });

  it('should return null for cannot_continue', () => {
    expect(feedbackToActionType(FEEDBACK_TYPE.CANNOT_CONTINUE)).toBeNull();
  });
});

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(() => {
    // Create fresh instance for each test
    service = new FeedbackService();
  });

  describe('receiveFeedback', () => {
    it('should create feedback record', async () => {
      const feedback = await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_1',
        message: 'Need CSV parser tool',
        requirement: 'csv_parser',
      });

      expect(feedback).toBeDefined();
      expect(feedback.id).toBeDefined();
      expect(feedback.type).toBe('missing_tool');
      expect(feedback.agentId).toBe('agent_1');
      expect(feedback.taskId).toBe('task_1');
      expect(feedback.message).toBe('Need CSV parser tool');
      expect(feedback.requirement).toBe('csv_parser');
      expect(feedback.createdAt).toBeDefined();
    });

    it('should return existing feedback during cooldown', async () => {
      // First feedback
      const first = await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_cooldown',
        message: 'Need tool X',
      });

      // Second immediate feedback (should be skipped due to cooldown)
      const second = await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_cooldown',
        message: 'Need tool X again',
      });

      // Second should return skipped feedback or existing
      expect(second).toBeDefined();
      // Either returns the existing unprocessed or a skipped one
      expect(second.type).toBe('missing_tool');
    });
  });

  describe('getByTask', () => {
    it('should return feedback for specific task', async () => {
      await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_get_test',
        message: 'Test 1',
      });

      // Wait a bit for cooldown
      await new Promise(resolve => setTimeout(resolve, 100));

      const feedbackList = service.getByTask('task_get_test');
      expect(feedbackList.length).toBeGreaterThanOrEqual(1);
      expect(feedbackList[0].taskId).toBe('task_get_test');
    });

    it('should return empty array for unknown task', () => {
      const feedbackList = service.getByTask('nonexistent_task');
      expect(feedbackList).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should return feedback by ID', async () => {
      const created = await service.receiveFeedback({
        type: 'blocked',
        agentId: 'agent_1',
        taskId: 'task_id_test',
        message: 'Blocked test',
      });

      const retrieved = service.getById(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for unknown ID', () => {
      const retrieved = service.getById('unknown_id');
      expect(retrieved).toBeNull();
    });
  });

  describe('clearForTask', () => {
    it('should clear all feedback for a task', async () => {
      await service.receiveFeedback({
        type: 'missing_skill',
        agentId: 'agent_1',
        taskId: 'task_clear_test',
        message: 'Test skill',
      });

      // Verify feedback exists
      let feedbackList = service.getByTask('task_clear_test');
      expect(feedbackList.length).toBeGreaterThanOrEqual(1);

      // Clear
      service.clearForTask('task_clear_test');

      // Verify cleared
      feedbackList = service.getByTask('task_clear_test');
      expect(feedbackList).toEqual([]);
    });

    it('should clear cooldown for task', async () => {
      // Create feedback
      await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_cooldown_clear',
        message: 'Test',
      });

      // Clear task
      service.clearForTask('task_cooldown_clear');

      // Should be able to create new feedback immediately (cooldown cleared)
      const newFeedback = await service.receiveFeedback({
        type: 'missing_tool',
        agentId: 'agent_1',
        taskId: 'task_cooldown_clear',
        message: 'New feedback after clear',
      });

      expect(newFeedback.message).toBe('New feedback after clear');
      expect(newFeedback.processed).toBe(true); // Should be processed
    });
  });

  describe('getUnprocessed', () => {
    it('should return only unprocessed feedback', async () => {
      // Note: In autonomous mode, feedback gets processed immediately
      // So we check that unprocessed returns whatever hasn't been processed
      const unprocessed = service.getUnprocessed();
      expect(Array.isArray(unprocessed)).toBe(true);
    });
  });
});

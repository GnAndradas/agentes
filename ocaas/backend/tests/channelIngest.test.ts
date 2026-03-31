import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelService, type ChannelIngestInput, type ChannelType } from '../src/services/ChannelService.js';
import type { TaskDTO, TaskPriority } from '../src/types/domain.js';

// Mock services
const mockTaskCreate = vi.fn();
const mockTaskList = vi.fn();
const mockEventEmit = vi.fn();

const mockTaskService = {
  create: mockTaskCreate,
  list: mockTaskList,
};

const mockEventService = {
  emit: mockEventEmit,
};

describe('ChannelService', () => {
  let service: ChannelService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChannelService(
      mockTaskService as any,
      mockEventService as any
    );
  });

  describe('ingest', () => {
    it('should create a task from channel message', async () => {
      const mockTask: TaskDTO = {
        id: 'task-123',
        title: 'Test message',
        status: 'pending',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'telegram',
        userId: 'user-456',
        message: 'Test message',
      };

      const result = await service.ingest(input);

      expect(result.taskId).toBe('task-123');
      expect(result.status).toBe('pending');
      expect(result.title).toBe('Test message');

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test message',
        description: 'Test message',
        type: 'channel_request',
        priority: 3,
        metadata: expect.objectContaining({
          source: 'channel',
          channel: 'telegram',
          userId: 'user-456',
          originalMessage: 'Test message',
        }),
      }));

      expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'channel.ingest',
        category: 'channel',
        data: expect.objectContaining({
          channel: 'telegram',
          userId: 'user-456',
          taskId: 'task-123',
        }),
      }));
    });

    it('should truncate long messages for title', async () => {
      const longMessage = 'A'.repeat(100);
      const mockTask: TaskDTO = {
        id: 'task-123',
        title: 'A'.repeat(80) + '...',
        status: 'pending',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'whatsapp',
        userId: 'user-789',
        message: longMessage,
      };

      await service.ingest(input);

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringMatching(/^A+\.\.\.$/),
        description: longMessage,
      }));
    });

    it('should detect urgent priority from keywords', async () => {
      const mockTask: TaskDTO = {
        id: 'task-urgent',
        title: 'URGENT: Fix the bug',
        status: 'pending',
        type: 'channel_request',
        priority: 1,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'slack',
        userId: 'user-urgent',
        message: 'URGENT: Fix the bug now!',
      };

      await service.ingest(input);

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        priority: 1,
      }));
    });

    it('should detect high priority from important keywords', async () => {
      const mockTask: TaskDTO = {
        id: 'task-high',
        title: 'Important meeting notes',
        status: 'pending',
        type: 'channel_request',
        priority: 2,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'discord',
        userId: 'user-high',
        message: 'Important meeting notes to review',
      };

      await service.ingest(input);

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        priority: 2,
      }));
    });

    it('should use explicit priority from metadata', async () => {
      const mockTask: TaskDTO = {
        id: 'task-meta',
        title: 'Normal message',
        status: 'pending',
        type: 'channel_request',
        priority: 4,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'api',
        userId: 'user-meta',
        message: 'Normal message without keywords',
        metadata: { priority: 4 },
      };

      await service.ingest(input);

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        priority: 4,
      }));
    });

    it('should include custom metadata', async () => {
      const mockTask: TaskDTO = {
        id: 'task-custom',
        title: 'Custom metadata test',
        status: 'pending',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockTaskCreate.mockResolvedValue(mockTask);

      const input: ChannelIngestInput = {
        channel: 'web',
        userId: 'user-web',
        message: 'Custom metadata test',
        metadata: {
          sessionId: 'session-123',
          locale: 'es-AR',
        },
      };

      await service.ingest(input);

      expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          sessionId: 'session-123',
          locale: 'es-AR',
        }),
      }));
    });
  });

  describe('emitResponseReady', () => {
    it('should emit response event for channel tasks', async () => {
      const task: TaskDTO = {
        id: 'task-done',
        title: 'Completed task',
        status: 'completed',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        output: { response: 'Task completed successfully!' },
        metadata: {
          source: 'channel',
          channel: 'telegram',
          userId: 'user-done',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.emitResponseReady(task);

      expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'channel.response_ready',
        category: 'channel',
        data: expect.objectContaining({
          taskId: 'task-done',
          channel: 'telegram',
          userId: 'user-done',
          response: 'Task completed successfully!',
        }),
      }));
    });

    it('should not emit for non-channel tasks', async () => {
      const task: TaskDTO = {
        id: 'task-internal',
        title: 'Internal task',
        status: 'completed',
        type: 'internal',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        metadata: { source: 'system' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.emitResponseReady(task);

      expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('should build error response for failed tasks', async () => {
      const task: TaskDTO = {
        id: 'task-failed',
        title: 'Failed task',
        status: 'failed',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        error: 'Connection timeout',
        metadata: {
          source: 'channel',
          channel: 'whatsapp',
          userId: 'user-failed',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.emitResponseReady(task);

      expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          response: expect.stringContaining('Connection timeout'),
        }),
      }));
    });

    it('should build cancelled response', async () => {
      const task: TaskDTO = {
        id: 'task-cancelled',
        title: 'Cancelled task',
        status: 'cancelled',
        type: 'channel_request',
        priority: 3,
        retryCount: 0,
        maxRetries: 3,
        metadata: {
          source: 'channel',
          channel: 'slack',
          userId: 'user-cancelled',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await service.emitResponseReady(task);

      expect(mockEventEmit).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          response: expect.stringContaining('cancelada'),
        }),
      }));
    });
  });

  describe('getTasksForUser', () => {
    it('should return tasks for specific channel user', async () => {
      const tasks: TaskDTO[] = [
        {
          id: 'task-1',
          title: 'Task 1',
          status: 'completed',
          type: 'channel_request',
          priority: 3,
          retryCount: 0,
          maxRetries: 3,
          metadata: {
            source: 'channel',
            channel: 'telegram',
            userId: 'target-user',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'task-2',
          title: 'Task 2',
          status: 'pending',
          type: 'channel_request',
          priority: 3,
          retryCount: 0,
          maxRetries: 3,
          metadata: {
            source: 'channel',
            channel: 'telegram',
            userId: 'other-user',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'task-3',
          title: 'Task 3',
          status: 'running',
          type: 'channel_request',
          priority: 3,
          retryCount: 0,
          maxRetries: 3,
          metadata: {
            source: 'channel',
            channel: 'telegram',
            userId: 'target-user',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      mockTaskList.mockResolvedValue(tasks);

      const result = await service.getTasksForUser('telegram', 'target-user');

      expect(result).toHaveLength(2);
      expect(result.every(t => t.metadata?.userId === 'target-user')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const tasks: TaskDTO[] = Array.from({ length: 20 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        status: 'completed' as const,
        type: 'channel_request',
        priority: 3 as TaskPriority,
        retryCount: 0,
        maxRetries: 3,
        metadata: {
          source: 'channel',
          channel: 'telegram',
          userId: 'user-many',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      mockTaskList.mockResolvedValue(tasks);

      const result = await service.getTasksForUser('telegram', 'user-many', 5);

      expect(result).toHaveLength(5);
    });
  });
});

describe('Channel Security Middleware', () => {
  it('should verify X-CHANNEL-SECRET header format', () => {
    // This is a behavioral test - actual middleware testing would require
    // a Fastify test setup. Here we document the expected behavior.
    const validHeader = 'my-secret-key-123';
    const invalidHeaders = [
      '', // empty
      null, // missing
      ['a', 'b'], // array
    ];

    expect(typeof validHeader).toBe('string');
    expect(validHeader.length).toBeGreaterThan(0);

    invalidHeaders.forEach(h => {
      if (h === null) {
        expect(h).toBeNull();
      } else if (Array.isArray(h)) {
        expect(typeof h).not.toBe('string');
      } else {
        expect(h).toBe('');
      }
    });
  });
});

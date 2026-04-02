/**
 * Jobs API Routes
 */

import type { FastifyInstance } from 'fastify';
import {
  listJobs,
  getJob,
  getJobsByTask,
  getJobsByAgent,
  abortJob,
  retryJob,
  getJobStats,
  getActiveJobs,
  getBlockedJobs,
  resolveJob,
  scheduleJobRetry,
  cancelJobRetry,
} from './handlers.js';

export async function jobRoutes(app: FastifyInstance) {
  // List/query jobs
  app.get('/', listJobs);

  // Stats
  app.get('/stats', getJobStats);

  // Active jobs
  app.get('/active', getActiveJobs);

  // Blocked jobs
  app.get('/blocked', getBlockedJobs);

  // By task
  app.get('/task/:taskId', getJobsByTask);

  // By agent
  app.get('/agent/:agentId', getJobsByAgent);

  // Single job
  app.get('/:id', getJob);

  // Actions
  app.post('/:id/abort', abortJob);
  app.post('/:id/retry', retryJob);
  app.post('/:id/resolve', resolveJob);
  app.post('/:id/schedule-retry', scheduleJobRetry);
  app.delete('/:id/scheduled-retry', cancelJobRetry);
}

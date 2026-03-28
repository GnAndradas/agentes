import type { FastifyInstance } from 'fastify';
import * as handlers from './handlers.js';

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  // Create feedback (agent reports issue)
  app.post('/', handlers.create);

  // List feedback
  app.get('/', handlers.list);

  // Get specific feedback
  app.get('/:id', handlers.get);

  // Get feedback by task
  app.get('/task/:taskId', handlers.getByTask);

  // Clear feedback for task
  app.delete('/task/:taskId', handlers.clearForTask);
}

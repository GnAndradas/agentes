export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND',
      { resource, id }
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class PermissionError extends AppError {
  constructor(message = 'Permission denied', details?: Record<string, unknown>) {
    super(message, 403, 'PERMISSION_DENIED', details);
    this.name = 'PermissionError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Action forbidden by policy', details?: Record<string, unknown>) {
    super(message, 403, 'FORBIDDEN', details);
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export class OpenClawError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 502, 'OPENCLAW_ERROR', details);
    this.name = 'OpenClawError';
  }
}

export class GenerationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 500, 'GENERATION_ERROR', details);
    this.name = 'GenerationError';
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toErrorResponse(error: unknown) {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, code: error.code, details: error.details },
    };
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    statusCode: 500,
    body: { error: message, code: 'INTERNAL_ERROR' },
  };
}

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

/**
 * PROMPT 19: AI Generation Error with detailed traceability
 */
export type AIErrorStage =
  | 'gateway_unreachable'
  | 'hooks_not_configured'
  | 'hooks_dispatch_failed'
  | 'no_response'
  | 'timeout'
  | 'empty_response'
  | 'invalid_shape'
  | 'validator_failed'
  | 'parse_failed'
  | 'provider_error'
  | 'unknown';

export type AIErrorType = 'technical' | 'unusable_response' | 'none';

export class AIGenerationError extends AppError {
  constructor(
    message: string,
    public readonly errorType: AIErrorType,
    public readonly errorStage: AIErrorStage,
    public readonly errorCode?: string,
    public readonly rawResponseSnippet?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 500, 'AI_GENERATION_ERROR', {
      ...details,
      ai_error_type: errorType,
      ai_error_stage: errorStage,
      ai_error_code: errorCode,
      ai_raw_response_snippet: rawResponseSnippet?.substring(0, 500),
    });
    this.name = 'AIGenerationError';
  }

  /** Create technical error (gateway/network/timeout) */
  static technical(stage: AIErrorStage, message: string, code?: string): AIGenerationError {
    return new AIGenerationError(message, 'technical', stage, code);
  }

  /** Create unusable response error (parse/validation failed) */
  static unusableResponse(stage: AIErrorStage, message: string, rawSnippet?: string): AIGenerationError {
    return new AIGenerationError(message, 'unusable_response', stage, undefined, rawSnippet);
  }
}

export class BudgetExceededError extends AppError {
  constructor(
    message: string,
    public scope: 'task' | 'agent_daily' | 'global_daily',
    public currentCost: number,
    public limit: number,
    details?: Record<string, unknown>
  ) {
    super(message, 429, 'BUDGET_EXCEEDED', {
      ...details,
      scope,
      currentCost,
      limit,
    });
    this.name = 'BudgetExceededError';
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

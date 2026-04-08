/**
 * Generation Traceability (BLOQUE 7 + PROMPT 13)
 *
 * Tipos y helpers para trazabilidad explícita de generación.
 * Distingue claramente: AI real, fallback, manual, activación.
 *
 * PROMPT 13: AI Generation Status Summary
 * =========================================
 * | State                  | Fields                                                    |
 * |------------------------|-----------------------------------------------------------|
 * | AI attempted + success | ai_generation_attempted=true, ai_generation_succeeded=true|
 * | AI attempted + failed  | ai_generation_attempted=true, ai_generation_succeeded=false, fallback_used=true |
 * | AI not configured      | ai_available=false, fallback_used=true, fallback_reason='ai_not_configured' |
 * | Fallback used          | fallback_used=true, fallback_reason=<reason>, fallback_template_name=<template> |
 *
 * generation_mode = 'ai' | 'fallback' | 'manual'
 *   - 'ai': AI generated successfully
 *   - 'fallback': Template used (AI failed or not configured)
 *   - 'manual': User-created resource
 */

import type { GenerationTraceability, AIErrorStage, AIErrorType } from '../types/contracts.js';

// ============================================================================
// GENERATION MODE
// ============================================================================

/**
 * Modo de generación
 */
export type GenerationMode = 'ai' | 'fallback' | 'manual';

/**
 * Razón del fallback
 */
export type FallbackReason =
  | 'ai_not_configured'
  | 'ai_not_available'
  | 'ai_request_failed'
  | 'ai_parse_error'
  | 'ai_validation_failed'
  | 'user_requested_template'
  | null;

// ============================================================================
// FULL TRACEABILITY
// ============================================================================

/**
 * Trazabilidad completa de generación (extiende contracts.ts)
 */
export interface FullGenerationTraceability extends GenerationTraceability {
  /** Modo de generación usado */
  generation_mode: GenerationMode;

  /** Validador pasó */
  validator_passed: boolean;

  /** Errores de validación (si hay) */
  validator_errors?: string[];

  /** Warnings de validación */
  validator_warnings?: string[];

  /** Activación intentada */
  activation_attempted: boolean;

  /** Activación exitosa */
  activation_succeeded: boolean;

  /** Error de activación (si hay) */
  activation_error?: string;

  /** Recurso materializado operativamente */
  materialized: boolean;

  /** Razón de no materialización */
  materialization_gap?: string;
}

// ============================================================================
// BUILDER
// ============================================================================

/**
 * Builder para construir trazabilidad durante el flujo de generación
 */
export class GenerationTraceabilityBuilder {
  private trace: FullGenerationTraceability;

  constructor() {
    this.trace = {
      // GenerationTraceability base
      ai_requested: false,
      ai_available: false,
      ai_generation_attempted: false,
      ai_generation_succeeded: false,
      fallback_used: false,
      fallback_reason: null,
      fallback_template_name: null,
      generated_at: Date.now(),
      // Extended
      generation_mode: 'fallback',
      validator_passed: false,
      activation_attempted: false,
      activation_succeeded: false,
      materialized: false,
    };
  }

  /** Marcar que se solicitó IA */
  aiRequested(): this {
    this.trace.ai_requested = true;
    return this;
  }

  /** Marcar disponibilidad de IA */
  aiAvailable(available: boolean): this {
    this.trace.ai_available = available;
    return this;
  }

  /** Marcar intento de generación IA */
  aiAttempted(): this {
    this.trace.ai_generation_attempted = true;
    return this;
  }

  /** Marcar resultado de generación IA */
  aiResult(
    success: boolean,
    model?: string,
    tokens?: { input?: number; output?: number; inputTokens?: number; outputTokens?: number },
    provider?: string,
    runtime?: 'agent' | 'chat_completion'
  ): this {
    this.trace.ai_generation_succeeded = success;
    if (success) {
      this.trace.generation_mode = 'ai';
      this.trace.fallback_used = false;
      // PROMPT 19: Success means content was usable
      this.trace.ai_content_usable = true;
      this.trace.ai_error_type = 'none';
    }
    if (model) {
      this.trace.ai_model = model;
    }
    // PROMPT 16: Always set provider to 'openclaw' when AI is used
    // This makes it explicit that generation went through the OpenClaw gateway
    this.trace.ai_provider = provider ?? 'openclaw';
    // PROMPT 16B: Track runtime mode (agent vs chat_completion)
    if (runtime) {
      this.trace.ai_runtime = runtime;
    }
    if (tokens) {
      // Normalize token format (support both {input, output} and {inputTokens, outputTokens})
      this.trace.ai_tokens = {
        input: tokens.input ?? tokens.inputTokens ?? 0,
        output: tokens.output ?? tokens.outputTokens ?? 0,
      };
    }
    return this;
  }

  // =========================================================================
  // PROMPT 19: Detailed AI error tracking methods
  // =========================================================================

  /** PROMPT 19: Mark that AI request was started */
  aiRequestStarted(): this {
    this.trace.ai_request_started = true;
    return this;
  }

  /** PROMPT 19: Mark that request reached gateway */
  aiReachedGateway(reached: boolean): this {
    this.trace.ai_request_reached_gateway = reached;
    return this;
  }

  /** PROMPT 19: Mark that raw response was received */
  aiRawResponseReceived(received: boolean, snippet?: string): this {
    this.trace.ai_raw_response_received = received;
    if (snippet) {
      // Truncate to 500 chars for storage
      this.trace.ai_raw_response_snippet = snippet.length > 500
        ? snippet.substring(0, 500) + '...[truncated]'
        : snippet;
    }
    return this;
  }

  /** PROMPT 19: Mark content usability */
  aiContentUsable(usable: boolean): this {
    this.trace.ai_content_usable = usable;
    return this;
  }

  /** PROMPT 19: Record AI error with full details */
  aiError(
    errorType: AIErrorType,
    stage: AIErrorStage,
    message: string,
    code?: string
  ): this {
    this.trace.ai_error_type = errorType;
    this.trace.ai_error_stage = stage;
    this.trace.ai_error_message = message.length > 500
      ? message.substring(0, 500) + '...[truncated]'
      : message;
    if (code) {
      this.trace.ai_error_code = code;
    }
    // If there's an error, content is not usable
    this.trace.ai_content_usable = false;
    this.trace.ai_generation_succeeded = false;
    return this;
  }

  /** PROMPT 19: Record technical error (gateway/network/timeout) */
  aiTechnicalError(stage: AIErrorStage, message: string, code?: string): this {
    return this.aiError('technical', stage, message, code);
  }

  /** PROMPT 19: Record unusable response error (parse/validation failed) */
  aiUnusableResponse(stage: AIErrorStage, message: string, code?: string): this {
    return this.aiError('unusable_response', stage, message, code);
  }

  /** Marcar uso de fallback */
  usedFallback(reason: FallbackReason, templateName?: string): this {
    this.trace.fallback_used = true;
    this.trace.fallback_reason = reason;
    this.trace.fallback_template_name = templateName ?? null;
    this.trace.generation_mode = 'fallback';
    return this;
  }

  /** Marcar como manual */
  manual(): this {
    this.trace.generation_mode = 'manual';
    this.trace.ai_requested = false;
    this.trace.fallback_used = false;
    return this;
  }

  /** Marcar resultado de validación */
  validated(passed: boolean, errors?: string[], warnings?: string[]): this {
    this.trace.validator_passed = passed;
    if (errors?.length) {
      this.trace.validator_errors = errors;
    }
    if (warnings?.length) {
      this.trace.validator_warnings = warnings;
    }
    return this;
  }

  /** Marcar intento de activación */
  activationAttempted(): this {
    this.trace.activation_attempted = true;
    return this;
  }

  /** Marcar resultado de activación */
  activationResult(success: boolean, error?: string): this {
    this.trace.activation_succeeded = success;
    if (error) {
      this.trace.activation_error = error;
    }
    return this;
  }

  /** Marcar materialización */
  materialization(materialized: boolean, gap?: string): this {
    this.trace.materialized = materialized;
    if (gap) {
      this.trace.materialization_gap = gap;
    }
    return this;
  }

  /** Construir trazabilidad final */
  build(): FullGenerationTraceability {
    this.trace.generated_at = Date.now();
    return { ...this.trace };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Crear builder de trazabilidad
 */
export function createTraceability(): GenerationTraceabilityBuilder {
  return new GenerationTraceabilityBuilder();
}

/**
 * Extraer trazabilidad simplificada para almacenamiento
 */
export function toStoredTraceability(trace: FullGenerationTraceability): Record<string, unknown> {
  return {
    generation_mode: trace.generation_mode,
    ai_requested: trace.ai_requested,
    ai_available: trace.ai_available,
    ai_generation_attempted: trace.ai_generation_attempted,
    ai_generation_succeeded: trace.ai_generation_succeeded,
    fallback_used: trace.fallback_used,
    fallback_reason: trace.fallback_reason,
    fallback_template_name: trace.fallback_template_name,
    ai_model: trace.ai_model,
    // PROMPT 16: Include provider for explicit OpenClaw traceability
    ai_provider: trace.ai_provider,
    // PROMPT 16B: Include runtime mode
    ai_runtime: trace.ai_runtime,
    validator_passed: trace.validator_passed,
    activation_attempted: trace.activation_attempted,
    activation_succeeded: trace.activation_succeeded,
    materialized: trace.materialized,
    materialization_gap: trace.materialization_gap,
    generated_at: trace.generated_at,
    // PROMPT 19: Detailed AI error fields
    ai_request_started: trace.ai_request_started,
    ai_request_reached_gateway: trace.ai_request_reached_gateway,
    ai_raw_response_received: trace.ai_raw_response_received,
    ai_content_usable: trace.ai_content_usable,
    ai_error_type: trace.ai_error_type,
    ai_error_stage: trace.ai_error_stage,
    ai_error_code: trace.ai_error_code,
    ai_error_message: trace.ai_error_message,
    ai_raw_response_snippet: trace.ai_raw_response_snippet,
  };
}

// ============================================================================
// ORIGIN METADATA FOR FRONTEND
// ============================================================================

/**
 * Extract origin metadata for frontend display
 * Maps internal traceability to frontend-expected format
 */
export function toOriginMetadata(trace: FullGenerationTraceability): Record<string, unknown> {
  // Map generation_mode to generated_by
  let generated_by: 'ai' | 'fallback' | 'manual' | 'heuristic' = 'fallback';
  if (trace.generation_mode === 'ai' && trace.ai_generation_succeeded) {
    generated_by = 'ai';
  } else if (trace.generation_mode === 'manual') {
    generated_by = 'manual';
  } else if (trace.fallback_used) {
    generated_by = 'fallback';
  }

  return {
    generated_by,
    ai_attempted: trace.ai_generation_attempted,
    ai_succeeded: trace.ai_generation_succeeded,
    fallback_used: trace.fallback_used,
    fallback_reason: trace.fallback_reason,
    model: trace.ai_model,
    // PROMPT 16: Include provider for frontend display
    provider: trace.ai_provider,
    // PROMPT 16B: Include runtime mode for frontend display
    runtime: trace.ai_runtime,
    tokens_used: trace.ai_tokens ? (trace.ai_tokens.input + trace.ai_tokens.output) : undefined,
    // PROMPT 19: Detailed error info for frontend
    ai_request_started: trace.ai_request_started,
    ai_reached_gateway: trace.ai_request_reached_gateway,
    ai_raw_response_received: trace.ai_raw_response_received,
    ai_content_usable: trace.ai_content_usable,
    ai_error_type: trace.ai_error_type,
    ai_error_stage: trace.ai_error_stage,
    ai_error_code: trace.ai_error_code,
    ai_error_message: trace.ai_error_message,
  };
}

// ============================================================================
// MATERIALIZATION STATUS
// ============================================================================

/**
 * Estado de materialización por tipo de recurso
 *
 * IMPORTANTE: Documentación honesta del gap entre "generado" y "operativo real"
 */
export const MATERIALIZATION_STATUS = {
  agent: {
    /** Ficha creada en DB */
    db_record: true,
    /** Workspace del agente creado (BLOQUE 9) */
    workspace_created: false,
    /** Config del agente escrita (BLOQUE 9) */
    config_written: false,
    /** Agente operativo en OpenClaw */
    openclaw_session: false,
    /** Gap explicado (actualizado BLOQUE 9) */
    gap: 'Agent record created in OCAAS DB. ' +
         'BLOQUE 9 adds workspace materialization (agent.json + system-prompt.md). ' +
         'OpenClaw session NOT started - agent is NOT runtime-ready until session creation.',
    /** Estados de ciclo de vida (BLOQUE 9) */
    lifecycle_states: ['record', 'generated', 'activated', 'materialized', 'runtime_ready'],
  },
  skill: {
    /** Ficha creada en DB */
    db_record: true,
    /** Archivos escritos al workspace */
    files_written: true,
    /** Skill cargado en OpenClaw */
    openclaw_loaded: false,
    /** Gap explicado */
    gap: 'Skill files written to workspace and DB record created. ' +
         'OpenClaw would load skill on-demand when agent needs it (not pre-loaded).',
  },
  tool: {
    /** Ficha creada en DB */
    db_record: true,
    /** Script escrito al workspace */
    script_written: true,
    /** Tool ejecutable verificado */
    smoke_tested: false,
    /** Tool registrado en OpenClaw */
    openclaw_registered: false,
    /** Gap explicado */
    gap: 'Tool script written to workspace and DB record created. ' +
         'No smoke test before activation. OpenClaw loads tools on-demand.',
  },
} as const;

/**
 * OCAAS × OpenClaw Contracts
 *
 * Tipos de trazabilidad para distinguir IA real vs fallback.
 * BLOQUE 2 — No rompe compatibilidad, solo extiende.
 */

// ============================================================================
// TRACEABILITY — GENERATION
// ============================================================================

/**
 * Trazabilidad de generación AI
 */
export interface GenerationTraceability {
  /** Se solicitó generación AI */
  ai_requested: boolean;

  /** AI estaba disponible al momento */
  ai_available: boolean;

  /** Se intentó generación AI */
  ai_generation_attempted: boolean;

  /** Generación AI fue exitosa */
  ai_generation_succeeded: boolean;

  /** Se usó fallback (template) */
  fallback_used: boolean;

  /** Razón del fallback (null si no aplica) */
  fallback_reason: string | null;

  /** Nombre del template usado (null si no aplica) */
  fallback_template_name: string | null;

  /** Timestamp de la generación */
  generated_at: number;

  /** Modelo AI usado (null si fallback) */
  ai_model?: string;

  /** PROMPT 16: Provider/gateway usado para la generación */
  ai_provider?: string;

  /** PROMPT 16B: Runtime mode usado (agent vs chat_completion) */
  ai_runtime?: 'agent' | 'chat_completion';

  /** Tokens consumidos (null si fallback) */
  ai_tokens?: {
    input: number;
    output: number;
  };
}

/**
 * Valores por defecto seguros
 */
export const DEFAULT_GENERATION_TRACEABILITY: GenerationTraceability = {
  ai_requested: false,
  ai_available: false,
  ai_generation_attempted: false,
  ai_generation_succeeded: false,
  fallback_used: true,
  fallback_reason: 'default_init',
  fallback_template_name: null,
  generated_at: 0,
};

// ============================================================================
// TRACEABILITY — DECISION
// ============================================================================

/**
 * Fuente de la decisión
 */
export type DecisionSource = 'heuristic' | 'ai' | 'hybrid';

/**
 * Trazabilidad de decisión de asignación
 */
export interface DecisionTraceability {
  /** Fuente de la decisión */
  decision_source: DecisionSource;

  /** Confianza de la decisión (0-1) */
  decision_confidence: number;

  /** Decisión fue validada (por reglas o humano) */
  decision_validated: boolean;

  /** Método heurístico usado (si aplica) */
  heuristic_method?: string;

  /** Modelo AI usado (si aplica) */
  ai_model?: string;

  /** Timestamp de la decisión */
  decided_at: number;

  /** Tiempo de ejecución (ms) */
  execution_time_ms?: number;

  /** Razón de la decisión */
  decision_reason?: string;
}

/**
 * Valores por defecto seguros
 */
export const DEFAULT_DECISION_TRACEABILITY: DecisionTraceability = {
  decision_source: 'heuristic',
  decision_confidence: 0,
  decision_validated: false,
  decided_at: 0,
};

// ============================================================================
// TRACEABILITY — EXECUTION
// ============================================================================

/**
 * Modo de ejecución
 */
export type ExecutionMode = 'real_agent' | 'chat_completion' | 'stub';

/**
 * Trazabilidad de ejecución
 */
export interface ExecutionTraceability {
  /** Modo de ejecución usado */
  execution_mode: ExecutionMode;

  /** ID del agente target */
  target_agent_id: string;

  /** ID de sesión OpenClaw (null si stub) */
  openclaw_session_id: string | null;

  /** Transporte exitoso */
  transport_success: boolean;

  /** Error de transporte (null si éxito) */
  transport_error?: string;

  /** Timestamp de inicio */
  started_at: number;

  /** Timestamp de fin */
  completed_at?: number;

  /** Método de transporte */
  transport_method?: 'rest' | 'websocket' | 'rpc';

  /** Latencia de red (ms) */
  network_latency_ms?: number;
}

/**
 * Valores por defecto seguros
 */
export const DEFAULT_EXECUTION_TRACEABILITY: ExecutionTraceability = {
  execution_mode: 'stub',
  target_agent_id: '',
  openclaw_session_id: null,
  transport_success: false,
  started_at: 0,
};

// ============================================================================
// TASK INTAKE (Entrada de tareas)
// ============================================================================

/**
 * Entrada de tarea desde cualquier canal
 */
export interface TaskIntake {
  /** Fuente del intake */
  source: TaskIntakeSource;

  /** Datos crudos del intake */
  raw_input: string;

  /** Input parseado/estructurado */
  parsed_input?: {
    title?: string;
    description?: string;
    type?: string;
    priority?: number;
  };

  /** Canal de origen */
  channel_id?: string;

  /** Usuario/entidad que creó la tarea */
  created_by?: string;

  /** Timestamp de intake */
  intake_at: number;

  /** Metadata del canal */
  channel_metadata?: Record<string, unknown>;
}

export type TaskIntakeSource =
  | 'api'           // REST API directo
  | 'webhook'       // Webhook externo
  | 'telegram'      // Canal Telegram
  | 'websocket'     // WebSocket
  | 'internal'      // Generado internamente (subtask, retry)
  | 'channel';      // Canal genérico

// ============================================================================
// DECISION RESULT (Resultado de decisión)
// ============================================================================

/**
 * Resultado formal de decisión de asignación
 */
export interface DecisionResult {
  /** ID de la tarea */
  task_id: string;

  /** Decisión tomada */
  decision: DecisionOutcome;

  /** Agente asignado (si aplica) */
  assigned_agent_id?: string;

  /** Score de asignación (si aplica) */
  assignment_score?: number;

  /** Razón de la decisión */
  reason: string;

  /** Trazabilidad */
  traceability: DecisionTraceability;

  /** Acciones sugeridas */
  suggested_actions?: DecisionAction[];
}

export type DecisionOutcome =
  | 'assign'        // Asignar a agente
  | 'decompose'     // Descomponer en subtareas
  | 'generate'      // Generar recurso faltante
  | 'escalate'      // Escalar a supervisor
  | 'wait'          // Esperar aprobación/recurso
  | 'reject';       // Rechazar tarea

export interface DecisionAction {
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// GENERATION RESULT (Resultado de generación)
// ============================================================================

/**
 * Resultado formal de generación
 */
export interface GenerationResult {
  /** ID de la generación */
  generation_id: string;

  /** Tipo de recurso generado */
  resource_type: 'agent' | 'skill' | 'tool';

  /** Contenido generado */
  content: Record<string, unknown>;

  /** Estado de validación */
  validation: {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  };

  /** Trazabilidad */
  traceability: GenerationTraceability;

  /** Path destino (si aplica) */
  target_path?: string;

  /** Requiere aprobación */
  requires_approval: boolean;
}

// ============================================================================
// EXECUTION REQUEST (Solicitud de ejecución)
// ============================================================================

/**
 * Solicitud formal de ejecución a OpenClaw
 */
export interface ExecutionRequest {
  /** ID del job */
  job_id: string;

  /** ID de la tarea */
  task_id: string;

  /** ID del agente */
  agent_id: string;

  /** Goal/objetivo */
  goal: string;

  /** Input estructurado */
  input?: Record<string, unknown>;

  /** Modo de ejecución esperado */
  expected_mode: ExecutionMode;

  /** Timestamp de solicitud */
  requested_at: number;

  /** Timeout (ms) */
  timeout_ms: number;

  /** Constraints */
  constraints: {
    max_tool_calls: number;
    max_tokens: number;
    require_confirmation: boolean;
  };
}

// ============================================================================
// EXECUTION RESULT (Resultado de ejecución)
// ============================================================================

/**
 * Resultado formal de ejecución
 */
export interface ExecutionResult {
  /** ID del job */
  job_id: string;

  /** Estado final */
  status: 'completed' | 'failed' | 'blocked' | 'timeout' | 'cancelled';

  /** Output (si completado) */
  output?: string;

  /** Data estructurada (si aplica) */
  data?: Record<string, unknown>;

  /** Error (si falló) */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };

  /** Bloqueo (si bloqueado) */
  blocked?: {
    reason: string;
    missing: string[];
  };

  /** Trazabilidad */
  traceability: ExecutionTraceability;

  /** Métricas */
  metrics?: {
    execution_time_ms: number;
    tool_calls: number;
    tokens_used?: number;
  };
}

// ============================================================================
// NOMENCLATURA UNIFICADA
// ============================================================================

/**
 * Estado de recurso unificado
 * Evita ambigüedad: generated vs proposed vs active
 */
export type ResourceLifecycle =
  | 'draft'           // Borrador inicial
  | 'generated'       // Generado (AI o fallback)
  | 'pending_review'  // Esperando revisión
  | 'approved'        // Aprobado
  | 'rejected'        // Rechazado
  | 'active'          // Activo en el sistema
  | 'deprecated';     // Obsoleto

/**
 * Referencia a agente unificada
 * Evita ambigüedad: agent vs agent_record vs runtime_agent
 */
export interface AgentReference {
  /** ID del agente en OCAAS */
  ocaas_id: string;

  /** ID de sesión en OpenClaw (si tiene) */
  openclaw_session_id?: string;

  /** Nombre para display */
  display_name: string;

  /** Estado actual */
  status: 'active' | 'inactive' | 'busy' | 'error';
}

// ============================================================================
// COST TRACEABILITY (BLOQUE 4B)
// ============================================================================

/**
 * Trazabilidad de coste/tokens para cualquier operación IA
 * Campos opcionales para retrocompatibilidad
 */
export interface CostTraceability {
  /** Tokens de entrada estimados (antes de llamada) */
  estimated_input_tokens?: number;

  /** Tokens de salida estimados (antes de llamada) */
  estimated_output_tokens?: number;

  /** Tokens de entrada reales (después de llamada) */
  actual_input_tokens?: number;

  /** Tokens de salida reales (después de llamada) */
  actual_output_tokens?: number;

  /** Coste estimado USD (antes de llamada) */
  estimated_cost_usd?: number;

  /** Coste real USD (después de llamada) */
  actual_cost_usd?: number;

  /** Política de presupuesto aplicada */
  budget_policy_applied?: string;

  /** Optimización aplicada */
  optimization_applied?: 'none' | 'payload' | 'prompt_tier' | 'compact';

  /** Cache hit */
  cache_hit?: boolean;

  /** Model tier usado */
  model_tier?: 'short' | 'medium' | 'deep' | 'compact';

  /** Timestamp */
  tracked_at: number;
}

/**
 * Valores por defecto para cost traceability
 */
export const DEFAULT_COST_TRACEABILITY: CostTraceability = {
  optimization_applied: 'none',
  cache_hit: false,
  tracked_at: 0,
};

/**
 * Límites de coste (configurables)
 * Define guardrails de consumo
 */
export interface CostLimits {
  /** Max tokens por request individual */
  max_tokens_per_request?: number;

  /** Max coste USD por task */
  max_cost_per_task_usd?: number;

  /** Max coste USD por agente por día */
  max_cost_per_agent_daily_usd?: number;

  /** Max coste USD por día total */
  max_cost_daily_usd?: number;

  /** Max retries IA por task */
  max_ai_retries_per_task?: number;

  /** Max subtareas generadas por decomposition */
  max_subtasks_per_decomposition?: number;

  /** Timeout para llamadas caras (ms) */
  expensive_call_timeout_ms?: number;
}

/**
 * Límites por defecto (seguros)
 */
export const DEFAULT_COST_LIMITS: CostLimits = {
  max_tokens_per_request: 8192,
  max_cost_per_task_usd: 1.0,
  max_cost_per_agent_daily_usd: 10.0,
  max_cost_daily_usd: 100.0,
  max_ai_retries_per_task: 3,
  max_subtasks_per_decomposition: 10,
  expensive_call_timeout_ms: 120000,
};

/**
 * OpenClaw Adapter Types
 *
 * Contrato tipado para toda interacción con OpenClaw.
 * Ningún archivo fuera de integrations/openclaw debe usar tipos del gateway directamente.
 */

// ============================================================================
// Error Types
// ============================================================================

export type OpenClawErrorCode =
  | 'connection_error'
  | 'execution_error'
  | 'timeout'
  | 'invalid_response'
  | 'auth_error'
  | 'rate_limited'
  | 'not_configured';

export interface OpenClawError {
  code: OpenClawErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Execute Agent
// ============================================================================

export interface ExecuteAgentInput {
  agentId: string;
  taskId?: string;
  prompt: string;
  tools?: string[];
  skills?: string[];
  config?: Record<string, unknown>;
}

export interface ExecuteAgentResult {
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: OpenClawError;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  trace?: {
    model: string;
  };
}

// ============================================================================
// Generate (LLM)
// ============================================================================

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface GenerateResult {
  success: boolean;
  content?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: OpenClawError;
}

// ============================================================================
// Notify Channel
// ============================================================================

export interface NotifyChannelInput {
  channel: string;
  message: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface NotifyChannelResult {
  success: boolean;
  error?: OpenClawError;
}

// ============================================================================
// Send Task (to agent session)
// ============================================================================

export interface SendTaskInput {
  sessionId: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SendTaskResult {
  success: boolean;
  response?: string;
  error?: OpenClawError;
}

// ============================================================================
// Execute Tool
// ============================================================================

export interface ExecuteToolInput {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ExecuteToolResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: OpenClawError;
}

// ============================================================================
// Status
// ============================================================================

export interface StatusResponse {
  connected: boolean;
  configured: boolean;
  rest: {
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
  };
  websocket: {
    connected: boolean;
    sessionId?: string;
  };
  hooks: {
    configured: boolean;
  };
  error?: string;
}

// ============================================================================
// Session Management
// ============================================================================

export interface OpenClawSession {
  id: string;
  agentId: string;
  status: 'active' | 'inactive' | 'error';
  createdAt: number;
}

export interface ListSessionsResult {
  success: boolean;
  sessions: OpenClawSession[];
  error?: OpenClawError;
}

// ============================================================================
// Test Connection
// ============================================================================

export interface TestConnectionResult {
  success: boolean;
  latencyMs: number;
  error?: OpenClawError;
}

// ============================================================================
// Execute Via Hooks (PRIMARY EXECUTION MODE)
// ============================================================================

export interface ExecuteViaHooksInput {
  /** Agent ID */
  agentId: string;

  /** Task ID for session key */
  taskId?: string;

  /** Job ID for session key (alternative to taskId) */
  jobId?: string;

  /** Prompt/message to send */
  prompt: string;

  /** Agent display name */
  name?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}

export interface ExecuteViaHooksResult {
  success: boolean;

  /** Session key used */
  sessionKey?: string;

  /** Execution mode used */
  executionMode: 'hooks_session' | 'chat_completion' | 'stub';

  /** Response content (may be async) */
  response?: string;

  /** Was this accepted by hooks? */
  accepted?: boolean;

  /** Did we fall back to chat_completion? */
  fallbackUsed?: boolean;
  fallbackReason?: string;

  /** AI usage evidence */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /** AI trace evidence */
  trace?: {
    model: string;
  };

  /** Error if failed */
  error?: OpenClawError;

  /**
   * RESOURCE TRACEABILITY: What resources were injected/applied
   */
  resourcesInjected?: {
    tools: string[];
    skills: string[];
    injectionMode: 'native' | 'prompt' | 'none';
  };
}

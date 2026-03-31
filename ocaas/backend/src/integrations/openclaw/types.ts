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

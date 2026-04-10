// OpenClaw Gateway types

// ============================================================================
// EXECUTABLE TOOL/SKILL DEFINITIONS (for runtime injection)
// ============================================================================

/**
 * Compact tool definition for OpenClaw runtime injection
 * Contains all information needed for the runtime to execute the tool
 */
export interface ExecutableToolDefinitionCompact {
  /** Tool ID (for traceability) */
  id: string;
  /** Tool name (unique identifier for invocation) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Tool type: determines execution method */
  type: 'script' | 'binary' | 'api';
  /** Path to executable/script or API endpoint */
  path: string;
  /** Input schema (JSON Schema format) */
  inputSchema?: Record<string, unknown>;
  /** Output schema (JSON Schema format) */
  outputSchema?: Record<string, unknown>;
  /** Additional configuration */
  config?: Record<string, unknown>;
}

/**
 * Compact skill definition for OpenClaw runtime injection
 */
export interface ExecutableSkillDefinitionCompact {
  /** Skill ID (for traceability) */
  id: string;
  /** Skill name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Capabilities provided by this skill */
  capabilities?: string[];
  /** Tools included in this skill */
  tools?: ExecutableToolDefinitionCompact[];
}

// ============================================================================
// SESSION TYPES
// ============================================================================

export interface OpenClawSession {
  id: string;
  agentId: string;
  status: 'active' | 'inactive' | 'error';
  createdAt: number;
}

export interface SpawnOptions {
  agentId: string;
  taskId?: string;
  prompt: string;
  tools?: string[];
  skills?: string[];
  config?: Record<string, unknown>;
}

export interface SpawnResult {
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface ExecOptions {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ExecResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface SendOptions {
  sessionId: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  response?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  trace?: {
    model: string;
  };
}

export interface CronJob {
  id: string;
  schedule: string;
  taskType: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface GatewayStatus {
  connected: boolean;
  version?: string;
  sessions: number;
  lastPing?: number;
}

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface GenerateResult {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  // PROMPT 21: Traceability fields
  trace?: {
    provider: 'openclaw';
    runtime: 'chat_completion';
    targetModel: string; // e.g., 'openclaw/default'
    backendModelOverride?: string; // Value from x-openclaw-model header if used
  };
}

// ============================================================================
// HOOKS SESSION TYPES (PRIMARY EXECUTION MODE)
// ============================================================================

/**
 * Options for running via /hooks/agent with sessionKey
 */
export interface HooksAgentOptions {
  /** Message/prompt to send */
  message: string;

  /** Agent ID for context */
  agentId: string;

  /** Session key for stateful session (e.g., hook:ocaas:task-{taskId}) */
  sessionKey: string;

  /** Display name for the agent */
  name?: string;

  /** Wake mode: 'now' | 'lazy' */
  wakeMode?: 'now' | 'lazy';

  /** Deliver response to channel? */
  deliver?: boolean;

  /** Target channel (telegram, etc.) */
  channel?: string;

  /**
   * RESOURCE INJECTION: Tools and skills available for this execution
   * These are passed to OpenClaw runtime for resource-aware execution.
   */
  context?: {
    /** Tool IDs available for this execution (backwards compatibility) */
    tools?: string[];
    /** Skill IDs available for this execution (backwards compatibility) */
    skills?: string[];
    /**
     * FULL tool definitions for runtime execution
     * Contains all information needed to execute tools (name, path, schema, etc.)
     */
    toolDefinitions?: ExecutableToolDefinitionCompact[];
    /**
     * FULL skill definitions for runtime execution
     */
    skillDefinitions?: ExecutableSkillDefinitionCompact[];
    /** Max tokens for response */
    maxTokens?: number;
    /** Temperature for generation */
    temperature?: number;
  };
}

/**
 * Result from /hooks/agent call
 */
export interface HooksAgentResult {
  success: boolean;

  /** Session key used */
  sessionKey?: string;

  /** Response content (if deliver=false or sync mode) */
  response?: string;

  /** Error message if failed */
  error?: string;

  /** Whether this was accepted (fire-and-forget may not have response) */
  accepted?: boolean;

  /** AI usage evidence */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };

  /** AI trace evidence */
  trace?: {
    model: string;
  };

  /**
   * RESOURCE TRACEABILITY: What resources were injected/applied
   */
  resourcesInjected?: {
    tools: string[];
    skills: string[];
    injectionMode: 'native' | 'prompt' | 'none';
  };
}

/**
 * Session key types for OCAAS
 */
export type SessionKeyType = 'task' | 'job' | 'manual' | 'test';

/**
 * Build a session key for OCAAS
 */
export function buildSessionKey(type: SessionKeyType, id: string): string {
  return `hook:ocaas:${type}-${id}`;
}

/**
 * Parse a session key to extract type and ID
 */
export function parseSessionKey(sessionKey: string): { type: SessionKeyType; id: string } | null {
  const match = sessionKey.match(/^hook:ocaas:(task|job|manual|test)-(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { type: match[1] as SessionKeyType, id: match[2] };
}

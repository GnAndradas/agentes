// OpenClaw Gateway types

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
}

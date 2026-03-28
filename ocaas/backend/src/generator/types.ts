import type { GenerationType } from '../types/domain.js';

export interface GenerationRequest {
  type: GenerationType;
  name: string;
  description: string;
  prompt: string;
  requirements?: string[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationOutput {
  files: GeneratedFile[];
  metadata: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SkillTemplate {
  name: string;
  description: string;
  capabilities: string[];
  files: {
    'SKILL.md': string;
    'agent-instructions.md': string;
    [key: string]: string;
  };
}

export interface ToolTemplate {
  name: string;
  description: string;
  type: 'sh' | 'py';
  content: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface AgentTemplate {
  name: string;
  description: string;
  type: 'general' | 'specialist' | 'orchestrator';
  capabilities: string[];
  config: Record<string, unknown>;
}

import type { TaskDTO, AgentDTO } from '../types/domain.js';

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  score: number;
  reason: string;
}

export interface CapabilityMatch {
  agentId: string;
  capabilities: string[];
  matchScore: number;
}

export interface QueuedTask {
  task: TaskDTO;
  addedAt: number;
  attempts: number;
}

export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  taskTimeout: number; // seconds
  retryAttempts: number;
  autoAssign: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrentTasks: 5,
  taskTimeout: 300,
  retryAttempts: 3,
  autoAssign: true,
};

// ============================================
// Task Analysis (IA-powered)
// ============================================

export interface TaskAnalysis {
  taskId: string;
  analyzedAt: number;
  // Comprensión de la tarea
  intent: string;                      // Intención real de la tarea
  taskType: string;                    // Tipo inferido (coding, research, deploy, etc.)
  complexity: 'low' | 'medium' | 'high';
  complexityReason?: string;           // Explicación de la complejidad
  // Requisitos
  requiredCapabilities: string[];      // Capacidades necesarias
  optionalCapabilities?: string[];     // Capacidades opcionales nice-to-have
  suggestedTools: string[];            // Tools que podrían ayudar
  // Estrategia
  canBeSubdivided: boolean;
  subdivisionReason?: string;          // Por qué sí/no dividir
  suggestedSubtasks?: SubtaskSuggestion[];
  // Riesgos
  riskFactors?: string[];              // Riesgos o bloqueadores potenciales
  // Ejecución
  estimatedDuration: 'quick' | 'normal' | 'long';
  requiresHumanReview: boolean;
  humanReviewReason?: string;          // Por qué requiere/no revisión
  // Confianza del análisis
  confidence: number;                  // 0-1
}

export interface SubtaskSuggestion {
  title: string;
  description: string;
  type: string;
  requiredCapabilities?: string[];     // Capacidades específicas para este subtask
  order: number;
  dependsOnPrevious: boolean;
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

// ============================================
// Missing Capability Report
// ============================================

export interface MissingCapabilityReport {
  taskId: string;
  createdAt: number;
  // Qué falta
  missingCapabilities: string[];
  // Sugerencias
  suggestions: CapabilitySuggestion[];
  // Estado
  requiresApproval: boolean;
  approvalId?: string;
}

export interface CapabilitySuggestion {
  type: 'agent' | 'skill' | 'tool';
  name: string;
  description: string;
  reason: string;                      // Por qué se sugiere esto
  canAutoGenerate: boolean;            // Según autonomyConfig
  priority: 'required' | 'recommended' | 'optional';
}

// ============================================
// Decision Result (enhanced)
// ============================================

export interface IntelligentDecision {
  taskId: string;
  decidedAt: number;
  // Análisis previo
  analysis: TaskAnalysis;
  // Decisión de asignación
  assignment: TaskAssignment | null;
  // Si no hay agente
  missingReport?: MissingCapabilityReport;
  // Acciones sugeridas
  suggestedActions: SuggestedAction[];
  // Fallback usado
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface SuggestedAction {
  action: 'assign' | 'create_agent' | 'create_tool' | 'create_skill' | 'subdivide' | 'wait_approval' | 'reject';
  reason: string;
  metadata?: Record<string, unknown>;
}

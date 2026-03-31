/**
 * System Diagnostics Types
 */

// =============================================================================
// CHECK RESULT TYPES
// =============================================================================

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type SystemStatus = 'healthy' | 'degraded' | 'critical';
export type CheckSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface DiagnosticCheck {
  /** Check identifier */
  name: string;
  /** Category for grouping */
  category: 'openclaw' | 'gateway' | 'tasks' | 'resilience' | 'resources' | 'channels' | 'logging' | 'database';
  /** Check result status */
  status: CheckStatus;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: CheckSeverity;
  /** Additional data */
  data?: Record<string, unknown>;
  /** Duration of check in ms */
  durationMs?: number;
}

export interface DiagnosticIssue {
  /** Issue identifier */
  id: string;
  /** Category */
  category: DiagnosticCheck['category'];
  /** Issue title */
  title: string;
  /** Detailed description */
  description: string;
  /** Severity */
  severity: CheckSeverity;
  /** Affected resource IDs */
  affectedResources?: string[];
  /** Suggested fix */
  suggestion?: string;
  /** Timestamp detected */
  detectedAt: number;
}

export interface DiagnosticRecommendation {
  /** Recommendation ID */
  id: string;
  /** Priority (1 = highest) */
  priority: number;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Category */
  category: DiagnosticCheck['category'];
  /** Action to take */
  action?: string;
}

// =============================================================================
// MAIN RESULT TYPES
// =============================================================================

export interface SystemHealthResult {
  /** Overall system status */
  status: SystemStatus;
  /** Health score 0-100 */
  score: number;
  /** All diagnostic checks */
  checks: DiagnosticCheck[];
  /** Critical issues requiring immediate attention */
  criticalIssues: DiagnosticIssue[];
  /** Warnings */
  warnings: DiagnosticIssue[];
  /** Recommendations for improvement */
  recommendations: DiagnosticRecommendation[];
  /** Timestamp of diagnostic run */
  timestamp: number;
  /** Duration of full diagnostic in ms */
  durationMs: number;
}

export interface ReadinessResult {
  /** Is system ready for production? */
  ready: boolean;
  /** Readiness score 0-100 */
  score: number;
  /** Blockers preventing readiness */
  blockers: DiagnosticIssue[];
  /** Non-blocking issues */
  nonBlockers: DiagnosticIssue[];
  /** Checklist of readiness criteria */
  checklist: Array<{
    name: string;
    passed: boolean;
    reason?: string;
  }>;
  /** Timestamp */
  timestamp: number;
}

export interface MetricsSnapshot {
  /** Tasks metrics */
  tasks: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    stuck: number;
    avgDurationMs: number;
  };
  /** Agents metrics */
  agents: {
    total: number;
    active: number;
    inactive: number;
    error: number;
  };
  /** Resources metrics */
  resources: {
    skills: number;
    tools: number;
    pendingDrafts: number;
  };
  /** Resilience metrics */
  resilience: {
    activeLeases: number;
    expiredLeases: number;
    activeCheckpoints: number;
    circuitBreakerState: string;
  };
  /** OpenClaw metrics */
  openclaw: {
    connected: boolean;
    activeSessions: number;
    latencyMs: number;
  };
  /** Timestamp */
  timestamp: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface DiagnosticsConfig {
  /** Maximum task running time before considered stuck (ms) */
  taskStuckThresholdMs: number;
  /** Maximum retry count before flagging */
  maxRetryThreshold: number;
  /** Gateway latency threshold for warning (ms) */
  gatewayLatencyWarningMs: number;
  /** Gateway latency threshold for error (ms) */
  gatewayLatencyErrorMs: number;
  /** Maximum pending drafts before warning */
  maxPendingDraftsWarning: number;
  /** Score weights */
  weights: {
    openclaw: number;
    gateway: number;
    tasks: number;
    resilience: number;
    resources: number;
    channels: number;
    logging: number;
    database: number;
  };
}

export const DEFAULT_DIAGNOSTICS_CONFIG: DiagnosticsConfig = {
  taskStuckThresholdMs: 30 * 60 * 1000, // 30 minutes
  maxRetryThreshold: 3,
  gatewayLatencyWarningMs: 1000,
  gatewayLatencyErrorMs: 5000,
  maxPendingDraftsWarning: 10,
  weights: {
    openclaw: 20,
    gateway: 15,
    tasks: 20,
    resilience: 15,
    resources: 10,
    channels: 5,
    logging: 5,
    database: 10,
  },
};

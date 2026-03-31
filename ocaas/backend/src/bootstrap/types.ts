/**
 * Bootstrap Types
 */

export type CheckStatus = 'ok' | 'fail' | 'warn' | 'skip';

export interface BootstrapCheck {
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

export interface BootstrapResult {
  status: 'READY' | 'DEGRADED' | 'NOT_READY';
  checks: BootstrapCheck[];
  readinessScore: number;
  criticalFailures: string[];
  warnings: string[];
  recommendations: string[];
  timestamp: number;
  durationMs: number;
}

export interface DoctorResult extends BootstrapResult {
  environment: {
    nodeVersion: string;
    platform: string;
    cwd: string;
  };
  configuration: {
    envVars: Record<string, CheckStatus>;
    directories: Record<string, CheckStatus>;
  };
}

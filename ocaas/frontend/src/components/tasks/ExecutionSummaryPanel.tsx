/**
 * ExecutionSummaryPanel
 *
 * Shows execution outcome, phase, progress, and session info.
 */

import { Activity, CheckCircle, XCircle, Clock, Zap, Play, Pause, AlertTriangle } from 'lucide-react';
import { Badge } from '../ui';
import type { ExecutionSummary, TaskExecutionState, TaskStateSnapshot } from '../../types';

interface ExecutionSummaryPanelProps {
  execution?: ExecutionSummary;
  state?: TaskExecutionState | TaskStateSnapshot;
  isLoading?: boolean;
}

const outcomeConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  completed_sync: { icon: CheckCircle, color: 'text-green-400', label: 'Completed (Sync)' },
  accepted_async: { icon: Play, color: 'text-cyan-400', label: 'Accepted (Async)' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
};

const phaseConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  pending: { icon: Clock, color: 'text-dark-400', bg: 'bg-dark-700' },
  initializing: { icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  planning: { icon: Activity, color: 'text-purple-400', bg: 'bg-purple-500/20' },
  executing: { icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  waiting_human: { icon: Pause, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  waiting_resource: { icon: Clock, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  paused: { icon: Pause, color: 'text-gray-400', bg: 'bg-gray-500/20' },
  completing: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  completed: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20' },
};

function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={`h-2 bg-dark-700 rounded-full overflow-hidden ${className || ''}`}>
      <div
        className="h-full bg-primary-500 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function ExecutionSummaryPanel({ execution, state, isLoading }: ExecutionSummaryPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-8 bg-dark-700 rounded" />
        <div className="h-4 bg-dark-700 rounded w-1/2" />
      </div>
    );
  }

  if (!execution && !state) {
    return (
      <div className="text-center py-4 text-dark-500 text-sm">
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No execution data available
      </div>
    );
  }

  // Extract data from state (could be full state or snapshot)
  const phase = state && 'phase' in state ? state.phase : undefined;
  const currentStep = state && 'currentStepIndex' in state ? state.currentStepIndex : undefined;
  const totalSteps = state && 'totalSteps' in state
    ? state.totalSteps
    : (state && 'steps' in state ? state.steps.length : undefined);
  const completedSteps = state && 'completedSteps' in state
    ? state.completedSteps
    : (state && 'metrics' in state ? state.metrics.completedSteps : undefined);
  const isPaused = state && 'isPaused' in state
    ? state.isPaused
    : (state && 'pausedAt' in state ? !!state.pausedAt : false);
  const pauseReason = state && 'pauseReason' in state ? state.pauseReason : undefined;

  // Calculate progress
  const progressPct = totalSteps && totalSteps > 0
    ? Math.round((completedSteps ?? 0) / totalSteps * 100)
    : undefined;

  // Get outcome config
  const outcome = execution?.outcome;
  const outcomeInfo = outcome ? outcomeConfig[outcome] : undefined;
  const OutcomeIcon = outcomeInfo?.icon;

  // Get phase config
  const phaseInfo = phase ? phaseConfig[phase] : undefined;
  const PhaseIcon = phaseInfo?.icon || Activity;

  return (
    <div className="space-y-4">
      {/* Outcome Row */}
      {outcome && outcomeInfo && OutcomeIcon && (
        <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg">
          <OutcomeIcon className={`w-5 h-5 ${outcomeInfo.color}`} />
          <div className="flex-1">
            <p className="text-sm font-medium">{outcomeInfo.label}</p>
            {execution?.executionTimeMs && (
              <p className="text-xs text-dark-500">
                Execution time: {(execution.executionTimeMs / 1000).toFixed(2)}s
              </p>
            )}
          </div>
          {execution?.lastJobStatus && (
            <Badge variant={execution.lastJobStatus === 'completed' ? 'success' : execution.lastJobStatus === 'accepted' ? 'active' : 'default'}>
              {execution.lastJobStatus}
            </Badge>
          )}
        </div>
      )}

      {/* Phase & Progress */}
      {phase && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhaseIcon className={`w-4 h-4 ${phaseInfo?.color || 'text-dark-400'}`} />
              <span className="text-sm font-medium capitalize">{phase.replace('_', ' ')}</span>
            </div>
            {progressPct !== undefined && (
              <span className="text-xs text-dark-400">{progressPct}%</span>
            )}
          </div>

          {progressPct !== undefined && (
            <ProgressBar percent={progressPct} />
          )}

          {currentStep !== undefined && totalSteps !== undefined && (
            <p className="text-xs text-dark-500">
              Step {currentStep + 1} of {totalSteps}
              {completedSteps !== undefined && ` (${completedSteps} completed)`}
            </p>
          )}
        </div>
      )}

      {/* Paused Warning */}
      {isPaused && (
        <div className="flex items-start gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-orange-400">Task Paused</p>
            {pauseReason && (
              <p className="text-xs text-orange-300/70 mt-1">{pauseReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Session Info */}
      {execution?.hooks_session && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-dark-500">Session</span>
          <code className="text-dark-400 bg-dark-900 px-2 py-0.5 rounded font-mono">
            {execution.hooks_session}
          </code>
        </div>
      )}

      {/* Tool Calls */}
      {execution?.toolCalls !== undefined && execution.toolCalls > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-dark-500">Tool Calls</span>
          <span className="text-dark-300">{execution.toolCalls}</span>
        </div>
      )}

      {/* Error */}
      {execution?.error && (
        <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
          <p className="text-xs text-red-400 font-mono">{execution.error}</p>
        </div>
      )}
    </div>
  );
}

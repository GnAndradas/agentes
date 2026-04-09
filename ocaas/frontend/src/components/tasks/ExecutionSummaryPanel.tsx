/**
 * ExecutionSummaryPanel
 *
 * Shows execution outcome, phase, progress, and session info.
 */

import { Activity, CheckCircle, XCircle, Clock, Zap, Play, Pause, AlertTriangle, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '../ui';
import type { ExecutionSummary, TaskExecutionState, TaskStateSnapshot } from '../../types';

interface ExecutionSummaryPanelProps {
  execution?: ExecutionSummary | null;
  state?: TaskExecutionState | TaskStateSnapshot | null;
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

      {/* BLOQUE Truth: Execution Veracity & AI Origin */}
      {execution?.truth && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 p-2 bg-dark-800 rounded-t border border-dark-700">
             {execution.truth.level === 'real' ? (
               <ShieldCheck className="w-4 h-4 text-green-400" />
             ) : execution.truth.level === 'fallback' ? (
               <AlertTriangle className="w-4 h-4 text-yellow-400" />
             ) : (
               <Sparkles className="w-4 h-4 text-blue-400" />
             )}
             <span className="text-xs font-semibold uppercase tracking-wider">
               Veracity: <span className={execution.truth.level === 'real' ? 'text-green-400' : execution.truth.level === 'fallback' ? 'text-yellow-400' : 'text-blue-400'}>
                 {execution.truth.level}
               </span>
             </span>
             <span className="text-[10px] text-dark-500 italic ml-auto truncate max-w-[150px]" title={execution.truth.reason}>
               {execution.truth.reason}
             </span>
          </div>

          <div className="flex items-center gap-2 p-2 bg-dark-900/50 rounded-b border-x border-b border-dark-700">
            <Zap className={`w-3 h-3 ${execution.ai_generated ? 'text-yellow-400' : 'text-dark-500'}`} />
            <span className="text-[11px] font-medium text-dark-300">
              AI Origin Verified: {execution.ai_generated ? (
                <span className="text-green-400">Yes</span>
              ) : (
                <span className="text-red-400">No (Stub/Unknown)</span>
              )}
            </span>
            {execution.ai_provider && (
              <Badge variant="default" className="text-[9px] py-0 px-1 ml-auto h-4 bg-dark-700 text-dark-400 border-dark-600">
                {execution.ai_provider}
              </Badge>
            )}
          </div>
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

      {/* RESOURCE TRACEABILITY: Strict contractual verification */}
      {execution?.resources && (
        <div className="space-y-2 mt-3 pt-3 border-t border-dark-700">
          <p className="text-xs text-dark-500 font-semibold uppercase tracking-wider">Resources</p>

          {/* Assigned */}
          {((execution.resources.assigned_tools?.length ?? 0) > 0 || (execution.resources.assigned_skills?.length ?? 0) > 0) && (
            <div className="text-xs">
              <span className="text-dark-500">Assigned: </span>
              <span className="text-dark-300">
                {execution.resources.assigned_tools?.length ?? 0} tools, {execution.resources.assigned_skills?.length ?? 0} skills
              </span>
            </div>
          )}

          {/* Injection Mode */}
          {execution.resources.injection_mode && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-dark-500">Injected:</span>
              <Badge
                variant={execution.resources.injection_mode === 'native' ? 'success' : execution.resources.injection_mode === 'prompt' ? 'pending' : 'default'}
                className="text-[10px] py-0"
              >
                {execution.resources.injection_mode}
              </Badge>
            </div>
          )}

          {/* Usage Verification - STRICT CONTRACTUAL */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-dark-500">Usage Verified:</span>
            {execution.resources.usage_verified ? (
              <>
                <CheckCircle className="w-3 h-3 text-green-400" />
                <span className="text-green-400 text-[10px]">Yes</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-3 h-3 text-yellow-500" />
                <span className="text-yellow-400 text-[10px]">No</span>
              </>
            )}
          </div>

          {/* Verification Source */}
          <div className="text-xs text-dark-500">
            Source: <span className="text-dark-400">{execution.resources.verification_source || 'unverified'}</span>
          </div>

          {/* Unverified Reason - Always show when not verified */}
          {!execution.resources.usage_verified && execution.resources.unverified_reason && (
            <div className="p-2 bg-yellow-900/10 border border-yellow-800/30 rounded text-[10px] text-yellow-400/80">
              {execution.resources.unverified_reason}
            </div>
          )}

          {/* Used Resources - ONLY show if verified */}
          {execution.resources.usage_verified && ((execution.resources.tools_used?.length ?? 0) > 0 || (execution.resources.skills_used?.length ?? 0) > 0) && (
            <div className="text-xs text-green-400">
              Confirmed Used: {execution.resources.tools_used?.join(', ') || 'none'}
              {(execution.resources.skills_used?.length ?? 0) > 0 && ` | Skills: ${execution.resources.skills_used?.join(', ')}`}
            </div>
          )}
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

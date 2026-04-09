/**
 * InternalProgressPanel
 *
 * Shows OCAAS internal orchestration progress from TaskStateManager.
 * This is NOT OpenClaw runtime progress - it only reflects OCAAS's
 * internal state tracking (task phases, step management, checkpoints).
 *
 * For actual OpenClaw runtime events, see RuntimeProgressPanel.
 */

import { useState, useEffect } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Zap, Play, Pause, AlertTriangle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { TaskProgressResponse, ProgressEvent } from '../../types';

interface ProgressEventsPanelProps {
  taskId: string;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
  /** Collapsed by default */
  defaultCollapsed?: boolean;
}

const eventIconMap: Record<string, React.ElementType> = {
  state_initialized: Play,
  step_started: Zap,
  step_completed: CheckCircle,
  step_failed: XCircle,
  checkpoint_created: Clock,
  task_completed: CheckCircle,
  task_failed: XCircle,
  task_paused: Pause,
  task_resumed: Play,
  phase_changed: Activity,
};

const stageColorMap: Record<string, string> = {
  initializing: 'text-blue-400',
  executing: 'text-yellow-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  paused: 'text-orange-400',
  pending: 'text-dark-400',
};

const phaseConfig: Record<string, { color: string; bg: string }> = {
  pending: { color: 'text-dark-400', bg: 'bg-dark-700' },
  initializing: { color: 'text-blue-400', bg: 'bg-blue-500/20' },
  planning: { color: 'text-purple-400', bg: 'bg-purple-500/20' },
  executing: { color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  waiting_human: { color: 'text-orange-400', bg: 'bg-orange-500/20' },
  waiting_resource: { color: 'text-orange-400', bg: 'bg-orange-500/20' },
  paused: { color: 'text-gray-400', bg: 'bg-gray-500/20' },
  completing: { color: 'text-green-400', bg: 'bg-green-500/20' },
  completed: { color: 'text-green-400', bg: 'bg-green-500/20' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/20' },
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div className={`h-1.5 bg-dark-700 rounded-full overflow-hidden ${className || ''}`}>
      <div
        className="h-full bg-primary-500 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function EventItem({ event }: { event: ProgressEvent }) {
  const Icon = eventIconMap[event.event] || Activity;
  const colorClass = stageColorMap[event.stage] || 'text-dark-400';

  return (
    <div className="flex items-start gap-2 py-1.5 border-l-2 border-dark-700 pl-3 ml-1 hover:border-primary-500/50 transition-colors">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorClass}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-dark-200 truncate">{event.summary}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-dark-500">{formatTimestamp(event.timestamp)}</span>
          {event.stepName && (
            <span className="text-[10px] text-dark-500 truncate max-w-[100px]" title={event.stepName}>
              {event.stepName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function InternalProgressPanel({ taskId, refreshInterval = 5000, defaultCollapsed = false }: ProgressEventsPanelProps) {
  const [progress, setProgress] = useState<TaskProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  const fetchProgress = async () => {
    try {
      const data = await taskApi.getInternalProgress(taskId);
      setProgress(data);
      setError(null);
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch internal progress');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchProgress, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, refreshInterval]);

  // Stop polling if task is completed/failed
  const isTerminal = progress?.currentPhase === 'completed' || progress?.currentPhase === 'failed';

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-20 bg-dark-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <p className="text-xs text-red-400">{error}</p>
        <button onClick={fetchProgress} className="ml-auto p-1 hover:bg-dark-700 rounded">
          <RefreshCw className="w-3 h-3 text-dark-400" />
        </button>
      </div>
    );
  }

  if (!progress) {
    return (
      <div className="text-center py-4 text-dark-500 text-sm">
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No progress data
      </div>
    );
  }

  const phaseInfo = phaseConfig[progress.currentPhase] || phaseConfig.pending;

  return (
    <div className="space-y-3">
      {/* Header with collapse toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-dark-200 hover:text-white transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          OCAAS Internal Progress
          <span className="text-[9px] text-dark-500 font-normal">(orchestrator state)</span>
        </button>

        <div className="flex items-center gap-2">
          {!isTerminal && (
            <button
              onClick={fetchProgress}
              className="p-1 hover:bg-dark-700 rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3 h-3 text-dark-400" />
            </button>
          )}
          <Badge
            variant={progress.currentPhase === 'completed' ? 'success' : progress.currentPhase === 'failed' ? 'error' : 'default'}
            className="text-[10px] py-0"
          >
            {progress.currentPhase}
          </Badge>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Progress bar and stats */}
          {progress.hasProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-dark-500">Progress</span>
                <span className="text-dark-300">{Math.round(progress.progressPct)}%</span>
              </div>
              <ProgressBar percent={progress.progressPct} />

              {progress.completedSteps !== undefined && progress.totalSteps !== undefined && (
                <p className="text-[10px] text-dark-500">
                  {progress.completedSteps} / {progress.totalSteps} steps completed
                </p>
              )}
            </div>
          )}

          {/* Current phase indicator */}
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${phaseInfo.bg}`}>
            <Activity className={`w-3 h-3 ${phaseInfo.color}`} />
            <span className={`text-xs font-medium capitalize ${phaseInfo.color}`}>
              {progress.currentPhase.replace('_', ' ')}
            </span>
            {progress.currentStep && (
              <span className="text-[10px] text-dark-400 ml-auto truncate max-w-[150px]">
                {progress.currentStep.name}
              </span>
            )}
          </div>

          {/* Events timeline */}
          {progress.events.length > 0 ? (
            <div className="space-y-0 max-h-48 overflow-y-auto">
              {progress.events.map((event, idx) => (
                <EventItem key={`${event.timestamp}-${idx}`} event={event} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-dark-500 text-center py-2">
              {progress.message || 'No events recorded yet'}
            </p>
          )}

          {/* Warnings */}
          {progress.warnings && progress.warnings.length > 0 && (
            <div className="space-y-1">
              {progress.warnings.map((warning, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 bg-yellow-900/10 border border-yellow-800/30 rounded text-[10px] text-yellow-400/80">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Footer stats */}
          <div className="flex items-center justify-between text-[10px] text-dark-500 pt-1 border-t border-dark-800">
            {progress.sessionKey && (
              <span className="truncate max-w-[120px]" title={progress.sessionKey}>
                Session: {progress.sessionKey.slice(0, 20)}...
              </span>
            )}
            {progress.toolCallsCount !== undefined && progress.toolCallsCount > 0 && (
              <span>Tool calls: {progress.toolCallsCount}</span>
            )}
            {lastRefresh > 0 && !isTerminal && (
              <span className="ml-auto">Updated: {formatTimestamp(lastRefresh)}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

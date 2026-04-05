/**
 * DiagnosticsPanel
 *
 * Shows technical diagnostics, gaps, and warnings.
 */

import {
  AlertTriangle,
  Info,
  Cpu,
  Clock,
  Wrench,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Badge } from '../ui';
import type { TaskDiagnostics, TaskExecutionState } from '../../types';

interface DiagnosticsPanelProps {
  diagnostics?: TaskDiagnostics | null;
  state?: TaskExecutionState | null;
  isLoading?: boolean;
}

interface DiagnosticIssue {
  type: 'error' | 'warning' | 'info';
  message: string;
  detail?: string;
}

function extractIssues(
  diagnostics?: TaskDiagnostics | null,
  state?: TaskExecutionState | null
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  // From execution summary
  if (diagnostics?.execution?.error) {
    issues.push({
      type: 'error',
      message: 'Execution Error',
      detail: diagnostics.execution.error,
    });
  }

  // From state errors
  if (state?.errors && state.errors.length > 0) {
    state.errors.forEach((err) => {
      issues.push({
        type: err.recoverable ? 'warning' : 'error',
        message: err.stepId ? `Step ${err.stepId} failed` : 'Execution error',
        detail: err.error,
      });
    });
  }

  // Check for delegation without completion
  if (
    diagnostics?.delegationChain &&
    diagnostics.delegationChain.length > 0 &&
    diagnostics.execution?.outcome !== 'completed_sync'
  ) {
    const lastDelegation = diagnostics.delegationChain[diagnostics.delegationChain.length - 1];
    if (lastDelegation.status === 'failed') {
      issues.push({
        type: 'warning',
        message: 'Delegation chain ended in failure',
        detail: `Last agent: ${lastDelegation.agentName}`,
      });
    }
  }

  // Check for subtask failures
  if (diagnostics?.subtasks) {
    const failedSubtasks = diagnostics.subtasks.filter((s) => s.status === 'failed');
    if (failedSubtasks.length > 0) {
      issues.push({
        type: 'warning',
        message: `${failedSubtasks.length} subtask(s) failed`,
        detail: failedSubtasks.map((s) => s.title).join(', '),
      });
    }
  }

  // Info items
  if (diagnostics?.execution?.hooks_session) {
    issues.push({
      type: 'info',
      message: 'Using async hooks session',
      detail: diagnostics.execution.hooks_session,
    });
  }

  if (state?.pausedAt) {
    issues.push({
      type: 'info',
      message: 'Task is currently paused',
      detail: state.pauseReason,
    });
  }

  return issues;
}

function IssueItem({ issue }: { issue: DiagnosticIssue }) {
  const config = {
    error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
    warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
    info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  };

  const cfg = config[issue.type];
  const Icon = cfg.icon;

  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
      <Icon className={`w-4 h-4 ${cfg.color} mt-0.5 flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${cfg.color}`}>{issue.message}</p>
        {issue.detail && (
          <p className="text-xs text-dark-400 mt-1 break-words">{issue.detail}</p>
        )}
      </div>
    </div>
  );
}

export function DiagnosticsPanel({ diagnostics, state, isLoading }: DiagnosticsPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-12 bg-dark-700 rounded-lg" />
        <div className="h-12 bg-dark-700 rounded-lg" />
      </div>
    );
  }

  const issues = extractIssues(diagnostics, state);

  // Technical metrics
  const metrics = state?.metrics;
  const execution = diagnostics?.execution;

  return (
    <div className="space-y-4">
      {/* Issues List */}
      {issues.length > 0 ? (
        <div className="space-y-2">
          {issues.map((issue, idx) => (
            <IssueItem key={idx} issue={issue} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <span className="text-sm text-green-400">No issues detected</span>
        </div>
      )}

      {/* Technical Metrics */}
      {(metrics || execution) && (
        <div className="space-y-2 pt-2 border-t border-dark-700">
          <p className="text-xs text-dark-500 font-medium">Execution Metrics</p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {metrics?.totalSteps !== undefined && (
              <div className="flex items-center justify-between p-2 bg-dark-900 rounded">
                <span className="text-dark-500">Steps</span>
                <span className="text-dark-300">
                  {metrics.completedSteps}/{metrics.totalSteps}
                </span>
              </div>
            )}

            {metrics?.failedSteps !== undefined && metrics.failedSteps > 0 && (
              <div className="flex items-center justify-between p-2 bg-dark-900 rounded">
                <span className="text-dark-500">Failed</span>
                <span className="text-red-400">{metrics.failedSteps}</span>
              </div>
            )}

            {metrics?.llmCalls !== undefined && (
              <div className="flex items-center justify-between p-2 bg-dark-900 rounded">
                <span className="text-dark-500 flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  LLM Calls
                </span>
                <span className="text-dark-300">{metrics.llmCalls}</span>
              </div>
            )}

            {metrics?.toolCalls !== undefined && (
              <div className="flex items-center justify-between p-2 bg-dark-900 rounded">
                <span className="text-dark-500 flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  Tool Calls
                </span>
                <span className="text-dark-300">{metrics.toolCalls}</span>
              </div>
            )}

            {metrics?.totalDurationMs !== undefined && (
              <div className="flex items-center justify-between p-2 bg-dark-900 rounded col-span-2">
                <span className="text-dark-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Total Duration
                </span>
                <span className="text-dark-300">
                  {(metrics.totalDurationMs / 1000).toFixed(2)}s
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delegation Chain Summary */}
      {diagnostics?.delegationChain && diagnostics.delegationChain.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-dark-700">
          <p className="text-xs text-dark-500 font-medium">
            Delegation Chain ({diagnostics.delegationChain.length} agents)
          </p>
          <div className="flex flex-wrap gap-1">
            {diagnostics.delegationChain.map((d, idx) => (
              <Badge
                key={d.jobId}
                variant={
                  d.status === 'completed' || d.status === 'accepted'
                    ? 'success'
                    : d.status === 'failed'
                    ? 'error'
                    : 'default'
                }
                className="text-xs"
              >
                {idx + 1}. {d.agentName.slice(0, 12)}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* State Version */}
      {state?.version !== undefined && (
        <div className="flex items-center justify-between text-xs text-dark-500 pt-2 border-t border-dark-700">
          <span>State Version</span>
          <span>v{state.version}</span>
        </div>
      )}
    </div>
  );
}

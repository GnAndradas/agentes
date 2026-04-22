/**
 * TaskDebugSummaryPanel
 *
 * Operational debugging panel for troubleshooting task issues.
 * Shows issues by layer with evidence and suggested next checks.
 *
 * Does NOT replace other panels - this is for quick debugging.
 */

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Server,
  Wifi,
  FileText,
  Cpu,
  Package,
  Radio,
  Clock,
  ChevronDown,
  ChevronRight,
  Bug,
} from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { TaskDebugSummary, DebugIssue, DebugLayer, DebugStatus, DebugSeverity } from '../../types';

interface TaskDebugSummaryPanelProps {
  taskId: string;
  refreshInterval?: number;
}

// Layer configuration
const layerConfig: Record<DebugLayer, { icon: React.ElementType; label: string }> = {
  ocaas_internal: { icon: Server, label: 'OCAAS Internal' },
  openclaw_runtime: { icon: Wifi, label: 'OpenClaw Runtime' },
  openclaw_hook: { icon: FileText, label: 'OpenClaw Hook' },
  ai_generation: { icon: Cpu, label: 'AI Generation' },
  resource_contract: { icon: Package, label: 'Resources' },
  gateway: { icon: Radio, label: 'Gateway' },
};

// Status configuration
const statusConfig: Record<DebugStatus, { icon: React.ElementType; color: string; bgColor: string }> = {
  pass: { icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-900/30' },
  degraded: { icon: AlertTriangle, color: 'text-yellow-400', bgColor: 'bg-yellow-900/30' },
  fail: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-900/30' },
  unknown: { icon: HelpCircle, color: 'text-dark-400', bgColor: 'bg-dark-800' },
};

// Severity configuration
const severityConfig: Record<DebugSeverity, { color: string }> = {
  info: { color: 'text-blue-400' },
  warning: { color: 'text-yellow-400' },
  error: { color: 'text-red-400' },
};

function IssueRow({ issue, isExpanded, onToggle }: { issue: DebugIssue; isExpanded: boolean; onToggle: () => void }) {
  const layer = layerConfig[issue.layer];
  const status = statusConfig[issue.status];
  const severity = severityConfig[issue.severity];
  const LayerIcon = layer.icon;
  const StatusIcon = status.icon;
  const hasDetails = issue.evidence || issue.suggested_next_check;

  return (
    <div className="border-b border-dark-800 last:border-b-0">
      <div
        className={`flex items-start gap-2 p-2 ${hasDetails ? 'cursor-pointer hover:bg-dark-800/50' : ''}`}
        onClick={hasDetails ? onToggle : undefined}
      >
        {/* Expand icon */}
        <div className="w-4 pt-0.5 flex-shrink-0">
          {hasDetails && (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-dark-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-dark-500" />
            )
          )}
        </div>

        {/* Status icon */}
        <StatusIcon className={`w-4 h-4 flex-shrink-0 ${status.color}`} />

        {/* Layer badge */}
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${status.bgColor} flex-shrink-0`}>
          <LayerIcon className={`w-3 h-3 ${status.color}`} />
          <span className={`text-[9px] font-medium ${status.color}`}>{layer.label}</span>
        </div>

        {/* Summary */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-dark-200">{issue.summary}</p>
        </div>

        {/* Severity */}
        <Badge variant="default" className={`text-[9px] ${severity.color}`}>
          {issue.severity}
        </Badge>
      </div>

      {/* Expansion */}
      {isExpanded && hasDetails && (
        <div className="px-8 pb-2 space-y-1">
          {issue.evidence && (
            <div className="text-[10px]">
              <span className="text-dark-500">Evidence:</span>
              <span className="text-dark-400 ml-1">{issue.evidence}</span>
            </div>
          )}
          {issue.suggested_next_check && (
            <div className="text-[10px]">
              <span className="text-dark-500">Next check:</span>
              <span className="text-cyan-400 ml-1">{issue.suggested_next_check}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskDebugSummaryPanel({ taskId, refreshInterval = 10000 }: TaskDebugSummaryPanelProps) {
  const [data, setData] = useState<TaskDebugSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState<Set<number>>(new Set());

  const fetchSummary = async () => {
    try {
      const result = await taskApi.getDebugSummary(taskId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch debug summary');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchSummary, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, refreshInterval]);

  const toggleIssue = (idx: number) => {
    setExpandedIssues(prev => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 p-4">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-24 bg-dark-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800/50 rounded-lg m-4">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <Bug className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No debug data
      </div>
    );
  }

  const overallStatus = statusConfig[data.overall_status];
  const OverallIcon = overallStatus.icon;

  // HARDENING: Safely handle missing or non-array issues
  const safeIssues = Array.isArray(data.issues) ? data.issues : [];

  // Group issues by severity for priority display
  const errorIssues = safeIssues.filter(i => i.status === 'fail');
  const warningIssues = safeIssues.filter(i => i.status === 'degraded');
  const infoIssues = safeIssues.filter(i => i.status === 'pass' || i.status === 'unknown');

  return (
    <div className="space-y-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <Bug className="w-4 h-4 text-orange-400" />
          Debug Summary
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded ${overallStatus.bgColor}`}>
          <OverallIcon className={`w-4 h-4 ${overallStatus.color}`} />
          <span className={`text-xs font-medium ${overallStatus.color}`}>
            {data.overall_status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Task status */}
      <div className="text-[10px] text-dark-500">
        Task: {data.taskStatus} | Layers checked: {data.layers_checked.length}
      </div>

      {/* Issues list - errors first, then warnings, then info */}
      {safeIssues.length > 0 ? (
        <div className="bg-dark-900 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
          {/* Errors */}
          {errorIssues.map((issue) => {
            const globalIdx = safeIssues.indexOf(issue);
            return (
              <IssueRow
                key={globalIdx}
                issue={issue}
                isExpanded={expandedIssues.has(globalIdx)}
                onToggle={() => toggleIssue(globalIdx)}
              />
            );
          })}
          {/* Warnings */}
          {warningIssues.map((issue) => {
            const globalIdx = safeIssues.indexOf(issue);
            return (
              <IssueRow
                key={globalIdx}
                issue={issue}
                isExpanded={expandedIssues.has(globalIdx)}
                onToggle={() => toggleIssue(globalIdx)}
              />
            );
          })}
          {/* Info */}
          {infoIssues.map((issue) => {
            const globalIdx = safeIssues.indexOf(issue);
            return (
              <IssueRow
                key={globalIdx}
                issue={issue}
                isExpanded={expandedIssues.has(globalIdx)}
                onToggle={() => toggleIssue(globalIdx)}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-4 text-dark-500 text-xs">
          No issues detected
        </div>
      )}

      {/* Last useful event */}
      {data.last_useful_event && (
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded-lg text-[10px]">
          <Clock className="w-3 h-3 text-dark-500" />
          <span className="text-dark-500">Last event:</span>
          <span className="text-dark-400">{data.last_useful_event.event}</span>
          <span className="text-dark-600">-</span>
          <span className="text-dark-400 truncate">{data.last_useful_event.summary}</span>
          <span className="text-dark-600 ml-auto">
            {new Date(data.last_useful_event.timestamp).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * ToolUsagePanel
 *
 * P0-03: Shows tool execution data from TaskState.
 * Displays:
 * - List of tools used with status, duration, output
 * - Total tool calls count
 * - Last tool used (highlighted)
 */

import {
  Wrench,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui';
import type { ToolExecutionRecord } from '../../types';

interface ToolUsagePanelProps {
  toolExecutions: ToolExecutionRecord[] | null | undefined;
  toolCallsCount: number | null | undefined;
  lastToolUsed: string | null | undefined;
  isLoading?: boolean;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusIcon({ success, className }: { success: boolean; className?: string }) {
  if (success) {
    return <CheckCircle className={`w-4 h-4 text-green-400 ${className || ''}`} />;
  }
  return <XCircle className={`w-4 h-4 text-red-400 ${className || ''}`} />;
}

function ToolExecutionRow({
  execution,
  isLast,
}: {
  execution: ToolExecutionRecord;
  isLast?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOutput = execution.outputSummary && execution.outputSummary.length > 0;
  const hasError = execution.error && execution.error.length > 0;
  const isExpandable = hasOutput || hasError;

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString();
  };

  const truncate = (text: string, maxLen: number = 100) => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  };

  return (
    <div
      className={`border border-dark-700 rounded-lg overflow-hidden ${
        isLast ? 'ring-1 ring-primary-500/30' : ''
      }`}
    >
      {/* Main row */}
      <div
        className={`flex items-center justify-between p-3 ${
          isExpandable ? 'cursor-pointer hover:bg-dark-750' : ''
        } ${isLast ? 'bg-primary-500/5' : 'bg-dark-800'}`}
        onClick={() => isExpandable && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <StatusIcon success={execution.success} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{execution.toolName}</span>
              {isLast && (
                <Badge variant="active" className="text-xs">Latest</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-dark-500">
              <Clock className="w-3 h-3" />
              <span>{formatTime(execution.executedAt)}</span>
              <span className="text-dark-600">•</span>
              <span>{execution.durationMs}ms</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={execution.success ? 'success' : 'error'}
            className="text-xs"
          >
            {execution.success ? 'Success' : 'Failed'}
          </Badge>
          {isExpandable && (
            isExpanded ? (
              <ChevronUp className="w-4 h-4 text-dark-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-dark-400" />
            )
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3 bg-dark-850 border-t border-dark-700 space-y-2">
          {hasOutput && (
            <div>
              <p className="text-xs text-dark-500 mb-1">Output:</p>
              <pre className="text-xs bg-dark-900 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap text-dark-300">
                {truncate(execution.outputSummary!, 500)}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <p className="text-xs text-red-400 mb-1">Error:</p>
              <pre className="text-xs bg-red-500/10 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap text-red-300">
                {truncate(execution.error!, 500)}
              </pre>
            </div>
          )}
          <div className="text-xs text-dark-600">
            ID: {execution.executionId}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ToolUsagePanel({
  toolExecutions,
  toolCallsCount,
  lastToolUsed,
  isLoading,
}: ToolUsagePanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-dark-700 rounded w-1/3" />
        <div className="h-16 bg-dark-700 rounded" />
        <div className="h-16 bg-dark-700 rounded" />
      </div>
    );
  }

  const safeExecutions = toolExecutions || [];
  const count = toolCallsCount ?? 0;
  const lastTool = lastToolUsed ?? null;

  // Empty state
  if (safeExecutions.length === 0 && count === 0) {
    return (
      <div className="text-center py-8">
        <Wrench className="w-8 h-8 text-dark-500 mx-auto mb-3" />
        <p className="text-dark-400">No tools executed</p>
        <p className="text-dark-500 text-sm mt-1">
          Tool usage will appear here when the agent executes tools
        </p>
      </div>
    );
  }

  // Calculate stats
  const successCount = safeExecutions.filter(e => e.success).length;
  const failedCount = safeExecutions.filter(e => !e.success).length;
  const totalDurationMs = safeExecutions.reduce((acc, e) => acc + e.durationMs, 0);

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-dark-900 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold">{count}</p>
          <p className="text-xs text-dark-500">Total Calls</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-green-400">{successCount}</p>
          <p className="text-xs text-dark-500">Succeeded</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-red-400">{failedCount}</p>
          <p className="text-xs text-dark-500">Failed</p>
        </div>
        <div className="bg-dark-900 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold">{totalDurationMs}</p>
          <p className="text-xs text-dark-500">Total ms</p>
        </div>
      </div>

      {/* Last tool used highlight */}
      {lastTool && (
        <div className="flex items-center gap-2 p-2 bg-primary-500/10 border border-primary-500/30 rounded-lg">
          <Wrench className="w-4 h-4 text-primary-400" />
          <span className="text-sm text-primary-300">Last tool used:</span>
          <Badge variant="active" className="text-xs">{lastTool}</Badge>
        </div>
      )}

      {/* Executions list */}
      {safeExecutions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-dark-300">
            Recent Executions ({safeExecutions.length})
          </h4>
          <div className="space-y-2">
            {safeExecutions.map((execution, index) => (
              <ToolExecutionRow
                key={execution.executionId}
                execution={execution}
                isLast={index === 0 && execution.toolName === lastTool}
              />
            ))}
          </div>
        </div>
      )}

      {/* Show note if count > displayed */}
      {count > safeExecutions.length && (
        <p className="text-xs text-dark-500 text-center">
          Showing {safeExecutions.length} of {count} total executions
        </p>
      )}
    </div>
  );
}

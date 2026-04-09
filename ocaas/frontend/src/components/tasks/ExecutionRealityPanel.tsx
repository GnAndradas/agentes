/**
 * ExecutionRealityPanel
 *
 * Shows the REAL execution state of a task by combining data from:
 * - OCAAS internal state
 * - OpenClaw session status
 * - Runtime events presence
 *
 * Purpose: Make it clear when a task is "running" internally vs
 * actually executing in OpenClaw runtime.
 */

import { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { taskApi } from '../../lib/api';
import type {
  RuntimeProgressResponse,
  RuntimeEventsResponse,
  TaskDebugSummary,
} from '../../types';

interface ExecutionRealityPanelProps {
  taskId: string;
  taskStatus: string;
  refreshInterval?: number;
}

type RealityStatus = 'yes' | 'no' | 'unknown' | 'partial';

interface RealityItem {
  label: string;
  status: RealityStatus;
  detail?: string;
}

const statusIcons: Record<RealityStatus, React.ElementType> = {
  yes: CheckCircle,
  no: XCircle,
  unknown: HelpCircle,
  partial: AlertTriangle,
};

const statusColors: Record<RealityStatus, string> = {
  yes: 'text-green-400',
  no: 'text-red-400',
  unknown: 'text-dark-500',
  partial: 'text-yellow-400',
};

export function ExecutionRealityPanel({
  taskId,
  taskStatus,
  refreshInterval = 10000,
}: ExecutionRealityPanelProps) {
  const [runtimeProgress, setRuntimeProgress] = useState<RuntimeProgressResponse | null>(null);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEventsResponse | null>(null);
  const [debugSummary, setDebugSummary] = useState<TaskDebugSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [progressRes, eventsRes, debugRes] = await Promise.all([
        taskApi.getRuntimeProgress(taskId).catch(() => null),
        taskApi.getRuntimeEvents(taskId).catch(() => null),
        taskApi.getDebugSummary(taskId).catch(() => null),
      ]);
      setRuntimeProgress(progressRes);
      setRuntimeEvents(eventsRes);
      setDebugSummary(debugRes);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0 && (taskStatus === 'running' || taskStatus === 'assigned')) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, taskStatus, refreshInterval]);

  // Derive reality items
  const items: RealityItem[] = [];

  // 1. OCAAS State
  const ocaasState = (() => {
    if (['running', 'completed', 'failed'].includes(taskStatus)) {
      return { status: 'yes' as RealityStatus, detail: taskStatus };
    }
    if (['pending', 'queued', 'assigned'].includes(taskStatus)) {
      return { status: 'partial' as RealityStatus, detail: `${taskStatus} (not executing)` };
    }
    return { status: 'unknown' as RealityStatus, detail: taskStatus };
  })();
  items.push({ label: 'OCAAS State', ...ocaasState });

  // 2. OpenClaw Session
  const sessionStatus = runtimeProgress?.sessionStatus;
  const sessionItem: RealityItem = (() => {
    if (sessionStatus === 'active') {
      return { label: 'OpenClaw Session', status: 'yes', detail: 'active' };
    }
    if (sessionStatus === 'inactive') {
      return { label: 'OpenClaw Session', status: 'partial', detail: 'inactive' };
    }
    if (sessionStatus === 'not_found') {
      return { label: 'OpenClaw Session', status: 'no', detail: 'not found' };
    }
    return { label: 'OpenClaw Session', status: 'unknown', detail: sessionStatus || 'unknown' };
  })();
  items.push(sessionItem);

  // 3. Runtime Events
  const hasEvents = runtimeEvents?.hasEvents && runtimeEvents.events.length > 0;
  const eventCount = runtimeEvents?.events?.length || 0;
  items.push({
    label: 'Runtime Events',
    status: hasEvents ? 'yes' : runtimeEvents?.logExists ? 'partial' : 'no',
    detail: hasEvents ? `${eventCount} events` : runtimeEvents?.logExists ? 'log exists, no events' : 'no log',
  });

  // 4. Session Key
  const hasSessionKey = !!runtimeProgress?.sessionKey || !!runtimeEvents?.sessionKey;
  items.push({
    label: 'Session Key',
    status: hasSessionKey ? 'yes' : 'no',
    detail: hasSessionKey ? 'assigned' : 'none',
  });

  // 5. Debug Summary
  items.push({
    label: 'Debug Available',
    status: debugSummary?.overall_status === 'pass' ? 'yes' : debugSummary ? 'partial' : 'unknown',
    detail: debugSummary?.overall_status || 'loading',
  });

  // Determine overall execution reality
  const isSessionActive = sessionStatus === 'active';
  const realExecution = (() => {
    // Real execution evidence: session active OR runtime events present
    if (isSessionActive || hasEvents) {
      return { status: 'yes' as RealityStatus, label: 'Real OpenClaw Execution' };
    }
    // Only OCAAS internal (running but no evidence of real execution)
    if (taskStatus === 'running' && !hasEvents) {
      return { status: 'no' as RealityStatus, label: 'Internal Progress Only' };
    }
    // Not running
    if (taskStatus === 'completed' || taskStatus === 'failed') {
      return { status: 'partial' as RealityStatus, label: 'Execution Completed' };
    }
    return { status: 'unknown' as RealityStatus, label: 'Unknown' };
  })();

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 p-3">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-12 bg-dark-700 rounded" />
      </div>
    );
  }

  const RealityIcon = statusIcons[realExecution.status];
  const realityColor = statusColors[realExecution.status];

  return (
    <div className="p-3 space-y-3">
      {/* Header with overall status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <Zap className="w-4 h-4 text-primary-400" />
          Execution Reality
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded ${realExecution.status === 'yes' ? 'bg-green-900/30' : realExecution.status === 'no' ? 'bg-red-900/30' : 'bg-dark-800'}`}>
          <RealityIcon className={`w-4 h-4 ${realityColor}`} />
          <span className={`text-xs font-medium ${realityColor}`}>
            {realExecution.label}
          </span>
        </div>
      </div>

      {/* Warning for internal-only running */}
      {taskStatus === 'running' && realExecution.status === 'no' && (
        <div className="flex items-start gap-2 p-2 bg-yellow-900/20 border border-yellow-800/30 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-yellow-400/80">
            Task shows as "running" but no evidence of real OpenClaw execution.
            Check session status and runtime events.
          </div>
        </div>
      )}

      {/* Reality items grid */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const Icon = statusIcons[item.status];
          const color = statusColors[item.status];
          return (
            <div
              key={item.label}
              className="flex items-center gap-2 p-2 bg-dark-900 rounded"
            >
              <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-dark-500">{item.label}</p>
                <p className={`text-xs ${color} truncate`} title={item.detail}>
                  {item.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

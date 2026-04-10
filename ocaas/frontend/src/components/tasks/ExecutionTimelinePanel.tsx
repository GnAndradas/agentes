/**
 * ExecutionTimelinePanel
 *
 * Unified chronological view of all 3 observability layers.
 * Does NOT replace individual panels - this is an aggregated view.
 *
 * Layers:
 * - ocaas_internal (blue) - OCAAS orchestrator state
 * - openclaw_status (cyan) - OpenClaw session status
 * - openclaw_runtime (green) - Real hook events
 */

import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  Layers,
  ChevronDown,
  ChevronRight,
  Server,
  Wifi,
  FileText,
} from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { ExecutionTimelineResponse, TimelineEvent, TimelineLayer } from '../../types';

interface ExecutionTimelinePanelProps {
  taskId: string;
  refreshInterval?: number;
}

// Layer configuration
const layerConfig: Record<TimelineLayer, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  ocaas_internal: {
    icon: Server,
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/30',
    label: 'OCAAS',
  },
  openclaw_status: {
    icon: Wifi,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-900/30',
    label: 'Session',
  },
  openclaw_runtime: {
    icon: FileText,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/30',
    label: 'Runtime',
  },
};

// Stage colors
const stageColors: Record<string, string> = {
  initializing: 'text-purple-400',
  executing: 'text-blue-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  paused: 'text-yellow-400',
  receiving: 'text-blue-400',
  processing: 'text-cyan-400',
  responding: 'text-green-400',
  tool_calling: 'text-orange-400',
  tool_complete: 'text-emerald-400',
  updating: 'text-yellow-400',
};

function EventRow({ event, isExpanded, onToggle }: { event: TimelineEvent; isExpanded: boolean; onToggle: () => void }) {
  const layer = layerConfig[event.layer];
  const LayerIcon = layer.icon;
  const hasMetadata = event.metadata && Object.keys(event.metadata).length > 0;
  const stageColor = stageColors[event.stage] || 'text-dark-400';

  return (
    <div className="border-b border-dark-800 last:border-b-0">
      <div
        className={`flex items-start gap-2 p-2 ${hasMetadata ? 'cursor-pointer hover:bg-dark-800/50' : ''}`}
        onClick={hasMetadata ? onToggle : undefined}
      >
        {/* Expand icon */}
        <div className="w-4 pt-0.5 flex-shrink-0">
          {hasMetadata && (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-dark-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-dark-500" />
            )
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[9px] text-dark-500 font-mono w-16 flex-shrink-0 pt-0.5">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>

        {/* Layer badge */}
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${layer.bgColor} flex-shrink-0`}>
          <LayerIcon className={`w-3 h-3 ${layer.color}`} />
          <span className={`text-[9px] font-medium ${layer.color}`}>{layer.label}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-dark-200">{event.event}</span>
            <span className={`text-[10px] ${stageColor}`}>[{event.stage}]</span>
          </div>
          <p className="text-[11px] text-dark-400 truncate" title={event.summary}>
            {event.summary}
          </p>
        </div>
      </div>

      {/* Metadata expansion */}
      {isExpanded && hasMetadata && (
        <div className="px-8 pb-2">
          <pre className="text-[9px] text-dark-500 bg-dark-950 p-2 rounded overflow-x-auto">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ExecutionTimelinePanel({ taskId, refreshInterval = 5000 }: ExecutionTimelinePanelProps) {
  const [data, setData] = useState<ExecutionTimelineResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const fetchTimeline = async () => {
    try {
      const result = await taskApi.getExecutionTimeline(taskId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch timeline');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchTimeline, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, refreshInterval]);

  const toggleEvent = (idx: number) => {
    setExpandedEvents(prev => {
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
        <div className="h-32 bg-dark-700 rounded" />
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
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No timeline data
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <Layers className="w-4 h-4 text-primary-400" />
          Execution Timeline
        </div>
        <Badge variant={data.totalEvents > 0 ? 'active' : 'default'} className="text-[10px]">
          {data.totalEvents} events
        </Badge>
      </div>

      {/* Layer summary */}
      {data.layers && typeof data.layers === 'object' && (
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(data.layers) as TimelineLayer[]).map(layerKey => {
            const layer = layerConfig[layerKey];
            if (!layer) return null;
            const stats = data.layers[layerKey];
            if (!stats) return null;
            const LayerIcon = layer.icon;
            return (
              <div
                key={layerKey}
                className={`flex items-center gap-1 px-2 py-1 rounded ${layer.bgColor} ${!stats.available ? 'opacity-40' : ''}`}
              >
                <LayerIcon className={`w-3 h-3 ${layer.color}`} />
                <span className={`text-[10px] ${layer.color}`}>
                  {layer.label}: {stats.eventCount ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Correlation info */}
      {(data.sessionKey || data.jobId) && (
        <div className="flex items-center gap-3 text-[10px] text-dark-500">
          {data.sessionKey && (
            <span className="font-mono truncate" title={data.sessionKey}>
              Session: {data.sessionKey.substring(0, 25)}...
            </span>
          )}
          {data.jobId && (
            <span className="font-mono">
              Job: {data.jobId.substring(0, 8)}
            </span>
          )}
        </div>
      )}

      {/* Events list */}
      {Array.isArray(data.events) && data.events.length > 0 ? (
        <div className="bg-dark-900 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
          {data.events.map((event, idx) => (
            <EventRow
              key={`${event.timestamp}-${idx}`}
              event={event}
              isExpanded={expandedEvents.has(idx)}
              onToggle={() => toggleEvent(idx)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-dark-500">
          <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No events yet</p>
          <p className="text-[10px] mt-1">
            Events will appear as the task executes
          </p>
        </div>
      )}
    </div>
  );
}

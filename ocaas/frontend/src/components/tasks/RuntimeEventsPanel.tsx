/**
 * RuntimeEventsPanel
 *
 * Shows REAL runtime events from OpenClaw progress-tracker hook.
 * These events are captured by the hook and written to JSONL files.
 *
 * Events tracked:
 * - message:received - User message received
 * - message:preprocessed - Message preprocessed
 * - message:sent - Response sent
 * - agent:bootstrap - Session initialized
 * - session:patch - Session updated
 * - tool:call - Tool invocation started
 * - tool:result - Tool invocation completed
 *
 * IMPORTANT: This shows REAL events from OpenClaw, NOT inferred data.
 */

import { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  MessageSquare,
  Wrench,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { RuntimeEventsResponse, RuntimeEvent } from '../../types';

interface RuntimeEventsPanelProps {
  taskId: string;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
}

// Event type icons
const eventIcons: Record<string, React.ElementType> = {
  'message:received': MessageSquare,
  'message:preprocessed': FileText,
  'message:sent': MessageSquare,
  'agent:bootstrap': Play,
  'session:patch': RefreshCw,
  'tool:call': Wrench,
  'tool:result': CheckCircle,
};

// Event type colors
const eventColors: Record<string, string> = {
  'message:received': 'text-blue-400',
  'message:preprocessed': 'text-cyan-400',
  'message:sent': 'text-green-400',
  'agent:bootstrap': 'text-purple-400',
  'session:patch': 'text-yellow-400',
  'tool:call': 'text-orange-400',
  'tool:result': 'text-emerald-400',
};

// Stage colors
const stageColors: Record<string, string> = {
  initializing: 'bg-purple-900/30 text-purple-400',
  processing: 'bg-blue-900/30 text-blue-400',
  executing: 'bg-orange-900/30 text-orange-400',
  responding: 'bg-green-900/30 text-green-400',
  completed: 'bg-emerald-900/30 text-emerald-400',
  error: 'bg-red-900/30 text-red-400',
};

function EventRow({ event, isExpanded, onToggle }: { event: RuntimeEvent; isExpanded: boolean; onToggle: () => void }) {
  const EventIcon = eventIcons[event.event] || Activity;
  const colorClass = eventColors[event.event] || 'text-dark-400';
  const stageClass = stageColors[event.stage] || 'bg-dark-800 text-dark-400';
  const hasMetadata = event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <div className="border-b border-dark-800 last:border-b-0">
      <div
        className={`flex items-start gap-2 p-2 ${hasMetadata ? 'cursor-pointer hover:bg-dark-800/50' : ''}`}
        onClick={hasMetadata ? onToggle : undefined}
      >
        {/* Expand icon */}
        <div className="w-4 pt-0.5">
          {hasMetadata && (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-dark-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-dark-500" />
            )
          )}
        </div>

        {/* Event icon */}
        <EventIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colorClass}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-dark-200">{event.event}</span>
            <Badge className={`text-[9px] py-0 px-1 ${stageClass}`}>
              {event.stage}
            </Badge>
          </div>
          <p className="text-[11px] text-dark-400 truncate" title={event.summary}>
            {event.summary}
          </p>
        </div>

        {/* Timestamp */}
        <span className="text-[9px] text-dark-500 flex-shrink-0">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
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

export function RuntimeEventsPanel({ taskId, refreshInterval = 5000 }: RuntimeEventsPanelProps) {
  const [data, setData] = useState<RuntimeEventsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const fetchEvents = async () => {
    try {
      const result = await taskApi.getRuntimeEvents(taskId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runtime events');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchEvents, refreshInterval);
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
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-24 bg-dark-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800/50 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-4 text-dark-500 text-sm">
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No runtime events data
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <FileText className="w-4 h-4 text-emerald-400" />
          OpenClaw Runtime Events
          <span className="text-[9px] text-dark-500 font-normal">(progress-tracker hook)</span>
        </div>
        <Badge variant={data.hasEvents ? 'active' : 'default'} className="text-[10px]">
          {data.events.length} events
        </Badge>
      </div>

      {/* Log file status */}
      <div className="flex items-center gap-3 p-2 bg-dark-900 rounded-lg text-xs">
        {data.logExists ? (
          <CheckCircle className="w-4 h-4 text-green-400" />
        ) : (
          <XCircle className="w-4 h-4 text-dark-500" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-dark-300">
            Log file: {data.logExists ? 'Found' : 'Not found'}
          </p>
          {data.logPath && (
            <p className="text-[10px] text-dark-500 font-mono truncate" title={data.logPath}>
              {data.logPath}
            </p>
          )}
        </div>
        {data.sessionKey && (
          <Badge variant="default" className="text-[9px]">
            {data.sessionKey.substring(0, 20)}...
          </Badge>
        )}
      </div>

      {/* Limitation warning if present */}
      {data.limitation && (
        <div className="flex items-start gap-2 p-2 bg-yellow-900/10 border border-yellow-800/30 rounded-lg">
          <AlertTriangle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-yellow-400/70">{data.limitation}</p>
        </div>
      )}

      {/* Events list */}
      {data.hasEvents ? (
        <div className="bg-dark-900 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
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
          <p className="text-xs">No runtime events yet</p>
          <p className="text-[10px] mt-1">
            Events will appear when the OpenClaw hook captures them
          </p>
        </div>
      )}

      {/* Source indicator */}
      <div className="flex items-center justify-end gap-1 text-[9px] text-dark-600">
        <span>Source:</span>
        <Badge variant="default" className="text-[8px] py-0 px-1">
          {data.source}
        </Badge>
      </div>
    </div>
  );
}

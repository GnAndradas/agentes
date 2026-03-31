import { useEffect, useState, useRef } from 'react';
import {
  X,
  Minimize2,
  Maximize2,
  Terminal,
  Trash2,
  Pause,
  Play,
  Bot,
  Sparkles,
  Wrench,
  Cpu,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { socketClient } from '../../lib/socket';
import { useAppStore } from '../../stores/app';
import type { WSEvent } from '../../types';

interface MonitorEvent {
  id: string;
  timestamp: number;
  type: string;
  category: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}

const categoryIcons: Record<string, typeof Activity> = {
  gateway: Terminal,
  generation: Cpu,
  orchestrator: Activity,
  agent: Bot,
  skill: Sparkles,
  tool: Wrench,
};

const severityColors: Record<string, string> = {
  info: 'text-blue-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

const severityIcons: Record<string, typeof Activity> = {
  info: CheckCircle,
  warning: AlertCircle,
  error: AlertCircle,
};

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function GatewayMonitor() {
  const { monitorOpen, monitorMinimized, setMonitorOpen, setMonitorMinimized } = useAppStore();
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);

  // Keep ref in sync
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Subscribe to events
  useEffect(() => {
    if (!monitorOpen) return;

    const handleEvent = (event: WSEvent) => {
      if (pausedRef.current) return;

      // Extract payload - EventBridge puts flat fields in payload
      const payload = event.payload as Record<string, unknown> | undefined;

      // Category comes from: payload.category (canonical) > channel (fallback)
      const category = (payload?.category as string) || event.channel;

      // Filter to relevant categories
      const relevantCategories = ['gateway', 'generation', 'orchestrator', 'system', 'events', 'workflow', 'approval'];
      if (!relevantCategories.includes(category) && !relevantCategories.includes(event.channel)) {
        return;
      }

      // Extract data object if present (nested payload data)
      const data = (payload?.data && typeof payload.data === 'object')
        ? payload.data as Record<string, unknown>
        : undefined;

      const newEvent: MonitorEvent = {
        id: crypto.randomUUID(),
        timestamp: event.timestamp || Date.now(),
        type: event.type,
        // Use flat fields from payload (canonical) with fallbacks
        category,
        message: (payload?.message as string) || event.type,
        severity: (payload?.severity as 'info' | 'warning' | 'error') || 'info',
        data: {
          ...data,
          resourceId: payload?.resourceId as string | undefined,
          resourceType: payload?.resourceType as string | undefined,
        },
      };

      setEvents((prev) => [newEvent, ...prev.slice(0, 99)]); // Keep last 100
    };

    // Subscribe to all events
    const unsubscribe = socketClient.on('*', handleEvent);

    return () => {
      unsubscribe();
    };
  }, [monitorOpen]);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  if (!monitorOpen) return null;

  const filteredEvents = filter === 'all'
    ? events
    : events.filter((e) => e.category === filter);

  const handleClose = () => {
    setMonitorOpen(false);
    setEvents([]);
  };

  const handleClear = () => {
    setEvents([]);
  };

  return (
    <div
      className={`fixed right-4 bg-dark-900 border border-dark-700 rounded-lg shadow-2xl z-50 flex flex-col transition-all duration-200 ${
        monitorMinimized
          ? 'bottom-12 w-72 h-10'
          : 'bottom-12 w-[480px] h-[400px]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-dark-700 bg-dark-850 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium">Gateway Monitor</span>
          {events.length > 0 && (
            <span className="text-xs text-dark-400">({events.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!monitorMinimized && (
            <>
              <button
                onClick={() => setPaused(!paused)}
                className="p-1 hover:bg-dark-700 rounded"
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? (
                  <Play className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Pause className="w-3.5 h-3.5 text-dark-400" />
                )}
              </button>
              <button
                onClick={handleClear}
                className="p-1 hover:bg-dark-700 rounded"
                title="Clear"
              >
                <Trash2 className="w-3.5 h-3.5 text-dark-400" />
              </button>
            </>
          )}
          <button
            onClick={() => setMonitorMinimized(!monitorMinimized)}
            className="p-1 hover:bg-dark-700 rounded"
            title={monitorMinimized ? 'Expand' : 'Minimize'}
          >
            {monitorMinimized ? (
              <Maximize2 className="w-3.5 h-3.5 text-dark-400" />
            ) : (
              <Minimize2 className="w-3.5 h-3.5 text-dark-400" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-dark-700 rounded"
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-dark-400" />
          </button>
        </div>
      </div>

      {/* Content (only shown when not minimized) */}
      {!monitorMinimized && (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-dark-800 bg-dark-850/50">
            <span className="text-xs text-dark-500">Filter:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs bg-dark-800 border border-dark-700 rounded px-2 py-0.5 text-dark-300"
            >
              <option value="all">All</option>
              <option value="gateway">Gateway</option>
              <option value="generation">Generations</option>
              <option value="orchestrator">Orchestrator</option>
              <option value="system">System</option>
            </select>
            {paused && (
              <span className="text-xs text-yellow-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Paused
              </span>
            )}
          </div>

          {/* Events list */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto font-mono text-xs"
          >
            {filteredEvents.length === 0 ? (
              <div className="flex items-center justify-center h-full text-dark-500">
                Waiting for events...
              </div>
            ) : (
              <div className="divide-y divide-dark-800/50">
                {filteredEvents.map((event) => {
                  const CategoryIcon = categoryIcons[event.category] || Activity;
                  const SeverityIcon = severityIcons[event.severity];
                  const colorClass = severityColors[event.severity];

                  return (
                    <div
                      key={event.id}
                      className="px-3 py-1.5 hover:bg-dark-800/50"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-dark-600 shrink-0">
                          {formatTime(event.timestamp)}
                        </span>
                        <CategoryIcon className="w-3.5 h-3.5 text-dark-500 shrink-0 mt-0.5" />
                        <SeverityIcon className={`w-3.5 h-3.5 ${colorClass} shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <span className={`${colorClass}`}>{event.message}</span>
                          {typeof event.data?.resourceId === 'string' && (
                            <span className="text-dark-600 ml-2">
                              [{event.data.resourceId.slice(0, 8)}]
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

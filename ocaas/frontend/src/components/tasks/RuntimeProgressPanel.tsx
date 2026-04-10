/**
 * RuntimeProgressPanel
 *
 * Shows OpenClaw runtime progress (session status).
 *
 * IMPORTANT LIMITATION: OpenClaw does NOT expose runtime events via API.
 * This panel can only show session status (active/inactive/not_found).
 * Tool usage, message streams, and execution details are NOT available.
 */

import { useState, useEffect } from 'react';
import { Activity, AlertTriangle, CheckCircle, XCircle, Clock, Wifi, WifiOff, Info } from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { RuntimeProgressResponse } from '../../types';

interface RuntimeProgressPanelProps {
  taskId: string;
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
}

const sessionStatusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  active: { icon: Activity, color: 'text-green-400', label: 'Active' },
  inactive: { icon: Clock, color: 'text-dark-400', label: 'Inactive' },
  error: { icon: XCircle, color: 'text-red-400', label: 'Error' },
  not_found: { icon: AlertTriangle, color: 'text-yellow-400', label: 'Not Found' },
  unknown: { icon: AlertTriangle, color: 'text-dark-500', label: 'Unknown' },
};

export function RuntimeProgressPanel({ taskId, refreshInterval = 10000 }: RuntimeProgressPanelProps) {
  const [progress, setProgress] = useState<RuntimeProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = async () => {
    try {
      const data = await taskApi.getRuntimeProgress(taskId);
      setProgress(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runtime progress');
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

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-16 bg-dark-700 rounded" />
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

  if (!progress) {
    return (
      <div className="text-center py-4 text-dark-500 text-sm">
        <Activity className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No runtime data
      </div>
    );
  }

  const statusConfig = sessionStatusConfig[progress.sessionStatus] || sessionStatusConfig.unknown;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <Wifi className="w-4 h-4 text-cyan-400" />
          OpenClaw Runtime
          <span className="text-[9px] text-dark-500 font-normal">(session status)</span>
        </div>
        <Badge variant={progress.hasRuntimeProgress ? 'active' : 'default'} className="text-[10px]">
          {statusConfig.label}
        </Badge>
      </div>

      {/* Session Status */}
      <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg">
        <StatusIcon className={`w-5 h-5 ${statusConfig.color}`} />
        <div className="flex-1">
          <p className="text-sm font-medium">Session: {progress.sessionStatus}</p>
          {progress.sessionId && (
            <p className="text-xs text-dark-500 font-mono truncate" title={progress.sessionId}>
              {progress.sessionId}
            </p>
          )}
        </div>
        {progress.hasRuntimeProgress ? (
          <CheckCircle className="w-4 h-4 text-green-400" />
        ) : (
          <WifiOff className="w-4 h-4 text-dark-500" />
        )}
      </div>

      {/* API Limitation Warning */}
      {progress.limitation && (
        <div className="flex items-start gap-2 p-3 bg-yellow-900/10 border border-yellow-800/30 rounded-lg">
          <Info className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-xs text-yellow-400 font-medium">API Limitation</p>
            <p className="text-[10px] text-yellow-400/70">{progress.limitation}</p>
            {Array.isArray(progress.availableApis) && progress.availableApis.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="text-[9px] text-dark-500">Available:</span>
                {progress.availableApis.map(api => (
                  <Badge key={api} variant="default" className="text-[8px] py-0 px-1">
                    {api}
                  </Badge>
                ))}
              </div>
            )}
            {Array.isArray(progress.missingApis) && progress.missingApis.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-[9px] text-dark-500">Missing:</span>
                {progress.missingApis.map(api => (
                  <Badge key={api} variant="error" className="text-[8px] py-0 px-1 opacity-50">
                    {api}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Events (if any) */}
      {Array.isArray(progress.events) && progress.events.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-dark-500 uppercase tracking-wider">Events</p>
          {progress.events.map((event, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 bg-dark-800 rounded text-xs">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span className="text-dark-300">{event.summary}</span>
              <span className="text-[9px] text-dark-500 ml-auto">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* No Events State */}
      {(!Array.isArray(progress.events) || progress.events.length === 0) && (
        <p className="text-[10px] text-dark-500 text-center py-2">
          No runtime events available. OpenClaw does not expose event streams via API.
        </p>
      )}
    </div>
  );
}

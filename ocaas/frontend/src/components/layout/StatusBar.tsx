import { useQuery } from '@tanstack/react-query';
import {
  Wifi,
  WifiOff,
  Server,
  ServerOff,
  Activity,
  ChevronUp,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Cpu,
} from 'lucide-react';
import { systemApi } from '../../lib/api';
import { useAppStore, type StatusActivity } from '../../stores/app';

const activityIcons = {
  gateway: Server,
  generation: Cpu,
  task: Activity,
  approval: CheckCircle2,
  sync: Loader2,
};

const statusColors = {
  pending: 'text-yellow-400',
  running: 'text-blue-400',
  success: 'text-green-400',
  error: 'text-red-400',
};

function ActivityItem({ activity }: { activity: StatusActivity }) {
  const Icon = activityIcons[activity.type] || Activity;
  const colorClass = statusColors[activity.status];
  const isRunning = activity.status === 'running' || activity.status === 'pending';
  const timeAgo = Math.floor((Date.now() - activity.timestamp) / 1000);
  const timeStr = timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m`;

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-dark-800 rounded">
      <Icon className={`w-3 h-3 ${colorClass} ${isRunning ? 'animate-pulse' : ''}`} />
      <span className="flex-1 truncate text-dark-300">{activity.message}</span>
      <span className="text-dark-500">{timeStr}</span>
      {activity.status === 'running' && (
        <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
      )}
      {activity.status === 'success' && (
        <CheckCircle2 className="w-3 h-3 text-green-400" />
      )}
      {activity.status === 'error' && (
        <XCircle className="w-3 h-3 text-red-400" />
      )}
    </div>
  );
}

export function StatusBar() {
  const {
    connected,
    gatewayConnected,
    statusBarVisible,
    toggleStatusBar,
    activities,
    clearActivities,
    setGatewayConnected,
  } = useAppStore();

  // Check gateway health periodically
  useQuery({
    queryKey: ['system', 'health'],
    queryFn: async () => {
      try {
        const result = await systemApi.health();
        setGatewayConnected(true);
        return result;
      } catch {
        setGatewayConnected(false);
        return null;
      }
    },
    refetchInterval: 10000, // Every 10 seconds
    retry: false,
  });

  // Get orchestrator status
  const { data: orchestratorData } = useQuery({
    queryKey: ['system', 'orchestrator'],
    queryFn: systemApi.getOrchestrator,
    refetchInterval: 5000,
    retry: false,
  });

  const runningActivities = activities.filter(
    (a) => a.status === 'running' || a.status === 'pending'
  );
  const recentActivities = activities.slice(0, 10);

  return (
    <div className="border-t border-dark-800 bg-dark-900">
      {/* Expandable activity panel */}
      {statusBarVisible && (
        <div className="border-b border-dark-800 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1 bg-dark-850">
            <span className="text-xs font-medium text-dark-400">Activity Log</span>
            <button
              onClick={clearActivities}
              className="p-1 hover:bg-dark-700 rounded text-dark-500 hover:text-dark-300"
              title="Clear activities"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {recentActivities.length === 0 ? (
            <div className="px-3 py-2 text-xs text-dark-500">No recent activity</div>
          ) : (
            <div className="py-1">
              {recentActivities.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 text-xs">
        <div className="flex items-center gap-4">
          {/* WebSocket connection */}
          <div className="flex items-center gap-1.5" title="WebSocket connection">
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-400" />
                <span className="text-dark-400">WS Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400">WS Disconnected</span>
              </>
            )}
          </div>

          {/* Gateway connection */}
          <div className="flex items-center gap-1.5" title="OpenClaw Gateway">
            {gatewayConnected ? (
              <>
                <Server className="w-3.5 h-3.5 text-green-400" />
                <span className="text-dark-400">Gateway OK</span>
              </>
            ) : (
              <>
                <ServerOff className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400">Gateway Offline</span>
              </>
            )}
          </div>

          {/* Orchestrator status */}
          {orchestratorData && (
            <div className="flex items-center gap-1.5" title="Orchestrator">
              <Activity
                className={`w-3.5 h-3.5 ${
                  orchestratorData.running ? 'text-green-400' : 'text-dark-500'
                }`}
              />
              <span className="text-dark-400">
                {orchestratorData.running ? 'Running' : 'Stopped'}
                {orchestratorData.queueSize > 0 && (
                  <span className="ml-1 text-yellow-400">
                    ({orchestratorData.queueSize} queued)
                  </span>
                )}
              </span>
            </div>
          )}

          {/* Running activities indicator */}
          {runningActivities.length > 0 && (
            <div className="flex items-center gap-1.5 text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{runningActivities.length} operations</span>
            </div>
          )}
        </div>

        {/* Toggle button */}
        <button
          onClick={toggleStatusBar}
          className="flex items-center gap-1 px-2 py-0.5 hover:bg-dark-800 rounded text-dark-400 hover:text-dark-200"
          title={statusBarVisible ? 'Hide activity log' : 'Show activity log'}
        >
          {activities.length > 0 && (
            <span className="text-dark-500">{activities.length}</span>
          )}
          {statusBarVisible ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

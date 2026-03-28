import { useQuery } from '@tanstack/react-query';
import { Settings as SettingsIcon, Server, Database, Cpu, HardDrive } from 'lucide-react';
import { systemApi } from '../lib/api';
import { Card, CardHeader, Badge } from '../components/ui';

export function Settings() {
  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: systemApi.health,
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: systemApi.stats,
    refetchInterval: 10000,
  });

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardHeader
          title="System Settings"
          description="Configure and monitor your OCAAS installation"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-dark-900 rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-600/20 rounded-lg">
                <Server className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="font-medium">Server Status</p>
                <p className="text-sm text-dark-400">Backend health</p>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-dark-400">Status</span>
              <Badge variant={health?.status === 'ok' ? 'active' : 'error'}>
                {health?.status || 'Unknown'}
              </Badge>
            </div>
          </div>

          <div className="p-4 bg-dark-900 rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary-600/20 rounded-lg">
                <Cpu className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <p className="font-medium">System Resources</p>
                <p className="text-sm text-dark-400">Usage metrics</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Uptime</span>
                <span>{stats?.system?.uptime ? formatUptime(stats.system.uptime) : '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Memory</span>
                <span>
                  {stats?.system?.memoryUsage ? formatMemory(stats.system.memoryUsage) : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-dark-900 rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-600/20 rounded-lg">
                <Database className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="font-medium">Database</p>
                <p className="text-sm text-dark-400">SQLite storage</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Agents</span>
                <span>{stats?.agents?.total ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Tasks</span>
                <span>{stats?.tasks?.total ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Generations</span>
                <span>{stats?.generations?.total ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-dark-900 rounded-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-600/20 rounded-lg">
                <HardDrive className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="font-medium">OpenClaw</p>
                <p className="text-sm text-dark-400">Gateway connection</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-dark-400">Workspace</span>
                <span className="text-xs font-mono text-dark-400">~/.openclaw/workspace</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Configuration"
          description="Environment settings (read-only)"
        />

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-dark-900 rounded-lg">
            <span className="text-dark-400">API Port</span>
            <span className="font-mono">3000</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-dark-900 rounded-lg">
            <span className="text-dark-400">Frontend Port</span>
            <span className="font-mono">5173</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-dark-900 rounded-lg">
            <span className="text-dark-400">Environment</span>
            <Badge>development</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Server,
  Database,
  Cpu,
  HardDrive,
  Activity,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Zap,
  Users,
  GitBranch,
} from 'lucide-react';
import { systemApi } from '../lib/api';
import { Card, CardHeader, Badge, Button } from '../components/ui';
import type { FullDiagnosticsResult } from '../types';

// =============================================================================
// DIAGNOSTICS PANEL COMPONENT
// =============================================================================

function DiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<FullDiagnosticsResult | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);

  const runDiagnostics = useMutation({
    mutationFn: systemApi.fullDiagnostics,
    onSuccess: (data) => {
      setDiagnostics(data);
      setLastRun(Date.now());
    },
  });

  const getStatusIcon = (ok: boolean) => {
    if (ok) return <CheckCircle className="w-4 h-4 text-green-400" />;
    return <XCircle className="w-4 h-4 text-red-400" />;
  };

  const getStatusBadge = (status: 'healthy' | 'degraded' | 'critical') => {
    switch (status) {
      case 'healthy':
        return <Badge variant="success">Healthy</Badge>;
      case 'degraded':
        return <Badge variant="pending">Degraded</Badge>;
      case 'critical':
        return <Badge variant="error">Critical</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader
        title="System Diagnostics"
        description="Run comprehensive system tests"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => runDiagnostics.mutate()}
            disabled={runDiagnostics.isPending}
          >
            {runDiagnostics.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run Diagnostics
              </>
            )}
          </Button>
        }
      />

      {!diagnostics && !runDiagnostics.isPending && (
        <div className="p-8 text-center text-dark-400">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Click "Run Diagnostics" to test all system components</p>
        </div>
      )}

      {runDiagnostics.isError && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="w-4 h-4" />
            <span>Diagnostics failed: {runDiagnostics.error?.message}</span>
          </div>
        </div>
      )}

      {diagnostics && (
        <div className="space-y-4">
          {/* Overall Status */}
          <div className="flex items-center justify-between p-4 bg-dark-900 rounded-lg">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-primary-400" />
              <span className="font-medium">Overall Status</span>
            </div>
            <div className="flex items-center gap-3">
              {getStatusBadge(diagnostics.status)}
              <span className="text-xs text-dark-500">
                {diagnostics.duration_ms}ms
              </span>
            </div>
          </div>

          {/* Individual Checks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Gateway */}
            <div className="p-3 bg-dark-900 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-400" />
                  <span className="font-medium text-sm">Gateway</span>
                </div>
                {getStatusIcon(diagnostics.gateway.ok)}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-dark-500">Reachable</span>
                  <span className={diagnostics.gateway.reachable ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.gateway.reachable ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Authenticated</span>
                  <span className={diagnostics.gateway.authenticated ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.gateway.authenticated ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Latency</span>
                  <span className="text-dark-300">{diagnostics.gateway.latency_ms}ms</span>
                </div>
                {diagnostics.gateway.error && (
                  <div className="mt-1 p-1.5 bg-red-500/10 rounded text-red-400 break-words">
                    {diagnostics.gateway.error}
                  </div>
                )}
              </div>
            </div>

            {/* Hooks - PROMPT 20B: Real hooks test */}
            <div className="p-3 bg-dark-900 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="font-medium text-sm">Hooks</span>
                </div>
                {getStatusIcon(diagnostics.hooks.ok)}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-dark-500">Configured</span>
                  <span className={diagnostics.hooks.configured ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.hooks.configured ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Reached Gateway</span>
                  <span className={diagnostics.hooks.reached_gateway ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.hooks.reached_gateway ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Accepted</span>
                  <span className={diagnostics.hooks.accepted ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.hooks.accepted ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Latency</span>
                  <span className="text-dark-300">{diagnostics.hooks.latency_ms}ms</span>
                </div>
                {diagnostics.hooks.error && (
                  <div className="mt-1 p-1.5 bg-red-500/10 rounded text-red-400 break-words">
                    {diagnostics.hooks.error}
                  </div>
                )}
              </div>
            </div>

            {/* AI Generation - PROMPT 20B: Real AI test with trace */}
            <div className="p-3 bg-dark-900 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-purple-400" />
                  <span className="font-medium text-sm">AI Generation</span>
                </div>
                {getStatusIcon(diagnostics.ai_generation.ok)}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-dark-500">Runtime</span>
                  <Badge
                    variant={diagnostics.ai_generation.runtime === 'unavailable' ? 'error' : 'default'}
                    className="text-xs"
                  >
                    {diagnostics.ai_generation.runtime}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Reached Gateway</span>
                  <span className={diagnostics.ai_generation.reached_gateway ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.ai_generation.reached_gateway ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Response Received</span>
                  <span className={diagnostics.ai_generation.response_received ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.ai_generation.response_received ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Content Usable</span>
                  <span className={diagnostics.ai_generation.content_usable ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.ai_generation.content_usable ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Latency</span>
                  <span className="text-dark-300">{diagnostics.ai_generation.latency_ms}ms</span>
                </div>
                {diagnostics.ai_generation.error_stage && (
                  <div className="flex justify-between">
                    <span className="text-dark-500">Error Stage</span>
                    <span className="text-red-400 font-mono">{diagnostics.ai_generation.error_stage}</span>
                  </div>
                )}
                {diagnostics.ai_generation.error_message && (
                  <div className="mt-1 p-1.5 bg-red-500/10 rounded text-red-400 break-words">
                    {diagnostics.ai_generation.error_message}
                  </div>
                )}
              </div>
            </div>

            {/* Agents */}
            <div className="p-3 bg-dark-900 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-green-400" />
                  <span className="font-medium text-sm">Agents</span>
                </div>
                {getStatusIcon(diagnostics.agents.ok)}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-dark-500">Total</span>
                  <span className="text-dark-300">{diagnostics.agents.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Active</span>
                  <span className="text-green-400">{diagnostics.agents.active}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Materialized</span>
                  <span className="text-dark-300">{diagnostics.agents.materialized}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-dark-500">Runtime Ready</span>
                  <span className={diagnostics.agents.runtime_ready > 0 ? 'text-green-400' : 'text-dark-400'}>
                    {diagnostics.agents.runtime_ready}
                  </span>
                </div>
                {diagnostics.agents.error && (
                  <div className="mt-1 p-1.5 bg-red-500/10 rounded text-red-400 break-words">
                    {diagnostics.agents.error}
                  </div>
                )}
              </div>
            </div>

            {/* Pipeline - PROMPT 20B: Real pipeline test */}
            <div className="p-3 bg-dark-900 rounded-lg md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-orange-400" />
                  <span className="font-medium text-sm">Pipeline</span>
                </div>
                {getStatusIcon(diagnostics.pipeline.ok)}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col">
                  <span className="text-dark-500">Orchestrator</span>
                  <span className={diagnostics.pipeline.orchestrator_running ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.pipeline.orchestrator_running ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-dark-500">Task Created</span>
                  <span className={diagnostics.pipeline.task_created ? 'text-green-400' : 'text-dark-400'}>
                    {diagnostics.pipeline.task_created ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-dark-500">Job Created</span>
                  <span className={diagnostics.pipeline.job_created ? 'text-green-400' : 'text-red-400'}>
                    {diagnostics.pipeline.job_created ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-dark-500">Queue Size</span>
                  <span className="text-dark-300">{diagnostics.pipeline.queue_size}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-dark-500">Stuck Tasks</span>
                  <span className={diagnostics.pipeline.stuck_tasks > 0 ? 'text-red-400' : 'text-green-400'}>
                    {diagnostics.pipeline.stuck_tasks}
                  </span>
                </div>
              </div>
              {diagnostics.pipeline.error && (
                <div className="mt-2 p-1.5 bg-red-500/10 rounded text-red-400 text-xs break-words">
                  {diagnostics.pipeline.error}
                </div>
              )}
            </div>
          </div>

          {/* Last Run Info */}
          {lastRun && (
            <div className="text-xs text-dark-500 text-right">
              Last run: {new Date(lastRun).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// =============================================================================
// MAIN SETTINGS COMPONENT
// =============================================================================

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
      {/* PROMPT 20: Diagnostics Panel */}
      <DiagnosticsPanel />

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

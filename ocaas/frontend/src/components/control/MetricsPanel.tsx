import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Cpu,
  FolderTree,
  GitBranch,
  MessageSquare,
  Shield,
  Zap,
} from 'lucide-react';
import { systemApi } from '../../lib/api';
import { Card, CardHeader, Badge } from '../ui';

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatMemory(mb: number): string {
  if (mb > 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  subValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

function MetricCard({ label, value, icon, subValue, variant = 'default' }: MetricCardProps) {
  const variantClasses = {
    default: 'text-dark-200',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-dark-700/50 rounded-lg">
      <div className="p-2 bg-dark-600 rounded-lg">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-dark-400 truncate">{label}</p>
        <p className={`text-lg font-semibold ${variantClasses[variant]}`}>{value}</p>
        {subValue && <p className="text-xs text-dark-500">{subValue}</p>}
      </div>
    </div>
  );
}

export function MetricsPanel() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['system', 'stats'],
    queryFn: systemApi.stats,
    refetchInterval: 10000, // Refresh every 10s
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="System Metrics" />
        <div className="text-center py-8 text-dark-400">Loading metrics...</div>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card>
        <CardHeader title="System Metrics" />
        <div className="text-center py-8 text-red-400">Failed to load metrics</div>
      </Card>
    );
  }

  // Calculate success rates
  const taskSuccessRate = stats.tasks.total > 0
    ? Math.round((stats.tasks.completed / stats.tasks.total) * 100)
    : 0;

  const subtaskSuccessRate = stats.tasks.subtasks > 0
    ? Math.round((stats.tasks.subtasksCompleted / stats.tasks.subtasks) * 100)
    : 0;

  return (
    <Card>
      <CardHeader
        title="System Metrics"
        description="Real-time operational dashboard"
        action={
          <Badge variant={stats.orchestrator.running ? 'active' : 'error'}>
            {stats.orchestrator.running ? 'Running' : 'Stopped'}
          </Badge>
        }
      />

      {/* Main KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Tasks Total"
          value={stats.tasks.total}
          icon={<Activity className="w-4 h-4 text-primary-400" />}
          subValue={`${taskSuccessRate}% success`}
        />
        <MetricCard
          label="Running"
          value={stats.tasks.running}
          icon={<Zap className="w-4 h-4 text-yellow-400" />}
          subValue={`${stats.tasks.pending + stats.tasks.queued} queued`}
          variant={stats.tasks.running > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Completed"
          value={stats.tasks.completed}
          icon={<CheckCircle className="w-4 h-4 text-green-400" />}
          variant="success"
        />
        <MetricCard
          label="Failed"
          value={stats.tasks.failed}
          icon={<XCircle className="w-4 h-4 text-red-400" />}
          variant={stats.tasks.failed > 0 ? 'error' : 'default'}
        />
      </div>

      {/* Task Hierarchy */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <MetricCard
          label="Decomposed Tasks"
          value={stats.tasks.decomposed}
          icon={<FolderTree className="w-4 h-4 text-green-400" />}
          subValue={`${stats.tasks.parentTasks} parent tasks`}
        />
        <MetricCard
          label="Subtasks"
          value={stats.tasks.subtasks}
          icon={<GitBranch className="w-4 h-4 text-yellow-400" />}
          subValue={`${subtaskSuccessRate}% success`}
        />
        <MetricCard
          label="Queue Size"
          value={stats.orchestrator.queueSize}
          icon={<Clock className="w-4 h-4 text-blue-400" />}
          subValue={stats.orchestrator.sequentialMode ? 'Sequential' : 'Parallel'}
        />
      </div>

      {/* Approvals & Feedback */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard
          label="Pending Approvals"
          value={stats.approvals.pending}
          icon={<Shield className="w-4 h-4 text-yellow-400" />}
          subValue={`${stats.approvals.approved} approved`}
          variant={stats.approvals.pending > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Feedback"
          value={stats.feedback.total}
          icon={<MessageSquare className="w-4 h-4 text-blue-400" />}
          subValue={`${stats.feedback.unprocessed} unprocessed`}
          variant={stats.feedback.unprocessed > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          label="Generations"
          value={stats.generations.active}
          icon={<Zap className="w-4 h-4 text-purple-400" />}
          subValue={`${stats.generations.total} total`}
        />
        <MetricCard
          label="Agents"
          value={`${stats.agents.active}/${stats.agents.total}`}
          icon={<Cpu className="w-4 h-4 text-green-400" />}
          subValue={`${stats.agents.busy} busy`}
        />
      </div>

      {/* System Info */}
      <div className="flex items-center justify-between text-xs text-dark-400 pt-3 border-t border-dark-700">
        <span>Uptime: {formatUptime(stats.system.uptime)}</span>
        <span>Memory: {formatMemory(stats.system.memoryUsage)}</span>
        <span>Processing: {stats.orchestrator.processing}</span>
      </div>
    </Card>
  );
}

import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, XCircle, RotateCcw, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { taskApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { Button, Badge, Card, CardHeader } from '../components/ui';
import { TASK_PRIORITY } from '../types';

const statusVariant = {
  pending: 'pending',
  queued: 'pending',
  assigned: 'pending',
  running: 'active',
  completed: 'success',
  failed: 'error',
  cancelled: 'inactive',
} as const;

const statusIcons = {
  pending: Clock,
  queued: Clock,
  assigned: Clock,
  running: Clock,
  completed: CheckCircle,
  failed: AlertCircle,
  cancelled: XCircle,
};

const priorityLabels: Record<number, string> = {
  [TASK_PRIORITY.LOW]: 'Low',
  [TASK_PRIORITY.NORMAL]: 'Normal',
  [TASK_PRIORITY.HIGH]: 'High',
  [TASK_PRIORITY.CRITICAL]: 'Critical',
};

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();

  const { data: task, isLoading } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => taskApi.get(id!),
    enabled: !!id,
  });

  const cancelMutation = useMutation({
    mutationFn: taskApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      addNotification({ type: 'info', title: 'Task cancelled' });
    },
  });

  const retryMutation = useMutation({
    mutationFn: taskApi.retry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      addNotification({ type: 'success', title: 'Task retried' });
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!task) {
    return <div className="text-center py-8 text-dark-400">Task not found</div>;
  }

  const StatusIcon = statusIcons[task.status];
  const formatDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString() : '-';

  const canCancel = task.status === 'pending' || task.status === 'queued' || task.status === 'running';
  const canRetry = task.status === 'failed';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/tasks')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{task.title}</h1>
          <p className="text-dark-500 text-sm">{task.type}</p>
          <p className="text-dark-400">Task ID: {task.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button
              variant="danger"
              onClick={() => cancelMutation.mutate(task.id)}
              loading={cancelMutation.isPending}
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </Button>
          )}
          {canRetry && (
            <Button
              variant="primary"
              onClick={() => retryMutation.mutate(task.id)}
              loading={retryMutation.isPending}
            >
              <RotateCcw className="w-4 h-4" />
              Retry
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-dark-400">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <StatusIcon className="w-4 h-4" />
                <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-dark-400">Priority</p>
              <Badge
                variant={
                  task.priority === TASK_PRIORITY.CRITICAL
                    ? 'error'
                    : task.priority === TASK_PRIORITY.HIGH
                    ? 'pending'
                    : 'default'
                }
                className="mt-1"
              >
                {priorityLabels[task.priority] || task.priority}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-dark-400">Agent</p>
              <p className="text-sm mt-1">
                {task.agentId ? (
                  <a
                    href={`/agents/${task.agentId}`}
                    className="text-primary-400 hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/agents/${task.agentId}`);
                    }}
                  >
                    {task.agentId}
                  </a>
                ) : (
                  'Unassigned'
                )}
              </p>
            </div>
            {task.description && (
              <div className="col-span-2">
                <p className="text-sm text-dark-400">Description</p>
                <p className="text-sm mt-1">{task.description}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-dark-400">Created</p>
              <p className="text-sm mt-1">{formatDate(task.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Started</p>
              <p className="text-sm mt-1">{formatDate(task.startedAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Completed</p>
              <p className="text-sm mt-1">{formatDate(task.completedAt)}</p>
            </div>
          </div>
        </Card>

        {task.input && (
          <Card>
            <CardHeader title="Input" />
            <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-48">
              {JSON.stringify(task.input, null, 2)}
            </pre>
          </Card>
        )}
      </div>

      {task.output && (
        <Card>
          <CardHeader title="Output" />
          <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(task.output, null, 2)}
          </pre>
        </Card>
      )}

      {task.error && (
        <Card>
          <CardHeader title="Error" />
          <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-red-400 font-mono text-sm">{task.error}</p>
          </div>
        </Card>
      )}
    </div>
  );
}

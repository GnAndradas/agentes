import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, XCircle, AlertCircle, ChevronRight, GitBranch } from 'lucide-react';
import { taskApi } from '../lib/api';
import { Card, CardHeader, Badge } from './ui';
import type { Task } from '../types';

interface SubtasksPanelProps {
  parentTaskId: string;
  parentTitle: string;
}

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

function getProgress(subtasks: Task[]): { completed: number; total: number; percent: number } {
  const total = subtasks.length;
  const completed = subtasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  ).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

function getOverallStatus(subtasks: Task[]): 'pending' | 'running' | 'completed' | 'failed' {
  if (subtasks.length === 0) return 'pending';

  const allDone = subtasks.every(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
  );
  const anyFailed = subtasks.some((t) => t.status === 'failed');
  const anyRunning = subtasks.some((t) => t.status === 'running');

  if (allDone) {
    return anyFailed ? 'failed' : 'completed';
  }
  if (anyRunning) return 'running';
  return 'pending';
}

export function SubtasksPanel({ parentTaskId, parentTitle }: SubtasksPanelProps) {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', parentTaskId, 'subtasks'],
    queryFn: () => taskApi.getSubtasks(parentTaskId),
    refetchInterval: 5000, // Poll every 5s for updates
  });

  const subtasks = data?.subtasks || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Subtasks" />
        <div className="text-center py-4 text-dark-400">Loading subtasks...</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Subtasks" />
        <div className="text-center py-4 text-red-400">Failed to load subtasks</div>
      </Card>
    );
  }

  if (subtasks.length === 0) {
    return null; // Don't show panel if no subtasks
  }

  const progress = getProgress(subtasks);
  const overallStatus = getOverallStatus(subtasks);

  return (
    <Card>
      <CardHeader
        title="Subtasks"
        description={`Task decomposed into ${subtasks.length} subtasks`}
        action={
          <div className="flex items-center gap-3">
            <Badge variant={statusVariant[overallStatus]}>
              {progress.completed}/{progress.total}
            </Badge>
          </div>
        }
      />

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-dark-400 mb-1">
          <span>Progress</span>
          <span>{progress.percent}%</span>
        </div>
        <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              overallStatus === 'failed'
                ? 'bg-red-500'
                : overallStatus === 'completed'
                ? 'bg-green-500'
                : 'bg-primary-500'
            }`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Subtask list */}
      <div className="space-y-2">
        {subtasks.map((subtask, index) => {
          const StatusIcon = statusIcons[subtask.status];
          const isLast = index === subtasks.length - 1;

          return (
            <div key={subtask.id} className="relative">
              {/* Vertical connector line */}
              {!isLast && (
                <div className="absolute left-[11px] top-8 h-full w-0.5 bg-dark-600" />
              )}

              <div
                className="flex items-start gap-3 p-3 rounded-lg bg-dark-700/50 hover:bg-dark-700 cursor-pointer transition-colors"
                onClick={() => navigate(`/tasks/${subtask.id}`)}
              >
                {/* Order number with icon */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      subtask.status === 'completed'
                        ? 'bg-green-500/20 text-green-400'
                        : subtask.status === 'failed'
                        ? 'bg-red-500/20 text-red-400'
                        : subtask.status === 'running'
                        ? 'bg-primary-500/20 text-primary-400'
                        : 'bg-dark-600 text-dark-300'
                    }`}
                  >
                    {subtask.sequenceOrder || index + 1}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{subtask.title}</span>
                    {subtask.dependsOn && subtask.dependsOn.length > 0 && (
                      <GitBranch className="w-3 h-3 text-dark-400" title="Has dependencies" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusIcon className="w-3 h-3 text-dark-400" />
                    <Badge variant={statusVariant[subtask.status]} className="text-[10px]">
                      {subtask.status}
                    </Badge>
                    {subtask.agentId && (
                      <span className="text-[10px] text-dark-500">
                        Agent: {subtask.agentId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-dark-400" />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

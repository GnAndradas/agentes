import { CheckCircle, XCircle, AlertTriangle, Clock, Loader2, Ban } from 'lucide-react';
import { clsx } from 'clsx';
import { Badge } from '../ui';
import type { JobSummary, JobStatus as JobStatusType } from '../../types';

interface JobStatusPanelProps {
  jobs: JobSummary[];
  onSelectJob?: (jobId: string) => void;
  selectedJobId?: string | null;
  compact?: boolean;
}

const statusConfig: Record<JobStatusType, { icon: React.ElementType; color: string; bg: string }> = {
  pending: { icon: Clock, color: 'text-dark-400', bg: 'bg-dark-700' },
  running: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  completed: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20' },
  blocked: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  cancelled: { icon: Ban, color: 'text-dark-400', bg: 'bg-dark-700' },
  timeout: { icon: Clock, color: 'text-orange-400', bg: 'bg-orange-500/20' },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function JobStatusPanel({ jobs, onSelectJob, selectedJobId, compact = false }: JobStatusPanelProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-4 text-dark-400 text-sm">
        No jobs for this task
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const config = statusConfig[job.status];
        const Icon = config.icon;
        const isSelected = selectedJobId === job.id;
        const duration = job.completedAt
          ? job.completedAt - job.createdAt
          : Date.now() - job.createdAt;

        return (
          <div
            key={job.id}
            className={clsx(
              'p-3 rounded-lg border transition-colors cursor-pointer',
              isSelected ? 'border-primary-500 bg-primary-500/10' : 'border-dark-700 hover:border-dark-600',
              config.bg
            )}
            onClick={() => onSelectJob?.(job.id)}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <Icon
                className={clsx(
                  'w-4 h-4',
                  config.color,
                  job.status === 'running' && 'animate-spin'
                )}
              />
              <span className="text-sm font-medium truncate flex-1">
                {job.agentName}
              </span>
              <Badge variant="default" className="text-xs">
                {job.agentRole}
              </Badge>
              <Badge
                variant={
                  job.status === 'completed' ? 'active' :
                  job.status === 'failed' ? 'error' :
                  job.status === 'blocked' ? 'pending' :
                  'default'
                }
                className="text-xs"
              >
                {job.status}
              </Badge>
            </div>

            {/* Content */}
            {!compact && (
              <>
                {/* Result summary */}
                {job.result?.actionsSummary && (
                  <p className="text-xs text-dark-300 mb-2 line-clamp-2">
                    {job.result.actionsSummary}
                  </p>
                )}

                {/* Error */}
                {job.error && (
                  <p className="text-xs text-red-400 mb-2 line-clamp-2">
                    {job.error.message}
                  </p>
                )}

                {/* Blocked reason */}
                {job.blocked && (
                  <p className="text-xs text-yellow-400 mb-2 line-clamp-2">
                    {job.blocked.description}
                  </p>
                )}

                {/* Tools used */}
                {job.result?.toolsUsed && job.result.toolsUsed.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {job.result.toolsUsed.slice(0, 3).map((tool) => (
                      <Badge key={tool} variant="default" className="text-xs">
                        {tool}
                      </Badge>
                    ))}
                    {job.result.toolsUsed.length > 3 && (
                      <Badge variant="default" className="text-xs">
                        +{job.result.toolsUsed.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-dark-500">
              <span>{formatTime(job.createdAt)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Compact version for inline display
export function JobStatusBadge({ job }: { job: JobSummary }) {
  const config = statusConfig[job.status];
  const Icon = config.icon;

  return (
    <div className={clsx('inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs', config.bg)}>
      <Icon
        className={clsx(
          'w-3 h-3',
          config.color,
          job.status === 'running' && 'animate-spin'
        )}
      />
      <span className={config.color}>{job.status}</span>
      {job.agentName && (
        <span className="text-dark-400">by {job.agentName}</span>
      )}
    </div>
  );
}

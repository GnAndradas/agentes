/**
 * CheckpointsPanel
 *
 * Shows task checkpoints for state recovery.
 */

import { Flag, Clock, Zap, RotateCcw } from 'lucide-react';
import { Badge, Button } from '../ui';
import type { TaskCheckpoint, ExecutionPhase } from '../../types';

interface CheckpointsPanelProps {
  /** Checkpoints array - component handles null/undefined/non-array safely */
  checkpoints: TaskCheckpoint[] | null | undefined;
  isLoading?: boolean;
  onRestore?: (checkpointId: string) => void;
  canRestore?: boolean;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

function formatPhase(phase: ExecutionPhase): string {
  return phase.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function CheckpointItem({
  checkpoint,
  onRestore,
  canRestore,
}: {
  checkpoint: TaskCheckpoint;
  onRestore?: (id: string) => void;
  canRestore?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 bg-dark-900 rounded-lg hover:bg-dark-850 transition-colors">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        checkpoint.isAutomatic ? 'bg-blue-500/20' : 'bg-purple-500/20'
      }`}>
        {checkpoint.isAutomatic ? (
          <Zap className="w-4 h-4 text-blue-400" />
        ) : (
          <Flag className="w-4 h-4 text-purple-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{checkpoint.label}</span>
          <Badge variant={checkpoint.isAutomatic ? 'default' : 'active'} className="text-xs">
            {checkpoint.isAutomatic ? 'Auto' : 'Manual'}
          </Badge>
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-dark-500">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTimestamp(checkpoint.createdAt)}
          </span>
          <span>Step {checkpoint.stepIndex + 1}</span>
          <span className="capitalize">{formatPhase(checkpoint.phase)}</span>
        </div>

        {checkpoint.reason && (
          <p className="text-xs text-dark-400 mt-1 truncate">{checkpoint.reason}</p>
        )}
      </div>

      {canRestore && onRestore && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRestore(checkpoint.id)}
          title="Restore from this checkpoint"
        >
          <RotateCcw className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

export function CheckpointsPanel({
  checkpoints,
  isLoading,
  onRestore,
  canRestore = false,
}: CheckpointsPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-dark-700 rounded-lg" />
        ))}
      </div>
    );
  }

  // HARDENING: Safely handle null, undefined, or non-array values
  const safeCheckpoints = Array.isArray(checkpoints) ? checkpoints : [];

  if (safeCheckpoints.length === 0) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <Flag className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No checkpoints saved
      </div>
    );
  }

  // Sort by createdAt descending (most recent first), filter invalid entries
  const sortedCheckpoints = safeCheckpoints
    .filter((c) => c && c.id && typeof c.createdAt === 'number')
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="space-y-2">
      {sortedCheckpoints.map((checkpoint) => (
        <CheckpointItem
          key={checkpoint.id}
          checkpoint={checkpoint}
          onRestore={onRestore}
          canRestore={canRestore}
        />
      ))}
    </div>
  );
}

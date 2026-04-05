/**
 * TimelinePanel
 *
 * Shows task execution timeline events.
 */

import {
  Activity,
  Play,
  CheckCircle,
  XCircle,
  Flag,
  Pause,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Clock,
} from 'lucide-react';
import type { TaskTimelineEvent, ExecutionPhase } from '../../types';

interface TimelinePanelProps {
  events: TaskTimelineEvent[];
  isLoading?: boolean;
  maxItems?: number;
}

const eventConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  phase_change: { icon: Activity, color: 'text-blue-400', label: 'Phase Changed' },
  step_start: { icon: Play, color: 'text-cyan-400', label: 'Step Started' },
  step_complete: { icon: CheckCircle, color: 'text-green-400', label: 'Step Completed' },
  step_fail: { icon: XCircle, color: 'text-red-400', label: 'Step Failed' },
  checkpoint: { icon: Flag, color: 'text-purple-400', label: 'Checkpoint' },
  pause: { icon: Pause, color: 'text-orange-400', label: 'Paused' },
  resume: { icon: RotateCcw, color: 'text-green-400', label: 'Resumed' },
  error: { icon: AlertTriangle, color: 'text-red-400', label: 'Error' },
  delegation: { icon: ArrowRight, color: 'text-yellow-400', label: 'Delegated' },
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatPhase(phase: ExecutionPhase): string {
  return phase.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function TimelineItem({ event }: { event: TaskTimelineEvent }) {
  const config = eventConfig[event.type] || {
    icon: Activity,
    color: 'text-dark-400',
    label: event.type,
  };
  const Icon = config.icon;

  // Build description based on event type and data
  let description = '';
  if (event.type === 'phase_change' && event.data.phase) {
    description = `Phase: ${formatPhase(event.data.phase)}`;
  } else if (event.type === 'step_start' && event.data.stepName) {
    description = event.data.stepName;
  } else if (event.type === 'step_complete' && event.data.stepName) {
    description = event.data.stepName;
  } else if (event.type === 'step_fail') {
    description = event.data.error || event.data.stepName || 'Step failed';
  } else if (event.type === 'checkpoint') {
    description = event.data.checkpointId || 'Checkpoint created';
  } else if (event.type === 'pause') {
    description = event.data.reason || 'Task paused';
  } else if (event.type === 'resume') {
    description = 'Task resumed';
  } else if (event.type === 'error') {
    description = event.data.error || 'Unknown error';
  } else if (event.type === 'delegation') {
    description = event.data.toAgentId
      ? `Delegated to ${event.data.toAgentId.slice(0, 8)}...`
      : 'Task delegated';
  }

  return (
    <div className="flex items-start gap-3 group">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${config.color.replace('text-', 'bg-').replace('400', '500/20')}`}>
          <Icon className={`w-3 h-3 ${config.color}`} />
        </div>
        <div className="w-px h-full bg-dark-700 group-last:hidden" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{config.label}</span>
          <span className="text-xs text-dark-500">{formatTimestamp(event.timestamp)}</span>
        </div>
        {description && (
          <p className="text-xs text-dark-400 mt-1 truncate">{description}</p>
        )}
      </div>
    </div>
  );
}

export function TimelinePanel({ events, isLoading, maxItems = 20 }: TimelinePanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-6 h-6 bg-dark-700 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-dark-700 rounded w-1/3" />
              <div className="h-3 bg-dark-700 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <Clock className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No timeline events
      </div>
    );
  }

  // Sort by timestamp descending (most recent first) and limit
  const sortedEvents = [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxItems);

  return (
    <div className="space-y-0">
      {sortedEvents.map((event) => (
        <TimelineItem key={event.id} event={event} />
      ))}
      {events.length > maxItems && (
        <p className="text-xs text-dark-500 text-center pt-2">
          +{events.length - maxItems} more events
        </p>
      )}
    </div>
  );
}

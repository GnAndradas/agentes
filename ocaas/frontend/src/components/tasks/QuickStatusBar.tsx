/**
 * QuickStatusBar
 *
 * Ultra-compact status strip for TaskDetail showing at-a-glance:
 * - Task status
 * - Agent status (with materialization warning)
 * - Execution mode (real vs stub)
 * - Last activity timestamp
 *
 * Purpose: Immediate situational awareness without scrolling.
 */

import {
  CheckCircle,
  XCircle,
  Clock,
  User,
  Zap,
  AlertTriangle,
  Server,
  Activity,
} from 'lucide-react';
import { Badge } from '../ui';
import type { Agent, ExecutionGenerationTrace } from '../../types';

interface QuickStatusBarProps {
  taskStatus: string;
  agent?: Agent | null;
  generationTrace?: ExecutionGenerationTrace | null;
  agentMaterialized?: boolean;
  lastActivity?: number | null;
}

const statusConfig: Record<string, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
}> = {
  pending: { icon: Clock, color: 'text-dark-400', bgColor: 'bg-dark-800' },
  queued: { icon: Clock, color: 'text-dark-400', bgColor: 'bg-dark-800' },
  assigned: { icon: Clock, color: 'text-blue-400', bgColor: 'bg-blue-900/30' },
  running: { icon: Activity, color: 'text-cyan-400', bgColor: 'bg-cyan-900/30' },
  completed: { icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-900/30' },
  failed: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-900/30' },
  cancelled: { icon: XCircle, color: 'text-dark-500', bgColor: 'bg-dark-800' },
};

export function QuickStatusBar({
  taskStatus,
  agent,
  generationTrace,
  agentMaterialized,
  lastActivity,
}: QuickStatusBarProps) {
  const status = statusConfig[taskStatus] || statusConfig.pending;
  const StatusIcon = status.icon;

  // Determine execution mode
  const executionMode = generationTrace?.executionMode || 'unknown';
  const isRealExecution = executionMode === 'hooks_session' || executionMode === 'chat_completion';
  const isStub = executionMode === 'stub';
  const usedFallback = generationTrace?.fallbackUsed || false;

  // Format relative time
  const formatRelativeTime = (ts: number | null | undefined): string => {
    if (!ts) return '-';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-dark-900 border border-dark-700 rounded-lg mb-4">
      {/* Left: Task status */}
      <div className="flex items-center gap-4">
        <div className={`flex items-center gap-2 px-2 py-1 rounded ${status.bgColor}`}>
          <StatusIcon className={`w-4 h-4 ${status.color}`} />
          <span className={`text-sm font-medium ${status.color}`}>{taskStatus}</span>
        </div>

        {/* Agent info */}
        {agent ? (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-dark-500" />
            <span className="text-sm text-dark-300">{agent.name}</span>
            {agentMaterialized === false && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">
                <AlertTriangle className="w-3 h-3" />
                Not materialized
              </span>
            )}
            {agentMaterialized === true && (
              <span title="Materialized">
                <Server className="w-3.5 h-3.5 text-green-400" />
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-dark-500">
            <User className="w-3.5 h-3.5" />
            <span className="text-sm">Unassigned</span>
          </div>
        )}
      </div>

      {/* Right: Execution mode + Last activity */}
      <div className="flex items-center gap-4">
        {/* Execution mode */}
        {generationTrace && (
          <div className="flex items-center gap-2">
            <Zap className={`w-3.5 h-3.5 ${isRealExecution ? 'text-green-400' : isStub ? 'text-blue-400' : 'text-dark-500'}`} />
            <Badge
              variant={isRealExecution ? 'success' : isStub ? 'active' : 'default'}
              className="text-[10px] px-1.5 py-0.5"
            >
              {isRealExecution ? 'Real' : isStub ? 'Stub' : executionMode}
            </Badge>
            {usedFallback && (
              <span className="text-[10px] text-yellow-400">(fallback)</span>
            )}
          </div>
        )}

        {/* Last activity */}
        {lastActivity && (
          <div className="flex items-center gap-1 text-[10px] text-dark-500">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(lastActivity)}
          </div>
        )}
      </div>
    </div>
  );
}

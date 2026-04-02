import { ArrowRight, AlertTriangle, RefreshCw, GitBranch, Zap } from 'lucide-react';
import type { DelegationRecord } from '../types';

interface DelegationHistoryProps {
  history: DelegationRecord[];
  compact?: boolean;
}

const reasonIcons: Record<DelegationRecord['reason'], React.ElementType> = {
  initial: Zap,
  escalation: AlertTriangle,
  delegation: GitBranch,
  reassignment: RefreshCw,
  failure_recovery: AlertTriangle,
};

const reasonLabels: Record<DelegationRecord['reason'], string> = {
  initial: 'Assigned',
  escalation: 'Escalated',
  delegation: 'Delegated',
  reassignment: 'Reassigned',
  failure_recovery: 'Recovery',
};

const reasonColors: Record<DelegationRecord['reason'], string> = {
  initial: 'text-blue-400',
  escalation: 'text-yellow-400',
  delegation: 'text-green-400',
  reassignment: 'text-purple-400',
  failure_recovery: 'text-red-400',
};

/**
 * Display delegation chain: A → B → C
 */
export function DelegationHistory({ history, compact = false }: DelegationHistoryProps) {
  if (!history || history.length === 0) {
    return null;
  }

  if (compact) {
    // Compact: just show agent chain
    const agents = history.map(h => h.toAgentId.slice(0, 8));
    return (
      <div className="flex items-center gap-1 text-xs text-dark-400">
        {agents.map((agent, idx) => (
          <span key={idx} className="flex items-center gap-1">
            {idx > 0 && <ArrowRight className="w-3 h-3" />}
            <span className="font-mono">{agent}</span>
          </span>
        ))}
      </div>
    );
  }

  // Full: show detailed history
  return (
    <div className="space-y-2">
      {history.map((record, idx) => {
        const Icon = reasonIcons[record.reason];
        const color = reasonColors[record.reason];
        const label = reasonLabels[record.reason];

        return (
          <div
            key={idx}
            className="flex items-center gap-2 text-sm"
          >
            <Icon className={`w-4 h-4 ${color}`} />
            <span className={`${color} font-medium`}>{label}</span>
            {record.fromAgentId && (
              <>
                <span className="text-dark-500">from</span>
                <span className="font-mono text-dark-300">{record.fromAgentId.slice(0, 8)}</span>
              </>
            )}
            <ArrowRight className="w-3 h-3 text-dark-500" />
            <span className="font-mono text-dark-300">{record.toAgentId.slice(0, 8)}</span>
            <span className="text-dark-500 text-xs">
              {new Date(record.timestamp).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inline delegation chain badge
 */
export function DelegationChainBadge({ history }: { history: DelegationRecord[] }) {
  if (!history || history.length <= 1) return null;

  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-dark-700 rounded text-xs">
      <GitBranch className="w-3 h-3 text-dark-400" />
      <span className="text-dark-300">{history.length} delegations</span>
    </div>
  );
}

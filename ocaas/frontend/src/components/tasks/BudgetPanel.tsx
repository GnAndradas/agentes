/**
 * BudgetPanel
 *
 * Shows task budget/cost information.
 */

import { DollarSign, AlertTriangle, Ban, TrendingDown, CheckCircle } from 'lucide-react';
import type { BudgetCostSummary, BudgetDecision } from '../../types';

interface BudgetPanelProps {
  cost?: BudgetCostSummary | null;
  decision?: BudgetDecision | null;
  isLoading?: boolean;
}

const decisionConfig: Record<BudgetDecision, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  allow: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Allowed' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Warning' },
  block: { icon: Ban, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Blocked' },
  degrade: { icon: TrendingDown, color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Degraded' },
};

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const bgColor = color.replace('text-', 'bg-').replace('400', '500');
  return (
    <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${bgColor} transition-all duration-300`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function BudgetPanel({ cost, decision, isLoading }: BudgetPanelProps) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-8 bg-dark-700 rounded" />
        <div className="h-4 bg-dark-700 rounded w-1/2" />
      </div>
    );
  }

  if (!cost) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <DollarSign className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No cost data available
      </div>
    );
  }

  const decisionInfo = decision ? decisionConfig[decision] : undefined;
  const DecisionIcon = decisionInfo?.icon;

  // Determine color based on percent used
  const getProgressColor = (percent: number): string => {
    if (percent >= 100) return 'text-red-400';
    if (percent >= 80) return 'text-orange-400';
    if (percent >= 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  const progressColor = getProgressColor(cost.percentUsed);

  return (
    <div className="space-y-4">
      {/* Decision Badge */}
      {decision && decisionInfo && DecisionIcon && (
        <div className={`flex items-center gap-2 p-2 rounded-lg ${decisionInfo.bg}`}>
          <DecisionIcon className={`w-4 h-4 ${decisionInfo.color}`} />
          <span className={`text-sm font-medium ${decisionInfo.color}`}>
            {decisionInfo.label}
          </span>
        </div>
      )}

      {/* Total Cost */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-dark-400" />
          <span className="text-sm text-dark-400">Total Cost</span>
        </div>
        <span className="text-lg font-semibold">{formatCost(cost.totalCost)}</span>
      </div>

      {/* Progress toward limit */}
      {cost.limit > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-dark-500">Budget Used</span>
            <span className={progressColor}>{cost.percentUsed.toFixed(1)}%</span>
          </div>
          <ProgressBar percent={cost.percentUsed} color={progressColor} />
          <div className="flex items-center justify-between text-xs text-dark-500">
            <span>{formatCost(cost.totalCost)}</span>
            <span>of {formatCost(cost.limit)}</span>
          </div>
        </div>
      )}

      {/* Breakdown by model */}
      {cost.breakdown?.byModel && Object.keys(cost.breakdown.byModel).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-dark-500 font-medium">By Model</p>
          <div className="space-y-1">
            {Object.entries(cost.breakdown.byModel).map(([model, modelCost]) => (
              <div key={model} className="flex items-center justify-between text-xs">
                <span className="text-dark-400 truncate">{model}</span>
                <span className="text-dark-300">{formatCost(modelCost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entry count */}
      {cost.entryCount > 0 && (
        <div className="flex items-center justify-between text-xs text-dark-500">
          <span>API Calls</span>
          <span>{cost.entryCount}</span>
        </div>
      )}
    </div>
  );
}

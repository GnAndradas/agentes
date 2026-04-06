/**
 * BudgetPanel
 *
 * Shows task budget/cost information.
 * Accepts the real backend shape (TaskCostResponse) with total_cost_usd, operation_count, etc.
 */

import { DollarSign, AlertTriangle, Ban, TrendingDown, CheckCircle, Hash, Cpu } from 'lucide-react';
import type { TaskCostResponse, BudgetDecision } from '../../types';

interface BudgetPanelProps {
  /** Cost data from backend - uses real AccumulatedCost shape */
  cost?: TaskCostResponse | null;
  decision?: BudgetDecision | null;
  isLoading?: boolean;
}

const decisionConfig: Record<BudgetDecision, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  allow: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Allowed' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Warning' },
  block: { icon: Ban, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Blocked' },
  degrade: { icon: TrendingDown, color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Degraded' },
};

/**
 * Safe cost formatting - handles undefined/null/NaN values
 */
function formatCost(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Safe number formatting
 */
function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString();
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

  // No cost data at all
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

  // Extract values safely from the real backend shape
  const totalCost = cost.total_cost_usd;
  const operationCount = cost.operation_count;
  const inputTokens = cost.total_input_tokens;
  const outputTokens = cost.total_output_tokens;

  // Check if we have any meaningful data
  const hasData = Number.isFinite(totalCost) && totalCost > 0;
  const hasTokens = (Number.isFinite(inputTokens) && inputTokens > 0) ||
                   (Number.isFinite(outputTokens) && outputTokens > 0);
  const hasOperations = Number.isFinite(operationCount) && operationCount > 0;

  // If no meaningful data, show empty state
  if (!hasData && !hasTokens && !hasOperations) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <DollarSign className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No cost recorded yet
      </div>
    );
  }

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
        <span className="text-lg font-semibold">{formatCost(totalCost)}</span>
      </div>

      {/* Token Usage */}
      {hasTokens && (
        <div className="space-y-2">
          <p className="text-xs text-dark-500 font-medium flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            Token Usage
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center justify-between text-xs p-2 bg-dark-900 rounded">
              <span className="text-dark-500">Input</span>
              <span className="text-dark-300">{formatNumber(inputTokens)}</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 bg-dark-900 rounded">
              <span className="text-dark-500">Output</span>
              <span className="text-dark-300">{formatNumber(outputTokens)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Operation count */}
      {hasOperations && (
        <div className="flex items-center justify-between text-xs text-dark-500">
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            API Calls
          </span>
          <span>{formatNumber(operationCount)}</span>
        </div>
      )}

      {/* Period info */}
      {cost.period_start && Number.isFinite(cost.period_start) && (
        <div className="text-xs text-dark-600 pt-2 border-t border-dark-700">
          Since {new Date(cost.period_start).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

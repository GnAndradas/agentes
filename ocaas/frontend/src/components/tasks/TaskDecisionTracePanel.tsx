/**
 * TaskDecisionTracePanel
 *
 * Shows WHY a task is queued/pending with clear operational guidance.
 * Uses real decision trace from backend - no manual inference.
 */

import {
  Users,
  UserX,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRight,
  RefreshCw,
  Cpu,
  Shield,
  HelpCircle,
} from 'lucide-react';
import { Badge } from '../ui';
import type {
  DecisionTrace,
  DecisionOutcome,
  DecisionFailureReason,
  EvaluatedAgent,
} from '../../types';

interface TaskDecisionTracePanelProps {
  trace: DecisionTrace | null | undefined;
  isLoading?: boolean;
  /** Task status to determine if panel should show */
  taskStatus?: string;
  /** Callback when retry is clicked (if available) */
  onRetry?: () => void;
  /** Whether retry is available */
  canRetry?: boolean;
  /** Whether retry is in progress */
  isRetrying?: boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maps decision outcomes to UI config */
const outcomeConfig: Record<
  DecisionOutcome,
  { icon: React.ElementType; color: string; bg: string; label: string }
> = {
  assigned: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Assigned' },
  no_agents: { icon: UserX, color: 'text-red-400', bg: 'bg-red-500/10', label: 'No Agents' },
  no_active_agents: { icon: Users, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'No Active Agents' },
  no_match: { icon: Search, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'No Match' },
  escalated: { icon: Shield, color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Escalated' },
  waiting: { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Waiting' },
  error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', label: 'Error' },
};

/** Human-readable messages for failure reasons */
const failureMessages: Record<DecisionFailureReason, { title: string; description: string }> = {
  NO_AGENTS_REGISTERED: {
    title: 'No agents registered',
    description: 'There are no agents registered in the system to process this task.',
  },
  NO_ACTIVE_AGENTS: {
    title: 'No active agents',
    description: 'Agents exist but none are currently active. All agents may be inactive or in error state.',
  },
  NO_AGENT_MATCHING_CAPABILITIES: {
    title: 'No matching capabilities',
    description: 'Active agents exist but none have the required capabilities for this task type.',
  },
  BUDGET_BLOCKED: {
    title: 'Budget limit reached',
    description: 'The task cannot proceed because the budget limit has been reached.',
  },
  MAX_RETRIES_EXCEEDED: {
    title: 'Max retries exceeded',
    description: 'The task has exceeded the maximum number of retry attempts.',
  },
  ESCALATED_TO_HUMAN: {
    title: 'Escalated to human',
    description: 'This task requires human review or intervention.',
  },
  WAITING_FOR_APPROVAL: {
    title: 'Waiting for approval',
    description: 'The task is waiting for human approval before it can proceed.',
  },
  WAITING_FOR_RESOURCE: {
    title: 'Waiting for resource',
    description: 'The task is waiting for a required resource to become available.',
  },
  DECISION_ERROR: {
    title: 'Decision error',
    description: 'An error occurred during the decision process.',
  },
};

/** Next action suggestions based on failure reason */
const nextActionSuggestions: Record<DecisionFailureReason, string> = {
  NO_AGENTS_REGISTERED: 'Create an agent with the required capabilities.',
  NO_ACTIVE_AGENTS: 'Activate an existing agent or create a new active agent.',
  NO_AGENT_MATCHING_CAPABILITIES: 'Review agent capabilities or create a compatible agent.',
  BUDGET_BLOCKED: 'Review budget limits or wait for the next billing period.',
  MAX_RETRIES_EXCEEDED: 'Investigate the failure cause and manually retry if appropriate.',
  ESCALATED_TO_HUMAN: 'Review the task and provide human guidance.',
  WAITING_FOR_APPROVAL: 'Review pending approvals in the system.',
  WAITING_FOR_RESOURCE: 'Wait for resource generation/activation to complete.',
  DECISION_ERROR: 'Check system logs and retry the task.',
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function AgentStatusBadge({ status }: { status: EvaluatedAgent['status'] }) {
  const config = {
    active: { color: 'bg-green-500/20 text-green-400', label: 'Active' },
    inactive: { color: 'bg-gray-500/20 text-gray-400', label: 'Inactive' },
    busy: { color: 'bg-yellow-500/20 text-yellow-400', label: 'Busy' },
    error: { color: 'bg-red-500/20 text-red-400', label: 'Error' },
  };
  const c = config[status] || config.inactive;
  return <span className={`px-1.5 py-0.5 rounded text-xs ${c.color}`}>{c.label}</span>;
}

function EvaluatedAgentRow({ agent }: { agent: EvaluatedAgent }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-dark-900 rounded text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium truncate">{agent.agentName || agent.agentId}</span>
        <AgentStatusBadge status={agent.status} />
      </div>
      <div className="flex items-center gap-2">
        {agent.match ? (
          <Badge variant="success" className="text-xs">Match</Badge>
        ) : (
          <Badge variant="default" className="text-xs">No match</Badge>
        )}
        {agent.matchScore > 0 && (
          <span className="text-dark-500">{Math.round(agent.matchScore * 100)}%</span>
        )}
      </div>
    </div>
  );
}

function EvaluatedAgentsList({ agents }: { agents: EvaluatedAgent[] }) {
  const safeAgents = Array.isArray(agents) ? agents : [];

  if (safeAgents.length === 0) {
    return (
      <p className="text-xs text-dark-500 italic">No agents were evaluated.</p>
    );
  }

  return (
    <div className="space-y-1">
      {safeAgents.slice(0, 5).map((agent) => (
        <EvaluatedAgentRow key={agent.agentId} agent={agent} />
      ))}
      {safeAgents.length > 5 && (
        <p className="text-xs text-dark-500 text-center">
          +{safeAgents.length - 5} more agents
        </p>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskDecisionTracePanel({
  trace,
  isLoading,
  taskStatus,
  onRetry,
  canRetry,
  isRetrying,
}: TaskDecisionTracePanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-12 bg-dark-700 rounded-lg" />
        <div className="h-8 bg-dark-700 rounded" />
        <div className="h-8 bg-dark-700 rounded" />
      </div>
    );
  }

  // No trace available - only show for queued/pending tasks
  if (!trace) {
    if (taskStatus === 'queued' || taskStatus === 'pending') {
      return (
        <div className="flex items-start gap-3 p-4 bg-dark-800 border border-dark-700 rounded-lg">
          <HelpCircle className="w-5 h-5 text-dark-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-dark-300">Decision trace not available</p>
            <p className="text-xs text-dark-500 mt-1">
              This task has not yet been processed by the decision engine, or the trace has expired.
            </p>
          </div>
        </div>
      );
    }
    return null; // Don't show anything for non-queued tasks without trace
  }

  const outcome = outcomeConfig[trace.decision] || outcomeConfig.error;
  const OutcomeIcon = outcome.icon;
  const failureInfo = trace.failureReason ? failureMessages[trace.failureReason] : null;
  const nextAction = trace.failureReason ? nextActionSuggestions[trace.failureReason] : null;

  return (
    <div className="space-y-4">
      {/* Main outcome banner */}
      <div className={`flex items-start gap-3 p-4 rounded-lg border ${outcome.bg} border-dark-700`}>
        <OutcomeIcon className={`w-5 h-5 ${outcome.color} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-medium ${outcome.color}`}>
              {failureInfo?.title || outcome.label}
            </p>
            <Badge variant="default" className="text-xs">
              {trace.decision}
            </Badge>
          </div>
          <p className="text-xs text-dark-400 mt-1">
            {trace.explanation || failureInfo?.description}
          </p>
        </div>
      </div>

      {/* Technical details (failure reason) */}
      {trace.failureReason && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-dark-500">Failure reason:</span>
          <code className="bg-dark-900 px-2 py-0.5 rounded font-mono text-dark-300">
            {trace.failureReason}
          </code>
        </div>
      )}

      {/* Agent evaluation summary */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex flex-col items-center p-2 bg-dark-900 rounded">
          <span className="text-lg font-semibold">{trace.totalAgents}</span>
          <span className="text-dark-500">Total</span>
        </div>
        <div className="flex flex-col items-center p-2 bg-dark-900 rounded">
          <span className="text-lg font-semibold text-green-400">{trace.activeAgents}</span>
          <span className="text-dark-500">Active</span>
        </div>
        <div className="flex flex-col items-center p-2 bg-dark-900 rounded">
          <span className="text-lg font-semibold text-cyan-400">{trace.matchingAgents}</span>
          <span className="text-dark-500">Matching</span>
        </div>
      </div>

      {/* Selected agent (if assigned) */}
      {trace.selectedAgentId && (
        <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400">Assigned to agent</span>
          </div>
          <code className="text-xs bg-dark-900 px-2 py-1 rounded font-mono">
            {trace.selectedAgentId}
          </code>
        </div>
      )}

      {/* Required capabilities */}
      {trace.requiredCapabilities && trace.requiredCapabilities.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-dark-500 font-medium flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            Required Capabilities
          </p>
          <div className="flex flex-wrap gap-1">
            {trace.requiredCapabilities.map((cap) => (
              <Badge key={cap} variant="default" className="text-xs">
                {cap}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Evaluated agents list */}
      {trace.evaluatedAgents && trace.evaluatedAgents.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-dark-500 font-medium flex items-center gap-1">
            <Users className="w-3 h-3" />
            Evaluated Agents ({trace.evaluatedAgents.length})
          </p>
          <EvaluatedAgentsList agents={trace.evaluatedAgents} />
        </div>
      )}

      {/* Next action suggestion */}
      {nextAction && trace.decision !== 'assigned' && (
        <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <ArrowRight className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-blue-400 font-medium">Next action</p>
            <p className="text-xs text-blue-300/80 mt-0.5">{nextAction}</p>
          </div>
        </div>
      )}

      {/* Retry button */}
      {canRetry && onRetry && trace.decision !== 'assigned' && (
        <button
          onClick={onRetry}
          disabled={isRetrying}
          className={`w-full flex items-center justify-center gap-2 p-2 rounded-lg text-sm transition-colors ${
            isRetrying
              ? 'bg-primary-600/50 text-white/70 cursor-not-allowed'
              : 'bg-primary-600 hover:bg-primary-500 text-white'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
          {isRetrying ? 'Retrying...' : 'Retry Decision'}
        </button>
      )}

      {/* Decision metadata */}
      <div className="flex items-center justify-between text-xs text-dark-600 pt-2 border-t border-dark-700">
        <span>
          Method: <span className="text-dark-400">{trace.decisionMethod}</span>
        </span>
        <span>
          Confidence: <span className="text-dark-400">{Math.round(trace.confidence * 100)}%</span>
        </span>
        <span>
          Time: <span className="text-dark-400">{trace.processingTimeMs}ms</span>
        </span>
      </div>
    </div>
  );
}

/**
 * TaskManualAgentAssignPanel
 *
 * Allows manual agent assignment when decision engine couldn't find a match.
 * Shows available agents with their status and capabilities.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  UserPlus,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import { agentApi, taskApi } from '../../lib/api';
import type { Agent, Task, DecisionTrace } from '../../types';

interface TaskManualAgentAssignPanelProps {
  task: Task;
  decisionTrace: DecisionTrace | null | undefined;
  onAssigned?: () => void;
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function AgentOption({
  agent,
  isSelected,
  onClick,
  taskCapabilities,
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
  taskCapabilities?: string[];
}) {
  const isActive = agent.status === 'active';
  const isBusy = agent.status === 'busy';

  // Check capability match if task has required capabilities
  const hasCapabilityMismatch = taskCapabilities && taskCapabilities.length > 0 && agent.capabilities
    ? taskCapabilities.some(cap => !agent.capabilities?.includes(cap))
    : false;

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
        isSelected
          ? 'border-primary-500 bg-primary-500/10'
          : 'border-dark-700 bg-dark-800 hover:border-dark-600'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <User className="w-4 h-4 text-dark-400 flex-shrink-0" />
          <span className="font-medium truncate">{agent.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge
            variant={isActive ? 'active' : isBusy ? 'pending' : 'inactive'}
            className="text-xs"
          >
            {agent.status}
          </Badge>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="default" className="text-xs">{agent.type}</Badge>
        {agent.capabilities?.slice(0, 3).map((cap, i) => (
          <Badge key={i} variant="default" className="text-xs opacity-70">
            {cap}
          </Badge>
        ))}
        {agent.capabilities && agent.capabilities.length > 3 && (
          <Badge variant="default" className="text-xs opacity-50">
            +{agent.capabilities.length - 3}
          </Badge>
        )}
      </div>

      {/* Warnings */}
      {(!isActive || hasCapabilityMismatch) && (
        <div className="mt-2 space-y-1">
          {!isActive && (
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              Agent is {agent.status}
            </div>
          )}
          {hasCapabilityMismatch && (
            <div className="flex items-center gap-1 text-xs text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              May not match required capabilities
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskManualAgentAssignPanel({
  task,
  decisionTrace,
  onAssigned,
}: TaskManualAgentAssignPanelProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch all agents
  const { data: agentsData, isLoading: isLoadingAgents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentApi.list(),
  });

  const agents = agentsData?.agents || [];

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: (agentId: string) => taskApi.assignAgent(task.id, agentId),
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'decision-trace'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'state'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'timeline'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'task', task.id] });
      onAssigned?.();
    },
  });

  // Extract required capabilities from task metadata or decision trace
  const requiredCapabilities = (
    decisionTrace?.requiredCapabilities ||
    (task.metadata?.requiredCapabilities as string[] | undefined) ||
    []
  );

  // Loading state
  if (isLoadingAgents) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        <div className="h-8 bg-dark-700 rounded w-1/3" />
        <div className="h-16 bg-dark-700 rounded" />
        <div className="h-16 bg-dark-700 rounded" />
      </div>
    );
  }

  // Empty state
  if (agents.length === 0) {
    return (
      <div className="text-center py-6">
        <XCircle className="w-8 h-8 text-dark-500 mx-auto mb-2" />
        <p className="text-dark-400">No agents available</p>
        <p className="text-dark-500 text-sm mt-1">
          Create an agent first before assigning to this task
        </p>
      </div>
    );
  }

  const selectedAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null;

  return (
    <div className="space-y-4 p-4">
      {/* Header info */}
      <div className="flex items-center gap-2 text-sm text-dark-400">
        <UserPlus className="w-4 h-4" />
        <span>Select an agent to manually assign to this task</span>
      </div>

      {/* Required capabilities hint */}
      {requiredCapabilities.length > 0 && (
        <div className="p-2 bg-dark-900 rounded text-xs">
          <span className="text-dark-400">Required capabilities: </span>
          {requiredCapabilities.map((cap, i) => (
            <Badge key={i} variant="default" className="text-xs ml-1">
              {cap}
            </Badge>
          ))}
        </div>
      )}

      {/* Agent list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {agents.map((agent) => (
          <AgentOption
            key={agent.id}
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            taskCapabilities={requiredCapabilities}
          />
        ))}
      </div>

      {/* Selected agent summary */}
      {selectedAgent && (
        <div className="p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary-400" />
            <span className="text-sm">
              Selected: <strong>{selectedAgent.name}</strong>
            </span>
          </div>
          {selectedAgent.description && (
            <p className="text-xs text-dark-400 mt-1 ml-6">
              {selectedAgent.description}
            </p>
          )}
        </div>
      )}

      {/* Action button */}
      <Button
        variant="primary"
        className="w-full"
        disabled={!selectedAgentId}
        loading={assignMutation.isPending}
        onClick={() => selectedAgentId && assignMutation.mutate(selectedAgentId)}
      >
        <UserPlus className="w-4 h-4 mr-2" />
        Assign Agent
      </Button>

      {/* Error display */}
      {assignMutation.isError && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
          {assignMutation.error instanceof Error
            ? assignMutation.error.message
            : 'Failed to assign agent'}
        </div>
      )}

      {/* Success display */}
      {assignMutation.isSuccess && (
        <div className="p-2 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-400 flex items-center gap-2">
          <CheckCircle className="w-4 h-4" />
          Agent assigned successfully
        </div>
      )}
    </div>
  );
}

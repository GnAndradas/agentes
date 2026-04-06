/**
 * TaskGenerateAgentFlowPanel
 *
 * Generates compatible Agent + Skill + Tool when task has no matching agent.
 * HONEST about what's generated vs linked vs pending approval.
 * Tolerates partial errors - shows exactly what succeeded/failed.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Link2,
  Clock,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import { generationApi, skillApi } from '../../lib/api';
import type { Task, DecisionTrace, Generation } from '../../types';

interface TaskGenerateAgentFlowPanelProps {
  task: Task;
  decisionTrace: DecisionTrace | null | undefined;
  onComplete?: () => void;
}

type FlowStep = 'idle' | 'agent' | 'skill' | 'tool' | 'summary';

interface ResourceResult {
  generation?: Generation;
  error?: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
}

interface LinkResult {
  type: 'skill-agent' | 'tool-skill';
  status: 'pending' | 'success' | 'failed' | 'not-possible';
  reason?: string;
}

interface FlowState {
  step: FlowStep;
  agent: ResourceResult;
  skill: ResourceResult;
  tool: ResourceResult;
  links: LinkResult[];
  overallError?: string;
}

const initialFlowState: FlowState = {
  step: 'idle',
  agent: { status: 'pending' },
  skill: { status: 'pending' },
  tool: { status: 'pending' },
  links: [],
};

// =============================================================================
// HELPERS
// =============================================================================

function getAgentNameFromTask(task: Task): string {
  const typeMap: Record<string, string> = {
    general: 'General Assistant',
    analysis: 'Analysis Agent',
    coding: 'Code Agent',
    writing: 'Writing Agent',
    research: 'Research Agent',
  };
  return typeMap[task.type] || `${task.type.charAt(0).toUpperCase() + task.type.slice(1)} Agent`;
}

function getSkillNameFromTask(task: Task): string {
  return `${task.type.charAt(0).toUpperCase() + task.type.slice(1)} Skill`;
}

function getToolNameFromTask(task: Task): string {
  return `${task.type.charAt(0).toUpperCase() + task.type.slice(1)} Tool`;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function ResourceStatus({
  label,
  result,
  icon: Icon,
  isCurrent,
}: {
  label: string;
  result: ResourceResult;
  icon: React.ElementType;
  isCurrent: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-dark-900 rounded">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${
          result.status === 'success' ? 'text-green-400' :
          result.status === 'failed' ? 'text-red-400' :
          isCurrent ? 'text-primary-400' : 'text-dark-500'
        }`} />
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {result.status === 'success' && result.generation && (
          <Link
            to={`/generations/${result.generation.id}`}
            className="text-xs text-primary-400 hover:underline flex items-center gap-1"
          >
            {result.generation.status}
            <ExternalLink className="w-3 h-3" />
          </Link>
        )}
        {result.status === 'pending' && isCurrent && (
          <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
        )}
        {result.status === 'pending' && !isCurrent && (
          <Clock className="w-4 h-4 text-dark-500" />
        )}
        {result.status === 'success' && (
          <CheckCircle className="w-4 h-4 text-green-400" />
        )}
        {result.status === 'failed' && (
          <XCircle className="w-4 h-4 text-red-400" />
        )}
      </div>
    </div>
  );
}

function LinkStatus({ link }: { link: LinkResult }) {
  const labels: Record<string, string> = {
    'skill-agent': 'Skill → Agent',
    'tool-skill': 'Tool → Skill',
  };

  return (
    <div className="flex items-center justify-between py-1.5 px-3 bg-dark-800 rounded text-xs">
      <div className="flex items-center gap-2">
        <Link2 className={`w-3 h-3 ${
          link.status === 'success' ? 'text-green-400' :
          link.status === 'failed' ? 'text-red-400' :
          link.status === 'not-possible' ? 'text-yellow-400' :
          'text-dark-500'
        }`} />
        <span>{labels[link.type]}</span>
      </div>
      <Badge
        variant={
          link.status === 'success' ? 'success' :
          link.status === 'failed' ? 'error' :
          link.status === 'not-possible' ? 'pending' :
          'inactive'
        }
        className="text-xs"
      >
        {link.status === 'not-possible' ? 'needs approval' : link.status}
      </Badge>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskGenerateAgentFlowPanel({
  task,
  decisionTrace,
  onComplete,
}: TaskGenerateAgentFlowPanelProps) {
  const [flowState, setFlowState] = useState<FlowState>(initialFlowState);
  const queryClient = useQueryClient();

  // Check if this panel should show
  const shouldShow = decisionTrace?.failureReason === 'NO_AGENT_MATCHING_CAPABILITIES' ||
                     decisionTrace?.failureReason === 'NO_AGENTS_REGISTERED' ||
                     decisionTrace?.failureReason === 'NO_ACTIVE_AGENTS';

  // Generate agent mutation
  const generateAgentMutation = useMutation({
    mutationFn: async () => {
      const name = getAgentNameFromTask(task);
      return generationApi.create({
        type: 'agent',
        name,
        description: `Auto-generated agent for ${task.type} tasks`,
        prompt: `Create an agent specialized for "${task.type}" tasks. Task context: ${task.title}. ${task.description || ''}`,
      });
    },
  });

  // Generate skill mutation
  const generateSkillMutation = useMutation({
    mutationFn: async () => {
      const name = getSkillNameFromTask(task);
      return generationApi.create({
        type: 'skill',
        name,
        description: `Skill for handling ${task.type} tasks`,
        prompt: `Create a skill for "${task.type}" tasks. Task context: ${task.title}. Should provide capabilities needed for this type of work.`,
      });
    },
  });

  // Generate tool mutation
  const generateToolMutation = useMutation({
    mutationFn: async () => {
      const name = getToolNameFromTask(task);
      return generationApi.create({
        type: 'tool',
        name,
        description: `Tool for ${task.type} tasks`,
        prompt: `Create a basic tool script for "${task.type}" tasks. Keep it simple and safe.`,
      });
    },
  });

  // Main flow execution - tolerates partial errors
  const executeFlow = async () => {
    const newState: FlowState = { ...initialFlowState };
    const links: LinkResult[] = [];

    try {
      // Step 1: Generate Agent
      setFlowState({ ...newState, step: 'agent' });
      try {
        const agentGen = await generateAgentMutation.mutateAsync();
        newState.agent = { generation: agentGen, status: 'success' };
      } catch (err) {
        newState.agent = { error: err instanceof Error ? err.message : 'Failed', status: 'failed' };
      }
      setFlowState({ ...newState });

      // Step 2: Generate Skill
      setFlowState(prev => ({ ...prev, step: 'skill' }));
      try {
        const skillGen = await generateSkillMutation.mutateAsync();
        newState.skill = { generation: skillGen, status: 'success' };
      } catch (err) {
        newState.skill = { error: err instanceof Error ? err.message : 'Failed', status: 'failed' };
      }
      setFlowState({ ...newState });

      // Step 3: Generate Tool
      setFlowState(prev => ({ ...prev, step: 'tool' }));
      try {
        const toolGen = await generateToolMutation.mutateAsync();
        newState.tool = { generation: toolGen, status: 'success' };
      } catch (err) {
        newState.tool = { error: err instanceof Error ? err.message : 'Failed', status: 'failed' };
      }
      setFlowState({ ...newState });

      // Step 4: Attempt linking (only if resources are active/approved)
      // Generations need approval first - linking can only happen after activation
      // So we document this honestly

      // Check if we can link skill to agent
      const agentResourceId = newState.agent.generation?.metadata?.resourceId as string | undefined;
      const skillResourceId = newState.skill.generation?.metadata?.resourceId as string | undefined;
      const toolResourceId = newState.tool.generation?.metadata?.resourceId as string | undefined;

      // Skill → Agent link
      if (newState.agent.status === 'success' && newState.skill.status === 'success') {
        if (agentResourceId && skillResourceId &&
            newState.agent.generation?.status === 'active' &&
            newState.skill.generation?.status === 'active') {
          // Both are active - try to link
          try {
            await skillApi.assignToAgent(skillResourceId, agentResourceId);
            links.push({ type: 'skill-agent', status: 'success' });
          } catch (err) {
            links.push({
              type: 'skill-agent',
              status: 'failed',
              reason: err instanceof Error ? err.message : 'Link failed'
            });
          }
        } else {
          // Generations not yet active - link not possible yet
          links.push({
            type: 'skill-agent',
            status: 'not-possible',
            reason: 'Approve and activate both agent and skill first'
          });
        }
      }

      // Tool → Skill link
      if (newState.skill.status === 'success' && newState.tool.status === 'success') {
        if (skillResourceId && toolResourceId &&
            newState.skill.generation?.status === 'active' &&
            newState.tool.generation?.status === 'active') {
          // Both are active - try to link
          try {
            await skillApi.addTool(skillResourceId, { toolId: toolResourceId });
            links.push({ type: 'tool-skill', status: 'success' });
          } catch (err) {
            links.push({
              type: 'tool-skill',
              status: 'failed',
              reason: err instanceof Error ? err.message : 'Link failed'
            });
          }
        } else {
          // Generations not yet active - link not possible yet
          links.push({
            type: 'tool-skill',
            status: 'not-possible',
            reason: 'Approve and activate both skill and tool first'
          });
        }
      }

      newState.links = links;
      newState.step = 'summary';
      setFlowState(newState);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['generations'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'decision-trace'] });

      onComplete?.();
    } catch (err) {
      setFlowState(prev => ({
        ...prev,
        step: 'summary',
        overallError: err instanceof Error ? err.message : 'Flow failed',
      }));
    }
  };

  if (!shouldShow) {
    return null;
  }

  const isRunning = flowState.step !== 'idle' && flowState.step !== 'summary';
  const isDone = flowState.step === 'summary';

  // Count successes/failures
  const successCount = [flowState.agent, flowState.skill, flowState.tool].filter(r => r.status === 'success').length;
  const failCount = [flowState.agent, flowState.skill, flowState.tool].filter(r => r.status === 'failed').length;
  const pendingLinks = flowState.links.filter(l => l.status === 'not-possible').length;

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-sm">Generate Compatible Resources</h4>
          <p className="text-dark-400 text-xs mt-1">
            Creates agent, skill, and tool generations for this task type
          </p>
        </div>
      </div>

      {/* Failure reason badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="error" className="text-xs">
          {decisionTrace?.failureReason?.replace(/_/g, ' ')}
        </Badge>
        {decisionTrace?.requiredCapabilities && decisionTrace.requiredCapabilities.length > 0 && (
          <span className="text-xs text-dark-500">
            Needs: {decisionTrace.requiredCapabilities.join(', ')}
          </span>
        )}
      </div>

      {/* Progress / Status */}
      {(isRunning || isDone) && (
        <div className="space-y-2">
          <ResourceStatus
            label="Agent Generation"
            result={flowState.agent}
            icon={User}
            isCurrent={flowState.step === 'agent'}
          />
          <ResourceStatus
            label="Skill Generation"
            result={flowState.skill}
            icon={Sparkles}
            isCurrent={flowState.step === 'skill'}
          />
          <ResourceStatus
            label="Tool Generation"
            result={flowState.tool}
            icon={Wrench}
            isCurrent={flowState.step === 'tool'}
          />
        </div>
      )}

      {/* Links Status - only show after generation */}
      {isDone && flowState.links.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-dark-400">Resource Links</span>
          {flowState.links.map((link, i) => (
            <LinkStatus key={i} link={link} />
          ))}
        </div>
      )}

      {/* Summary - HONEST */}
      {isDone && (
        <div className={`p-3 rounded-lg border ${
          failCount === 0 && pendingLinks === 0
            ? 'bg-green-500/10 border-green-500/30'
            : failCount > 0
            ? 'bg-yellow-500/10 border-yellow-500/30'
            : 'bg-blue-500/10 border-blue-500/30'
        }`}>
          <div className="space-y-2">
            {/* Summary header */}
            <div className="flex items-center gap-2">
              {failCount === 0 ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              )}
              <span className="text-sm font-medium">
                {successCount}/3 Generations Created
              </span>
            </div>

            {/* Errors if any */}
            {flowState.agent.error && (
              <p className="text-xs text-red-400">Agent: {flowState.agent.error}</p>
            )}
            {flowState.skill.error && (
              <p className="text-xs text-red-400">Skill: {flowState.skill.error}</p>
            )}
            {flowState.tool.error && (
              <p className="text-xs text-red-400">Tool: {flowState.tool.error}</p>
            )}

            {/* Next steps - HONEST */}
            <div className="text-xs text-dark-400 space-y-1 pt-2 border-t border-dark-700">
              <p className="font-medium text-dark-300">Next Steps:</p>
              <ol className="list-decimal list-inside space-y-1">
                {successCount > 0 && (
                  <li>
                    Go to{' '}
                    <Link to="/generations" className="text-primary-400 hover:underline">
                      Generations
                    </Link>
                    {' '}to approve and activate resources
                  </li>
                )}
                {pendingLinks > 0 && (
                  <li>After activation, link resources together (skill→agent, tool→skill)</li>
                )}
                <li>Retry this task after resources are ready</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Action button */}
      {flowState.step === 'idle' && (
        <div className="space-y-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={executeFlow}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Generate Resources
          </Button>
          <p className="text-xs text-dark-500 text-center">
            Creates 3 generations that need approval before use
          </p>
        </div>
      )}

      {/* Reset button if done */}
      {isDone && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => setFlowState(initialFlowState)}
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Generate Again
        </Button>
      )}

      {/* Warning */}
      {flowState.step === 'idle' && (
        <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs">
          <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
          <span className="text-dark-400">
            Generations use AI and require manual approval. Links cannot be created until resources are activated.
          </span>
        </div>
      )}
    </div>
  );
}

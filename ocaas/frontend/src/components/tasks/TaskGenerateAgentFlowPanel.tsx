/**
 * TaskGenerateAgentFlowPanel
 *
 * Allows generating a compatible Agent + Skill + Tool when task has no matching agent.
 * Uses existing generation API to create resources in sequence.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  User,
  Wrench,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Button, Badge } from '../ui';
import { generationApi } from '../../lib/api';
import type { Task, DecisionTrace, Generation } from '../../types';

interface TaskGenerateAgentFlowPanelProps {
  task: Task;
  decisionTrace: DecisionTrace | null | undefined;
  onComplete?: () => void;
}

type FlowStep = 'idle' | 'agent' | 'skill' | 'tool' | 'linking' | 'done' | 'error';

interface FlowState {
  step: FlowStep;
  agentGeneration?: Generation;
  skillGeneration?: Generation;
  toolGeneration?: Generation;
  error?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getAgentNameFromTask(task: Task): string {
  // Generate a name based on task type
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

function StepIndicator({
  step,
  currentStep,
  label,
  icon: Icon,
}: {
  step: FlowStep;
  currentStep: FlowStep;
  label: string;
  icon: React.ElementType;
}) {
  const stepOrder: FlowStep[] = ['agent', 'skill', 'tool', 'linking', 'done'];
  const currentIndex = stepOrder.indexOf(currentStep);
  const stepIndex = stepOrder.indexOf(step);

  const isComplete = currentIndex > stepIndex;
  const isCurrent = currentStep === step;
  const isPending = currentIndex < stepIndex;

  return (
    <div className="flex items-center gap-2">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
        isComplete ? 'bg-green-500/20 text-green-400' :
        isCurrent ? 'bg-primary-500/20 text-primary-400' :
        'bg-dark-700 text-dark-500'
      }`}>
        {isComplete ? (
          <CheckCircle className="w-4 h-4" />
        ) : isCurrent ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <span className={`text-sm ${
        isComplete ? 'text-green-400' :
        isCurrent ? 'text-primary-400' :
        isPending ? 'text-dark-500' : ''
      }`}>
        {label}
      </span>
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
  const [flowState, setFlowState] = useState<FlowState>({ step: 'idle' });
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

  // Main flow execution
  const executeFlow = async () => {
    try {
      // Step 1: Generate Agent
      setFlowState({ step: 'agent' });
      const agentGen = await generateAgentMutation.mutateAsync();
      setFlowState(prev => ({ ...prev, agentGeneration: agentGen }));

      // Step 2: Generate Skill
      setFlowState(prev => ({ ...prev, step: 'skill' }));
      const skillGen = await generateSkillMutation.mutateAsync();
      setFlowState(prev => ({ ...prev, skillGeneration: skillGen }));

      // Step 3: Generate Tool
      setFlowState(prev => ({ ...prev, step: 'tool' }));
      const toolGen = await generateToolMutation.mutateAsync();
      setFlowState(prev => ({ ...prev, toolGeneration: toolGen }));

      // Step 4: Link skill to agent (if both have resource IDs)
      setFlowState(prev => ({ ...prev, step: 'linking' }));

      // The generations create resources. We need to wait for approval/activation
      // For now, we just create the generations - manual approval flow handles the rest

      // Done
      setFlowState(prev => ({ ...prev, step: 'done' }));

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
        step: 'error',
        error: err instanceof Error ? err.message : 'Generation failed',
      }));
    }
  };

  if (!shouldShow) {
    return null;
  }

  const isRunning = flowState.step !== 'idle' && flowState.step !== 'done' && flowState.step !== 'error';
  const isDone = flowState.step === 'done';
  const hasError = flowState.step === 'error';

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-sm">Generate Compatible Agent</h4>
          <p className="text-dark-400 text-xs mt-1">
            Creates an agent, skill, and tool compatible with this task type
          </p>
        </div>
      </div>

      {/* Failure reason badge */}
      <div className="flex items-center gap-2">
        <Badge variant="error" className="text-xs">
          {decisionTrace?.failureReason?.replace(/_/g, ' ')}
        </Badge>
        {decisionTrace?.requiredCapabilities && decisionTrace.requiredCapabilities.length > 0 && (
          <span className="text-xs text-dark-500">
            Needs: {decisionTrace.requiredCapabilities.join(', ')}
          </span>
        )}
      </div>

      {/* Progress indicators */}
      {isRunning && (
        <div className="p-3 bg-dark-900 rounded-lg space-y-2">
          <StepIndicator step="agent" currentStep={flowState.step} label="Generating Agent" icon={User} />
          <StepIndicator step="skill" currentStep={flowState.step} label="Generating Skill" icon={Sparkles} />
          <StepIndicator step="tool" currentStep={flowState.step} label="Generating Tool" icon={Wrench} />
          <StepIndicator step="linking" currentStep={flowState.step} label="Creating Links" icon={ArrowRight} />
        </div>
      )}

      {/* Success state */}
      {isDone && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Generations Created</span>
          </div>
          <p className="text-xs text-dark-400 mt-2">
            Agent, skill, and tool generations have been created and are pending approval.
            Go to <a href="/generations" className="text-primary-400 hover:underline">Generations</a> to approve and activate them.
          </p>
          {flowState.agentGeneration && (
            <div className="mt-2 text-xs text-dark-500">
              Agent: {flowState.agentGeneration.name} ({flowState.agentGeneration.status})
            </div>
          )}
          {flowState.skillGeneration && (
            <div className="text-xs text-dark-500">
              Skill: {flowState.skillGeneration.name} ({flowState.skillGeneration.status})
            </div>
          )}
          {flowState.toolGeneration && (
            <div className="text-xs text-dark-500">
              Tool: {flowState.toolGeneration.name} ({flowState.toolGeneration.status})
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Generation Failed</span>
          </div>
          <p className="text-xs text-red-300 mt-1">{flowState.error}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setFlowState({ step: 'idle' })}
          >
            Try Again
          </Button>
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
            Generate Compatible Agent
          </Button>
          <p className="text-xs text-dark-500 text-center">
            This will create 3 generations that need approval before activation
          </p>
        </div>
      )}

      {/* Warning */}
      {flowState.step === 'idle' && (
        <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-xs">
          <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
          <span className="text-dark-400">
            Generated resources will use AI. They need manual approval before the task can proceed.
          </span>
        </div>
      )}
    </div>
  );
}

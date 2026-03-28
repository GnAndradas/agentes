import { createLogger } from '../utils/logger.js';
import { getServices } from '../services/index.js';
import {
  getAutonomyConfig,
  canGenerateSkillAutonomously,
  canGenerateToolAutonomously,
  canCreateAgentAutonomously,
} from '../config/autonomy.js';
import type { TaskDTO, AgentDTO } from '../types/domain.js';
import type { TaskAssignment } from './types.js';

const logger = createLogger('DecisionEngine');

export class DecisionEngine {
  async findBestAgent(task: TaskDTO): Promise<TaskAssignment | null> {
    const { agentService } = getServices();
    const activeAgents = await agentService.getActive();

    if (activeAgents.length === 0) {
      logger.warn({ taskId: task.id }, 'No active agents available');
      return null;
    }

    // Score each agent
    const scored: TaskAssignment[] = [];

    for (const agent of activeAgents) {
      const score = this.scoreAgent(agent, task);
      if (score > 0) {
        scored.push({
          taskId: task.id,
          agentId: agent.id,
          score,
          reason: this.getMatchReason(agent, task),
        });
      }
    }

    if (scored.length === 0) {
      logger.warn({ taskId: task.id, taskType: task.type }, 'No suitable agents found');
      return null;
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0]!;
    logger.info({ taskId: task.id, agentId: best.agentId, score: best.score }, 'Best agent selected');
    return best;
  }

  private scoreAgent(agent: AgentDTO, task: TaskDTO): number {
    let score = 50; // Base score

    // Agent type bonus
    if (agent.type === 'specialist' && task.type !== 'generic') {
      score += 20;
    }
    if (agent.type === 'orchestrator' && task.type === 'orchestration') {
      score += 30;
    }

    // Capability matching
    if (agent.capabilities && agent.capabilities.length > 0) {
      const taskType = task.type.toLowerCase();
      const matched = agent.capabilities.filter(cap =>
        taskType.includes(cap.toLowerCase()) || cap.toLowerCase().includes(taskType)
      );
      score += matched.length * 15;
    }

    // Busy agent penalty
    if (agent.status === 'busy') {
      score -= 30;
    }

    // Priority boost for critical tasks
    if (task.priority >= 4) {
      score += 10;
    }

    return Math.max(0, score);
  }

  private getMatchReason(agent: AgentDTO, task: TaskDTO): string {
    const reasons: string[] = [];

    if (agent.type === 'specialist') {
      reasons.push('specialist agent');
    }
    if (agent.capabilities?.some(c => task.type.toLowerCase().includes(c.toLowerCase()))) {
      reasons.push('capability match');
    }
    if (agent.status === 'active') {
      reasons.push('available');
    }

    return reasons.join(', ') || 'default selection';
  }

  async detectMissingCapability(task: TaskDTO): Promise<string | null> {
    const { agentService } = getServices();
    const allAgents = await agentService.list();

    const taskType = task.type.toLowerCase();
    const allCapabilities = new Set<string>();

    for (const agent of allAgents) {
      if (agent.capabilities) {
        agent.capabilities.forEach(c => allCapabilities.add(c.toLowerCase()));
      }
    }

    // Check if task type matches any capability
    const hasMatch = [...allCapabilities].some(cap =>
      taskType.includes(cap) || cap.includes(taskType)
    );

    if (!hasMatch && taskType !== 'generic') {
      logger.info({ taskType }, 'Missing capability detected');
      return taskType;
    }

    return null;
  }

  async suggestNewCapability(taskType: string): Promise<{
    type: 'agent' | 'skill' | 'tool';
    name: string;
    description: string;
    canAutoGenerate: boolean;
  } | null> {
    // Simple heuristics for what to suggest
    const suggestions: Record<string, { type: 'agent' | 'skill' | 'tool'; name: string; description: string }> = {
      coding: { type: 'skill', name: 'coding-assistant', description: 'Coding and code review capabilities' },
      testing: { type: 'skill', name: 'test-runner', description: 'Test execution and validation' },
      research: { type: 'skill', name: 'research-assistant', description: 'Information gathering and analysis' },
      deploy: { type: 'tool', name: 'deployment-tool', description: 'Deployment automation tool' },
      analysis: { type: 'agent', name: 'analyst-agent', description: 'Data analysis specialist agent' },
    };

    const lowerType = taskType.toLowerCase();
    let suggestion: { type: 'agent' | 'skill' | 'tool'; name: string; description: string } | null = null;

    for (const [key, s] of Object.entries(suggestions)) {
      if (lowerType.includes(key)) {
        suggestion = s;
        break;
      }
    }

    // Default suggestion
    if (!suggestion) {
      suggestion = {
        type: 'skill',
        name: `${taskType}-handler`,
        description: `Handler for ${taskType} type tasks`,
      };
    }

    // Check if autonomous generation is allowed
    let canAutoGenerate = false;
    switch (suggestion.type) {
      case 'agent':
        canAutoGenerate = canCreateAgentAutonomously();
        break;
      case 'skill':
        canAutoGenerate = canGenerateSkillAutonomously();
        break;
      case 'tool':
        canAutoGenerate = canGenerateToolAutonomously();
        break;
    }

    return {
      ...suggestion,
      canAutoGenerate,
    };
  }

  // Check if current autonomy config allows automatic decisions
  canMakeAutonomousDecisions(): boolean {
    const config = getAutonomyConfig();
    return config.level !== 'manual';
  }
}

let decisionEngineInstance: DecisionEngine | null = null;

export function getDecisionEngine(): DecisionEngine {
  if (!decisionEngineInstance) {
    decisionEngineInstance = new DecisionEngine();
  }
  return decisionEngineInstance;
}

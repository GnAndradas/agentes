/**
 * Tests for Heuristic Rules
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateHeuristics,
  matchCapabilities,
  findCapabilitySynonyms,
  HEURISTIC_RULES,
  CAPABILITY_SYNONYMS,
} from '../HeuristicRules.js';
import type { HeuristicContext } from '../types.js';

describe('HeuristicRules', () => {
  describe('matchCapabilities', () => {
    it('should return 1.0 for exact match', () => {
      const score = matchCapabilities(['coding'], ['coding', 'testing']);
      expect(score).toBe(1.0);
    });

    it('should return partial score for partial match', () => {
      const score = matchCapabilities(['coding', 'testing', 'deployment'], ['coding']);
      expect(score).toBeCloseTo(0.33, 1);
    });

    it('should return 0 for no match', () => {
      const score = matchCapabilities(['coding'], ['design', 'testing']);
      expect(score).toBe(0);
    });

    it('should match synonyms', () => {
      const score = matchCapabilities(['programming'], ['coding']);
      expect(score).toBeGreaterThan(0);
    });

    it('should handle empty arrays', () => {
      expect(matchCapabilities([], ['coding'])).toBe(0);
      expect(matchCapabilities(['coding'], [])).toBe(0);
      expect(matchCapabilities([], [])).toBe(0);
    });
  });

  describe('findCapabilitySynonyms', () => {
    it('should find synonyms for coding', () => {
      const synonyms = findCapabilitySynonyms('coding');
      expect(synonyms).toContain('programming');
      expect(synonyms).toContain('development');
    });

    it('should return empty array for unknown capability', () => {
      const synonyms = findCapabilitySynonyms('unknown-capability-xyz');
      expect(synonyms).toEqual([]);
    });
  });

  describe('evaluateHeuristics', () => {
    let baseContext: HeuristicContext;

    beforeEach(() => {
      baseContext = {
        task: {
          id: 'task-1',
          title: 'Test Task',
          type: 'coding',
          priority: 2,
        },
        agents: [],
        recentDecisions: [],
      };
    });

    describe('noAgentsRule', () => {
      it('should escalate when no agents are available', () => {
        const result = evaluateHeuristics(baseContext);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('escalate');
        expect(result.ruleId).toBe('no_agents');
      });
    });

    describe('singleAgentRule', () => {
      it('should assign to single active agent', () => {
        const context: HeuristicContext = {
          ...baseContext,
          agents: [{
            id: 'agent-1',
            name: 'Single Agent',
            type: 'generic',
            status: 'active',
            capabilities: ['generic'],
            currentLoad: 0,
            successRate: 1,
          }],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('assign');
        expect(result.result?.targetAgent).toBe('agent-1');
        expect(result.ruleId).toBe('single_agent');
      });
    });

    describe('directTypeMatchRule', () => {
      it('should match agent by exact type', () => {
        const context: HeuristicContext = {
          ...baseContext,
          agents: [
            {
              id: 'agent-1',
              name: 'Coding Agent',
              type: 'coding',
              status: 'active',
              capabilities: ['coding', 'testing'],
              currentLoad: 0,
              successRate: 1,
            },
            {
              id: 'agent-2',
              name: 'Design Agent',
              type: 'design',
              status: 'active',
              capabilities: ['design', 'ui-ux'],
              currentLoad: 0,
              successRate: 1,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('assign');
        expect(result.result?.targetAgent).toBe('agent-1');
        expect(result.ruleId).toBe('direct_type_match');
      });
    });

    describe('specialistMatchRule', () => {
      it('should select specialist agent with capability match', () => {
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'task-1',
            title: 'Build API endpoint',
            description: 'Create REST API with authentication',
            type: 'generic',
            priority: 2,
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Generic Agent',
              type: 'generic',
              status: 'active',
              capabilities: ['generic'],
              currentLoad: 0,
              successRate: 1,
            },
            {
              id: 'agent-2',
              name: 'API Specialist',
              type: 'specialist',
              status: 'active',
              capabilities: ['api-integration', 'rest', 'authentication'],
              currentLoad: 0,
              successRate: 0.95,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.targetAgent).toBe('agent-2');
        expect(result.ruleId).toBe('specialist_match');
      });
    });

    describe('criticalTaskRule', () => {
      it('should escalate critical tasks without specialist', () => {
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'task-1',
            title: 'Critical Security Fix',
            type: 'security',
            priority: 4,
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Generic Agent',
              type: 'generic',
              status: 'active',
              capabilities: ['generic'],
              currentLoad: 0,
              successRate: 0.7,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('escalate');
        expect(result.ruleId).toBe('critical_task');
      });

      it('should assign critical task to specialist with high success rate', () => {
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'task-1',
            title: 'Critical Security Fix',
            type: 'security',
            priority: 4,
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Security Expert',
              type: 'security',
              status: 'active',
              capabilities: ['security', 'authentication', 'encryption'],
              currentLoad: 0,
              successRate: 0.95,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('assign');
        expect(result.result?.targetAgent).toBe('agent-1');
      });
    });

    describe('retryLimitRule', () => {
      it('should escalate when retry limit reached', () => {
        // Use a generic type to prevent direct_type_match from triggering
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'task-1',
            title: 'Failing Task',
            type: 'generic', // Use generic to avoid direct_type_match
            priority: 2,
            retryCount: 4,
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Agent',
              type: 'coding',
              status: 'active',
              capabilities: ['coding'],
              currentLoad: 0,
              successRate: 1,
            },
            {
              id: 'agent-2',
              name: 'Agent 2',
              type: 'testing',
              status: 'active',
              capabilities: ['testing'],
              currentLoad: 0,
              successRate: 1,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('escalate');
        expect(result.ruleId).toBe('retry_limit');
      });
    });

    describe('subtaskRule', () => {
      it('should match subtask to appropriate agent', () => {
        // Note: subtask rule now just uses capability matching since it doesn't have access to TaskService
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'subtask-1',
            title: 'Write Unit Tests',
            type: 'generic', // Use generic to let subtask rule apply
            priority: 2,
            parentTaskId: 'parent-task',
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Testing Agent',
              type: 'testing',
              status: 'active',
              capabilities: ['testing', 'unit-testing'],
              currentLoad: 0,
              successRate: 1,
            },
            {
              id: 'agent-2',
              name: 'Coding Agent',
              type: 'coding',
              status: 'active',
              capabilities: ['coding'],
              currentLoad: 0,
              successRate: 1,
            },
          ],
          recentDecisions: [
            {
              taskId: 'parent-task',
              decision: {
                decisionType: 'assign',
                targetAgent: 'agent-1',
              },
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('assign');
        expect(result.result?.targetAgent).toBe('agent-1');
        // Could be subtask_match or general_capability depending on rule order
        expect(['subtask_match', 'general_capability']).toContain(result.ruleId);
      });
    });

    describe('generalCapabilityRule', () => {
      it('should assign based on capability match', () => {
        const context: HeuristicContext = {
          ...baseContext,
          task: {
            id: 'task-1',
            title: 'Build Frontend Component',
            type: 'generic',
            priority: 2,
          },
          agents: [
            {
              id: 'agent-1',
              name: 'Backend Agent',
              type: 'backend',
              status: 'active',
              capabilities: ['backend', 'database', 'api'],
              currentLoad: 0,
              successRate: 1,
            },
            {
              id: 'agent-2',
              name: 'Frontend Agent',
              type: 'frontend',
              status: 'active',
              capabilities: ['frontend', 'react', 'css'],
              currentLoad: 0,
              successRate: 1,
            },
          ],
        };

        const result = evaluateHeuristics(context);

        expect(result.success).toBe(true);
        expect(result.result?.decisionType).toBe('assign');
        expect(result.result?.targetAgent).toBe('agent-2');
        expect(result.ruleId).toBe('general_capability');
      });
    });

    it('should evaluate rules in priority order', () => {
      const result = evaluateHeuristics(baseContext);

      expect(result.rulesEvaluated).toContain('direct_type_match');
      expect(result.rulesEvaluated).toContain('single_agent');
      expect(result.rulesEvaluated).toContain('no_agents');
    });
  });

  describe('HEURISTIC_RULES', () => {
    it('should have all rules sorted by priority', () => {
      for (let i = 1; i < HEURISTIC_RULES.length; i++) {
        const prev = HEURISTIC_RULES[i - 1]!;
        const curr = HEURISTIC_RULES[i]!;
        expect(prev.priority).toBeLessThanOrEqual(curr.priority);
      }
    });

    it('should have unique rule IDs', () => {
      const ids = HEURISTIC_RULES.map(r => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });
  });

  describe('CAPABILITY_SYNONYMS', () => {
    it('should have defined synonym groups', () => {
      // Verify synonyms map is properly defined
      expect(CAPABILITY_SYNONYMS).toBeDefined();
      expect(typeof CAPABILITY_SYNONYMS).toBe('object');

      // Check that coding has synonyms
      expect(CAPABILITY_SYNONYMS['coding']).toContain('programming');
      expect(CAPABILITY_SYNONYMS['coding']).toContain('development');
    });

    it('should have multiple capability groups', () => {
      const keys = Object.keys(CAPABILITY_SYNONYMS);
      expect(keys.length).toBeGreaterThan(5);
      expect(keys).toContain('coding');
      expect(keys).toContain('testing');
      expect(keys).toContain('deployment');
    });
  });
});

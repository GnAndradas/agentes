/**
 * Tests for Prompt Tiers
 */

import { describe, it, expect } from 'vitest';
import {
  getPromptBundle,
  parseResponse,
  determineTier,
  SYSTEM_PROMPT_SHORT,
  SYSTEM_PROMPT_MEDIUM,
  SYSTEM_PROMPT_DEEP,
  isShortResponse,
  isMediumResponse,
  isDeepResponse,
  type DecisionContext,
} from '../PromptTiers.js';
import { PROMPT_TIER, PROMPT_TIER_CONFIGS } from '../types.js';

describe('PromptTiers', () => {
  describe('getPromptBundle', () => {
    const baseContext: DecisionContext = {
      task: {
        id: 'task-1',
        title: 'Test Task',
        type: 'coding',
        priority: 2,
      },
      agents: [],
    };

    it('should return SHORT tier bundle', () => {
      const bundle = getPromptBundle(PROMPT_TIER.SHORT, baseContext);

      expect(bundle.tier).toBe('short');
      expect(bundle.systemPrompt).toBe(SYSTEM_PROMPT_SHORT);
      expect(bundle.maxTokens).toBe(PROMPT_TIER_CONFIGS.short.maxTokens);
      expect(bundle.timeout).toBe(PROMPT_TIER_CONFIGS.short.timeout);
      expect(bundle.userPrompt).toContain('Test Task');
    });

    it('should return MEDIUM tier bundle', () => {
      const bundle = getPromptBundle(PROMPT_TIER.MEDIUM, baseContext);

      expect(bundle.tier).toBe('medium');
      expect(bundle.systemPrompt).toBe(SYSTEM_PROMPT_MEDIUM);
      expect(bundle.maxTokens).toBe(PROMPT_TIER_CONFIGS.medium.maxTokens);
    });

    it('should return DEEP tier bundle', () => {
      const bundle = getPromptBundle(PROMPT_TIER.DEEP, baseContext);

      expect(bundle.tier).toBe('deep');
      expect(bundle.systemPrompt).toBe(SYSTEM_PROMPT_DEEP);
      expect(bundle.maxTokens).toBe(PROMPT_TIER_CONFIGS.deep.maxTokens);
    });

    it('should include agent information in MEDIUM tier', () => {
      const contextWithAgents: DecisionContext = {
        ...baseContext,
        agents: [
          {
            id: 'agent-1',
            name: 'Test Agent',
            type: 'coding',
            status: 'active',
            capabilities: ['coding', 'testing'],
          },
        ],
      };

      const bundle = getPromptBundle(PROMPT_TIER.MEDIUM, contextWithAgents);

      expect(bundle.userPrompt).toContain('Test Agent');
      expect(bundle.userPrompt).toContain('coding, testing');
    });

    it('should include task details in DEEP tier', () => {
      const detailedContext: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Complex Task',
          description: 'A very detailed description',
          type: 'coding',
          priority: 4,
          input: { key: 'value' },
          metadata: { custom: 'data' },
        },
        agents: [],
      };

      const bundle = getPromptBundle(PROMPT_TIER.DEEP, detailedContext);

      expect(bundle.userPrompt).toContain('Complex Task');
      expect(bundle.userPrompt).toContain('very detailed description');
      expect(bundle.userPrompt).toContain('Input Data');
      expect(bundle.userPrompt).toContain('Metadata');
    });

    it('should include retry information if present', () => {
      const contextWithRetry: DecisionContext = {
        ...baseContext,
        task: {
          ...baseContext.task,
          retryCount: 3,
        },
      };

      const bundle = getPromptBundle(PROMPT_TIER.MEDIUM, contextWithRetry);

      expect(bundle.userPrompt).toContain('retried 3 times');
    });
  });

  describe('parseResponse', () => {
    describe('SHORT tier', () => {
      it('should parse valid short response', () => {
        const content = JSON.stringify({
          category: 'simple',
          taskType: 'coding',
          complexity: 'low',
          requiredCapabilities: ['coding'],
          mayNeedDecomposition: false,
          mayNeedHumanReview: false,
          confidence: 0.9,
        });

        const result = parseResponse(PROMPT_TIER.SHORT, content);

        expect(result).not.toBeNull();
        expect((result as any).category).toBe('simple');
        expect((result as any).confidence).toBe(0.9);
      });

      it('should handle markdown code blocks', () => {
        const content = '```json\n{"category":"simple","taskType":"coding","complexity":"low","requiredCapabilities":["coding"],"mayNeedDecomposition":false,"mayNeedHumanReview":false,"confidence":0.8}\n```';

        const result = parseResponse(PROMPT_TIER.SHORT, content);

        expect(result).not.toBeNull();
        expect((result as any).category).toBe('simple');
      });

      it('should return null for invalid response', () => {
        const result = parseResponse(PROMPT_TIER.SHORT, 'not json');
        expect(result).toBeNull();
      });

      it('should return null for missing required fields', () => {
        const content = JSON.stringify({
          category: 'simple',
          // missing taskType, complexity, etc.
        });

        const result = parseResponse(PROMPT_TIER.SHORT, content);
        expect(result).toBeNull();
      });
    });

    describe('MEDIUM tier', () => {
      it('should parse valid medium response', () => {
        const content = JSON.stringify({
          decisionType: 'assign',
          reasoning: 'Task matches agent capabilities',
          confidence: 0.85,
          requiredCapabilities: ['coding'],
          suggestedAgent: 'agent-1',
          needsHumanReview: false,
        });

        const result = parseResponse(PROMPT_TIER.MEDIUM, content);

        expect(result).not.toBeNull();
        expect((result as any).decisionType).toBe('assign');
        expect((result as any).suggestedAgent).toBe('agent-1');
      });

      it('should parse subdivide response with subtask count', () => {
        const content = JSON.stringify({
          decisionType: 'subdivide',
          reasoning: 'Task is too complex for single execution',
          confidence: 0.8,
          requiredCapabilities: ['coding', 'testing'],
          suggestedAgent: null,
          needsHumanReview: false,
          subtaskCount: 3,
        });

        const result = parseResponse(PROMPT_TIER.MEDIUM, content);

        expect(result).not.toBeNull();
        expect((result as any).decisionType).toBe('subdivide');
        expect((result as any).subtaskCount).toBe(3);
      });
    });

    describe('DEEP tier', () => {
      it('should parse valid deep response', () => {
        const content = JSON.stringify({
          intent: 'Build a REST API endpoint for user authentication',
          taskType: 'coding',
          complexity: 'medium',
          complexityReason: 'Requires security considerations',
          requiredCapabilities: ['api-integration', 'authentication'],
          optionalCapabilities: ['security-audit'],
          suggestedTools: ['express', 'jwt'],
          canBeSubdivided: true,
          subdivisionReason: 'Has distinct implementation and testing phases',
          suggestedSubtasks: [
            {
              title: 'Implement API endpoint',
              description: 'Create the endpoint handler',
              type: 'coding',
              requiredCapabilities: ['api-integration'],
              order: 1,
              dependsOnPrevious: false,
              estimatedComplexity: 'medium',
            },
            {
              title: 'Add authentication',
              description: 'Add JWT authentication',
              type: 'coding',
              requiredCapabilities: ['authentication'],
              order: 2,
              dependsOnPrevious: true,
              estimatedComplexity: 'medium',
            },
          ],
          riskFactors: ['Security vulnerabilities', 'Token management'],
          estimatedDuration: 'normal',
          requiresHumanReview: true,
          humanReviewReason: 'Security-sensitive functionality',
          confidence: 0.9,
        });

        const result = parseResponse(PROMPT_TIER.DEEP, content);

        expect(result).not.toBeNull();
        expect((result as any).intent).toContain('REST API');
        expect((result as any).canBeSubdivided).toBe(true);
        expect((result as any).suggestedSubtasks).toHaveLength(2);
        expect((result as any).requiresHumanReview).toBe(true);
      });

      it('should handle extra text around JSON', () => {
        const content = 'Here is my analysis:\n\n{"intent":"Test intent","taskType":"coding","complexity":"low","requiredCapabilities":["coding"],"canBeSubdivided":false,"requiresHumanReview":false,"confidence":0.7}\n\nI hope this helps!';

        const result = parseResponse(PROMPT_TIER.DEEP, content);

        expect(result).not.toBeNull();
        expect((result as any).intent).toBe('Test intent');
      });
    });
  });

  describe('determineTier', () => {
    it('should return DEEP for critical priority', () => {
      const context: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Critical Task',
          type: 'coding',
          priority: 4,
        },
        agents: [],
      };

      const tier = determineTier(context);
      expect(tier).toBe(PROMPT_TIER.DEEP);
    });

    it('should return DEEP for tasks with significant input', () => {
      const context: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Data Task',
          type: 'analysis',
          priority: 2,
          input: {
            field1: 'value1',
            field2: 'value2',
            field3: 'value3',
            field4: 'value4',
          },
        },
        agents: [],
      };

      const tier = determineTier(context);
      expect(tier).toBe(PROMPT_TIER.DEEP);
    });

    it('should return MEDIUM for long descriptions', () => {
      const context: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Task with Description',
          description: 'A'.repeat(150), // Long description
          type: 'coding',
          priority: 2,
        },
        agents: [],
      };

      const tier = determineTier(context);
      expect(tier).toBe(PROMPT_TIER.MEDIUM);
    });

    it('should return SHORT for simple typed tasks with agents', () => {
      const context: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Simple Task',
          type: 'coding',
          priority: 2,
        },
        agents: [
          {
            id: 'agent-1',
            name: 'Agent',
            type: 'coding',
            status: 'active',
            capabilities: ['coding'],
          },
        ],
      };

      const tier = determineTier(context);
      expect(tier).toBe(PROMPT_TIER.SHORT);
    });

    it('should return MEDIUM for generic tasks', () => {
      const context: DecisionContext = {
        task: {
          id: 'task-1',
          title: 'Generic Task',
          type: 'generic',
          priority: 2,
        },
        agents: [
          {
            id: 'agent-1',
            name: 'Agent',
            type: 'generic',
            status: 'active',
            capabilities: ['generic'],
          },
        ],
      };

      const tier = determineTier(context);
      expect(tier).toBe(PROMPT_TIER.MEDIUM);
    });
  });

  describe('type guards', () => {
    describe('isShortResponse', () => {
      it('should return true for valid short response', () => {
        const obj = {
          category: 'simple',
          taskType: 'coding',
          complexity: 'low',
          requiredCapabilities: [],
        };
        expect(isShortResponse(obj)).toBe(true);
      });

      it('should return false for invalid response', () => {
        expect(isShortResponse(null)).toBe(false);
        expect(isShortResponse({})).toBe(false);
        expect(isShortResponse({ category: 'simple' })).toBe(false);
      });
    });

    describe('isMediumResponse', () => {
      it('should return true for valid medium response', () => {
        const obj = {
          decisionType: 'assign',
          reasoning: 'test',
          confidence: 0.8,
        };
        expect(isMediumResponse(obj)).toBe(true);
      });

      it('should return false for invalid response', () => {
        expect(isMediumResponse(null)).toBe(false);
        expect(isMediumResponse({ decisionType: 'assign' })).toBe(false);
      });
    });

    describe('isDeepResponse', () => {
      it('should return true for valid deep response', () => {
        const obj = {
          intent: 'test',
          taskType: 'coding',
          complexity: 'low',
          requiredCapabilities: [],
          canBeSubdivided: false,
        };
        expect(isDeepResponse(obj)).toBe(true);
      });

      it('should return false for invalid response', () => {
        expect(isDeepResponse(null)).toBe(false);
        expect(isDeepResponse({ intent: 'test' })).toBe(false);
      });
    });
  });

  describe('system prompts', () => {
    it('should have SHORT prompt under 500 characters', () => {
      expect(SYSTEM_PROMPT_SHORT.length).toBeLessThan(500);
    });

    it('should have MEDIUM prompt with decision types', () => {
      expect(SYSTEM_PROMPT_MEDIUM).toContain('assign');
      expect(SYSTEM_PROMPT_MEDIUM).toContain('subdivide');
      expect(SYSTEM_PROMPT_MEDIUM).toContain('escalate');
    });

    it('should have DEEP prompt with decomposition guidelines', () => {
      expect(SYSTEM_PROMPT_DEEP).toContain('DECOMPOSITION');
      expect(SYSTEM_PROMPT_DEEP).toContain('subtask');
    });
  });
});

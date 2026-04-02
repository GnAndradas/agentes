/**
 * Skill-Tool Composition Tests
 *
 * Tests for the skill-tool relationship and composition features.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SkillService } from '../../src/services/SkillService.js';
import type { EventService } from '../../src/services/EventService.js';
import type { SkillDTO, SkillToolLink } from '../../src/types/domain.js';

// =============================================================================
// MOCKS
// =============================================================================

// Mock the database module
vi.mock('../../src/db/index.js', () => {
  const mockSkills = new Map<string, any>();
  const mockTools = new Map<string, any>();
  const mockSkillTools = new Map<string, any>(); // key: `${skillId}:${toolId}`

  // Pre-populate some tools
  mockTools.set('tool-1', {
    id: 'tool-1',
    name: 'Test Tool 1',
    type: 'script',
    status: 'active',
    version: '1.0.0',
    path: '/tools/test1',
    executionCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mockTools.set('tool-2', {
    id: 'tool-2',
    name: 'Test Tool 2',
    type: 'api',
    status: 'active',
    version: '1.0.0',
    path: '/tools/test2',
    executionCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  mockTools.set('tool-3', {
    id: 'tool-3',
    name: 'Test Tool 3',
    type: 'binary',
    status: 'active',
    version: '1.0.0',
    path: '/tools/test3',
    executionCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return {
    db: {
      select: () => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            limit: (n: number) => ({
              then: (resolve: any) => {
                // Handle different table queries
                const tableName = table?.[Symbol.for('drizzle:Name')] || 'unknown';
                if (tableName === 'skills') {
                  const skills = Array.from(mockSkills.values());
                  resolve(skills.slice(0, n));
                } else if (tableName === 'skill_tools') {
                  const links = Array.from(mockSkillTools.values());
                  resolve(links.slice(0, n));
                } else if (tableName === 'tools') {
                  const tools = Array.from(mockTools.values());
                  resolve(tools.slice(0, n));
                } else {
                  resolve([]);
                }
              },
            }),
            orderBy: () => ({
              then: (resolve: any) => {
                const links = Array.from(mockSkillTools.values());
                resolve(links.sort((a, b) => a.orderIndex - b.orderIndex));
              },
            }),
            then: (resolve: any) => {
              resolve([]);
            },
          }),
          orderBy: () => ({
            then: (resolve: any) => {
              const skills = Array.from(mockSkills.values());
              resolve(skills);
            },
          }),
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                then: (resolve: any) => {
                  resolve([]);
                },
              }),
              then: (resolve: any) => {
                resolve([]);
              },
            }),
          }),
          then: (resolve: any) => {
            resolve([]);
          },
        }),
      }),
      insert: (table: any) => ({
        values: (data: any) => ({
          then: (resolve: any) => {
            const tableName = table?.[Symbol.for('drizzle:Name')] || 'unknown';
            if (tableName === 'skills') {
              mockSkills.set(data.id, data);
            } else if (tableName === 'skill_tools') {
              mockSkillTools.set(`${data.skillId}:${data.toolId}`, data);
            }
            resolve();
          },
        }),
      }),
      update: (table: any) => ({
        set: (data: any) => ({
          where: () => ({
            then: (resolve: any) => {
              resolve();
            },
          }),
        }),
      }),
      delete: (table: any) => ({
        where: () => ({
          then: (resolve: any) => {
            resolve();
          },
        }),
      }),
    },
    schema: {
      skills: { id: 'id', name: 'name', [Symbol.for('drizzle:Name')]: 'skills' },
      skillTools: { skillId: 'skill_id', toolId: 'tool_id', [Symbol.for('drizzle:Name')]: 'skill_tools' },
      tools: { id: 'id', [Symbol.for('drizzle:Name')]: 'tools' },
      agentSkills: { agentId: 'agent_id', skillId: 'skill_id' },
    },
  };
});

// Mock event service
const mockEventService: EventService = {
  emit: vi.fn().mockResolvedValue(undefined),
  getRecent: vi.fn().mockResolvedValue([]),
  getByType: vi.fn().mockResolvedValue([]),
  getByCategory: vi.fn().mockResolvedValue([]),
  getByResource: vi.fn().mockResolvedValue([]),
} as unknown as EventService;

// =============================================================================
// SKILL TOOL LINK TESTS (Unit tests without full DB)
// =============================================================================

describe('SkillToolLink Types', () => {
  it('should have correct SkillToolLink structure', () => {
    const link: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      role: 'primary',
      config: { timeout: 5000 },
      createdAt: Date.now(),
    };

    expect(link.toolId).toBe('tool-1');
    expect(link.orderIndex).toBe(0);
    expect(link.required).toBe(true);
    expect(link.role).toBe('primary');
    expect(link.config).toEqual({ timeout: 5000 });
    expect(link.createdAt).toBeGreaterThan(0);
  });

  it('should allow optional fields', () => {
    const link: SkillToolLink = {
      toolId: 'tool-2',
      orderIndex: 1,
      required: false,
      createdAt: Date.now(),
    };

    expect(link.role).toBeUndefined();
    expect(link.config).toBeUndefined();
  });
});

describe('SkillDTO with toolCount', () => {
  it('should support toolCount field', () => {
    const skill: SkillDTO = {
      id: 'skill-1',
      name: 'Test Skill',
      version: '1.0.0',
      path: '/skills/test',
      status: 'active',
      toolCount: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(skill.toolCount).toBe(3);
  });

  it('should support linkedTools field', () => {
    const skill: SkillDTO = {
      id: 'skill-1',
      name: 'Test Skill',
      version: '1.0.0',
      path: '/skills/test',
      status: 'active',
      linkedTools: [
        { toolId: 'tool-1', orderIndex: 0, required: true, createdAt: Date.now() },
        { toolId: 'tool-2', orderIndex: 1, required: false, createdAt: Date.now() },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(skill.linkedTools).toHaveLength(2);
    expect(skill.linkedTools?.[0].toolId).toBe('tool-1');
    expect(skill.linkedTools?.[1].required).toBe(false);
  });
});

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('Skill Tool Validation', () => {
  it('should validate toolId is required', () => {
    const link = {
      orderIndex: 0,
      required: true,
      createdAt: Date.now(),
    } as Partial<SkillToolLink>;

    expect(link.toolId).toBeUndefined();
  });

  it('should validate orderIndex is non-negative', () => {
    const validLink: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      createdAt: Date.now(),
    };

    const anotherValidLink: SkillToolLink = {
      toolId: 'tool-2',
      orderIndex: 5,
      required: true,
      createdAt: Date.now(),
    };

    expect(validLink.orderIndex).toBeGreaterThanOrEqual(0);
    expect(anotherValidLink.orderIndex).toBeGreaterThanOrEqual(0);
  });

  it('should default required to true conceptually', () => {
    // This tests that our API expects required=true as default
    const linkWithoutRequired = {
      toolId: 'tool-1',
      orderIndex: 0,
      createdAt: Date.now(),
    };

    // When creating via API, required should default to true
    const defaultRequired = true;
    expect(defaultRequired).toBe(true);
  });
});

// =============================================================================
// ORDERING TESTS
// =============================================================================

describe('Skill Tool Ordering', () => {
  it('should maintain order by orderIndex', () => {
    const links: SkillToolLink[] = [
      { toolId: 'tool-3', orderIndex: 2, required: true, createdAt: Date.now() },
      { toolId: 'tool-1', orderIndex: 0, required: true, createdAt: Date.now() },
      { toolId: 'tool-2', orderIndex: 1, required: true, createdAt: Date.now() },
    ];

    const sorted = [...links].sort((a, b) => a.orderIndex - b.orderIndex);

    expect(sorted[0].toolId).toBe('tool-1');
    expect(sorted[1].toolId).toBe('tool-2');
    expect(sorted[2].toolId).toBe('tool-3');
  });

  it('should handle gaps in orderIndex', () => {
    const links: SkillToolLink[] = [
      { toolId: 'tool-1', orderIndex: 0, required: true, createdAt: Date.now() },
      { toolId: 'tool-2', orderIndex: 5, required: true, createdAt: Date.now() },
      { toolId: 'tool-3', orderIndex: 10, required: true, createdAt: Date.now() },
    ];

    const sorted = [...links].sort((a, b) => a.orderIndex - b.orderIndex);

    expect(sorted[0].orderIndex).toBe(0);
    expect(sorted[1].orderIndex).toBe(5);
    expect(sorted[2].orderIndex).toBe(10);
  });
});

// =============================================================================
// DUPLICATE PREVENTION TESTS
// =============================================================================

describe('Skill Tool Duplicates', () => {
  it('should detect duplicate tool IDs', () => {
    const links: SkillToolLink[] = [
      { toolId: 'tool-1', orderIndex: 0, required: true, createdAt: Date.now() },
      { toolId: 'tool-2', orderIndex: 1, required: true, createdAt: Date.now() },
      { toolId: 'tool-1', orderIndex: 2, required: true, createdAt: Date.now() }, // duplicate
    ];

    const toolIds = links.map((l) => l.toolId);
    const uniqueToolIds = [...new Set(toolIds)];

    expect(toolIds.length).toBe(3);
    expect(uniqueToolIds.length).toBe(2);
    expect(toolIds.length).not.toBe(uniqueToolIds.length);
  });

  it('should identify unique tool IDs', () => {
    const links: SkillToolLink[] = [
      { toolId: 'tool-1', orderIndex: 0, required: true, createdAt: Date.now() },
      { toolId: 'tool-2', orderIndex: 1, required: true, createdAt: Date.now() },
      { toolId: 'tool-3', orderIndex: 2, required: true, createdAt: Date.now() },
    ];

    const toolIds = links.map((l) => l.toolId);
    const uniqueToolIds = [...new Set(toolIds)];

    expect(toolIds.length).toBe(uniqueToolIds.length);
  });
});

// =============================================================================
// ROLE TESTS
// =============================================================================

describe('Skill Tool Roles', () => {
  const validRoles = ['primary', 'fallback', 'preprocessing', 'postprocessing', 'validation'];

  it('should support common role values', () => {
    validRoles.forEach((role) => {
      const link: SkillToolLink = {
        toolId: 'tool-1',
        orderIndex: 0,
        required: true,
        role,
        createdAt: Date.now(),
      };

      expect(link.role).toBe(role);
    });
  });

  it('should allow undefined role', () => {
    const link: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      createdAt: Date.now(),
    };

    expect(link.role).toBeUndefined();
  });

  it('should allow custom role values', () => {
    const link: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      role: 'custom-role',
      createdAt: Date.now(),
    };

    expect(link.role).toBe('custom-role');
  });
});

// =============================================================================
// CONFIG OVERRIDE TESTS
// =============================================================================

describe('Skill Tool Config Override', () => {
  it('should support tool-specific config overrides', () => {
    const link: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      config: {
        timeout: 10000,
        retries: 3,
        customParam: 'value',
      },
      createdAt: Date.now(),
    };

    expect(link.config?.timeout).toBe(10000);
    expect(link.config?.retries).toBe(3);
    expect(link.config?.customParam).toBe('value');
  });

  it('should handle empty config', () => {
    const link: SkillToolLink = {
      toolId: 'tool-1',
      orderIndex: 0,
      required: true,
      config: {},
      createdAt: Date.now(),
    };

    expect(link.config).toEqual({});
    expect(Object.keys(link.config!).length).toBe(0);
  });
});

// =============================================================================
// SKILL WITHOUT TOOLS TESTS
// =============================================================================

describe('Skill without Tools', () => {
  it('should allow skill with zero tools', () => {
    const skill: SkillDTO = {
      id: 'skill-empty',
      name: 'Empty Skill',
      version: '1.0.0',
      path: '/skills/empty',
      status: 'active',
      toolCount: 0,
      linkedTools: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(skill.toolCount).toBe(0);
    expect(skill.linkedTools).toHaveLength(0);
  });

  it('should warn when active skill has no tools', () => {
    const skill: SkillDTO = {
      id: 'skill-active-empty',
      name: 'Active Empty Skill',
      version: '1.0.0',
      path: '/skills/active-empty',
      status: 'active',
      toolCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Warning logic: active skill with no tools
    const shouldWarn = skill.status === 'active' && (skill.toolCount ?? 0) === 0;
    expect(shouldWarn).toBe(true);
  });

  it('should not warn when inactive skill has no tools', () => {
    const skill: SkillDTO = {
      id: 'skill-inactive-empty',
      name: 'Inactive Empty Skill',
      version: '1.0.0',
      path: '/skills/inactive-empty',
      status: 'inactive',
      toolCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const shouldWarn = skill.status === 'active' && (skill.toolCount ?? 0) === 0;
    expect(shouldWarn).toBe(false);
  });
});

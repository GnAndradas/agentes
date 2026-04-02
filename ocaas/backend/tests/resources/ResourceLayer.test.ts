/**
 * Resource Layer Tests
 *
 * Tests for the unified Resource abstraction layer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RESOURCE_TYPE,
  isSkillResource,
  isToolResource,
  isResourceActive,
  mapSkillToResource,
  mapToolToResource,
  mapSkillsToResources,
  mapToolsToResources,
  type SkillResource,
  type ToolResource,
} from '../../src/resources/index.js';
import type { SkillDTO, ToolDTO } from '../../src/types/domain.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const mockSkillDTO: SkillDTO = {
  id: 'skill-1',
  name: 'Test Skill',
  description: 'A test skill',
  version: '1.0.0',
  path: '/skills/test',
  status: 'active',
  capabilities: ['testing', 'validation'],
  requirements: ['node18'],
  config: { timeout: 5000 },
  syncedAt: 1700000000,
  createdAt: 1699000000,
  updatedAt: 1700000000,
};

const mockToolDTO: ToolDTO = {
  id: 'tool-1',
  name: 'Test Tool',
  description: 'A test tool',
  version: '2.0.0',
  path: '/tools/test',
  type: 'script',
  status: 'active',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'string' },
  config: { maxRetries: 3 },
  executionCount: 42,
  lastExecutedAt: 1699500000,
  syncedAt: 1700000000,
  createdAt: 1699000000,
  updatedAt: 1700000000,
};

// =============================================================================
// RESOURCE TYPES TESTS
// =============================================================================

describe('ResourceTypes', () => {
  describe('RESOURCE_TYPE constants', () => {
    it('should have skill type', () => {
      expect(RESOURCE_TYPE.SKILL).toBe('skill');
    });

    it('should have tool type', () => {
      expect(RESOURCE_TYPE.TOOL).toBe('tool');
    });
  });

  describe('isSkillResource', () => {
    it('should return true for skill resources', () => {
      const skillResource = mapSkillToResource(mockSkillDTO);
      expect(isSkillResource(skillResource)).toBe(true);
    });

    it('should return false for tool resources', () => {
      const toolResource = mapToolToResource(mockToolDTO);
      expect(isSkillResource(toolResource)).toBe(false);
    });
  });

  describe('isToolResource', () => {
    it('should return true for tool resources', () => {
      const toolResource = mapToolToResource(mockToolDTO);
      expect(isToolResource(toolResource)).toBe(true);
    });

    it('should return false for skill resources', () => {
      const skillResource = mapSkillToResource(mockSkillDTO);
      expect(isToolResource(skillResource)).toBe(false);
    });
  });

  describe('isResourceActive', () => {
    it('should return true for active resources', () => {
      const resource = mapSkillToResource(mockSkillDTO);
      expect(isResourceActive(resource)).toBe(true);
    });

    it('should return false for inactive resources', () => {
      const inactiveSkill: SkillDTO = { ...mockSkillDTO, status: 'inactive' };
      const resource = mapSkillToResource(inactiveSkill);
      expect(isResourceActive(resource)).toBe(false);
    });

    it('should return false for deprecated resources', () => {
      const deprecatedTool: ToolDTO = { ...mockToolDTO, status: 'deprecated' };
      const resource = mapToolToResource(deprecatedTool);
      expect(isResourceActive(resource)).toBe(false);
    });
  });
});

// =============================================================================
// RESOURCE MAPPER TESTS
// =============================================================================

describe('ResourceMapper', () => {
  describe('mapSkillToResource', () => {
    it('should correctly map SkillDTO to SkillResource', () => {
      const resource = mapSkillToResource(mockSkillDTO);

      expect(resource.id).toBe(mockSkillDTO.id);
      expect(resource.type).toBe(RESOURCE_TYPE.SKILL);
      expect(resource.name).toBe(mockSkillDTO.name);
      expect(resource.description).toBe(mockSkillDTO.description);
      expect(resource.version).toBe(mockSkillDTO.version);
      expect(resource.status).toBe(mockSkillDTO.status);
      expect(resource.path).toBe(mockSkillDTO.path);
      expect(resource.config).toEqual(mockSkillDTO.config);
      expect(resource.syncedAt).toBe(mockSkillDTO.syncedAt);
      expect(resource.createdAt).toBe(mockSkillDTO.createdAt);
      expect(resource.updatedAt).toBe(mockSkillDTO.updatedAt);
      // Skill-specific
      expect(resource.capabilities).toEqual(mockSkillDTO.capabilities);
      expect(resource.requirements).toEqual(mockSkillDTO.requirements);
    });

    it('should handle undefined optional fields', () => {
      const minimalSkill: SkillDTO = {
        id: 'skill-2',
        name: 'Minimal',
        version: '1.0.0',
        path: '/skills/minimal',
        status: 'active',
        createdAt: 1699000000,
        updatedAt: 1700000000,
      };

      const resource = mapSkillToResource(minimalSkill);

      expect(resource.id).toBe('skill-2');
      expect(resource.description).toBeUndefined();
      expect(resource.capabilities).toBeUndefined();
      expect(resource.requirements).toBeUndefined();
      expect(resource.config).toBeUndefined();
    });
  });

  describe('mapToolToResource', () => {
    it('should correctly map ToolDTO to ToolResource', () => {
      const resource = mapToolToResource(mockToolDTO);

      expect(resource.id).toBe(mockToolDTO.id);
      expect(resource.type).toBe(RESOURCE_TYPE.TOOL);
      expect(resource.name).toBe(mockToolDTO.name);
      expect(resource.description).toBe(mockToolDTO.description);
      expect(resource.version).toBe(mockToolDTO.version);
      expect(resource.status).toBe(mockToolDTO.status);
      expect(resource.path).toBe(mockToolDTO.path);
      expect(resource.config).toEqual(mockToolDTO.config);
      expect(resource.syncedAt).toBe(mockToolDTO.syncedAt);
      expect(resource.createdAt).toBe(mockToolDTO.createdAt);
      expect(resource.updatedAt).toBe(mockToolDTO.updatedAt);
      // Tool-specific
      expect(resource.toolType).toBe(mockToolDTO.type);
      expect(resource.inputSchema).toEqual(mockToolDTO.inputSchema);
      expect(resource.outputSchema).toEqual(mockToolDTO.outputSchema);
      expect(resource.executionCount).toBe(mockToolDTO.executionCount);
      expect(resource.lastExecutedAt).toBe(mockToolDTO.lastExecutedAt);
    });
  });

  describe('mapSkillsToResources', () => {
    it('should map array of SkillDTOs', () => {
      const skills = [mockSkillDTO, { ...mockSkillDTO, id: 'skill-2', name: 'Skill 2' }];
      const resources = mapSkillsToResources(skills);

      expect(resources).toHaveLength(2);
      expect(resources[0].id).toBe('skill-1');
      expect(resources[1].id).toBe('skill-2');
      expect(resources.every(r => r.type === RESOURCE_TYPE.SKILL)).toBe(true);
    });

    it('should return empty array for empty input', () => {
      const resources = mapSkillsToResources([]);
      expect(resources).toHaveLength(0);
    });
  });

  describe('mapToolsToResources', () => {
    it('should map array of ToolDTOs', () => {
      const tools = [mockToolDTO, { ...mockToolDTO, id: 'tool-2', name: 'Tool 2' }];
      const resources = mapToolsToResources(tools);

      expect(resources).toHaveLength(2);
      expect(resources[0].id).toBe('tool-1');
      expect(resources[1].id).toBe('tool-2');
      expect(resources.every(r => r.type === RESOURCE_TYPE.TOOL)).toBe(true);
    });

    it('should return empty array for empty input', () => {
      const resources = mapToolsToResources([]);
      expect(resources).toHaveLength(0);
    });
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Resource Layer Integration', () => {
  it('should maintain type safety across mapping', () => {
    const skillResource = mapSkillToResource(mockSkillDTO);
    const toolResource = mapToolToResource(mockToolDTO);

    // Type narrowing should work
    if (isSkillResource(skillResource)) {
      // Should have capabilities (skill-specific)
      expect(skillResource.capabilities).toBeDefined();
    }

    if (isToolResource(toolResource)) {
      // Should have executionCount (tool-specific)
      expect(toolResource.executionCount).toBeDefined();
    }
  });

  it('should not break existing DTO structure', () => {
    // Original DTO should be unchanged after mapping
    const originalSkill = { ...mockSkillDTO };
    mapSkillToResource(mockSkillDTO);

    expect(mockSkillDTO).toEqual(originalSkill);
  });

  it('should handle mixed resource arrays', () => {
    const skills = mapSkillsToResources([mockSkillDTO]);
    const tools = mapToolsToResources([mockToolDTO]);
    const allResources = [...skills, ...tools];

    expect(allResources).toHaveLength(2);

    const skillCount = allResources.filter(isSkillResource).length;
    const toolCount = allResources.filter(isToolResource).length;

    expect(skillCount).toBe(1);
    expect(toolCount).toBe(1);
  });
});

/**
 * Contract Alignment Tests
 *
 * These tests verify that the API contracts between frontend and backend
 * are properly aligned. They test:
 * - Route existence
 * - Schema validation
 * - Payload compatibility
 * - Response format
 *
 * These tests can run in any environment (Windows/Linux/macOS) as they
 * test the code structure, not runtime behavior.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Import schemas
import { CreateAgentSchema, UpdateAgentSchema } from '../agents/schemas.js';
import {
  CreateSkillSchema,
  UpdateSkillSchema,
  SetSkillToolsSchema,
  AddToolToSkillSchema,
  UpdateToolLinkSchema,
  ExecuteSkillSchema,
  ValidateExecutionSchema,
} from '../skills/schemas.js';
import {
  CreateToolSchema,
  UpdateToolSchema,
  ValidateToolSchema,
} from '../tools/schemas.js';

// =============================================================================
// AGENT CONTRACT TESTS
// =============================================================================

describe('Agent API Contract', () => {
  describe('CreateAgentSchema', () => {
    it('accepts valid agent creation payload', () => {
      const payload = {
        name: 'Test Agent',
        description: 'A test agent',
        type: 'general',
        capabilities: ['coding', 'research'],
        config: { foo: 'bar' },
      };

      const result = CreateAgentSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires name field', () => {
      const payload = { description: 'No name' };
      const result = CreateAgentSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('validates type enum', () => {
      const valid = { name: 'Test', type: 'specialist' };
      const invalid = { name: 'Test', type: 'invalid_type' };

      expect(CreateAgentSchema.safeParse(valid).success).toBe(true);
      expect(CreateAgentSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('UpdateAgentSchema', () => {
    it('accepts partial updates', () => {
      const payloads = [
        { name: 'New Name' },
        { description: 'New description' },
        { type: 'specialist' },
        { capabilities: ['new-cap'] },
        { config: { new: 'config' } },
      ];

      for (const payload of payloads) {
        const result = UpdateAgentSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }
    });

    it('does NOT include status field', () => {
      // This is intentional - status changes via /activate and /deactivate
      const schema = UpdateAgentSchema;
      const shape = schema._def.shape();
      expect(shape).not.toHaveProperty('status');
    });

    it('ignores status field if provided (no error, just ignored)', () => {
      const payload = { name: 'Test', status: 'active' };
      const result = UpdateAgentSchema.safeParse(payload);
      // Zod strips unknown fields by default
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('status');
      }
    });
  });
});

// =============================================================================
// SKILL CONTRACT TESTS
// =============================================================================

describe('Skill API Contract', () => {
  describe('CreateSkillSchema', () => {
    it('accepts valid skill creation payload', () => {
      const payload = {
        name: 'test-skill',
        description: 'A test skill',
        version: '1.0.0',
        path: '/skills/test',
        capabilities: ['parsing'],
        requirements: ['node18'],
        config: {},
      };

      const result = CreateSkillSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires name and path', () => {
      expect(CreateSkillSchema.safeParse({ name: 'test' }).success).toBe(false);
      expect(CreateSkillSchema.safeParse({ path: '/test' }).success).toBe(false);
      expect(CreateSkillSchema.safeParse({ name: 'test', path: '/test' }).success).toBe(true);
    });
  });

  describe('UpdateSkillSchema', () => {
    it('includes status field', () => {
      const schema = UpdateSkillSchema;
      const shape = schema._def.shape();
      expect(shape).toHaveProperty('status');
    });

    it('accepts valid status values', () => {
      const statuses = ['active', 'inactive', 'deprecated'];
      for (const status of statuses) {
        const result = UpdateSkillSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid status values', () => {
      const result = UpdateSkillSchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('SetSkillToolsSchema', () => {
    it('accepts array of tool links', () => {
      const payload = {
        tools: [
          { toolId: 'tool-1', orderIndex: 0, required: true },
          { toolId: 'tool-2', orderIndex: 1, required: false, role: 'helper' },
        ],
      };

      const result = SetSkillToolsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts empty tools array', () => {
      const result = SetSkillToolsSchema.safeParse({ tools: [] });
      expect(result.success).toBe(true);
    });

    it('requires toolId in each tool', () => {
      const payload = { tools: [{ orderIndex: 0 }] };
      const result = SetSkillToolsSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('does NOT require createdAt (frontend should not send it)', () => {
      // The frontend type has createdAt optional, and backend doesn't expect it
      const payload = {
        tools: [{ toolId: 'tool-1' }],
      };
      const result = SetSkillToolsSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('ExecuteSkillSchema', () => {
    it('accepts execution request with defaults', () => {
      const result = ExecuteSkillSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('run');
        expect(result.data.input).toEqual({});
      }
    });

    it('accepts all execution modes', () => {
      const modes = ['run', 'validate', 'dry_run'];
      for (const mode of modes) {
        const result = ExecuteSkillSchema.safeParse({ mode });
        expect(result.success).toBe(true);
      }
    });

    it('accepts caller information', () => {
      const payload = {
        mode: 'run',
        input: { foo: 'bar' },
        caller: { type: 'agent', id: 'agent-1', name: 'Test Agent' },
      };
      const result = ExecuteSkillSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// TOOL CONTRACT TESTS
// =============================================================================

describe('Tool API Contract', () => {
  describe('CreateToolSchema', () => {
    it('accepts valid tool creation payload', () => {
      const payload = {
        name: 'test-tool',
        description: 'A test tool',
        version: '1.0.0',
        path: '/tools/test',
        type: 'script',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        config: {},
      };

      const result = CreateToolSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires name and path', () => {
      expect(CreateToolSchema.safeParse({ name: 'test' }).success).toBe(false);
      expect(CreateToolSchema.safeParse({ path: '/test' }).success).toBe(false);
      expect(CreateToolSchema.safeParse({ name: 'test', path: '/test' }).success).toBe(true);
    });

    it('accepts all tool types', () => {
      const types = ['script', 'binary', 'api'];
      for (const type of types) {
        const result = CreateToolSchema.safeParse({ name: 'test', path: '/test', type });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('UpdateToolSchema', () => {
    it('includes status field', () => {
      const schema = UpdateToolSchema;
      const shape = schema._def.shape();
      expect(shape).toHaveProperty('status');
    });

    it('accepts valid status values', () => {
      const statuses = ['active', 'inactive', 'deprecated'];
      for (const status of statuses) {
        const result = UpdateToolSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('ValidateToolSchema', () => {
    it('accepts tool data for validation', () => {
      const payload = {
        name: 'test-tool',
        path: '/tools/test',
        type: 'script',
        description: 'Test',
      };

      const result = ValidateToolSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('requires name and path', () => {
      expect(ValidateToolSchema.safeParse({ name: 'test' }).success).toBe(false);
      expect(ValidateToolSchema.safeParse({ path: '/test' }).success).toBe(false);
    });
  });
});

// =============================================================================
// CROSS-CUTTING CONTRACT TESTS
// =============================================================================

describe('Cross-Entity Contract Alignment', () => {
  describe('Status field consistency', () => {
    it('Agent: NO status in UpdateSchema (uses /activate, /deactivate)', () => {
      const shape = UpdateAgentSchema._def.shape();
      expect(shape).not.toHaveProperty('status');
    });

    it('Skill: HAS status in UpdateSchema (direct update allowed)', () => {
      const shape = UpdateSkillSchema._def.shape();
      expect(shape).toHaveProperty('status');
    });

    it('Tool: HAS status in UpdateSchema (direct update allowed)', () => {
      const shape = UpdateToolSchema._def.shape();
      expect(shape).toHaveProperty('status');
    });
  });

  describe('Common patterns', () => {
    it('All entities support name updates', () => {
      for (const schema of [UpdateAgentSchema, UpdateSkillSchema, UpdateToolSchema]) {
        const result = schema.safeParse({ name: 'New Name' });
        expect(result.success).toBe(true);
      }
    });

    it('All entities support description updates', () => {
      for (const schema of [UpdateAgentSchema, UpdateSkillSchema, UpdateToolSchema]) {
        const result = schema.safeParse({ description: 'New description' });
        expect(result.success).toBe(true);
      }
    });
  });
});

// =============================================================================
// PAYLOAD COMPATIBILITY TESTS (Frontend -> Backend)
// =============================================================================

describe('Frontend Payload Compatibility', () => {
  describe('Agent edit from Agents.tsx', () => {
    it('matches expected backend schema', () => {
      // Simulates payload from Agents.tsx handleUpdate (lines 141-149)
      const frontendPayload = {
        name: 'Test Agent',
        description: 'Description',
        type: 'general',
        capabilities: ['cap1', 'cap2'],
      };

      const result = UpdateAgentSchema.safeParse(frontendPayload);
      expect(result.success).toBe(true);
    });
  });

  describe('Skill tools from SkillEditor.tsx', () => {
    it('matches expected backend schema (without createdAt)', () => {
      // Simulates payload from SkillEditor.tsx handleSubmit (after fix)
      const frontendPayload = {
        tools: [
          { toolId: 'tool-1', orderIndex: 0, required: true, role: undefined },
          { toolId: 'tool-2', orderIndex: 1, required: false, role: 'helper' },
        ],
      };

      const result = SetSkillToolsSchema.safeParse(frontendPayload);
      expect(result.success).toBe(true);
    });
  });

  describe('Tool status change from Tools.tsx', () => {
    it('matches expected backend schema', () => {
      // Simulates payload from Tools.tsx updateStatusMutation
      const frontendPayload = { status: 'active' };

      const result = UpdateToolSchema.safeParse(frontendPayload);
      expect(result.success).toBe(true);
    });
  });
});

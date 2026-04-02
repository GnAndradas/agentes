/**
 * Tool Validation Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TOOL_TYPE,
  validateToolConfig,
  isConfigCompatibleWithType,
  getDefaultConfigForType,
  ScriptToolConfigSchema,
  BinaryToolConfigSchema,
  ApiToolConfigSchema,
} from '../../src/types/tool-config.js';
import { ToolValidationService, getToolValidationService } from '../../src/services/ToolValidationService.js';

// =============================================================================
// TOOL CONFIG VALIDATION
// =============================================================================

describe('Tool Config Types', () => {
  describe('validateToolConfig', () => {
    it('should validate valid script config', () => {
      const config = {
        entrypoint: 'index.js',
        runtime: 'node',
        timeoutMs: 30000,
      };
      const result = validateToolConfig(TOOL_TYPE.SCRIPT, config);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.config).toEqual(config);
      }
    });

    it('should validate valid binary config', () => {
      const config = {
        binaryPath: '/usr/bin/test',
        argsTemplate: '--input {{input}}',
        shell: false,
      };
      const result = validateToolConfig(TOOL_TYPE.BINARY, config);
      expect(result.valid).toBe(true);
    });

    it('should validate valid API config', () => {
      const config = {
        method: 'POST',
        url: 'https://api.example.com/endpoint',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 5000,
      };
      const result = validateToolConfig(TOOL_TYPE.API, config);
      expect(result.valid).toBe(true);
    });

    it('should accept empty config (backwards compatible)', () => {
      const result = validateToolConfig(TOOL_TYPE.SCRIPT, null);
      expect(result.valid).toBe(true);
    });

    it('should accept undefined config', () => {
      const result = validateToolConfig(TOOL_TYPE.SCRIPT, undefined);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid script config with unknown fields', () => {
      const config = {
        entrypoint: 'index.js',
        unknownField: 'value',
      };
      const result = validateToolConfig(TOOL_TYPE.SCRIPT, config);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('should reject API config with invalid method', () => {
      const config = {
        method: 'INVALID',
        url: 'https://example.com',
      };
      const result = validateToolConfig(TOOL_TYPE.API, config);
      expect(result.valid).toBe(false);
    });

    it('should reject non-object config', () => {
      const result = validateToolConfig(TOOL_TYPE.SCRIPT, 'string');
      expect(result.valid).toBe(false);
    });
  });

  describe('isConfigCompatibleWithType', () => {
    it('should accept script fields for script type', () => {
      const config = { entrypoint: 'main.js', runtime: 'node' };
      expect(isConfigCompatibleWithType(TOOL_TYPE.SCRIPT, config)).toBe(true);
    });

    it('should reject API fields for script type', () => {
      const config = { method: 'GET', url: 'https://example.com' };
      expect(isConfigCompatibleWithType(TOOL_TYPE.SCRIPT, config)).toBe(false);
    });

    it('should accept empty config for any type', () => {
      expect(isConfigCompatibleWithType(TOOL_TYPE.SCRIPT, {})).toBe(true);
      expect(isConfigCompatibleWithType(TOOL_TYPE.BINARY, {})).toBe(true);
      expect(isConfigCompatibleWithType(TOOL_TYPE.API, {})).toBe(true);
    });

    it('should allow underscore-prefixed fields (private)', () => {
      const config = { entrypoint: 'main.js', _internal: 'value' };
      expect(isConfigCompatibleWithType(TOOL_TYPE.SCRIPT, config)).toBe(true);
    });
  });

  describe('getDefaultConfigForType', () => {
    it('should return default script config', () => {
      const config = getDefaultConfigForType(TOOL_TYPE.SCRIPT);
      expect(config).toHaveProperty('runtime', 'node');
      expect(config).toHaveProperty('timeoutMs', 30000);
    });

    it('should return default binary config', () => {
      const config = getDefaultConfigForType(TOOL_TYPE.BINARY);
      expect(config).toHaveProperty('timeoutMs', 30000);
      expect(config).toHaveProperty('shell', false);
    });

    it('should return default API config', () => {
      const config = getDefaultConfigForType(TOOL_TYPE.API);
      expect(config).toHaveProperty('method', 'GET');
      expect(config).toHaveProperty('timeoutMs', 30000);
      expect(config).toHaveProperty('followRedirects', true);
      expect(config).toHaveProperty('responseType', 'json');
    });
  });
});

// =============================================================================
// TOOL VALIDATION SERVICE
// =============================================================================

describe('ToolValidationService', () => {
  let service: ToolValidationService;

  beforeEach(() => {
    service = new ToolValidationService();
  });

  describe('validateTool', () => {
    it('should pass for valid tool with all fields', () => {
      const result = service.validateTool({
        name: 'my-tool',
        path: '/tools/my-tool',
        type: 'script',
        description: 'A test tool',
        version: '1.0.0',
        config: {
          entrypoint: 'index.js',
          runtime: 'node',
        },
      });

      expect(result.valid).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('should fail for missing name', () => {
      const result = service.validateTool({
        name: '',
        path: '/tools/test',
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'name')).toBe(true);
    });

    it('should fail for missing path', () => {
      const result = service.validateTool({
        name: 'test',
        path: '',
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.field === 'path')).toBe(true);
    });

    it('should warn for unknown config fields', () => {
      const result = service.validateTool({
        name: 'test',
        path: '/tools/test',
        type: 'script',
        config: {
          unknownField: 'value',
        } as Record<string, unknown>,
      });

      expect(result.issues.some(i =>
        i.field === 'config' && i.severity === 'warning'
      )).toBe(true);
    });

    it('should provide suggestions for missing fields', () => {
      const result = service.validateTool({
        name: 'test',
        path: '/tools/test',
        type: 'script',
      });

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.some(s => s.includes('description'))).toBe(true);
    });

    it('should validate API tool requires url suggestion', () => {
      const result = service.validateTool({
        name: 'api-test',
        path: '/tools/api',
        type: 'api',
        config: {},
      });

      expect(result.issues.some(i =>
        i.field === 'config.url' && i.severity === 'warning'
      )).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should validate script config', () => {
      const result = service.validateConfig('script', {
        runtime: 'python3',
        timeoutMs: 60000,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid API method', () => {
      const result = service.validateConfig('api', {
        method: 'INVALID',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept empty config', () => {
      const result = service.validateConfig('script', {});
      expect(result.valid).toBe(true);
    });
  });

  describe('validateJsonSchema', () => {
    it('should validate valid JSON Schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };
      const result = service.validateJsonSchema(schema);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid type in schema', () => {
      const schema = {
        type: 'invalid_type',
      };
      const result = service.validateJsonSchema(schema);
      expect(result.valid).toBe(false);
    });

    it('should reject non-object properties', () => {
      const schema = {
        type: 'object',
        properties: 'not an object',
      };
      const result = service.validateJsonSchema(schema);
      expect(result.valid).toBe(false);
    });

    it('should reject non-array required', () => {
      const schema = {
        type: 'object',
        required: 'name',
      };
      const result = service.validateJsonSchema(schema);
      expect(result.valid).toBe(false);
    });

    it('should accept null/undefined schema', () => {
      expect(service.validateJsonSchema(null).valid).toBe(true);
      expect(service.validateJsonSchema(undefined).valid).toBe(true);
    });
  });
});

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

describe('Zod Schemas', () => {
  describe('ScriptToolConfigSchema', () => {
    it('should parse valid config', () => {
      const result = ScriptToolConfigSchema.safeParse({
        entrypoint: 'main.js',
        runtime: 'node',
        timeoutMs: 30000,
      });
      expect(result.success).toBe(true);
    });

    it('should reject extra fields (strict)', () => {
      const result = ScriptToolConfigSchema.safeParse({
        entrypoint: 'main.js',
        extraField: 'value',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('BinaryToolConfigSchema', () => {
    it('should parse valid config', () => {
      const result = BinaryToolConfigSchema.safeParse({
        binaryPath: '/usr/bin/tool',
        shell: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ApiToolConfigSchema', () => {
    it('should parse valid config', () => {
      const result = ApiToolConfigSchema.safeParse({
        method: 'POST',
        url: 'https://api.example.com',
        headers: { Authorization: 'Bearer token' },
        auth: { type: 'bearer', value: 'token' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid method', () => {
      const result = ApiToolConfigSchema.safeParse({
        method: 'INVALID',
      });
      expect(result.success).toBe(false);
    });
  });
});

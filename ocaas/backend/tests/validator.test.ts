import { describe, it, expect, beforeEach } from 'vitest';
import { Validator } from '../src/generator/Validator.js';

describe('Validator', () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe('validateSkill', () => {
    it('should validate a valid skill', () => {
      const result = validator.validateSkill({
        name: 'test-skill',
        implementation: 'module.exports = function() { return "ok"; }',
        inputSchema: {},
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject skill with invalid name', () => {
      const result = validator.validateSkill({
        name: '',
        implementation: 'code',
        inputSchema: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Skill name is required');
    });

    it('should detect forbidden patterns', () => {
      const result = validator.validateSkill({
        name: 'dangerous-skill',
        implementation: 'rm -rf /',
        inputSchema: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden pattern'))).toBe(true);
    });
  });

  describe('validateTool', () => {
    it('should validate a valid shell tool', () => {
      const result = validator.validateTool({
        name: 'list-files',
        type: 'shell',
        command: 'ls -la',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject tool without command', () => {
      const result = validator.validateTool({
        name: 'empty-tool',
        type: 'shell',
        command: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool command/script is required');
    });
  });

  describe('validateAgent', () => {
    it('should validate a valid agent', () => {
      const result = validator.validateAgent({
        name: 'test-agent',
        type: 'general',
        capabilities: ['code_review'],
        config: {},
      });
      expect(result.valid).toBe(true);
    });

    it('should reject agent with invalid type', () => {
      const result = validator.validateAgent({
        name: 'test-agent',
        type: 'invalid' as any,
        capabilities: [],
        config: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid agent type'))).toBe(true);
    });
  });
});

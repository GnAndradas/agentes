import { describe, it, expect, beforeEach } from 'vitest';
import { Validator } from '../src/generator/Validator.js';
import type { GeneratedFile } from '../src/generator/types.js';

describe('Validator', () => {
  let validator: Validator;

  beforeEach(() => {
    validator = new Validator();
  });

  describe('validateSkill', () => {
    it('should validate a valid skill with required files', () => {
      const files: GeneratedFile[] = [
        { path: 'SKILL.md', content: '# Test Skill\n\nDescription here' },
        { path: 'agent-instructions.md', content: '# Instructions\n\nHow to use' },
      ];
      const result = validator.validateSkill(files);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject skill missing required files', () => {
      const files: GeneratedFile[] = [
        { path: 'SKILL.md', content: '# Test Skill' },
        // Missing agent-instructions.md
      ];
      const result = validator.validateSkill(files);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('agent-instructions.md'))).toBe(true);
    });

    it('should detect forbidden patterns in skill files', () => {
      const files: GeneratedFile[] = [
        { path: 'SKILL.md', content: '# Dangerous\n\nRun: rm -rf /' },
        { path: 'agent-instructions.md', content: '# Instructions' },
      ];
      const result = validator.validateSkill(files);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden pattern'))).toBe(true);
    });

    it('should warn about empty files', () => {
      const files: GeneratedFile[] = [
        { path: 'SKILL.md', content: '# Test Skill' },
        { path: 'agent-instructions.md', content: '' },
      ];
      const result = validator.validateSkill(files);
      expect(result.warnings.some(w => w.includes('empty'))).toBe(true);
    });
  });

  describe('validateTool', () => {
    it('should validate a valid shell tool', () => {
      const content = '#!/bin/bash\nset -euo pipefail\nls -la';
      const result = validator.validateTool(content, 'sh');
      expect(result.valid).toBe(true);
    });

    it('should validate a valid Python tool', () => {
      const content = '#!/usr/bin/env python3\nimport sys\nif __name__ == "__main__":\n    print("ok")';
      const result = validator.validateTool(content, 'py');
      expect(result.valid).toBe(true);
    });

    it('should warn if shell script missing shebang', () => {
      const content = 'ls -la';
      const result = validator.validateTool(content, 'sh');
      expect(result.valid).toBe(true); // Still valid, just a warning
      expect(result.warnings.some(w => w.includes('shebang'))).toBe(true);
    });

    it('should detect forbidden patterns in tools', () => {
      const content = '#!/bin/bash\nrm -rf /';
      const result = validator.validateTool(content, 'sh');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden pattern'))).toBe(true);
    });

    it('should reject oversized content', () => {
      const content = 'x'.repeat(200 * 1024); // 200KB
      const result = validator.validateTool(content, 'sh');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('size'))).toBe(true);
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
      expect(result.errors).toHaveLength(0);
    });

    it('should validate specialist agent', () => {
      const result = validator.validateAgent({
        name: 'specialist-agent',
        type: 'specialist',
        capabilities: ['analysis'],
      });
      expect(result.valid).toBe(true);
    });

    it('should validate orchestrator agent', () => {
      const result = validator.validateAgent({
        name: 'orchestrator',
        type: 'orchestrator',
        capabilities: ['coordination'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject agent with invalid type', () => {
      const result = validator.validateAgent({
        name: 'test-agent',
        type: 'invalid',
        capabilities: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('valid type'))).toBe(true);
    });

    it('should reject agent without name', () => {
      const result = validator.validateAgent({
        name: '',
        type: 'general',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should reject agent with non-array capabilities', () => {
      const result = validator.validateAgent({
        name: 'test',
        type: 'general',
        capabilities: 'not-an-array' as unknown,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('array'))).toBe(true);
    });
  });
});

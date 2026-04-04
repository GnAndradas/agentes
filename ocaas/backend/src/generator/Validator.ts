import { createLogger } from '../utils/logger.js';
import { OPENCLAW_REAL_USAGE } from '../openclaw/OpenClawCompatibility.js';
import type { ValidationResult, GeneratedFile } from './types.js';

const logger = createLogger('Validator');

const SKILL_REQUIRED_FILES = ['SKILL.md', 'agent-instructions.md'];
const FORBIDDEN_PATTERNS = [
  /rm\s+-rf\s+\//,
  /sudo\s+rm/,
  /eval\s*\(/,
  /exec\s*\(/,
  /os\.system/,
  /subprocess\.call.*shell\s*=\s*True/,
  /__import__/,
];
const MAX_FILE_SIZE = 100 * 1024; // 100KB

export class Validator {
  validateSkill(files: GeneratedFile[]): ValidationResult {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    // Check required files
    for (const required of SKILL_REQUIRED_FILES) {
      if (!files.some(f => f.path === required || f.path.endsWith(`/${required}`))) {
        result.errors.push(`Missing required file: ${required}`);
        result.valid = false;
      }
    }

    // Validate each file
    for (const file of files) {
      this.validateFileContent(file, result);
    }

    // BLOQUE 8: Add OpenClaw compatibility warning
    result.warnings.push(OPENCLAW_REAL_USAGE.skills.gap);

    logger.info({ valid: result.valid, errors: result.errors.length }, 'Skill validation completed');
    return result;
  }

  validateTool(content: string, type: 'sh' | 'py'): ValidationResult {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    // Size check
    if (content.length > MAX_FILE_SIZE) {
      result.errors.push(`File size exceeds limit (${MAX_FILE_SIZE} bytes)`);
      result.valid = false;
    }

    // Security patterns
    this.checkForbiddenPatterns(content, result);

    // Type-specific checks
    if (type === 'sh') {
      if (!content.startsWith('#!/bin/bash') && !content.startsWith('#!/bin/sh')) {
        result.warnings.push('Shell script should start with shebang');
      }
      if (content.includes('set -e') || content.includes('set -euo pipefail')) {
        // Good practice
      } else {
        result.warnings.push('Consider using "set -euo pipefail" for safer execution');
      }
    }

    if (type === 'py') {
      if (!content.includes('#!/usr/bin/env python')) {
        result.warnings.push('Python script should start with shebang');
      }
      if (!content.includes('if __name__')) {
        result.warnings.push('Consider adding if __name__ == "__main__" guard');
      }
    }

    // BLOQUE 8: Add OpenClaw compatibility warning
    result.warnings.push(OPENCLAW_REAL_USAGE.tools.gap);

    logger.info({ valid: result.valid, type }, 'Tool validation completed');
    return result;
  }

  validateAgent(config: Record<string, unknown>): ValidationResult {
    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    // Required fields
    if (!config.name || typeof config.name !== 'string') {
      result.errors.push('Agent must have a valid name');
      result.valid = false;
    }

    if (!config.type || !['general', 'specialist', 'orchestrator'].includes(config.type as string)) {
      result.errors.push('Agent must have valid type: general, specialist, or orchestrator');
      result.valid = false;
    }

    // Capabilities
    if (config.capabilities && !Array.isArray(config.capabilities)) {
      result.errors.push('Capabilities must be an array');
      result.valid = false;
    }

    // BLOQUE 8: Add OpenClaw compatibility warning
    result.warnings.push(OPENCLAW_REAL_USAGE.agent.gap);

    logger.info({ valid: result.valid }, 'Agent validation completed');
    return result;
  }

  private validateFileContent(file: GeneratedFile, result: ValidationResult): void {
    // Size check
    if (file.content.length > MAX_FILE_SIZE) {
      result.errors.push(`File ${file.path} exceeds size limit`);
      result.valid = false;
    }

    // Security patterns
    this.checkForbiddenPatterns(file.content, result);

    // Empty file check
    if (file.content.trim().length === 0) {
      result.warnings.push(`File ${file.path} is empty`);
    }
  }

  private checkForbiddenPatterns(content: string, result: ValidationResult): void {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        result.errors.push(`Forbidden pattern detected: ${pattern.source}`);
        result.valid = false;
      }
    }
  }
}

let validatorInstance: Validator | null = null;

export function getValidator(): Validator {
  if (!validatorInstance) {
    validatorInstance = new Validator();
  }
  return validatorInstance;
}

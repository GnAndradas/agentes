/**
 * Tool Validation Service
 *
 * Validates tool structure, configuration, and schemas.
 * Provides detailed validation reports without executing tools.
 */

import {
  TOOL_TYPE,
  type ToolType,
  type ToolConfig,
  validateToolConfig,
  isConfigCompatibleWithType,
  ScriptToolConfigSchema,
  BinaryToolConfigSchema,
  ApiToolConfigSchema,
} from '../types/tool-config.js';
import type { ToolDTO } from '../types/domain.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ToolValidationService');

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ToolValidationResult {
  valid: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  suggestions: string[];
  configAnalysis?: {
    type: ToolType;
    hasRequiredFields: boolean;
    hasOptionalFields: boolean;
    unknownFields: string[];
  };
  schemaAnalysis?: {
    inputSchemaValid: boolean;
    outputSchemaValid: boolean;
    inputSchemaType?: string;
    outputSchemaType?: string;
  };
}

// =============================================================================
// VALIDATION SERVICE
// =============================================================================

export class ToolValidationService {
  /**
   * Validate a tool's complete structure
   */
  validateTool(tool: Partial<ToolDTO> & { name: string; path: string }): ToolValidationResult {
    const issues: ValidationIssue[] = [];
    const suggestions: string[] = [];
    let score = 100;

    // Basic field validation
    if (!tool.name || tool.name.trim().length === 0) {
      issues.push({ field: 'name', message: 'Name is required', severity: 'error' });
      score -= 20;
    }

    if (!tool.path || tool.path.trim().length === 0) {
      issues.push({ field: 'path', message: 'Path is required', severity: 'error' });
      score -= 20;
    }

    // Type validation
    const type = (tool.type || 'script') as ToolType;
    if (!Object.values(TOOL_TYPE).includes(type)) {
      issues.push({
        field: 'type',
        message: `Invalid type: ${type}. Must be one of: ${Object.values(TOOL_TYPE).join(', ')}`,
        severity: 'error',
      });
      score -= 15;
    }

    // Config validation
    const configAnalysis = this.analyzeConfig(type, tool.config);
    if (configAnalysis && configAnalysis.unknownFields.length > 0) {
      issues.push({
        field: 'config',
        message: `Unknown fields for type '${type}': ${configAnalysis.unknownFields.join(', ')}`,
        severity: 'warning',
      });
      score -= 5;
    }

    // Validate config against type schema
    if (tool.config && Object.keys(tool.config).length > 0) {
      const configValidation = validateToolConfig(type, tool.config);
      if (!configValidation.valid) {
        for (const error of configValidation.errors) {
          issues.push({ field: 'config', message: error, severity: 'error' });
          score -= 10;
        }
      }
    }

    // Schema validation
    const schemaAnalysis = this.analyzeSchemas(tool.inputSchema, tool.outputSchema);
    if (schemaAnalysis && !schemaAnalysis.inputSchemaValid && tool.inputSchema) {
      issues.push({
        field: 'inputSchema',
        message: 'inputSchema is not a valid JSON Schema',
        severity: 'warning',
      });
      score -= 5;
    }
    if (schemaAnalysis && !schemaAnalysis.outputSchemaValid && tool.outputSchema) {
      issues.push({
        field: 'outputSchema',
        message: 'outputSchema is not a valid JSON Schema',
        severity: 'warning',
      });
      score -= 5;
    }

    // Type-specific validation
    const typeIssues = this.validateTypeSpecific(type, tool);
    issues.push(...typeIssues);
    score -= typeIssues.filter(i => i.severity === 'error').length * 10;
    score -= typeIssues.filter(i => i.severity === 'warning').length * 5;

    // Generate suggestions
    suggestions.push(...this.generateSuggestions(type, tool, configAnalysis));

    // Ensure score is in valid range
    score = Math.max(0, Math.min(100, score));

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      score,
      issues,
      suggestions,
      configAnalysis,
      schemaAnalysis,
    };
  }

  /**
   * Validate only the config portion
   */
  validateConfig(type: ToolType, config: unknown): { valid: boolean; errors: string[] } {
    if (config === null || config === undefined || (typeof config === 'object' && Object.keys(config as object).length === 0)) {
      return { valid: true, errors: [] };
    }

    const result = validateToolConfig(type, config);
    if (result.valid) {
      return { valid: true, errors: [] };
    }
    return { valid: false, errors: result.errors };
  }

  /**
   * Validate JSON schemas (inputSchema/outputSchema)
   */
  validateJsonSchema(schema: unknown): { valid: boolean; error?: string } {
    if (schema === null || schema === undefined) {
      return { valid: true };
    }

    if (typeof schema !== 'object') {
      return { valid: false, error: 'Schema must be an object' };
    }

    // Basic JSON Schema structure check
    const obj = schema as Record<string, unknown>;

    // Check for common JSON Schema keywords
    const validKeywords = [
      'type', 'properties', 'required', 'items', 'enum', 'const',
      'minimum', 'maximum', 'minLength', 'maxLength', 'pattern',
      'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'not',
      '$ref', '$schema', '$id', 'title', 'description', 'default',
      'format', 'minItems', 'maxItems', 'uniqueItems',
    ];

    // If has 'type', validate it's a valid JSON Schema type
    if ('type' in obj) {
      const validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'];
      if (typeof obj.type === 'string' && !validTypes.includes(obj.type)) {
        return { valid: false, error: `Invalid JSON Schema type: ${obj.type}` };
      }
      if (Array.isArray(obj.type) && !obj.type.every(t => validTypes.includes(t))) {
        return { valid: false, error: 'Invalid type in JSON Schema type array' };
      }
    }

    // If has 'properties', validate it's an object
    if ('properties' in obj && (typeof obj.properties !== 'object' || obj.properties === null)) {
      return { valid: false, error: 'properties must be an object' };
    }

    // If has 'required', validate it's an array
    if ('required' in obj && !Array.isArray(obj.required)) {
      return { valid: false, error: 'required must be an array' };
    }

    return { valid: true };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private analyzeConfig(
    type: ToolType,
    config?: Record<string, unknown>
  ): ToolValidationResult['configAnalysis'] {
    if (!config) {
      return {
        type,
        hasRequiredFields: false,
        hasOptionalFields: false,
        unknownFields: [],
      };
    }

    const configKeys = Object.keys(config);
    let knownFields: string[];

    switch (type) {
      case TOOL_TYPE.SCRIPT:
        knownFields = ['entrypoint', 'runtime', 'argsTemplate', 'workingDirectory', 'envVars', 'timeoutMs', 'captureStderr'];
        break;
      case TOOL_TYPE.BINARY:
        knownFields = ['binaryPath', 'argsTemplate', 'workingDirectory', 'envVars', 'timeoutMs', 'shell'];
        break;
      case TOOL_TYPE.API:
        knownFields = ['method', 'url', 'headers', 'bodyTemplate', 'queryTemplate', 'timeoutMs', 'followRedirects', 'responseType', 'auth'];
        break;
      default:
        knownFields = [];
    }

    const unknownFields = configKeys.filter(k => !knownFields.includes(k) && !k.startsWith('_'));

    return {
      type,
      hasRequiredFields: configKeys.length > 0,
      hasOptionalFields: configKeys.some(k => knownFields.includes(k)),
      unknownFields,
    };
  }

  private analyzeSchemas(
    inputSchema?: Record<string, unknown>,
    outputSchema?: Record<string, unknown>
  ): ToolValidationResult['schemaAnalysis'] {
    const inputResult = this.validateJsonSchema(inputSchema);
    const outputResult = this.validateJsonSchema(outputSchema);

    return {
      inputSchemaValid: inputResult.valid,
      outputSchemaValid: outputResult.valid,
      inputSchemaType: inputSchema?.type as string | undefined,
      outputSchemaType: outputSchema?.type as string | undefined,
    };
  }

  private validateTypeSpecific(type: ToolType, tool: Partial<ToolDTO>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const config = tool.config as Record<string, unknown> | undefined;

    switch (type) {
      case TOOL_TYPE.SCRIPT:
        // Script should ideally have entrypoint or runtime
        if (config && !config.entrypoint && !config.runtime) {
          issues.push({
            field: 'config',
            message: 'Script tool should specify entrypoint or runtime',
            severity: 'info',
          });
        }
        break;

      case TOOL_TYPE.API:
        // API should have url
        if (config && !config.url) {
          issues.push({
            field: 'config.url',
            message: 'API tool should specify url',
            severity: 'warning',
          });
        }
        // Validate method if present
        if (config?.method) {
          const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
          if (!validMethods.includes(config.method as string)) {
            issues.push({
              field: 'config.method',
              message: `Invalid HTTP method: ${config.method}`,
              severity: 'error',
            });
          }
        }
        break;

      case TOOL_TYPE.BINARY:
        // Binary should have binaryPath
        if (config && !config.binaryPath) {
          issues.push({
            field: 'config.binaryPath',
            message: 'Binary tool should specify binaryPath',
            severity: 'info',
          });
        }
        break;
    }

    return issues;
  }

  private generateSuggestions(
    type: ToolType,
    tool: Partial<ToolDTO>,
    configAnalysis: ToolValidationResult['configAnalysis']
  ): string[] {
    const suggestions: string[] = [];

    // Description suggestion
    if (!tool.description) {
      suggestions.push('Add a description to help others understand what this tool does');
    }

    // Version suggestion
    if (!tool.version || tool.version === '1.0.0') {
      suggestions.push('Consider using semantic versioning (e.g., 1.0.0) for your tool');
    }

    // Type-specific suggestions
    switch (type) {
      case TOOL_TYPE.SCRIPT:
        if (!tool.config || !('timeoutMs' in (tool.config as object))) {
          suggestions.push('Consider setting a timeoutMs to prevent runaway scripts');
        }
        break;

      case TOOL_TYPE.API:
        if (!tool.config || !('timeoutMs' in (tool.config as object))) {
          suggestions.push('Consider setting a timeoutMs for API calls');
        }
        if (tool.config && 'auth' in (tool.config as object)) {
          suggestions.push('Ensure API credentials are stored securely and not hardcoded');
        }
        break;

      case TOOL_TYPE.BINARY:
        suggestions.push('Verify the binary path exists and is executable on the target system');
        break;
    }

    // Schema suggestions
    if (!tool.inputSchema) {
      suggestions.push('Define an inputSchema to validate tool inputs');
    }
    if (!tool.outputSchema) {
      suggestions.push('Define an outputSchema to document expected outputs');
    }

    return suggestions;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: ToolValidationService | null = null;

export function getToolValidationService(): ToolValidationService {
  if (!instance) {
    instance = new ToolValidationService();
  }
  return instance;
}

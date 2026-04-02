/**
 * Tool Configuration Types
 *
 * Type-specific configuration structures for different tool types.
 * Provides strong typing while maintaining backwards compatibility
 * with existing untyped config data.
 */

import { z } from 'zod';

// =============================================================================
// TOOL TYPE CONSTANTS
// =============================================================================

export const TOOL_TYPE = {
  SCRIPT: 'script',
  BINARY: 'binary',
  API: 'api',
} as const;

export type ToolType = typeof TOOL_TYPE[keyof typeof TOOL_TYPE];

// =============================================================================
// SCRIPT TOOL CONFIG
// =============================================================================

/**
 * Configuration for script-based tools (Node.js, Python, etc.)
 */
export interface ScriptToolConfig {
  /** Script entry point (e.g., "index.js", "main.py") */
  entrypoint?: string;

  /** Runtime to use (e.g., "node", "python3", "bash") */
  runtime?: string;

  /** Arguments template with placeholders (e.g., "--input {{input}}") */
  argsTemplate?: string;

  /** Working directory for script execution */
  workingDirectory?: string;

  /** Environment variables to set */
  envVars?: Record<string, string>;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Whether to capture stderr separately */
  captureStderr?: boolean;
}

export const ScriptToolConfigSchema = z.object({
  entrypoint: z.string().optional(),
  runtime: z.string().optional(),
  argsTemplate: z.string().optional(),
  workingDirectory: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
  captureStderr: z.boolean().optional(),
}).strict();

// =============================================================================
// BINARY TOOL CONFIG
// =============================================================================

/**
 * Configuration for binary executable tools
 */
export interface BinaryToolConfig {
  /** Path to the binary executable */
  binaryPath?: string;

  /** Arguments template with placeholders */
  argsTemplate?: string;

  /** Working directory for execution */
  workingDirectory?: string;

  /** Environment variables to set */
  envVars?: Record<string, string>;

  /** Timeout in milliseconds */
  timeoutMs?: number;

  /** Whether to run in shell mode */
  shell?: boolean;
}

export const BinaryToolConfigSchema = z.object({
  binaryPath: z.string().optional(),
  argsTemplate: z.string().optional(),
  workingDirectory: z.string().optional(),
  envVars: z.record(z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
  shell: z.boolean().optional(),
}).strict();

// =============================================================================
// API TOOL CONFIG
// =============================================================================

/**
 * HTTP methods for API tools
 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = typeof HTTP_METHODS[number];

/**
 * Configuration for API-based tools (HTTP endpoints)
 */
export interface ApiToolConfig {
  /** HTTP method */
  method?: HttpMethod;

  /** URL template with placeholders (e.g., "https://api.example.com/{{resource}}") */
  url?: string;

  /** HTTP headers */
  headers?: Record<string, string>;

  /** Request body template (JSON string with placeholders) */
  bodyTemplate?: string;

  /** Query parameters template */
  queryTemplate?: Record<string, string>;

  /** Request timeout in milliseconds */
  timeoutMs?: number;

  /** Whether to follow redirects */
  followRedirects?: boolean;

  /** Expected response content type */
  responseType?: 'json' | 'text' | 'binary';

  /** Authentication configuration */
  auth?: {
    type: 'bearer' | 'basic' | 'api_key';
    /** For bearer: token, for basic: "user:pass", for api_key: key value */
    value?: string;
    /** For api_key: header name (default: X-API-Key) */
    headerName?: string;
  };
}

export const ApiToolConfigSchema = z.object({
  method: z.enum(HTTP_METHODS).optional(),
  url: z.string().url().optional().or(z.string().regex(/\{\{.*\}\}/).optional()), // Allow templates
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().optional(),
  queryTemplate: z.record(z.string()).optional(),
  timeoutMs: z.number().positive().optional(),
  followRedirects: z.boolean().optional(),
  responseType: z.enum(['json', 'text', 'binary']).optional(),
  auth: z.object({
    type: z.enum(['bearer', 'basic', 'api_key']),
    value: z.string().optional(),
    headerName: z.string().optional(),
  }).optional(),
}).strict();

// =============================================================================
// UNION TYPE
// =============================================================================

/**
 * Union of all tool config types
 */
export type ToolConfig = ScriptToolConfig | BinaryToolConfig | ApiToolConfig;

// =============================================================================
// LEGACY CONFIG
// =============================================================================

/**
 * Schema for legacy/untyped config (accepts anything)
 * Used for backwards compatibility with existing data
 */
export const LegacyToolConfigSchema = z.record(z.unknown());

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate config based on tool type
 * Returns validation result with typed config or errors
 */
export function validateToolConfig(
  type: ToolType,
  config: unknown
): { valid: true; config: ToolConfig } | { valid: false; errors: string[] } {
  if (config === null || config === undefined) {
    // Empty config is valid (backwards compatible)
    return { valid: true, config: {} };
  }

  if (typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }

  let result;
  switch (type) {
    case TOOL_TYPE.SCRIPT:
      result = ScriptToolConfigSchema.safeParse(config);
      break;
    case TOOL_TYPE.BINARY:
      result = BinaryToolConfigSchema.safeParse(config);
      break;
    case TOOL_TYPE.API:
      result = ApiToolConfigSchema.safeParse(config);
      break;
    default:
      return { valid: false, errors: [`Unknown tool type: ${type}`] };
  }

  if (result.success) {
    return { valid: true, config: result.data as ToolConfig };
  }

  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
  return { valid: false, errors };
}

/**
 * Check if config has expected fields for the given type
 * Less strict than validateToolConfig - just checks structure
 */
export function isConfigCompatibleWithType(type: ToolType, config: Record<string, unknown>): boolean {
  if (!config || Object.keys(config).length === 0) {
    return true; // Empty config is always compatible
  }

  const scriptFields = ['entrypoint', 'runtime', 'argsTemplate', 'workingDirectory', 'envVars', 'timeoutMs', 'captureStderr'];
  const binaryFields = ['binaryPath', 'argsTemplate', 'workingDirectory', 'envVars', 'timeoutMs', 'shell'];
  const apiFields = ['method', 'url', 'headers', 'bodyTemplate', 'queryTemplate', 'timeoutMs', 'followRedirects', 'responseType', 'auth'];

  const configKeys = Object.keys(config);

  switch (type) {
    case TOOL_TYPE.SCRIPT:
      return configKeys.every(k => scriptFields.includes(k) || k.startsWith('_'));
    case TOOL_TYPE.BINARY:
      return configKeys.every(k => binaryFields.includes(k) || k.startsWith('_'));
    case TOOL_TYPE.API:
      return configKeys.every(k => apiFields.includes(k) || k.startsWith('_'));
    default:
      return true;
  }
}

/**
 * Get default config for a tool type
 */
export function getDefaultConfigForType(type: ToolType): ToolConfig {
  switch (type) {
    case TOOL_TYPE.SCRIPT:
      return {
        runtime: 'node',
        timeoutMs: 30000,
      } as ScriptToolConfig;
    case TOOL_TYPE.BINARY:
      return {
        timeoutMs: 30000,
        shell: false,
      } as BinaryToolConfig;
    case TOOL_TYPE.API:
      return {
        method: 'GET',
        timeoutMs: 30000,
        followRedirects: true,
        responseType: 'json',
      } as ApiToolConfig;
    default:
      return {};
  }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isScriptConfig(config: ToolConfig): config is ScriptToolConfig {
  return 'entrypoint' in config || 'runtime' in config;
}

export function isBinaryConfig(config: ToolConfig): config is BinaryToolConfig {
  return 'binaryPath' in config || 'shell' in config;
}

export function isApiConfig(config: ToolConfig): config is ApiToolConfig {
  return 'method' in config || 'url' in config || 'auth' in config;
}

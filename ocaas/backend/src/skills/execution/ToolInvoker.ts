/**
 * Tool Invoker
 *
 * Abstraction layer for invoking tools of different types.
 * Handles script, binary, and API tool execution.
 */

import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { nowTimestamp } from '../../utils/helpers.js';
import type { ToolDTO } from '../../types/domain.js';
import type {
  ScriptToolConfig,
  BinaryToolConfig,
  ApiToolConfig,
} from '../../types/tool-config.js';
import {
  EXECUTION_STATUS,
  type ToolExecutionInput,
  type ToolExecutionResult,
  type ExecutionMode,
  EXECUTION_MODE,
} from './SkillExecutionTypes.js';

const logger = createLogger('ToolInvoker');

// Default timeouts
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB max output

// =============================================================================
// TOOL INVOKER CLASS
// =============================================================================

export class ToolInvoker {
  /**
   * Invoke a tool with the given input
   */
  async invoke(
    input: ToolExecutionInput,
    mode: ExecutionMode
  ): Promise<ToolExecutionResult> {
    const startedAt = nowTimestamp();
    const { tool, input: toolInput, configOverrides, context, timeoutMs } = input;

    // Merge config with overrides
    const config = {
      ...(tool.config || {}),
      ...(configOverrides || {}),
    };

    const timeout = timeoutMs || (config as { timeoutMs?: number }).timeoutMs || DEFAULT_TIMEOUT_MS;

    logger.debug({ toolId: tool.id, toolName: tool.name, type: tool.type, mode }, 'Invoking tool');

    // Dry run mode - simulate execution
    if (mode === EXECUTION_MODE.DRY_RUN) {
      return this.createDryRunResult(tool, startedAt);
    }

    // Validate mode - just check if tool can be executed
    if (mode === EXECUTION_MODE.VALIDATE) {
      return this.validateTool(tool, toolInput, config, startedAt);
    }

    // Real execution based on tool type
    try {
      let result: ToolExecutionResult;

      switch (tool.type) {
        case 'script':
          result = await this.invokeScript(tool, toolInput, config as ScriptToolConfig, context, timeout);
          break;
        case 'binary':
          result = await this.invokeBinary(tool, toolInput, config as BinaryToolConfig, context, timeout);
          break;
        case 'api':
          result = await this.invokeApi(tool, toolInput, config as ApiToolConfig, context, timeout);
          break;
        default:
          throw new Error(`Unknown tool type: ${tool.type}`);
      }

      return result;
    } catch (err) {
      const completedAt = nowTimestamp();
      const error = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;

      logger.error({ err, toolId: tool.id, toolName: tool.name }, 'Tool invocation failed');

      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.FAILED,
        error,
        errorStack,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        required: true, // Will be set by caller
        orderIndex: 0,  // Will be set by caller
      };
    }
  }

  // ===========================================================================
  // SCRIPT INVOCATION
  // ===========================================================================

  private async invokeScript(
    tool: ToolDTO,
    input: Record<string, unknown>,
    config: ScriptToolConfig,
    context?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ToolExecutionResult> {
    const startedAt = nowTimestamp();

    // Determine runtime and entrypoint
    const runtime = config.runtime || 'node';
    const entrypoint = config.entrypoint || 'index.js';
    const workingDir = config.workingDirectory || tool.path;

    // Build arguments
    const args = this.buildArgs(config.argsTemplate, input);

    // Build environment
    const env = {
      ...process.env,
      ...(config.envVars || {}),
      TOOL_INPUT: JSON.stringify(input),
      TOOL_CONTEXT: context ? JSON.stringify(context) : '{}',
    };

    logger.debug({
      toolId: tool.id,
      runtime,
      entrypoint,
      workingDir,
      args,
    }, 'Executing script tool');

    return new Promise<ToolExecutionResult>((resolve) => {
      const proc = spawn(runtime, [entrypoint, ...args], {
        cwd: workingDir,
        env,
        timeout: timeoutMs,
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.stdout?.on('data', (data) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString();
        }
      });

      proc.stderr?.on('data', (data) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const completedAt = nowTimestamp();

        if (killed) {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: `Tool execution timed out after ${timeoutMs}ms`,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: stderr || `Script exited with code ${code}`,
            output: this.parseOutput(stdout),
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          });
          return;
        }

        resolve({
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.SUCCESS,
          output: this.parseOutput(stdout),
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        const completedAt = nowTimestamp();

        resolve({
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.FAILED,
          error: err.message,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        });
      });
    });
  }

  // ===========================================================================
  // BINARY INVOCATION
  // ===========================================================================

  private async invokeBinary(
    tool: ToolDTO,
    input: Record<string, unknown>,
    config: BinaryToolConfig,
    context?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ToolExecutionResult> {
    const startedAt = nowTimestamp();

    // Determine binary path
    const binaryPath = config.binaryPath || tool.path;
    const workingDir = config.workingDirectory || '.';

    // Build arguments
    const args = this.buildArgs(config.argsTemplate, input);

    // Build environment
    const env = {
      ...process.env,
      ...(config.envVars || {}),
      TOOL_INPUT: JSON.stringify(input),
      TOOL_CONTEXT: context ? JSON.stringify(context) : '{}',
    };

    logger.debug({
      toolId: tool.id,
      binaryPath,
      workingDir,
      args,
      shell: config.shell,
    }, 'Executing binary tool');

    return new Promise<ToolExecutionResult>((resolve) => {
      const proc = spawn(binaryPath, args, {
        cwd: workingDir,
        env,
        timeout: timeoutMs,
        shell: config.shell ?? (process.platform === 'win32'),
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      proc.stdout?.on('data', (data) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString();
        }
      });

      proc.stderr?.on('data', (data) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const completedAt = nowTimestamp();

        if (killed) {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: `Tool execution timed out after ${timeoutMs}ms`,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          });
          return;
        }

        if (code !== 0) {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: stderr || `Binary exited with code ${code}`,
            output: this.parseOutput(stdout),
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          });
          return;
        }

        resolve({
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.SUCCESS,
          output: this.parseOutput(stdout),
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        const completedAt = nowTimestamp();

        resolve({
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.FAILED,
          error: err.message,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        });
      });
    });
  }

  // ===========================================================================
  // API INVOCATION
  // ===========================================================================

  private async invokeApi(
    tool: ToolDTO,
    input: Record<string, unknown>,
    config: ApiToolConfig,
    context?: Record<string, unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ToolExecutionResult> {
    const startedAt = nowTimestamp();

    // Build URL with template substitution
    let url = config.url || '';
    url = this.substituteTemplate(url, input);

    // Build query params
    if (config.queryTemplate) {
      const params = new URLSearchParams();
      for (const [key, template] of Object.entries(config.queryTemplate)) {
        params.set(key, this.substituteTemplate(template, input));
      }
      url += (url.includes('?') ? '&' : '?') + params.toString();
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers || {}),
    };

    // Add authentication
    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${config.auth.value}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(config.auth.value || '').toString('base64')}`;
          break;
        case 'api_key':
          headers[config.auth.headerName || 'X-API-Key'] = config.auth.value || '';
          break;
      }
    }

    // Build body
    let body: string | undefined;
    if (config.bodyTemplate) {
      body = this.substituteTemplate(config.bodyTemplate, input);
    } else if (config.method !== 'GET' && config.method !== 'HEAD') {
      body = JSON.stringify(input);
    }

    logger.debug({
      toolId: tool.id,
      url,
      method: config.method || 'GET',
    }, 'Executing API tool');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: config.method || 'GET',
        headers,
        body,
        signal: controller.signal,
        redirect: config.followRedirects !== false ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      const completedAt = nowTimestamp();

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.FAILED,
          error: `HTTP ${response.status}: ${response.statusText}`,
          output: { statusCode: response.status, body: errorBody },
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        };
      }

      // Parse response based on expected type
      let output: Record<string, unknown>;
      const responseType = config.responseType || 'json';

      switch (responseType) {
        case 'json':
          output = (await response.json()) as Record<string, unknown>;
          break;
        case 'text':
          output = { text: await response.text() };
          break;
        case 'binary':
          output = { binary: Buffer.from(await response.arrayBuffer()).toString('base64') };
          break;
        default:
          output = (await response.json()) as Record<string, unknown>;
      }

      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.SUCCESS,
        output,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        required: true,
        orderIndex: 0,
      };
    } catch (err) {
      const completedAt = nowTimestamp();
      const error = err instanceof Error ? err.message : String(err);

      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.FAILED,
        error: error.includes('abort') ? `API call timed out after ${timeoutMs}ms` : error,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        required: true,
        orderIndex: 0,
      };
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Create a dry run result (simulated execution)
   */
  private createDryRunResult(tool: ToolDTO, startedAt: number): ToolExecutionResult {
    const completedAt = nowTimestamp();

    return {
      toolId: tool.id,
      toolName: tool.name,
      status: EXECUTION_STATUS.SUCCESS,
      output: { _dryRun: true, _message: 'Dry run - no actual execution' },
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      required: true,
      orderIndex: 0,
    };
  }

  /**
   * Validate a tool can be executed
   */
  private validateTool(
    tool: ToolDTO,
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    startedAt: number
  ): ToolExecutionResult {
    const completedAt = nowTimestamp();
    const errors: string[] = [];

    // Check tool status
    if (tool.status !== 'active') {
      errors.push(`Tool is ${tool.status}, not active`);
    }

    // Check required config based on type
    switch (tool.type) {
      case 'script':
        // Script tools are generally valid if path exists
        break;
      case 'binary':
        // Binary tools need a valid path
        break;
      case 'api':
        if (!config.url) {
          errors.push('API tool requires a URL');
        }
        break;
    }

    // Validate input against inputSchema if present
    if (tool.inputSchema) {
      // Basic schema validation (could be enhanced with actual JSON Schema validation)
      const required = (tool.inputSchema as { required?: string[] }).required || [];
      for (const field of required) {
        if (!(field in input)) {
          errors.push(`Missing required input field: ${field}`);
        }
      }
    }

    if (errors.length > 0) {
      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.FAILED,
        error: errors.join('; '),
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        required: true,
        orderIndex: 0,
      };
    }

    return {
      toolId: tool.id,
      toolName: tool.name,
      status: EXECUTION_STATUS.SUCCESS,
      output: { _validated: true },
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      required: true,
      orderIndex: 0,
    };
  }

  /**
   * Build command-line arguments from a template
   */
  private buildArgs(template: string | undefined, input: Record<string, unknown>): string[] {
    if (!template) return [];

    const substituted = this.substituteTemplate(template, input);
    return substituted.split(/\s+/).filter(Boolean);
  }

  /**
   * Substitute {{placeholders}} in a template string
   */
  private substituteTemplate(template: string, input: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = input[key];
      if (value === undefined || value === null) return '';
      return String(value);
    });
  }

  /**
   * Parse output string to JSON or wrap in object
   */
  private parseOutput(output: string): Record<string, unknown> {
    const trimmed = output.trim();
    if (!trimmed) return {};

    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let invokerInstance: ToolInvoker | null = null;

export function getToolInvoker(): ToolInvoker {
  if (!invokerInstance) {
    invokerInstance = new ToolInvoker();
  }
  return invokerInstance;
}

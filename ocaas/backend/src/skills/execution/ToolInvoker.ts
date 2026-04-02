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
    const method = config.method || 'GET';

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

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      const completedAt = nowTimestamp();
      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.FAILED,
        error: `Invalid URL: "${url}"`,
        output: {
          errorType: 'invalid_url',
          url,
          suggestion: 'Check that the URL is complete and properly formatted (e.g., https://api.example.com/endpoint)',
        },
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        required: true,
        orderIndex: 0,
      };
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
    } else if (method !== 'GET' && method !== 'HEAD') {
      body = JSON.stringify(input);
    }

    logger.debug({
      toolId: tool.id,
      url,
      method,
    }, 'Executing API tool');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: config.followRedirects !== false ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      const completedAt = nowTimestamp();
      const contentType = response.headers.get('content-type') || '';
      const responseType = config.responseType || 'json';

      // Handle non-OK responses with detailed error
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '(could not read response body)');
        const truncatedBody = errorBody.length > 500 ? errorBody.slice(0, 500) + '...' : errorBody;

        // Detect common error patterns
        let errorHint = '';
        if (response.status === 401) {
          errorHint = 'Check authentication credentials (API key, token, etc.)';
        } else if (response.status === 403) {
          errorHint = 'Access forbidden - check permissions or API key scopes';
        } else if (response.status === 404) {
          errorHint = 'Endpoint not found - verify the URL path is correct';
        } else if (response.status === 405) {
          errorHint = `Method ${method} not allowed - check if endpoint supports this HTTP method`;
        } else if (response.status === 429) {
          errorHint = 'Rate limited - too many requests, try again later';
        } else if (response.status >= 500) {
          errorHint = 'Server error - the remote API is having issues';
        }

        return {
          toolId: tool.id,
          toolName: tool.name,
          status: EXECUTION_STATUS.FAILED,
          error: `HTTP ${response.status} ${response.statusText} - ${method} ${parsedUrl.pathname}`,
          output: {
            errorType: 'http_error',
            statusCode: response.status,
            statusText: response.statusText,
            url: url,
            method,
            contentType,
            responseBody: truncatedBody,
            hint: errorHint,
          },
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          required: true,
          orderIndex: 0,
        };
      }

      // Parse response based on expected type with content-type awareness
      let output: Record<string, unknown>;
      const responseText = await response.text();

      // Auto-detect response handling
      if (responseType === 'json' || responseType === undefined) {
        // Check if response looks like JSON
        const isJsonContentType = contentType.includes('application/json');
        const looksLikeJson = responseText.trim().startsWith('{') || responseText.trim().startsWith('[');

        if (!isJsonContentType && !looksLikeJson) {
          // Response is not JSON but we expected JSON
          const truncatedResponse = responseText.length > 300 ? responseText.slice(0, 300) + '...' : responseText;

          // Check for common HTML response (API returning error page)
          if (contentType.includes('text/html') || responseText.trim().startsWith('<!') || responseText.trim().startsWith('<html')) {
            return {
              toolId: tool.id,
              toolName: tool.name,
              status: EXECUTION_STATUS.FAILED,
              error: `Received HTML instead of JSON - endpoint may be incorrect or returning an error page`,
              output: {
                errorType: 'unexpected_content_type',
                expectedType: 'application/json',
                receivedType: contentType || 'text/html',
                url,
                method,
                responsePreview: truncatedResponse,
                hint: 'The URL may be pointing to a web page instead of an API endpoint',
              },
              startedAt,
              completedAt,
              durationMs: completedAt - startedAt,
              required: true,
              orderIndex: 0,
            };
          }

          // Other non-JSON response
          return {
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: `Expected JSON but received ${contentType || 'unknown content type'}`,
            output: {
              errorType: 'unexpected_content_type',
              expectedType: 'application/json',
              receivedType: contentType,
              url,
              method,
              responsePreview: truncatedResponse,
              hint: 'Set responseType to "text" in tool config if this endpoint returns plain text',
            },
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          };
        }

        // Try to parse JSON
        try {
          output = JSON.parse(responseText) as Record<string, unknown>;
        } catch (parseErr) {
          const truncatedResponse = responseText.length > 300 ? responseText.slice(0, 300) + '...' : responseText;
          return {
            toolId: tool.id,
            toolName: tool.name,
            status: EXECUTION_STATUS.FAILED,
            error: `Failed to parse JSON response: ${parseErr instanceof Error ? parseErr.message : 'Invalid JSON'}`,
            output: {
              errorType: 'json_parse_error',
              contentType,
              url,
              method,
              responsePreview: truncatedResponse,
              hint: 'The response claims to be JSON but contains invalid JSON syntax',
            },
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            required: true,
            orderIndex: 0,
          };
        }
      } else if (responseType === 'text') {
        output = { text: responseText };
      } else if (responseType === 'binary') {
        output = { binary: Buffer.from(responseText).toString('base64') };
      } else {
        output = { text: responseText };
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'Error';

      // Build detailed error based on error type
      let errorType = 'unknown';
      let error = errorMessage;
      let hint = '';

      if (errorName === 'AbortError' || errorMessage.includes('abort')) {
        errorType = 'timeout';
        error = `Request timed out after ${timeoutMs}ms`;
        hint = 'The API took too long to respond. Try increasing the timeout or check if the endpoint is slow.';
      } else if (errorMessage.includes('ECONNREFUSED')) {
        errorType = 'connection_refused';
        error = `Connection refused to ${parsedUrl.host}`;
        hint = 'The server is not accepting connections. Check if the host/port is correct and the server is running.';
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        errorType = 'dns_error';
        error = `Could not resolve hostname: ${parsedUrl.hostname}`;
        hint = 'The domain name does not exist or DNS resolution failed. Check the URL for typos.';
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ENETUNREACH')) {
        errorType = 'network_error';
        error = `Network unreachable or connection timed out to ${parsedUrl.host}`;
        hint = 'Check your network connection and firewall settings.';
      } else if (errorMessage.includes('ECONNRESET')) {
        errorType = 'connection_reset';
        error = `Connection was reset by ${parsedUrl.host}`;
        hint = 'The server closed the connection unexpectedly. This might be a server-side issue.';
      } else if (errorMessage.includes('certificate') || errorMessage.includes('SSL') || errorMessage.includes('TLS')) {
        errorType = 'ssl_error';
        error = `SSL/TLS error connecting to ${parsedUrl.host}`;
        hint = 'Certificate validation failed. Check if the server has a valid SSL certificate.';
      } else if (errorMessage.includes('fetch failed') || errorMessage.includes('Failed to fetch')) {
        errorType = 'fetch_failed';
        error = `Failed to connect to ${url}`;
        hint = 'Generic network failure. Check the URL, network connectivity, and CORS settings.';
      }

      logger.error({
        err,
        toolId: tool.id,
        url,
        method,
        errorType,
      }, 'API tool invocation failed');

      return {
        toolId: tool.id,
        toolName: tool.name,
        status: EXECUTION_STATUS.FAILED,
        error,
        output: {
          errorType,
          url,
          method,
          host: parsedUrl.host,
          originalError: errorMessage,
          hint,
        },
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

import { createLogger } from '../utils/logger.js';
import { getGateway } from './gateway.js';
import { getSessionManager } from './session.js';
import { getServices } from '../services/index.js';
import type { ExecResult } from './types.js';

const logger = createLogger('ExecHandler');

export class ExecHandler {
  async executeTool(
    agentId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ExecResult> {
    const sessionManager = getSessionManager();
    const sessionId = sessionManager.getSessionId(agentId);

    if (!sessionId) {
      return {
        success: false,
        error: 'No active session for agent',
      };
    }

    const { toolService, permissionService } = getServices();

    // Get tool and verify it exists
    const tool = await toolService.getByName(toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found`,
      };
    }

    // Check permission
    const hasPermission = await permissionService.check(agentId, 'tool', tool.id, 2); // EXECUTE level
    if (!hasPermission) {
      return {
        success: false,
        error: `Agent lacks permission to execute '${toolName}'`,
      };
    }

    const gateway = getGateway();

    try {
      const result = await gateway.exec({
        sessionId,
        toolName,
        input,
      });

      if (result.success) {
        await toolService.recordExecution(tool.id);
      }

      logger.info({ agentId, toolName, success: result.success }, 'Tool executed');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, agentId, toolName }, 'Tool execution failed');
      return {
        success: false,
        error: message,
      };
    }
  }

  async executeToolDirect(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ExecResult> {
    // For system-level tool execution without agent context
    const gateway = getGateway();

    if (!gateway.isConnected()) {
      logger.warn({ toolName }, 'Gateway not connected, returning simulated result');
      return {
        success: true,
        output: { simulated: true, tool: toolName },
      };
    }

    // Would need a system session for this
    return {
      success: false,
      error: 'Direct tool execution requires gateway connection',
    };
  }
}

let execHandlerInstance: ExecHandler | null = null;

export function getExecHandler(): ExecHandler {
  if (!execHandlerInstance) {
    execHandlerInstance = new ExecHandler();
  }
  return execHandlerInstance;
}

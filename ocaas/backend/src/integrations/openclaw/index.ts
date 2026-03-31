/**
 * OpenClaw Integration Module
 *
 * Punto único de entrada para toda interacción con OpenClaw.
 *
 * USO CORRECTO:
 *   import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
 *   const adapter = getOpenClawAdapter();
 *   const result = await adapter.generate({ ... });
 *
 * USO PROHIBIDO:
 *   import { getGateway } from '../openclaw/gateway.js';  // ❌
 *   const gateway = getGateway();                         // ❌
 *   await gateway.generate({ ... });                      // ❌
 */

export { OpenClawAdapter, getOpenClawAdapter, resetOpenClawAdapter } from './OpenClawAdapter.js';

export type {
  // Error types
  OpenClawErrorCode,
  OpenClawError,

  // Execute Agent
  ExecuteAgentInput,
  ExecuteAgentResult,

  // Generate
  GenerateInput,
  GenerateResult,

  // Notify Channel
  NotifyChannelInput,
  NotifyChannelResult,

  // Send Task
  SendTaskInput,
  SendTaskResult,

  // Execute Tool
  ExecuteToolInput,
  ExecuteToolResult,

  // Status
  StatusResponse,

  // Sessions
  OpenClawSession,
  ListSessionsResult,

  // Test Connection
  TestConnectionResult,
} from './types.js';

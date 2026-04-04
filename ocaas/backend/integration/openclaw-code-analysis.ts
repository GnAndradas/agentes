#!/usr/bin/env npx tsx
/**
 * OpenClaw Code Analysis
 *
 * Análisis estático del código para determinar el modo de integración
 * SIN necesidad de API key o conexión real.
 *
 * EJECUTAR:
 *   cd backend && npx tsx integration/openclaw-code-analysis.ts
 *
 * Este análisis examina el código fuente para determinar:
 * 1. Cómo se generan los session IDs
 * 2. Qué endpoints se usan para enviar mensajes
 * 3. Si hay integración real con sesiones de OpenClaw
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface CodeAnalysisEvidence {
  timestamp: string;
  spawn_creates_local_id: boolean;
  spawn_calls_openclaw_session_endpoint: boolean;
  send_uses_chat_completions: boolean;
  send_uses_session_for_state: boolean;
  list_sessions_requires_websocket: boolean;
  execution_mode_determined: 'real_agent' | 'chat_completion' | 'unknown';
  code_evidence: {
    spawn_session_id_pattern: string;
    send_endpoint: string;
    list_sessions_method: string;
  };
  final_verdict: 'real_integration' | 'degraded_integration' | 'code_confirms_degraded';
}

async function analyzeGatewayCode(): Promise<CodeAnalysisEvidence> {
  const evidence: CodeAnalysisEvidence = {
    timestamp: new Date().toISOString(),
    spawn_creates_local_id: false,
    spawn_calls_openclaw_session_endpoint: false,
    send_uses_chat_completions: false,
    send_uses_session_for_state: false,
    list_sessions_requires_websocket: false,
    execution_mode_determined: 'unknown',
    code_evidence: {
      spawn_session_id_pattern: '',
      send_endpoint: '',
      list_sessions_method: '',
    },
    final_verdict: 'degraded_integration',
  };

  console.log('\n' + '='.repeat(70));
  console.log('OPENCLAW CODE ANALYSIS');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${evidence.timestamp}\n`);

  // Read gateway.ts
  const gatewayPath = path.join(process.cwd(), 'src/openclaw/gateway.ts');
  const gatewayCode = await fs.readFile(gatewayPath, 'utf-8');

  // ========================================================================
  // ANALYSIS 1: spawn() - How is session ID generated?
  // ========================================================================
  console.log('ANALYSIS 1: spawn() - Session ID Generation');
  console.log('-'.repeat(40));

  // Look for the spawn function and session ID pattern
  const spawnMatch = gatewayCode.match(/async spawn\([^)]*\)[^{]*\{[\s\S]*?const sessionId = `([^`]+)`/);
  if (spawnMatch) {
    evidence.code_evidence.spawn_session_id_pattern = spawnMatch[1];
    console.log(`  Pattern Found: ${spawnMatch[1]}`);

    // Check if it's local pattern
    if (spawnMatch[1].includes('ocaas-')) {
      evidence.spawn_creates_local_id = true;
      console.log('  FINDING: Session ID is LOCAL (ocaas-* pattern)');
      console.log('  EVIDENCE: spawn() does NOT call OpenClaw to create session');
    }
  }

  // Check if spawn calls any session creation endpoint
  const spawnSection = gatewayCode.match(/async spawn\([^)]*\)[^{]*\{[\s\S]*?return \{/);
  if (spawnSection) {
    const hasSessionEndpoint = spawnSection[0].includes('/sessions') ||
                               spawnSection[0].includes('createSession') ||
                               spawnSection[0].includes('session.create');
    evidence.spawn_calls_openclaw_session_endpoint = hasSessionEndpoint;
    console.log(`  Calls Session Endpoint: ${hasSessionEndpoint}`);

    if (!hasSessionEndpoint) {
      console.log('  EVIDENCE: No call to OpenClaw session creation API');
    }
  }

  // ========================================================================
  // ANALYSIS 2: send() - How are messages sent?
  // ========================================================================
  console.log('\nANALYSIS 2: send() - Message Transport');
  console.log('-'.repeat(40));

  // Look for send function and what endpoint it uses
  const sendMatch = gatewayCode.match(/async send\([^)]*\)[^{]*\{[\s\S]*?\/v1\/chat\/completions/);
  if (sendMatch) {
    evidence.send_uses_chat_completions = true;
    evidence.code_evidence.send_endpoint = '/v1/chat/completions';
    console.log('  Endpoint: /v1/chat/completions');
    console.log('  FINDING: Uses stateless chat completion API');
  }

  // Check if sessionId is used for anything meaningful in send()
  const sendSection = gatewayCode.match(/async send\([^)]*\)[^{]*\{[\s\S]*?return \{/);
  if (sendSection) {
    // The sessionId parameter exists but is it used?
    const usesSessionForState = sendSection[0].includes('sessionId: options.sessionId') &&
                                !sendSection[0].includes('/v1/chat/completions');
    evidence.send_uses_session_for_state = usesSessionForState;
    console.log(`  Uses Session for State: ${usesSessionForState}`);

    if (!usesSessionForState) {
      console.log('  EVIDENCE: sessionId is NOT used for message routing/state');
    }
  }

  // ========================================================================
  // ANALYSIS 3: listSessions() - How are sessions retrieved?
  // ========================================================================
  console.log('\nANALYSIS 3: listSessions() - Session Discovery');
  console.log('-'.repeat(40));

  const listMatch = gatewayCode.match(/async listSessions\([^)]*\)[^{]*\{[\s\S]*?if \(!this\.wsConnected\)/);
  if (listMatch) {
    evidence.list_sessions_requires_websocket = true;
    evidence.code_evidence.list_sessions_method = 'WebSocket RPC (sessions.list)';
    console.log('  Method: WebSocket RPC (sessions.list)');
    console.log('  Requires: wsConnected = true');
    console.log('  EVIDENCE: Returns empty if WebSocket not connected');
  }

  // ========================================================================
  // ANALYSIS 4: Determine Execution Mode
  // ========================================================================
  console.log('\nANALYSIS 4: Execution Mode Determination');
  console.log('-'.repeat(40));

  if (evidence.spawn_creates_local_id &&
      !evidence.spawn_calls_openclaw_session_endpoint &&
      evidence.send_uses_chat_completions &&
      !evidence.send_uses_session_for_state) {
    evidence.execution_mode_determined = 'chat_completion';
    evidence.final_verdict = 'code_confirms_degraded';
    console.log('  Execution Mode: CHAT_COMPLETION (stateless)');
    console.log('  VERDICT: Code confirms degraded integration');
  } else if (evidence.spawn_calls_openclaw_session_endpoint &&
             evidence.send_uses_session_for_state) {
    evidence.execution_mode_determined = 'real_agent';
    evidence.final_verdict = 'real_integration';
    console.log('  Execution Mode: REAL_AGENT');
  } else {
    evidence.execution_mode_determined = 'unknown';
    console.log('  Execution Mode: Unknown');
  }

  return evidence;
}

function printReport(evidence: CodeAnalysisEvidence): void {
  console.log('\n' + '='.repeat(70));
  console.log('CODE ANALYSIS REPORT');
  console.log('='.repeat(70));

  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│ CODE ANALYSIS EVIDENCE                                              │
├─────────────────────────────────────────────────────────────────────┤
│ spawn_creates_local_id:              ${String(evidence.spawn_creates_local_id).padEnd(32)}│
│ spawn_calls_openclaw_session_endpoint: ${String(evidence.spawn_calls_openclaw_session_endpoint).padEnd(30)}│
│ send_uses_chat_completions:          ${String(evidence.send_uses_chat_completions).padEnd(32)}│
│ send_uses_session_for_state:         ${String(evidence.send_uses_session_for_state).padEnd(32)}│
│ list_sessions_requires_websocket:    ${String(evidence.list_sessions_requires_websocket).padEnd(32)}│
├─────────────────────────────────────────────────────────────────────┤
│ Session ID Pattern: ${evidence.code_evidence.spawn_session_id_pattern.slice(0, 47).padEnd(48)}│
│ Send Endpoint:      ${evidence.code_evidence.send_endpoint.padEnd(48)}│
│ List Method:        ${evidence.code_evidence.list_sessions_method.padEnd(48)}│
├─────────────────────────────────────────────────────────────────────┤
│ EXECUTION MODE:     ${String(evidence.execution_mode_determined.toUpperCase()).padEnd(48)}│
│ FINAL VERDICT:      ${String(evidence.final_verdict.toUpperCase()).padEnd(48)}│
└─────────────────────────────────────────────────────────────────────┘
`);

  console.log('INTERPRETATION:');
  console.log('-'.repeat(70));

  if (evidence.final_verdict === 'code_confirms_degraded') {
    console.log(`
🔴 CODE CONFIRMS DEGRADED INTEGRATION

  The source code analysis proves that:

  1. spawn() creates LOCAL session IDs:
     Pattern: ${evidence.code_evidence.spawn_session_id_pattern}
     This ID is generated by OCAAS, NOT by OpenClaw.

  2. send() uses stateless chat completion:
     Endpoint: ${evidence.code_evidence.send_endpoint}
     The sessionId parameter is NOT used for routing or state.
     Each call is independent - OpenClaw has no context.

  3. listSessions() requires WebSocket RPC:
     If WebSocket is not connected, returns empty array.
     Local "sessions" from spawn() will NEVER appear here.

  CONCLUSION:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OCAAS does NOT have real session integration with OpenClaw.
  All agent execution is via stateless /v1/chat/completions.
  Session IDs are LOCAL identifiers with no server-side state.
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  This is NOT a bug - it's the current architecture.
  The system works, but without real session state.
`);
  } else if (evidence.final_verdict === 'real_integration') {
    console.log(`
🟢 CODE SUGGESTS REAL INTEGRATION

  The source code indicates real session management.
`);
  }

  console.log('='.repeat(70));
}

async function main(): Promise<void> {
  try {
    const evidence = await analyzeGatewayCode();
    printReport(evidence);

    // Write evidence to file
    const evidenceFile = `code-analysis-evidence-${Date.now()}.json`;
    await fs.writeFile(
      path.join(process.cwd(), 'integration', evidenceFile),
      JSON.stringify(evidence, null, 2)
    );
    console.log(`\nEvidence saved to: integration/${evidenceFile}`);

    // Exit code
    if (evidence.final_verdict === 'real_integration') {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(99);
  }
}

main();

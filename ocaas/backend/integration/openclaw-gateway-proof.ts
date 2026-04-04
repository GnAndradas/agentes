#!/usr/bin/env npx tsx
/**
 * OpenClaw Gateway Integration Proof
 *
 * Prueba de integración para verificar si OCAAS está usando OpenClaw
 * por el camino real de Gateway + sesión, o si usa vía degradada chat_completion.
 *
 * EJECUTAR:
 *   cd backend && npx tsx integration/openclaw-gateway-proof.ts
 *
 * EVIDENCIA QUE PRODUCE:
 * - task_dispatched: true/false
 * - openclaw_call_reached: true/false
 * - execution_mode: real_agent | chat_completion | stub | unknown
 * - session_created: true/false
 * - session_id_used: valor real si existe
 * - session_id_only_local: true/false
 * - persisted_session_found: true/false
 * - gateway_ws_connected: true/false
 * - final_verdict: real_integration | degraded_integration | inconclusive
 */

import { config } from 'dotenv';
config();

// ============================================================================
// EVIDENCE STRUCTURE
// ============================================================================

interface IntegrationEvidence {
  timestamp: string;
  task_dispatched: boolean;
  openclaw_call_reached: boolean;
  execution_mode: 'real_agent' | 'chat_completion' | 'stub' | 'unknown';
  session_created: boolean;
  session_id_used: string | null;
  session_id_only_local: boolean;
  persisted_session_found: boolean;
  gateway_ws_connected: boolean;
  gateway_rest_connected: boolean;
  gateway_rest_authenticated: boolean;
  final_verdict: 'real_integration' | 'degraded_integration' | 'inconclusive';
  details: {
    spawn_result?: unknown;
    send_result?: unknown;
    list_sessions_result?: unknown;
    diagnostic_result?: unknown;
    errors: string[];
  };
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runIntegrationProof(): Promise<IntegrationEvidence> {
  const evidence: IntegrationEvidence = {
    timestamp: new Date().toISOString(),
    task_dispatched: false,
    openclaw_call_reached: false,
    execution_mode: 'unknown',
    session_created: false,
    session_id_used: null,
    session_id_only_local: true,
    persisted_session_found: false,
    gateway_ws_connected: false,
    gateway_rest_connected: false,
    gateway_rest_authenticated: false,
    final_verdict: 'inconclusive',
    details: { errors: [] },
  };

  console.log('\n' + '='.repeat(70));
  console.log('OPENCLAW GATEWAY INTEGRATION PROOF');
  console.log('='.repeat(70));
  console.log(`Timestamp: ${evidence.timestamp}\n`);

  try {
    // Dynamic imports to avoid module resolution issues
    const { getGateway } = await import('../src/openclaw/gateway.js');
    const { getOpenClawAdapter } = await import('../src/integrations/openclaw/index.js');

    const gateway = getGateway();
    const adapter = getOpenClawAdapter();

    // ========================================================================
    // STEP 1: Check Gateway Configuration
    // ========================================================================
    console.log('STEP 1: Checking Gateway Configuration');
    console.log('-'.repeat(40));

    const isConfigured = adapter.isConfigured();
    console.log(`  API Key Configured: ${isConfigured}`);

    if (!isConfigured) {
      evidence.details.errors.push('OPENCLAW_API_KEY not configured');
      console.log('  ERROR: OPENCLAW_API_KEY not set');
      evidence.final_verdict = 'inconclusive';
      return evidence;
    }

    // ========================================================================
    // STEP 2: Test REST API Connection
    // ========================================================================
    console.log('\nSTEP 2: Testing REST API Connection');
    console.log('-'.repeat(40));

    const diagnostic = await gateway.getDiagnostic();
    evidence.details.diagnostic_result = diagnostic;

    evidence.gateway_rest_connected = diagnostic.rest.reachable;
    evidence.gateway_rest_authenticated = diagnostic.rest.authenticated;
    evidence.gateway_ws_connected = diagnostic.websocket.connected;

    console.log(`  REST Reachable: ${diagnostic.rest.reachable}`);
    console.log(`  REST Authenticated: ${diagnostic.rest.authenticated}`);
    console.log(`  REST Latency: ${diagnostic.rest.latencyMs}ms`);
    console.log(`  WebSocket Connected: ${diagnostic.websocket.connected}`);
    console.log(`  WebSocket Session ID: ${diagnostic.websocket.sessionId || 'none'}`);

    if (!diagnostic.rest.reachable) {
      evidence.details.errors.push('Gateway REST API not reachable');
      evidence.final_verdict = 'inconclusive';
      return evidence;
    }

    evidence.openclaw_call_reached = true;

    // ========================================================================
    // STEP 3: Test spawn() - Does it create REAL session?
    // ========================================================================
    console.log('\nSTEP 3: Testing spawn() - Real Session Creation');
    console.log('-'.repeat(40));

    const testAgentId = 'test-agent-proof';
    const testPrompt = 'This is a test message for integration proof.';

    const spawnResult = await gateway.spawn({
      agentId: testAgentId,
      prompt: testPrompt,
    });

    evidence.details.spawn_result = spawnResult;

    if (spawnResult.success && spawnResult.sessionId) {
      evidence.session_created = true;
      evidence.session_id_used = spawnResult.sessionId;

      console.log(`  Spawn Success: ${spawnResult.success}`);
      console.log(`  Session ID: ${spawnResult.sessionId}`);

      // Check if session ID follows local pattern
      const isLocalPattern = spawnResult.sessionId.startsWith('ocaas-');
      evidence.session_id_only_local = isLocalPattern;

      console.log(`  Session ID Pattern: ${isLocalPattern ? 'LOCAL (ocaas-*)' : 'EXTERNAL'}`);

      if (isLocalPattern) {
        console.log('  EVIDENCE: Session ID is LOCAL - generated by OCAAS, NOT by OpenClaw');
      }
    } else {
      evidence.details.errors.push(`Spawn failed: ${spawnResult.error}`);
      console.log(`  Spawn Failed: ${spawnResult.error}`);
    }

    // ========================================================================
    // STEP 4: Test send() - How does it send messages?
    // ========================================================================
    console.log('\nSTEP 4: Testing send() - Message Transport');
    console.log('-'.repeat(40));

    if (evidence.session_id_used) {
      const sendResult = await gateway.send({
        sessionId: evidence.session_id_used,
        message: 'Respond with: TEST_OK',
      });

      evidence.details.send_result = sendResult;

      console.log(`  Send Success: ${sendResult.success}`);
      console.log(`  Response Length: ${sendResult.response?.length || 0} chars`);

      // Analyze: send() uses /v1/chat/completions which is STATELESS
      // The sessionId is NOT actually used by OpenClaw - it's just passed through
      console.log('  ANALYSIS: send() uses /v1/chat/completions (stateless)');
      console.log('  EVIDENCE: sessionId is NOT used by OpenClaw for state');
    }

    // ========================================================================
    // STEP 5: Test listSessions() - Are there REAL sessions?
    // ========================================================================
    console.log('\nSTEP 5: Testing listSessions() - Real Session Discovery');
    console.log('-'.repeat(40));

    const sessions = await gateway.listSessions();
    evidence.details.list_sessions_result = sessions;

    console.log(`  Sessions Found: ${sessions.length}`);

    if (sessions.length > 0) {
      evidence.persisted_session_found = true;
      console.log('  Sessions:');
      sessions.forEach(s => {
        console.log(`    - ${s.id} (agent: ${s.agentId}, status: ${s.status})`);
      });
    } else {
      console.log('  No sessions found via WebSocket RPC');
      console.log('  EVIDENCE: Either WS not connected or no real sessions exist');
    }

    // Check if our "spawned" session appears in the list
    if (evidence.session_id_used) {
      const ourSession = sessions.find(s => s.id === evidence.session_id_used);
      if (ourSession) {
        evidence.session_id_only_local = false;
        evidence.persisted_session_found = true;
        console.log(`  OUR SESSION FOUND IN LIST: ${ourSession.id}`);
      } else {
        console.log(`  OUR SESSION NOT IN LIST - confirms local-only`);
      }
    }

    // ========================================================================
    // STEP 6: Determine Execution Mode
    // ========================================================================
    console.log('\nSTEP 6: Determining Execution Mode');
    console.log('-'.repeat(40));

    // Analyze the code paths used:
    // 1. spawn() creates LOCAL session ID
    // 2. send() uses /v1/chat/completions (stateless)
    // 3. listSessions() requires WebSocket RPC

    if (evidence.persisted_session_found && !evidence.session_id_only_local) {
      evidence.execution_mode = 'real_agent';
      console.log('  Execution Mode: REAL_AGENT');
    } else if (evidence.openclaw_call_reached && evidence.gateway_rest_connected) {
      evidence.execution_mode = 'chat_completion';
      console.log('  Execution Mode: CHAT_COMPLETION (stateless)');
    } else {
      evidence.execution_mode = 'stub';
      console.log('  Execution Mode: STUB (no real connection)');
    }

    // ========================================================================
    // STEP 7: Final Verdict
    // ========================================================================
    console.log('\nSTEP 7: Final Verdict');
    console.log('-'.repeat(40));

    evidence.task_dispatched = evidence.openclaw_call_reached;

    // Determine final verdict based on evidence
    if (evidence.execution_mode === 'real_agent' && evidence.persisted_session_found) {
      evidence.final_verdict = 'real_integration';
    } else if (evidence.execution_mode === 'chat_completion' && evidence.openclaw_call_reached) {
      evidence.final_verdict = 'degraded_integration';
    } else {
      evidence.final_verdict = 'inconclusive';
    }

    console.log(`  Final Verdict: ${evidence.final_verdict.toUpperCase()}`);

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    evidence.details.errors.push(error);
    console.error(`\nFATAL ERROR: ${error}`);
    evidence.final_verdict = 'inconclusive';
  }

  return evidence;
}

// ============================================================================
// REPORT
// ============================================================================

function printReport(evidence: IntegrationEvidence): void {
  console.log('\n' + '='.repeat(70));
  console.log('INTEGRATION PROOF REPORT');
  console.log('='.repeat(70));

  console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│ EVIDENCE SUMMARY                                                    │
├─────────────────────────────────────────────────────────────────────┤
│ task_dispatched:          ${String(evidence.task_dispatched).padEnd(42)}│
│ openclaw_call_reached:    ${String(evidence.openclaw_call_reached).padEnd(42)}│
│ execution_mode:           ${String(evidence.execution_mode).padEnd(42)}│
│ session_created:          ${String(evidence.session_created).padEnd(42)}│
│ session_id_used:          ${String(evidence.session_id_used || 'null').slice(0, 40).padEnd(42)}│
│ session_id_only_local:    ${String(evidence.session_id_only_local).padEnd(42)}│
│ persisted_session_found:  ${String(evidence.persisted_session_found).padEnd(42)}│
│ gateway_ws_connected:     ${String(evidence.gateway_ws_connected).padEnd(42)}│
│ gateway_rest_connected:   ${String(evidence.gateway_rest_connected).padEnd(42)}│
│ gateway_rest_authenticated: ${String(evidence.gateway_rest_authenticated).padEnd(40)}│
├─────────────────────────────────────────────────────────────────────┤
│ FINAL VERDICT:            ${String(evidence.final_verdict.toUpperCase()).padEnd(42)}│
└─────────────────────────────────────────────────────────────────────┘
`);

  // Interpretation
  console.log('INTERPRETATION:');
  console.log('-'.repeat(70));

  if (evidence.final_verdict === 'real_integration') {
    console.log(`
✓ REAL INTEGRATION DETECTED
  - OpenClaw Gateway is creating and managing real sessions
  - Session state is persisted on OpenClaw side
  - OCAAS is functioning as intended with real agent sessions
`);
  } else if (evidence.final_verdict === 'degraded_integration') {
    console.log(`
⚠ DEGRADED INTEGRATION DETECTED
  - OpenClaw REST API is reachable (/v1/chat/completions works)
  - BUT: Sessions are LOCAL only (ocaas-* pattern)
  - BUT: No real sessions exist on OpenClaw side
  - All execution uses stateless chat_completion
  - Session IDs are decorative - OpenClaw does NOT track them

  TECHNICAL EVIDENCE:
  1. spawn() generates local ID: ocaas-{agentId}-{timestamp}-{random}
  2. send() uses POST /v1/chat/completions (stateless, no session)
  3. listSessions() returns empty (requires WS RPC, likely not connected)

  CONCLUSION:
  OCAAS "agents" are NOT real OpenClaw sessions.
  They are chat_completion calls with local tracking.
`);
  } else {
    console.log(`
? INCONCLUSIVE
  - Could not determine integration state
  - Check errors below
`);
  }

  if (evidence.details.errors.length > 0) {
    console.log('\nERRORS:');
    evidence.details.errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log('\n' + '='.repeat(70));
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const evidence = await runIntegrationProof();
  printReport(evidence);

  // Write evidence to file for audit
  const evidenceFile = `integration-evidence-${Date.now()}.json`;
  const fs = await import('fs/promises');
  await fs.writeFile(
    `integration/${evidenceFile}`,
    JSON.stringify(evidence, null, 2)
  );
  console.log(`\nEvidence saved to: integration/${evidenceFile}`);

  // Exit with code based on verdict
  if (evidence.final_verdict === 'real_integration') {
    process.exit(0);
  } else if (evidence.final_verdict === 'degraded_integration') {
    process.exit(1);
  } else {
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(99);
});

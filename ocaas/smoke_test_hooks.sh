#!/usr/bin/env bash
#
# PROMPT 12: Smoke test for hooks/gateway integration
#
# Validates:
# 1. Required environment variables
# 2. Backend health
# 3. Gateway connectivity
# 4. Task creation with proper FSM
#
# Usage: ./smoke_test_hooks.sh
#

set -euo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================

API_BASE="${API_BASE:-http://localhost:3001}"
ERRORS=0

echo "════════════════════════════════════════════════════════════"
echo "🧪 OCAAS Hooks Smoke Test"
echo "════════════════════════════════════════════════════════════"
echo ""

# =============================================================================
# STEP 1: ENVIRONMENT VALIDATION
# =============================================================================

echo "🔍 Step 1: Environment validation"
echo ""

# Check OPENCLAW_GATEWAY_URL
if [ -z "${OPENCLAW_GATEWAY_URL:-}" ]; then
  echo "   ⚠️  OPENCLAW_GATEWAY_URL not set"
else
  echo "   ✅ OPENCLAW_GATEWAY_URL: ${OPENCLAW_GATEWAY_URL}"
fi

# Check OPENCLAW_HOOKS_TOKEN (critical for hooks)
if [ -z "${OPENCLAW_HOOKS_TOKEN:-}" ]; then
  echo "   ❌ OPENCLAW_HOOKS_TOKEN not set - REQUIRED for hooks execution"
  echo "      Without this, tasks will fallback to chat_completion or stub mode"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✅ OPENCLAW_HOOKS_TOKEN: [SET]"
fi

# Check OPENCLAW_API_KEY (for REST/fallback)
if [ -z "${OPENCLAW_API_KEY:-}" ]; then
  echo "   ⚠️  OPENCLAW_API_KEY not set - fallback to chat_completion won't work"
else
  echo "   ✅ OPENCLAW_API_KEY: [SET]"
fi

echo ""

# =============================================================================
# STEP 2: BACKEND HEALTH
# =============================================================================

echo "🔍 Step 2: Backend health"
echo ""

if curl -sf "${API_BASE}/health" > /dev/null 2>&1; then
  echo "   ✅ Backend reachable at ${API_BASE}"
else
  echo "   ❌ Backend not reachable at ${API_BASE}/health"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# =============================================================================
# STEP 3: GATEWAY STATUS
# =============================================================================

echo "🔍 Step 3: Gateway status"
echo ""

GATEWAY_RESPONSE=$(curl -sS "${API_BASE}/api/system/gateway" 2>/dev/null || echo '{"error":"unreachable"}')
GATEWAY_CONNECTED=$(echo "$GATEWAY_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('connected', False))" 2>/dev/null || echo "false")

if [ "$GATEWAY_CONNECTED" = "True" ] || [ "$GATEWAY_CONNECTED" = "true" ]; then
  echo "   ✅ Gateway connected"
else
  echo "   ⚠️  Gateway not connected"
  echo "      Response: $GATEWAY_RESPONSE"
fi

echo ""

# =============================================================================
# STEP 4: DIAGNOSTICS
# =============================================================================

echo "🔍 Step 4: System diagnostics"
echo ""

DIAG_RESPONSE=$(curl -sS "${API_BASE}/api/system/diagnostics" 2>/dev/null || echo '{"error":"unreachable"}')
DIAG_STATUS=$(echo "$DIAG_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('status', 'unknown'))" 2>/dev/null || echo "unknown")
DIAG_SCORE=$(echo "$DIAG_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('score', 0))" 2>/dev/null || echo "0")

echo "   Status: ${DIAG_STATUS}"
echo "   Score:  ${DIAG_SCORE}"

echo ""

# =============================================================================
# STEP 5: TASK FSM TEST
# =============================================================================

echo "🔍 Step 5: Task FSM test (create → queue)"
echo ""

# Create task
CREATE_RESPONSE=$(curl -sS -X POST "${API_BASE}/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "[SMOKE TEST] Hooks validation",
    "description": "Smoke test for hooks integration",
    "type": "internal",
    "priority": 1,
    "metadata": { "smokeTest": true }
  }' 2>/dev/null || echo '{"error":"create failed"}')

TASK_ID=$(echo "$CREATE_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('id',''))" 2>/dev/null || echo "")

if [ -z "$TASK_ID" ]; then
  echo "   ❌ Task creation failed"
  echo "      Response: $CREATE_RESPONSE"
  ERRORS=$((ERRORS + 1))
else
  echo "   ✅ Task created: ${TASK_ID}"

  # Queue task
  QUEUE_RESPONSE=$(curl -sS -X POST "${API_BASE}/api/tasks/${TASK_ID}/queue" \
    -H "Content-Type: application/json" 2>/dev/null || echo '{"error":"queue failed"}')

  QUEUE_STATUS=$(echo "$QUEUE_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('status',''))" 2>/dev/null || echo "")

  if [ "$QUEUE_STATUS" = "queued" ]; then
    echo "   ✅ Task queued (FSM: pending → queued OK)"
  else
    echo "   ⚠️  Queue status: ${QUEUE_STATUS:-unknown}"
  fi
fi

echo ""

# =============================================================================
# SUMMARY
# =============================================================================

echo "════════════════════════════════════════════════════════════"

if [ "$ERRORS" -eq 0 ]; then
  echo "✅ Smoke test PASSED"
  echo ""
  echo "Ready for hooks execution. If OPENCLAW_HOOKS_TOKEN is set,"
  echo "tasks will use hooks_session mode."
  exit 0
else
  echo "❌ Smoke test FAILED (${ERRORS} errors)"
  echo ""
  echo "Fix the errors above before running hooks tests."
  exit 1
fi

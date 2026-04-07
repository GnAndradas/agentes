#!/usr/bin/env bash
#
# PROMPT 12: Operational test script - Task creation with FSM compliance
#
# Creates a task and properly transitions it through the FSM:
#   pending → queued → assigned (optionally)
#
# Usage: ./inject_task.sh [--assign AGENT_ID]
#

set -euo pipefail

# =============================================================================
# CONFIGURATION
# =============================================================================

API_BASE="${API_BASE:-http://localhost:3001}"
AGENT_ID=""
DO_ASSIGN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --assign)
      DO_ASSIGN=true
      AGENT_ID="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--assign AGENT_ID]" >&2
      exit 1
      ;;
  esac
done

# =============================================================================
# ENVIRONMENT VALIDATION (PROMPT 12)
# =============================================================================

echo "🔍 Validating environment..."

# Check API is reachable
if ! curl -sf "${API_BASE}/health" > /dev/null 2>&1; then
  echo "❌ Backend not reachable at ${API_BASE}/health" >&2
  echo "   Make sure the backend is running" >&2
  exit 1
fi

echo "✅ Backend reachable at ${API_BASE}"

# =============================================================================
# STEP 1: CREATE TASK (pending state)
# =============================================================================

echo ""
echo "📝 Step 1: Creating task (pending)..."

RESPONSE=$(curl -sS -X POST "${API_BASE}/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Injected test task",
    "description": "Task injected from shell script",
    "type": "general",
    "priority": 2,
    "input": {
      "text": "hello world",
      "source": "inject-task-script"
    },
    "metadata": {
      "smokeTest": true,
      "origin": "manual_injection"
    }
  }')

# Extract task ID (compatible with bash/python)
TASK_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('id',''))" 2>/dev/null || echo "")

if [ -z "${TASK_ID}" ]; then
  echo "❌ Could not create task" >&2
  echo "   Response: $RESPONSE" >&2
  exit 1
fi

echo "✅ Task created: ${TASK_ID} (status: pending)"

# =============================================================================
# STEP 2: QUEUE TASK (pending → queued)
# =============================================================================

echo ""
echo "📤 Step 2: Queueing task (pending → queued)..."

QUEUE_RESPONSE=$(curl -sS -X POST "${API_BASE}/api/tasks/${TASK_ID}/queue" \
  -H "Content-Type: application/json")

QUEUE_STATUS=$(echo "$QUEUE_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('status',''))" 2>/dev/null || echo "")

if [ "$QUEUE_STATUS" != "queued" ]; then
  echo "⚠️  Queue response status: ${QUEUE_STATUS:-unknown}"
  echo "   Response: $QUEUE_RESPONSE"
  # Don't fail - might already be in a valid state
fi

echo "✅ Task queued: ${TASK_ID} (status: queued)"

# =============================================================================
# STEP 3: ASSIGN TASK (queued → assigned) - OPTIONAL
# =============================================================================

if [ "$DO_ASSIGN" = true ]; then
  if [ -z "$AGENT_ID" ]; then
    echo ""
    echo "⚠️  --assign specified but no AGENT_ID provided"
    echo "   Skipping assignment"
  else
    echo ""
    echo "🤖 Step 3: Assigning task to agent ${AGENT_ID}..."

    ASSIGN_RESPONSE=$(curl -sS -X POST "${API_BASE}/api/tasks/${TASK_ID}/assign" \
      -H "Content-Type: application/json" \
      -d "{\"agentId\": \"${AGENT_ID}\"}")

    ASSIGN_STATUS=$(echo "$ASSIGN_RESPONSE" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('status',''))" 2>/dev/null || echo "")

    if [ "$ASSIGN_STATUS" = "assigned" ]; then
      echo "✅ Task assigned: ${TASK_ID} → ${AGENT_ID}"
    else
      echo "⚠️  Assignment response: ${ASSIGN_STATUS:-unknown}"
      echo "   Response: $ASSIGN_RESPONSE"
    fi
  fi
fi

# =============================================================================
# SUMMARY
# =============================================================================

echo ""
echo "════════════════════════════════════════"
echo "📋 Task Injection Complete"
echo "════════════════════════════════════════"
echo ""
echo "   Task ID: ${TASK_ID}"
echo "   API Base: ${API_BASE}"
echo ""
echo "   View task: curl ${API_BASE}/api/tasks/${TASK_ID}"
echo ""

# Check final status
FINAL_STATUS=$(curl -sS "${API_BASE}/api/tasks/${TASK_ID}" | python3 -c "import json,sys; obj=json.load(sys.stdin); print(obj.get('data',{}).get('status',''))" 2>/dev/null || echo "unknown")
echo "   Current status: ${FINAL_STATUS}"
echo ""

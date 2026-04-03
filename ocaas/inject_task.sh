#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"

echo "Injecting task into OCAAS at ${API_BASE} ..."

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

echo "Create response:"
echo "$RESPONSE"

TASK_ID=$(python3 - <<'PY' "$RESPONSE"
import json, sys
try:
    obj = json.loads(sys.argv[1])
    print(obj.get("data", {}).get("id", ""))
except Exception:
    print("")
PY
)

if [ -z "${TASK_ID}" ]; then
  echo "Could not extract task id from response."
  exit 1
fi

echo
echo "Task created with id: ${TASK_ID}"
echo "Polling current task state..."

sleep 1

curl -sS "${API_BASE}/api/tasks/${TASK_ID}"
echo
echo
echo "Useful follow-ups:"
echo "  curl -sS ${API_BASE}/api/tasks"
echo "  curl -sS ${API_BASE}/api/tasks/${TASK_ID}"
echo "  curl -sS -X POST ${API_BASE}/api/tasks/${TASK_ID}/retry"

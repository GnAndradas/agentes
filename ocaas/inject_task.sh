#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"

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
  echo "Error: Could not create task" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "Task created: ${TASK_ID}"

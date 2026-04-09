# Progress Tracker Hook

type: event
version: 1.0.0

## Events

events:
  - message:received
  - message:preprocessed
  - message:sent
  - agent:bootstrap
  - session:patch
  - tool:call
  - tool:result

## Description

Passive observability hook for OCAAS integration.
Logs runtime events to `runs/<sessionKey>.jsonl` for external consumption.

**IMPORTANT**: This hook is READ-ONLY / PASSIVE:
- Does NOT modify any data
- Does NOT intercept messages
- Does NOT alter agent behavior
- ONLY writes log entries

## Output Format

Each line in the JSONL file:
```json
{
  "timestamp": 1704067200000,
  "sessionKey": "hook:ocaas:task-abc123",
  "event": "message:received",
  "stage": "receiving",
  "summary": "User message received",
  "source": "openclaw-hook"
}
```

## Installation

Copy to OpenClaw hooks directory:
```bash
cp -r progress-tracker ~/.openclaw/hooks/
```

## Notes

- Does NOT track tools_used or skills_used (no structured confirmation available)
- Does NOT infer anything from message content
- Only logs what OpenClaw explicitly emits as events

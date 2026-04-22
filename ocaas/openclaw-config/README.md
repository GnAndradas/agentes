# OpenClaw Intent Router Configuration

This directory contains the configuration files for the Intent Router integration between OpenClaw and OCAAS.

## Components

### Tools
- `tools/ocaas-router.json` - HTTP tool to call OCAAS intake endpoint

### Skills
- `skills/intent-classifier.json` - Intent classification skill

### Agents
- `agents/intent-router.json` - Router agent configuration
- `agents/intent-router-prompt.md` - System prompt for the router

## Installation

### 1. Set Environment Variables

In your OpenClaw environment or `.env`:

```bash
OCAAS_API_URL=http://localhost:3001
OCAAS_API_KEY=your-api-secret-key
```

### 2. Copy Files to OpenClaw Workspace

```bash
# Copy tool definition
cp tools/ocaas-router.json ~/.openclaw/workspace/tools/

# Copy skill definition
cp skills/intent-classifier.json ~/.openclaw/workspace/skills/

# Copy agent definition and prompt
cp agents/intent-router.json ~/.openclaw/workspace/agents/
cp agents/intent-router-prompt.md ~/.openclaw/workspace/agents/
```

### 3. Register the Agent

Using OpenClaw CLI:
```bash
openclaw agent register intent-router
openclaw agent activate intent-router
```

Or via API:
```bash
curl -X POST http://localhost:18789/hooks/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENCLAW_HOOKS_TOKEN" \
  -d '{"action": "register", "agent": "intent-router"}'
```

## Usage

### Direct Invocation

```bash
curl -X POST http://localhost:18789/hooks/wake \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENCLAW_HOOKS_TOKEN" \
  -d '{
    "agent": "intent-router",
    "message": "Deploy the frontend to production",
    "context": {
      "source": "api",
      "user_id": "user123",
      "conversation_id": "conv456",
      "message_id": "msg789"
    }
  }'
```

### From Telegram Integration

Configure Telegram webhook to route messages through intent-router:

```json
{
  "telegram": {
    "default_agent": "intent-router",
    "route_all_messages": true
  }
}
```

## Intent Classification

The router classifies messages into three categories:

| Intent | Description | Action |
|--------|-------------|--------|
| `consult` | Information request | Provide answer, no task |
| `task` | Action request | Create task in OCAAS |
| `ambiguous` | Unclear intent | Ask clarification |

## Response Flow

```
User Message
    ↓
OpenClaw (intent-router agent)
    ↓
Classify intent (consult/task/ambiguous)
    ↓
Call ocaas_router tool
    ↓
POST /api/intake/router
    ↓
OCAAS processes:
  - consult → acknowledge
  - task → create task
  - ambiguous → return clarification question
    ↓
Response to user
```

## Troubleshooting

### Tool not found
Ensure `ocaas-router.json` is in the correct tools directory and variables are set.

### Connection refused
Check that OCAAS backend is running and OCAAS_API_URL is correct.

### Authorization failed
Verify OCAAS_API_KEY matches API_SECRET_KEY in OCAAS.

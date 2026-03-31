# Configuración OCAAS + OpenClaw

## Configuración verificada que funciona:

### 1. OpenClaw Gateway (`~/.openclaw/openclaw.json`):
```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "b0c2f3f2f423882302b56ce7af5d3de06bc94afe5feacc0f"
    },
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  },
  "hooks": {
    "enabled": true,
    "token": "a700f104da444733582c71090d8d9b8b1875ea11e169ab85e9471f16207c6e83",
    "path": "/hooks",
    "allowedAgentIds": ["main", "generator"],
    "defaultSessionKey": "ocaas-api",
    "allowRequestSessionKey": false
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "deepseek/deepseek-chat"
      },
      "workspace": "/home/guille/.openclaw/workspace"
    }
  },
  "tools": {
    "profile": "coding"
  }
}
```

### 2. OCAAS Environment (`backend/.env`):
```
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_WORKSPACE_PATH=/home/guille/.openclaw/workspace
OPENCLAW_API_KEY=b0c2f3f2f423882302b56ce7af5d3de06bc94afe5feacc0f
```

### 3. Workspace OpenClaw:
- Eliminar `BOOTSTRAP.md` si existe
- Actualizar `IDENTITY.md` y `USER.md` básicos

## Métodos de integración verificados:

### ✅ API REST (síncrono):
```bash
curl -X POST http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer b0c2f3f2f423882302b56ce7af5d3de06bc94afe5feacc0f" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Prompt"}], "model": "openclaw"}'
```

### ✅ Webhooks (asíncrono):
```bash
curl -X POST http://localhost:18789/hooks/agent \
  -H "x-openclaw-token: a700f104da444733582c71090d8d9b8b1875ea11e169ab85e9471f16207c6e83" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Prompt",
    "agentId": "main",
    "deliver": false,
    "wakeMode": "now"
  }'
```

## Problemas identificados:

1. **Webhooks son asíncronos** - devuelven `runId`, no respuesta
2. **Respuestas van al canal sistema** - no a OCAAS directamente
3. **Necesita sistema de polling** no implementado

## Soluciones posibles:

1. **Log monitoring** - leer `/tmp/openclaw/openclaw-*.log`
2. **Telegram bridge** - OpenClaw → Telegram → OCAAS
3. **Plugin custom** - desarrollar canal OCAAS-OpenClaw

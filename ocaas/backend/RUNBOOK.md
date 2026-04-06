# OCAAS x OpenClaw Runbook Operativo

## Indice
1. [Estado Actual del Sistema](#estado-actual-del-sistema)
2. [Arquitectura](#arquitectura)
3. [Flujo Real de Ejecucion](#flujo-real-de-ejecucion)
4. [Modos de Ejecucion](#modos-de-ejecucion)
5. [Fallback Logic](#fallback-logic)
6. [Endpoints de Diagnostico](#endpoints-de-diagnostico)
7. [Escenarios de Operacion](#escenarios-de-operacion)
8. [Troubleshooting](#troubleshooting)
9. [Gaps Conocidos](#gaps-conocidos)
10. [Comandos Utiles](#comandos-utiles)

---

## Estado Actual del Sistema

```
EXECUTION MODES (ordenados por prioridad):

1. hooks_session   - PRIMARY: /hooks/agent con sessionKey (stateful)
                     Requiere: OPENCLAW_HOOKS_TOKEN configurado

2. chat_completion - FALLBACK: /v1/chat/completions (stateless)
                     Requiere: OPENCLAW_API_KEY configurado

3. stub            - EMERGENCY: Sin OpenClaw, respuesta simulada
                     Activo cuando: nada configurado/conectado

NOTA: Los agentes NO son sesiones reales de OpenClaw.
      El runtime_ready siempre es false actualmente.
      Skills/Tools se escriben pero OpenClaw no los lee.
```

---

## Arquitectura

### Componentes Principales

```
+-----------------+    +-----------------+    +-----------------+
|    INTAKE       |--->|    DECISION     |--->|   EXECUTION     |
| (TaskIntake)    |    | (DecisionEngine)|    | (JobDispatcher) |
+-----------------+    +-----------------+    +-----------------+
                              |
                              v (si no hay recursos)
                       +-----------------+
                       |   GENERATION    |
                       | (AgentGenerator)|
                       +-----------------+
                              |
                              v
                       +-----------------+
                       |    APPROVAL     |
                       | (Workflow FSM)  |
                       +-----------------+
                              |
                              v
                       +-----------------+
                       | MATERIALIZATION |
                       | (AgentMaterial) |
                       +-----------------+
```

### Componentes Clave

| Componente | Archivo | Rol |
|------------|---------|-----|
| JobDispatcherService | `src/execution/JobDispatcherService.ts` | Orquesta ejecucion |
| ExecutionTraceability | `src/execution/ExecutionTraceability.ts` | Traza modos reales |
| GenerationTraceService | `src/execution/GenerationTraceService.ts` | Traza AI generation |
| OpenClawAdapter | `src/integrations/openclaw/OpenClawAdapter.ts` | HTTP/WS a gateway |
| DiagnosticService | `src/services/DiagnosticService.ts` | Diagnosticos |
| TaskStateManager | `src/execution/TaskStateManager/` | Estado de ejecucion |

---

## Flujo Real de Ejecucion

### Cadena de Prioridad

```
Task llega
    |
    v
JobDispatcher.executeJob()
    |
    v
detectExecutionMode()
    |
    +---> hooksConfigured? --YES--> hooks_session (/hooks/agent)
    |           |
    |           NO
    |           |
    +---> gatewayConnected? --YES--> chat_completion (/v1/chat/completions)
    |           |
    |           NO
    |           |
    +---> stub (respuesta simulada)
```

### Flujo hooks_session (PRIMARY)

```
1. JobDispatcher detecta OPENCLAW_HOOKS_TOKEN configurado
2. Crea sessionKey: "hook:ocaas:task-{taskId}"
3. POST /hooks/agent con:
   - sessionKey
   - messages[]
   - agentId
4. Respuesta procesada
5. GenerationTrace guardado con execution_mode='hooks_session'
```

### Flujo chat_completion (FALLBACK)

```
1. hooks no configurados O hooks fallan
2. POST /v1/chat/completions con:
   - model
   - messages[]
3. Respuesta procesada
4. GenerationTrace guardado con execution_mode='chat_completion'
```

---

## Modos de Ejecucion

| Modo | Transport | Condicion | Estado |
|------|-----------|-----------|--------|
| `hooks_session` | `hooks_agent` | OPENCLAW_HOOKS_TOKEN set | PRIMARY |
| `chat_completion` | `rest_api` | OPENCLAW_API_KEY set | FALLBACK |
| `stub` | `none` | Nada conectado | EMERGENCY |
| `real_agent` | `websocket_rpc` | Sesion OpenClaw real | NO IMPLEMENTADO |

### Deteccion de Modo

```typescript
// En ExecutionTraceability.ts
export function detectExecutionMode(
  gatewayConfigured: boolean,
  gatewayConnected: boolean,
  wsConnected: boolean,
  hooksConfigured: boolean
): ExecutionModeInfo {
  // Priority: hooks_session > chat_completion > stub
  if (hooksConfigured && gatewayConnected) return 'hooks_session';
  if (gatewayConnected) return 'chat_completion';
  return 'stub';
}
```

---

## Fallback Logic

### Niveles de Fallback

```
NIVEL 1: hooks_session falla
         -> Reintenta con chat_completion
         -> GenerationTrace.fallback_used = true
         -> GenerationTrace.fallback_reason = 'hooks_failed'

NIVEL 2: chat_completion falla
         -> Usa stub response
         -> GenerationTrace.ai_succeeded = false

NIVEL 3: Todo falla
         -> Job status = 'failed'
         -> Error registrado en diagnostics
```

### Razones de Fallback

| Razon | Descripcion |
|-------|-------------|
| `ai_not_configured` | No hay API key |
| `ai_not_available` | Servicio no responde |
| `ai_request_failed` | Error en request |
| `ai_parse_error` | Respuesta no parseable |
| `hooks_failed` | hooks_session fallo, usando chat_completion |
| `user_requested_template` | Usuario pidio template |

---

## Endpoints de Diagnostico

### GET /api/tasks/:id/diagnostics

Diagnostico completo de una task.

```json
{
  "data": {
    "task_id": "task-abc123",
    "task": { "title": "...", "status": "completed" },
    "timeline": {
      "created_at": 1712345678000,
      "execution_started_at": 1712345678500,
      "execution_completed_at": 1712345679000,
      "total_duration_ms": 1100
    },
    "execution": {
      "execution_mode": "hooks_session",
      "transport": "hooks_agent",
      "runtime_ready_at_execution": false,
      "transport_success": true
    },
    "ai_usage": {
      "ai_used": true,
      "fallback_used": false
    },
    "gaps": [],
    "warnings": ["Agent not runtime_ready - using hooks_session"]
  }
}
```

### GET /api/tasks/:id/generation-trace

Traza de generacion AI.

```json
{
  "data": {
    "execution_mode": "hooks_session",
    "ai_requested": true,
    "ai_attempted": true,
    "ai_succeeded": true,
    "fallback_used": false,
    "raw_output": "...",
    "final_output": "...",
    "duration_ms": 1200
  }
}
```

### GET /api/tasks/:id/timeline

Timeline simplificado.

### GET /api/tasks/:id/state

Estado de ejecucion con tool tracking.

---

## Escenarios de Operacion

### Escenario 1: hooks_session Funciona

```
Input -> Decision -> Execution (hooks_session) -> Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'hooks_session'`
- `execution.transport = 'hooks_agent'`
- `ai_usage.fallback_used = false`

### Escenario 2: hooks Falla, chat_completion Funciona

```
Input -> Decision -> Execution (hooks fails) -> Fallback (chat_completion) -> Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'chat_completion'`
- `execution.transport = 'rest_api'`
- `ai_usage.fallback_used = true`
- `ai_usage.fallback_reasons = ['hooks_failed']`

### Escenario 3: Todo Falla, Stub

```
Input -> Decision -> Execution (all fail) -> Stub Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'stub'`
- `execution.transport = 'none'`
- `warnings` incluye error info

---

## Troubleshooting

### Task no se ejecuta

1. Verificar status:
```bash
curl http://localhost:3001/api/tasks/{id}
```

2. Verificar diagnostico:
```bash
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq
```

3. Revisar gaps y warnings

### hooks_session no funciona

1. Verificar OPENCLAW_HOOKS_TOKEN en .env
2. Verificar gateway conectado:
```bash
curl http://localhost:3001/api/system/diagnostics | jq '.openclaw'
```

3. Revisar logs:
```bash
LOG_LEVEL=debug npm run dev
```

### chat_completion no funciona

1. Verificar OPENCLAW_API_KEY en .env
2. Verificar endpoint responde:
```bash
curl http://localhost:18789/v1/chat/completions -X POST -H "Content-Type: application/json" -d '{"model":"test","messages":[{"role":"user","content":"test"}]}'
```

---

## Materialization

### Auto-Materialization

Agents are automatically materialized on activation:
```
AgentBootstrap.ensureDefaultAgent()
  -> agentService.activate(id)
    -> materializeIfNeeded(agent)
      -> materializeAgent(name, type, ...)
```

Creates workspace files:
- `agents/<name>/agent.json` - Configuration
- `agents/<name>/system-prompt.md` - System prompt

### Manual Materialization

```bash
POST /api/agents/:id/materialize
```

Returns `MaterializationTraceability` with:
- `steps_attempted`, `steps_completed`, `steps_failed`
- `final_state`: record | activated | materialized | runtime_ready
- `gap`: explanation if not fully materialized

---

## Gaps Conocidos

### Gap 1: Skills/Tools No Usados

```
Estado: Skills y tools se escriben al workspace pero OpenClaw NO los lee.
Impacto: Los recursos generados son decorativos.
```

### Gap 2: Agentes No Son "Reales"

```
Estado: Todos los agentes usan hooks_session o chat_completion.
        No hay sesiones OpenClaw reales.
Impacto: runtime_ready siempre es false.
```

### Gap 3: Workspace Sin Conexion

```
Estado: Agent workspace se crea pero OpenClaw no lo carga.
Impacto: agent.json y system-prompt.md no se usan.
```

---

## Comandos Utiles

### Verificar Estado

```bash
# Health
curl http://localhost:3001/health

# Gateway status
curl http://localhost:3001/api/system/diagnostics | jq '.openclaw'

# Listar tasks
curl http://localhost:3001/api/tasks

# Listar jobs activos
curl http://localhost:3001/api/jobs/active
```

### Diagnostico de Task

```bash
# Completo
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq

# Generation trace
curl http://localhost:3001/api/tasks/{id}/generation-trace | jq

# Timeline
curl http://localhost:3001/api/tasks/{id}/timeline | jq

# Estado con tools
curl http://localhost:3001/api/tasks/{id}/state | jq
```

### Crear Task de Prueba

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"test task","type":"general","priority":2}'
```

---

## Variables de Entorno

```bash
# Requeridas
PORT=3001
OPENCLAW_GATEWAY_URL=http://localhost:18789
API_SECRET_KEY=<min-16-chars>

# Para hooks_session (PRIMARY)
OPENCLAW_HOOKS_TOKEN=<token>

# Para chat_completion (FALLBACK)
OPENCLAW_API_KEY=<key>

# Opcionales
AUTONOMY_LEVEL=supervised
LOG_LEVEL=info
```

---

*Actualizado: 2026-04-06*

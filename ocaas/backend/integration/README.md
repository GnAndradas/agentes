# OpenClaw Gateway Integration Proof

## Propósito

Verificar si OCAAS está usando OpenClaw por el camino **real** de Gateway + sesión,
o si sigue usando la vía **degradada** de chat_completion stateless.

## Pruebas Disponibles

### 1. Code Analysis (Sin API Key) - RECOMENDADO

Analiza el código fuente para determinar el modo de integración.
**No requiere conexión ni API key.**

```bash
cd backend
npx tsx integration/openclaw-code-analysis.ts
```

Exit codes:
- 0: real_integration
- 1: code_confirms_degraded (estado actual)

### 2. Gateway Proof (Requiere API Key)

Prueba de integración real contra OpenClaw Gateway.

```bash
cd backend
npx tsx integration/openclaw-gateway-proof.ts
```

Exit codes:
- 0: real_integration
- 1: degraded_integration
- 2: inconclusive

## Prerequisitos

### Para Code Analysis
- Solo requiere que el código exista en `src/openclaw/gateway.ts`

### Para Gateway Proof
1. Backend compilado: `npm run build`
2. Variables de entorno configuradas en `.env`:
   - `OPENCLAW_GATEWAY_URL` (default: http://localhost:3030)
   - `OPENCLAW_API_KEY` (requerido)
   - `OPENCLAW_WS_URL` (opcional, para WebSocket RPC)

## Qué Salida Esperar

### Caso 1: REAL_INTEGRATION (Exit code 0)

```
FINAL VERDICT: REAL_INTEGRATION

✓ REAL INTEGRATION DETECTED
  - OpenClaw Gateway is creating and managing real sessions
  - Session state is persisted on OpenClaw side
```

Esto significa que OCAAS está creando sesiones reales en OpenClaw.

### Caso 2: DEGRADED_INTEGRATION (Exit code 1)

```
FINAL VERDICT: DEGRADED_INTEGRATION

⚠ DEGRADED INTEGRATION DETECTED
  - OpenClaw REST API is reachable (/v1/chat/completions works)
  - BUT: Sessions are LOCAL only (ocaas-* pattern)
  - BUT: No real sessions exist on OpenClaw side
```

Esto significa que OCAAS está usando chat_completion stateless.
Los "agentes" no son sesiones reales de OpenClaw.

### Caso 3: INCONCLUSIVE (Exit code 2)

```
FINAL VERDICT: INCONCLUSIVE

? INCONCLUSIVE
  - Could not determine integration state
```

Esto significa que no se pudo conectar o hubo errores.

## Evidencia Producida

La prueba produce un archivo JSON con evidencia completa:

```
integration/integration-evidence-{timestamp}.json
```

### Campos de Evidencia

| Campo | Descripción |
|-------|-------------|
| `task_dispatched` | Si se envió algo a OpenClaw |
| `openclaw_call_reached` | Si OpenClaw respondió |
| `execution_mode` | `real_agent` \| `chat_completion` \| `stub` \| `unknown` |
| `session_created` | Si spawn() retornó session ID |
| `session_id_used` | El session ID retornado |
| `session_id_only_local` | Si el ID es patrón local `ocaas-*` |
| `persisted_session_found` | Si la sesión existe en OpenClaw |
| `gateway_ws_connected` | Si WebSocket RPC está conectado |
| `final_verdict` | `real_integration` \| `degraded_integration` \| `inconclusive` |

## Interpretación PASS / FAIL / INCONCLUSIVE

### PASS (real_integration)

- `session_id_only_local = false`
- `persisted_session_found = true`
- `execution_mode = real_agent`

### FAIL (degraded_integration)

- `session_id_only_local = true`
- `persisted_session_found = false`
- `execution_mode = chat_completion`

**Esto NO es un error de código** - es el estado actual del sistema.
OCAAS funciona vía chat_completion, no vía sesiones reales.

### INCONCLUSIVE

- Errores de conexión
- API key no configurada
- Gateway no disponible

## Análisis Técnico del Estado Actual

Basado en auditoría del código:

1. **gateway.spawn()** (líneas 1171-1209):
   - Genera session ID **LOCAL**: `ocaas-${agentId}-${timestamp}-${random}`
   - NO llama a ningún endpoint de OpenClaw para crear sesión real
   - Solo envía webhook opcional de notificación

2. **gateway.send()** (líneas 1216-1250):
   - Usa `POST /v1/chat/completions`
   - Es **stateless** - no usa el sessionId
   - OpenClaw NO sabe qué sesión es

3. **gateway.listSessions()** (líneas 1317-1336):
   - Requiere WebSocket RPC conectado
   - Si WS no está conectado, retorna `[]`
   - Las sesiones "locales" de spawn() NO aparecen aquí

## Conclusión Esperada

Con el código actual, la prueba debería producir:

```
FINAL VERDICT: DEGRADED_INTEGRATION
execution_mode: chat_completion
session_id_only_local: true
persisted_session_found: false
```

Esto confirma que OCAAS **NO tiene integración real con sesiones de OpenClaw**.
Toda ejecución es vía `/v1/chat/completions` stateless.

---

## ACTUALIZACIÓN: Hooks Session Migration

Con la migración a hooks_session:

### Nuevo Modo Principal: hooks_session

Si `OPENCLAW_HOOKS_TOKEN` está configurado:
- OCAAS usa `/hooks/agent` con `sessionKey` estable
- Session keys: `hook:ocaas:task-{taskId}` o `hook:ocaas:job-{jobId}`
- Estado de sesión persiste en OpenClaw

### Fallback: chat_completion

Si hooks no están configurados o fallan:
- OCAAS usa `/v1/chat/completions` (stateless)
- Comportamiento legacy preservado

### Variables de Entorno Requeridas

```bash
# Para hooks_session (recomendado)
OPENCLAW_HOOKS_TOKEN=your-hooks-token

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://localhost:3030
OPENCLAW_API_KEY=your-api-key
```

### Verificar Modo de Ejecución

```bash
# En diagnóstico de task
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.execution_summary'

# Debe mostrar:
# execution_mode: "hooks_session" (si hooks funcionan)
# execution_mode: "chat_completion" (si fallback)
# session_key: "hook:ocaas:task-{id}" (si hooks)
# outcome: "completed_sync" | "accepted_async" | "failed"
```

### Modelo Asíncrono (hooks_session)

hooks_session usa `/hooks/agent` que es fire-and-forget:

| Campo | Valor hooks_session | Valor chat_completion |
|-------|--------------------|-----------------------|
| `execution_mode` | `hooks_session` | `chat_completion` |
| `outcome` | `accepted_async` | `completed_sync` |
| `response_received` | `false` (async) | `true` (sync) |
| `job_status` | `accepted` | `completed` |

**IMPORTANTE**: `accepted` NO es un error. Significa que el hook aceptó el job
y la respuesta vendrá vía canal (Telegram, etc.)

### Estados de Job

| Estado | Significado |
|--------|-------------|
| `pending` | En cola |
| `running` | Ejecutando |
| `accepted` | **NUEVO**: Aceptado por hooks_session, esperando respuesta async |
| `completed` | Terminado con éxito (respuesta recibida) |
| `failed` | Error |
| `blocked` | Bloqueado por recurso faltante |

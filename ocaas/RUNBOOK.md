# OCAAS x OpenClaw Runbook Operativo

## Indice
1. [Estado Actual del Sistema](#estado-actual-del-sistema)
2. [Arquitectura](#arquitectura)
3. [Flujo Real de Ejecucion](#flujo-real-de-ejecucion)
4. [Modos de Ejecucion](#modos-de-ejecucion)
5. [Fallback Logic](#fallback-logic)
6. [OpenClaw Integration](#openclaw-integration) [NEW]
7. [Agent Runtime Bootstrap](#agent-runtime-bootstrap) [NEW]
8. [Systemic Generator (Bundles)](#systemic-generator-bundles) [NEW]
9. [Enriched Tasks](#enriched-tasks) [NEW]
10. [Traceability](#traceability) [UPDATED]
11. [Endpoints de Diagnostico](#endpoints-de-diagnostico)
12. [Escenarios de Operacion](#escenarios-de-operacion)
13. [Troubleshooting](#troubleshooting)
14. [Materialization](#materialization)
15. [Gaps Conocidos](#gaps-conocidos)
16. [Comandos Utiles](#comandos-utiles)
17. [Variables de Entorno](#variables-de-entorno)
18. [Operational Validation Checklist](#operational-validation-checklist) [NEW]
19. [Intent Router (OpenClaw ↔ OCAAS)](#intent-router-openclaw--ocaas) [NEW]

---

## Estado Actual del Sistema

```
EXECUTION MODES (ordenados por prioridad):

1. hooks_session   - PRIMARY: /hooks/agent con sessionKey (stateful)
                     Requiere:
                     - OPENCLAW_HOOKS_TOKEN configurado en OCAAS
                     - hooks.enabled=true en OpenClaw
                     - hooks.allowRequestSessionKey=true si OCAAS envia sessionKey por request
                     - hooks.allowedSessionKeyPrefixes incluyendo "hook:"

2. chat_completion - FALLBACK: /v1/chat/completions (stateless)
                     Requiere:
                     - OPENCLAW_API_KEY configurado en OCAAS
                     - gateway.http.endpoints.chatCompletions.enabled=true en OpenClaw

3. stub            - EMERGENCY: Sin OpenClaw, respuesta simulada
                     Activo cuando: nada configurado/conectado

NOTA: Los agentes NO son sesiones reales de OpenClaw.
      El runtime_ready siempre es false actualmente.
      Skills/Tools se escriben pero OpenClaw no los lee.

IMPORTANTE (hallazgo operativo real):
- Tener hooks.token NO activa /hooks/agent por si solo.
- Si hooks.enabled no es true, /hooks/agent responde 404.
- Si chatCompletions.enabled no es true, /v1/chat/completions responde 404.
```

---

## Arquitectura

### Componentes Principales

```
+-----------------+    +-----------------+    +-----------------+
|    INTAKE       |--->|    DECISION     |--->|   EXECUTION     |
| (TaskIntake)    |    | (DecisionEngine)|    | (JobDispatcher) |
+-----------------+    +-----------------+    +-----------------+
                              |                      |
                              |                      +---> [NEW] ensureAgentReady (warmup)
                              |                      |
                              v (si no hay recursos) v
                       +-----------------+    +-----------------+
                       |   GENERATION    |    | OpenClaw Gateway|
                       | (AgentGenerator)|    | (hooks/chat/stub|
                       +-----------------+    +-----------------+
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
| JobDispatcherService | `src/execution/JobDispatcherService.ts` | Orquesta ejecucion + warmup |
| ExecutionTraceability | `src/execution/ExecutionTraceability.ts` | Traza modos reales |
| GenerationTraceService | `src/execution/GenerationTraceService.ts` | Traza AI generation |
| OpenClawAdapter | `src/integrations/openclaw/OpenClawAdapter.ts` | HTTP/WS a gateway + warmup |
| DiagnosticService | `src/services/DiagnosticService.ts` | Diagnosticos |
| TaskStateManager | `src/execution/TaskStateManager/` | Estado de ejecucion |
| SystemicGeneratorService | `src/generator/SystemicGeneratorService.ts` | [NEW] Bundle generation |
| TaskService | `src/services/TaskService.ts` | [UPDATED] Enriched tasks |

---

## Flujo Real de Ejecucion

### Cadena de Prioridad [UPDATED]

```
Task llega
    |
    v
JobDispatcher.executeJob()
    |
    +---> [NEW] ensureAgentReady(agentId) - Warmup ping
    |           |
    |           +--> ready=true: proceed
    |           +--> ready=false: log warning, proceed anyway
    |
    v
detectExecutionMode()
    |
    +---> hooksConfigured? --YES--> hooks_session (/hooks/agent)
    |           |                        |
    |           |                        +--> immediate response: DONE
    |           |                        |
    |           |                        +--> accepted_async? [NEW]
    |           |                                  |
    |           |                                  +--> wait timeout
    |           |                                  |
    |           |                                  +--> fallback to chat_completion
    |           NO
    |           |
    +---> gatewayConnected? --YES--> chat_completion (/v1/chat/completions)
    |           |
    |           NO
    |           |
    +---> stub (respuesta simulada)
```

### [NEW] accepted_async Handling

```
accepted_async = hooks acepto el request PERO no hay respuesta inmediata

IMPORTANTE: accepted_async NO es fallo

Casos:
- CASE A: Timeout pero respuesta llega -> completado
- CASE B: Timeout, fallback a chat_completion -> respuesta via REST
- CASE C: Timeout, fallback falla -> error
- CASE D: Timeout, no fallback disponible -> stub mode
```

### Flujo hooks_session (PRIMARY)

```
1. JobDispatcher detecta OPENCLAW_HOOKS_TOKEN configurado
2. [NEW] ensureAgentReady(agentId) - warmup ping
3. Crea sessionKey: "hook:ocaas:task-{taskId}"
4. POST /hooks/agent con:
   - sessionKey
   - message (prompt)
   - agentId
   - name
   - wakeMode: 'now'
   - deliver: false
5. Respuesta procesada (o accepted_async -> timeout -> fallback)
6. GenerationTrace guardado con execution_mode final
```

### Flujo chat_completion (FALLBACK)

```
1. hooks no configurados O hooks fallan O accepted_async timeout
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
NIVEL 1: hooks_session falla o accepted_async timeout
         -> Reintenta con chat_completion
         -> GenerationTrace.fallback_used = true
         -> GenerationTrace.fallback_reason = 'hooks_failed' | 'async_timeout'

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
| `async_timeout` | [NEW] accepted_async pero timeout sin respuesta |
| `user_requested_template` | Usuario pidio template |

---

## [NEW] OpenClaw Integration

### Chat Completions Endpoint Configuration

**Required configuration in OpenClaw:**

Edit `~/.openclaw/openclaw.json` to enable Chat Completions:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

**Critical:** If `chatCompletions.enabled` is false, `/v1/chat/completions` returns 404.
- El campo "model" debe ser un target de OpenClaw (ej: "openclaw/default"), no un modelo directo de proveedor.

### Token Synchronization [CRITICAL]

**Tokens son 2, separados, no intercambiables:**

| Token | Config OpenClaw | Env OCAAS | Header | Usado para |
|-------|-----------------|-----------|--------|------------|
| REST (gateway) | `gateway.auth.token` | `OPENCLAW_API_KEY` | `Authorization: Bearer` | `/v1/chat/completions`, `/v1/models` |
| Hooks | `hooks.token` | `OPENCLAW_HOOKS_TOKEN` | `x-openclaw-token` | `/hooks/agent`, `/hooks/wake` |

**Step 1: Obtener tokens de OpenClaw**
```bash
# REST token
openclaw config get gateway.token

# Hooks token (leer de archivo)
cat ~/.openclaw/openclaw.json | jq '.hooks.token'
# O buscar manualmente en ~/.openclaw/openclaw.json -> "hooks": { "token": "..." }
```

**Step 2: Configurar en backend/.env**
```env
OPENCLAW_API_KEY=<gateway_token_from_step_1>
OPENCLAW_HOOKS_TOKEN=<hooks_token_from_step_1>
```

### Configuracion minima real en `~/.openclaw/openclaw.json`

Para que OCAAS funcione con el flujo actual del runbook, OpenClaw debe tener como minimo:

```json
{
  "gateway": {
    "auth": {
      "token": "<GATEWAY_TOKEN>"
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
    "token": "<HOOKS_TOKEN>",
    "allowRequestSessionKey": true,
    "allowedSessionKeyPrefixes": ["hook:"],
    "defaultSessionKey": "hook:ingress"
  }
}
```

### Explicacion de cada campo necesario

- `hooks.enabled=true`
  - sin esto, `/hooks/agent` devuelve 404 aunque `hooks.token` exista.
- `hooks.token`
  - token de auth para `/hooks/agent` y `/hooks/wake`.
- `hooks.allowRequestSessionKey=true`
  - necesario porque OCAAS envia `sessionKey` en el payload.
- `hooks.allowedSessionKeyPrefixes=["hook:"]`
  - obligatorio para acotar los session keys aceptados cuando se habilita request routing.
- `hooks.defaultSessionKey="hook:ingress"`
  - no sustituye el sessionKey dinamico de OCAAS, pero deja una ruta por defecto segura.
- `gateway.http.endpoints.chatCompletions.enabled=true`
  - necesario para el fallback REST de OCAAS.

### Valores reales usados durante esta puesta en marcha

- `gateway.auth.token` -> se replica en `OPENCLAW_API_KEY`
- `hooks.token` -> se replica en `OPENCLAW_HOOKS_TOKEN`
- ambos tokens deben ser distintos

**REGLAS:**
- OpenClaw es la fuente de verdad - OCAAS replica los tokens
- Los tokens DEBEN coincidir exactamente
- Si regeneras un token en OpenClaw, actualiza INMEDIATAMENTE en OCAAS
- NO hay fallback automatico de uno al otro

**Token usage locations in OCAAS:**
- `src/config/env.ts` - Environment variable definition
- `src/openclaw/gateway.ts` - Bearer token for REST API calls
- `src/integrations/openclaw/OpenClawAdapter.ts` - HTTP client authentication

### Payload for /hooks/agent

```json
{
  "message": "task prompt here",
  "agentId": "agent-123",
  "sessionKey": "hook:ocaas:task-abc123",
  "name": "OCAAS Agent agent-123",
  "wakeMode": "now",
  "deliver": false
}
```

### sessionKey Convention

```
hook:ocaas:task-{taskId}          - Para tasks
hook:ocaas:job-{jobId}            - Para jobs directos
hook:ocaas:warmup:{agentId}:{ts}  - Para warmup pings
hook:ocaas:manual-{id}            - Para ejecuciones manuales
```

**sessionKey es ROUTING, no AUTH.** El auth es via header.

### Response Handling

```typescript
interface HooksResult {
  success: boolean;
  accepted?: boolean;      // true = request accepted (may not have response yet)
  response?: string;       // AI response (if immediate)
  error?: string;
  executionMode: 'hooks_session' | 'chat_completion' | 'stub';
}
```

---

## [NEW] Agent Runtime Bootstrap

### ensureAgentReady()

Ubicacion: `OpenClawAdapter.ts`

```typescript
async ensureAgentReady(agentId: string): Promise<{ ready: boolean; error?: string }>
```

**Comportamiento:**
1. Genera sessionKey: `hook:ocaas:warmup:{agentId}:{timestamp}`
2. Envia `message: "ping"` via hooks
3. Interpreta resultado:
   - request enviado sin error -> `ready = true`
   - error de red/gateway -> `ready = false`

**NO espera respuesta de AI. NO hace polling. NO hace retry loops.**

### Integration Point

```typescript
// In JobDispatcherService.executeJob()
const warmupResult = await adapter.ensureAgentReady(payload.agent.agentId);
traceBuilder.warmup(warmupResult.ready);

if (!warmupResult.ready) {
  logger.warn({ jobId, agentId, warmupError: warmupResult.error },
    'Agent warmup failed, proceeding with execution');
}
// Continues with executeViaHooks() regardless
```

### Limitation: materialized ≠ runtime_ready

```
Agent materialized:
  - Tiene agent.json en workspace
  - Tiene system-prompt.md
  - Record en DB

Agent runtime_ready:
  - Tiene sesion activa en OpenClaw
  - Puede recibir mensajes
  - ACTUALMENTE: siempre false (no session management real)
```

---

## [NEW] Systemic Generator (Bundles)

### Bundle Flow

```
SystemicGeneratorService.generateBundle(input)
  |
  v
STEP 1: Generate TOOL
  |      - metadata: { bundleId, bundleStatus: 'partial' }
  v
STEP 2: Generate SKILL (references tool)
  |      - metadata: { bundleId, bundleStatus: 'partial' }
  v
STEP 3: Generate AGENT (references skill)
  |      - metadata: { bundleId, bundleStatus: 'partial' }
  v
STEP 4: Approve + Activate all (in order)
  |
  v
STEP 5: Link resources
  |      - skillService.addTool(skillId, toolId)
  |      - skillService.assignToAgent(skillId, agentId)
  v
STEP 6: Update metadata
         - All generations: bundleStatus = 'complete'
         - Cross-references: bundleToolId, bundleSkillId, bundleAgentId
```

### BundleInput

```typescript
interface BundleInput {
  name: string;           // Base name for all resources
  description: string;    // Shared description
  objective: string;      // What the bundle should accomplish
  capabilities?: string[]; // Optional agent capabilities
}
```

### BundleOutput

```typescript
interface BundleOutput {
  success: boolean;
  bundleId?: string;           // "bundle_abc123xyz"
  bundleStatus?: 'partial' | 'complete';
  toolGenerationId?: string;
  skillGenerationId?: string;
  agentGenerationId?: string;
  toolId?: string;
  skillId?: string;
  agentId?: string;
  metadata: { ... };
  error?: string;
}
```

### bundleStatus Rules

| Status | Meaning | Action |
|--------|---------|--------|
| `partial` | Bundle en progreso o fallo parcial | Check error, may have orphaned resources |
| `complete` | Todos los pasos exitosos | Bundle usable |

### [NEW] PROMPT 13: Bundle Guard

Agents from incomplete bundles are **blocked from execution** in `JobDispatcherService.executeJob()`:

```typescript
await agentService.validateForExecution(agentId);
// Throws ForbiddenError if bundleStatus !== 'complete'
```

Error response:
```json
{
  "status": "failed",
  "error": {
    "code": "agent_bundle_incomplete",
    "message": "Agent bundle incomplete - cannot execute",
    "retryable": false
  }
}
```

### Usage

```typescript
import { getSystemicGenerator } from './generator/index.js';

const generator = getSystemicGenerator();
const result = await generator.generateBundle({
  name: 'my-feature',
  description: 'Feature description',
  objective: 'What it should accomplish',
  capabilities: ['code', 'analysis']
});

if (result.bundleStatus !== 'complete') {
  console.error('Bundle failed:', result.error);
}
```

---

## [NEW] Enriched Tasks

### New Fields

| Field | Type | Max Length | Description |
|-------|------|------------|-------------|
| `objective` | string | 2000 | What should be accomplished |
| `constraints` | string | 2000 | Limitations or requirements |
| `details` | string/JSON | - | Additional context or data |
| `expectedOutput` | string | 2000 | Expected output format |

Todos opcionales. Backward compatible.

### Storage in task.input

```json
{
  "text": "Task title",
  "context": {
    "description": "Task description",
    "objective": "What should be accomplished",
    "constraints": "Any limitations",
    "details": "Additional context or JSON",
    "expectedOutput": "Expected format"
  }
}
```

### Prompt Generation

`JobDispatcherService.buildPrompt()` generates:

```markdown
## Goal
Task title

## Description
Task description

## Objective
What should be accomplished

## Task Constraints
Any limitations

## Details
Additional context

## Expected Output
Expected format

## System Constraints
- Autonomy: supervised
- Max tool calls: 20
```

### API Example

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Generate report",
    "type": "report",
    "priority": 2,
    "objective": "Produce Q1 sales PDF",
    "constraints": "Max 5 minutes, no PII",
    "details": "Data source: sales_db",
    "expectedOutput": "PDF at /reports/q1.pdf"
  }'
```

---

## [UPDATED] Traceability

### ExecutionTraceability Fields

| Field | Type | Description |
|-------|------|-------------|
| `execution_mode` | string | FINAL mode: `hooks_session|chat_completion|stub` |
| `transport` | string | `hooks_agent|rest_api|none` |
| `transport_success` | bool | Request enviado exitosamente |
| `accepted_async` | bool | [NEW] hooks acepto pero sin respuesta inmediata |
| `async_timeout_triggered` | bool | [NEW] Timeout alcanzado en modo async |
| `async_timeout_ms` | number | [NEW] Timeout value |
| `agent_warmup_attempted` | bool | [NEW] Se intento warmup |
| `agent_warmup_success` | bool | [NEW] Warmup exitoso |
| `execution_fallback_used` | bool | Se uso fallback |
| `execution_fallback_reason` | string | Razon del fallback |
| `response_received` | bool | Se recibio respuesta |
| `response_tokens` | object | `{input, output}` token counts |

### Final vs Initial State

```
IMPORTANTE: execution_mode FINAL puede diferir del INICIAL

Escenario:
1. Intento hooks_session -> accepted_async
2. Timeout -> fallback a chat_completion
3. chat_completion responde

Traceability FINAL:
- execution_mode: 'chat_completion' (NO 'hooks_session')
- accepted_async: true (hubo async inicial)
- execution_fallback_used: true
- execution_fallback_reason: 'async_timeout'
```

### Cost/Tokens

```
Costos se calculan sobre la RESPUESTA FINAL, no intentos intermedios.

Si accepted_async timeout -> fallback -> respuesta:
  - tokens = de respuesta del fallback
  - cost = calculado sobre fallback response
```

### Trace Builder

```typescript
const traceBuilder = createExecutionTraceability(agentId);
traceBuilder
  .warmup(warmupResult.ready)           // [NEW]
  .mode('hooks_session', 'hooks_agent')
  .sessionKey(sessionKey)
  .transportSuccess(result.success)
  .acceptedAsync()                       // [NEW] if applicable
  .asyncTimeout(timeoutMs)               // [NEW] if applicable
  .fallbackUsed('async_timeout')
  .responseReceived(tokens)
  .completed();

const trace = traceBuilder.build();
```

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
      "transport_success": true,
      "agent_warmup_attempted": true,
      "agent_warmup_success": true
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

Traza de generacion AI. [UPDATED]

```json
{
  "data": {
    "execution_mode": "hooks_session",
    "ai_requested": true,
    "ai_attempted": true,
    "ai_succeeded": true,
    "fallback_used": false,
    "accepted_async": false,
    "agent_warmup_attempted": true,
    "agent_warmup_success": true,
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
Input -> Decision -> Warmup OK -> Execution (hooks_session) -> Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'hooks_session'`
- `execution.transport = 'hooks_agent'`
- `execution.agent_warmup_success = true`
- `ai_usage.fallback_used = false`

### Escenario 2: hooks Falla, chat_completion Funciona

```
Input -> Decision -> Warmup OK -> Execution (hooks fails) -> Fallback (chat_completion) -> Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'chat_completion'`
- `execution.transport = 'rest_api'`
- `ai_usage.fallback_used = true`
- `ai_usage.fallback_reasons = ['hooks_failed']`

### [NEW] Escenario 3: accepted_async Timeout -> Fallback

```
Input -> Decision -> Warmup OK -> hooks_session (accepted_async) -> Timeout -> chat_completion -> Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'chat_completion'` (FINAL)
- `execution.accepted_async = true`
- `execution.async_timeout_triggered = true`
- `ai_usage.fallback_used = true`
- `ai_usage.fallback_reasons = ['async_timeout']`

### Escenario 4: Todo Falla, Stub

```
Input -> Decision -> Warmup FAIL -> Execution (all fail) -> Stub Response
```

**Diagnostico esperado:**
- `execution.execution_mode = 'stub'`
- `execution.transport = 'none'`
- `execution.agent_warmup_success = false`
- `warnings` incluye error info

---

## [CRITICAL] Pre-Arranque Backend

### Regla de Arranque

**CORRECTO:**
```bash
cd ocaas/backend
npm run dev
```

**INCORRECTO (NO USAR):**
```bash
cd ocaas
tsx src/index.ts
# o
node dist/index.js
```

**Por qué:** Arrancar desde raíz no carga `.env` correcto. Provoca "Hooks not configured" y fallback a stub.

### Pre-check Puerto 3001

**OBLIGATORIO antes de levantar backend:**

Linux/Mac:
```bash
lsof -i :3001 || ss -ltnp | grep :3001 || echo "PORT_3001_FREE"
```

Windows:
```bash
netstat -ano | findstr :3001
```

**Si ocupado, matar proceso:**
```bash
# Linux/Mac
kill <PID>

# Windows
taskkill /PID <PID> /F
```

**Regla:** NO arrancar backend hasta que puerto 3001 esté libre.

---

## [CRITICAL] Instalaciones Previas

Si ya tenías OCAAS instalado, verificar antes de arrancar:

### Checklist

1. **Tokens desalineados**
   ```bash
   # Verificar token actual de OpenClaw
   openclaw config get gateway.token
   cat ~/.openclaw/openclaw.json | jq '.hooks.token'

   # Comparar con backend/.env
   grep OPENCLAW backend/.env
   ```

2. **Procesos huérfanos**
   ```bash
   # Buscar node/tsx colgados
   ps aux | grep -E "node|tsx" | grep -v grep

   # Windows
   tasklist | findstr node
   ```

3. **Puerto ocupado**
   ```bash
   lsof -i :3001
   ```

### Fix rápido

```bash
# 1. Matar procesos en 3001
pkill -f "node.*3001" || true

# 2. Re-sincronizar tokens
openclaw config get gateway.token
# Copiar a backend/.env -> OPENCLAW_API_KEY

cat ~/.openclaw/openclaw.json | jq -r '.hooks.token'
# Copiar a backend/.env -> OPENCLAW_HOOKS_TOKEN

# 3. Reiniciar
cd ocaas/backend && npm run dev
```

---

## [CRITICAL] Startup Sequence (STRICT)

### Orden obligatorio

1. **Verificar puerto 3001 libre**
   ```bash
   lsof -i :3001 || echo "PORT_3001_FREE"
   ```

2. **Arrancar backend**
   ```bash
   cd ocaas/backend
   npm run dev
   ```

3. **Verificar backend**
   ```bash
   curl localhost:3001/health
   curl -s localhost:3001/api/system/gateway | jq
   ```

   Esperado:
   - `/health` → OK
   - `rest.reachable` = true
   - `rest.authenticated` = true
   - `hooks.configured` = true

4. **Arrancar frontend**
   ```bash
   cd ocaas/frontend
   npm run dev
   ```

   Abrir: http://localhost:5173/

### Diagnostics Interpretation (Gateway)

| Campo | Valor esperado | Significado |
|-------|----------------|-------------|
| `rest.reachable` | `true` | Gateway HTTP accesible |
| `rest.authenticated` | `true` | Token REST válido |
| `hooks.configured` | `true` | Token hooks cargado |
| `hooks.probed` | `false` | Normal - no testea por defecto |
| `websocket.connected` | `false` | Opcional - no bloquea |

**Interpretación frontend:**
- "Hooks not configured" = **REAL** solo si `hooks.configured=false`
- "Accepted: No/timeout" = **NO crítico** si REST funciona

---

## [CRITICAL] Final Rule

Si ocurre CUALQUIERA de estas condiciones:
- Backend arrancado desde carpeta incorrecta
- Puerto 3001 ocupado
- Tokens desalineados

**Entonces:**
El sistema puede aparentar funcionar pero hooks y ejecución **NO funcionarán** correctamente.

---

## [CRITICAL] Clean Redeploy (macOS)

Antes de reiniciar OCAAS, **SIEMPRE** ejecutar:

### 1. Verificar puertos ocupados

```bash
# Puertos canónicos
lsof -i :3001  # OCAAS backend
lsof -i :5173  # OCAAS frontend
lsof -i :18789 # OpenClaw gateway
```

### 2. Matar procesos viejos

```bash
# Matar node/tsx en puertos OCAAS
pkill -f "node.*3001" || true
pkill -f "node.*5173" || true

# Alternativa por PID
kill -9 $(lsof -t -i:3001) 2>/dev/null || true
kill -9 $(lsof -t -i:5173) 2>/dev/null || true
```

### 3. Reiniciar en puertos canónicos

```bash
# Backend (debe ser SIEMPRE puerto 3001)
cd ocaas/backend && npm run dev

# Frontend (debe ser SIEMPRE puerto 5173)
cd ocaas/frontend && npm run dev
```

**IMPORTANTE:** Si el puerto está ocupado por otra instancia, npm iniciará en puerto alternativo (3002, 5174). Esto **ROMPE** la integración con OpenClaw porque los hooks están configurados para puertos específicos.

---

## [CRITICAL] Hooks.Accepted Semantics

### Lo que "Accepted: No" significa

`Accepted: No` **NO significa fallo**. Significa que OpenClaw decidió NO usar hooks_session para esta invocación específica.

### Escenarios válidos con Accepted=No

| Configured | Reached | Accepted | AI Response | Resultado |
|------------|---------|----------|-------------|-----------|
| Yes | Yes | **No** | Yes | ✅ **VÁLIDO** - OpenClaw usó chat_completion |
| Yes | Yes | Yes | Yes | ✅ VÁLIDO - OpenClaw usó hooks_session |
| No | No | No | Yes | ✅ VÁLIDO - Sin hooks, chat directo |
| Yes | No | - | No | ❌ FALLO - Gateway no alcanzable |

### Interpretación correcta

```
hooks.configured = true   → Token hooks cargado en backend
hooks.reached = true      → Gateway respondió al POST /hooks/agent
hooks.accepted = false    → Gateway decidió NO usar hooks (normal)
ai_response = presente    → Hay respuesta de IA (éxito)
```

**REGLA:** Solo hay fallo real si:
1. `hooks.configured=false` cuando debería estar configurado
2. `hooks.reached=false` cuando gateway debería responder
3. `ai_response` está vacío/ausente cuando se esperaba respuesta

---

## [CRITICAL] Deploy Validation Check

Después de cada deploy, validar en este orden:

### 1. Health checks básicos

```bash
# Backend health
curl -s localhost:3001/health
# Esperado: {"status":"ok",...}

# Gateway status
curl -s localhost:3001/api/system/gateway | jq
# Esperado: rest.reachable=true, rest.authenticated=true, hooks.configured=true
```

### 2. Crear task de prueba

```bash
curl -X POST localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test deploy validation","type":"general"}'
```

### 3. Verificar job/trace/completion

```bash
# Obtener task ID del paso anterior
TASK_ID="<id-del-paso-anterior>"

# Verificar diagnostics
curl -s "localhost:3001/api/tasks/$TASK_ID/diagnostics" | jq

# Campos a verificar:
# - traceability.hook_ingress_success (true si hooks configurados)
# - traceability.final_execution_path (hook_runtime|chat_fallback|stub)
# - execution.ai_model_used (modelo usado)
```

### Checklist de validación

- [ ] `/health` responde OK
- [ ] `/api/system/gateway` muestra `rest.reachable=true`
- [ ] Task de prueba se crea correctamente
- [ ] Task se ejecuta (pasa a running → completed)
- [ ] Diagnostics muestra traceability completo
- [ ] No hay errores en logs del backend

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
curl http://localhost:18789/v1/chat/completions -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $OPENCLAW_API_KEY" -d '{"model":"openclaw/default","messages":[{"role":"user","content":"test"}]}'
```
3. Si devuelve 404, verificar configuración en `~/.openclaw/openclaw.json`

### [NEW] Common Error Patterns

**"Transport failed" in async context:**
```
NO es un error real si accepted_async=true.
hooks_session acepto el request, solo no hubo respuesta inmediata.
El fallback chain manejara la ejecucion.
```

**"Bundle partial":**
```
Un paso del bundle fallo. Revisar:
- result.error para el mensaje
- result.metadata para ver que pasos completaron
- Puede haber recursos huerfanos (tool sin skill, etc)
```

**"Agent not ready":**
```
Warmup fallo pero ejecucion continua.
NO bloquea el flujo.
Fallback chain manejara cualquier error real.
```

### [NEW] Failure Symptoms

**404 on /v1/chat/completions**
- Cause: Chat Completions endpoint not enabled in OpenClaw
- Fix: Edit `~/.openclaw/openclaw.json` and set `gateway.http.endpoints.chatCompletions.enabled = true`

**Auth / provider / fallback errors**
- Cause: Token mismatch or incorrect configuration
- Fix: Verify `OPENCLAW_API_KEY` matches `openclaw config get gateway.token`

**OCAAS stuck in fallback mode**
- Cause: Token synchronization issue or gateway configuration problem
- Fix: Re-sync token from OpenClaw to OCAAS, verify gateway configuration

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

### Diagnóstico de Gateway [EXPLICADO]

```bash
curl localhost:3001/api/system/diagnostics | jq '.openclaw'
```

**Interpretación de respuesta:**

| Campo | Valor esperado | Significado |
|-------|----------------|-------------|
| `rest.reachable` | `true` | Gateway HTTP accesible |
| `rest.authenticated` | `true` | `OPENCLAW_API_KEY` válido |
| `hooks.configured` | `true` | `OPENCLAW_HOOKS_TOKEN` cargado |
| `hooks.probed` | `false` | Normal - no testea por defecto |
| `websocket.connected` | `false` | Opcional - no afecta operación |

**Si `hooks.configured = false`:**
- Verificar `OPENCLAW_HOOKS_TOKEN` en `backend/.env`
- Verificar que arrancaste desde `backend/` (no raíz)

**Si `rest.authenticated = false`:**
- Token no coincide con OpenClaw
- Ejecutar: `openclaw config get gateway.token`
- Actualizar `OPENCLAW_API_KEY` en `backend/.env`

### Verificar Conexión Gateway

```bash
curl localhost:3001/api/system/gateway | jq
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

# Debug summary (nuevo)
curl http://localhost:3001/api/tasks/{id}/debug-summary | jq

# Execution timeline unificado (nuevo)
curl http://localhost:3001/api/tasks/{id}/execution-timeline | jq
```

### [NEW] Crear Task Enriquecida

```bash
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Generate report",
    "type": "report",
    "priority": 2,
    "objective": "Produce Q1 sales PDF",
    "constraints": "Max 5 minutes, no PII",
    "details": "Data source: sales_db",
    "expectedOutput": "PDF at /reports/q1.pdf"
  }'
```

---

## Variables de Entorno

### Ejemplo completo de backend/.env

```env
# === REQUERIDAS ===
PORT=3001
HOST=0.0.0.0
DATABASE_URL=./data/ocaas.db
API_SECRET_KEY=<MIN_16_CARACTERES>

# === OPENCLAW CONNECTION ===
OPENCLAW_GATEWAY_URL=http://localhost:18789

# REST token (de: openclaw config get gateway.token)
OPENCLAW_API_KEY=<GATEWAY_TOKEN>

# Hooks token (de: ~/.openclaw/openclaw.json -> hooks.token)
OPENCLAW_HOOKS_TOKEN=<HOOKS_TOKEN>

# === OPCIONALES ===
AUTONOMY_LEVEL=supervised
LOG_LEVEL=info

# Habilitar probe de generacion en diagnostics (default: false)
# OPENCLAW_ENABLE_GENERATION_PROBE=true
```

**IMPORTANTE:** Arrancar backend DESDE `backend/`:
```bash
cd ocaas/backend
npm run dev
```

### Orden correcto de arranque (validado en esta instalacion)

1. Verificar OpenClaw gateway arriba
```bash
openclaw status
```

2. Verificar que `~/.openclaw/openclaw.json` incluye:
- `gateway.http.endpoints.chatCompletions.enabled=true`
- `hooks.enabled=true`
- `hooks.token`
- `hooks.allowRequestSessionKey=true`
- `hooks.allowedSessionKeyPrefixes=["hook:"]`

3. Verificar que `agentes/ocaas/backend/.env` replica:
- `OPENCLAW_API_KEY`
- `OPENCLAW_HOOKS_TOKEN`

4. Levantar backend SOLO si 3001 esta libre
```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
cd backend && npm run dev
```

5. Levantar frontend SOLO si 5173 esta libre
```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
cd frontend && npm run dev -- --host 0.0.0.0
```

### Errores reales observados y su significado

- `404 Not Found` en `/hooks/agent`
  - causa real: `hooks.enabled` no estaba activado.
- `404 Not Found` en `/v1/chat/completions`
  - causa real: `chatCompletions.enabled` no estaba activado.
- `Port 3001 is already in use`
  - habia un backend ya levantado; no arrancar un segundo proceso.
- `hooksConnected: false` en OCAAS con hook ya operativo
  - era un problema de diagnostico interno de OCAAS, no del gateway.

---

## [NEW] Operational Validation Checklist

### Build Verification
```bash
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

### Hooks Functioning
```bash
# Check token configured
curl localhost:3001/api/system/diagnostics | jq '.openclaw.hooks'
# Expected: { "configured": true }
```

### Bundle Complete
```typescript
const result = await generator.generateBundle(input);
if (result.bundleStatus !== 'complete') {
  console.error('Bundle failed:', result.error);
}
```

### Fallback OK
```bash
# Temporarily disable hooks token and verify chat_completion works
# In .env: comment out OPENCLAW_HOOKS_TOKEN
# Restart and test task creation
```

### Trace Coherent
```bash
curl localhost:3001/api/tasks/{id}/generation-trace | jq

# Check:
# - execution_mode matches what happened
# - fallback_used matches reality
# - accepted_async only true if hooks was used
# - response_received true if got output
# - agent_warmup_attempted true
```

---

## [NEW] AI Generation Status (PROMPT 13)

### Generation Traceability Fields

| Field | Description |
|-------|-------------|
| `ai_generation_attempted` | True if AI generation was tried |
| `ai_generation_succeeded` | True if AI returned valid response |
| `fallback_used` | True if template was used instead |
| `fallback_reason` | Why fallback: `ai_not_configured`, `ai_request_failed`, etc. |
| `generation_mode` | Final mode: `'ai'` \| `'fallback'` \| `'manual'` |

### Status Interpretation

| Scenario | Fields |
|----------|--------|
| AI success | `ai_generation_attempted=true`, `ai_generation_succeeded=true`, `generation_mode='ai'` |
| AI failed | `ai_generation_attempted=true`, `ai_generation_succeeded=false`, `fallback_used=true` |
| No AI configured | `ai_available=false`, `fallback_used=true`, `fallback_reason='ai_not_configured'` |

### Important: generation != resource

```
generation created  ≠  resource usable

Lifecycle:
1. Generation created (status: 'pending')
2. Generation generated (status: 'generated')
3. Generation pending_approval
4. Generation approved
5. Resource activated (agent/tool/skill in DB)
6. Resource materialized (workspace files)

Only after step 5 is the resource usable.
For bundles: bundleStatus must be 'complete'.
```

---

## [NEW] Test Scripts (PROMPT 12)

### inject_task.sh
```bash
# FSM-compliant: pending -> queued
./inject_task.sh

# With agent assignment: pending -> queued -> assigned
./inject_task.sh --assign <AGENT_ID>
```

### inject_bundle_google_search.ts
```bash
cd backend && npx tsx ../inject_bundle_google_search.ts
```
Requires `OPENCLAW_API_KEY` for AI generation.

### smoke_test_hooks.sh
```bash
./smoke_test_hooks.sh
```
Validates env vars, backend, gateway, task FSM.

---

## [NEW] Intent Router (OpenClaw ↔ OCAAS)

### Overview

The Intent Router enables OpenClaw to classify incoming messages and route them appropriately:
- **consult**: Direct answer, no task created
- **task**: Create task in OCAAS
- **ambiguous**: Request clarification

### Architecture

```
User Message
    ↓
Channel (Telegram/API/Web)
    ↓
OpenClaw Gateway
    ↓
intent-router agent (classifies intent)
    ↓
ocaas_router tool (HTTP call)
    ↓
POST /api/intake/router
    ↓
OCAAS processes:
  - consult → acknowledge
  - task → create task
  - ambiguous → return clarification
    ↓
Response to user
```

**CRITICAL:** OpenClaw router is NOT the control plane. OCAAS remains the control plane.

### Prerequisites (macOS)

**Recommended runtime:**
- Node 20.x (NOT Node 24 - avoid better-sqlite3 issues)
- OCAAS backend on port 3001
- OCAAS frontend on port 5173
- OpenClaw gateway on port 18789

**Verify:**
```bash
node -v
npm -v
```

### OCAAS Backend Support

The codebase includes:
- `POST /api/intake/router`
- Intake handlers and routes
- Contracts/types for: consult, task, ambiguous

**Verify endpoint exists after startup:**
```bash
curl -i http://localhost:3001/api/intake/router
```
Expected: 400 (validation error) or method error, NOT 404.

### OpenClaw Router Assets

Located in `openclaw-config/`:
- `tools/ocaas-router.json` - HTTP tool definition
- `skills/intent-classifier.json` - Classification skill
- `agents/intent-router.json` - Agent configuration
- `agents/intent-router-prompt.md` - System prompt

**These are NOT auto-installed.** Must be deployed to OpenClaw workspace manually.

### OpenClaw Configuration (MANUAL, REQUIRED)

**Steps:**

1. Install router tool:
```bash
cp openclaw-config/tools/ocaas-router.json ~/.openclaw/workspace/tools/
```

2. Install intent-classifier skill:
```bash
cp openclaw-config/skills/intent-classifier.json ~/.openclaw/workspace/skills/
```

3. Install intent-router agent:
```bash
cp openclaw-config/agents/intent-router.json ~/.openclaw/workspace/agents/
cp openclaw-config/agents/intent-router-prompt.md ~/.openclaw/workspace/agents/
```

4. Register and activate agent:
```bash
openclaw agent register intent-router
openclaw agent activate intent-router
```

5. Set agent as default intake for channel (if applicable)

### OpenClaw Tool Environment Variables

The `ocaas_router` tool expects:
```env
OCAAS_API_URL=http://localhost:3001
OCAAS_API_KEY=<same as API_SECRET_KEY in OCAAS>
```

Ensure these are available to OpenClaw's tool configuration resolution.

### OCAAS Backend .env (macOS)

```env
PORT=3001
HOST=0.0.0.0
DATABASE_URL=./data/ocaas.db

OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace
OPENCLAW_API_KEY=<GATEWAY_TOKEN>
OPENCLAW_HOOKS_TOKEN=<HOOKS_TOKEN>

API_SECRET_KEY=<MIN_32_CHARS>

DEFAULT_OPENCLAW_AGENT_ID=
TASK_DISPATCH_MODE=auto
```

### Startup Sequence (macOS)

1. **Start OpenClaw gateway**

2. **Verify OpenClaw REST:**
```bash
curl -s http://localhost:18789/v1/models \
  -H "Authorization: Bearer <GATEWAY_TOKEN>"
```

3. **Start OCAAS backend:**
```bash
cd agentes/ocaas/backend
npm run dev
```

4. **Verify OCAAS:**
```bash
curl http://localhost:3001/health
curl -s http://localhost:3001/api/system/gateway
curl -i http://localhost:3001/api/intake/router
```

5. **Start OCAAS frontend:**
```bash
cd agentes/ocaas/frontend
npm run dev
```

6. **Only after above:**
- Install OpenClaw intent-router assets
- Bind router agent to channel/inbox
- Send test message from channel

### Intent Router Expected Behavior

| Intent | OpenClaw Action | OCAAS Action |
|--------|-----------------|--------------|
| consult | Provide direct answer | Acknowledge, NO task created |
| task | Extract task_payload | Create task, return taskId |
| ambiguous | Generate clarification question | Return pending_confirmation |

### Validation Checklist (MANDATORY)

**A. Backend:**
- [ ] `/api/intake/router` exists and validates payload
- [ ] Backend compiles on macOS
- [ ] Node version pinned to 20.x

**B. OpenClaw router config:**
- [ ] `ocaas_router` tool installed
- [ ] `intent_classifier` skill installed
- [ ] `intent-router` agent installed
- [ ] Agent bound to intended channel/default intake path
- [ ] `OCAAS_API_URL` resolves from OpenClaw side
- [ ] `OCAAS_API_KEY` resolves from OpenClaw side

**C. End-to-end behavior:**
- [ ] Consult message does NOT create task
- [ ] Task message creates task in OCAAS
- [ ] Ambiguous message does NOT silently execute
- [ ] No 404 on `/api/intake/router`
- [ ] No auth mismatch between OpenClaw tool and OCAAS endpoint

### Important Architectural Rule

```
Router agent in OpenClaw:
  - classifies
  - routes
  - communicates with OCAAS

OCAAS:
  - creates and governs tasks
  - keeps canonical task state
  - dispatches execution to OpenClaw

Do NOT treat the OpenClaw router agent as the control plane.
```

---

*Actualizado: 2026-04-22*
*Sections marked [NEW] or [UPDATED] reflect PROMPT 7-13 changes*
*Sections marked [CRITICAL] address operational gaps for clean/existing installs*
*Intent Router section added for OpenClaw ↔ OCAAS integration*

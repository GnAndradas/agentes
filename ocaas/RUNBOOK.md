# OCAAS RUNBOOK

## 1. OVERVIEW

OCAAS = Control plane para orquestar agentes AI.
OpenClaw = Runtime que ejecuta los agentes.

OCAAS decide QUE hacer -> OpenClaw ejecuta COMO hacerlo.

## 2. ARCHITECTURE

```
User/Channel
     |
     v
OCAAS API (Tasks)
     |
     v
TaskRouter
     |
     v
OrgAwareDecisionEngine
     |
     v
Agent (role-based selection)
     |
     v
JobDispatcherService
     |
     +---> [NEW] ensureAgentReady (warmup)
     |
     v
OpenClaw Gateway (hooks_session | chat_completion | stub)
     |
     v
LLM + Tools Execution
     |
     v
JobResponse
     |
     v
GenerationTraceService (traceability)
     |
     v
Task update + UI
     |
     v
SQLite (state: tasks, jobs, generation_traces)
```

- OCAAS = control plane (tasks, org, decisions, approvals)
- OpenClaw = execution runtime (LLM + tools)
- Jobs = unidad de ejecucion
- Organization = controla delegacion
- Resolution = maneja bloqueos y retry

## 3. EXECUTION MODES

| Mode | Transport | Priority | Description |
|------|-----------|----------|-------------|
| `hooks_session` | `/hooks/agent` | PRIMARY | Stateful session via OPENCLAW_HOOKS_TOKEN |
| `chat_completion` | `/v1/chat/completions` | FALLBACK | Stateless via OPENCLAW_API_KEY |
| `stub` | none | EMERGENCY | Mock when nothing connected |

**Fallback chain:** hooks_session -> chat_completion -> stub

## 4. EXECUTION FLOW [UPDATED]

```
Task
  |
  v
TaskRouter -> OrgAwareDecision -> Agent Selection
  |
  v
JobDispatcher.executeJob()
  |
  +---> [NEW] ensureAgentReady(agentId) - Warmup ping
  |           |
  |           +--> ready=true: proceed
  |           +--> ready=false: log warning, proceed anyway (fallback will cover)
  |
  v
executeViaHooks()
  |
  +---> hooks_session attempt
  |           |
  |           +--> immediate response: DONE
  |           |
  |           +--> accepted_async (no immediate response)
  |                     |
  |                     +--> wait for timeout
  |                     |
  |                     +--> timeout reached? -> fallback to chat_completion
  |
  +---> hooks failed? -> fallback to chat_completion
  |
  +---> chat_completion failed? -> stub mode
  |
  v
JobResponse + GenerationTrace
```

**Job states:** `pending` -> `running` -> `completed|failed|blocked|timeout`

**Blocked Flow:** blocked -> suggestion -> approval -> resource created -> retry

### [NEW] accepted_async Handling

```
accepted_async = hooks acepto el request PERO no hay respuesta inmediata

IMPORTANTE: accepted_async NO es fallo

Flujo:
1. hooks_session retorna success=true, accepted=true, response=undefined
2. Sistema espera hasta timeout
3. Si timeout:
   - CASE A: Timeout pero respuesta llega -> completado
   - CASE B: Timeout, fallback a chat_completion -> respuesta via REST
   - CASE C: Timeout, fallback falla -> error
   - CASE D: Timeout, no fallback disponible -> stub mode
```

## 5. CORE COMPONENTS

| Component | File | Role |
|-----------|------|------|
| TaskRouter | orchestrator/ | Queue + dispatch tasks |
| OrgAwareDecisionEngine | orchestrator/ | Select agent by role/capability |
| JobDispatcherService | execution/ | Build payload, detect mode, execute |
| ExecutionTraceability | execution/ | Track real execution mode |
| GenerationTraceService | execution/ | Persist AI generation traces |
| OpenClawAdapter | integrations/openclaw/ | HTTP to gateway |
| DiagnosticService | services/ | Full diagnostics |
| TaskStateManager | execution/TaskStateManager/ | Execution state + tools |

## 6. [NEW] OPENCLAW INTEGRATION

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

### Token Synchronization

**Step 1: Obtain token from OpenClaw**
```bash
openclaw config get gateway.token
```

**Step 2: Copy token to OCAAS environment**
File: `backend/.env` (ruta relativa al proyecto)
```bash
OPENCLAW_API_KEY=<token_from_step_1>
```
- OpenClaw es la fuente de verdad del token (gateway.token). OCAAS solo replica ese valor.

**Token usage locations in OCAAS:**
- `src/config/env.ts` - Environment variable definition
- `src/openclaw/gateway.ts` - Bearer token for REST API calls
- `src/integrations/openclaw/OpenClawAdapter.ts` - HTTP client authentication

**Important:** When token is regenerated in OpenClaw, it must be updated in both OpenClaw and OCAAS.

### Token Separation

```bash
# REST API (fallback mode)
OPENCLAW_API_KEY=<token_from_openclaw>
# Used for: /v1/chat/completions, /v1/models
# Header: Authorization: Bearer <token>

# Hooks/Webhooks (primary mode)
OPENCLAW_HOOKS_TOKEN=<separate_token>
# Used for: /hooks/agent, /hooks/wake
# Header: x-openclaw-token: <token>
```

**IMPORTANTE:** Los tokens son SEPARADOS. No hay fallback automatico de uno al otro.

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
hook:ocaas:task-{taskId}     - Para tasks
hook:ocaas:job-{jobId}       - Para jobs directos
hook:ocaas:warmup-{agentId}  - Para warmup pings
hook:ocaas:manual-{id}       - Para ejecuciones manuales
```

**sessionKey es ROUTING, no AUTH.** El auth es via header `x-openclaw-token`.

## 7. [NEW] AGENT RUNTIME BOOTSTRAP

### ensureAgentReady()

Antes de ejecutar via hooks_session, OCAAS envia un warmup ping:

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

### Warmup vs Execution

```
Warmup (ensureAgentReady):
- Proposito: verificar que gateway puede rutear al agente
- NO bloquea: si falla, ejecucion continua igual
- Trackeado en: agent_warmup_attempted, agent_warmup_success

Execution (executeViaHooks):
- Proposito: enviar el prompt real
- SI puede fallar: dispara fallback chain
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

## 8. [NEW] SYSTEMIC GENERATOR (Bundles)

### Bundle Flow

```
SystemicGeneratorService.generateBundle(input)
  |
  v
STEP 1: Generate TOOL
  |
  v
STEP 2: Generate SKILL (references tool)
  |
  v
STEP 3: Generate AGENT (references skill)
  |
  v
STEP 4: Approve + Activate all (in order)
  |
  v
STEP 5: Link resources
  - skillService.addTool(skillId, toolId)
  - skillService.assignToAgent(skillId, agentId)
  |
  v
STEP 6: Update metadata with cross-references
```

### Bundle Metadata

Cada generation del bundle tiene:

```json
{
  "bundle": true,
  "bundleId": "bundle_abc123xyz",
  "bundleName": "my-bundle",
  "bundleType": "tool|skill|agent",
  "bundleStatus": "partial|complete"
}
```

### bundleStatus Rules

| Status | Meaning |
|--------|---------|
| `partial` | Bundle en progreso o fallo parcial |
| `complete` | Todos los pasos exitosos |

**Solo `complete` significa bundle usable.**

### [NEW] PROMPT 13: Bundle Guard

Agents from incomplete bundles are **blocked from execution**.

```typescript
// JobDispatcherService.executeJob checks:
await agentService.validateForExecution(agentId);
// Throws if bundleStatus !== 'complete'
```

Error returned:
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

**Important:** This guard prevents task execution with partially-created agents.

### API Usage

```typescript
import { getSystemicGenerator } from './generator/index.js';

const generator = getSystemicGenerator();
const result = await generator.generateBundle({
  name: 'my-feature',
  description: 'Feature description',
  objective: 'What it should accomplish',
  capabilities: ['code', 'analysis']
});

// result.bundleStatus === 'complete' -> usable
// result.bundleStatus === 'partial' -> check result.error
```

## 9. [NEW] ENRICHED TASKS (PROMPT 10)

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| `objective` | string | What should be accomplished |
| `constraints` | string | Limitations or requirements |
| `details` | string/JSON | Additional context or data |
| `expectedOutput` | string | Expected output format |

Todos opcionales. Backward compatible.

### Storage

Cuando se proveen campos enriquecidos, se almacenan en `task.input`:

```json
{
  "text": "Task title",
  "context": {
    "description": "...",
    "objective": "...",
    "constraints": "...",
    "details": "...",
    "expectedOutput": "..."
  }
}
```

### Prompt Generation

JobDispatcherService.buildPrompt() genera:

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

## 10. [UPDATED] TRACEABILITY

### ExecutionTraceability Fields

| Field | Type | Description |
|-------|------|-------------|
| `execution_mode` | string | `hooks_session|chat_completion|stub` |
| `transport` | string | `hooks_agent|rest_api|none` |
| `transport_success` | bool | Request enviado exitosamente |
| `accepted_async` | bool | [NEW] hooks acepto pero sin respuesta inmediata |
| `async_timeout_triggered` | bool | [NEW] Timeout alcanzado en modo async |
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

## 11. JOBS

**Payload minimo:**
```typescript
{ jobId, taskId, goal, agent: { agentId, role, capabilities },
  allowedResources: { tools[], skills[] }, constraints: { autonomyLevel } }
```

**Response:**
```typescript
{ jobId, status, result?: { output }, error?: { code, retryable },
  blocked?: { reason, missing[], suggestions[] } }
```

**Blocking reasons:** `missing_tool | missing_skill | missing_permission | awaiting_approval`

**Resolution:** POST `/api/jobs/:id/resolve` -> creates generation + approval -> auto-retry

## 12. INSTALLATION

**Backend-first setup (recommended):**
```bash
cd ocaas/backend
npm install
cp .env.example .env
npx drizzle-kit push || echo "db:push failed (non-blocking)"
npm run dev
```

**Frontend (separate terminal - REQUIRED):**
```bash
cd ocaas/frontend
npm install
npm run dev
```

**Env (backend/.env):**
```bash
PORT=3001
OPENCLAW_GATEWAY_URL=http://localhost:18789
API_SECRET_KEY=<min-16-chars>

# For hooks_session (PRIMARY) - REQUIRED for primary mode
OPENCLAW_HOOKS_TOKEN=<token>

# For chat_completion (FALLBACK) - REQUIRED for fallback
OPENCLAW_API_KEY=<token_from_openclaw_config>

AUTONOMY_LEVEL=supervised
```

**Startup order:**
1. Configure OpenClaw: Edit `~/.openclaw/openclaw.json` to enable chatCompletions
2. Get OpenClaw token: `openclaw config get gateway.token`
3. Configure OCAAS: Add token to `backend/.env` as `OPENCLAW_API_KEY`
4. Start OpenClaw gateway
5. Start Backend: `npm run dev` (from backend/)
6. Start Frontend: `npm run dev` (from frontend/)

## 13. CRITICAL CHECKS

```bash
# Health
curl localhost:3001/health

# Gateway + mode detection
curl localhost:3001/api/system/diagnostics | jq '.openclaw'

# Verify OpenClaw gateway
curl http://localhost:18789/health
- Debe responder OK antes de probar /v1/models o /v1/chat/completions

# Verify OpenClaw endpoints
curl localhost:18789/v1/models -H "Authorization: Bearer $OPENCLAW_API_KEY"
- Debe devolver una lista no vacía.
- Si devuelve vacío o error, el gateway no está correctamente configurado.
curl -X POST localhost:18789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  -d '{"model":"openclaw/default","messages":[{"role":"user","content":"test"}]}'

# Create test task
curl -X POST localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"test","type":"general","priority":2}'
```

**Expected:**
- `/health` -> `{"status":"ok"}`
- `openclaw.configured` -> `true`
- `/health` -> OK
- `/v1/models` returns non-empty list
- `/v1/chat/completions` returns response (not 404)
- Task creates -> Job dispatches via detected mode

## 14. OPERATIONS

**Tasks:**
```bash
GET  /api/tasks                       # List
GET  /api/tasks/:id                   # Detail
GET  /api/tasks/:id/diagnostics       # Full diagnostics
GET  /api/tasks/:id/timeline          # Timeline
GET  /api/tasks/:id/state             # Execution state + tools
GET  /api/tasks/:id/generation-trace  # AI trace
POST /api/tasks/:id/retry             # Retry failed
```

**Jobs:**
```bash
GET  /api/jobs/active            # Running
GET  /api/jobs/blocked           # Need resolution
POST /api/jobs/:id/abort         # Stop
POST /api/jobs/:id/retry         # Retry
POST /api/jobs/:id/resolve       # Fix blocked
```

**Approvals:**
```bash
GET  /api/approvals?status=pending
POST /api/approvals/:id/approve
POST /api/approvals/:id/reject
```

**Generations:**
```bash
GET  /api/generations/:id
POST /api/generations/:id/approve
POST /api/generations/:id/reject
```

**Autonomy:**
```bash
GET   /api/system/autonomy
PATCH /api/system/autonomy -d '{"level":"autonomous"}'
```

## 15. [UPDATED] TROUBLESHOOTING

| Problem | Check | Fix |
|---------|-------|-----|
| Job stuck running | `/api/jobs/active` | `POST /jobs/:id/abort` |
| Job blocked | `/api/jobs/blocked` | Approve missing resource, retry |
| hooks_session fails | OPENCLAW_HOOKS_TOKEN | Configure token or use chat_completion |
| chat_completion fails | OPENCLAW_API_KEY | Configure API key |
| All modes fail | `/api/system/diagnostics` | Check gateway URL, restart |
| Task not processing | `/api/tasks/:id/diagnostics` | Check gaps, warnings |
| Frontend errors | Missing node_modules | `cd frontend && npm install` |
| [NEW] Warmup fails | Check logs | Non-blocking, execution continues |
| [NEW] accepted_async timeout | Normal behavior | Fallback will handle |
| [NEW] Bundle partial | Check error in result | Retry or manual fix |

### Failure Symptoms

**404 on /v1/chat/completions**
- Cause: Chat Completions endpoint not enabled in OpenClaw
- Fix: Edit `~/.openclaw/openclaw.json` and set `gateway.http.endpoints.chatCompletions.enabled = true`

**Auth / provider / fallback errors**
- Cause: Token mismatch or incorrect configuration
- Fix: Verify `OPENCLAW_API_KEY` matches `openclaw config get gateway.token`

**OCAAS stuck in fallback mode**
- Cause: Token synchronization issue or gateway configuration problem
- Fix: Re-sync token from OpenClaw to OCAAS, verify gateway configuration

### [NEW] Common Error Patterns

**"Transport failed" in async context:**
```
NO es un error real si accepted_async=true.
hooks_session acepto el request, solo no hubo respuesta inmediata.
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

**Logs:**
```bash
tail -f logs/ocaas.log
LOG_LEVEL=debug npm run dev
```

## 16. SECURITY & LIMITS

**Auth:** `X-API-Key` header = `API_SECRET_KEY`

**Limits:**
| Resource | Default |
|----------|---------|
| Jobs per agent | 3 concurrent |
| Tool calls per job | 20 |
| Job timeout | 5 min |
| Human timeout | 5 min |

**Autonomy levels:**
- `manual` -> all needs approval
- `supervised` -> high priority needs approval
- `autonomous` -> no approval needed

## 17. QUICK REFERENCE

**Key endpoints:**
```
/health                          -> Quick check
/api/system/diagnostics          -> Full status + mode detection
/api/tasks/:id/diagnostics       -> Task diagnostics
/api/tasks/:id/generation-trace  -> AI execution trace
/api/jobs/blocked                -> Needs attention
/api/approvals?status=pending    -> Waiting human
```

**Key files:**
```
src/execution/JobDispatcherService.ts   -> Job creation + mode detection + warmup
src/execution/ExecutionTraceability.ts  -> Mode definitions + trace builder
src/execution/GenerationTraceService.ts -> AI trace persistence
src/orchestrator/OrgAwareDecisionEngine.ts -> Agent selection
src/integrations/openclaw/OpenClawAdapter.ts -> ensureAgentReady + executeViaHooks
src/generator/SystemicGeneratorService.ts -> Bundle generation
src/services/TaskService.ts -> Enriched task creation
src/config/autonomy.ts -> Autonomy config
```

## 18. AGENT MATERIALIZATION

**Auto-materialization:** Agents are automatically materialized on activation.
- `AgentBootstrap` creates default-general-agent on startup
- `AgentService.activate()` triggers `materializeIfNeeded()`
- Creates workspace: `agents/<name>/agent.json` + `system-prompt.md`

**Manual materialization:** From UI (AgentDetail) or API:
```bash
POST /api/agents/:id/materialize
```

**Lifecycle states:** `record` -> `activated` -> `materialized` -> `runtime_ready`

## 19. TASK OPERATIONS

**Manual agent assignment/reassignment:**
- TaskDetail shows assignment panel for queued/pending/failed tasks
- Works even when task already has an agent (reassignment)
- UI: TaskManualAgentAssignPanel

**Generate agent flow:**
- TaskGenerateAgentFlowPanel tracks: generated / linked / pending approval
- Honest status: shows real state, not optimistic assumptions

**inject_task.sh (PROMPT 12):**
```bash
# FSM-compliant task injection: pending -> queued
./inject_task.sh

# With optional agent assignment: pending -> queued -> assigned
./inject_task.sh --assign <AGENT_ID>
```
Validates backend reachable, creates task, queues it properly.

**inject_bundle_google_search.ts (PROMPT 12):**
```bash
# From repo root:
cd backend && npx tsx ../inject_bundle_google_search.ts
```
Creates tool + skill + agent bundle. Requires `OPENCLAW_API_KEY`.

**smoke_test_hooks.sh (PROMPT 12):**
```bash
./smoke_test_hooks.sh
```
Validates env vars, backend health, gateway connectivity, task FSM.

## 20. KNOWN GAPS

1. **Skills/Tools not used** - OpenClaw doesn't read workspace
2. **Agents not "real"** - Always hooks_session or chat_completion, never real OpenClaw session
3. **runtime_ready always false** - No real session management
4. **Workspace not connected** - agent.json created but not loaded

## 21. [NEW] OPERATIONAL VALIDATION CHECKLIST

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
// In code
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
```

## 22. CLEANUP

**Check if port 3001 is in use:**

Linux/Mac:
```bash
lsof -i :3001
kill -9 <pid>
```

Windows:
```bash
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

**Reset database:**
```bash
rm -f backend/data/ocaas.db
```

**Full clean rebuild:**
```bash
npm run clean && npm install && npm run build
```

## 23. VALIDATION

After startup:
```bash
curl localhost:3001/health
curl localhost:3001/api/system/diagnostics | jq
```

Check:
- `status` = `ok`
- `healthy` = `true`
- `openclaw.configured` = `true`
- Execution mode detected (hooks_session or chat_completion)

## 24. [NEW] AI GENERATION STATUS (PROMPT 13)

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
| Manual creation | `generation_mode='manual'` |

### Important: generation != resource

```
generation created  ≠  resource usable

Lifecycle:
1. Generation created (status: 'pending')
2. Generation generated (status: 'generated')
3. Generation pending_approval (status: 'pending_approval')
4. Generation approved (status: 'approved')
5. Resource activated (agent/tool/skill created in DB)
6. Resource materialized (workspace files created)

Only after step 5 is the resource usable.
For bundles: bundleStatus must be 'complete'.
```

## DEPLOYMENT COMPLETION

After applying OpenClaw configuration, TUI must complete deployment by starting all services and validating them.

TUI must not stop after editing config files.

### Required start sequence

```bash
# 1. Start OpenClaw gateway
openclaw gateway start
```

```bash
# 2. Start backend
cd ocaas/backend
npm run dev
```

```bash
# 3. Start frontend
cd ocaas/frontend
npm run dev
```

### Required validation

```bash
# Gateway must be running
curl http://localhost:18789/health
```
- Must respond OK

```bash
# Backend must be running
curl http://localhost:3001/health
```
- Must return {"status":"ok"}

```bash
# Models must exist
curl localhost:18789/v1/models -H "Authorization: Bearer $OPENCLAW_API_KEY"
```
- Must return non-empty list

```bash
# Chat completions must work
curl -X POST localhost:18789/v1/chat/completions   -H "Content-Type: application/json"   -H "Authorization: Bearer $OPENCLAW_API_KEY"   -d '{"model":"openclaw/default","messages":[{"role":"user","content":"test"}]}'
```
- Must return response
- Must not return 404

```bash
# OCAAS must process tasks
curl -X POST localhost:3001/api/tasks   -H "Content-Type: application/json"   -d '{"title":"test","type":"general","priority":2}'
```
- Task created
- Job dispatched

---

*Updated: 2026-04-07*
*Sections marked [NEW] or [UPDATED] reflect PROMPT 7-13 changes*

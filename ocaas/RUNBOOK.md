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

## 4. EXECUTION FLOW

```
Task -> TaskRouter -> OrgAwareDecision -> JobDispatcher -> OpenClaw -> Response
                         |                      |
                    Agent Selection        Mode detection:
                                           1. hooks_session?
                                           2. chat_completion?
                                           3. stub
```

**Job states:** `pending` -> `running` -> `completed|failed|blocked|timeout`

**Blocked Flow:** blocked -> suggestion -> approval -> resource created -> retry

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

## 6. JOBS

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

## 7. INSTALLATION

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

# For hooks_session (PRIMARY)
OPENCLAW_HOOKS_TOKEN=<token>

# For chat_completion (FALLBACK)
OPENCLAW_API_KEY=<key>

AUTONOMY_LEVEL=supervised
```

**Startup order:**
1. OpenClaw gateway
2. Backend: `npm run dev` (from backend/)
3. Frontend: `npm run dev` (from frontend/)

## 8. CRITICAL CHECKS

```bash
# Health
curl localhost:3001/health

# Gateway + mode detection
curl localhost:3001/api/system/diagnostics | jq '.openclaw'

# Create test task
curl -X POST localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"test","type":"general","priority":2}'
```

**Expected:**
- `/health` -> `{"status":"ok"}`
- `openclaw.configured` -> `true`
- Task creates -> Job dispatches via detected mode

## 9. OPERATIONS

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

## 10. TROUBLESHOOTING

| Problem | Check | Fix |
|---------|-------|-----|
| Job stuck running | `/api/jobs/active` | `POST /jobs/:id/abort` |
| Job blocked | `/api/jobs/blocked` | Approve missing resource, retry |
| hooks_session fails | OPENCLAW_HOOKS_TOKEN | Configure token or use chat_completion |
| chat_completion fails | OPENCLAW_API_KEY | Configure API key |
| All modes fail | `/api/system/diagnostics` | Check gateway URL, restart |
| Task not processing | `/api/tasks/:id/diagnostics` | Check gaps, warnings |
| Frontend errors | Missing node_modules | `cd frontend && npm install` |

**Logs:**
```bash
tail -f logs/ocaas.log
LOG_LEVEL=debug npm run dev
```

## 11. SECURITY & LIMITS

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

## 12. QUICK REFERENCE

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
src/execution/JobDispatcherService.ts   -> Job creation + mode detection
src/execution/ExecutionTraceability.ts  -> Mode definitions
src/execution/GenerationTraceService.ts -> AI trace persistence
src/orchestrator/OrgAwareDecisionEngine.ts -> Agent selection
src/config/autonomy.ts -> Autonomy config
```

## 13. AGENT MATERIALIZATION

**Auto-materialization:** Agents are automatically materialized on activation.
- `AgentBootstrap` creates default-general-agent on startup
- `AgentService.activate()` triggers `materializeIfNeeded()`
- Creates workspace: `agents/<name>/agent.json` + `system-prompt.md`

**Manual materialization:** From UI (AgentDetail) or API:
```bash
POST /api/agents/:id/materialize
```

**Lifecycle states:** `record` -> `activated` -> `materialized` -> `runtime_ready`

## 14. TASK OPERATIONS

**Manual agent assignment/reassignment:**
- TaskDetail shows assignment panel for queued/pending/failed tasks
- Works even when task already has an agent (reassignment)
- UI: TaskManualAgentAssignPanel

**Generate agent flow:**
- TaskGenerateAgentFlowPanel tracks: generated / linked / pending approval
- Honest status: shows real state, not optimistic assumptions

**inject_task.sh:**
```bash
./inject_task.sh   # Creates task, prints ID, exits
```
Pure injector: no polling, no GET, just POST and return ID.

## 15. KNOWN GAPS

1. **Skills/Tools not used** - OpenClaw doesn't read workspace
2. **Agents not "real"** - Always hooks_session or chat_completion, never real OpenClaw session
3. **runtime_ready always false** - No real session management
4. **Workspace not connected** - agent.json created but not loaded

## 16. CLEANUP

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

## 17. VALIDATION

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

---

*Updated: 2026-04-06*

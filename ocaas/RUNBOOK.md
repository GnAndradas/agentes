# OCAAS RUNBOOK

## 1. OVERVIEW

OCAAS = Control plane para orquestar agentes AI.
OpenClaw = Runtime que ejecuta los agentes.

OCAAS decide QUÉ hacer → OpenClaw ejecuta CÓMO hacerlo.

## 2. ARCHITECTURE

```
User/Channel
     ↓
OCAAS API (Tasks)
     ↓
TaskRouter
     ↓
OrgAwareDecisionEngine
     ↓
Agent (role-based selection)
     ↓
JobDispatcherService
     ↓
OpenClaw Gateway
     ↓
LLM + Tools Execution
     ↓
JobResponse
     ↓
JobResolutionService (if blocked)
     ↓
Task update + UI
     ↓
SQLite (state: tasks, jobs, delegation)
```

- OCAAS = control plane (tasks, org, decisions, approvals)
- OpenClaw = execution runtime (LLM + tools)
- Jobs = unidad de ejecución
- Organization = controla delegación
- Resolution = maneja bloqueos y retry

## 3. EXECUTION FLOW

```
Task → TaskRouter → OrgAwareDecision → JobDispatcher → OpenClaw → Response
                         ↓                                ↓
                    Agent Selection              blocked? → Resolution → Retry
```

**Estados Job:** `pending` → `running` → `completed|failed|blocked|timeout`

**Blocked Flow:** blocked → suggestion → approval → resource created → retry

## 4. CORE COMPONENTS

| Component | Role |
|-----------|------|
| TaskRouter | Queue + dispatch tasks |
| OrgAwareDecisionEngine | Select agent by role/capability |
| JobDispatcherService | Build payload, send to OpenClaw |
| JobResolutionService | Handle blocked, schedule retry |
| OpenClawAdapter | HTTP/WS to gateway |

## 5. JOBS

**Payload mínimo:**
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

**Resolution:** POST `/api/jobs/:id/resolve` → creates generation + approval → auto-retry

## 6. INSTALLATION

**Monorepo setup (recommended):**
```bash
cd ocaas
npm install          # installs all workspaces
cp backend/.env.example backend/.env
npm run db:push      # pushes schema to SQLite
npm run dev          # starts backend + frontend concurrently
```

**Manual setup:**
```bash
# Backend
cd ocaas/backend && npm install && npm run db:push && npm run dev
# Frontend (separate terminal)
cd ocaas/frontend && npm install && npm run dev
```

**Env (backend/.env):**
```bash
PORT=3001
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_API_KEY=<token>
API_SECRET_KEY=<min-16-chars>
AUTONOMY_LEVEL=supervised
```

**Startup order:**
1. OpenClaw gateway
2. OCAAS: `npm run dev` (from root)

## 7. CRITICAL CHECKS

```bash
# Health
curl localhost:3001/health

# Gateway connection
curl localhost:3001/api/system/diagnostics | jq '.openclaw'

# Create test task
curl -X POST localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"test","type":"general","priority":2}'
```

**Expected:**
- `/health` → `{"status":"ok"}`
- `openclaw.configured` → `true`
- Task creates → Job dispatches

## 8. OPERATIONS

**Tasks:**
```bash
GET  /api/tasks                  # List
GET  /api/tasks/:id              # Detail
POST /api/tasks/:id/retry        # Retry failed
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

**Autonomy:**
```bash
GET   /api/system/autonomy
PATCH /api/system/autonomy -d '{"level":"autonomous"}'
```

## 9. TROUBLESHOOTING

| Problem | Check | Fix |
|---------|-------|-----|
| Job stuck running | `/api/jobs/active` | `POST /jobs/:id/abort` |
| Job blocked | `/api/jobs/blocked` | Approve missing resource, retry |
| Tasks not processing | `/api/system/diagnostics` | Check orchestrator, restart |
| OpenClaw disconnected | diagnostics.openclaw | Verify gateway URL, restart |
| Agent not responding | `/api/agents/:id` | Check status, recreate session |
| Approval timeout | `/api/approvals?status=pending` | Approve or change autonomy level |

**Logs:**
```bash
tail -f logs/ocaas.log
LOG_LEVEL=debug npm run dev
```

## 10. SECURITY & LIMITS

**Auth:** `X-API-Key` header = `API_SECRET_KEY`

**Limits:**
| Resource | Default |
|----------|---------|
| Jobs per agent | 3 concurrent |
| Tool calls per job | 20 |
| Job timeout | 5 min |
| Human timeout | 5 min |

**Autonomy levels:**
- `manual` → all needs approval
- `supervised` → high priority needs approval
- `autonomous` → no approval needed

**Telegram:** Set `TELEGRAM_ALLOWED_USER_IDS` to restrict approvers.

## 11. QUICK REFERENCE

**Key endpoints:**
```
/health                     → Quick check
/api/system/diagnostics     → Full status
/api/jobs/blocked           → Needs attention
/api/approvals?status=pending → Waiting human
```

**Key files:**
```
src/execution/JobDispatcherService.ts  → Job creation
src/execution/JobResolutionService.ts  → Blocked handling
src/orchestrator/OrgAwareDecisionEngine.ts → Agent selection
src/config/autonomy.ts → Autonomy config
```

**Role hierarchy:** CEO > Manager > Supervisor > Specialist > Worker

**Delegation tracking:** Task.delegationHistory[] shows A → B → C chain

## 12. CLEANUP

```bash
# Stop all
pkill -f "npm run dev" || true

# Reset database
rm -f backend/data/*.db
npm run db:push

# Full clean rebuild
npm run clean && npm install && npm run build
```

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

**Backend-first setup (recommended):**
```bash
cd ocaas/backend
npm install
cp .env.example .env
npx drizzle-kit push || echo "db:push failed (non-blocking, runtime init handles tables)"
npm run dev
```

**Frontend (separate terminal):**
```bash
cd ocaas/frontend
npm install
npm run dev
```

> **Note:** Do not run backend commands from monorepo root for initial setup.
> db:push is optional if initDatabase creates required tables at runtime.

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
2. Backend: `npm run dev` (from backend/)
3. Frontend: `npm run dev` (from frontend/)

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

## 12. OLD INSTALLATION CLEANUP (CRITICAL)

**Check if port 3001 is in use:**

Linux/Mac:
```bash
lsof -i :3001
ps -fp <pid>
kill -9 <pid>
```

If using systemd:
```bash
systemctl status ocaas
sudo systemctl stop ocaas
sudo systemctl disable ocaas
```

Windows:
```bash
netstat -ano | findstr :3001
taskkill /PID <pid> /F
```

> **Important:** If frontend shows errors after update, verify backend process is the correct version.

**Reset database (safe mode):**
```bash
rm -f backend/data/ocaas.db
# Runtime init handles table creation
```

**Full clean rebuild:**
```bash
npm run clean && npm install && npm run build
```

## 13. VALIDATION (REQUIRED)

After startup:
```bash
curl localhost:3001/health
curl localhost:3001/api/system/diagnostics
```

Check:
- `status` = `ok`
- `healthy` = `true`
- `commit` matches expected version

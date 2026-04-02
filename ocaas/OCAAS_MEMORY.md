# OCAAS - Sistema de Memoria

> Documento de referencia técnica. Actualizado: 2026-04-02

## 1. Visión General

**OCAAS (OpenClaw Agent Administration System)** - Plataforma de orquestación multi-agente:
- Gestión de agentes IA especializados
- Asignación inteligente de tareas
- Generación automática de agentes/skills/tools
- Subdivisión de tareas complejas
- Control de autonomía (manual/supervised/autonomous)

## 2. Arquitectura

```
Frontend (React + Vite + TailwindCSS)
    │
    ├── Pages: Dashboard, Agents, Tasks, Skills, Tools, Generator, Generations, Settings
    ├── State: Zustand + React Query
    └── Real-time: Socket.io client
         │
         ▼
Backend (Fastify + SQLite + Socket.io)
    │
    ├── API REST: /api/{agents,tasks,skills,tools,generations,approvals,feedback,system}
    ├── WebSocket: eventos en tiempo real
    ├── Orchestrator: TaskRouter → DecisionEngine → ActionExecutor
    ├── Generators: AgentGenerator, SkillGenerator, ToolGenerator
    └── Services: Agent, Task, Skill, Tool, Generation, Event, Approval, Notification
         │
         ▼
OpenClaw Gateway (puerto 18789)
    │
    ├── REST: /v1/chat/completions, /v1/models
    ├── Webhooks: /hooks/agent, /hooks/wake
    └── WebSocket RPC: sessions.list, chat.abort, cron.list
```

## 3. Flujos Principales

### Generación AI
```
draft → generated → pending_approval → approved → active
                         ↓
                     rejected
```

### Manual Resources (ManualResourceService)
```
draft → pending_approval → approved → active
             ↓                  ↘ deactivated
          rejected
```

### Tareas (con FSM validada)
```
pending → queued → assigned → running → completed
   ↓         ↓         ↓         ↓
cancelled cancelled cancelled cancelled
                      ↓
                   failed → pending (retry)

Invariantes:
- Una task no puede tener más de una ejecución activa (lease)
- Transiciones inválidas se bloquean con error
- Recovery no duplica ejecuciones en curso
```

### Task ↔ Resource Retry Loop
```
Task (queued) → missing_resource detected
                        ↓
ResourceRetryService.handleMissingResource()
                        ↓
ManualResourceService.createDraft() → [autonomy flow]
                        ↓
    MANUAL: draft stays, human does everything
    SUPERVISED: auto-submit, human approves
    AUTONOMOUS: auto-approve, auto-activate
                        ↓
On activate → onResourceActivated callback
                        ↓
TaskRouter.retryTask() → Task re-processed
```

## 4. Componentes Clave

| Componente | Archivo | Función |
|------------|---------|---------|
| TaskRouter | `orchestrator/TaskRouter.ts` | Procesa cola, coordina decisiones |
| DecisionEngine | `orchestrator/DecisionEngine.ts` | Scoring y asignación de agentes |
| ResourceRetryService | `orchestrator/ResourceRetryService.ts` | Loop Task↔ManualResource con hardening |
| ManualResourceService | `services/ManualResourceService.ts` | FSM de drafts manuales (agent/skill/tool) |
| AIClient | `generator/AIClient.ts` | Interface con OpenClaw para generación |
| ActivationWorkflow | `services/ActivationWorkflowService.ts` | FSM de aprobación |
| **OpenClawAdapter** | `integrations/openclaw/OpenClawAdapter.ts` | **Punto único de entrada a OpenClaw** |
| Gateway | `openclaw/gateway.ts` | Cliente REST + WebSocket RPC (interno) |
| ChannelService | `services/ChannelService.ts` | Ingesta de mensajes de canales externos |
| ChannelBridge | `services/ChannelBridge.ts` | Bridge para enviar respuestas a canales |
| OrganizationalPolicyService | `organization/OrganizationalPolicyService.ts` | Motor de decisiones organizacionales |
| **SystemDiagnosticsService** | `system/SystemDiagnosticsService.ts` | **Diagnóstico integral del sistema** |
| **TaskTimelineService** | `system/TaskTimelineService.ts` | **Observabilidad completa de tasks** |
| **HumanEscalationService** | `hitl/HumanEscalationService.ts` | **Escalación formal a humano (DIOS)** |
| **ExecutionLeaseStore** | `orchestrator/resilience/ExecutionLeaseStore.ts` | **Prevención de doble ejecución** |
| **CheckpointStore** | `orchestrator/resilience/CheckpointStore.ts` | **Estado de ejecución para recovery** |

## 5. Variables de Entorno Críticas

```env
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_API_KEY=<token>
API_SECRET_KEY=<min 16 chars>
CHANNEL_SECRET_KEY=<min 16 chars, opcional - usa API_SECRET_KEY si no está>
TELEGRAM_BOT_TOKEN=<opcional>
TELEGRAM_WEBHOOK_SECRET=<opcional>
TELEGRAM_ALLOWED_USER_IDS=<opcional>
```

## 6. Estado del Proyecto (2026-04-01)

### Fases Completadas
- ✅ FASE 1: Corrección bugs críticos
- ✅ FASE 2: Orquestador completo
- ✅ FASE 3: Gateway/Status/Monitor honesto
- ✅ FASE 4: Generación AI funcional
- ✅ FASE 5: Seguridad y cierre

### Verificación de Coherencia (todos RESUELTOS)
- Panel diferencia backend de OpenClaw
- REST y hooks usan credenciales correctas
- Prompt del usuario llega al modelo
- Generación tolera respuestas LLM
- Activar genera recurso real
- Panel y Telegram mismo flujo
- Approval idempotente
- Monitor refleja estado real
- Solo Telegram soportado (honesto)

### Tests
```
✅ validator.test.ts              - 15 tests
✅ workflow.test.ts               - 36 tests
✅ telegram-security.test.ts      - 10 tests
✅ utils.test.ts                  - 13 tests
✅ manualResources.api.test.ts    - 16 tests
✅ resourceRetry.test.ts          - 10 tests
✅ resourceRetryHardening.test.ts - 14 tests
✅ channelIngest.test.ts          - 13 tests
✅ openclawAdapter.test.ts        - 26 tests
✅ organization.test.ts           - 33 tests
✅ resilience.test.ts             - 45 tests
✅ logger.test.ts                 - 20 tests
✅ systemDiagnostics.test.ts      - 26 tests
✅ task-resilience.test.ts        - 41 tests
✅ checkpoint-persistence.test.ts - 22 tests
✅ task-timeline.test.ts          - 34 tests
✅ human-escalation.test.ts       - 41 tests
✅ DecisionEngine.integration.test.ts - 18 tests
✅ CostOptimization.test.ts       - 44 tests
✅ ToolValidation.test.ts         - 34 tests (NEW)
✅ ResourceLayer.test.ts          - 19 tests

TOTAL: 577+ tests passing
```

## 7. ResourceRetryService Hardening

Protecciones implementadas para producción:

| Protección | Descripción |
|------------|-------------|
| **Anti-loop** | MAX_RESOURCE_RETRIES=3 por task |
| **Deduplicación** | Hash de (resourceType + slug + intent) evita duplicados |
| **Locking por taskId** | Previene handleMissingResource concurrente |
| **Locking por resourceKey** | Previene creación paralela del mismo recurso |
| **Retry único** | retriedTasksForDraft evita doble retry por activación |
| **Visibilidad** | getTaskRetryInfo() expone retryCount, lastRetryAt, pendingResources |
| **Telemetría** | Eventos task.missing_resource, task.retrying, task.retry_failed, task.retry_exhausted |
| **Recovery** | recoverState() reconstruye desde DB al reiniciar |
| **Cleanup** | cleanupOld() elimina entries >1 hora |

## 8. Riesgos de Producción

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| SQLite en producción | Alto | Migrar a PostgreSQL |
| Sin rate limiting | Medio | Agregar @fastify/rate-limit |
| Secrets en .env | Medio | Usar secrets manager |

## 9. API Routes

### Manual Resources (`/api/manual/resources`)
```
POST   /                    - Crear draft
GET    /                    - Listar drafts
GET    /:id                 - Obtener draft
PUT    /:id                 - Actualizar draft (solo status=draft)
DELETE /:id                 - Eliminar draft (solo status=draft)
POST   /:id/submit          - Submit para aprobación
POST   /:id/approve         - Aprobar
POST   /:id/reject          - Rechazar
POST   /:id/activate        - Activar (crea recurso real)
POST   /:id/deactivate      - Desactivar
```

### Channel Bridge (`/api/channels`)
```
POST   /ingest                              - Ingestar mensaje de canal externo
GET    /:channel/users/:userId/tasks        - Obtener tareas de un usuario

Headers requeridos:
  X-CHANNEL-SECRET: <CHANNEL_SECRET_KEY o API_SECRET_KEY>
```

## 10. Channel Bridge (Canales Externos)

Bridge bidireccional entre canales externos (Telegram, WhatsApp, etc.) y OCAAS.

### Flujo Entrada (Canal → OCAAS)
```
OpenClaw (Telegram/WhatsApp/etc.)
         │
         ▼
POST /api/channels/ingest
  Headers: X-CHANNEL-SECRET
  Body: { channel, userId, message, metadata? }
         │
         ▼
ChannelService.ingest()
  - Normaliza input
  - Detecta prioridad (urgente/importante/normal)
  - Crea Task con metadata.source='channel'
         │
         ▼
Task procesado por Orchestrator
```

### Flujo Salida (OCAAS → Canal)
```
Task completa/falla/cancela
         │
         ▼
ChannelBridge detecta (EVENT_TYPE.TASK_COMPLETED/FAILED/CANCELLED)
  - Verifica si metadata.source === 'channel'
         │
         ▼
ChannelService.emitResponseReady(task)
  - Construye respuesta
  - Emite EVENT_TYPE.CHANNEL_RESPONSE_READY
         │
         ▼
ChannelBridge.handleResponseReady()
  - Envía vía OpenClaw gateway.notify()
         │
         ▼
OpenClaw entrega a canal original (Telegram, etc.)
```

### Canales Soportados
| Canal | Estado |
|-------|--------|
| telegram | ✅ Funcional |
| whatsapp | 🔧 Pendiente OpenClaw |
| web | 🔧 Pendiente implementar |
| api | 🔧 Pendiente implementar |
| slack | 🔧 Pendiente OpenClaw |
| discord | 🔧 Pendiente OpenClaw |

## 11. OpenClawAdapter (Integración Centralizada)

**REGLA: Ningún archivo fuera de `integrations/openclaw/` puede llamar directamente al gateway.**

### Uso Correcto
```typescript
import { getOpenClawAdapter } from '../integrations/openclaw/index.js';
const adapter = getOpenClawAdapter();
const result = await adapter.generate({ systemPrompt, userPrompt });
```

### Uso Prohibido
```typescript
import { getGateway } from '../openclaw/gateway.js';  // ❌
const gateway = getGateway();                          // ❌
await gateway.generate({ ... });                       // ❌
```

### Métodos Disponibles
| Método | Descripción |
|--------|-------------|
| `generate()` | Generación de texto con LLM |
| `executeAgent()` | Spawn session + enviar prompt |
| `sendTask()` | Enviar mensaje a sesión existente |
| `executeTool()` | Ejecutar tool en sesión |
| `notifyChannel()` | Enviar notificación a canal |
| `getStatus()` | Estado rápido del gateway |
| `testConnection()` | Test con latencia |
| `listSessions()` | Listar sesiones activas |
| `abortSession()` | Abortar sesión |
| `terminateSession()` | Terminar sesión |
| `initialize()` | Inicializar conexión |

### Error Codes Normalizados
| Código | Descripción |
|--------|-------------|
| `connection_error` | ECONNREFUSED, network issues |
| `execution_error` | Errores de ejecución |
| `timeout` | Request timeout |
| `auth_error` | 401, 403 |
| `rate_limited` | 429 Too Many Requests |
| `not_configured` | API key missing |
| `invalid_response` | Respuesta malformada |

## 12. Organizational Layer

Capa organizacional formal para agentes.

### Roles
| Rol | Jerarquía | Permisos |
|-----|-----------|----------|
| `ceo` | 1 | Todo: delegar, crear recursos, aprobar subordinados |
| `manager` | 2 | Delegar, crear recursos, aprobar subordinados |
| `supervisor` | 3 | Delegar, dividir tareas |
| `specialist` | 4 | Alta complejidad, sin delegación |
| `worker` | 5 | Tareas simples, escalar a supervisor |

### Work Profiles (Presets)
| Perfil | Descripción |
|--------|-------------|
| `conservative` | Mínima autonomía, aprobación humana para casi todo |
| `balanced` | Equilibrio automático/humano |
| `aggressive` | Máxima autonomía, humano solo para crítico |
| `human_first` | Todo requiere aprobación humana |
| `autonomous_first` | Autonomía total |

### API Organizacional (`/api/org/*`)
```
GET    /profiles                     - Listar work profiles
GET    /profiles/:id                 - Obtener profile
POST   /profiles                     - Crear custom profile
PUT    /profiles/:id                 - Actualizar profile
DELETE /profiles/:id                 - Eliminar custom profile

GET    /hierarchy                    - Listar org profiles de agentes
GET    /hierarchy/tree               - Árbol jerárquico
GET    /hierarchy/:agentId           - Profile de agente
PUT    /hierarchy/:agentId           - Crear/actualizar profile de agente
DELETE /hierarchy/:agentId           - Eliminar profile de agente
GET    /hierarchy/:agentId/escalation-chain  - Cadena de escalación
GET    /hierarchy/:agentId/subordinates      - Subordinados

POST   /policies/decisions           - Consultar decisiones de política
GET    /policies/agent/:agentId      - Políticas efectivas del agente
```

### Eventos Organizacionales
| Evento | Descripción |
|--------|-------------|
| `org.task_delegated` | Tarea delegada a subordinado |
| `org.task_split` | Tarea dividida en subtareas |
| `org.task_escalated` | Tarea escalada a supervisor/humano |
| `org.human_notified` | Humano notificado |
| `org.policy_applied` | Política aplicada |

### Componentes
| Componente | Archivo | Función |
|------------|---------|---------|
| WorkProfileStore | `organization/WorkProfileStore.ts` | Gestión de work profiles |
| AgentHierarchyStore | `organization/AgentHierarchyStore.ts` | Jerarquía de agentes |
| TaskMemoryStore | `organization/TaskMemoryStore.ts` | Memoria de tareas |
| OrganizationalPolicyService | `organization/OrganizationalPolicyService.ts` | Motor de decisiones |

## 13. SystemDiagnosticsService

Servicio de diagnóstico integral del sistema.

### Archivo
`src/system/SystemDiagnosticsService.ts`

### Métodos Públicos
| Método | Descripción |
|--------|-------------|
| `getSystemHealth()` | Reporte completo con score 0-100, checks, issues, warnings |
| `getReadinessReport()` | Checklist de producción: OpenClaw, DB, circuits, etc. |
| `getCriticalIssues()` | Solo issues críticos |
| `getWarnings()` | Solo warnings |
| `getMetrics()` | Snapshot de métricas (tasks, agents, resources, resilience, openclaw) |

### Checks Realizados
| Categoría | Peso | Checks |
|-----------|------|--------|
| openclaw | 20 | Conexión, configuración |
| gateway | 15 | Status, latencia |
| tasks | 20 | Stuck tasks, retry loops, orphans |
| resilience | 15 | Leases, circuit breakers, orphan executions |
| resources | 10 | Pending drafts, approved not activated |
| channels | 5 | Channel bridge status |
| logging | 5 | Sistema de logs operacional |
| database | 10 | Conexión, latencia |

### Status
| Estado | Condición |
|--------|-----------|
| `healthy` | Score ≥ 80 y 0 critical issues |
| `degraded` | Score < 80 o warnings |
| `critical` | Score < 50 o critical issues > 0 |

### API Endpoints
```
GET /api/system/diagnostics  - Reporte completo de salud
GET /api/system/readiness    - Checklist de producción
GET /api/system/issues       - Issues críticos
GET /api/system/metrics      - Snapshot de métricas
```

### Tests
- `tests/systemDiagnostics.test.ts` - 26 tests

## 15. Sistema de Resiliencia de Ejecución

Sistema de protección contra doble ejecución, crash recovery y task orphaning.

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| ExecutionLeaseStore | `orchestrator/resilience/ExecutionLeaseStore.ts` | Leases para prevenir doble ejecución |
| CheckpointStore | `orchestrator/resilience/CheckpointStore.ts` | Estado de ejecución para recovery |
| ExecutionRecoveryService | `orchestrator/resilience/ExecutionRecoveryService.ts` | Recovery al startup y orphan detection |
| HealthChecker | `orchestrator/resilience/HealthChecker.ts` | Health checks del sistema |
| CircuitBreaker | `orchestrator/resilience/CircuitBreaker.ts` | Circuit breaker para OpenClaw |

### Flujo de Ejecución Protegido

```
TaskRouter.processNext()
    │
    ├── 1. Check hasActiveLease(taskId) → Si existe, SKIP
    │
    ├── 2. leaseStore.acquire(taskId, executionId)
    │       └── Si falla → SKIP (otra instancia lo tiene)
    │
    ├── 3. checkpointStore.getOrCreate(taskId)
    │       └── Track stage: queued → assigning → executing → completing
    │
    ├── 4. [Ejecutar task con OpenClaw]
    │       └── leaseStore.renew() cada 30s para operaciones largas
    │
    ├── 5. checkpointStore.savePartialResult() antes de completar
    │
    └── 6. leaseStore.release(taskId) al finalizar (success o error)
```

### Invariantes Garantizadas

1. **Una task no puede tener más de una ejecución activa** (lease único por taskId)
2. **Transiciones de estado inválidas se bloquean** (FSM validado en TaskService)
3. **Leases expirados pueden ser recuperados** (cleanup automático cada 30s)
4. **Recovery no duplica ejecuciones en curso** (verifica lease antes de retry)
5. **Retry registra causa y contador** (error en metadata)

### Lease Store API

```typescript
// Adquirir lease (falla si ya existe)
const lease = leaseStore.acquire(taskId, executionId);

// Verificar si task tiene lease activo
const hasLease = leaseStore.hasActiveLease(taskId);

// Renovar lease (para operaciones largas)
leaseStore.renew(taskId);

// Liberar lease
leaseStore.release(taskId);

// Forzar liberación (admin/recovery)
leaseStore.forceRelease(taskId);
```

### Checkpoint Store API

```typescript
// Crear/obtener checkpoint
const checkpoint = checkpointStore.getOrCreate(taskId, agentId);

// Actualizar stage
checkpointStore.updateStage(taskId, 'executing');

// Guardar resultado parcial
checkpointStore.savePartialResult(taskId, result);

// Marcar completado/fallido
checkpointStore.markCompleted(taskId, output);
checkpointStore.markFailed(taskId, error);
```

### Recovery Automático

Al iniciar OCAAS, `ExecutionRecoveryService.startupRecovery()`:

1. Libera leases expirados
2. Encuentra checkpoints resumibles
3. Re-encola tasks en stages intermedios (analyzing, assigning, etc.)
4. Pausa tasks stale (>10 min sin update) para revisión manual
5. Limpia checkpoints completados/fallidos antiguos

### Cleanup de Orphans

Cada 30 segundos, `TaskRouter.cleanupStaleExecutions()`:

1. Detecta leases sin checkpoint correspondiente
2. Detecta checkpoints con execution ID que no coincide con lease
3. Detecta leases para tasks en estado terminal
4. Libera estos leases orphan

### Tests de Resiliencia

```
✅ task-resilience.test.ts - 41 tests
  - ExecutionLeaseStore: 10 tests
  - CheckpointStore: 12 tests
  - FSM Transitions: 11 tests
  - Recovery Scenarios: 4 tests
  - Concurrent Prevention: 4 tests

✅ checkpoint-persistence.test.ts - 22 tests (NEW)
  - Persistent vs Transient Stages: 3 tests
  - Partial Result Persistence: 2 tests
  - Blocker/Resource/Approval Tracking: 4 tests
  - Recovery Queries: 3 tests
  - Export/Import: 2 tests
  - Stats/Observability: 1 test
  - Retry Tracking: 1 test
  - Cleanup: 2 tests
  - Recovery Scenarios: 4 tests
```

## 16. Persistencia de Checkpoints (NEW)

Los checkpoints críticos ahora se persisten a DB para sobrevivir reinicios.

### Tabla `task_checkpoints`

```sql
CREATE TABLE task_checkpoints (
  task_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  assigned_agent_id TEXT,
  current_stage TEXT NOT NULL,
  last_completed_step TEXT,
  progress_percent INTEGER DEFAULT 0,
  last_known_blocker TEXT,
  pending_approval TEXT,
  pending_resources TEXT,      -- JSON array
  last_openclaw_session_id TEXT,
  partial_result TEXT,          -- JSON
  status_snapshot TEXT,         -- JSON
  retry_count INTEGER DEFAULT 0,
  resumable INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Stages Persistentes vs Transitorios

| Tipo | Stages | Comportamiento |
|------|--------|----------------|
| **Persistent** | executing, awaiting_response, processing_result, paused, waiting_* | Se guardan en DB |
| **Transient** | queued, analyzing, assigning, spawning_session, completing | Solo RAM |
| **Terminal** | completed, failed | Se borran de DB |

### Flujo de Persistencia

```
1. Task entra en stage persistente → schedulePersist(taskId)
2. Debounce 1 segundo → persistToDb(taskId)
3. Task entra en stage terminal → deleteFromDb(taskId)
4. Shutdown → flushPendingPersists()
```

### Recovery al Startup

```
initializeResilience()
    │
    ├── initializeCheckpointStore()
    │       └── loadFromDb() → carga checkpoints de DB a RAM
    │
    └── startupRecovery()
            └── Procesa checkpoints cargados
```

### API del CheckpointStore

```typescript
// Control de persistencia (para tests)
store.setPersistenceEnabled(false);

// Flush manual
await store.flushPendingPersists();

// Cargar desde DB
await store.loadFromDb();
```

## 17. Mapa de Memoria del Sistema

### Memoria Crítica (Persistida)

| Store | Ubicación DB | Datos | Recovery |
|-------|-------------|-------|----------|
| Tasks | `tasks` | Estado, output, metadata | ✅ Completo |
| Checkpoints | `task_checkpoints` | Stage, progress, partialResult | ✅ Nuevo |
| Resource Drafts | `resource_drafts` | Borradores de recursos | ✅ Completo |

### Memoria Operacional (RAM)

| Store | Datos | Riesgo en Restart |
|-------|-------|------------------|
| ExecutionLeaseStore | Leases activos | ✅ Se recrean |
| QueueManager | Cola de tareas | ✅ Se reconstruye de DB |
| SessionManager | agentId → sessionId | ✅ Sesiones efímeras |
| TaskAnalyzer | Cache de análisis | ✅ Cache con TTL |
| HealthChecker | Health status | ✅ Se re-evalúa |

### Memoria de Configuración (Necesita Persistencia)

| Store | Datos | Estado |
|-------|-------|--------|
| AgentHierarchyStore | Jerarquía de agentes | ⚠️ Pendiente |
| WorkProfileStore | Custom work profiles | ⚠️ Pendiente |
| TaskMemoryStore | Historial de decisiones | ⚠️ Pendiente |

## 18. Sistema de Observabilidad (TaskTimelineService)

Visibilidad completa del estado del sistema, progreso de tareas, y detección de problemas.

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| TaskTimelineService | `system/TaskTimelineService.ts` | Timeline completo por task, detección de problemas |
| SystemDiagnosticsService | `system/SystemDiagnosticsService.ts` | Health checks, métricas, readiness |

### API Endpoints (NEW)

```
GET /api/system/overview                    - Vista general del sistema con problemas
GET /api/system/tasks/:taskId/timeline      - Timeline completo de una task
GET /api/system/problems                    - Todos los problemas detectados
GET /api/system/problems/stuck              - Tasks atascadas (>30 min sin progreso)
GET /api/system/problems/high-retry         - Tasks con muchos reintentos (>=3)
GET /api/system/problems/blocked            - Tasks bloqueadas (approval, resource, dependency)
```

### Task Timeline

Para cada task, el timeline incluye:

```typescript
interface TaskTimeline {
  taskId: string;
  taskTitle: string;
  currentStatus: string;
  currentStage?: string;  // Del checkpoint
  entries: TimelineEntry[];  // Eventos ordenados cronológicamente
  summary: {
    totalEvents: number;
    stateChanges: number;
    errors: number;
    retries: number;
    durationMs: number;
    currentBlocker?: string;
  };
  related: {
    agentId?: string;
    parentTaskId?: string;
    childTaskIds: string[];
    pendingApproval?: string;
    pendingResources: string[];
  };
}
```

### Tipos de Entradas en Timeline

| Tipo | Descripción | Fuente |
|------|-------------|--------|
| `event` | Evento genérico | events table |
| `state_change` | Cambio de estado | task/events |
| `checkpoint` | Estado del checkpoint | CheckpointStore |
| `error` | Error ocurrido | events/task |
| `retry` | Reintento detectado | task/checkpoint |
| `escalation` | Escalado/feedback | agent_feedback |
| `approval` | Evento de aprobación | events |
| `resource` | Evento de recurso | events |

### Detección de Problemas

#### Stuck Tasks
- Criterio: `status in (running, assigned)` && `updatedAt > 30 min ago`
- Información: duración atascada, checkpoint stage, blocker
- Acción sugerida: según contexto

#### High Retry Tasks
- Criterio: `retryCount >= 3` && `status not in (completed, cancelled)`
- Información: contador, último error, patrón detectado
- Patrones detectables: timeout repetido, error de conexión, mismo error

#### Blocked Tasks
- Criterio: checkpoint en `waiting_approval` o `waiting_resource`
- Tipos: approval, resource, dependency, external
- Información: qué está bloqueando, duración

### System Overview

```typescript
interface SystemOverview {
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    activeCount: number;
    problemCount: number;
  };
  problems: {
    stuck: StuckTaskInfo[];
    highRetry: HighRetryTaskInfo[];
    blocked: BlockedTaskInfo[];
  };
  recentActivity: {  // Última hora
    tasksCreated: number;
    tasksCompleted: number;
    tasksFailed: number;
    eventsEmitted: number;
  };
  health: {
    avgTaskDurationMs: number;
    successRate: number;  // 0-100
    errorRate: number;    // 0-100
  };
}
```

### Tests

```
✅ task-timeline.test.ts - 34 tests
  - Types: 3 tests
  - Configuration: 1 test
  - Entry Classification: 7 tests
  - Stuck Detection: 1 test
  - Blocker Detection: 5 tests
  - Suggested Actions: 5 tests
  - Retry Pattern Detection: 5 tests
  - Health Metrics: 4 tests
  - Timeline Sorting/Limiting: 2 tests
  - System Overview: 1 test
```

## 19. Sistema Human-in-the-Loop (HumanEscalationService)

Sistema formal de escalación a humano ("DIOS") con trazabilidad completa.

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| HumanEscalationService | `hitl/HumanEscalationService.ts` | Servicio central de escalaciones |
| Escalation API | `api/escalations/` | Endpoints REST para inbox humano |

### Tabla `human_escalations`

```sql
CREATE TABLE human_escalations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- approval_required, resource_missing, etc.
  priority TEXT NOT NULL,          -- low, normal, high, critical
  task_id TEXT,
  agent_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  reason TEXT NOT NULL,
  context TEXT,                    -- JSON
  checkpoint_stage TEXT,
  status TEXT NOT NULL,            -- pending, acknowledged, resolved, expired, cancelled
  acknowledged_at INTEGER,
  acknowledged_by TEXT,
  resolution TEXT,                 -- approved, rejected, resource_provided, overridden, timed_out
  resolution_details TEXT,         -- JSON
  resolved_at INTEGER,
  resolved_by TEXT,
  expires_at INTEGER,
  fallback_action TEXT,            -- retry, fail, escalate_higher, auto_approve, pause
  linked_approval_id TEXT,
  linked_feedback_id TEXT,
  metadata TEXT,                   -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### Tipos de Escalación

| Tipo | Descripción | Prioridad Default |
|------|-------------|-------------------|
| `approval_required` | Recurso necesita aprobación humana | normal |
| `resource_missing` | Falta un recurso que no se puede generar | high |
| `permission_denied` | Sin permisos para la acción | normal |
| `execution_failure` | Fallo de ejecución tras reintentos | high si ≥3 retries |
| `uncertainty` | Agente tiene dudas sobre cómo proceder | normal |
| `blocked` | Tarea bloqueada por razón externa | high |
| `timeout` | Operación excedió tiempo límite | normal |
| `policy_violation` | Acción viola políticas organizacionales | critical |

### Estado de Escalaciones (FSM)

```
pending → acknowledged → resolved
   ↓           ↓
expired    expired
   ↓           ↓
 (terminal)  (terminal)

pending → resolved (directa sin acknowledge)
pending → cancelled
```

### Resoluciones

| Resolución | Descripción | Efecto en Task |
|------------|-------------|----------------|
| `approved` | Humano aprueba la acción | Continúa, limpia blocker |
| `rejected` | Humano rechaza la acción | Depende del contexto |
| `resource_provided` | Humano provee el recurso faltante | Continúa, limpia blocker |
| `overridden` | Humano toma decisión manual | Continúa con decisión humana |
| `timed_out` | Expiró sin respuesta humana | Ejecuta fallback |
| `cancelled` | Escalación cancelada | Sin efecto |

### Fallback Actions (Timeout)

| Acción | Descripción |
|--------|-------------|
| `retry` | Re-encolar task para reintento |
| `fail` | Marcar task como fallida |
| `escalate_higher` | Crear escalación CRITICAL |
| `auto_approve` | Aprobar automáticamente (si linked_approval_id) |
| `pause` | Pausar task para revisión manual |

### API Endpoints

```
# Inbox Humano
GET  /api/escalations/inbox              - Inbox completo (pending + acknowledged + summary)
GET  /api/escalations/pending            - Solo escalaciones pendientes
GET  /api/escalations/stats              - Estadísticas de escalaciones

# CRUD
GET  /api/escalations                    - Listar con filtros (status, type, priority, taskId)
GET  /api/escalations/:id                - Obtener escalación
GET  /api/escalations/task/:taskId       - Escalaciones de una task
POST /api/escalations                    - Crear escalación manual

# Acknowledgment
POST /api/escalations/:id/acknowledge    - Marcar como vista

# Resolución
POST /api/escalations/:id/approve        - Aprobar
POST /api/escalations/:id/reject         - Rechazar (con razón opcional)
POST /api/escalations/:id/provide-resource - Proveer recurso (resourceId, resourceType)
POST /api/escalations/:id/override       - Override manual (decision, details)

# Mantenimiento
POST /api/escalations/process-expired    - Procesar escalaciones expiradas
POST /api/escalations/cleanup            - Limpiar antiguas (maxAgeMs opcional)
```

### Human Inbox

```typescript
interface HumanInbox {
  pending: EscalationDTO[];      // Ordenadas por prioridad
  acknowledged: EscalationDTO[];  // Vistas pero no resueltas
  summary: {
    totalPending: number;
    totalAcknowledged: number;
    byType: Record<string, number>;      // approval_required: 3, resource_missing: 1
    byPriority: Record<string, number>;  // critical: 1, high: 2, normal: 1
    oldestPendingAge?: number;           // ms desde la más antigua
    expiringCount: number;               // expiran en < 5 min
  };
}
```

### Integración con Timeline

Las escalaciones aparecen en el timeline de tasks:

```typescript
// En TaskTimeline.entries
{
  id: 'escalation_esc_123',
  type: 'escalation',
  timestamp: 1234567890,
  title: 'Escalation: Approval Required [Pending]',
  description: 'Skill generation requires approval',
  severity: 'warning',  // error si critical/expired
  data: { escalationId, type, priority, status }
}

// TaskTimeline.related incluye:
pendingEscalations: ['esc_123', 'esc_456']
```

### Integración con Blocked Tasks

`TaskTimelineService.getBlockedTasks()` incluye blocker type `escalation`:

```typescript
{
  taskId: 'task_123',
  title: 'Process data',
  status: 'running',
  blockerType: 'escalation',
  blockerDetails: 'Awaiting human response: Missing skill [resource_missing]',
  blockedSinceMs: 120000,
  suggestedAction: 'Respond to escalation esc_456 in human inbox'
}
```

### Métodos de Convenience

```typescript
// Crear escalación por tipo
await escalationService.escalateForApproval(approvalId, taskId, reason);
await escalationService.escalateForMissingResource(taskId, resourceType, requirement);
await escalationService.escalateForFailure(taskId, error, retryCount);
await escalationService.escalateForUncertainty(taskId, agentId, question, options);
await escalationService.escalateForBlocked(taskId, agentId, reason);
```

### Tests

```
✅ human-escalation.test.ts - 41 tests
  - Escalation Types: 5 tests
  - State Machine: 7 tests
  - Human Inbox: 5 tests
  - Resolution Handling: 4 tests
  - Timeout/Fallback: 6 tests
  - Multiple Escalations: 2 tests
  - Statistics: 4 tests
  - Timeline Integration: 4 tests
  - Convenience Methods: 4 tests
```

## 20. Smart Decision Engine (NEW)

Sistema de decisiones inteligente con enfoque heurísticas-primero para reducir dependencia de LLM y aumentar consistencia.

### Arquitectura

```
Task llega a DecisionEngine
        │
        ├── 1. Check Cache → Si hay decisión cacheada, retorna
        │
        ├── 2. Evaluate Heuristics → 8 reglas en orden de prioridad
        │       └── Si alguna regla decide con confianza ≥ mínimo, retorna
        │
        ├── 3. LLM con Tier apropiado
        │       ├── SHORT (~100 tokens): clasificación rápida
        │       ├── MEDIUM (~500 tokens): decisión estándar
        │       └── DEEP (~1500 tokens): planificación compleja
        │
        └── 4. Fallback → Decisión segura si todo falla
```

### Componentes

| Componente | Archivo | Función |
|------------|---------|---------|
| SmartDecisionEngine | `orchestrator/decision/SmartDecisionEngine.ts` | Motor principal con pipeline |
| HeuristicRules | `orchestrator/decision/HeuristicRules.ts` | 8 reglas heurísticas |
| PromptTiers | `orchestrator/decision/PromptTiers.ts` | Prompts SHORT/MEDIUM/DEEP |
| types.ts | `orchestrator/decision/types.ts` | Tipos y configuración |

### Reglas Heurísticas (Orden de Prioridad)

| # | Regla | Condición | Resultado |
|---|-------|-----------|-----------|
| 1 | `direct_type_match` | Agent capability = task type | assign |
| 2 | `single_agent` | Solo 1 agente activo + task no crítica | assign |
| 3 | `specialist_match` | Specialist con capabilities matching | assign |
| 4 | `no_agents` | 0 agentes activos | escalate |
| 5 | `critical_task` | Priority ≥ 4 | assign (si buen match) o escalate |
| 6 | `subtask_match` | Task tiene parentTaskId | assign por capability |
| 7 | `retry_limit` | retryCount ≥ 3 | escalate |
| 8 | `general_capability` | Match por capabilities inferidas | assign |

### Prompt Tiers

| Tier | Max Tokens | Timeout | Cuándo Usar |
|------|------------|---------|-------------|
| SHORT | 256 | 5s | Tasks simples con tipo definido |
| MEDIUM | 512 | 10s | Mayoría de tasks, descripción larga |
| DEEP | 1536 | 30s | Priority ≥ 4, input data complejo |

### Structured Decision (Output)

```typescript
interface StructuredDecision {
  id: string;
  taskId: string;
  decidedAt: number;

  // Core
  decisionType: 'assign' | 'subdivide' | 'create_resource' | 'escalate' | 'wait' | 'reject';
  targetAgent?: string;
  requiresEscalation: boolean;
  confidenceScore: number;      // 0-1
  confidenceLevel: 'high' | 'medium' | 'low';
  reasoning: string;

  // Método
  method: 'heuristic' | 'cached' | 'llm_classify' | 'llm_decide' | 'llm_plan' | 'fallback';
  llmTier?: 'short' | 'medium' | 'deep';
  heuristicsAttempted: boolean;

  // Detalles
  agentScores?: AgentScore[];
  suggestedActions: DecisionAction[];
  missingCapabilities?: string[];
  subtasks?: SubtaskPlan[];

  // Meta
  processingTimeMs: number;
  fromCache: boolean;
  cacheKey?: string;
}
```

### Decision Cache

| Config | Default | Descripción |
|--------|---------|-------------|
| `enableCache` | true | Habilitar cache |
| `cacheMaxSize` | 500 | Máximo entries |
| `cacheTTL` | 5 min | TTL default |
| `minConfidenceForHeuristic` | 0.7 | Mínimo para cachear |

**No se cachea:**
- Decisiones con `confidenceScore < 0.5`
- Decisiones de `escalate`
- Tasks críticas (priority 4)

### Capability Matching

Matching semántico con sinónimos:

```typescript
// Ejemplo: 'programming' matches 'coding'
const CAPABILITY_SYNONYMS = {
  'coding': ['programming', 'development', 'code', 'software'],
  'testing': ['test', 'qa', 'quality', 'unit-test'],
  'deployment': ['deploy', 'release', 'ci-cd', 'devops'],
  // ... más grupos
};
```

### Uso

```typescript
import { getSmartDecisionEngine } from './orchestrator/decision/index.js';

const engine = getSmartDecisionEngine();
const decision = await engine.decide(task, agents);

// Métricas
const metrics = engine.getMetrics();
console.log(`Heuristic rate: ${metrics.heuristicDecisions / metrics.totalDecisions}`);

// Cache stats
const cacheStats = engine.getCacheStats();
console.log(`Cache hit rate: ${cacheStats.hitRate}`);
```

### Métricas

```typescript
interface DecisionMetrics {
  totalDecisions: number;
  heuristicDecisions: number;
  cachedDecisions: number;
  llmDecisions: { short: number; medium: number; deep: number };
  fallbackDecisions: number;
  averageConfidence: number;
  averageProcessingTimeMs: number;
  byDecisionType: Record<DecisionType, number>;
}
```

### Events

| Evento | Descripción |
|--------|-------------|
| `decision.task_started` | Inicio de proceso de decisión |
| `decision.task_completed` | Decisión completada |
| `decision.heuristic_applied` | Regla heurística aplicada |
| `decision.llm_invoked` | LLM invocado |
| `decision.cache_hit` | Cache hit |
| `decision.fallback_used` | Fallback usado |

### Tests

```
✅ HeuristicRules.test.ts - 21 tests
✅ PromptTiers.test.ts - 28 tests
✅ SmartDecisionEngine.test.ts - 25 tests
✅ DecisionEngine.integration.test.ts - 18 tests

TOTAL: 92 tests
```

## 21. Integración DecisionEngine + SmartDecisionEngine

### Arquitectura de Integración

```
TaskRouter
    │
    └── DecisionEngine.makeIntelligentDecision(task)
            │
            ├── getSmartDecisionEngine().decide(task, agents)
            │       │
            │       ├── 1. Check Cache
            │       ├── 2. Evaluate Heuristics (8 rules)
            │       ├── 3. LLM Tier Selection (if needed)
            │       └── 4. Fallback Decision
            │
            ├── handleEscalation() → HITL Service (if requiresEscalation)
            │
            └── convertToIntelligentDecision() → IntelligentDecision (backward compat)
```

### Flujo de Decisión

1. **TaskRouter** llama a `DecisionEngine.makeIntelligentDecision(task)`
2. **DecisionEngine** obtiene agentes activos y delega a **SmartDecisionEngine**
3. **SmartDecisionEngine** ejecuta el pipeline:
   - Cache → Heuristics → LLM → Fallback
4. Si `requiresEscalation = true`, se crea escalación en **HumanEscalationService**
5. **DecisionEngine** convierte `StructuredDecision` a `IntelligentDecision` para compatibilidad

### Conversión de Tipos

| StructuredDecision | IntelligentDecision |
|--------------------|---------------------|
| `decisionType: 'assign'` | `assignment: TaskAssignment` |
| `decisionType: 'subdivide'` | `suggestedActions: [{action: 'subdivide'}]` |
| `decisionType: 'escalate'` | `suggestedActions: [{action: 'wait_approval'}]` |
| `confidenceScore` | `analysis.confidence` |
| `reasoning` | `analysis.intent` |
| `missingCapabilities` | `missingReport` |
| `subtasks` | `analysis.suggestedSubtasks` |

### Logging Enriquecido

Cada decisión ahora incluye logs con:

```typescript
logger.info({
  taskId: task.id,
  decisionId: structuredDecision.id,
  decisionType: structuredDecision.decisionType,   // assign, escalate, subdivide, etc.
  method: structuredDecision.method,               // heuristic, cached, llm_classify, etc.
  llmTier: structuredDecision.llmTier,             // short, medium, deep (if LLM used)
  confidenceScore: structuredDecision.confidenceScore,
  confidenceLevel: structuredDecision.confidenceLevel,
  fromCache: structuredDecision.fromCache,         // true/false
  processingTimeMs: structuredDecision.processingTimeMs,
  targetAgent: structuredDecision.targetAgent,
  requiresEscalation: structuredDecision.requiresEscalation,
}, 'Smart decision made');
```

### API de DecisionEngine

```typescript
class DecisionEngine {
  // Principal - usa SmartDecisionEngine
  async makeIntelligentDecision(task: TaskDTO): Promise<IntelligentDecision>;

  // Métricas
  getDecisionMetrics(): DecisionMetrics;
  getDecisionCacheStats(): { size: number; maxSize: number; hitRate: number };

  // Control
  clearDecisionCache(): void;
  updateDecisionConfig(config: Partial<SmartDecisionEngineConfig>): void;

  // Legacy (deprecated)
  async makeIntelligentDecisionLegacy(task: TaskDTO): Promise<IntelligentDecision>;
}
```

### Integración con HITL

Cuando `requiresEscalation = true`, se crea automáticamente una escalación:

```typescript
// Tipo de escalación según contexto
- APPROVAL_REQUIRED: default
- RESOURCE_MISSING: si hay missingCapabilities
- UNCERTAINTY: si confidenceScore < 0.4

// Prioridad según task.priority y confidence
- CRITICAL: task.priority >= 4
- HIGH: task.priority >= 3 || confidenceScore < 0.3
- NORMAL: default
```

## 22. Cost Optimization (SmartDecisionEngine) (NEW)

Sistema de optimización de costes LLM con modos de operación configurables en runtime.

### Arquitectura de Costes

```
SmartDecisionEngine
    │
    ├── OperationMode: economy | balanced | max_quality
    │
    ├── CostTracker (singleton)
    │       ├── recordLLMUsage(tier, tokens?)
    │       ├── recordSavings(tier, 'heuristic' | 'cache')
    │       ├── recordCacheHit/Miss(decisionType)
    │       └── getMetrics() → CostMetrics
    │
    └── Decision Pipeline (respeta OperationMode)
            ├── 1. Cache (TTL × ttlMultiplier)
            ├── 2. Heuristics (threshold según mode)
            ├── 3. LLM (max tier según mode, compact prompts en economy)
            └── 4. Fallback
```

### Modos de Operación

| Modo | Descripción | Casos de Uso |
|------|-------------|--------------|
| `economy` | Minimizar uso LLM, cache agresivo | Desarrollo, testing, alto volumen |
| `balanced` | Balance coste/calidad (default) | Producción normal |
| `max_quality` | Maximizar calidad, LLM libre | Tareas críticas, auditorías |

### Configuración por Modo

| Parámetro | economy | balanced | max_quality |
|-----------|---------|----------|-------------|
| `heuristicConfidenceThreshold` | 0.5 | 0.7 | 0.85 |
| `maxLLMTier` | SHORT | MEDIUM | DEEP |
| `cacheConfig.ttlMultiplier` | 2.0 | 1.0 | 0.5 |
| `cacheConfig.minConfidenceToCache` | 0.4 | 0.5 | 0.7 |
| `skipLLMOnRetry` | ✅ | ✅ | ❌ |
| `skipLLMOnExactMatch` | ✅ | ✅ | ❌ |
| `forceHeuristicsForKnownTypes` | ✅ | ❌ | ❌ |
| `useCompactPrompts` | ✅ | ❌ | ❌ |

### Token Costs (Estimación)

```typescript
const TOKEN_COSTS = {
  inputTokens: { short: 150, medium: 400, deep: 1200 },
  outputTokens: { short: 100, medium: 250, deep: 800 },
  costPer1KTokens: { input: 0.003, output: 0.015 },  // USD
};
```

### LLM Avoidance Strategies

1. **Skip on Retry**: Si `retryCount > 0`, usar heurísticas (economy, balanced)
2. **Skip on Exact Match**: Si agent.capabilities incluye task.type
3. **Force Heuristics for Known Types**: coding, testing, documentation, analysis, research
4. **Compact Prompts**: Prompts minimizados en economy (~128 tokens max)
5. **Cache con TTL multiplicado**: Decisiones válidas más tiempo en economy

### CostMetrics

```typescript
interface CostMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUSD: number;
  byTier: {
    short: { count, inputTokens, outputTokens, cost };
    medium: { count, inputTokens, outputTokens, cost };
    deep: { count, inputTokens, outputTokens, cost };
  };
  tokensSaved: number;
  costSavedUSD: number;
  llmAvoidanceRate: number;  // 0-1, % de decisiones que evitaron LLM
}
```

### CacheMetrics

```typescript
interface CacheMetrics {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;  // 0-1
  evictions: number;
  byDecisionType: Record<DecisionType, { hits: number; misses: number }>;
}
```

### API de Cost Management

```typescript
const engine = getSmartDecisionEngine();

// Cambiar modo en runtime
engine.setOperationMode(OPERATION_MODE.ECONOMY);
engine.setOperationMode(OPERATION_MODE.MAX_QUALITY);

// Obtener modo actual
const mode = engine.getOperationMode();
const config = engine.getOperationModeConfig();

// Métricas extendidas (incluye cost y cache)
const metrics = engine.getExtendedMetrics();
console.log(`Total cost: ${metrics.cost.estimatedCostUSD}`);
console.log(`Saved: ${metrics.cost.costSavedUSD}`);
console.log(`LLM avoidance: ${metrics.cost.llmAvoidanceRate * 100}%`);
console.log(`Cache hit rate: ${metrics.cache.hitRate * 100}%`);

// Summary para logging
const summary = engine.getCostSummary();
// { mode, totalCost: '$0.0045', totalSaved: '$0.0120', llmAvoidanceRate: '75.0%', ... }

// Reset cost tracking
engine.resetCostTracking();
```

### Via DecisionEngine Facade

```typescript
const decisionEngine = getDecisionEngine();

// Todos los métodos de cost están disponibles
decisionEngine.setOperationMode(OPERATION_MODE.ECONOMY);
decisionEngine.getExtendedMetrics();
decisionEngine.getCostSummary();
```

### Compact Prompts (Economy Mode)

En modo economy, se usan prompts compactos:

```
System: Task classifier. JSON only.
Output: {"category":"...","type":"...","caps":[...],"decompose":bool,"humanReview":bool,"confidence":0.0-1.0}

User: T: Build login page
Type: coding, P: 2
Agents: 3, Caps: coding,testing,frontend
```

~128 tokens vs ~500 tokens del prompt MEDIUM normal.

### Events con Cost Info

Las decisiones ahora emiten eventos con información de costes:

```typescript
{
  type: 'decision.task_completed',
  data: {
    // ... campos existentes ...
    operationMode: 'economy',
    llmTier: 'short',
    costInfo: {
      inputTokens: 150,
      outputTokens: 100,
      estimatedCostUSD: 0.00195,
      savedByHeuristic: false,
      savedByCache: false,
    },
    costSummary: {
      totalCost: '$0.0045',
      totalSaved: '$0.0120',
      llmAvoidanceRate: '75.0%',
      cacheHitRate: '45.0%',
    }
  }
}
```

### Tests

```
✅ CostOptimization.test.ts - 44 tests
  - CostTracker: 14 tests
  - Operation Mode Configuration: 12 tests
  - SmartDecisionEngine Operation Modes: 10 tests
  - LLM Avoidance Strategies: 8 tests

TOTAL Decision Engine: 106 tests (62 + 44)
```

## 23. Deploy Hardening

### Problema Resuelto
Scripts npm (doctor, bootstrap, smoke-test) no cargaban .env automáticamente, requiriendo `export $(cat .env | xargs)` manual.

### Solución Implementada

#### Auto-carga de .env
Todos los scripts CLI ahora cargan .env automáticamente al inicio:

```typescript
// En doctor.ts, startup.ts, smoke-test.ts
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envPaths = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'backend', '.env'),
  resolve(import.meta.dirname, '..', '..', '.env'),
];
for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    break;
  }
}
```

#### Validación de Startup
Nuevo módulo `bootstrap/validate.ts` ejecutado antes de iniciar:

```typescript
// Validaciones:
// 1. OPENCLAW_GATEWAY_URL - obligatorio, formato URL válido
// 2. API_SECRET_KEY - obligatorio, mínimo 16 caracteres
// 3. Puerto disponible (no en uso)
// 4. Directorios logs/ y data/ existen y son escribibles
// 5. Acceso a DB (crea directorio si no existe)

await validateOrExit(logger);  // En index.ts antes de initDatabase()
```

#### Smoke Test Corregido
- `priority` enviado como `number` (1-5), no string
- Header `X-CHANNEL-SECRET` incluido en test de canales

#### Deploy Script
Nuevo `scripts/deploy_production.sh`:

```bash
./scripts/deploy_production.sh           # Deploy completo
./scripts/deploy_production.sh --skip-build  # Sin rebuild
./scripts/deploy_production.sh --clean   # Limpia node_modules/dist
```

Funcionalidad:
1. Valida Node.js v18+
2. Valida .env existe y variables críticas
3. Crea directorios logs/ y data/
4. npm install
5. npm run build
6. Detiene proceso existente en puerto
7. Inicia servicio con nohup
8. Valida health check
9. Ejecuta smoke test

#### Archivos Modificados/Creados

| Archivo | Cambio |
|---------|--------|
| `bootstrap/doctor.ts` | Auto-carga .env |
| `bootstrap/startup.ts` | Auto-carga .env |
| `scripts/smoke-test.ts` | Auto-carga .env, priority como number, X-CHANNEL-SECRET |
| `bootstrap/validate.ts` | **NUEVO** - Validación de startup |
| `index.ts` | Llama validateOrExit() |
| `scripts/deploy_production.sh` | **NUEVO** - Script de deploy |

### Resultado
El sistema ahora:
- Arranca sin pasos manuales ocultos
- Funciona sin `export` manual de .env
- Pasa smoke test correctamente
- Valida configuración antes de iniciar
- Proporciona logs claros de errores de configuración

## 24. Resource Layer

### Objetivo
Capa de abstracción unificada para Skills y Tools sin romper endpoints existentes.

### Arquitectura

```
                    ┌─────────────────────┐
                    │   /api/resources    │  ← NUEVO endpoint unificado
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   ResourceService   │  ← Facade sobre servicios existentes
                    └──────────┬──────────┘
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
┌──────────▼──────────┐              ┌─────────────▼─────────────┐
│    SkillService     │              │       ToolService         │
│  /api/skills (sin   │              │    /api/tools (sin        │
│     cambios)        │              │       cambios)            │
└─────────────────────┘              └───────────────────────────┘
```

### Tipos Unificados

```typescript
type ResourceType = 'skill' | 'tool';

interface BaseResource {
  id: string;
  type: ResourceType;
  name: string;
  description?: string;
  version: string;
  status: string;
  path: string;
  config?: Record<string, unknown>;
  syncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

interface SkillResource extends BaseResource {
  type: 'skill';
  capabilities?: string[];
  requirements?: string[];
}

interface ToolResource extends BaseResource {
  type: 'tool';
  toolType: ToolType;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  executionCount: number;
  lastExecutedAt?: number;
}
```

### Endpoints

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/resources` | GET | Lista todos (skills + tools) |
| `/api/resources/:id` | GET | Obtener recurso por ID |
| `/api/resources/counts` | GET | Conteos por tipo |
| `/api/resources/search?q=` | GET | Buscar por nombre |
| `/api/resources/agent/:agentId` | GET | Recursos de un agente |

**Nota**: `/api/skills` y `/api/tools` siguen funcionando sin cambios.

### Archivos

```
backend/src/resources/
├── index.ts           # Exports públicos
├── ResourceTypes.ts   # Tipos unificados
├── ResourceMapper.ts  # Transformación DTO → Resource
└── ResourceService.ts # Servicio unificado

backend/src/api/resources/
├── routes.ts          # Rutas Fastify
└── handlers.ts        # Handlers

backend/tests/resources/
└── ResourceLayer.test.ts  # 19 tests
```

### Uso

```typescript
import { getResourceService } from './resources/index.js';

// Obtener todos los recursos
const { skills, tools, total } = await getResourceService().getAllResources();

// Filtrar por tipo
const skillsOnly = await getResourceService().getResourcesByType('skill');

// Buscar
const results = await getResourceService().searchByName('parser');

// Type guards
import { isSkillResource, isToolResource } from './resources/index.js';
if (isSkillResource(resource)) {
  console.log(resource.capabilities);
}
```

### Tests

```
✅ ResourceLayer.test.ts - 19 tests
  - ResourceTypes: 7 tests
  - ResourceMapper: 8 tests
  - Integration: 4 tests
```

## 25. Tool Enhancement (Typed Configs & Validation)

### Objetivo
Convertir Tools en entidades de primera clase con configuraciones tipadas y validación completa.

### Tipos de Tool

| Tipo | Descripción | Campos Config |
|------|-------------|---------------|
| `script` | Scripts ejecutables (Node.js, Python, etc.) | entrypoint, runtime, envVars, timeoutMs |
| `binary` | Ejecutables binarios | binaryPath, argsTemplate, shell |
| `api` | Llamadas HTTP a APIs externas | method, url, headers, auth, bodyTemplate |

### Configuraciones Tipadas

```typescript
// ScriptToolConfig
interface ScriptToolConfig {
  entrypoint?: string;      // 'index.js', 'main.py'
  runtime?: string;         // 'node', 'python3', 'bash'
  argsTemplate?: string;    // '--input {{input}}'
  workingDirectory?: string;
  envVars?: Record<string, string>;
  timeoutMs?: number;       // default: 30000
  captureStderr?: boolean;  // default: true
}

// BinaryToolConfig
interface BinaryToolConfig {
  binaryPath?: string;      // '/usr/bin/tool'
  argsTemplate?: string;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  shell?: boolean;          // default: false
  timeoutMs?: number;
}

// ApiToolConfig
interface ApiToolConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  queryTemplate?: Record<string, string>;
  timeoutMs?: number;
  followRedirects?: boolean;
  responseType?: 'json' | 'text' | 'binary';
  auth?: {
    type: 'bearer' | 'basic' | 'api_key';
    value?: string;
    headerName?: string;  // Para api_key
  };
}
```

### ToolValidationService

Servicio de validación con scoring y sugerencias:

```typescript
interface ToolValidationResult {
  valid: boolean;
  score: number;           // 0-100
  issues: ValidationIssue[];
  suggestions: string[];
}

interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  code?: string;
}
```

### API Endpoints

```
POST /api/tools/validate              - Validar tool antes de crear
POST /api/tools/validate-config       - Validar solo config
POST /api/tools/:id/validate          - Validar tool existente
```

### Validaciones Realizadas

| Categoría | Checks |
|-----------|--------|
| **Requeridos** | name, path no vacíos |
| **Config** | Campos válidos para el tipo, sin campos desconocidos |
| **Schemas** | inputSchema/outputSchema son JSON Schema válidos |
| **Recomendaciones** | description, version, runtime (para scripts), url (para API) |

### Frontend Tool Editor

Componente `<ToolEditor>` con formularios específicos por tipo:

```tsx
<ToolEditor
  tool={existingTool}      // undefined para crear
  onSave={handleSave}
  onCancel={handleCancel}
  loading={isPending}
/>
```

Incluye:
- Selector de tipo con icono
- Formulario base (name, path, description, version)
- Formulario de config según tipo seleccionado
- Validación en tiempo real
- Visualización de issues y sugerencias

### Archivos

```
backend/src/types/tool-config.ts           # Tipos y Zod schemas
backend/src/services/ToolValidationService.ts  # Servicio de validación
backend/src/api/tools/schemas.ts           # Schemas actualizados
backend/src/api/tools/handlers.ts          # Handlers de validación
backend/src/api/tools/routes.ts            # Rutas de validación

frontend/src/types/index.ts                # Tipos de config
frontend/src/lib/api.ts                    # API de validación
frontend/src/components/tools/ToolEditor.tsx  # Editor con forms

backend/tests/tools/ToolValidation.test.ts    # 34 tests
```

### Compatibilidad

- **Backwards compatible**: Config vacío/null sigue siendo válido
- **Flexible**: Acepta configs legacy sin tipo estricto
- **Progresivo**: Las validaciones son warnings, no errores bloqueantes

### Tests

```
✅ ToolValidation.test.ts - 34 tests
  - Tool Config Types: 11 tests
  - ToolValidationService: 14 tests
  - Zod Schemas: 9 tests
✅ SkillTools.test.ts - 19 tests (NEW)
  - Skill Tool Link types
  - Validation, Ordering, Duplicates
  - Roles, Config overrides
```

## 26. Skill-Tool Composition

### Objetivo
Convertir Skills en entidades funcionales mediante composición de Tools.

### Tabla skill_tools

```sql
CREATE TABLE skill_tools (
  skill_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  role TEXT,
  config TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (skill_id, tool_id)
);
```

### Modelo SkillToolLink

```typescript
interface SkillToolLink {
  toolId: string;
  orderIndex: number;      // Orden de ejecución
  required: boolean;       // Si el tool es obligatorio
  role?: string;           // 'primary', 'fallback', 'preprocessing', etc.
  config?: Record<string, unknown>;  // Config override para este tool
  createdAt: number;
}
```

### API Endpoints

```
GET    /api/skills/:id/tools         - Get linked tools
PUT    /api/skills/:id/tools         - Replace all tools
POST   /api/skills/:id/tools         - Add a tool
PATCH  /api/skills/:id/tools/:toolId - Update tool link
DELETE /api/skills/:id/tools/:toolId - Remove tool
```

### Ejemplos de Uso

```bash
# Obtener tools de una skill (con detalles expandidos)
curl localhost:3001/api/skills/skill_123/tools?expand=tool

# Asociar un tool a una skill
curl -X POST localhost:3001/api/skills/skill_123/tools \
  -H "Content-Type: application/json" \
  -d '{"toolId": "tool_456", "orderIndex": 0, "required": true}'

# Reemplazar todos los tools
curl -X PUT localhost:3001/api/skills/skill_123/tools \
  -H "Content-Type: application/json" \
  -d '{"tools": [
    {"toolId": "tool_1", "orderIndex": 0},
    {"toolId": "tool_2", "orderIndex": 1, "role": "fallback"}
  ]}'
```

### Frontend SkillEditor

Componente `<SkillEditor>` con:

- Formulario base (name, path, description, version, capabilities, requirements)
- Selector de tools disponibles
- Lista de tools asociados con drag/reorder
- Toggle required/optional por tool
- Campo de rol opcional

### Validaciones

| Validación | Descripción |
|------------|-------------|
| toolId existe | El tool referenciado debe existir en DB |
| Sin duplicados | No repetir mismo tool en una skill |
| Orden consistente | orderIndex mantiene secuencia lógica |
| Skill vacía | Skills sin tools emiten warning (no error) |

### Archivos

```
backend/src/db/schema/skillTools.ts       # Drizzle schema
backend/src/db/index.ts                   # Migración tabla
backend/src/types/domain.ts               # SkillToolLink, SkillToolExpanded
backend/src/services/SkillService.ts      # Métodos skill-tool
backend/src/api/skills/schemas.ts         # Zod schemas para API
backend/src/api/skills/handlers.ts        # Handlers skill tools
backend/src/api/skills/routes.ts          # Rutas skill tools

frontend/src/types/index.ts               # Tipos frontend
frontend/src/lib/api.ts                   # API client métodos
frontend/src/components/skills/SkillEditor.tsx  # Editor con tools
frontend/src/pages/Skills.tsx             # Página actualizada

backend/tests/skills/SkillTools.test.ts   # 19 tests
```

### Compatibilidad

- **Backwards compatible**: Skills sin tools siguen funcionando
- **Incremental**: Composición es opcional, no requerida
- **No invasivo**: No toca TaskRouter ni ejecución actual

## 27. Skill Execution System

Sistema de ejecución de Skills como pipelines de Tools, sin romper el flujo actual del sistema.

### Arquitectura

```
POST /api/skills/:id/execute
         ↓
SkillExecutionService.execute()
         ↓
┌─────────────────────────────────┐
│ PipelineContext                  │
│ - executionId                    │
│ - currentOutput (chained)        │
│ - log entries                    │
│ - stopOnError flag              │
└─────────────────────────────────┘
         ↓
ToolInvoker.invoke() [for each tool in order]
         ↓
┌─────────────────────────────────┐
│ Tool Type                        │
│ - script: spawn(runtime, entry)  │
│ - binary: spawn(path, args)      │
│ - api: fetch(url, options)       │
└─────────────────────────────────┘
         ↓
SkillExecutionResult
```

### Modos de Ejecución

| Modo | Comportamiento |
|------|----------------|
| `run` | Ejecuta los tools realmente |
| `validate` | Solo valida inputs y disponibilidad |
| `dry_run` | Simula ejecución sin side effects |

### API Endpoints

```
POST /api/skills/:id/execute
Body: { mode, input, context, timeoutMs, stopOnError, caller }
Response: SkillExecutionResult

POST /api/skills/:id/validate-execution
Body: { input }
Response: SkillValidationResult

GET /api/skills/:id/execution-preview
Response: SkillExecutionPreview (pipeline, blockers, warnings)
```

### Tipos

```typescript
interface SkillExecutionResult {
  executionId: string;
  skillId: string;
  skillName: string;
  mode: 'run' | 'validate' | 'dry_run';
  status: 'success' | 'failed' | 'cancelled';
  toolResults: ToolExecutionResult[];
  output?: Record<string, unknown>;
  error?: string;
  toolsExecuted: number;
  toolsSucceeded: number;
  toolsFailed: number;
  toolsSkipped: number;
  totalDurationMs: number;
}

interface ToolExecutionResult {
  toolId: string;
  toolName: string;
  status: 'success' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  required: boolean;
  role?: string;
  orderIndex: number;
}
```

### Output Chaining

Los outputs se acumulan secuencialmente:
```
Tool 1 output: { step1: 'done', value: 10 }
Tool 2 input:  { step1: 'done', value: 10 }  (output from Tool 1)
Tool 2 output: { step2: 'done', result: 20 }
Final output:  { step1: 'done', value: 10, step2: 'done', result: 20 }
```

### Error Handling

| Escenario | Comportamiento |
|-----------|----------------|
| Required tool fails | Pipeline fails, remaining tools skipped |
| Optional tool fails | Continue with next tool |
| Timeout | Pipeline fails with timeout error |
| stopOnError: false | Continue even if required tools fail |

### Frontend

- **SkillExecutionPanel**: Preview, validate, dry-run, execute
- **Skills page**: Execute button (green play icon)
- Input editor with JSON validation
- Real-time pipeline visualization
- Collapsible tool result details

### Archivos

```
backend/src/skills/execution/
├── index.ts                    # Exports
├── SkillExecutionTypes.ts      # All types
├── SkillExecutionService.ts    # Main service
└── ToolInvoker.ts              # Tool invocation abstraction

backend/src/api/skills/
├── schemas.ts                  # ExecuteSkillSchema, ValidateExecutionSchema
├── handlers.ts                 # executeSkill, validateExecution, getExecutionPreview
└── routes.ts                   # Routes added

frontend/src/components/skills/
└── SkillExecutionPanel.tsx     # Execution UI

backend/tests/skills/
└── SkillExecution.test.ts      # 26 tests
```

### Compatibilidad

- **No invasivo**: No modifica TaskRouter ni ejecución de agentes
- **Independiente**: Skills se pueden ejecutar sin agentes
- **Seguro**: Dry-run y validate para pre-validación

## 28. Frontend ↔ Backend Integration Fix

Corrección de desalineación entre frontend y backend.

### Problemas Corregidos

| Problema | Causa | Solución |
|----------|-------|----------|
| `POST /api/tools/validate` 404 | Rutas estáticas después de parametrizadas | Reordenar en routes.ts |
| `POST /api/tools/:id/validate` 404 | Mismo problema de orden | Rutas estáticas primero |
| Editar Agent falla | No había UI de edición | Añadir modal Edit en Agents.tsx |
| Delete Agent 400 | Faltaba manejo de error en frontend | Añadir onError handler |

### Orden Correcto de Rutas Fastify

```typescript
// IMPORTANTE: Rutas estáticas ANTES de parametrizadas
fastify.post('/validate', h.validateNew);      // ✅ Primero
fastify.post('/validate-config', h.validateConfig);
fastify.get('/:id', h.get);                    // Después
fastify.post('/:id/validate', h.validateExisting);
```

### Archivos Modificados

```
backend/src/api/tools/routes.ts     # Reordenar rutas
frontend/src/pages/Agents.tsx       # Añadir edición
frontend/src/pages/AgentDetail.tsx  # Añadir edición
backend/tests/integration/APIIntegration.test.ts  # 19 tests
```

### Operaciones UI Funcionando

| Operación | Página | Endpoint |
|-----------|--------|----------|
| Crear Agent | /agents | POST /api/agents |
| Editar Agent | /agents, /agents/:id | PATCH /api/agents/:id |
| Activar Agent | /agents, /agents/:id | POST /api/agents/:id/activate |
| Desactivar Agent | /agents, /agents/:id | POST /api/agents/:id/deactivate |
| Borrar Agent | /agents, /agents/:id | DELETE /api/agents/:id |
| Cargar Skill Tools | SkillEditor | GET /api/skills/:id/tools?expand=tool |
| Guardar Skill Tools | SkillEditor | PUT /api/skills/:id/tools |
| Validar Tool | ToolEditor | POST /api/tools/validate |
| Validar Tool existente | ToolEditor | POST /api/tools/:id/validate |

## 29. Source/Build Sync Diagnostic (2026-04-02)

### Problema Identificado

Errores 404/400 en runtime a pesar de que el source code contenía las rutas correctas.

### Causa Raíz

**Desalineación source vs dist**: El TypeScript source estaba actualizado pero `npm run build` no se había ejecutado, resultando en JavaScript compilado obsoleto.

| Archivo | Source Modificado | Dist Modificado | Estado |
|---------|-------------------|-----------------|--------|
| `backend/src/api/tools/routes.ts` | 2026-04-02 02:43 | 2026-04-01 12:48 | **STALE** |
| `frontend/src/pages/Agents.tsx` | 2026-04-02 02:47 | mar 31 | **STALE** |

### Evidencia del Problema

El dist contenía código viejo sin las rutas de validación:

```javascript
// dist/api/tools/routes.js (ANTES de rebuild)
fastify.get('/', h.list);
fastify.get('/:id', h.get);
fastify.post('/', h.create);
// ... NO había /validate ni /validate-config
```

### Solución Aplicada

1. **Rebuild backend**: `cd backend && npm run build`
2. **Rebuild frontend**: `cd frontend && npm run build`
3. **Script de verificación**: `scripts/check-build-sync.sh`
4. **npm script**: `npm run build:check`

### Script check-build-sync.sh

```bash
#!/bin/bash
# Verifica si source es más nuevo que dist

# Backend: compara newest .ts vs oldest .js
# Frontend: compara newest source vs main bundle

# Exit codes:
# 0 = Sync OK
# 1 = Rebuild needed
```

### Uso

```bash
# Verificar antes de deploy
npm run build:check

# Output si hay problema:
# ✗ Backend dist is STALE
# Run: cd backend && npm run build
```

### Bloqueo Runtime Actual

El backend no puede iniciar por problema de **dependencias nativas** (mejor-sqlite3):
- Node.js v24.11.1 es muy nuevo
- No hay binarios precompilados
- Visual Studio no instalado para compilar

**Solución**: Usar Node.js LTS (v20.x o v22.x) o instalar Visual Studio Build Tools.

### Lecciones Aprendidas

1. **Siempre rebuild después de cambios**: `npm run build` en monorepo
2. **Verificar dist dates**: Si errores 404, comparar timestamps
3. **Script de pre-deploy**: Automatizar verificación source/build
4. **CI/CD**: Añadir step de build:check en pipeline

## 30. Auditoría de Alineación Frontend↔Backend (2026-04-02)

### Estado Final del Source

Auditoría exhaustiva realizada. El source está **100% alineado** entre frontend y backend.

### Matriz de Alineación

#### Agents
| Operación | Frontend | Backend | Estado |
|-----------|----------|---------|--------|
| Listar | `GET /agents` | ✅ | ALINEADO |
| Crear | `POST /agents` | ✅ | ALINEADO |
| Editar | `PATCH /agents/:id` | ✅ | ALINEADO (sin status) |
| Eliminar | `DELETE /agents/:id` | ✅ | ALINEADO |
| Activar | `POST /agents/:id/activate` | ✅ | ALINEADO |
| Desactivar | `POST /agents/:id/deactivate` | ✅ | ALINEADO |

**Nota**: `PATCH /agents/:id` NO soporta `status` intencionalmente. Cambio de estado via `/activate` y `/deactivate`.

#### Skills
| Operación | Frontend | Backend | Estado |
|-----------|----------|---------|--------|
| Listar | `GET /skills?expand=toolCount` | ✅ | ALINEADO |
| Crear | `POST /skills` | ✅ | ALINEADO |
| Editar | `PATCH /skills/:id` | ✅ | ALINEADO (incluye status) |
| Eliminar | `DELETE /skills/:id` | ✅ | ALINEADO |
| Cargar tools | `GET /skills/:id/tools?expand=tool` | ✅ | ALINEADO |
| Guardar tools | `PUT /skills/:id/tools` | ✅ | ALINEADO |
| Ejecutar | `POST /skills/:id/execute` | ✅ | ALINEADO |
| Validar ejecución | `POST /skills/:id/validate-execution` | ✅ | ALINEADO |
| Preview | `GET /skills/:id/execution-preview` | ✅ | ALINEADO |

#### Tools
| Operación | Frontend | Backend | Estado |
|-----------|----------|---------|--------|
| Listar | `GET /tools` | ✅ | ALINEADO |
| Crear | `POST /tools` | ✅ | ALINEADO |
| Editar | `PATCH /tools/:id` | ✅ | ALINEADO (incluye status) |
| Eliminar | `DELETE /tools/:id` | ✅ | ALINEADO |
| Validar nuevo | `POST /tools/validate` | ✅ | ALINEADO |
| Validar existente | `POST /tools/:id/validate` | ✅ | ALINEADO |
| Validar config | `POST /tools/validate-config` | ✅ | ALINEADO |

### Correcciones Aplicadas en Source

1. **SkillEditor.tsx**: Removido `createdAt` innecesario del payload de tools
2. **types/index.ts**: `SkillToolLink.createdAt` ahora opcional

### Tests de Contrato Añadidos

- `backend/src/api/__tests__/ContractAlignment.test.ts` - 33 tests
  - Validan schemas Zod
  - Verifican campos soportados
  - Comprueban compatibilidad de payloads frontend→backend

### Validación Runtime Pendiente

Script: `scripts/runtime-validation.sh`

```bash
# Ejecutar en Linux/macOS con backend corriendo
./scripts/runtime-validation.sh

# Verifica:
# - Rutas responden correctamente
# - CRUD completo de agents/skills/tools
# - Rutas estáticas vs parametrizadas (tools/validate)
# - Build freshness
```

### Categorización de Confirmaciones

| Elemento | Confirmado en Source | Confirmado en Tests | Pendiente Runtime |
|----------|---------------------|---------------------|-------------------|
| Rutas backend | ✅ | ✅ | ⏳ |
| Schemas Zod | ✅ | ✅ | - |
| Payloads frontend | ✅ | ✅ | - |
| Route ordering (Fastify) | ✅ | - | ⏳ |
| Query params (expand) | ✅ | - | ⏳ |
| Skill execution | ✅ | - | ⏳ |

## 31. Próximos Pasos

1. ~~Mejorar DecisionEngine con heurísticas-primero~~ ✅ Smart Decision Engine
2. ~~Integrar SmartDecisionEngine con DecisionEngine~~ ✅ Integración completada
3. ~~Tool Enhancement con typed configs~~ ✅ Completado
4. ~~Skill-Tool Composition~~ ✅ Completado
5. ~~Skill Execution System~~ ✅ Completado
6. ~~Frontend ↔ Backend Integration Fix~~ ✅ Completado
7. Integrar OrganizationalPolicyService con DecisionEngine/TaskRouter
8. Test integración end-to-end completo
9. PostgreSQL si producción real
10. Rate limiting
11. Probar Telegram real
12. Implementar canales adicionales (web, api)
13. Persistir AgentHierarchyStore y WorkProfileStore (configuración org)
14. Persistir TaskMemoryStore (historial de decisiones)
15. UI Panel para Human Inbox

---

*Ver [RUNBOOK_PRODUCTION.md](./RUNBOOK_PRODUCTION.md) para instalación y operación.*


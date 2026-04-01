# OCAAS - Sistema de Memoria

> Documento de referencia técnica. Actualizado: 2026-04-01

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
✅ task-resilience.test.ts        - 41 tests (NEW)

TOTAL: 346+ tests passing
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
```

## 16. Próximos Pasos

1. Integrar OrganizationalPolicyService con DecisionEngine/TaskRouter
2. Test integración end-to-end
3. PostgreSQL si producción real
4. Rate limiting
5. Probar Telegram real
6. Implementar canales adicionales (web, api)

---

*Ver [RUNBOOK.md](./RUNBOOK.md) para instalación y operación.*

# OCAAS BASELINE — BLOQUE 1

Fecha: 2026-04-04
Versión: pre-arquitectura

## 1. ENTRYPOINTS REALES

### Backend
- **index.ts**: main() → initDatabase → initServices → initOpenClaw → initOrchestrator → initGenerator → createApp → initWebSocket → initChannelBridge
- **app.ts**: createApp() → Fastify + registerRoutes()

### Frontend
- **main.tsx**: React entry → App.tsx → Router

## 2. FLUJO PRINCIPAL ACTUAL

```
API POST /tasks
    ↓
TaskService.create()
    ↓
TaskRouter.submit(task)
    ↓
QueueManager.add(task)
    ↓
TaskRouter.processNext()
    ↓
DecisionEngine / OrgAwareDecisionEngine
    ↓
JobDispatcherService.dispatch(decision)
    ↓
OpenClawAdapter.executeAgent(payload)
    ↓
gateway.sendTask() → OpenClaw REST/WS
    ↓
JobResponse → JobDispatcherService.processResponse()
    ↓
TaskService.complete() / fail() / blocked
    ↓
[blocked] → JobResolutionService → Approval → Retry
```

## 3. MATRIZ DE MÓDULOS

### Backend — CORE (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| Services | services/index.ts | IMPLEMENTADO |
| TaskService | services/TaskService.ts | IMPLEMENTADO |
| AgentService | services/AgentService.ts | IMPLEMENTADO |
| SkillService | services/SkillService.ts | IMPLEMENTADO |
| ToolService | services/ToolService.ts | IMPLEMENTADO |
| GenerationService | services/GenerationService.ts | IMPLEMENTADO |
| ApprovalService | approval/ApprovalService.ts | IMPLEMENTADO |
| EventService | services/EventService.ts | IMPLEMENTADO |

### Backend — ORCHESTRATOR (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| TaskRouter | orchestrator/TaskRouter.ts | IMPLEMENTADO |
| QueueManager | orchestrator/QueueManager.ts | IMPLEMENTADO |
| DecisionEngine | orchestrator/DecisionEngine.ts | IMPLEMENTADO |
| OrgAwareDecisionEngine | orchestrator/OrgAwareDecisionEngine.ts | IMPLEMENTADO |
| SmartDecisionEngine | orchestrator/decision/index.ts | IMPLEMENTADO |
| ActionExecutor | orchestrator/ActionExecutor.ts | IMPLEMENTADO |
| TaskDecomposer | orchestrator/TaskDecomposer.ts | IMPLEMENTADO |
| AgentManager | orchestrator/AgentManager.ts | IMPLEMENTADO |
| FeedbackService | orchestrator/feedback/FeedbackService.ts | IMPLEMENTADO |

### Backend — EXECUTION (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| JobDispatcherService | execution/JobDispatcherService.ts | IMPLEMENTADO |
| JobResolutionService | execution/JobResolutionService.ts | IMPLEMENTADO |
| JobSafetyService | execution/JobSafetyService.ts | IMPLEMENTADO |
| JobAwareTaskRouter | execution/JobAwareTaskRouter.ts | IMPLEMENTADO |

### Backend — INTEGRATIONS (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| OpenClawAdapter | integrations/openclaw/OpenClawAdapter.ts | IMPLEMENTADO |
| gateway | openclaw/gateway.ts | IMPLEMENTADO |
| SessionManager | openclaw/session.ts | PARCIAL (WS opcional) |

### Backend — ORGANIZATION (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| AgentHierarchyStore | organization/AgentHierarchyStore.ts | IMPLEMENTADO |
| WorkProfileStore | organization/WorkProfileStore.ts | IMPLEMENTADO |
| OrgPolicyService | organization/OrganizationalPolicyService.ts | IMPLEMENTADO |

### Backend — GENERATOR (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| AgentGenerator | generator/AgentGenerator.ts | IMPLEMENTADO |
| SkillGenerator | generator/SkillGenerator.ts | IMPLEMENTADO |
| ToolGenerator | generator/ToolGenerator.ts | IMPLEMENTADO |
| AIClient | generator/AIClient.ts | IMPLEMENTADO |
| Validator | generator/Validator.ts | IMPLEMENTADO |

### Backend — RESILIENCE (Implementado)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| CircuitBreaker | orchestrator/resilience/CircuitBreaker.ts | IMPLEMENTADO |
| HealthChecker | orchestrator/resilience/HealthChecker.ts | IMPLEMENTADO |
| ExecutionRecoveryService | orchestrator/resilience/ExecutionRecoveryService.ts | IMPLEMENTADO |
| ExecutionLeaseStore | orchestrator/resilience/ExecutionLeaseStore.ts | IMPLEMENTADO |

### Backend — CHANNELS (Parcial)

| Módulo | Archivo Principal | Estado |
|--------|-------------------|--------|
| ChannelService | services/ChannelService.ts | IMPLEMENTADO |
| ChannelBridge | services/ChannelBridge.ts | IMPLEMENTADO |
| TelegramChannel | notifications/TelegramChannel.ts | PARCIAL (webhook) |

### Backend — API ROUTES (Implementado)

| Ruta | Archivo | Estado |
|------|---------|--------|
| /api/agents | api/agents/routes.ts | IMPLEMENTADO |
| /api/tasks | api/tasks/routes.ts | IMPLEMENTADO |
| /api/skills | api/skills/routes.ts | IMPLEMENTADO |
| /api/tools | api/tools/routes.ts | IMPLEMENTADO |
| /api/approvals | api/approvals/routes.ts | IMPLEMENTADO |
| /api/generations | api/generations/routes.ts | IMPLEMENTADO |
| /api/jobs | api/jobs/routes.ts | IMPLEMENTADO |
| /api/org | api/org/routes.ts | IMPLEMENTADO |
| /api/feedback | api/feedback/routes.ts | IMPLEMENTADO |
| /api/system | api/system/routes.ts | IMPLEMENTADO |
| /api/channels | api/channels/routes.ts | IMPLEMENTADO |
| /api/webhooks | api/webhooks/routes.ts | IMPLEMENTADO |
| /api/permissions | api/permissions/routes.ts | DECORATIVO |
| /api/escalations | api/escalations/routes.ts | DECORATIVO |
| /api/resources | api/resources/routes.ts | PARCIAL |
| /api/manual/resources | api/manualResources/routes.ts | IMPLEMENTADO |

### Frontend — PAGES (Implementado)

| Página | Archivo | Estado |
|--------|---------|--------|
| Dashboard | pages/Dashboard.tsx | IMPLEMENTADO |
| Tasks | pages/Tasks.tsx | IMPLEMENTADO |
| TaskDetail | pages/TaskDetail.tsx | IMPLEMENTADO |
| Agents | pages/Agents.tsx | IMPLEMENTADO |
| AgentDetail | pages/AgentDetail.tsx | IMPLEMENTADO |
| Skills | pages/Skills.tsx | IMPLEMENTADO |
| Tools | pages/Tools.tsx | IMPLEMENTADO |
| Generations | pages/Generations.tsx | IMPLEMENTADO |
| GenerationDetail | pages/GenerationDetail.tsx | IMPLEMENTADO |
| Generator | pages/Generator.tsx | IMPLEMENTADO |
| Organization | pages/Organization.tsx | IMPLEMENTADO |
| Settings | pages/Settings.tsx | IMPLEMENTADO |

### Frontend — COMPONENTS (Implementado)

| Componente | Archivo | Estado |
|------------|---------|--------|
| StatusBar | components/layout/StatusBar.tsx | IMPLEMENTADO |
| GatewayMonitor | components/layout/GatewayMonitor.tsx | IMPLEMENTADO |
| SkillEditor | components/skills/SkillEditor.tsx | IMPLEMENTADO |
| SkillExecutionPanel | components/skills/SkillExecutionPanel.tsx | IMPLEMENTADO |
| ToolEditor | components/tools/ToolEditor.tsx | IMPLEMENTADO |
| OrgTreeView | components/organization/OrgTreeView.tsx | IMPLEMENTADO |
| JobStatusPanel | components/jobs/JobStatusPanel.tsx | IMPLEMENTADO |
| BlockedJobView | components/jobs/BlockedJobView.tsx | IMPLEMENTADO |
| ApprovalsPanel | components/control/ApprovalsPanel.tsx | IMPLEMENTADO |
| AutonomyPanel | components/control/AutonomyPanel.tsx | IMPLEMENTADO |
| FeedbackEventsPanel | components/control/FeedbackEventsPanel.tsx | IMPLEMENTADO |

## 4. FUNCIONES CLAVE DEL FLUJO PRINCIPAL

| Función | Ubicación | Rol |
|---------|-----------|-----|
| TaskRouter.submit() | orchestrator/TaskRouter.ts:55 | Entrada de task al queue |
| TaskRouter.processNext() | orchestrator/TaskRouter.ts:98 | Procesa siguiente task |
| DecisionEngine.decide() | orchestrator/DecisionEngine.ts | Selecciona agente |
| OrgAwareDecisionEngine.decide() | orchestrator/OrgAwareDecisionEngine.ts | Decisión org-aware |
| JobDispatcherService.dispatch() | execution/JobDispatcherService.ts | Crea y envía job |
| OpenClawAdapter.executeAgent() | integrations/openclaw/OpenClawAdapter.ts | Llama a OpenClaw |
| gateway.sendTask() | openclaw/gateway.ts | HTTP/WS a OpenClaw |
| JobDispatcherService.processResponse() | execution/JobDispatcherService.ts | Procesa respuesta |
| JobResolutionService.resolveBlockedJob() | execution/JobResolutionService.ts | Maneja bloqueos |

## 5. RIESGOS DE RUPTURA

| Riesgo | Impacto | Módulos Afectados |
|--------|---------|-------------------|
| Cambiar TaskRouter.submit() | ALTO | Todo el flujo de tareas |
| Cambiar JobDispatcherService.dispatch() | ALTO | Ejecución de jobs |
| Cambiar OpenClawAdapter | ALTO | Conexión con OpenClaw |
| Cambiar schema de jobs/tasks | ALTO | Persistencia, recovery |
| Cambiar getServices() | ALTO | Todo el sistema |
| Cambiar initOrchestrator() | ALTO | Startup, recovery |
| Cambiar VALID_TRANSITIONS FSM | MEDIO | Estados de tasks |
| Cambiar JobStore | MEDIO | Jobs activos |
| Cambiar QueueManager | MEDIO | Orden de ejecución |

## 6. MÓDULOS DECORATIVOS / NO CONECTADOS

| Módulo | Razón |
|--------|-------|
| api/permissions | CRUD existe, no integrado en flujo de decisión |
| api/escalations | Rutas existen, no conectadas a OrgAware |
| api/resources | Wrapper parcial, no usado directamente |

## 7. DEPENDENCIAS CRÍTICAS

```
index.ts
  └── initDatabase()
  └── initServices() → 14 servicios core
  └── initOpenClaw() → gateway + sessionManager
  └── initOrchestrator() → TaskRouter + resilience
  └── createApp() → Fastify + routes
  └── initWebSocket() → Socket.IO
  └── initChannelBridge() → Channels
```

## 8. TASK INTAKE (BLOQUE 4)

### Puntos de Entrada de Tareas

| Punto | Archivo | ¿Pasa por TaskRouter.submit()? |
|-------|---------|--------------------------------|
| API POST /tasks | api/tasks/handlers.ts:48 | ✅ SÍ |
| API POST /tasks/:id/retry | api/tasks/handlers.ts:194 | ✅ SÍ |
| ChannelService.ingest() | services/ChannelService.ts:68 | ✅ SÍ (corregido BLOQUE 4) |
| TaskRouter.submitBatch() | orchestrator/TaskRouter.ts:69 | ✅ SÍ (interno) |
| TaskDecomposer.decompose() | orchestrator/TaskDecomposer.ts:124 | ✅ SÍ (via TaskRouter) |

### Trazabilidad de Intake

Cada tarea ahora incluye en `metadata._intake`:
- `ingress_mode`: 'api' | 'channel' | 'batch' | 'decomposition' | 'internal'
- `queued_at`: timestamp de cuando entró al queue
- `source_channel`: canal de origen (si es 'channel')

### Flujo Unificado

```
Channel/API/Internal
        ↓
  TaskService.create()
        ↓
  TaskRouter.submit(task, ingressMode)
        ↓
  [intake traceability added]
        ↓
  taskService.queue()
        ↓
  QueueManager.add()
        ↓
  processNext() → Decision → Execution
```

## 9. MAPA DE CONSUMO IA/COSTE (BLOQUE 4B)

### Puntos Reales de Consumo IA

| Punto | Archivo | Payload Opt | Tiers | Cache | Usage Real | Límites | Fallback |
|-------|---------|-------------|-------|-------|------------|---------|----------|
| SmartDecisionEngine.decide() | decision/SmartDecisionEngine.ts | ❌ | ✅ SHORT/MEDIUM/DEEP | ✅ DecisionCache | ✅ CostTracker | maxTokens por tier | ✅ heuristic |
| AIClient.generate() | generator/AIClient.ts | ❌ | ❌ | ❌ | ✅ gateway.usage | 8192 tokens | ❌ |
| TaskAnalyzer.analyze() | orchestrator/TaskAnalyzer.ts | ❌ | ❌ | ❌ | ✅ gateway.usage | 1024 tokens | ❌ |
| JobDispatcherService (chat) | execution/JobDispatcherService.ts | ✅ optimizePayload | ❌ | ❌ | ⚠️ parcial | 4096 tokens | ✅ stub |
| gateway.generate() | openclaw/gateway.ts | ❌ | ❌ | ❌ | ✅ response.usage | configurable | ❌ |

### Sistema de Ahorro Existente

| Componente | Archivo | Estado | Conectado |
|------------|---------|--------|-----------|
| payloadOptimizer | execution/payloadOptimizer.ts | ✅ IMPLEMENTADO | ✅ JobDispatcher |
| PromptTiers | decision/PromptTiers.ts | ✅ IMPLEMENTADO | ✅ SmartDecision |
| CostTracker | decision/CostTracker.ts | ✅ IMPLEMENTADO | ✅ SmartDecision |
| DecisionCache | decision/SmartDecisionEngine.ts | ✅ IMPLEMENTADO | ✅ SmartDecision |
| OperationMode | decision/types.ts | ✅ IMPLEMENTADO | ✅ SmartDecision |

### Límites Duros Existentes

| Límite | Valor | Configurable | Conectado |
|--------|-------|--------------|-----------|
| maxTokens SHORT | 256 | ❌ hardcoded | ✅ PromptTiers |
| maxTokens MEDIUM | 512 | ❌ hardcoded | ✅ PromptTiers |
| maxTokens DEEP | 1536 | ❌ hardcoded | ✅ PromptTiers |
| maxTokens AIClient | 8192 | ❌ hardcoded | ✅ AIClient |
| maxTokens JobDispatch | 4096 | ❌ hardcoded | ✅ JobDispatcher |
| GENERATION_TIMEOUT | 120000ms | ❌ hardcoded | ✅ gateway |
| maxRetries task | 3 | ✅ config | ✅ JobResolution |
| maxToolCalls | configurable | ✅ payload | ✅ JobPayload |

### Límites NO Conectados / Faltantes

| Límite | Estado |
|--------|--------|
| max_cost_per_task_usd | ❌ NO EXISTE |
| max_cost_per_agent_daily_usd | ❌ NO EXISTE |
| max_cost_daily_usd | ❌ NO EXISTE |
| max_subtasks_per_decomposition | ⚠️ PARCIAL (TaskDecomposer usa límites internos) |
| budget alerting | ❌ NO EXISTE |

### Trazabilidad de Coste Añadida (BLOQUE 4B)

Nuevos tipos en `contracts.ts`:
- `CostTraceability`: campos para estimación vs real de tokens/coste
- `CostLimits`: límites configurables con defaults seguros
- `DEFAULT_COST_TRACEABILITY`, `DEFAULT_COST_LIMITS`

## 10. DECISION ENGINE HÍBRIDO (BLOQUE 5)

### Pipeline de Decisión

```
Task → SmartDecisionEngine.decide()
         ↓
    [1] Cache check
         ↓
    [2] Heuristics (8 reglas)
         ↓ (si falla threshold)
    [3] LLM (SHORT/MEDIUM/DEEP)
         ↓ (si falla)
    [4] Fallback
         ↓
    [5] VALIDATION (NUEVO)
         ↓
    Decision con traceability
```

### DecisionValidator (NUEVO)

Validación determinista final antes de ejecutar:

| Check | Descripción | Recuperable |
|-------|-------------|-------------|
| agent_not_found | Agente no existe | ✅ |
| agent_not_active | Agente no activo | ✅ |
| agent_busy | Agente ocupado | ⚠️ warning |
| missing_capabilities | Cobertura insuficiente | ✅ |

### Fallback Automático

Si validación falla:
1. `alternate_agent` - Buscar otro agente con capacidades
2. `escalation` - Escalar si no hay agentes
3. `resource_generation` - Generar recurso faltante
4. `rejection` - Rechazar si nada funciona

### Trazabilidad Híbrida

Cada decisión incluye `_traceability`:
- `decision_source`: 'heuristic' | 'ai' | 'hybrid'
- `decision_confidence`: 0-1
- `decision_validated`: true/false
- `heuristic_method`: regla usada
- `ai_model`: tier LLM usado

### Umbrales de Confianza

| Umbral | Valor | Acción |
|--------|-------|--------|
| AUTO_ASSIGN | ≥0.8 | Auto-asignar |
| DOUBLE_CHECK | ≥0.5 | Validar doble |
| REQUIRE_FALLBACK | ≥0.4 | Aplicar fallback |
| REQUIRE_APPROVAL | <0.4 | Aprobación humana |

## 11. SISTEMA DE GENERACIÓN DE RECURSOS (BLOQUE 7)

### Flujo de Generación

```
GenerationRequest
       ↓
  Generator.generate()
       ↓
  [AI o Template fallback]
       ↓
  Validator.validate()
       ↓
  generationService.markGenerated()
       ↓
  generationService.markPendingApproval()
       ↓
  [Aprobación manual o auto]
       ↓
  Generator.activate()
       ↓
  [DB record + files escritos]
       ↓
  ⚠️ MATERIALIZACIÓN PARCIAL
```

### Trazabilidad de Generación (NUEVO)

Archivo: `generator/traceability.ts`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| ai_requested | boolean | ¿Se solicitó IA? |
| ai_available | boolean | ¿Estaba IA configurada? |
| ai_generation_attempted | boolean | ¿Se intentó generar con IA? |
| ai_generation_succeeded | boolean | ¿IA generó exitosamente? |
| fallback_used | boolean | ¿Se usó fallback? |
| fallback_reason | string | Razón del fallback |
| fallback_template_name | string | Template usado |
| generation_mode | 'ai' \| 'fallback' \| 'manual' | Modo final |
| validator_passed | boolean | ¿Validación pasó? |
| activation_attempted | boolean | ¿Se intentó activar? |
| activation_succeeded | boolean | ¿Activación exitosa? |
| materialized | boolean | ¿Recurso operativo? |
| materialization_gap | string | Explicación del gap |

### Estado de Materialización por Recurso

| Recurso | DB Record | Files | Runtime | Gap Explícito |
|---------|-----------|-------|---------|---------------|
| Agent | ✅ | ❌ | ❌ OpenClaw session | "ficha" only, NOT operative |
| Skill | ✅ | ✅ | ❌ loaded on-demand | files exist, not loaded |
| Tool | ✅ | ✅ | ❌ no smoke test | script exists, not verified |

### Gaps Documentados Honestamente

**Agent:**
> Agent record created in OCAAS DB but NO OpenClaw session materialized.
> Agent is a "ficha" (metadata) only - not an operative runtime agent.

**Skill:**
> Skill files written to workspace and DB record created.
> OpenClaw would load skill on-demand when agent needs it (not pre-loaded).

**Tool:**
> Tool script written to workspace and DB record created.
> No smoke test before activation. OpenClaw loads tools on-demand.

### Fallback Reasons

| Razón | Descripción |
|-------|-------------|
| ai_not_configured | ANTHROPIC_API_KEY no presente |
| ai_not_available | Servicio IA no disponible |
| ai_request_failed | Error en llamada a IA |
| ai_parse_error | Respuesta IA no parseable |
| ai_validation_failed | Generación IA no pasó validación |
| user_requested_template | Usuario pidió template explícito |

### Validación de Recursos

| Recurso | Checks | Security |
|---------|--------|----------|
| Agent | name, type, capabilities | N/A |
| Skill | SKILL.md, agent-instructions.md | FORBIDDEN_PATTERNS |
| Tool | shebang, set -euo pipefail | FORBIDDEN_PATTERNS |

**FORBIDDEN_PATTERNS** (security):
- `rm -rf /`
- `sudo`
- `:(){`
- `dd if=`
- `mkfs`
- `> /dev/sd`
- `chmod 777`
- `curl.*\| bash`
- `eval.*\$`
- Inyección de código

## 12. MATERIALIZACIÓN REAL DE AGENTS (BLOQUE 9)

### Estados del Ciclo de Vida

| Estado | DB Record | Generation | Workspace | Config | Runtime |
|--------|-----------|------------|-----------|--------|---------|
| record | ✅ | ❌ | ❌ | ❌ | ❌ |
| generated | ✅ | ✅ | ❌ | ❌ | ❌ |
| activated | ✅ | ✅ | ❌ | ❌ | ❌ |
| materialized | ✅ | ✅ | ✅ | ✅ | ❌ |
| runtime_ready | ✅ | ✅ | ✅ | ✅ | ✅ |

### Materialización Real

Archivo: `generator/AgentMaterialization.ts`

**Qué crea `materializeAgent()`:**
1. Directorio `workspace/agents/{name}/`
2. `agent.json` - configuración del agente
3. `system-prompt.md` - prompt base

**Qué NO crea:**
- Sesión OpenClaw
- Registro en runtime
- Verificación de dependencias

### Trazabilidad de Materialización

| Campo | Tipo | Descripción |
|-------|------|-------------|
| state | AgentLifecycleState | Estado actual del ciclo de vida |
| db_record | boolean | Record en DB existe |
| workspace_exists | boolean | Directorio de workspace existe |
| config_written | boolean | agent.json escrito |
| runtime_possible | boolean | Podría iniciar runtime |
| openclaw_session | boolean | Sesión activa en OpenClaw |
| materialization_attempted_at | number | Timestamp de intento |
| materialization_succeeded | boolean | Materialización exitosa |
| materialization_reason | string | Razón si falló |
| target_workspace | string | Path del workspace |

### Endpoints de Estado

| Endpoint | Descripción |
|----------|-------------|
| GET /api/agents/:id/materialization | Estado de materialización de un agente |
| GET /api/agents/status/all | Lista de agentes con estado de materialización |

### Diferencia Clave: activated vs materialized vs runtime_ready

- **activated**: Generation status = active, DB record creado. SIN workspace.
- **materialized**: Workspace creado (agent.json + system-prompt.md). SIN sesión OpenClaw.
- **runtime_ready**: Sesión OpenClaw activa. Agente operativo.

### Gap Persistente

> Agent workspace materialized (files written).
> OpenClaw session NOT started. Agent is NOT runtime-ready.
> Session must be explicitly started by JobDispatcher or manual action.

## 13. EXECUTION BRIDGE OPENCLAW (BLOQUE 10)

### Modos de Ejecución REAL

| Modo | Descripción | Transport | Real Agent? |
|------|-------------|-----------|-------------|
| chat_completion | /v1/chat/completions (OpenAI-compatible) | rest_api | ❌ NO |
| stub | OpenClaw no disponible, respuesta simulada | none | ❌ NO |
| real_agent | Sesión real de OpenClaw (NOT IMPLEMENTED) | websocket_rpc | ✅ SÍ |

**IMPORTANTE**: Actualmente TODAS las ejecuciones usan `chat_completion`, NO `real_agent`.

### Mapa de Puntos de Ejecución

Archivo: `execution/ExecutionTraceability.ts`

| Punto | Archivo | Modo Real | Transport | Uses Real Agent |
|-------|---------|-----------|-----------|-----------------|
| OpenClawAdapter.executeAgent | integrations/openclaw/OpenClawAdapter.ts | chat_completion | rest_api | ❌ |
| OpenClawAdapter.generate | integrations/openclaw/OpenClawAdapter.ts | chat_completion | rest_api | ❌ |
| OpenClawGateway.generate | openclaw/gateway.ts | chat_completion | rest_api | ❌ |
| OpenClawGateway.spawn | openclaw/gateway.ts | stub | webhook | ❌ |
| OpenClawGateway.send | openclaw/gateway.ts | chat_completion | rest_api | ❌ |
| OpenClawGateway.exec | openclaw/gateway.ts | chat_completion | rest_api | ❌ |
| JobDispatcherService.executeJob | execution/JobDispatcherService.ts | chat_completion | rest_api | ❌ |

### Trazabilidad de Ejecución

| Campo | Tipo | Descripción |
|-------|------|-------------|
| execution_mode | 'chat_completion' \| 'stub' \| 'real_agent' | Modo de ejecución usado |
| transport | 'rest_api' \| 'websocket_rpc' \| 'webhook' \| 'none' | Transporte usado |
| target_agent_id | string | ID del agente OCAAS |
| openclaw_session_id | string | ID de sesión OpenClaw (si existe) |
| runtime_ready_at_execution | boolean | ¿Agente estaba runtime_ready? |
| gateway_configured | boolean | ¿Gateway configurado? |
| gateway_connected | boolean | ¿Gateway conectado? |
| websocket_connected | boolean | ¿WebSocket conectado? |
| transport_success | boolean | ¿Request enviado exitosamente? |
| execution_fallback_used | boolean | ¿Se usó fallback? |
| execution_fallback_reason | string | Razón del fallback |
| response_received | boolean | ¿Se recibió respuesta? |
| response_tokens | object | Tokens de entrada/salida |
| gap | string | Explicación del gap |

### Runtime Ready Check

Antes de ejecutar, `JobDispatcherService.executeJob()` verifica:

1. `adapter.isConfigured()` - Gateway tiene API key
2. `adapter.isConnected()` - Gateway conectado
3. `checkRuntimeReady()` - Estado del agente

Si no está ready, se ejecuta con fallback y se registra en trazabilidad.

### Gap Persistente de Ejecución

> Todas las ejecuciones usan /v1/chat/completions (chat_completion).
> NO se crean sesiones reales de OpenClaw agent.
> El sessionId es LOCAL a OCAAS - no corresponde a sesión OpenClaw.
> Cada llamada es STATELESS - no hay continuidad de contexto.

### Diferencia: spawn() vs Real Session

- **spawn()**: Crea ID local `ocaas-{agentId}-{timestamp}`. NO crea sesión OpenClaw.
- **send()**: POST a /v1/chat/completions IGNORANDO el sessionId.
- **Real Session**: Requeriría WebSocket RPC real a OpenClaw (NOT IMPLEMENTED).

## 14. ALINEACIÓN REAL CON OPENCLAW (BLOQUE 8)

Archivo: `openclaw/OpenClawCompatibility.ts`

### Modelo de Ejecución Real

| Aspecto | OCAAS Cree | OpenClaw Real | Gap |
|---------|------------|---------------|-----|
| Execution Mode | real_agent available | chat_completion ONLY | real_agent NOT IMPLEMENTED |
| Skills | Loaded by OpenClaw | IGNORED | Files written but never read |
| Tools | Executed by OpenClaw | IGNORED | Scripts written but never executed |
| Agent Workspace | Read by OpenClaw | IGNORED | agent.json NOT read |
| Sessions | OpenClaw session | LOCAL ID | sessionId is OCAAS-local |

### Qué OpenClaw REALMENTE Usa

| Recurso | Escrito | Leído por OpenClaw | Ejecutado | Gap |
|---------|---------|-------------------|-----------|-----|
| Skills | ✅ workspace/skills/{name}/ | ❌ NO | N/A | metadata only |
| Tools | ✅ workspace/tools/{name}.sh | ❌ NO | ❌ NO | script exists, never run |
| Agents | ✅ workspace/agents/{name}/ | ❌ NO | N/A | config ignored |
| System Prompt | ✅ embedded in request | ✅ SÍ | N/A | ÚNICO dato usado |

### Campos IGNORADOS por OpenClaw

| Operación | Campos Ignorados | Nota |
|-----------|------------------|------|
| spawn() | tools, skills, config | Solo genera local sessionId |
| send() | sessionId, data | Cada llamada es stateless |
| exec() | sessionId, toolName, input | Se convierte a prompt, no ejecuta script |

### Validaciones Unificadas (BLOQUE 8)

Manual y auto-generated siguen las MISMAS reglas:

**Skills:**
- Requiere: `SKILL.md`, `agent-instructions.md`
- Formato: Markdown con secciones ## Capabilities
- Warning: OpenClaw NO los lee

**Tools:**
- Requiere: Shebang, set -euo pipefail (sh)
- Prohibido: rm -rf /, sudo, eval, etc.
- Warning: OpenClaw NO los ejecuta

**Agents:**
- Requiere: name, type (general/specialist/orchestrator)
- Warning: agent.json NOT read by OpenClaw

### Gap Fundamental

> OCAAS escribe skills, tools, y agent workspaces al filesystem.
> OpenClaw chat_completion NO los lee NI ejecuta.
> El ÚNICO dato realmente usado es el system prompt embebido en cada request.
> Todo lo demás es metadata para OCAAS, no para OpenClaw.

### Compatibilidad Summary (logged at startup)

```json
{
  "model": "chat_completion",
  "skillsUsed": false,
  "toolsUsed": false,
  "agentWorkspaceUsed": false,
  "agentSystemPromptUsed": true,
  "realSessions": false
}
```

## 15. OBSERVABILIDAD Y DIAGNÓSTICO (BLOQUE 11)

Archivo: `services/DiagnosticService.ts`

### Diagnóstico Central

`getTaskDiagnostics(taskId)` devuelve:

```typescript
TaskDiagnostics {
  task_id: string;
  task: { title, status, type, priority, agent_id };
  timeline: TaskTimeline;
  intake?: TaskIntakeTraceability;
  decision?: DecisionTraceability;
  generation?: GenerationTraceability;
  materialization?: MaterializationTraceability;
  execution?: ExecutionTraceability;
  ai_usage: AIUsageSummary;
  execution_summary?: ExecutionSummary;
  gaps: string[];
  warnings: string[];
  diagnosed_at: number;
}
```

### Timeline de Task

| Campo | Tipo | Descripción |
|-------|------|-------------|
| created_at | number | Task created |
| queued_at | number | Task queued |
| decision_at | number | Decision made |
| generation_at | number | Generation started |
| materialization_at | number | Materialization completed |
| execution_started_at | number | Execution started |
| execution_completed_at | number | Execution completed |
| completed_at | number | Task completed |
| failed_at | number | Task failed |
| total_duration_ms | number | Total duration |
| queue_duration_ms | number | Time in queue |
| execution_duration_ms | number | Execution time |

### Visibilidad IA vs Fallback

```typescript
AIUsageSummary {
  ai_used: boolean;
  fallback_used: boolean;
  fallback_reasons: string[];
  ai_models_used: string[];
  estimated_cost_usd?: number;
  total_tokens?: { input, output };
  decision: { ai_used, source, confidence };
  generation?: { ai_used, fallback_used, fallback_reason, tokens };
}
```

### Visibilidad de Ejecución

```typescript
ExecutionSummary {
  execution_mode: 'chat_completion' | 'stub' | 'real_agent';
  runtime_ready: boolean;
  transport_success: boolean;
  fallback_used: boolean;
  fallback_reason?: string;
  gap?: string;
  session_id?: string;
  response_received: boolean;
}
```

### Endpoints de Diagnóstico

| Endpoint | Descripción |
|----------|-------------|
| GET /api/tasks/:id/diagnostics | Diagnóstico completo de una task |
| GET /api/tasks/:id/timeline | Timeline + AI usage + execution summary |

### Ejemplo de Diagnóstico

```json
{
  "task_id": "abc123",
  "task": { "title": "Generate agent", "status": "completed" },
  "timeline": {
    "created_at": 1700000000000,
    "queued_at": 1700000000100,
    "decision_at": 1700000000200,
    "execution_started_at": 1700000000300,
    "execution_completed_at": 1700000001000,
    "completed_at": 1700000001000,
    "total_duration_ms": 1000
  },
  "ai_usage": {
    "ai_used": true,
    "fallback_used": false,
    "decision": { "ai_used": false, "source": "heuristic", "confidence": 0.85 }
  },
  "execution_summary": {
    "execution_mode": "chat_completion",
    "runtime_ready": true,
    "transport_success": true,
    "gap": "Execution uses chat_completion, not real_agent."
  },
  "gaps": ["Execution uses chat_completion, not real_agent. Each call is stateless."],
  "warnings": []
}
```

## 16. VALIDACIÓN

- [x] Entrypoints identificados
- [x] Flujo principal trazado
- [x] Módulos clasificados
- [x] Funciones clave listadas
- [x] Riesgos documentados
- [x] Decorativos marcados
- [x] Task intake unificado (BLOQUE 4)
- [x] Mapa de consumo IA (BLOQUE 4B)
- [x] Sistema de ahorro auditado (BLOQUE 4B)
- [x] Límites duros documentados (BLOQUE 4B)
- [x] Trazabilidad de coste añadida (BLOQUE 4B)
- [x] Decision engine híbrido (BLOQUE 5)
- [x] Validación determinista (BLOQUE 5)
- [x] Trazabilidad híbrida (BLOQUE 5)
- [x] Trazabilidad de generación (BLOQUE 7)
- [x] Materialización documentada (BLOQUE 7)
- [x] Gaps explícitos por recurso (BLOQUE 7)
- [x] Compatibilidad OCAAS/OpenClaw auditada (BLOQUE 8)
- [x] Campos ignorados documentados (BLOQUE 8)
- [x] Validaciones unificadas manual/auto (BLOQUE 8)
- [x] Gap fundamental documentado (BLOQUE 8)
- [x] Estados de ciclo de vida de agents (BLOQUE 9)
- [x] Materialización real implementada (BLOQUE 9)
- [x] Trazabilidad de materialización (BLOQUE 9)
- [x] Endpoints de estado (BLOQUE 9)
- [x] Modos de ejecución REAL auditados (BLOQUE 10)
- [x] Mapa de puntos de ejecución (BLOQUE 10)
- [x] Trazabilidad de ejecución implementada (BLOQUE 10)
- [x] Runtime ready check antes de ejecutar (BLOQUE 10)
- [x] Gap de ejecución documentado (BLOQUE 10)
- [x] Diagnóstico central implementado (BLOQUE 11)
- [x] Timeline de task (BLOQUE 11)
- [x] Visibilidad IA vs Fallback (BLOQUE 11)
- [x] Visibilidad de ejecución (BLOQUE 11)
- [x] Endpoints de diagnóstico (BLOQUE 11)

---
BASELINE CONGELADO - NO MODIFICAR SIN ACTUALIZAR ESTE DOCUMENTO

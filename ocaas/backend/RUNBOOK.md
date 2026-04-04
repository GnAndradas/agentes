# OCAAS × OpenClaw Runbook Operativo

## Índice
1. [Arquitectura del Sistema](#arquitectura-del-sistema)
2. [Flujos de Trabajo](#flujos-de-trabajo)
3. [Endpoints de Diagnóstico](#endpoints-de-diagnóstico)
4. [Escenarios de Operación](#escenarios-de-operación)
5. [Trazabilidad Completa](#trazabilidad-completa)
6. [Troubleshooting](#troubleshooting)
7. [Gaps Conocidos](#gaps-conocidos)

---

## Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    INTAKE       │───▶│    DECISION     │───▶│   EXECUTION     │
│ (TaskIntake)    │    │ (DecisionEngine)│    │ (JobDispatcher) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼ (si no hay recursos)
                       ┌─────────────────┐
                       │   GENERATION    │
                       │ (AgentGenerator)│
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │    APPROVAL     │
                       │ (Workflow FSM)  │
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │ MATERIALIZATION │
                       │ (AgentMaterial) │
                       └─────────────────┘
```

### Modos de Ejecución

| Modo | Transport | Descripción | Estado Actual |
|------|-----------|-------------|---------------|
| `chat_completion` | `rest_api` | Usa /v1/chat/completions | **ACTIVO** |
| `real_agent` | `websocket_rpc` | Usa OpenClaw real | NO IMPLEMENTADO |
| `stub` | `none` | Mock para tests | Para tests |

### Estado Actual del Sistema

```
IMPORTANTE: Toda ejecución actual usa chat_completion vía REST API.
NO hay agentes "reales" ejecutándose en OpenClaw.
Los recursos (skills/tools) se escriben pero NO se usan.
```

---

## Flujos de Trabajo

### Flujo 1: Input Simple (Sin Task)

```
Input → Intake → requires_task=false → Respuesta directa (no OCAAS)
```

**Traceability esperada:**
- `intake.requires_task = false`
- `intake.detected_type = 'greeting' | 'question'`
- NO hay decision, generation, ni execution

### Flujo 2: Task Simple (Agente Existente)

```
Input → Intake → Decision → Execution → Response
                   │
                   └─▶ Agent ya existe, asignación directa
```

**Traceability esperada:**
- `intake.requires_task = true`
- `decision.decision_type = 'direct_assignment'`
- `decision.ai_decision_used = false`
- `execution.execution_mode = 'chat_completion'`
- `execution.runtime_ready_at_execution = false`

### Flujo 3: Task con Generación

```
Input → Intake → Decision → Generation → Approval → Activation → Materialization → Execution
                   │
                   └─▶ No hay agente adecuado
```

**Traceability esperada:**
- `decision.requires_generation = true`
- `generation.ai_generation_attempted = true`
- `generation.ai_generation_succeeded = true | false`
- `generation.fallback_used = true` (si AI falla)
- `materialization.workspace_created = true`
- `materialization.gap = "OpenClaw session NOT started"`

### Flujo 4: Fallback por Fallo de IA

```
Input → Generation → AI Fails → Fallback Template → Approval → Activation
```

**Fallback reasons:**
- `ai_not_configured` - No hay API key
- `ai_not_available` - Servicio no responde
- `ai_request_failed` - Error en request
- `ai_parse_error` - Respuesta no parseable
- `ai_validation_failed` - Validación falló
- `user_requested_template` - Usuario pidió template

### Flujo 5: Aprobación Rechazada

```
Input → Generation → Approval → REJECTED → No Execution
```

**Estados FSM:**
- `pending_approval` → `rejected`
- NO se intenta activation
- Task queda en estado `failed`

---

## Endpoints de Diagnóstico

### GET /api/tasks/:id/diagnostics

Retorna diagnóstico completo de una task.

**Response:**
```json
{
  "data": {
    "task_id": "task-abc123",
    "task": {
      "title": "...",
      "status": "completed",
      "type": "action",
      "priority": "medium",
      "agent_id": "agent-001"
    },
    "timeline": {
      "created_at": 1712345678000,
      "queued_at": 1712345678100,
      "decision_at": 1712345678200,
      "execution_started_at": 1712345678500,
      "execution_completed_at": 1712345679000,
      "completed_at": 1712345679100,
      "total_duration_ms": 1100,
      "execution_duration_ms": 500
    },
    "intake": {
      "intake_source": "api",
      "detected_type": "action",
      "requires_task": true
    },
    "decision": {
      "ai_decision_used": false,
      "selected_agent_id": "agent-001",
      "decision_type": "direct_assignment"
    },
    "execution": {
      "execution_mode": "chat_completion",
      "transport": "rest_api",
      "runtime_ready_at_execution": false,
      "transport_success": true
    },
    "ai_usage": {
      "ai_used": false,
      "fallback_used": false,
      "fallback_reasons": [],
      "ai_models_used": []
    },
    "gaps": [],
    "warnings": [
      "Agent not runtime_ready - using chat_completion"
    ]
  }
}
```

### GET /api/tasks/:id/timeline

Retorna solo el timeline de una task.

**Response:**
```json
{
  "data": {
    "created_at": 1712345678000,
    "queued_at": 1712345678100,
    "decision_at": 1712345678200,
    "execution_started_at": 1712345678500,
    "execution_completed_at": 1712345679000,
    "completed_at": 1712345679100,
    "total_duration_ms": 1100,
    "queue_duration_ms": 100,
    "decision_duration_ms": 100,
    "execution_duration_ms": 500
  }
}
```

---

## Escenarios de Operación

### ESCENARIO 1: Input Simple (Sin Task)

**Input:** "Hola, ¿cómo estás?"

**Esperado:**
- `requires_task = false`
- No se crea task en OCAAS
- Respuesta directa del sistema

**Diagnóstico:** N/A (no hay task)

### ESCENARIO 2: Task Simple

**Input:** "Busca información sobre TypeScript"

**Esperado:**
- Task creada con status `pending`
- Decision asigna agente existente
- Execution vía `chat_completion`
- Task completa con status `completed`

**Diagnóstico:**
```bash
curl http://localhost:3001/api/tasks/{id}/diagnostics
```

### ESCENARIO 3: Task con Generación

**Input:** "Necesito un agente especialista en análisis de logs"

**Esperado:**
- Decision detecta que no hay agente
- Generation crea nuevo agente
- Approval requerido (status `pending_approval`)
- Tras aprobación: activation + materialization
- Execution con nuevo agente

**Validar:**
- `generation.ai_generation_succeeded` o `generation.fallback_used`
- `materialization.workspace_created = true`
- `execution.target_agent_id` = nuevo agente

### ESCENARIO 4: IA Falla, Fallback Funciona

**Condición:** OPENAI_API_KEY no configurado o servicio caído

**Esperado:**
- `generation.ai_available = false` o `ai_generation_succeeded = false`
- `generation.fallback_used = true`
- `generation.fallback_reason = 'ai_not_available'`
- Sistema continúa con template fallback

### ESCENARIO 5: Aprobación Rechazada

**Acción:** Rechazar aprobación vía panel o Telegram

**Esperado:**
- `generation.status = 'rejected'`
- NO hay materialization
- NO hay execution
- Task status = `failed`

**Validar:**
```bash
# La task debe mostrar gaps
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.gaps'
# Debe incluir "Generation rejected"
```

### ESCENARIO 6: Ejecución Sin runtime_ready

**Estado:** Agente materializado pero sin sesión OpenClaw

**Esperado:**
- `execution.runtime_ready_at_execution = false`
- `execution.execution_mode = 'chat_completion'`
- Warnings en diagnóstico

**Validar:**
```bash
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.warnings'
# Debe incluir "runtime_ready"
```

---

## Trazabilidad Completa

### Estructura de Trazabilidad

```
TaskDiagnostics
├── task_id
├── task (resumen)
├── timeline
│   ├── created_at
│   ├── queued_at
│   ├── decision_at
│   ├── generation_at (si aplica)
│   ├── materialization_at (si aplica)
│   ├── execution_started_at
│   ├── execution_completed_at
│   ├── completed_at
│   └── durations calculadas
├── intake
│   ├── intake_source
│   ├── detected_type
│   └── requires_task
├── decision
│   ├── ai_decision_used
│   ├── fallback_used
│   ├── decision_type
│   └── selected_agent_id
├── generation (si aplica)
│   ├── ai_requested
│   ├── ai_generation_succeeded
│   ├── fallback_used
│   └── fallback_reason
├── materialization (si aplica)
│   ├── workspace_created
│   ├── config_written
│   └── gap
├── execution
│   ├── execution_mode
│   ├── transport
│   ├── runtime_ready_at_execution
│   └── transport_success
├── ai_usage (resumen)
│   ├── ai_used
│   ├── fallback_used
│   ├── fallback_reasons[]
│   └── ai_models_used[]
├── gaps[]
└── warnings[]
```

### Interpretación de ai_usage

| ai_used | fallback_used | Significado |
|---------|---------------|-------------|
| true | false | IA funcionó correctamente |
| false | true | IA falló, se usó fallback |
| false | false | Task simple, no requirió IA |
| true | true | IA parcial + fallback |

---

## Troubleshooting

### Task no se ejecuta

1. Verificar status de la task:
```bash
curl http://localhost:3001/api/tasks/{id}
```

2. Verificar diagnóstico:
```bash
curl http://localhost:3001/api/tasks/{id}/diagnostics
```

3. Revisar gaps y warnings en respuesta

### Generation falla repetidamente

1. Verificar configuración de IA:
```bash
echo $OPENAI_API_KEY
echo $ANTHROPIC_API_KEY
```

2. Verificar que fallback funciona:
- `fallback_used` debe ser `true`
- `fallback_template_name` debe existir

### Agente no ejecuta

1. Verificar `runtime_ready_at_execution`:
- Si es `false`: normal, usa `chat_completion`
- Si debería ser `true`: verificar materialización

2. Verificar `transport_success`:
- Si es `false`: problema de conectividad

### Approval no se procesa

1. Verificar status de generation:
```bash
curl http://localhost:3001/api/generations/{id}
```

2. Status debe ser `pending_approval`

3. Verificar FSM permite transición

---

## Gaps Conocidos

### Gap 1: Skills/Tools No Usados

```
Estado: Skills y tools se escriben al workspace pero OpenClaw NO los lee.
Impacto: Los recursos generados son decorativos.
Mitigación: Documentado en OpenClawCompatibility.ts
```

### Gap 2: Agentes No Son "Reales"

```
Estado: Todos los agentes usan chat_completion, no sesiones OpenClaw reales.
Impacto: runtime_ready siempre es false.
Mitigación: Sistema funciona vía chat_completion.
```

### Gap 3: spawn() No Crea Sesión Real

```
Estado: spawn() crea session ID local, no sesión OpenClaw.
Impacto: OpenClaw no "ve" estos agentes.
Mitigación: Documentado en ExecutionTraceability.ts
```

### Gap 4: Workspace Sin Conexión

```
Estado: Agent workspace se crea pero OpenClaw no lo carga.
Impacto: agent.json y system-prompt.md no se usan.
Mitigación: Documentado, sistema funciona sin ellos.
```

---

## Comandos Útiles

### Verificar Estado del Sistema

```bash
# Health check
curl http://localhost:3001/health

# Listar tasks
curl http://localhost:3001/api/tasks

# Listar agentes
curl http://localhost:3001/api/agents

# Listar generaciones pendientes
curl http://localhost:3001/api/generations?status=pending_approval
```

### Diagnóstico de Task

```bash
# Diagnóstico completo
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq

# Solo timeline
curl http://localhost:3001/api/tasks/{id}/timeline | jq

# Solo gaps
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.gaps'

# Solo warnings
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.warnings'

# AI usage
curl http://localhost:3001/api/tasks/{id}/diagnostics | jq '.data.ai_usage'
```

### Aprobar/Rechazar Generación

```bash
# Aprobar
curl -X POST http://localhost:3001/api/generations/{id}/approve \
  -H "Content-Type: application/json" \
  -d '{"approvedBy": "human:admin"}'

# Rechazar
curl -X POST http://localhost:3001/api/generations/{id}/reject \
  -H "Content-Type: application/json" \
  -d '{"rejectedBy": "human:admin", "reason": "Not appropriate"}'
```

---

## Tests de Validación

### Ejecutar Tests E2E

```bash
cd backend
npm run test -- tests/e2e-scenarios.test.ts
```

### Tests Incluidos

1. **ESCENARIO 1**: Input simple (no task)
2. **ESCENARIO 2**: Task simple (decision → execution)
3. **ESCENARIO 3**: Task con generación (full flow)
4. **ESCENARIO 4**: IA falla, fallback funciona
5. **ESCENARIO 5**: Aprobación rechazada
6. **ESCENARIO 6**: Ejecución sin runtime_ready

### Validar Build

```bash
cd backend
npm run build
npm run typecheck
```

---

## Contacto

Para issues: https://github.com/[repo]/issues

---

*Generado como parte de BLOQUE 12 - Validación E2E + Runbook*

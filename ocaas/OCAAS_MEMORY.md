# OCAAS - Sistema de Memoria

> Documento de referencia técnica. Actualizado: 2026-03-31

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

### Tareas
```
pending → queued → assigned → running → completed
                                    ↘ failed/cancelled
```

## 4. Componentes Clave

| Componente | Archivo | Función |
|------------|---------|---------|
| TaskRouter | `orchestrator/TaskRouter.ts` | Procesa cola, coordina decisiones |
| DecisionEngine | `orchestrator/DecisionEngine.ts` | Scoring y asignación de agentes |
| AIClient | `generator/AIClient.ts` | Interface con OpenClaw para generación |
| ActivationWorkflow | `services/ActivationWorkflowService.ts` | FSM de aprobación |
| Gateway | `openclaw/gateway.ts` | Cliente REST + WebSocket RPC |

## 5. Variables de Entorno Críticas

```env
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_API_KEY=<token>
API_SECRET_KEY=<min 16 chars>
TELEGRAM_BOT_TOKEN=<opcional>
TELEGRAM_WEBHOOK_SECRET=<opcional>
TELEGRAM_ALLOWED_USER_IDS=<opcional>
```

## 6. Estado del Proyecto (2026-03-31)

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
✅ validator.test.ts       - 15 tests
✅ workflow.test.ts        - 36 tests
✅ telegram-security.test.ts - 10 tests
✅ utils.test.ts           - 13 tests
```

## 7. Riesgos de Producción

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| SQLite en producción | Alto | Migrar a PostgreSQL |
| Sin rate limiting | Medio | Agregar @fastify/rate-limit |
| Secrets en .env | Medio | Usar secrets manager |

## 8. Próximos Pasos

1. Test integración end-to-end
2. PostgreSQL si producción real
3. Rate limiting
4. Probar Telegram real

---

*Ver [RUNBOOK.md](./RUNBOOK.md) para instalación y operación.*

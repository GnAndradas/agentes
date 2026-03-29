# OCAAS - Sistema de Memoria Completa

> Documento de referencia para mantener contexto del sistema. Actualizado: 2026-03-29

## 1. Visión General

**OCAAS (OpenClaw Agent Administration System)** es una plataforma de orquestación multi-agente que permite:
- Gestionar agentes de IA con diferentes especializaciones
- Asignar tareas de forma inteligente según capacidades
- Generar automáticamente nuevos agentes, skills y tools mediante IA
- Subdividir tareas complejas en subtareas manejables
- Controlar niveles de autonomía (manual, supervisado, autónomo)

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
│  ┌─────────┐ ┌──────┐ ┌───────┐ ┌───────┐ ┌─────────┐          │
│  │Dashboard│ │Agents│ │ Tasks │ │Skills │ │Generator│          │
│  └────┬────┘ └──┬───┘ └───┬───┘ └───┬───┘ └────┬────┘          │
│       └─────────┴─────────┴─────────┴──────────┘                │
│                          │                                       │
│              ┌───────────┴───────────┐                          │
│              │   API Client + WS     │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                           │ HTTP/WS
┌─────────────────────────────────────────────────────────────────┐
│                       BACKEND (Fastify)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     ORCHESTRATOR                          │   │
│  │  ┌────────────┐  ┌───────────────┐  ┌──────────────┐    │   │
│  │  │TaskRouter  │──│DecisionEngine │──│TaskDecomposer│    │   │
│  │  └────────────┘  └───────────────┘  └──────────────┘    │   │
│  │  ┌────────────┐  ┌───────────────┐  ┌──────────────┐    │   │
│  │  │QueueManager│  │ TaskAnalyzer  │  │ActionExecutor│    │   │
│  │  └────────────┘  └───────────────┘  └──────────────┘    │   │
│  │  ┌────────────┐  ┌───────────────┐                      │   │
│  │  │AgentManager│  │FeedbackService│                      │   │
│  │  └────────────┘  └───────────────┘                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      GENERATORS                             │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐     │ │
│  │  │AgentGenerator│ │SkillGenerator│ │  ToolGenerator │     │ │
│  │  └──────────────┘ └──────────────┘ └────────────────┘     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      SERVICES                               │ │
│  │  Agent│Task│Skill│Tool│Generation│Event│Approval│Feedback  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐           │
│  │  SQLite DB  │  │  WebSocket  │  │OpenClaw Adapter│           │
│  └─────────────┘  └─────────────┘  └───────────────┘           │
└─────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                               ┌──────────────────────────┐
                               │   OpenClaw Gateway       │
                               │   (Ejecución de Agentes) │
                               └──────────────────────────┘
```

---

## 3. Componentes del Orquestador

### 3.1 TaskRouter
**Archivo**: `backend/src/orchestrator/TaskRouter.ts`

Responsabilidades:
- Procesa la cola de tareas pendientes en intervalos regulares (1s)
- Coordina el flujo: análisis → decisión → asignación/decomposición → ejecución
- Maneja reintentos de tareas fallidas
- Recupera tareas pendientes al iniciar el sistema

```typescript
// Flujo principal
processQueue() {
  for task in pendingTasks:
    decision = decisionEngine.makeIntelligentDecision(task)

    if decision.suggestedActions.includes('subdivide'):
      taskDecomposer.decompose(task, analysis)

    if decision.assignment:
      actionExecutor.executeTask(task, agent)

    if decision.missingReport:
      handleMissingCapability(task, report)
}
```

### 3.2 DecisionEngine
**Archivo**: `backend/src/orchestrator/DecisionEngine.ts`

Motor de decisión inteligente con scoring ponderado:
- **Matching semántico de capacidades**: Agrupa términos relacionados (ej: "coding", "programming", "development")
- **Scoring de agentes**: Base(30) + Capacidades(25) + Tipo(20) + Disponibilidad(10)
- **Detección de capacidades faltantes**: Genera reportes y sugerencias

```typescript
// Pesos de scoring
SCORING_WEIGHTS = {
  baseScore: 30,
  exactCapabilityMatch: 25,
  semanticCapabilityMatch: 15,
  specialistTypeMatch: 20,
  busyPenalty: -50,
  criticalTaskBoost: 15,
}
```

### 3.3 TaskAnalyzer
**Archivo**: `backend/src/orchestrator/TaskAnalyzer.ts`

Análisis de tareas usando IA (OpenClaw Gateway):
- Identifica tipo de tarea y complejidad
- Determina capacidades requeridas
- Sugiere subtareas para descomposición
- Estima duración

```typescript
interface TaskAnalysis {
  taskType: string;              // ej: "coding", "deployment"
  complexity: 'low'|'medium'|'high';
  requiredCapabilities: string[];
  suggestedTools: string[];
  canBeSubdivided: boolean;
  suggestedSubtasks?: SubtaskSuggestion[];
  confidence: number;            // 0-1
}
```

### 3.4 TaskDecomposer
**Archivo**: `backend/src/orchestrator/TaskDecomposer.ts`

Subdivisión automática de tareas complejas:
- Umbral de confianza mínimo: 0.6
- Máximo de subtareas: 10
- Soporta dependencias secuenciales entre subtareas
- Agrega resultados de subtareas al completar padre

### 3.5 ActionExecutor
**Archivo**: `backend/src/orchestrator/ActionExecutor.ts`

Ejecución de tareas en agentes:
- Crea sesiones en OpenClaw Gateway
- Ejecuta prompts con las instrucciones de la tarea
- Procesa feedback del agente (missing_tool, blocked, etc.)
- Dispara generación automática de recursos faltantes

### 3.6 FeedbackService
**Archivo**: `backend/src/orchestrator/feedback/FeedbackService.ts`

Gestiona retroalimentación de agentes:
- Tipos: `missing_tool`, `missing_skill`, `missing_capability`, `blocked`, `cannot_continue`
- Dispara generación automática según configuración de autonomía
- Limpieza automática de feedback antiguo (cada hora)

---

## 4. Sistema de Generación

### 4.1 Flujo de Generación

```
1. CREATE (Draft)
   ↓
2. GENERATE (AI genera contenido)
   ↓
3. VALIDATE (Verifica estructura/sintaxis)
   ↓
4. PENDING_APPROVAL (Espera aprobación humana*)
   ↓
5. APPROVED → ACTIVATE (Crea recurso real)
   ↓
6. ACTIVE (Disponible para uso)

* En modo autónomo, puede auto-aprobar
```

### 4.2 Generadores

| Generador | Archivo de Salida | Ubicación |
|-----------|-------------------|-----------|
| AgentGenerator | `{name}.agent.json` | `~/.openclaw/workspace/agents/` |
| SkillGenerator | `{name}.skill.md` | `~/.openclaw/workspace/skills/` |
| ToolGenerator | `{name}.tool.ts` | `~/.openclaw/workspace/tools/` |

### 4.3 Estructura de Contenido Generado

```typescript
// Agent
{
  name: string;
  description: string;
  type: 'general' | 'specialist' | 'orchestrator';
  capabilities: string[];
  systemPrompt: string;
  config: Record<string, unknown>;
}

// Skill (Markdown con frontmatter)
---
name: string
description: string
version: string
capabilities: string[]
---
[Instrucciones del skill]

// Tool (TypeScript)
export const toolDefinition = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}
export async function execute(input): Promise<output>
```

---

## 5. Sistema de Autonomía

### 5.1 Niveles

| Nivel | Descripción |
|-------|-------------|
| `manual` | Todo requiere aprobación humana |
| `supervised` | Algunas acciones automáticas, otras supervisadas |
| `autonomous` | Sistema toma decisiones automáticamente |

### 5.2 Configuración por Recurso

```typescript
interface AutonomyConfig {
  level: 'manual' | 'supervised' | 'autonomous';
  autoApprove: boolean;
  approvalTimeout: number;  // ms
  timeoutAction: 'approve' | 'reject' | 'escalate';
  allowedGenerations: {
    agents: boolean;
    skills: boolean;
    tools: boolean;
  };
  requireApproval: {
    agentCreation: boolean;
    skillGeneration: boolean;
    toolGeneration: boolean;
    taskExecution: boolean;
  };
}
```

---

## 6. Base de Datos

### 6.1 Tablas Principales

```sql
agents       -- Agentes del sistema
tasks        -- Tareas y subtareas
skills       -- Skills disponibles
tools        -- Tools ejecutables
generations  -- Registro de generaciones AI
approvals    -- Flujo de aprobaciones
permissions  -- Permisos por agente
events       -- Log de eventos del sistema
feedback     -- Retroalimentación de agentes
```

### 6.2 Estados de Tarea

```
pending → queued → assigned → running → completed
                                    ↘ failed
                                    ↘ cancelled
```

---

## 7. API REST

### 7.1 Endpoints Principales

| Recurso | Operaciones |
|---------|-------------|
| `/api/agents` | CRUD + activate/deactivate |
| `/api/tasks` | CRUD + cancel/retry + subtasks |
| `/api/skills` | CRUD |
| `/api/tools` | CRUD |
| `/api/generations` | CRUD + approve/reject/activate |
| `/api/approvals` | List + pending + approve/reject/respond |
| `/api/feedback` | List + byTask + clearForTask |
| `/api/system` | health/stats/autonomy/orchestrator/events |

### 7.2 Formato de Respuesta

```json
{
  "data": { ... }  // Recurso o array de recursos
}
```

```json
{
  "error": "mensaje",
  "details": { ... }  // Opcional
}
```

---

## 8. WebSocket (Socket.io)

### 8.1 Canales

- `system` - Eventos del sistema
- `agents` - Cambios en agentes
- `tasks` - Cambios en tareas
- `generations` - Cambios en generaciones
- `events` - Stream de eventos
- `approvals` - Solicitudes de aprobación

### 8.2 Uso

```javascript
socket.emit('subscribe', ['agents', 'tasks']);
socket.on('event', (event) => {
  // { type, payload }
});
```

---

## 9. Frontend

### 9.1 Páginas

| Página | Ruta | Función |
|--------|------|---------|
| Dashboard | `/` | Resumen del sistema, eventos recientes |
| Agents | `/agents` | Lista y gestión de agentes |
| AgentDetail | `/agents/:id` | Detalle y edición de agente |
| Tasks | `/tasks` | Lista de tareas con filtros |
| TaskDetail | `/tasks/:id` | Detalle de tarea y subtareas |
| Skills | `/skills` | Gestión de skills |
| Tools | `/tools` | Gestión de tools |
| Generator | `/generator` | Formulario para generar recursos |
| Generations | `/generations` | Lista de generaciones |
| GenerationDetail | `/generations/:id` | Contenido generado y validación |
| Settings | `/settings` | Configuración de autonomía |

### 9.2 Estado Global (Zustand)

```typescript
interface AppState {
  // Conexión
  wsConnected: boolean;
  gatewayConnected: boolean;

  // UI
  sidebarOpen: boolean;
  statusBarVisible: boolean;

  // Actividad
  activities: Activity[];  // Últimas 50 actividades
}
```

### 9.3 Polling de Datos

```typescript
// React Query con refetch automático
useQuery({
  queryKey: ['agents'],
  queryFn: agentApi.list,
  refetchInterval: 5000,  // 5 segundos
});
```

---

## 10. Integración OpenClaw

### 10.1 API Webhook (v2026+)

OCAAS usa la **Webhook API** de OpenClaw, NO REST tradicional.

**Documentación oficial**: https://docs.openclaw.ai/automation/webhook

**Endpoints utilizados**:
- `GET /health` - Health check
- `POST /hooks/agent` - Envío de mensajes al agente
- `POST /hooks/wake` - Eventos de sistema (wake)

**Autenticación**:
```
Authorization: Bearer <OPENCLAW_API_KEY>
```

**Ejemplo de request a /hooks/agent**:
```json
{
  "message": "Genera un agente de coding",
  "wakeMode": "now",
  "deliver": false,
  "model": "claude-sonnet-4-20250514",
  "timeoutSeconds": 120
}
```

### 10.2 Funcionalidades

- **Sesiones de agente**: Gestionadas localmente con sessionKey
- **Workspace**: Leer/escribir skills y tools en `~/.openclaw/workspace/`
- **LLM via Webhook**: Todas las llamadas pasan por `/hooks/agent`

### 10.3 Modo Offline

Si el Gateway no está disponible:
- Generación AI deshabilitada
- Ejecución de tareas deshabilitada
- CRUD de recursos sigue funcionando
- Frontend muestra indicador de desconexión

---

## 11. Tipos de Dominio Clave

```typescript
// Estados de Agente
type AgentStatus = 'active' | 'inactive' | 'busy' | 'error';
type AgentType = 'general' | 'specialist' | 'orchestrator';

// Estados de Tarea
type TaskStatus = 'pending' | 'queued' | 'assigned' | 'running' |
                  'completed' | 'failed' | 'cancelled';
type TaskPriority = 1 | 2 | 3 | 4;  // LOW, NORMAL, HIGH, CRITICAL

// Estados de Generación
type GenerationStatus = 'draft' | 'generated' | 'pending_approval' |
                        'approved' | 'rejected' | 'active' | 'failed';
type GenerationType = 'agent' | 'skill' | 'tool';

// Feedback de Agente
type FeedbackType = 'missing_tool' | 'missing_skill' |
                    'missing_capability' | 'blocked' | 'cannot_continue';
```

---

## 12. Variables de Entorno

```env
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=./data/ocaas.db

# OpenClaw
OPENCLAW_GATEWAY_URL=http://localhost:3000
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace
OPENCLAW_API_KEY=

# Security
API_SECRET_KEY=your-secret-key-min-16-chars

# Logging
LOG_LEVEL=info
```

---

## 13. Scripts de Gestión

| Script | Función |
|--------|---------|
| `./scripts/install.sh` | Instalación completa |
| `./scripts/dev.sh` | Desarrollo con hot-reload |
| `./scripts/start.sh` | Producción |
| `./scripts/healthcheck.sh` | Diagnóstico del sistema |

---

## 14. Flujo de Trabajo Típico

### 14.1 Crear y Ejecutar una Tarea

1. Usuario crea tarea desde UI o API
2. TaskRouter detecta tarea pendiente
3. TaskAnalyzer analiza la tarea con AI
4. DecisionEngine decide:
   - Si hay agente disponible → asignar
   - Si es compleja → subdividir
   - Si falta capacidad → generar recurso
5. ActionExecutor ejecuta en OpenClaw
6. Resultado se guarda, UI se actualiza vía WS

### 14.2 Generar un Nuevo Skill

1. Usuario accede a Generator, selecciona "Skill"
2. Completa nombre, descripción, prompt
3. Backend ejecuta SkillGenerator:
   - Llama a LLM via OpenClaw
   - Valida estructura del skill
   - Crea registro en `pending_approval`
4. Usuario revisa en Generations
5. Usuario aprueba → skill se activa
6. Skill se escribe en workspace y se registra en DB

---

## 15. Consideraciones de Producción

### 15.1 Checklist Pre-Deploy

- [ ] Variables de entorno configuradas
- [ ] OpenClaw Gateway accesible
- [ ] Base de datos migrada
- [ ] Logs configurados
- [ ] Nivel de autonomía apropiado
- [ ] Timeouts de aprobación definidos

### 15.2 Monitoreo

- `/api/system/health` - Healthcheck
- `/api/system/stats` - Estadísticas
- Canal WS `events` - Stream de eventos
- Logs en `logs/backend.log`

---

## 16. Bugs Conocidos y Fixes Aplicados (Auditoría 2026-03-29)

### Backend

| Archivo | Problema | Severidad | Fix |
|---------|----------|-----------|-----|
| `api/generations/handlers.ts:83` | `generationId` podía ser undefined y se usaba sin validar | CRITICAL | Agregar validación antes de usar |
| `api/feedback/routes.ts` | Rutas `/:id` antes de `/task/:taskId` causaba conflicto | HIGH | Reordenar: literales primero |
| `api/permissions/routes.ts` | Mismo problema de orden de rutas | HIGH | Reordenar: literales primero |
| `api/feedback/schemas.ts` | Faltaba `type` en ListFeedbackQuerySchema | MEDIUM | Agregar campo |

### Frontend

| Archivo | Problema | Severidad | Fix |
|---------|----------|-----------|-----|
| `pages/Skills.tsx:68` | `skillApi.sync` comentado pero usado en syncMutation | CRITICAL | Comentar también el mutation y botón |
| `components/control/ApprovalsPanel.tsx` | Mutations sin `onError` handler | HIGH | Agregar notificación de error |
| `components/control/AutonomyPanel.tsx` | Mutation sin `onError` handler | HIGH | Agregar notificación de error |
| `lib/api.ts` | POST sin body fallaba (400) | HIGH | Enviar `{}` en lugar de `undefined` |
| `lib/api.ts` | `/events` 404 | HIGH | Cambiar a `/system/events` |
| `pages/Tasks.tsx:241` | `task.attempts` no existe en tipo | MEDIUM | Usar `task.retryCount` |
| `pages/Agents.tsx` | `capabilities` undefined | MEDIUM | Agregar optional chaining |
| `pages/Skills.tsx:77` | Type mismatch en status | MEDIUM | Agregar cast explícito |
| `pages/Tools.tsx:82` | Type mismatch en status | MEDIUM | Agregar cast explícito |

### Bugs Pendientes (Pre-existentes, no críticos)

| Archivo | Problema | Severidad |
|---------|----------|-----------|
| `hooks/useTrackedMutation.ts` | Errores de tipos genéricos complejos | LOW |
| `components/SubtasksPanel.tsx` | Variable `parentTitle` no usada, prop `title` inválida en Lucide | LOW |
| `pages/Tasks.tsx:188,190` | Prop `title` inválida en iconos Lucide | LOW |
| `pages/Settings.tsx:2` | Import `SettingsIcon` no usado | LOW |
| `pages/TaskDetail.tsx:212,216` | `undefined` vs `null` en fromTimestamp | LOW |

---

*Este documento debe actualizarse cuando se realicen cambios significativos en la arquitectura o comportamiento del sistema.*

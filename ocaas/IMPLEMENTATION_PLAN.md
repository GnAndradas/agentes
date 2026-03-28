# OCAAS - Plan de Implementación: Capa de Control Autónomo

## Contexto del Proyecto

OCAAS es un orquestador multiagente que usa OpenClaw Gateway como motor de ejecución.
El sistema permite crear agentes, asignar tareas, generar skills/tools vía LLM.

## Objetivo de esta Implementación

Añadir una capa de control autónomo y supervisión humana sin rediseñar el sistema existente.

---

## Componentes Existentes (NO MODIFICAR ESTRUCTURA)

- `orchestrator/TaskRouter.ts` - Enrutamiento y cola de tareas
- `orchestrator/QueueManager.ts` - Gestión de cola con prioridades
- `orchestrator/DecisionEngine.ts` - Selección de agente para tarea
- `orchestrator/AgentManager.ts` - Gestión de agentes activos
- `openclaw/SessionManager.ts` - Sesiones con OpenClaw Gateway
- `generator/SkillGenerator.ts` - Generación de skills
- `generator/ToolGenerator.ts` - Generación de tools
- `generator/AgentGenerator.ts` - Generación de agentes
- `services/EventService.ts` - Emisión de eventos
- `websocket/EventBridge.ts` - Bridge a WebSocket

---

## Nuevos Módulos a Crear

### 1. Config de Autonomía
- `config/autonomy.ts` - Tipos y gestión de configuración de autonomía

### 2. Sistema de Aprobaciones
- `approval/types.ts` - Tipos para aprobaciones
- `approval/ApprovalService.ts` - Servicio CRUD de aprobaciones

### 3. Sistema de Notificaciones
- `notifications/types.ts` - Tipos para notificaciones
- `notifications/TelegramChannel.ts` - Canal Telegram
- `notifications/NotificationService.ts` - Orquestador de notificaciones

### 4. API Endpoints
- `api/approvals/` - CRUD de aprobaciones
- `api/webhooks/telegram.ts` - Webhook para respuestas Telegram

---

## Schema de Base de Datos (Nuevas Tablas)

### Tabla: system_config
```sql
id TEXT PRIMARY KEY
key TEXT UNIQUE NOT NULL
value TEXT NOT NULL
updatedAt INTEGER NOT NULL
```

### Tabla: approvals
```sql
id TEXT PRIMARY KEY
type TEXT NOT NULL  -- 'task' | 'agent' | 'skill' | 'tool'
resourceId TEXT
status TEXT DEFAULT 'pending'  -- 'pending' | 'approved' | 'rejected' | 'expired'
requestedAt INTEGER NOT NULL
expiresAt INTEGER
respondedAt INTEGER
respondedBy TEXT
reason TEXT
metadata TEXT
```

---

## Configuración de Autonomía

```typescript
type AutonomyLevel = 'manual' | 'supervised' | 'autonomous';

interface AutonomyConfig {
  level: AutonomyLevel;
  canCreateAgents: boolean;
  canGenerateSkills: boolean;
  canGenerateTools: boolean;
  requireApprovalFor: {
    taskExecution: 'none' | 'high_priority' | 'all';
    agentCreation: boolean;
    skillGeneration: boolean;
    toolGeneration: boolean;
  };
  humanTimeout: number;  // ms, default 300000 (5 min)
  fallbackBehavior: 'pause' | 'reject' | 'auto_approve';
  sequentialExecution: boolean;
}
```

---

## Flujo de Aprobación

1. TaskRouter detecta que tarea requiere aprobación
2. Crea entrada en `approvals` con status 'pending'
3. NotificationService envía alerta (Telegram → WebSocket fallback)
4. Espera respuesta hasta `expiresAt`
5. Si respuesta: actualiza status y continúa/cancela
6. Si timeout: aplica `fallbackBehavior`

---

## Variables de Entorno Nuevas

```
# Telegram (opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Autonomía defaults
AUTONOMY_LEVEL=supervised
AUTONOMY_HUMAN_TIMEOUT=300000
AUTONOMY_FALLBACK=pause
```

---

## Orden de Implementación

1. [x] Crear este archivo de memoria
2. [x] Schema DB: system_config + approvals
3. [x] config/autonomy.ts
4. [x] approval/types.ts
5. [x] approval/ApprovalService.ts
6. [x] notifications/types.ts
7. [x] notifications/TelegramChannel.ts
8. [x] notifications/NotificationService.ts
9. [x] api/approvals/ (handlers, routes, schemas)
10. [x] api/webhooks/telegram
11. [x] Modificar api/system/ para endpoints autonomía
12. [x] Modificar TaskRouter.ts
13. [x] Modificar DecisionEngine.ts
14. [x] Modificar AgentService.ts
15. [x] Modificar SkillGenerator.ts
16. [x] Modificar ToolGenerator.ts
17. [x] Actualizar services/index.ts
18. [x] Actualizar env.ts
19. [x] Actualizar .env.example
20. [ ] db:generate + db:push (ejecutar en Linux/macOS)

---

## Notas Importantes

- OpenClaw Gateway corre en puerto 3000
- Backend OCAAS corre en puerto 3001
- Usar `db:push` NO `db:migrate` (SQLite + Drizzle)
- No hay autenticación implementada aún
- WebSocket ya funciona para eventos en tiempo real

---

## Archivos Creados/Modificados

### Nuevos archivos:
- `db/schema/system.ts` - Tabla system_config
- `db/schema/approvals.ts` - Tabla approvals
- `config/autonomy.ts` - Configuración de autonomía
- `approval/types.ts` - Tipos de aprobación
- `approval/ApprovalService.ts` - Servicio de aprobaciones
- `approval/index.ts` - Exports
- `notifications/types.ts` - Tipos de notificaciones
- `notifications/TelegramChannel.ts` - Canal Telegram
- `notifications/NotificationService.ts` - Servicio de notificaciones
- `notifications/index.ts` - Exports
- `api/approvals/schemas.ts` - Schemas Zod
- `api/approvals/handlers.ts` - Handlers API
- `api/approvals/routes.ts` - Rutas
- `api/webhooks/telegram.ts` - Webhook Telegram
- `api/webhooks/routes.ts` - Rutas webhook

### Archivos modificados:
- `db/schema/index.ts` - Añadidos exports de nuevas tablas
- `api/index.ts` - Añadidas rutas de approvals y webhooks
- `api/system/handlers.ts` - Endpoints de autonomía
- `api/system/routes.ts` - Rutas de autonomía
- `orchestrator/TaskRouter.ts` - Integración con ApprovalService
- `orchestrator/DecisionEngine.ts` - Verificación de autonomía
- `services/AgentService.ts` - Verificación de permisos
- `generator/SkillGenerator.ts` - Verificación de permisos
- `generator/ToolGenerator.ts` - Verificación de permisos
- `services/index.ts` - Añadidos ApprovalService y NotificationService
- `config/env.ts` - Variables Telegram y autonomía
- `utils/errors.ts` - ForbiddenError
- `index.ts` - Carga de autonomía al inicio
- `.env.example` - Nuevas variables

---

## Para completar en Linux/macOS

```bash
cd ocaas
npm install
npm run db:generate
npm run db:push
npm run dev
```

## Endpoints nuevos

- `GET /api/system/autonomy` - Obtener configuración de autonomía
- `PUT /api/system/autonomy` - Actualizar configuración
- `GET /api/system/orchestrator` - Estado del orquestador
- `GET /api/approvals` - Listar aprobaciones
- `GET /api/approvals/pending` - Aprobaciones pendientes
- `GET /api/approvals/:id` - Obtener aprobación
- `POST /api/approvals` - Crear aprobación
- `POST /api/approvals/:id/approve` - Aprobar
- `POST /api/approvals/:id/reject` - Rechazar
- `POST /api/approvals/:id/respond` - Responder (approve/reject)
- `DELETE /api/approvals/:id` - Eliminar aprobación
- `POST /api/webhooks/telegram` - Webhook Telegram

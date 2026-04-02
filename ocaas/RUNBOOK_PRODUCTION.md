# OCAAS Production Runbook

> Guía de instalación, configuración y operación para producción.

## 1. Prerequisitos

### Sistema

| Requisito | Mínimo | Recomendado |
|-----------|--------|-------------|
| Node.js | v18+ | v20+ LTS |
| RAM | 512MB | 2GB+ |
| Disco | 1GB | 10GB+ |
| OS | Linux/macOS/Windows | Linux (Ubuntu 22.04+) |

### Software Requerido

```bash
# Verificar Node.js
node --version  # >= v18.0.0

# Verificar npm
npm --version   # >= 9.0.0
```

### OpenClaw Gateway

OCAAS requiere OpenClaw gateway funcionando. Instalar según documentación de OpenClaw:

```bash
# Verificar OpenClaw instalado
openclaw --version

# O verificar manualmente
curl http://localhost:18789/health
```

## 2. Instalación Limpia

### Paso 1: Clonar y preparar

```bash
# Clonar repositorio (reemplazar con tu URL real)
git clone https://github.com/tu-org/ocaas.git /opt/ocaas
cd /opt/ocaas

# Instalar dependencias
npm install
```

### Paso 2: Crear directorios

```bash
cd /opt/ocaas

# Crear directorios requeridos
mkdir -p logs data
```

### Paso 3: Configurar base de datos

```bash
# La DB SQLite se crea automáticamente al iniciar
# Ubicación por defecto: ./data/ocaas.db

# Para migrar/actualizar schema (si aplica):
npm run db:push
```

## 3. Configuración .env

Crear archivo `/opt/ocaas/.env`:

```env
# ============================================
# REQUERIDAS
# ============================================

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_API_KEY=your-openclaw-api-key-here

# API Security (mínimo 16 caracteres)
API_SECRET_KEY=your-secure-api-key-min-16-chars

# ============================================
# OPCIONALES
# ============================================

# Server
PORT=3001
NODE_ENV=production

# Database (default: ./data/ocaas.db)
DATABASE_PATH=./data/ocaas.db

# Logging
LOG_LEVEL=info

# Channel Security (usa API_SECRET_KEY si no está)
CHANNEL_SECRET_KEY=your-channel-secret-key

# WebSocket Mode: required | optional | disabled
# - optional (default): degrade gracefully if WS fails
# - disabled: never attempt WS connection (REST-only mode)
# - required: fail if WS cannot connect
OPENCLAW_WS_MODE=optional

# WebSocket URL (default: derived from OPENCLAW_GATEWAY_URL)
# Set explicitly if WS endpoint differs from REST
# OPENCLAW_WS_URL=ws://localhost:18789

# Telegram (si se usa)
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_USER_IDS=
```

### Generar claves seguras

```bash
# Generar API_SECRET_KEY
openssl rand -base64 32

# Generar CHANNEL_SECRET_KEY
openssl rand -base64 32
```

## 4. Orden de Arranque

### Secuencia correcta:

```
1. OpenClaw Gateway  (puerto 18789)
2. OCAAS Backend     (puerto 3001)
3. OCAAS Frontend    (puerto 5173, si aplica)
```

### Paso 1: Iniciar OpenClaw

```bash
# Opción 1: Como servicio
openclaw start

# Opción 2: Manual
openclaw serve

# Verificar
curl http://localhost:18789/health
```

### Paso 2: Validar configuración OCAAS

```bash
cd /opt/ocaas

# Ejecutar doctor (verifica todo)
npm run doctor

# O solo bootstrap (verifica mínimos)
npm run bootstrap
```

**Resultado esperado:**
```
STATUS: READY
Readiness Score: 100/100
```

**Si muestra DEGRADED:**
- OpenClaw no conectado → iniciar OpenClaw primero
- Variables faltantes → revisar .env

**Si muestra NOT_READY:**
- Revisar errores críticos mostrados
- Corregir y re-ejecutar doctor

### Paso 3: Iniciar OCAAS

```bash
# Desarrollo
npm run dev

# Producción
npm run build
npm run start
```

### Paso 4: Verificar funcionamiento

```bash
# Health check básico
curl http://localhost:3001/health

# Diagnósticos completos
curl http://localhost:3001/api/system/diagnostics

# Smoke test completo
npm run smoke-test
```

## 5. Validación Post-Arranque

### Checklist manual:

| Check | Comando | Esperado |
|-------|---------|----------|
| Backend health | `curl localhost:3001/health` | `{"status":"ok"}` |
| Diagnostics | `curl localhost:3001/api/system/diagnostics` | `status: healthy` |
| OpenClaw | `curl localhost:3001/api/system/gateway` | `connected: true` |
| Tasks API | `curl localhost:3001/api/tasks` | Array (puede estar vacío) |
| Agents API | `curl localhost:3001/api/agents` | Array (puede estar vacío) |
| Resources API | `curl localhost:3001/api/resources` | `{skills:[], tools:[], total:N}` |

### Smoke test automático:

```bash
npm run smoke-test

# Esperado: STATUS: PASS
```

## 6. Troubleshooting

### Error: "OPENCLAW_GATEWAY_URL not configured"

```bash
# Verificar .env existe
cat /opt/ocaas/.env | grep OPENCLAW

# Solución: agregar a .env
OPENCLAW_GATEWAY_URL=http://localhost:18789
```

### Error: "OpenClaw connection failed"

```bash
# Verificar OpenClaw está corriendo
curl http://localhost:18789/health

# Si no responde, iniciar OpenClaw:
openclaw start

# Verificar URL correcta en .env
```

### Error: "API_SECRET_KEY must be at least 16 characters"

```bash
# Generar nueva key
openssl rand -base64 32

# Actualizar .env
API_SECRET_KEY=<nueva-key-generada>
```

### Error: "Database error"

```bash
# Verificar permisos del directorio data
ls -la /opt/ocaas/data/

# Crear si no existe
mkdir -p /opt/ocaas/data

# Verificar archivo DB
ls -la /opt/ocaas/data/ocaas.db

# Si DB corrupta, backup y recrear:
mv /opt/ocaas/data/ocaas.db /opt/ocaas/data/ocaas.db.bak
npm run db:push
```

### Error: "no such table: resource_drafts" (o cualquier tabla)

Este error indica una instalación incompleta o DB creada antes de agregar nuevas tablas.

```bash
# Opción 1: Reiniciar backend (initDatabase crea las tablas)
npm run start

# Opción 2: Ejecutar doctor para verificar
npm run doctor

# Si persiste, recrear DB:
rm /opt/ocaas/data/ocaas.db
npm run start
```

### WebSocket cierra con code 1000 (loop de reconexión)

El servidor OpenClaw puede no soportar el protocolo WS de OCAAS, o el WS endpoint no existe.

```bash
# Opción 1: Usar modo REST-only
# En .env agregar:
OPENCLAW_WS_MODE=disabled

# Opción 2: Verificar URL correcta
# El WS URL se deriva de GATEWAY_URL por defecto
# Si es diferente, especificar explícitamente:
OPENCLAW_WS_URL=ws://your-ws-endpoint

# Nota: REST OK + WS OFF = sistema DEGRADED, NO "Backend Off"
# El sistema sigue funcionando con REST.
```

### Error: "Directory not writable"

```bash
# Verificar permisos
ls -la /opt/ocaas/

# Dar permisos
chmod 755 /opt/ocaas/logs /opt/ocaas/data
```

### Sistema muestra DEGRADED

```bash
# Ejecutar doctor para ver detalles
npm run doctor

# Problemas comunes:
# - OpenClaw no conectado: iniciar OpenClaw
# - Circuit breakers open: revisar errores previos
# - Expired leases: se limpian automáticamente
```

## 7. Recovery Básico

### Reinicio limpio

```bash
# Detener OCAAS
# (Ctrl+C si está en foreground, o kill proceso)

# Limpiar estado temporal
rm -f /opt/ocaas/data/*.tmp

# Re-ejecutar validación
cd /opt/ocaas && npm run doctor

# Reiniciar
npm run start
```

### Recuperar de DB corrupta

```bash
# Backup
cp /opt/ocaas/data/ocaas.db /opt/ocaas/data/ocaas.db.backup

# Recrear
rm /opt/ocaas/data/ocaas.db
npm run db:push

# NOTA: Se pierden datos. Para producción real,
# implementar backups regulares.
```

### Reset completo

```bash
# Solo si necesario - ELIMINA TODOS LOS DATOS
cd /opt/ocaas
rm -rf data/ocaas.db
rm -rf logs/*

npm run db:push
npm run doctor
npm run start
```

## 7.1 Recovery de Tareas (Resiliencia)

OCAAS incluye un sistema de resiliencia que previene doble ejecución y permite recovery después de crashes.

### Conceptos Clave

| Concepto | Descripción |
|----------|-------------|
| **Lease** | Lock temporal que previene que una task se ejecute dos veces simultáneamente |
| **Checkpoint** | Estado guardado de una ejecución para recovery |
| **Orphan** | Lease o ejecución sin correspondencia válida |

### Recovery Automático al Startup

Al iniciar OCAAS, automáticamente:

1. Libera leases expirados (>5 min sin renovación)
2. Re-encola tasks en estados intermedios
3. Pausa tasks stale (>10 min sin update) para revisión
4. Limpia checkpoints de tasks terminadas

**Verificar recovery:**
```bash
# Ver logs de recovery al startup
grep "recovery" /opt/ocaas/logs/combined.log | tail -20

# Ver estado de resiliencia
curl localhost:3001/api/system/diagnostics | jq '.data.checks[] | select(.category=="resilience")'
```

### Tasks Stuck (Atascadas)

Si una task queda en estado `running` o `assigned` sin progresar:

```bash
# 1. Verificar estado actual
curl localhost:3001/api/tasks | jq '.[] | select(.status=="running" or .status=="assigned")'

# 2. Ver si tiene lease activo
curl localhost:3001/api/system/diagnostics | jq '.data.metrics.resilience'
# Buscar: activeLeases, orphanLeases

# 3. Forzar liberación via restart
# El cleanup automático correrá al reiniciar
npm run start

# 4. Si persiste, verificar en logs
grep "task_id" /opt/ocaas/logs/orchestrator.log | tail -50
```

### Orphan Tasks (Huérfanas)

Cada 30 segundos, OCAAS detecta y limpia orphans automáticamente.

**Causas comunes:**
- Crash durante ejecución
- OpenClaw timeout sin respuesta
- Red intermitente

**Verificar orphans:**
```bash
curl localhost:3001/api/system/diagnostics | jq '.data.metrics.resilience.orphanLeases'
```

**Si hay muchos orphans persistentes:**
```bash
# 1. Verificar OpenClaw está respondiendo
curl localhost:18789/health

# 2. Ver errores de conexión
grep "connection" /opt/ocaas/logs/integration.log | tail -20

# 3. Verificar circuit breakers
curl localhost:3001/api/system/diagnostics | jq '.data.checks[] | select(.category=="resilience")'
```

### Doble Ejecución Prevenida

El sistema previene que una task se ejecute dos veces simultáneamente mediante leases.

**Si sospechas doble ejecución:**
```bash
# 1. Buscar warnings en logs
grep "already has active lease" /opt/ocaas/logs/orchestrator.log

# 2. Verificar leases activos
curl localhost:3001/api/system/diagnostics | jq '.data.metrics.resilience.activeLeases'

# 3. Ver checkpoints activos
curl localhost:3001/api/system/diagnostics | jq '.data.metrics.resilience.activeCheckpoints'
```

### FSM - Transiciones Inválidas

Las transiciones de estado están validadas. Si ves errores de transición inválida:

```
Error: Invalid state transition: completed → running
```

**Transiciones válidas:**
```
pending   → queued, cancelled
queued    → assigned, cancelled, pending (retry)
assigned  → running, failed, cancelled, queued (re-assign)
running   → completed, failed, cancelled
completed → (terminal - no transitions)
failed    → pending (retry)
cancelled → (terminal - no transitions)
```

**Diagnóstico:**
```bash
# Ver transición que falló
grep "Invalid state transition" /opt/ocaas/logs/combined.log | tail -10

# Esto NO es un bug - el sistema está previniendo un estado inconsistente
```

### Métricas de Resiliencia

```bash
curl localhost:3001/api/system/metrics | jq '.data.resilience'
```

Respuesta ejemplo:
```json
{
  "activeLeases": 2,
  "expiredLeases": 0,
  "orphanLeases": 0,
  "activeCheckpoints": 2,
  "pausedCheckpoints": 0,
  "circuitBreakers": {
    "main": "closed",
    "openclaw": "closed"
  }
}
```

| Métrica | Valor Normal | Acción si Anormal |
|---------|--------------|-------------------|
| activeLeases | 0-5 | >10 = posible leak, reiniciar |
| expiredLeases | 0 | >0 = cleanup pendiente, esperar 30s |
| orphanLeases | 0 | >0 = cleanup pendiente, esperar 30s |
| pausedCheckpoints | 0 | >0 = revisar tasks pausadas |
| circuitBreakers | closed | open = OpenClaw con problemas |

## 7.2 Checkpoints Persistentes (NEW)

Los checkpoints críticos ahora se persisten a la base de datos para sobrevivir reinicios.

### Verificar checkpoints persistidos

```bash
# Ver checkpoints en DB
sqlite3 /opt/ocaas/data/ocaas.db "SELECT task_id, current_stage, progress_percent, last_known_blocker FROM task_checkpoints"

# Contar checkpoints por stage
sqlite3 /opt/ocaas/data/ocaas.db "SELECT current_stage, COUNT(*) FROM task_checkpoints GROUP BY current_stage"
```

### Stages que se persisten

| Stage | Descripción | Se persiste |
|-------|-------------|-------------|
| executing | En ejecución | ✅ Sí |
| awaiting_response | Esperando OpenClaw | ✅ Sí |
| processing_result | Procesando resultado | ✅ Sí |
| paused | Pausado manualmente | ✅ Sí |
| waiting_approval | Esperando aprobación | ✅ Sí |
| waiting_resource | Esperando recurso | ✅ Sí |
| retrying | En proceso de retry | ✅ Sí |
| queued | En cola | ❌ No (transitorio) |
| completed | Completado | ❌ No (se borra) |
| failed | Fallido | ❌ No (se borra) |

### Recovery de checkpoints tras restart

Al iniciar OCAAS:

1. `initializeCheckpointStore()` carga checkpoints de DB
2. `startupRecovery()` procesa checkpoints cargados
3. Tasks en stages persistentes se re-encolan o pausan

```bash
# Ver logs de recovery de checkpoints
grep "Checkpoints loaded from DB" /opt/ocaas/logs/combined.log
grep "checkpointsLoaded" /opt/ocaas/logs/combined.log
```

### Troubleshooting checkpoints

**Checkpoint stuck en DB:**
```bash
# Ver checkpoint específico (reemplazar TASK_ID con el ID real)
TASK_ID="tu_task_id_aqui"
sqlite3 /opt/ocaas/data/ocaas.db "SELECT * FROM task_checkpoints WHERE task_id='$TASK_ID'"

# Eliminar checkpoint manualmente (último recurso)
sqlite3 /opt/ocaas/data/ocaas.db "DELETE FROM task_checkpoints WHERE task_id='$TASK_ID'"
```

**Muchos checkpoints acumulados:**
```bash
# Ver antiguedad de checkpoints
sqlite3 /opt/ocaas/data/ocaas.db "SELECT task_id, current_stage, datetime(updated_at, 'unixepoch') as updated FROM task_checkpoints ORDER BY updated_at"

# Limpiar checkpoints viejos (>24 horas)
sqlite3 /opt/ocaas/data/ocaas.db "DELETE FROM task_checkpoints WHERE updated_at < strftime('%s', 'now') - 86400"
```

**Flush manual de checkpoints:**

Si OCAAS se cierra abruptamente, algunos checkpoints pueden no haberse guardado (debounce de 1 segundo). Al reiniciar, estos se reconstruyen desde el estado de las tasks en DB.

## 7.3 Observabilidad y Detección de Problemas (NEW)

OCAAS incluye un sistema de observabilidad que permite ver el timeline completo de tareas y detectar problemas automáticamente.

### Endpoints de Observabilidad

```bash
# Vista general del sistema con todos los problemas
curl localhost:3001/api/system/overview | jq

# Timeline completo de una task específica
curl localhost:3001/api/system/tasks/<task_id>/timeline | jq

# Ver todos los problemas detectados
curl localhost:3001/api/system/problems | jq

# Solo tasks atascadas (>30 min sin progreso)
curl localhost:3001/api/system/problems/stuck | jq

# Solo tasks con muchos reintentos (>=3)
curl localhost:3001/api/system/problems/high-retry | jq

# Solo tasks bloqueadas (approval, resource, dependency)
curl localhost:3001/api/system/problems/blocked | jq
```

### Respuesta de System Overview

```json
{
  "tasks": {
    "total": 150,
    "byStatus": { "completed": 120, "running": 5, "pending": 25 },
    "activeCount": 5,
    "problemCount": 2
  },
  "problems": {
    "stuck": [],
    "highRetry": [
      {
        "taskId": "abc123",
        "title": "Process report",
        "retryCount": 4,
        "pattern": "Frequent timeout errors",
        "suggestedAction": "Consider increasing timeout limits"
      }
    ],
    "blocked": []
  },
  "recentActivity": {
    "tasksCreated": 15,
    "tasksCompleted": 12,
    "tasksFailed": 1,
    "eventsEmitted": 89
  },
  "health": {
    "avgTaskDurationMs": 45000,
    "successRate": 92.31,
    "errorRate": 7.69
  }
}
```

### Respuesta de Task Timeline

```json
{
  "taskId": "abc123",
  "taskTitle": "Process report",
  "currentStatus": "running",
  "currentStage": "executing",
  "entries": [
    { "type": "state_change", "timestamp": 1700000000, "title": "Task Created", "severity": "info" },
    { "type": "state_change", "timestamp": 1700000100, "title": "Task Started", "severity": "info" },
    { "type": "checkpoint", "timestamp": 1700000200, "title": "Checkpoint: executing", "severity": "info" }
  ],
  "summary": {
    "totalEvents": 5,
    "stateChanges": 2,
    "errors": 0,
    "retries": 0,
    "durationMs": 300000,
    "currentBlocker": null
  },
  "related": {
    "agentId": "agent_1",
    "childTaskIds": [],
    "pendingApproval": null,
    "pendingResources": []
  }
}
```

### Tipos de Problemas Detectados

| Problema | Criterio | Acción Sugerida |
|----------|----------|-----------------|
| **Stuck** | Task en running/assigned > 30 min sin update | Ver checkpoint blocker, revisar OpenClaw |
| **High Retry** | retryCount >= 3, no completada | Analizar patrón de errores, ajustar config |
| **Blocked - Approval** | Checkpoint en waiting_approval | Procesar approval pendiente |
| **Blocked - Resource** | Checkpoint en waiting_resource | Activar resource drafts pendientes |
| **Blocked - Dependency** | Task con dependsOn pendientes | Esperar o cancelar dependencias |

### Patrones de Error Detectados Automáticamente

El sistema detecta patrones en los errores para sugerir acciones:

| Patrón | Detección | Acción Sugerida |
|--------|-----------|-----------------|
| Timeout repetido | >50% errores contienen "timeout" | Incrementar timeout o optimizar task |
| Error de conexión | >50% errores contienen "connection" | Verificar conectividad, health de OpenClaw |
| Mismo error repetido | Todos los errores son idénticos | Investigar causa raíz específica |

### Uso Operacional

**Monitoreo periódico:**
```bash
# Cada 5 minutos, verificar problemas
watch -n 300 'curl -s localhost:3001/api/system/problems | jq ".counts"'
```

**Dashboard manual:**
```bash
# Ver resumen rápido
curl -s localhost:3001/api/system/overview | jq '{
  total: .data.tasks.total,
  active: .data.tasks.activeCount,
  problems: .data.tasks.problemCount,
  success_rate: .data.health.successRate
}'
```

**Investigar task específica:**
```bash
# Obtener timeline completo
TASK_ID="abc123"
curl -s "localhost:3001/api/system/tasks/$TASK_ID/timeline" | jq
```

## 8. Logs Importantes

### Ubicación de logs

```
/opt/ocaas/logs/
├── combined.log      # Todos los logs
├── system.log        # Logs de sistema
├── orchestrator.log  # Logs del orquestador
├── integration.log   # Logs de OpenClaw/integraciones
└── audit.log         # Logs de auditoría/seguridad
```

### Ver logs en tiempo real

```bash
# Todos los logs
tail -f /opt/ocaas/logs/combined.log

# Solo errores
grep -i error /opt/ocaas/logs/combined.log | tail -20

# Logs de OpenClaw
tail -f /opt/ocaas/logs/integration.log

# Logs de tareas
grep -i task /opt/ocaas/logs/orchestrator.log | tail -20
```

### Logs en desarrollo

En desarrollo, los logs van a stdout con formato legible.

## 9. Verificar Bridge/Daemon

### Verificar ChannelBridge activo

```bash
# Vía diagnostics
curl localhost:3001/api/system/diagnostics | jq '.data.checks[] | select(.category=="channels")'

# Esperado: status: "pass" o "warn"
```

### Verificar flujo de canal

```bash
# 1. Ingestar mensaje de prueba
curl -X POST localhost:3001/api/channels/ingest \
  -H "Content-Type: application/json" \
  -H "X-CHANNEL-SECRET: $CHANNEL_SECRET_KEY" \
  -d '{
    "channel": "test",
    "userId": "test-user",
    "message": "Test message from runbook"
  }'

# 2. Verificar task creada
curl localhost:3001/api/tasks | jq '.[0]'

# 3. Ver en logs
grep "channel" /opt/ocaas/logs/combined.log | tail -5
```

### Verificar WebSocket RPC (si aplica)

```bash
# Status del WebSocket
curl localhost:3001/api/system/gateway | jq '.data.websocket'

# Esperado con WS activo:
# { "connected": true, "sessionId": "..." }

# Esperado con WS deshabilitado o fallido:
# { "connected": false }
# Esto es OK si REST funciona - sistema opera en modo DEGRADED
```

### REST-only Mode (sin WebSocket)

Si OpenClaw no soporta WebSocket o no lo necesitas:

```bash
# En .env agregar:
OPENCLAW_WS_MODE=disabled

# Verificar en gateway status:
curl localhost:3001/api/system/gateway | jq '.data'
# Debe mostrar: rest.reachable: true, websocket.connected: false
# Estado: DEGRADED (funcional, sin WS features)
```

**Features que requieren WebSocket:**
- Listar sesiones activas en tiempo real
- Abort de sesiones
- Cron jobs
- Eventos en tiempo real de OpenClaw

**Features que funcionan sin WebSocket:**
- Generación AI (REST /v1/chat/completions)
- Notificaciones via webhooks
- Todas las APIs de OCAAS
- Tasks, agents, skills, tools

## 10. Comandos de Operación

### Scripts npm disponibles

```bash
npm run dev          # Desarrollo con hot-reload
npm run build        # Compilar TypeScript
npm run start        # Producción (requiere build)
npm run bootstrap    # Validación mínima de arranque
npm run doctor       # Diagnóstico completo
npm run smoke-test   # Test de producción
npm run test         # Tests unitarios
npm run typecheck    # Verificar tipos
```

### Flags útiles

```bash
# Bootstrap sin verificar OpenClaw
npm run bootstrap -- --skip-openclaw

# Doctor en formato JSON
npm run doctor -- --json

# Smoke test sin canal
npm run smoke-test -- --skip-channel

# Output silencioso (solo resultado)
npm run doctor -- --silent
```

## 11. Monitoreo Continuo

### Endpoint de health para load balancer

```
GET /health
```

### Endpoint de readiness para Kubernetes

```
GET /api/system/readiness
```

### Métricas para dashboards

```
GET /api/system/metrics
```

### Issues activos

```
GET /api/system/issues
```

## 12. Human Inbox - Gestión de Escalaciones (NEW)

El sistema HITL (Human-in-the-Loop) permite que tareas escalen a humanos cuando necesitan intervención.

### Ver Escalaciones Pendientes

```bash
# Inbox completo (pendientes + acknowledged + resumen)
curl localhost:3001/api/escalations/inbox | jq

# Solo lista de pendientes
curl localhost:3001/api/escalations/pending | jq

# Estadísticas
curl localhost:3001/api/escalations/stats | jq
```

### Respuesta de Inbox

```json
{
  "pending": [
    {
      "id": "esc_abc123",
      "type": "approval_required",
      "priority": "normal",
      "taskId": "task_xyz",
      "reason": "Skill generation requires approval",
      "status": "pending",
      "expiresAt": 1700001000,
      "createdAt": 1700000000
    }
  ],
  "acknowledged": [],
  "summary": {
    "totalPending": 1,
    "totalAcknowledged": 0,
    "byType": { "approval_required": 1 },
    "byPriority": { "normal": 1 },
    "oldestPendingAge": 60000,
    "expiringCount": 0
  }
}
```

### Responder a Escalaciones

```bash
# Aprobar una escalación
curl -X POST localhost:3001/api/escalations/esc_abc123/approve \
  -H "Content-Type: application/json" \
  -d '{"approvedBy": "admin"}'

# Rechazar con razón
curl -X POST localhost:3001/api/escalations/esc_abc123/reject \
  -H "Content-Type: application/json" \
  -d '{"rejectedBy": "admin", "reason": "Not appropriate for current context"}'

# Proveer recurso faltante
curl -X POST localhost:3001/api/escalations/esc_abc123/provide-resource \
  -H "Content-Type: application/json" \
  -d '{
    "providedBy": "admin",
    "resourceId": "skill_new123",
    "resourceType": "skill"
  }'

# Override manual (tomar decisión humana)
curl -X POST localhost:3001/api/escalations/esc_abc123/override \
  -H "Content-Type: application/json" \
  -d '{
    "overriddenBy": "admin",
    "decision": "Skip this step and use alternative approach",
    "details": {"justification": "Time constraint"}
  }'
```

### Acknowledge (marcar como vista)

```bash
curl -X POST localhost:3001/api/escalations/esc_abc123/acknowledge \
  -H "Content-Type: application/json" \
  -d '{"acknowledgedBy": "operator"}'
```

### Ver Escalaciones por Task

```bash
curl localhost:3001/api/escalations/task/task_xyz | jq
```

### Tipos de Escalación

| Tipo | Descripción | Acciones Típicas |
|------|-------------|------------------|
| `approval_required` | Recurso necesita aprobación | approve, reject |
| `resource_missing` | Falta un recurso | provide-resource |
| `execution_failure` | Fallo tras reintentos | override, reject |
| `uncertainty` | Agente tiene dudas | override |
| `blocked` | Tarea bloqueada externamente | override, reject |

### Escalaciones Expiradas

Las escalaciones tienen timeout configurable. Cuando expiran, ejecutan un fallback:

| Fallback | Efecto |
|----------|--------|
| `retry` | Re-encola la task |
| `fail` | Marca task como fallida |
| `escalate_higher` | Crea nueva escalación CRITICAL |
| `auto_approve` | Aprueba automáticamente |
| `pause` | Pausa task para revisión manual |

```bash
# Procesar manualmente las expiradas (normalmente automático)
curl -X POST localhost:3001/api/escalations/process-expired
```

### Monitoreo de Escalaciones

```bash
# Verificar si hay escalaciones críticas
curl -s localhost:3001/api/escalations/inbox | jq '.summary.byPriority.critical // 0'

# Ver escalaciones por expirar pronto (<5 min)
curl -s localhost:3001/api/escalations/inbox | jq '.summary.expiringCount'

# Ver edad de la escalación más antigua
curl -s localhost:3001/api/escalations/inbox | jq '.summary.oldestPendingAge'
```

### Alertas Recomendadas

| Condición | Severidad | Acción |
|-----------|-----------|--------|
| `byPriority.critical > 0` | Alta | Atender inmediatamente |
| `expiringCount > 0` | Media | Responder antes de timeout |
| `oldestPendingAge > 3600000` | Media | Revisar escalaciones viejas (>1h) |
| `totalPending > 10` | Baja | Backlog de escalaciones |

### Integración con Timeline

Las escalaciones aparecen en el timeline de tasks:

```bash
# Ver timeline de task con escalaciones
curl localhost:3001/api/system/tasks/task_xyz/timeline | jq '.entries[] | select(.type=="escalation")'
```

### Cleanup de Escalaciones Antiguas

```bash
# Limpiar escalaciones resueltas/expiradas > 7 días (default)
curl -X POST localhost:3001/api/escalations/cleanup

# Limpiar con edad personalizada (en ms)
curl -X POST "localhost:3001/api/escalations/cleanup?maxAgeMs=86400000"  # 1 día
```

## 13. Smart Decision Engine - Debugging (NEW)

El DecisionEngine mejorado usa heurísticas primero y LLM solo cuando es necesario.

### Cómo Interpretar Decisiones

Cada decisión incluye información sobre cómo se tomó:

```json
{
  "decisionType": "assign",
  "targetAgent": "agent_123",
  "confidenceScore": 0.85,
  "confidenceLevel": "high",
  "method": "heuristic",
  "heuristicsAttempted": true,
  "reasoning": "Agent \"Coding Agent\" has exact capability match for task type \"coding\"",
  "processingTimeMs": 12,
  "fromCache": false
}
```

### Métodos de Decisión

| Método | Descripción | Tiempo Típico |
|--------|-------------|---------------|
| `heuristic` | Regla heurística directa | <50ms |
| `cached` | Decisión cacheada | <5ms |
| `llm_classify` | LLM tier SHORT (~100 tokens) | 1-3s |
| `llm_decide` | LLM tier MEDIUM (~500 tokens) | 2-5s |
| `llm_plan` | LLM tier DEEP (~1500 tokens) | 5-15s |
| `fallback` | Fallback seguro (sin LLM ni heurísticas) | <10ms |

### Cuando Interviene el LLM

El LLM solo se invoca si:
1. Ninguna regla heurística aplicó con confianza suficiente
2. La task es compleja (priority ≥ 4 o input data > 3 fields)
3. No hay decisión cacheada válida

**Tier seleccionado automáticamente:**
- SHORT: Task simple con tipo definido + agentes disponibles
- MEDIUM: Task con descripción larga o tipo genérico
- DEEP: Priority ≥ 4 o mucho input data

### Reglas Heurísticas

Las reglas se evalúan en orden de prioridad (1 = primero):

| Prioridad | Regla | Cuando Aplica |
|-----------|-------|---------------|
| 1 | direct_type_match | Agent capability = task type |
| 2 | single_agent | Solo 1 agente activo |
| 3 | specialist_match | Specialist con caps matching |
| 4 | no_agents | 0 agentes activos → escalate |
| 5 | critical_task | Priority ≥ 4 |
| 6 | subtask_match | Task tiene parentTaskId |
| 7 | retry_limit | retryCount ≥ 3 → escalate |
| 8 | general_capability | Match general de capabilities |

### Debugging Decisiones Incorrectas

#### 1. Ver logs de decisión

```bash
# Logs del orquestador
grep -i "decision" /opt/ocaas/logs/orchestrator.log | tail -20

# Buscar decisiones de una task específica (reemplazar task_xyz con ID real)
TASK_ID="task_xyz"
grep "$TASK_ID" /opt/ocaas/logs/orchestrator.log | grep -i "decision"
```

#### 2. Verificar métricas

```bash
# Ver métricas de decisiones (requiere endpoint API)
# Agregar a tu código si necesitas exponer:
# console.log(getSmartDecisionEngine().getMetrics())
```

#### 3. Verificar por qué se usó LLM

```json
{
  "method": "llm_decide",
  "heuristicsAttempted": true,
  "heuristicFailReason": "escalated_to_llm"
}
```

Esto significa que las heurísticas se intentaron pero ninguna aplicó o la confianza fue insuficiente.

#### 4. Verificar cache

```bash
# Ver stats de cache
# Agregar endpoint o log:
# console.log(getSmartDecisionEngine().getCacheStats())
```

### Forzar Comportamiento

Para testing/debugging, puedes configurar el engine:

```typescript
const engine = getSmartDecisionEngine({
  enableCache: false,        // Deshabilitar cache
  enableHeuristics: false,   // Forzar LLM
  enableLLM: false,          // Solo heurísticas
  forceDeepAnalysis: true,   // Forzar tier DEEP
});
```

### Casos Comunes de Decisiones Inesperadas

| Problema | Causa Probable | Solución |
|----------|----------------|----------|
| Siempre usa LLM | Agentes no tienen capabilities matching | Agregar capabilities a agentes |
| Task asignada a agente incorrecto | Matching por tipo muy genérico | Usar tipos de task más específicos |
| Siempre escala a humano | Sin agentes activos o priority alta | Activar más agentes |
| Cache devuelve decisión vieja | TTL muy largo | Invalidar cache manualmente |

### Invalidar Cache Manualmente

```bash
# Desde código:
# engine.clearCache();
# engine.invalidateCache(task, agents);

# O reiniciar el backend (cache es in-memory)
```

### Monitorear Uso de LLM

El objetivo es minimizar llamadas LLM innecesarias. Monitorear:

```typescript
const metrics = engine.getMetrics();
const llmRate = (metrics.llmDecisions.short + metrics.llmDecisions.medium + metrics.llmDecisions.deep) / metrics.totalDecisions;
// Target: < 30% de decisiones usan LLM
```

### Integración DecisionEngine + SmartDecisionEngine

El `DecisionEngine` ahora usa `SmartDecisionEngine` internamente. El flujo es:

```
TaskRouter.processTask(task)
    └── DecisionEngine.makeIntelligentDecision(task)
            └── SmartDecisionEngine.decide(task, agents)
                    ├── Cache check
                    ├── Heuristics (8 rules)
                    ├── LLM (if needed)
                    └── Fallback
```

#### Ver Métricas de Decisiones

```typescript
// Desde DecisionEngine
const engine = getDecisionEngine();
const metrics = engine.getDecisionMetrics();
console.log('Total decisions:', metrics.totalDecisions);
console.log('Heuristic rate:', metrics.heuristicDecisions / metrics.totalDecisions);
console.log('Cache hit rate:', engine.getDecisionCacheStats().hitRate);
```

#### Escalaciones Automáticas a HITL

Cuando `requiresEscalation = true`, el sistema crea automáticamente una escalación:

```bash
# Ver escalaciones pendientes
curl localhost:3001/api/escalations | jq '.data.pending'

# Verificar por qué se escaló
# Buscar en logs:
grep "Decision escalated to human" /opt/ocaas/logs/orchestrator.log | tail -5
```

**Escalación se crea cuando:**
- `decisionType === 'escalate'`
- `confidenceScore < 0.4`
- No hay agentes activos

**Prioridad de escalación:**
- `critical`: task.priority >= 4
- `high`: task.priority >= 3 OR confidenceScore < 0.3
- `normal`: default

#### Control de Configuración

```typescript
// Actualizar config sin reiniciar
const engine = getDecisionEngine();
engine.updateDecisionConfig({
  enableCache: true,          // Cache on/off
  enableHeuristics: true,     // Heuristics on/off
  enableLLM: false,           // LLM on/off (útil para testing)
  forceDeepAnalysis: false,   // Forzar tier DEEP
});

// Limpiar cache
engine.clearDecisionCache();
```

### Logs de Decisiones Enriquecidos

Cada decisión ahora loguea información completa:

```json
{
  "taskId": "task_123",
  "decisionId": "uuid-...",
  "decisionType": "assign",
  "method": "heuristic",
  "llmTier": null,
  "confidenceScore": 0.85,
  "confidenceLevel": "high",
  "fromCache": false,
  "processingTimeMs": 23,
  "targetAgent": "agent_456",
  "requiresEscalation": false
}
```

**Filtrar logs por método:**
```bash
grep '"method":"heuristic"' /opt/ocaas/logs/orchestrator.log | wc -l  # Decisiones heurísticas
grep '"method":"llm_'       /opt/ocaas/logs/orchestrator.log | wc -l  # Decisiones LLM
grep '"method":"cached"'    /opt/ocaas/logs/orchestrator.log | wc -l  # Cache hits
grep '"method":"fallback"'  /opt/ocaas/logs/orchestrator.log | wc -l  # Fallbacks (revisar!)
```

## 14. Cost Optimization - Modos de Operación (NEW)

El SmartDecisionEngine soporta modos de operación que permiten controlar el balance coste/calidad en runtime.

### Modos Disponibles

| Modo | Uso de LLM | Cache | Casos de Uso |
|------|------------|-------|--------------|
| `economy` | Minimizado (solo SHORT) | Agresivo (2x TTL) | Desarrollo, testing, alto volumen |
| `balanced` | Moderado (hasta MEDIUM) | Normal | Producción estándar |
| `max_quality` | Completo (hasta DEEP) | Corto (0.5x TTL) | Tareas críticas, auditorías |

### Cambiar Modo en Runtime

```bash
# Via API (cuando se exponga)
# curl -X POST localhost:3001/api/system/operation-mode \
#   -H "Content-Type: application/json" \
#   -d '{"mode": "economy"}'

# Via código (runtime)
import { getDecisionEngine } from './orchestrator/DecisionEngine.js';
import { OPERATION_MODE } from './orchestrator/decision/types.js';

const engine = getDecisionEngine();
engine.setOperationMode(OPERATION_MODE.ECONOMY);
```

### Verificar Modo Actual

```bash
# Via extended metrics
curl localhost:3001/api/system/diagnostics | jq '.data.metrics.decision.operationMode'
```

### Métricas de Costes

```typescript
const engine = getDecisionEngine();
const metrics = engine.getExtendedMetrics();

console.log('Operation Mode:', metrics.operationMode);
console.log('Total Cost:', metrics.cost.estimatedCostUSD);
console.log('Cost Saved:', metrics.cost.costSavedUSD);
console.log('LLM Avoidance Rate:', metrics.cost.llmAvoidanceRate * 100, '%');
console.log('Cache Hit Rate:', metrics.cache.hitRate * 100, '%');
```

### Cost Summary para Logging

```typescript
const summary = engine.getCostSummary();
// {
//   mode: 'economy',
//   totalCost: '$0.0045',
//   totalSaved: '$0.0120',
//   llmAvoidanceRate: '75.0%',
//   cacheHitRate: '45.0%',
//   llmCalls: 3,
//   decisions: { heuristic: 12, cached: 8, llm: 3 }
// }
```

### Guía de Selección de Modo

| Escenario | Modo Recomendado | Justificación |
|-----------|------------------|---------------|
| Desarrollo/testing | `economy` | Minimizar costes, respuestas rápidas |
| Producción normal | `balanced` | Balance óptimo |
| Demo a cliente | `max_quality` | Máxima calidad de decisiones |
| Alta carga (>100 tasks/min) | `economy` | Reducir latencia y coste |
| Tarea crítica (priority 4) | `max_quality` | Decisión completa con DEEP tier |
| Troubleshooting | `balanced` | Visibilidad sin sobrecarga |

### Impacto en Decisiones

**Economy Mode:**
- Acepta heurísticas con confianza ≥ 0.5 (vs 0.7 en balanced)
- Solo usa LLM tier SHORT (max ~150 input tokens)
- Prompts compactos (~128 tokens vs ~500)
- Cache TTL duplicado (10 min vs 5 min)
- Salta LLM en retry, match exacto, y tipos conocidos

**Balanced Mode (default):**
- Heurísticas requieren confianza ≥ 0.7
- Usa LLM hasta tier MEDIUM
- Prompts estándar
- Cache TTL normal (5 min)
- Salta LLM en retry y match exacto

**Max Quality Mode:**
- Heurísticas requieren confianza ≥ 0.85
- Usa LLM hasta tier DEEP (análisis completo)
- Prompts detallados
- Cache TTL reducido (2.5 min)
- No salta LLM (siempre considera LLM)

### Monitorear Costes

```bash
# Logs con info de costes
grep "costInfo" /opt/ocaas/logs/orchestrator.log | tail -10

# Ver breakdown por tier
grep "LLM usage recorded" /opt/ocaas/logs/orchestrator.log | tail -20

# Ver ahorros
grep "Tokens saved" /opt/ocaas/logs/orchestrator.log | tail -20
```

### Eventos de Decisión con Cost Info

Las decisiones emiten eventos con información de costes:

```json
{
  "type": "decision.task_completed",
  "data": {
    "operationMode": "economy",
    "llmTier": "short",
    "costInfo": {
      "inputTokens": 150,
      "outputTokens": 100,
      "estimatedCostUSD": 0.00195
    },
    "costSummary": {
      "totalCost": "$0.0045",
      "totalSaved": "$0.0120",
      "llmAvoidanceRate": "75.0%"
    }
  }
}
```

### Reset de Métricas de Coste

```typescript
// Limpiar métricas (útil al inicio de un período de medición)
engine.resetCostTracking();
```

### Alertas Recomendadas de Coste

| Métrica | Umbral Warning | Umbral Critical |
|---------|----------------|-----------------|
| `llmAvoidanceRate` | < 50% | < 30% |
| `cacheHitRate` | < 20% | < 10% |
| `estimatedCostUSD` (por hora) | > $1.00 | > $5.00 |
| `llmDecisions.deep` (por hora) | > 100 | > 500 |

---

## Quick Reference

```bash
# Setup inicial
cd /opt/ocaas && npm install && mkdir -p logs data
# Configurar .env (ver sección 3)

# Arranque
openclaw start              # Primero
npm run doctor              # Verificar
npm run start               # Iniciar

# Validación
npm run smoke-test

# Troubleshooting
npm run doctor -- --json    # Detalles completos
tail -f /opt/ocaas/logs/combined.log
```

## 15. Permisos del sistema y sudo seguro

El sistema OCAAS debe ejecutarse bajo un usuario no root, con permisos controlados.

Puede ejecutarse:
- bajo un usuario dedicado (ocaas), recomendado para producción
- o bajo el usuario actual del sistema (ubuntu, admin, etc.)

### Verificar usuario actual

```bash
whoami
# Ejemplo: ubuntu, ocaas, admin
# NUNCA debe ser: root
```

### Permisos de directorios

Crear estructura:

```bash
sudo mkdir -p /opt/ocaas
sudo mkdir -p /opt/ocaas/logs
sudo mkdir -p /opt/ocaas/data
sudo mkdir -p /opt/ocaas/backups
sudo mkdir -p /var/log/ocaas
```

Asignar permisos (ejemplo con usuario ubuntu):

```bash
# Reemplazar 'ubuntu' con tu usuario real (resultado de whoami)
sudo chown -R ubuntu:ubuntu /opt/ocaas
sudo chown -R ubuntu:ubuntu /var/log/ocaas
chmod -R 755 /opt/ocaas
chmod -R 755 /var/log/ocaas
```

### Configuración sudo segura

Editar:

```bash
sudo visudo
```

Añadir solo lo necesario (reemplazar 'ubuntu' con tu usuario real):

```text
# Permitir solo systemctl para gestión del servicio
ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl start ocaas
ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop ocaas
ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ocaas
ubuntu ALL=(ALL) NOPASSWD: /usr/bin/systemctl status ocaas
```

**⚠️ QUÉ NO HACER en sudoers:**
- `ALL=(ALL) NOPASSWD: ALL` - NUNCA usar esto
- `NOPASSWD: /bin/bash` - permite shell como root
- `NOPASSWD: /usr/bin/env` - permite ejecutar cualquier cosa
- Cualquier comando que acepte argumentos arbitrarios

## 16. Usuario de servicio y estructura del sistema

Estructura de producción:

```text
/opt/ocaas/
├── dist/           # Código compilado
├── node_modules/   # Dependencias
├── logs/           # Logs de aplicación
├── data/           # Base de datos SQLite
├── backups/        # Backups de DB
├── .env            # Configuración
└── package.json

/var/log/ocaas/     # Logs de systemd (alternativo)
```

Verificar ownership correcto:

```bash
# Reemplazar 'ubuntu' con tu usuario real
ls -la /opt/ocaas/
# Debe mostrar: ubuntu ubuntu (o tu usuario)
```

## 17. Servicio systemd

Crear archivo de servicio:

```bash
sudo nano /etc/systemd/system/ocaas.service
```

Contenido (reemplazar 'ubuntu' con tu usuario real):

```ini
[Unit]
Description=OCAAS Backend
After=network.target

[Service]
# IMPORTANTE: Reemplazar 'ubuntu' con el usuario que ejecutará el servicio
User=ubuntu
WorkingDirectory=/opt/ocaas
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/ocaas/.env
StandardOutput=append:/var/log/ocaas/combined.log
StandardError=append:/var/log/ocaas/error.log

[Install]
WantedBy=multi-user.target
```

Activar el servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ocaas
sudo systemctl start ocaas
sudo systemctl status ocaas
```

## 18. Automatización segura

Dar permisos de ejecución a scripts:

```bash
chmod +x /opt/ocaas/scripts/*.sh
```

Usar siempre rutas absolutas:

```bash
/opt/ocaas/scripts/deploy_production.sh
```

**No permitir:**
- Ejecución de scripts externos sin revisión
- Comandos dinámicos via sudo
- Scripts que acepten argumentos de usuarios no confiables

## 19. Hardening básico de producción

### Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 3001/tcp  # OCAAS API
sudo ufw enable
sudo ufw status
```

### Rotación de logs

Crear archivo de configuración:

```bash
sudo nano /etc/logrotate.d/ocaas
```

Contenido:

```text
/var/log/ocaas/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 644 ubuntu ubuntu
}
```

### Backup automático de DB

Editar crontab:

```bash
crontab -e
```

Añadir línea (backup diario a las 2:00 AM):

```cron
0 2 * * * cp /opt/ocaas/data/ocaas.db /opt/ocaas/backups/ocaas_$(date +\%F).db
```

### Seguridad del archivo .env

```bash
chmod 600 /opt/ocaas/.env
```

## 20. Validación final antes de producción

Ejecutar estos comandos para verificar que todo está correctamente configurado:

```bash
# 1. Verificar puerto libre
lsof -ti:3001
# Si devuelve un PID, el puerto está ocupado. Detener proceso: kill $(lsof -ti:3001)

# 2. Verificar .env existe y tiene las variables críticas
cat /opt/ocaas/.env | grep -E "^(OPENCLAW_GATEWAY_URL|API_SECRET_KEY)="
# Debe mostrar ambas variables con valores

# 3. Verificar OpenClaw está corriendo
curl -s http://localhost:18789/health
# Esperado: {"status":"ok"} o similar

# 4. Iniciar OCAAS si no está corriendo
cd /opt/ocaas && npm run start &

# 5. Verificar backend responde
sleep 3 && curl -s http://localhost:3001/health
# Esperado: {"status":"ok"}

# 6. Verificar diagnósticos completos
curl -s http://localhost:3001/api/system/diagnostics | jq '.data.status'
# Esperado: "healthy" o "degraded"

# 7. Ejecutar smoke test
cd /opt/ocaas && npm run smoke-test
# Esperado: STATUS: PASS
```

### Checklist final

| Verificación | Comando | Resultado esperado |
|--------------|---------|-------------------|
| Puerto 3001 libre | `lsof -ti:3001` | Vacío o PID de OCAAS |
| .env configurado | `cat /opt/ocaas/.env \| wc -l` | >5 líneas |
| OpenClaw activo | `curl localhost:18789/health` | `{"status":"ok"}` |
| Backend activo | `curl localhost:3001/health` | `{"status":"ok"}` |
| Permisos correctos | `ls -la /opt/ocaas/.env` | `-rw-------` (600) |
| Logs escribibles | `touch /opt/ocaas/logs/test && rm /opt/ocaas/logs/test` | Sin error |

## 21. Tool Validation (NEW)

El sistema de validación de tools permite verificar configuraciones antes de crear o actualizar herramientas.

### Endpoints de Validación

```bash
# Validar tool antes de crear
curl -X POST localhost:3001/api/tools/validate \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-api-tool",
    "path": "/tools/my-api",
    "type": "api",
    "config": {
      "method": "POST",
      "url": "https://api.example.com/endpoint"
    }
  }'

# Validar tool existente por ID
curl -X POST localhost:3001/api/tools/tool_abc123/validate

# Validar solo config (sin crear tool)
curl -X POST localhost:3001/api/tools/validate-config \
  -H "Content-Type: application/json" \
  -d '{
    "type": "script",
    "config": {
      "runtime": "node",
      "entrypoint": "index.js"
    }
  }'
```

### Respuesta de Validación

```json
{
  "data": {
    "valid": true,
    "score": 85,
    "issues": [
      {
        "field": "description",
        "message": "Tool has no description",
        "severity": "warning"
      }
    ],
    "suggestions": [
      "Add a description to improve discoverability",
      "Consider adding version for tracking"
    ]
  }
}
```

### Tipos de Tool y Campos de Config

| Tipo | Campos Principales | Uso |
|------|-------------------|-----|
| `script` | entrypoint, runtime, envVars, timeoutMs | Scripts Node.js, Python, Bash |
| `binary` | binaryPath, argsTemplate, shell | Ejecutables externos |
| `api` | method, url, headers, auth, bodyTemplate | Llamadas HTTP |

### Script Tool Config

```json
{
  "entrypoint": "main.js",
  "runtime": "node",
  "argsTemplate": "--input {{input}} --format json",
  "workingDirectory": "/opt/tools/my-tool",
  "envVars": { "NODE_ENV": "production" },
  "timeoutMs": 30000,
  "captureStderr": true
}
```

### Binary Tool Config

```json
{
  "binaryPath": "/usr/bin/ffmpeg",
  "argsTemplate": "-i {{input}} -o {{output}}",
  "shell": false,
  "timeoutMs": 60000
}
```

### API Tool Config

```json
{
  "method": "POST",
  "url": "https://api.example.com/process",
  "headers": { "Content-Type": "application/json" },
  "bodyTemplate": "{\"data\": \"{{input}}\"}",
  "auth": {
    "type": "bearer",
    "value": "{{env.API_TOKEN}}"
  },
  "timeoutMs": 10000,
  "followRedirects": true,
  "responseType": "json"
}
```

### Validaciones Realizadas

| Categoría | Severidad | Checks |
|-----------|-----------|--------|
| **Requeridos** | error | name no vacío, path no vacío |
| **Config válida** | error | Campos conocidos para el tipo, valores válidos |
| **Schemas** | warning | inputSchema/outputSchema son JSON Schema válidos |
| **Recomendaciones** | info | description, version, runtime (scripts), url (API) |

### Integración con Frontend

El Tool Editor en el frontend incluye:
- Formularios específicos por tipo de tool
- Validación en tiempo real al cambiar campos
- Visualización de issues y sugerencias
- Botón de validación antes de guardar

### Troubleshooting Tools

```bash
# Ver todos los tools con estado
curl localhost:3001/api/tools | jq '.tools[] | {name, type, status}'

# Validar un tool específico
TOOL_ID="tool_abc123"
curl -X POST "localhost:3001/api/tools/$TOOL_ID/validate" | jq

# Ver config de un tool
curl "localhost:3001/api/tools/$TOOL_ID" | jq '.data.config'
```

## 22. Skill-Tool Composition (NEW)

Las skills pueden componerse de múltiples tools para crear capacidades complejas.

### Endpoints de Composición

```bash
# Obtener tools de una skill
curl localhost:3001/api/skills/skill_123/tools

# Obtener tools con detalles expandidos
curl localhost:3001/api/skills/skill_123/tools?expand=tool

# Agregar un tool a una skill
curl -X POST localhost:3001/api/skills/skill_123/tools \
  -H "Content-Type: application/json" \
  -d '{
    "toolId": "tool_456",
    "orderIndex": 0,
    "required": true,
    "role": "primary"
  }'

# Reemplazar todos los tools de una skill
curl -X PUT localhost:3001/api/skills/skill_123/tools \
  -H "Content-Type: application/json" \
  -d '{
    "tools": [
      {"toolId": "tool_1", "orderIndex": 0, "required": true},
      {"toolId": "tool_2", "orderIndex": 1, "role": "fallback"}
    ]
  }'

# Actualizar link de un tool
curl -X PATCH localhost:3001/api/skills/skill_123/tools/tool_456 \
  -H "Content-Type: application/json" \
  -d '{"orderIndex": 5, "required": false}'

# Eliminar un tool de una skill
curl -X DELETE localhost:3001/api/skills/skill_123/tools/tool_456
```

### Estructura del Link

```json
{
  "toolId": "tool_456",
  "orderIndex": 0,
  "required": true,
  "role": "primary",
  "config": { "timeout": 30000 },
  "createdAt": 1700000000
}
```

| Campo | Descripción |
|-------|-------------|
| `toolId` | ID del tool (requerido) |
| `orderIndex` | Orden de ejecución (0-based) |
| `required` | Si el tool es obligatorio (default: true) |
| `role` | Rol del tool: primary, fallback, preprocessing, etc. |
| `config` | Config override específico para este skill |

### Listar Skills con Tool Count

```bash
# Lista de skills con cantidad de tools
curl localhost:3001/api/skills?expand=toolCount | jq '.data[] | {name, toolCount}'
```

### Troubleshooting Skills

```bash
# Ver todas las skills con estado y tools
curl localhost:3001/api/skills?expand=toolCount | jq '.data[] | {name, status, toolCount}'

# Ver tools de una skill específica
SKILL_ID="skill_123"
curl "localhost:3001/api/skills/$SKILL_ID/tools?expand=tool" | jq

# Warning: skills activas sin tools
curl localhost:3001/api/skills?expand=toolCount | jq '.data[] | select(.status=="active" and .toolCount==0)'
```

## 23. Skill Execution

Ejecutar skills como pipelines de tools directamente, sin pasar por agentes.

### API Endpoints

```bash
# Preview de ejecución (ver pipeline, blockers, warnings)
curl localhost:3001/api/skills/skill_123/execution-preview | jq

# Validar ejecución sin ejecutar
curl -X POST localhost:3001/api/skills/skill_123/validate-execution \
  -H "Content-Type: application/json" \
  -d '{"input": {"userId": "123"}}'

# Dry run (simula sin efectos)
curl -X POST localhost:3001/api/skills/skill_123/execute \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "dry_run",
    "input": {"query": "test"}
  }'

# Ejecutar realmente
curl -X POST localhost:3001/api/skills/skill_123/execute \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "run",
    "input": {"query": "process this"},
    "context": {"env": "production"},
    "timeoutMs": 60000,
    "stopOnError": true,
    "caller": {"type": "user", "id": "admin", "name": "Admin User"}
  }'
```

### Modos de Ejecución

| Modo | Comportamiento |
|------|----------------|
| `run` | Ejecuta tools realmente |
| `validate` | Valida inputs y disponibilidad de tools |
| `dry_run` | Simula ejecución sin side effects |

### Estructura de Respuesta

```json
{
  "data": {
    "executionId": "abc123",
    "skillId": "skill_123",
    "skillName": "Data Processing",
    "mode": "run",
    "status": "success",
    "toolResults": [
      {
        "toolId": "tool_1",
        "toolName": "Fetch Data",
        "status": "success",
        "output": {"records": 100},
        "durationMs": 1200,
        "required": true,
        "orderIndex": 0
      },
      {
        "toolId": "tool_2",
        "toolName": "Transform",
        "status": "success",
        "output": {"transformed": true},
        "durationMs": 500,
        "required": true,
        "orderIndex": 1
      }
    ],
    "output": {"records": 100, "transformed": true},
    "toolsExecuted": 2,
    "toolsSucceeded": 2,
    "toolsFailed": 0,
    "toolsSkipped": 0,
    "totalDurationMs": 1700,
    "startedAt": 1700000000000,
    "completedAt": 1700000001700
  }
}
```

### Troubleshooting Ejecución

```bash
# Ver si una skill puede ejecutarse
SKILL_ID="skill_123"
curl "localhost:3001/api/skills/$SKILL_ID/execution-preview" | jq '{canExecute, blockers, warnings}'

# Ver pipeline ordenado
curl "localhost:3001/api/skills/$SKILL_ID/execution-preview" | jq '.data.pipeline[] | {order: .orderIndex, name: .toolName, required}'

# Validar antes de ejecutar
curl -X POST "localhost:3001/api/skills/$SKILL_ID/validate-execution" \
  -H "Content-Type: application/json" \
  -d '{"input": {}}' | jq '{valid, errors, warnings}'
```

### Comportamiento de Errores

| Escenario | Resultado |
|-----------|-----------|
| Tool requerido falla | Pipeline falla, tools restantes skipped |
| Tool opcional falla | Continúa con siguiente tool |
| Timeout excedido | Pipeline falla con error de timeout |
| stopOnError: false | Continúa incluso si required tools fallan |

### Frontend

En la página de Skills, cada skill activa con tools tiene un botón verde de "Execute":
1. Click en Execute abre panel de ejecución
2. Ver Preview del pipeline
3. Escribir input JSON
4. Validate → Dry Run → Execute
5. Ver resultados expandibles por tool

## 24. Notas finales de operación

- Ejecutar siempre como usuario no root
- Mantener permisos mínimos necesarios
- Revisar logs regularmente: `tail -f /opt/ocaas/logs/combined.log`
- Monitorizar escalaciones humanas: `curl localhost:3001/api/escalations/inbox`
- Validar estado del sistema: `npm run doctor`

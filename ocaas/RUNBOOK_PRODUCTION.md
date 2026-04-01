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
# Clonar repositorio
git clone <repo-url> ocaas
cd ocaas

# Instalar dependencias
npm install
```

### Paso 2: Crear directorios

```bash
cd backend

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

Crear archivo `backend/.env`:

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
cd backend

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

### Smoke test automático:

```bash
npm run smoke-test

# Esperado: STATUS: PASS
```

## 6. Troubleshooting

### Error: "OPENCLAW_GATEWAY_URL not configured"

```bash
# Verificar .env existe
cat backend/.env | grep OPENCLAW

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
ls -la backend/data/

# Crear si no existe
mkdir -p backend/data

# Verificar archivo DB
ls -la backend/data/ocaas.db

# Si DB corrupta, backup y recrear:
mv backend/data/ocaas.db backend/data/ocaas.db.bak
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
rm backend/data/ocaas.db
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
ls -la backend/

# Dar permisos
chmod 755 backend/logs backend/data
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
rm -f backend/data/*.tmp

# Re-ejecutar validación
npm run doctor

# Reiniciar
npm run start
```

### Recuperar de DB corrupta

```bash
# Backup
cp backend/data/ocaas.db backend/data/ocaas.db.backup

# Recrear
rm backend/data/ocaas.db
npm run db:push

# NOTA: Se pierden datos. Para producción real,
# implementar backups regulares.
```

### Reset completo

```bash
# Solo si necesario - ELIMINA TODOS LOS DATOS
rm -rf backend/data/ocaas.db
rm -rf backend/logs/*

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
grep "recovery" backend/logs/combined.log | tail -20

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
grep "task_id" backend/logs/orchestrator.log | tail -50
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
grep "connection" backend/logs/integration.log | tail -20

# 3. Verificar circuit breakers
curl localhost:3001/api/system/diagnostics | jq '.data.checks[] | select(.category=="resilience")'
```

### Doble Ejecución Prevenida

El sistema previene que una task se ejecute dos veces simultáneamente mediante leases.

**Si sospechas doble ejecución:**
```bash
# 1. Buscar warnings en logs
grep "already has active lease" backend/logs/orchestrator.log

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
grep "Invalid state transition" backend/logs/combined.log | tail -10

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

## 8. Logs Importantes

### Ubicación de logs

```
backend/logs/
├── combined.log      # Todos los logs
├── system.log        # Logs de sistema
├── orchestrator.log  # Logs del orquestador
├── integration.log   # Logs de OpenClaw/integraciones
└── audit.log         # Logs de auditoría/seguridad
```

### Ver logs en tiempo real

```bash
# Todos los logs
tail -f backend/logs/combined.log

# Solo errores
grep -i error backend/logs/combined.log | tail -20

# Logs de OpenClaw
tail -f backend/logs/integration.log

# Logs de tareas
grep -i task backend/logs/orchestrator.log | tail -20
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
grep "channel" backend/logs/combined.log | tail -5
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

---

## Quick Reference

```bash
# Setup inicial
npm install && cd backend && mkdir -p logs data
# Configurar .env (ver sección 3)

# Arranque
openclaw start              # Primero
npm run doctor              # Verificar
npm run start               # Iniciar

# Validación
npm run smoke-test

# Troubleshooting
npm run doctor -- --json    # Detalles completos
tail -f backend/logs/combined.log
```

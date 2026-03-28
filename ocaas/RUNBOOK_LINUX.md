# OCAAS - Runbook Linux/macOS

Guía operativa para despliegue y ejecución en Linux/macOS.

## Prerequisitos

| Componente | Versión Mínima | Verificar |
|------------|----------------|-----------|
| Node.js | 20.x LTS | `node --version` |
| npm | 10.x | `npm --version` |
| Git | 2.x | `git --version` |
| build-essential | - | `gcc --version` (para better-sqlite3) |
| Python | 3.x | `python3 --version` (para node-gyp) |

### Instalar prerequisitos (Ubuntu/Debian)

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build tools para módulos nativos
sudo apt-get install -y build-essential python3
```

### Instalar prerequisitos (macOS)

```bash
# Xcode Command Line Tools
xcode-select --install

# Node.js via Homebrew
brew install node@20
```

---

## 1. Clonar y Configurar

```bash
# Clonar repositorio
git clone <repo-url> ocaas
cd ocaas

# Copiar configuración de entorno
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Editar backend/.env con tus valores
nano backend/.env
```

### Variables de entorno críticas (backend/.env)

```env
# OBLIGATORIAS
PORT=3001
DATABASE_URL=./data/ocaas.db
OPENCLAW_GATEWAY_URL=http://localhost:3000

# RECOMENDADAS
API_SECRET_KEY=<generar-clave-segura-32-chars>
AUTONOMY_LEVEL=supervised

# OPCIONALES (Telegram)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 2. Instalar Dependencias

```bash
# Backend (desde raíz del proyecto)
cd backend
npm install

# Frontend (desde raíz del proyecto)
cd ../frontend
npm install
```

**Nota:** `better-sqlite3` compila código nativo. Si falla, verificar build-essential/Xcode.

---

## 3. Inicializar Base de Datos

```bash
cd backend

# Generar migraciones desde schema
npm run db:generate

# Aplicar migraciones a SQLite
npm run db:push
```

Verificar que se creó `backend/data/ocaas.db`.

---

## 4. Orden de Arranque

**IMPORTANTE:** El Gateway debe estar corriendo ANTES de iniciar OCAAS.

### Terminal 1: OpenClaw Gateway

```bash
cd <directorio-gateway>
npm run dev
# Debe estar en http://localhost:3000
```

### Terminal 2: Backend OCAAS

```bash
cd ocaas/backend
npm run dev
# Inicia en http://localhost:3001
```

### Terminal 3: Frontend OCAAS

```bash
cd ocaas/frontend
npm run dev
# Inicia en http://localhost:5173
```

---

## 5. Healthcheck

### Verificar Backend

```bash
curl http://localhost:3001/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "timestamp": "...",
  "gateway": {
    "connected": true,  // <-- CRÍTICO
    "url": "http://localhost:3000"
  },
  "database": "connected",
  "orchestrator": {
    "running": true,
    "queueSize": 0
  }
}
```

**Si `gateway.connected: false`:** El Gateway no está corriendo o la URL es incorrecta.

### Verificar Frontend

Abrir http://localhost:5173 en navegador.

### Verificar Gateway

```bash
curl http://localhost:3000/status
```

---

## 6. Tests Críticos de Validación

### Test 1: Conexión a Gateway

```bash
curl http://localhost:3001/health | grep '"connected":true'
```
- **PASA:** Retorna `"connected":true`
- **FALLA:** Retorna `"connected":false` o error

### Test 2: Ciclo Completo de Tarea

```bash
# Crear tarea
TASK_ID=$(curl -s -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test E2E","type":"test","priority":2}' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

echo "Task ID: $TASK_ID"

# Esperar 5 segundos y verificar estado
sleep 5
curl http://localhost:3001/api/tasks/$TASK_ID
```
- **PASA:** `status` es `completed` o `in_progress`
- **FALLA:** `status` es `pending` después de 30s, o error

### Test 3: Loop Autónomo Básico

```bash
# Cambiar a modo autonomous
curl -X PUT http://localhost:3001/api/system/autonomy \
  -H "Content-Type: application/json" \
  -d '{"level":"autonomous"}'

# Crear tarea que requiere capacidad inexistente
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Loop","type":"blockchain-analysis","priority":2}'

# Verificar que se creó una generation
sleep 10
curl http://localhost:3001/api/generations
```
- **PASA:** Aparece generation con `type: "agent"` o `"skill"`
- **FALLA:** No hay generations

### Test 4: Approval Flow

```bash
# Cambiar a modo supervised
curl -X PUT http://localhost:3001/api/system/autonomy \
  -H "Content-Type: application/json" \
  -d '{"level":"supervised"}'

# Crear tarea de alta prioridad
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Approval","type":"test","priority":4}'

# Verificar approval pendiente
curl http://localhost:3001/api/approvals
```
- **PASA:** Aparece approval con `status: "pending"`
- **FALLA:** No hay approvals

---

## 7. Diagnóstico Rápido

### Errores más probables

| Error | Causa | Solución |
|-------|-------|----------|
| `SQLITE_ERROR: no such table` | DB no inicializada | `npm run db:push` |
| `ECONNREFUSED localhost:3000` | Gateway no corriendo | Iniciar Gateway primero |
| `Cannot find module 'better-sqlite3'` | Compilación fallida | `npm rebuild better-sqlite3` |
| `gateway.connected: false` | URL incorrecta | Verificar `OPENCLAW_GATEWAY_URL` |
| `EADDRINUSE` | Puerto ocupado | `lsof -i :3001` y matar proceso |

### Dónde mirar logs

```bash
# Backend logs (stdout)
# Los logs de pino van a stdout en formato JSON

# Para logs legibles:
cd backend
npm run dev 2>&1 | npx pino-pretty

# Logs de eventos en DB
sqlite3 data/ocaas.db "SELECT * FROM events ORDER BY created_at DESC LIMIT 10;"
```

### Endpoints de diagnóstico

| Endpoint | Propósito |
|----------|-----------|
| `GET /health` | Estado general del sistema |
| `GET /api/system/stats` | Métricas detalladas |
| `GET /api/system/autonomy` | Configuración de autonomía |
| `GET /api/events?limit=20` | Últimos eventos |
| `GET /api/tasks?status=failed` | Tareas fallidas |

### Distinguir origen de fallo

1. **Backend no responde:** `curl localhost:3001/health` falla → Backend caído
2. **Gateway no responde:** Backend OK pero `gateway.connected: false` → Gateway caído
3. **DB corrupta:** Error `SQLITE_ERROR` en logs → Recrear DB
4. **Frontend no carga:** Backend OK, UI blanca → Ver consola del navegador

---

## 8. Comandos Útiles

```bash
# Reiniciar DB desde cero
rm backend/data/ocaas.db
cd backend && npm run db:push

# Ver cola de tareas
curl http://localhost:3001/api/system/stats | jq '.orchestrator'

# Aprobar todas las pendientes
curl http://localhost:3001/api/approvals | jq -r '.[] | select(.status=="pending") | .id' | \
  xargs -I {} curl -X POST http://localhost:3001/api/approvals/{}/approve

# Cancelar tarea
curl -X POST http://localhost:3001/api/tasks/<id>/cancel

# Ver agentes activos
curl http://localhost:3001/api/agents?status=active
```

---

## 9. Producción

### Build

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

### Ejecutar en producción

```bash
# Backend
cd backend
NODE_ENV=production node dist/index.js

# Frontend (servir archivos estáticos)
npx serve frontend/dist -p 5173
```

### Systemd (Linux)

```ini
# /etc/systemd/system/ocaas-backend.service
[Unit]
Description=OCAAS Backend
After=network.target

[Service]
Type=simple
User=ocaas
WorkingDirectory=/opt/ocaas/backend
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## Checklist de Despliegue

- [ ] Node.js 20+ instalado
- [ ] build-essential/Xcode instalado
- [ ] Repositorio clonado
- [ ] `.env` configurado en backend y frontend
- [ ] `npm install` exitoso en backend y frontend
- [ ] `npm run db:push` ejecutado
- [ ] Gateway corriendo en puerto 3000
- [ ] Backend corriendo en puerto 3001
- [ ] `curl /health` muestra `gateway.connected: true`
- [ ] Frontend accesible en puerto 5173
- [ ] Test E2E básico pasado

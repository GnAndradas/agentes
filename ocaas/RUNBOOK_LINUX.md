# OCAAS - Runbook Linux/macOS

> Guía operativa para despliegue y ejecución. Actualizado: 2026-03-30

---

## Prerequisitos

| Componente | Versión Mínima | Verificar |
|------------|----------------|-----------|
| Node.js | 20.x LTS | `node --version` |
| npm | 10.x | `npm --version` |
| Git | 2.x | `git --version` |
| build-essential | - | `gcc --version` (para better-sqlite3) |
| Python | 3.x | `python3 --version` (para node-gyp) |
| OpenClaw | - | `openclaw --version` |

### Instalar prerequisitos (Ubuntu/Debian)

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Build tools para módulos nativos
sudo apt-get install -y build-essential python3

# OpenClaw CLI (ver docs.openclaw.ai para instalación)
```

### Instalar prerequisitos (macOS)

```bash
# Xcode Command Line Tools
xcode-select --install

# Node.js via Homebrew
brew install node@20

# OpenClaw CLI (ver docs.openclaw.ai para instalación)
```

### Instalar prerequisitos (Windows con Git Bash)

```bash
# Node.js: Descargar de nodejs.org
# Python: Descargar de python.org (necesario para node-gyp)
# Visual Studio Build Tools: npm install -g windows-build-tools

# OpenClaw CLI (ver docs.openclaw.ai para instalación)
```

---

## 1. Clonar y Configurar

```bash
# Clonar repositorio
git clone <repo-url> ocaas
cd ocaas

# Copiar configuración de entorno
cp backend/.env.example backend/.env

# Editar backend/.env con tus valores
nano backend/.env  # o code backend/.env en Windows
```

### Variables de entorno (backend/.env)

```env
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=./data/ocaas.db

# OpenClaw Gateway
# APIs usadas:
#   - /v1/chat/completions (sync) - Generación IA
#   - /hooks/agent (async) - Notificaciones
# Docs: https://docs.openclaw.ai
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace

# API Key - obtener con: openclaw config get gateway.token
OPENCLAW_API_KEY=tu-token-aqui

# Security (mínimo 16 caracteres)
API_SECRET_KEY=cambiar-en-produccion-min-32-chars

# CORS
CORS_ORIGIN=http://localhost:5173

# Logging
LOG_LEVEL=info

# Telegram Notifications (opcional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Autonomy
AUTONOMY_LEVEL=supervised
AUTONOMY_HUMAN_TIMEOUT=300000
AUTONOMY_FALLBACK=pause
```

### Obtener API Key de OpenClaw

```bash
# El Gateway genera un token automáticamente
openclaw config get gateway.token

# Copiar el resultado a OPENCLAW_API_KEY en .env
```

---

## 2. Instalar Dependencias

```bash
# Desde la raíz del proyecto
cd backend
npm install

cd ../frontend
npm install
```

**Nota:** `better-sqlite3` compila código nativo. Si falla:
- Linux: Verificar `build-essential`
- macOS: Verificar Xcode Command Line Tools
- Windows: Verificar Visual Studio Build Tools

### Errores comunes de instalación

| Error | Solución |
|-------|----------|
| `gyp ERR! find Python` | Instalar Python 3 |
| `node-pre-gyp ERR!` | `npm rebuild better-sqlite3` |
| `EACCES permission denied` | No usar sudo. Usar nvm |

---

## 3. Inicializar Base de Datos

```bash
cd backend

# Sincronizar schema con DB (desarrollo)
npm run db:push
```

### Verificar

```bash
# Debe existir el archivo
ls -la backend/data/ocaas.db

# Verificar tablas (Linux/macOS)
sqlite3 backend/data/ocaas.db ".tables"
# Debe mostrar: agents approvals events feedback generations ...
```

### Reiniciar DB desde cero

```bash
rm -f backend/data/ocaas.db
cd backend && npm run db:push
```

---

## 4. Orden de Arranque

**IMPORTANTE:** El Gateway debe estar corriendo ANTES de iniciar OCAAS.

### Terminal 1: OpenClaw Gateway

```bash
# Iniciar OpenClaw Gateway (puerto 18789 por defecto)
openclaw gateway start

# Verificar que está corriendo
curl http://localhost:18789/v1/models
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

### Verificar Gateway

```bash
# Listar modelos disponibles (health check)
curl http://localhost:18789/v1/models
```

### Verificar Backend

```bash
curl http://localhost:3001/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "gateway": {
    "connected": true
  },
  "database": "connected",
  "orchestrator": {
    "running": true
  }
}
```

**Si `gateway.connected: false`:**
- Gateway no está corriendo
- URL incorrecta en `OPENCLAW_GATEWAY_URL`
- API Key inválida

### Verificar Frontend

Abrir http://localhost:5173 en navegador.

---

## 6. APIs de OpenClaw usadas por OCAAS

> Verificado de docs.openclaw.ai y código fuente

### API REST (Síncrona)

| Método | Endpoint | Uso en OCAAS |
|--------|----------|--------------|
| `GET` | `/v1/models` | Health check |
| `POST` | `/v1/chat/completions` | Generación IA (agentes, skills, tools) |

### Webhook API (Asíncrona)

| Método | Endpoint | Uso en OCAAS |
|--------|----------|--------------|
| `POST` | `/hooks/agent` | Notificaciones (fire-and-forget) |
| `POST` | `/hooks/wake` | Despertar agentes |

**Nota:** Los webhooks devuelven `200` inmediatamente. Los resultados van al canal configurado, NO se devuelven en la respuesta HTTP.

---

## 7. Diagnóstico Rápido

### Errores más probables

| Error | Causa | Solución |
|-------|-------|----------|
| `SQLITE_ERROR: no such table` | DB no inicializada | `npm run db:push` |
| `ECONNREFUSED localhost:18789` | Gateway no corriendo | Iniciar Gateway primero |
| `gateway.connected: false` | URL incorrecta o sin API key | Verificar `.env` |
| `EADDRINUSE` | Puerto ocupado | Matar proceso en ese puerto |
| `401 Unauthorized` | API key inválida | `openclaw config get gateway.token` |

### Logs

```bash
# Backend logs legibles
cd backend
npm run dev 2>&1 | npx pino-pretty

# Eventos en DB
sqlite3 data/ocaas.db "SELECT * FROM events ORDER BY created_at DESC LIMIT 10;"
```

### Endpoints de diagnóstico

| Endpoint | Propósito |
|----------|-----------|
| `GET /health` | Estado general |
| `GET /api/system/stats` | Métricas |
| `GET /api/system/autonomy` | Config autonomía |
| `GET /api/system/events` | Últimos eventos |
| `GET /api/tasks?status=failed` | Tareas fallidas |

---

## 8. Comandos Útiles

```bash
# Ver cola de tareas
curl http://localhost:3001/api/system/stats | jq '.orchestrator'

# Ver agentes activos
curl http://localhost:3001/api/agents?status=active

# Crear tarea de prueba
curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","type":"test","priority":2}'

# Cancelar tarea
curl -X POST http://localhost:3001/api/tasks/<id>/cancel
```

---

## 9. Producción

### Build

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

### Ejecutar

```bash
# Backend
cd backend
NODE_ENV=production node dist/index.js

# Frontend (servir estáticos)
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
- [ ] build-essential/Xcode/VS Build Tools instalado
- [ ] OpenClaw CLI instalado
- [ ] Repositorio clonado
- [ ] `backend/.env` configurado
- [ ] `OPENCLAW_API_KEY` obtenida y configurada
- [ ] `npm install` exitoso en backend y frontend
- [ ] `npm run db:push` ejecutado
- [ ] Gateway corriendo en puerto **18789**
- [ ] Backend corriendo en puerto 3001
- [ ] `curl /health` muestra `gateway.connected: true`
- [ ] Frontend accesible en puerto 5173

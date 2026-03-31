# OCAAS - Runbook de Instalación y Operación

> Guía completa para instalar, configurar y ejecutar OCAAS en Linux y macOS.

## Requisitos Previos

### Sistema Operativo
- **Linux**: Ubuntu 20.04+, Debian 11+, RHEL 8+, o cualquier distro con soporte para Node.js
- **macOS**: 12 (Monterey) o superior
- **Windows**: WSL2 recomendado (native Windows requiere ajustes adicionales)

### Software Requerido

| Software | Versión Mínima | Verificar |
|----------|----------------|-----------|
| Node.js | 20.0.0 | `node --version` |
| npm | 10.0.0 | `npm --version` |
| Git | 2.30+ | `git --version` |
| Python | 3.8+ (para better-sqlite3) | `python3 --version` |
| Build tools | Ver abajo | - |

### Build Tools (para compilar better-sqlite3)

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

#### Linux (RHEL/CentOS/Fedora)
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

#### macOS
```bash
xcode-select --install
```

---

## Instalación Rápida

### 1. Clonar el repositorio
```bash
git clone <repository-url> ocaas
cd ocaas
```

### 2. Instalar dependencias
```bash
npm install
```

> **Nota**: Esto instalará dependencias de ambos workspaces (backend y frontend) y compilará `better-sqlite3` para tu plataforma.

### 3. Configurar variables de entorno
```bash
cp backend/.env.example backend/.env
```

Editar `backend/.env` con tus valores:
```bash
# Editor preferido
nano backend/.env
# o
vim backend/.env
```

### 4. Inicializar base de datos
```bash
npm run db:push
```

### 5. Ejecutar en desarrollo
```bash
npm run dev
```

Esto iniciará:
- Backend en `http://localhost:3001`
- Frontend en `http://localhost:5173`

---

## Configuración Detallada

### Variables de Entorno (`backend/.env`)

```env
# ===== SERVER =====
PORT=3001
HOST=0.0.0.0
NODE_ENV=development  # development | production | test

# ===== DATABASE =====
DATABASE_URL=./data/ocaas.db

# ===== OPENCLAW GATEWAY =====
# URL del gateway OpenClaw (puerto 18789 por defecto)
OPENCLAW_GATEWAY_URL=http://localhost:18789

# Path al workspace de OpenClaw
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace

# Token de API - obtener con: openclaw config get gateway.token
OPENCLAW_API_KEY=your-openclaw-api-token

# Token para webhooks (opcional, usa API_KEY si no está definido)
OPENCLAW_HOOKS_TOKEN=

# Habilitar probe de generación en diagnósticos (hace llamada real a LLM)
OPENCLAW_ENABLE_GENERATION_PROBE=false

# ===== SECURITY =====
# IMPORTANTE: Cambiar en producción (mínimo 16 caracteres)
API_SECRET_KEY=change-this-in-production-min-32-chars

# ===== CORS =====
CORS_ORIGIN=http://localhost:5173

# ===== LOGGING =====
LOG_LEVEL=info  # trace | debug | info | warn | error | fatal

# ===== TELEGRAM (Opcional) =====
# Crear bot via @BotFather
TELEGRAM_BOT_TOKEN=

# Obtener via /getUpdates después de enviar mensaje al bot
TELEGRAM_CHAT_ID=

# IDs de usuarios permitidos para aprobar (separados por coma)
# Obtener tu ID via @userinfobot en Telegram
# IMPORTANTE: Si está vacío, NADIE puede aprobar via Telegram
TELEGRAM_ALLOWED_USER_IDS=

# Secret para validación de webhook
# Generar con: openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET=

# ===== AUTONOMY =====
AUTONOMY_LEVEL=supervised  # manual | supervised | autonomous
AUTONOMY_HUMAN_TIMEOUT=300000  # 5 minutos en ms
AUTONOMY_FALLBACK=pause  # pause | reject | auto_approve
```

---

## Comandos Disponibles

### Desarrollo

```bash
# Iniciar todo en desarrollo (backend + frontend con hot-reload)
npm run dev

# Solo backend
npm run dev:backend

# Solo frontend
npm run dev:frontend
```

### Producción

```bash
# Compilar todo
npm run build

# Iniciar backend en producción
npm run start
```

### Base de Datos

```bash
# Generar migraciones desde schema
npm run db:generate

# Aplicar schema a la base de datos
npm run db:push

# Abrir Drizzle Studio (GUI para la DB)
npm run db:studio -w backend
```

### Testing

```bash
# Ejecutar tests del backend
npm test -w backend

# Tests en modo watch
npm run test:watch -w backend

# Type checking
npm run typecheck -w backend
```

### Limpieza

```bash
# Limpiar builds y base de datos
npm run clean
```

---

## Despliegue en Producción

### 1. Preparar el servidor

```bash
# Instalar Node.js 20 (usando nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Instalar build tools
sudo apt-get install -y build-essential python3
```

### 2. Clonar y configurar

```bash
git clone <repository-url> /opt/ocaas
cd /opt/ocaas

# Instalar dependencias
npm ci --production=false  # Necesitamos devDeps para build

# Configurar
cp backend/.env.example backend/.env
nano backend/.env  # Configurar para producción
```

### 3. Compilar

```bash
npm run build
```

### 4. Inicializar base de datos

```bash
npm run db:push
```

### 5. Configurar como servicio (systemd)

Crear `/etc/systemd/system/ocaas.service`:
```ini
[Unit]
Description=OCAAS Backend
After=network.target

[Service]
Type=simple
User=ocaas
WorkingDirectory=/opt/ocaas
ExecStart=/usr/bin/node backend/dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# Crear usuario
sudo useradd -r -s /bin/false ocaas
sudo chown -R ocaas:ocaas /opt/ocaas

# Habilitar e iniciar
sudo systemctl daemon-reload
sudo systemctl enable ocaas
sudo systemctl start ocaas

# Ver logs
sudo journalctl -u ocaas -f
```

### 6. Servir Frontend (nginx)

Crear `/etc/nginx/sites-available/ocaas`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend estático
    location / {
        root /opt/ocaas/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /socket.io {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ocaas /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Integración con OpenClaw

### Verificar que OpenClaw está corriendo

```bash
# Verificar gateway
curl http://localhost:18789/v1/models

# Obtener token de API
openclaw config get gateway.token
```

### Configurar webhook de Telegram (opcional)

Si usas Telegram para aprobaciones:

```bash
# Generar secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo "TELEGRAM_WEBHOOK_SECRET=${WEBHOOK_SECRET}"

# Registrar webhook con Telegram (reemplazar valores)
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/webhooks/telegram",
    "secret_token": "<WEBHOOK_SECRET>"
  }'
```

---

## Troubleshooting

### Error: better-sqlite3 no compila

```bash
# Limpiar y reinstalar
rm -rf node_modules
npm cache clean --force
npm install
```

En macOS con Apple Silicon:
```bash
# Asegurar que Xcode CLI tools están instalados
xcode-select --install

# Reinstalar
npm rebuild better-sqlite3
```

### Error: EACCES al instalar globalmente

```bash
# Configurar npm para no requerir sudo
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Backend no conecta a OpenClaw

1. Verificar que OpenClaw está corriendo: `curl http://localhost:18789/v1/models`
2. Verificar `OPENCLAW_API_KEY` en `.env`
3. Ver logs del backend: `npm run dev:backend`

### Frontend muestra "Backend Off"

1. Verificar que backend está corriendo en puerto 3001
2. Verificar `CORS_ORIGIN` en `.env` incluye la URL del frontend
3. Abrir DevTools → Network para ver errores

### Base de datos corrupta

```bash
# Backup y recrear
mv backend/data/ocaas.db backend/data/ocaas.db.bak
npm run db:push
```

---

## Health Checks

### Verificar estado del sistema

```bash
# Backend health
curl http://localhost:3001/api/system/health

# Gateway status (requiere backend corriendo)
curl http://localhost:3001/api/system/gateway

# Diagnóstico completo
curl http://localhost:3001/api/system/gateway/diagnostic
```

### Monitoreo

- **Logs**: `journalctl -u ocaas -f` (producción) o consola (desarrollo)
- **WebSocket events**: Conectar a `/socket.io` y suscribirse a canal `events`
- **StatusBar**: El frontend muestra estado en tiempo real

---

## Estructura del Proyecto

```
ocaas/
├── backend/
│   ├── src/
│   │   ├── api/          # Endpoints REST
│   │   ├── config/       # Configuración y autonomía
│   │   ├── db/           # Schema y conexión SQLite
│   │   ├── generator/    # Generadores AI (agent, skill, tool)
│   │   ├── notifications/# Canales de notificación (Telegram)
│   │   ├── openclaw/     # Cliente gateway OpenClaw
│   │   ├── orchestrator/ # Motor de orquestación
│   │   ├── services/     # Lógica de negocio
│   │   └── utils/        # Helpers y errores
│   ├── tests/            # Tests unitarios
│   ├── data/             # Base de datos SQLite
│   └── .env              # Variables de entorno
├── frontend/
│   ├── src/
│   │   ├── components/   # Componentes React
│   │   ├── pages/        # Páginas/rutas
│   │   ├── lib/          # API client
│   │   └── stores/       # Estado global (Zustand)
│   └── dist/             # Build de producción
├── package.json          # Monorepo root
└── RUNBOOK.md           # Este archivo
```

---

## Soporte

- **Issues**: Reportar en el repositorio de GitHub
- **Logs**: Siempre incluir logs relevantes al reportar problemas
- **Versiones**: Incluir output de `node --version` y `npm --version`

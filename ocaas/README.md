# OCAAS - OpenClaw Agent Administration System

Sistema de administración de agentes con integración nativa de OpenClaw.

## Requisitos

- Node.js >= 18.0.0
- npm >= 9.0.0
- Linux o macOS (no soporta Windows)
- OpenClaw Gateway (opcional, para funcionalidad completa)

## Instalación Rápida

```bash
# Clonar y entrar al directorio
cd ocaas

# Ejecutar script de instalación
chmod +x scripts/*.sh
./scripts/install.sh
```

El script de instalación:
- Valida el sistema operativo (Linux/macOS)
- Verifica Node.js >= 18 y npm
- Instala todas las dependencias
- Crea el archivo `.env` si no existe
- Verifica conexión con OpenClaw Gateway
- Prepara la base de datos SQLite

## Scripts de Gestión

### `./scripts/install.sh`
Instalación completa del sistema.

```bash
./scripts/install.sh
```

**Qué hace:**
- Valida entorno Linux/macOS
- Comprueba Node.js >= 18 y npm >= 9
- Instala dependencias del monorepo
- Crea `backend/.env` desde template
- Valida `OPENCLAW_GATEWAY_URL`
- Verifica conexión con OpenClaw Gateway
- Ejecuta migraciones de base de datos
- Crea estructura de carpetas necesarias

### `./scripts/dev.sh`
Modo desarrollo con hot-reload.

```bash
./scripts/dev.sh
```

**Qué hace:**
- Verifica dependencias y configuración
- Comprueba conexión con OpenClaw Gateway
- Inicia backend (puerto 3001) con `tsx watch`
- Inicia frontend (puerto 5173) con Vite
- Muestra logs de ambos servicios en tiempo real

**URLs:**
- Backend: http://localhost:3001
- Frontend: http://localhost:5173
- API: http://localhost:3001/api

### `./scripts/start.sh`
Modo producción.

```bash
./scripts/start.sh
```

**Qué hace:**
- Compila backend y frontend
- Inicia backend en modo producción
- Sirve frontend compilado con `vite preview`
- Guarda PIDs para gestión de procesos
- Logs en `logs/backend.log` y `logs/frontend.log`

**URLs:**
- Backend: http://localhost:3001
- Frontend: http://localhost:4173

### `./scripts/healthcheck.sh`
Diagnóstico completo del sistema.

```bash
./scripts/healthcheck.sh
```

**Verifica:**
- Estructura del proyecto (archivos esenciales)
- Backend (proceso, API health, estadísticas)
- Frontend (proceso, respuesta HTTP)
- OpenClaw Gateway (conectividad, workspace)
- Configuración (variables de entorno, versiones)

**Salida:**
- ✓ Verde: OK
- ⚠ Amarillo: Advertencia
- ✗ Rojo: Error

## Instalación Manual

```bash
# Instalar dependencias
npm install

# Crear archivo de configuración
cp backend/.env.example backend/.env
# Editar backend/.env con tu configuración

# Generar y aplicar esquema
npm run db:generate
npm run db:push

# Desarrollo
npm run dev

# Producción
npm run build
npm run start
```

## Estructura

```
ocaas/
├── backend/               # API Node.js + Fastify
│   ├── src/
│   │   ├── api/           # Rutas y handlers REST
│   │   ├── config/        # Configuración y constantes
│   │   ├── db/            # Schema Drizzle + SQLite
│   │   ├── generator/     # Generador AI de agentes/skills/tools
│   │   ├── openclaw/      # Adaptador OpenClaw Gateway
│   │   ├── orchestrator/  # Orquestación de tareas y agentes
│   │   ├── services/      # Capa de servicios
│   │   ├── types/         # Tipos TypeScript
│   │   ├── utils/         # Logger, errores, helpers
│   │   └── websocket/     # WebSocket + EventBridge
│   ├── tests/             # Tests con Vitest
│   └── data/              # Base de datos SQLite
├── frontend/              # React + Vite + TailwindCSS
│   └── src/
│       ├── components/    # Componentes UI (layout, ui)
│       ├── lib/           # API client + Socket
│       ├── pages/         # Páginas de la aplicación
│       ├── stores/        # Estado global (Zustand)
│       └── types/         # Tipos frontend
├── scripts/               # Scripts de gestión
│   ├── install.sh         # Instalación
│   ├── dev.sh             # Desarrollo
│   ├── start.sh           # Producción
│   └── healthcheck.sh     # Diagnóstico
├── logs/                  # Logs de ejecución
└── package.json           # Monorepo workspace
```

## Variables de Entorno

Crear `backend/.env`:

```env
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=./data/ocaas.db

# OpenClaw Gateway (all LLM requests go through here)
OPENCLAW_GATEWAY_URL=http://localhost:3000
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace
OPENCLAW_API_KEY=

# Security
API_SECRET_KEY=your-secret-key-min-16-chars

# Logging
LOG_LEVEL=info
```

## API Endpoints

### Agents
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/agents` | Listar agentes |
| GET | `/api/agents/:id` | Obtener agente |
| POST | `/api/agents` | Crear agente |
| PATCH | `/api/agents/:id` | Actualizar agente |
| DELETE | `/api/agents/:id` | Eliminar agente |
| POST | `/api/agents/:id/activate` | Activar agente |
| POST | `/api/agents/:id/deactivate` | Desactivar agente |

### Tasks
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/tasks` | Listar tareas |
| GET | `/api/tasks/:id` | Obtener tarea |
| POST | `/api/tasks` | Crear tarea |
| POST | `/api/tasks/:id/cancel` | Cancelar tarea |
| POST | `/api/tasks/:id/retry` | Reintentar tarea |

### Skills
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/skills` | Listar skills |
| POST | `/api/skills` | Crear skill |
| POST | `/api/skills/sync` | Sincronizar workspace |

### Tools
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/tools` | Listar tools |
| POST | `/api/tools` | Crear tool |

### Generations
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/generations` | Listar generaciones |
| POST | `/api/generations` | Crear generación |
| POST | `/api/generations/:id/approve` | Aprobar |
| POST | `/api/generations/:id/reject` | Rechazar |
| POST | `/api/generations/:id/activate` | Activar |

### System
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/system/health` | Health check |
| GET | `/api/system/stats` | Estadísticas |

## WebSocket

Conexión: `ws://localhost:3001/socket.io`

**Canales disponibles:**
- `agents` - Eventos de agentes (creación, activación, etc.)
- `tasks` - Eventos de tareas (asignación, completado, etc.)
- `generations` - Eventos de generación AI
- `system` - Eventos del sistema

**Eventos:**
```javascript
// Suscribirse a un canal
socket.emit('subscribe', ['agents', 'tasks']);

// Recibir eventos
socket.on('event', (event) => {
  console.log(event.type, event.payload);
});
```

## Ciclo de Generación

```
draft → generated → pending_approval → approved → active
                          ↓
                      rejected

                          ↓ (en caso de error)
                        failed
```

| Estado | Descripción |
|--------|-------------|
| draft | Creación inicial del request |
| generated | Contenido generado por AI |
| pending_approval | Esperando validación humana |
| approved | Aprobado, listo para activar |
| active | Activado y funcional |
| rejected | Rechazado por el usuario |
| failed | Error en el proceso de generación |

## Integración con OpenClaw

OCAAS se integra con OpenClaw Gateway para:

- **Spawning de agentes**: Crear sesiones de agentes
- **Ejecución de tools**: Ejecutar comandos y scripts
- **Sincronización de workspace**: Leer/escribir skills y tools
- **Gestión de sesiones**: Control de agentes activos

Si OpenClaw Gateway no está disponible, OCAAS funciona en **modo offline** con funcionalidad limitada.

## Docker

```bash
# Iniciar con Docker Compose
docker-compose up -d

# Ver logs
docker-compose logs -f

# Detener
docker-compose down
```

## Testing

```bash
# Ejecutar tests
npm run test -w backend

# Tests en modo watch
npm run test:watch -w backend

# Type checking
npm run typecheck -w backend
```

## Licencia

MIT

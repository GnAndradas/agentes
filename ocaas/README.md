# OCAAS - OpenClaw Agent Administration System

Sistema de orquestación multi-agente con integración OpenClaw.

## Requisitos

- Node.js >= 20.0.0
- npm >= 10.0.0
- Build tools (gcc, python3) para better-sqlite3
- OpenClaw Gateway (opcional)

## Instalación

```bash
# Instalar dependencias
npm install

# Configurar
cp backend/.env.example backend/.env
# Editar backend/.env

# Inicializar DB
npm run db:push

# Desarrollo
npm run dev
```

## URLs

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- API: http://localhost:3001/api

## Comandos

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Desarrollo (backend + frontend) |
| `npm run build` | Compilar para producción |
| `npm run start` | Iniciar backend producción |
| `npm test -w backend` | Ejecutar tests |

## Documentación

- [RUNBOOK.md](./RUNBOOK.md) - Guía completa de instalación y operación
- [OCAAS_MEMORY.md](./OCAAS_MEMORY.md) - Documentación técnica del sistema

## Licencia

MIT

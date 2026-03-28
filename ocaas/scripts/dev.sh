#!/bin/bash
#
# OCAAS Development Script
# Arranca backend y frontend en modo desarrollo con logs visibles
#
set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Directorio del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Puertos
BACKEND_PORT=3001
FRONTEND_PORT=5173

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            OCAAS - Development Mode                       ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$PROJECT_ROOT"

# ============================================
# Verificaciones previas
# ============================================
echo -e "${BLUE}Verificando entorno...${NC}"

# Verificar node_modules
if [ ! -d "node_modules" ]; then
  echo -e "${RED}❌ Dependencias no instaladas.${NC}"
  echo -e "   Ejecuta: ${CYAN}./scripts/install.sh${NC}"
  exit 1
fi
echo -e "${GREEN}✓ node_modules${NC}"

# Verificar .env
if [ ! -f "backend/.env" ]; then
  echo -e "${YELLOW}⚠️  backend/.env no existe, creando desde template...${NC}"
  if [ -f "backend/.env.example" ]; then
    cp backend/.env.example backend/.env
    echo -e "${GREEN}✓ backend/.env creado${NC}"
  else
    echo -e "${RED}❌ No se encontró backend/.env.example${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓ backend/.env${NC}"

# Cargar variables de entorno para mostrar puertos correctos
set -a
source backend/.env 2>/dev/null || true
set +a

BACKEND_PORT="${PORT:-3001}"
OPENCLAW_URL="${OPENCLAW_GATEWAY_URL:-http://localhost:3000}"

# Verificar/crear base de datos
if [ ! -f "backend/data/ocaas.db" ]; then
  echo -e "${YELLOW}Base de datos no encontrada, ejecutando migraciones...${NC}"
  mkdir -p backend/data
  npm run db:push 2>/dev/null || npm run db:generate && npm run db:push
fi
echo -e "${GREEN}✓ Base de datos${NC}"

# ============================================
# Verificar OpenClaw Gateway
# ============================================
echo ""
echo -e "${BLUE}Verificando OpenClaw Gateway...${NC}"

OPENCLAW_STATUS="offline"
if command -v curl &> /dev/null; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "${OPENCLAW_URL}/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    OPENCLAW_STATUS="online"
    echo -e "${GREEN}✓ OpenClaw Gateway: $OPENCLAW_URL (conectado)${NC}"
  else
    echo -e "${YELLOW}⚠️  OpenClaw Gateway no accesible en $OPENCLAW_URL${NC}"
    echo -e "   El sistema funcionará en modo offline."
  fi
else
  echo -e "${YELLOW}⚠️  curl no disponible para verificar OpenClaw${NC}"
fi

# ============================================
# Información de puertos
# ============================================
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "  ${MAGENTA}Backend${NC}  → ${BLUE}http://localhost:$BACKEND_PORT${NC}"
echo -e "  ${MAGENTA}Frontend${NC} → ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
echo -e "  ${MAGENTA}API${NC}      → ${BLUE}http://localhost:$BACKEND_PORT/api${NC}"
echo -e "  ${MAGENTA}OpenClaw${NC} → ${BLUE}$OPENCLAW_URL${NC} ${YELLOW}($OPENCLAW_STATUS)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Iniciando servidores en modo desarrollo...${NC}"
echo -e "${YELLOW}Presiona Ctrl+C para detener${NC}"
echo ""

# ============================================
# Ejecutar en modo desarrollo (concurrently)
# ============================================

# Usar el comando dev del package.json que usa concurrently
exec npm run dev

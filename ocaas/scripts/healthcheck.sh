#!/bin/bash
#
# OCAAS Health Check Script
# Verifica el estado de todos los componentes del sistema
#
set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directorio del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuración por defecto
BACKEND_PORT=3001
FRONTEND_PORT_DEV=5173
FRONTEND_PORT_PROD=4173
OPENCLAW_DEFAULT_URL="http://localhost:18789"

# Contadores de estado
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              OCAAS - Health Check                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

cd "$PROJECT_ROOT"

# ============================================
# Funciones auxiliares
# ============================================

check_pass() {
  echo -e "${GREEN}✓ $1${NC}"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

check_fail() {
  echo -e "${RED}✗ $1${NC}"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

check_warn() {
  echo -e "${YELLOW}⚠ $1${NC}"
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
}

check_http() {
  local url=$1
  local timeout=${2:-5}

  if ! command -v curl &> /dev/null; then
    echo "000"
    return
  fi

  curl -s -o /dev/null -w "%{http_code}" --connect-timeout $timeout "$url" 2>/dev/null || echo "000"
}

check_process() {
  local port=$1
  if command -v lsof &> /dev/null; then
    lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  elif command -v netstat &> /dev/null; then
    netstat -tuln 2>/dev/null | grep -q ":$port "
    return $?
  else
    return 1
  fi
}

# ============================================
# Cargar configuración
# ============================================
if [ -f "backend/.env" ]; then
  set -a
  source backend/.env 2>/dev/null || true
  set +a
fi

BACKEND_PORT="${PORT:-3001}"
OPENCLAW_URL="${OPENCLAW_GATEWAY_URL:-$OPENCLAW_DEFAULT_URL}"

# ============================================
# 1. VERIFICAR ESTRUCTURA DEL PROYECTO
# ============================================
echo -e "${BLUE}[1/5] Estructura del proyecto${NC}"
echo "─────────────────────────────────────────"

# Archivos esenciales
if [ -f "package.json" ]; then
  check_pass "package.json (root)"
else
  check_fail "package.json (root) - no encontrado"
fi

if [ -f "backend/package.json" ]; then
  check_pass "backend/package.json"
else
  check_fail "backend/package.json - no encontrado"
fi

if [ -f "frontend/package.json" ]; then
  check_pass "frontend/package.json"
else
  check_fail "frontend/package.json - no encontrado"
fi

if [ -f "backend/.env" ]; then
  check_pass "backend/.env"
else
  check_fail "backend/.env - no encontrado (ejecuta ./scripts/install.sh)"
fi

# Dependencias
if [ -d "node_modules" ]; then
  check_pass "node_modules (dependencias instaladas)"
else
  check_fail "node_modules - no encontrado (ejecuta npm install)"
fi

# Base de datos
if [ -f "backend/data/ocaas.db" ]; then
  DB_SIZE=$(du -h "backend/data/ocaas.db" 2>/dev/null | cut -f1)
  check_pass "Base de datos SQLite ($DB_SIZE)"
else
  check_warn "Base de datos no existe (se creará al iniciar)"
fi

echo ""

# ============================================
# 2. VERIFICAR BACKEND
# ============================================
echo -e "${BLUE}[2/5] Backend API${NC}"
echo "─────────────────────────────────────────"

# Verificar si el proceso está corriendo
if check_process $BACKEND_PORT; then
  check_pass "Proceso escuchando en puerto $BACKEND_PORT"

  # Verificar endpoint de salud
  HEALTH_URL="http://localhost:$BACKEND_PORT/api/system/health"
  HTTP_CODE=$(check_http "$HEALTH_URL")

  if [ "$HTTP_CODE" = "200" ]; then
    check_pass "API /system/health respondiendo (HTTP $HTTP_CODE)"

    # Obtener estadísticas si está disponible
    STATS_URL="http://localhost:$BACKEND_PORT/api/system/stats"
    STATS_CODE=$(check_http "$STATS_URL")
    if [ "$STATS_CODE" = "200" ]; then
      STATS=$(curl -s "$STATS_URL" 2>/dev/null)
      AGENTS=$(echo "$STATS" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)
      check_pass "API /system/stats respondiendo (Agentes: ${AGENTS:-0})"
    fi
  else
    check_fail "API no responde correctamente (HTTP $HTTP_CODE)"
  fi
else
  check_warn "Backend no está corriendo en puerto $BACKEND_PORT"
fi

# Verificar compilación
if [ -d "backend/dist" ]; then
  check_pass "Backend compilado (dist/)"
else
  check_warn "Backend no compilado (ejecuta npm run build -w backend)"
fi

echo ""

# ============================================
# 3. VERIFICAR FRONTEND
# ============================================
echo -e "${BLUE}[3/5] Frontend${NC}"
echo "─────────────────────────────────────────"

FRONTEND_RUNNING=false

# Verificar modo desarrollo (puerto 5173)
if check_process $FRONTEND_PORT_DEV; then
  check_pass "Frontend (dev) corriendo en puerto $FRONTEND_PORT_DEV"
  FRONTEND_RUNNING=true

  HTTP_CODE=$(check_http "http://localhost:$FRONTEND_PORT_DEV")
  if [ "$HTTP_CODE" = "200" ]; then
    check_pass "Frontend (dev) respondiendo (HTTP $HTTP_CODE)"
  fi
fi

# Verificar modo producción (puerto 4173)
if check_process $FRONTEND_PORT_PROD; then
  check_pass "Frontend (prod) corriendo en puerto $FRONTEND_PORT_PROD"
  FRONTEND_RUNNING=true

  HTTP_CODE=$(check_http "http://localhost:$FRONTEND_PORT_PROD")
  if [ "$HTTP_CODE" = "200" ]; then
    check_pass "Frontend (prod) respondiendo (HTTP $HTTP_CODE)"
  fi
fi

if [ "$FRONTEND_RUNNING" = false ]; then
  check_warn "Frontend no está corriendo"
fi

# Verificar build
if [ -d "frontend/dist" ]; then
  check_pass "Frontend compilado (dist/)"
else
  check_warn "Frontend no compilado (ejecuta npm run build -w frontend)"
fi

echo ""

# ============================================
# 4. VERIFICAR OPENCLAW GATEWAY
# ============================================
echo -e "${BLUE}[4/5] OpenClaw Gateway${NC}"
echo "─────────────────────────────────────────"

echo -e "   URL configurada: ${CYAN}$OPENCLAW_URL${NC}"

# Verificar conectividad
OPENCLAW_HEALTH="${OPENCLAW_URL}/health"
HTTP_CODE=$(check_http "$OPENCLAW_HEALTH" 3)

if [ "$HTTP_CODE" = "200" ]; then
  check_pass "OpenClaw Gateway accesible (HTTP $HTTP_CODE)"

  # Verificar endpoints adicionales
  SESSIONS_CODE=$(check_http "${OPENCLAW_URL}/sessions" 3)
  if [ "$SESSIONS_CODE" = "200" ] || [ "$SESSIONS_CODE" = "401" ]; then
    check_pass "Endpoint /sessions disponible"
  fi
elif [ "$HTTP_CODE" = "000" ]; then
  check_warn "OpenClaw Gateway no accesible (conexión rechazada)"
  echo -e "   ${YELLOW}→ Inicia OpenClaw Gateway para habilitar todas las funciones${NC}"
else
  check_warn "OpenClaw Gateway responde con HTTP $HTTP_CODE"
fi

# Verificar workspace
WORKSPACE_PATH="${OPENCLAW_WORKSPACE_PATH:-$HOME/.openclaw/workspace}"
WORKSPACE_PATH="${WORKSPACE_PATH/#\~/$HOME}"

if [ -d "$WORKSPACE_PATH" ]; then
  SKILLS_COUNT=$(ls -1 "$WORKSPACE_PATH/skills" 2>/dev/null | wc -l | tr -d ' ')
  TOOLS_COUNT=$(ls -1 "$WORKSPACE_PATH/tools" 2>/dev/null | wc -l | tr -d ' ')
  check_pass "Workspace: $WORKSPACE_PATH (Skills: $SKILLS_COUNT, Tools: $TOOLS_COUNT)"
else
  check_warn "Workspace no existe: $WORKSPACE_PATH"
fi

echo ""

# ============================================
# 5. VERIFICAR CONFIGURACIÓN
# ============================================
echo -e "${BLUE}[5/5] Configuración${NC}"
echo "─────────────────────────────────────────"

# Variables de entorno críticas
if [ -n "$OPENCLAW_API_KEY" ] && [ "$OPENCLAW_API_KEY" != "" ]; then
  API_KEY_PREVIEW="${OPENCLAW_API_KEY:0:10}..."
  check_pass "OPENCLAW_API_KEY configurada ($API_KEY_PREVIEW)"
else
  check_warn "OPENCLAW_API_KEY no configurada (opcional si gateway no requiere auth)"
fi

if [ -n "$API_SECRET_KEY" ] && [ ${#API_SECRET_KEY} -ge 16 ]; then
  check_pass "API_SECRET_KEY configurada (${#API_SECRET_KEY} caracteres)"
else
  check_warn "API_SECRET_KEY débil o no configurada"
fi

# Node.js
NODE_VERSION=$(node -v 2>/dev/null || echo "no instalado")
if [[ "$NODE_VERSION" =~ ^v[0-9]+ ]]; then
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    check_pass "Node.js $NODE_VERSION"
  else
    check_warn "Node.js $NODE_VERSION (recomendado v18+)"
  fi
else
  check_fail "Node.js no instalado"
fi

# npm
NPM_VERSION=$(npm -v 2>/dev/null || echo "no instalado")
if [ "$NPM_VERSION" != "no instalado" ]; then
  check_pass "npm v$NPM_VERSION"
else
  check_fail "npm no instalado"
fi

echo ""

# ============================================
# RESUMEN
# ============================================
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}                      RESUMEN                              ${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

echo -e "  Total de verificaciones: $TOTAL_CHECKS"
echo -e "  ${GREEN}Pasadas:${NC}    $PASSED_CHECKS"
echo -e "  ${YELLOW}Advertencias:${NC} $WARNING_CHECKS"
echo -e "  ${RED}Fallidas:${NC}   $FAILED_CHECKS"
echo ""

# Estado general
if [ $FAILED_CHECKS -eq 0 ] && [ $WARNING_CHECKS -eq 0 ]; then
  echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗"
  echo -e "║              SISTEMA COMPLETAMENTE OPERATIVO              ║"
  echo -e "╚═══════════════════════════════════════════════════════════╝${NC}"
  EXIT_CODE=0
elif [ $FAILED_CHECKS -eq 0 ]; then
  echo -e "${YELLOW}╔═══════════════════════════════════════════════════════════╗"
  echo -e "║            SISTEMA OPERATIVO CON ADVERTENCIAS             ║"
  echo -e "╚═══════════════════════════════════════════════════════════╝${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}╔═══════════════════════════════════════════════════════════╗"
  echo -e "║               SISTEMA CON PROBLEMAS                       ║"
  echo -e "╚═══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "Ejecuta ${CYAN}./scripts/install.sh${NC} para resolver problemas de instalación."
  EXIT_CODE=1
fi

echo ""
echo -e "URLs del sistema:"
echo -e "  Backend:  ${BLUE}http://localhost:$BACKEND_PORT${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:$FRONTEND_PORT_DEV${NC} (dev) / ${BLUE}http://localhost:$FRONTEND_PORT_PROD${NC} (prod)"
echo -e "  API:      ${BLUE}http://localhost:$BACKEND_PORT/api${NC}"
echo -e "  OpenClaw: ${BLUE}$OPENCLAW_URL${NC}"
echo ""

exit $EXIT_CODE

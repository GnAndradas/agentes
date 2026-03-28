#!/bin/bash
#
# OCAAS Start Script
# Arranca backend y frontend en modo producción
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
LOGS_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/.pids"

# Archivos de PID
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

# Puertos por defecto
BACKEND_PORT=3001
FRONTEND_PORT=4173

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║              OCAAS - Production Start                     ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Crear directorios necesarios
mkdir -p "$LOGS_DIR"
mkdir -p "$PID_DIR"

# ============================================
# Funciones auxiliares
# ============================================

cleanup() {
  echo -e "\n${YELLOW}Deteniendo servicios...${NC}"
  stop_services
  exit 0
}

trap cleanup SIGINT SIGTERM

stop_services() {
  # Detener backend
  if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
      kill "$BACKEND_PID" 2>/dev/null || true
      echo -e "${GREEN}✓ Backend detenido (PID: $BACKEND_PID)${NC}"
    fi
    rm -f "$BACKEND_PID_FILE"
  fi

  # Detener frontend
  if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
      kill "$FRONTEND_PID" 2>/dev/null || true
      echo -e "${GREEN}✓ Frontend detenido (PID: $FRONTEND_PID)${NC}"
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi
}

check_port() {
  local port=$1
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0  # Puerto en uso
  else
    return 1  # Puerto libre
  fi
}

wait_for_service() {
  local url=$1
  local name=$2
  local max_attempts=30
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -q "200\|404"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

# ============================================
# Verificar prerequisitos
# ============================================
echo -e "${BLUE}[1/5] Verificando prerequisitos...${NC}"

cd "$PROJECT_ROOT"

# Verificar node_modules
if [ ! -d "node_modules" ]; then
  echo -e "${RED}❌ Dependencias no instaladas. Ejecuta: ./scripts/install.sh${NC}"
  exit 1
fi

# Verificar .env
if [ ! -f "backend/.env" ]; then
  echo -e "${RED}❌ Archivo backend/.env no encontrado. Ejecuta: ./scripts/install.sh${NC}"
  exit 1
fi

# Cargar variables de entorno
set -a
source backend/.env
set +a

BACKEND_PORT="${PORT:-3001}"

echo -e "${GREEN}✓ Prerequisitos verificados${NC}"

# ============================================
# Verificar puertos disponibles
# ============================================
echo -e "\n${BLUE}[2/5] Verificando puertos...${NC}"

if check_port $BACKEND_PORT; then
  echo -e "${YELLOW}⚠️  Puerto $BACKEND_PORT en uso. Deteniendo proceso anterior...${NC}"
  stop_services
  sleep 2
fi

if check_port $FRONTEND_PORT; then
  echo -e "${YELLOW}⚠️  Puerto $FRONTEND_PORT en uso${NC}"
  # Intentar matar el proceso
  lsof -ti:$FRONTEND_PORT | xargs kill -9 2>/dev/null || true
  sleep 1
fi

echo -e "${GREEN}✓ Puertos disponibles (Backend: $BACKEND_PORT, Frontend: $FRONTEND_PORT)${NC}"

# ============================================
# Compilar proyecto
# ============================================
echo -e "\n${BLUE}[3/5] Compilando proyecto...${NC}"

# Build backend
echo "   Compilando backend..."
npm run build -w backend > "$LOGS_DIR/build-backend.log" 2>&1
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Error compilando backend. Ver: logs/build-backend.log${NC}"
  exit 1
fi

# Build frontend
echo "   Compilando frontend..."
npm run build -w frontend > "$LOGS_DIR/build-frontend.log" 2>&1
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Error compilando frontend. Ver: logs/build-frontend.log${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Proyecto compilado${NC}"

# ============================================
# Iniciar Backend
# ============================================
echo -e "\n${BLUE}[4/5] Iniciando Backend...${NC}"

cd "$PROJECT_ROOT/backend"

# Iniciar en background
NODE_ENV=production node dist/index.js > "$LOGS_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$BACKEND_PID_FILE"

# Esperar a que esté listo
echo "   Esperando a que el backend esté listo..."
if wait_for_service "http://localhost:$BACKEND_PORT/api/system/health" "Backend"; then
  echo -e "${GREEN}✓ Backend iniciado (PID: $BACKEND_PID, Puerto: $BACKEND_PORT)${NC}"
else
  echo -e "${RED}❌ Backend no responde. Ver: logs/backend.log${NC}"
  cat "$LOGS_DIR/backend.log" | tail -20
  exit 1
fi

# ============================================
# Iniciar Frontend
# ============================================
echo -e "\n${BLUE}[5/5] Iniciando Frontend...${NC}"

cd "$PROJECT_ROOT/frontend"

# Usar vite preview para servir el build
npx vite preview --port $FRONTEND_PORT --host > "$LOGS_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$FRONTEND_PID_FILE"

# Esperar a que esté listo
sleep 3
if kill -0 $FRONTEND_PID 2>/dev/null; then
  echo -e "${GREEN}✓ Frontend iniciado (PID: $FRONTEND_PID, Puerto: $FRONTEND_PORT)${NC}"
else
  echo -e "${RED}❌ Frontend no pudo iniciar. Ver: logs/frontend.log${NC}"
  exit 1
fi

# ============================================
# Resumen
# ============================================
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗"
echo -e "║                    OCAAS INICIADO                          ║"
echo -e "╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Servicios activos:"
echo -e "  Backend:  ${BLUE}http://localhost:$BACKEND_PORT${NC}  (PID: $BACKEND_PID)"
echo -e "  Frontend: ${BLUE}http://localhost:$FRONTEND_PORT${NC}  (PID: $FRONTEND_PID)"
echo -e "  API:      ${BLUE}http://localhost:$BACKEND_PORT/api${NC}"
echo ""
echo -e "Logs:"
echo -e "  Backend:  ${CYAN}logs/backend.log${NC}"
echo -e "  Frontend: ${CYAN}logs/frontend.log${NC}"
echo ""
echo -e "Para detener: ${YELLOW}Ctrl+C${NC} o ejecuta:"
echo -e "  ${CYAN}kill \$(cat .pids/backend.pid) \$(cat .pids/frontend.pid)${NC}"
echo ""

# Mantener el script corriendo
echo -e "${GREEN}Presiona Ctrl+C para detener todos los servicios${NC}"
echo ""

# Mostrar logs en tiempo real
tail -f "$LOGS_DIR/backend.log" "$LOGS_DIR/frontend.log" 2>/dev/null

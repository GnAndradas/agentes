#!/bin/bash
#
# OCAAS Install Script
# Instala y configura todo el entorno de OCAAS
#
set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Directorio del proyecto (relativo al script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuración por defecto
BACKEND_PORT=3001
FRONTEND_PORT=5173
OPENCLAW_DEFAULT_URL="http://localhost:3000"

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           OCAAS - Installation Script                     ║"
echo "║     OpenClaw Agent Administration System                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================
# PASO 1: Validar entorno Linux/macOS
# ============================================
echo -e "${BLUE}[1/8] Validando sistema operativo...${NC}"

case "$OSTYPE" in
  linux*)   OS="Linux" ;;
  darwin*)  OS="macOS" ;;
  msys*|cygwin*|win32*)
    echo -e "${RED}❌ Error: Windows no está soportado.${NC}"
    echo "   OCAAS requiere Linux o macOS para funcionar correctamente."
    echo "   Usa WSL2 en Windows para ejecutar este script."
    exit 1
    ;;
  *)
    echo -e "${YELLOW}⚠️  Sistema operativo no reconocido: $OSTYPE${NC}"
    echo "   Continuando de todos modos..."
    OS="Unknown"
    ;;
esac

echo -e "${GREEN}✓ Sistema operativo: $OS${NC}"

# ============================================
# PASO 2: Comprobar Node.js y npm
# ============================================
echo -e "\n${BLUE}[2/8] Verificando Node.js y npm...${NC}"

# Verificar Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Error: Node.js no está instalado.${NC}"
  echo "   Instala Node.js 18+ desde: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Error: Se requiere Node.js 18+${NC}"
  echo "   Versión actual: $(node -v)"
  echo "   Actualiza Node.js desde: https://nodejs.org/"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Verificar npm
if ! command -v npm &> /dev/null; then
  echo -e "${RED}❌ Error: npm no está instalado.${NC}"
  exit 1
fi

NPM_VERSION=$(npm -v | cut -d'.' -f1)
if [ "$NPM_VERSION" -lt 9 ]; then
  echo -e "${YELLOW}⚠️  npm $NPM_VERSION detectado, recomendado npm 9+${NC}"
else
  echo -e "${GREEN}✓ npm $(npm -v)${NC}"
fi

# ============================================
# PASO 3: Crear carpetas necesarias
# ============================================
echo -e "\n${BLUE}[3/8] Creando estructura de directorios...${NC}"

cd "$PROJECT_ROOT"

# Carpeta de datos del backend
mkdir -p backend/data
echo -e "${GREEN}✓ backend/data/${NC}"

# Carpeta de logs
mkdir -p logs
echo -e "${GREEN}✓ logs/${NC}"

# Workspace de OpenClaw (si no existe)
OPENCLAW_WORKSPACE="${HOME}/.openclaw/workspace"
if [ ! -d "$OPENCLAW_WORKSPACE" ]; then
  mkdir -p "$OPENCLAW_WORKSPACE/skills"
  mkdir -p "$OPENCLAW_WORKSPACE/tools"
  echo -e "${GREEN}✓ ~/.openclaw/workspace/ (skills/, tools/)${NC}"
else
  echo -e "${GREEN}✓ ~/.openclaw/workspace/ (ya existe)${NC}"
fi

# ============================================
# PASO 4: Crear .env si no existe
# ============================================
echo -e "\n${BLUE}[4/8] Configurando variables de entorno...${NC}"

ENV_FILE="$PROJECT_ROOT/backend/.env"
ENV_EXAMPLE="$PROJECT_ROOT/backend/.env.example"

if [ -f "$ENV_FILE" ]; then
  echo -e "${GREEN}✓ backend/.env ya existe${NC}"

  # Validar que tiene las variables críticas
  if ! grep -q "OPENCLAW_GATEWAY_URL" "$ENV_FILE"; then
    echo -e "${YELLOW}⚠️  OPENCLAW_GATEWAY_URL no encontrada en .env${NC}"
  fi
else
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo -e "${GREEN}✓ backend/.env creado desde .env.example${NC}"
  else
    # Crear .env desde cero
    cat > "$ENV_FILE" << EOF
# Server
PORT=$BACKEND_PORT
HOST=0.0.0.0
NODE_ENV=development

# Database
DATABASE_URL=./data/ocaas.db

# OpenClaw Gateway (all LLM requests go through here)
OPENCLAW_GATEWAY_URL=$OPENCLAW_DEFAULT_URL
OPENCLAW_WORKSPACE_PATH=~/.openclaw/workspace
OPENCLAW_API_KEY=

# Security
API_SECRET_KEY=$(openssl rand -hex 16 2>/dev/null || echo "dev-secret-key-change-me")

# Logging
LOG_LEVEL=info
EOF
    echo -e "${GREEN}✓ backend/.env creado con valores por defecto${NC}"
  fi

  echo -e "${YELLOW}⚠️  Edita backend/.env con tu configuración:${NC}"
  echo "   - OPENCLAW_GATEWAY_URL (URL del gateway)"
  echo "   - OPENCLAW_API_KEY (si requiere autenticación)"
fi

# Cargar variables del .env
source "$ENV_FILE" 2>/dev/null || true

# ============================================
# PASO 5: Validar OPENCLAW_GATEWAY_URL
# ============================================
echo -e "\n${BLUE}[5/8] Validando configuración de OpenClaw...${NC}"

OPENCLAW_URL="${OPENCLAW_GATEWAY_URL:-$OPENCLAW_DEFAULT_URL}"

# Validar formato de URL
if [[ ! "$OPENCLAW_URL" =~ ^https?:// ]]; then
  echo -e "${RED}❌ Error: OPENCLAW_GATEWAY_URL no es una URL válida: $OPENCLAW_URL${NC}"
  exit 1
fi

echo -e "${GREEN}✓ OPENCLAW_GATEWAY_URL: $OPENCLAW_URL${NC}"

# ============================================
# PASO 6: Comprobar conexión con OpenClaw Gateway
# ============================================
echo -e "\n${BLUE}[6/8] Verificando conexión con OpenClaw Gateway...${NC}"

# Intentar conectar al gateway
OPENCLAW_HEALTH="${OPENCLAW_URL}/health"
OPENCLAW_CONNECTED=false

if command -v curl &> /dev/null; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$OPENCLAW_HEALTH" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ OpenClaw Gateway accesible en $OPENCLAW_URL${NC}"
    OPENCLAW_CONNECTED=true
  elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "${YELLOW}⚠️  OpenClaw Gateway no accesible en $OPENCLAW_URL${NC}"
    echo "   El sistema funcionará en modo offline."
    echo "   Inicia OpenClaw Gateway para habilitar todas las funciones."
  else
    echo -e "${YELLOW}⚠️  OpenClaw Gateway respondió con código: $HTTP_CODE${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  curl no disponible, no se puede verificar OpenClaw Gateway${NC}"
fi

# ============================================
# PASO 7: Instalar dependencias
# ============================================
echo -e "\n${BLUE}[7/8] Instalando dependencias...${NC}"

cd "$PROJECT_ROOT"

# Limpiar cache de npm si hay problemas
if [ -f "package-lock.json" ] && [ -d "node_modules" ]; then
  echo "   Usando dependencias existentes, actualizando..."
fi

# Instalar dependencias del monorepo (incluye backend y frontend)
echo "   Instalando dependencias del proyecto..."
npm install

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Dependencias instaladas correctamente${NC}"
else
  echo -e "${RED}❌ Error instalando dependencias${NC}"
  exit 1
fi

# ============================================
# PASO 8: Preparar base de datos
# ============================================
echo -e "\n${BLUE}[8/8] Preparando base de datos...${NC}"

cd "$PROJECT_ROOT"

# Generar migraciones si es necesario
if [ ! -d "backend/drizzle" ] || [ -z "$(ls -A backend/drizzle 2>/dev/null)" ]; then
  echo "   Generando esquema de base de datos..."
  npm run db:generate
fi

# Ejecutar push de esquema
echo "   Aplicando esquema de base de datos..."
npm run db:push

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Base de datos preparada${NC}"
else
  echo -e "${YELLOW}⚠️  Error en migraciones (puede ser normal en primera ejecución)${NC}"
fi

# ============================================
# RESUMEN FINAL
# ============================================
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗"
echo -e "║                 INSTALACIÓN COMPLETADA                     ║"
echo -e "╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✓ OCAAS instalado correctamente${NC}"
echo ""
echo -e "Configuración:"
echo -e "  Backend:  ${BLUE}http://localhost:${PORT:-$BACKEND_PORT}${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:$FRONTEND_PORT${NC}"
echo -e "  OpenClaw: ${BLUE}$OPENCLAW_URL${NC} $([ "$OPENCLAW_CONNECTED" = true ] && echo -e "${GREEN}(conectado)${NC}" || echo -e "${YELLOW}(offline)${NC}")"
echo ""
echo -e "Próximos pasos:"
echo -e "  1. ${CYAN}Edita backend/.env${NC} con tu configuración"
echo -e "  2. ${CYAN}./scripts/dev.sh${NC} para modo desarrollo"
echo -e "  3. ${CYAN}./scripts/start.sh${NC} para producción"
echo -e "  4. ${CYAN}./scripts/healthcheck.sh${NC} para verificar estado"
echo ""

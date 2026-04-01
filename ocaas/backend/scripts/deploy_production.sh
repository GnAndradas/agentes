#!/bin/bash
# =============================================================================
# OCAAS Production Deploy Script
#
# Usage:
#   ./scripts/deploy_production.sh
#   ./scripts/deploy_production.sh --skip-build
#   ./scripts/deploy_production.sh --clean
#
# Requirements:
#   - Node.js 18+
#   - npm
#   - .env file configured
#
# This script:
#   1. Validates environment
#   2. Installs dependencies
#   3. Builds TypeScript
#   4. Stops existing process on port 3001
#   5. Starts the service
#   6. Validates startup
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-3001}"

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
SKIP_BUILD=false
CLEAN=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    --clean) CLEAN=true ;;
  esac
done

echo ""
echo "============================================="
echo "   OCAAS Production Deploy"
echo "============================================="
echo ""

# =============================================================================
# 1. Change to backend directory
# =============================================================================
log_info "Working directory: $BACKEND_DIR"
cd "$BACKEND_DIR"

# =============================================================================
# 2. Validate Node.js
# =============================================================================
log_info "Checking Node.js version..."
if ! command -v node &> /dev/null; then
  log_error "Node.js is not installed"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  log_error "Node.js v18+ required (current: v$NODE_VERSION)"
  exit 1
fi
log_success "Node.js $(node -v)"

# =============================================================================
# 3. Validate .env exists
# =============================================================================
log_info "Checking .env file..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    log_warn ".env not found. Creating from .env.example..."
    cp .env.example .env
    log_warn "Edit .env with your configuration before continuing"
    exit 1
  else
    log_error ".env file not found and no .env.example available"
    exit 1
  fi
fi
log_success ".env file exists"

# Load .env for validation
set -a
source .env
set +a

# =============================================================================
# 4. Validate critical environment variables
# =============================================================================
log_info "Validating environment variables..."

if [ -z "$OPENCLAW_GATEWAY_URL" ]; then
  log_error "OPENCLAW_GATEWAY_URL is not set in .env"
  exit 1
fi

if [ -z "$API_SECRET_KEY" ]; then
  log_error "API_SECRET_KEY is not set in .env"
  exit 1
fi

if [ ${#API_SECRET_KEY} -lt 16 ]; then
  log_error "API_SECRET_KEY must be at least 16 characters"
  exit 1
fi

log_success "Environment variables validated"

# =============================================================================
# 5. Create required directories
# =============================================================================
log_info "Creating required directories..."
mkdir -p logs data
chmod 755 logs data
log_success "Directories ready"

# =============================================================================
# 6. Clean if requested
# =============================================================================
if [ "$CLEAN" = true ]; then
  log_info "Cleaning previous build..."
  rm -rf node_modules dist
  log_success "Cleaned"
fi

# =============================================================================
# 7. Install dependencies
# =============================================================================
log_info "Installing dependencies..."
npm install --production=false
log_success "Dependencies installed"

# =============================================================================
# 8. Build TypeScript
# =============================================================================
if [ "$SKIP_BUILD" = false ]; then
  log_info "Building TypeScript..."
  npm run build
  log_success "Build complete"
else
  log_info "Skipping build (--skip-build)"
  if [ ! -d "dist" ]; then
    log_error "No dist directory found. Remove --skip-build flag."
    exit 1
  fi
fi

# =============================================================================
# 9. Stop existing process on port
# =============================================================================
log_info "Checking for existing process on port $PORT..."
EXISTING_PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  log_warn "Stopping existing process (PID: $EXISTING_PID)..."
  kill -TERM $EXISTING_PID 2>/dev/null || true
  sleep 2
  # Force kill if still running
  if lsof -ti:$PORT &>/dev/null; then
    log_warn "Force killing process..."
    kill -9 $(lsof -ti:$PORT) 2>/dev/null || true
    sleep 1
  fi
  log_success "Existing process stopped"
else
  log_info "Port $PORT is available"
fi

# =============================================================================
# 10. Run doctor check
# =============================================================================
log_info "Running system doctor..."
if npm run doctor -- --silent; then
  log_success "Doctor check passed"
else
  log_warn "Doctor check has warnings (continuing anyway)"
fi

# =============================================================================
# 11. Start the service
# =============================================================================
log_info "Starting OCAAS backend..."

# Start in background with nohup
nohup node dist/index.js > logs/startup.log 2>&1 &
NEW_PID=$!

# Wait for startup
log_info "Waiting for startup (PID: $NEW_PID)..."
sleep 3

# Check if process is still running
if ! kill -0 $NEW_PID 2>/dev/null; then
  log_error "Process failed to start. Check logs/startup.log:"
  tail -20 logs/startup.log
  exit 1
fi

# =============================================================================
# 12. Validate startup
# =============================================================================
log_info "Validating service..."

# Try health endpoint
MAX_ATTEMPTS=10
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if curl -s "http://localhost:$PORT/health" | grep -q "ok"; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  log_error "Service did not respond to health check"
  log_error "Check logs: tail -f logs/combined.log"
  exit 1
fi

log_success "Health check passed"

# =============================================================================
# 13. Run smoke test
# =============================================================================
log_info "Running smoke test..."
if npm run smoke-test -- --skip-openclaw 2>/dev/null; then
  log_success "Smoke test passed"
else
  log_warn "Smoke test had issues (service may still be functional)"
fi

# =============================================================================
# Final Summary
# =============================================================================
echo ""
echo "============================================="
echo -e "${GREEN}   DEPLOY SUCCESSFUL${NC}"
echo "============================================="
echo ""
echo "Service running at: http://localhost:$PORT"
echo "Process ID: $NEW_PID"
echo ""
echo "Commands:"
echo "  View logs:    tail -f $BACKEND_DIR/logs/combined.log"
echo "  Stop service: kill $NEW_PID"
echo "  Check health: curl http://localhost:$PORT/health"
echo "  Run doctor:   npm run doctor"
echo ""

#!/bin/bash
# ==============================================================================
# check-build-sync.sh - Verify source and dist are in sync
# ==============================================================================
# This script checks if TypeScript source files are newer than their compiled
# JavaScript counterparts, indicating a rebuild is needed.
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo " Source/Build Sync Checker"
echo "========================================"
echo ""

NEEDS_REBUILD=false
BACKEND_STALE=false
FRONTEND_STALE=false

# Check backend
echo "Checking backend..."
BACKEND_SRC="$ROOT_DIR/backend/src"
BACKEND_DIST="$ROOT_DIR/backend/dist"

if [ -d "$BACKEND_DIST" ]; then
    # Find newest .ts file in src
    NEWEST_SRC=$(find "$BACKEND_SRC" -name "*.ts" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
    NEWEST_SRC_TIME=$(stat -c %Y "$NEWEST_SRC" 2>/dev/null || echo 0)

    # Find oldest .js file in dist (if any file is older than newest src, rebuild needed)
    OLDEST_DIST=$(find "$BACKEND_DIST" -name "*.js" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)
    OLDEST_DIST_TIME=$(stat -c %Y "$OLDEST_DIST" 2>/dev/null || echo 0)

    if [ "$NEWEST_SRC_TIME" -gt "$OLDEST_DIST_TIME" ]; then
        echo -e "  ${RED}✗ Backend dist is STALE${NC}"
        echo "    Newest source: $NEWEST_SRC"
        echo "    Oldest dist:   $OLDEST_DIST"
        BACKEND_STALE=true
        NEEDS_REBUILD=true
    else
        echo -e "  ${GREEN}✓ Backend dist is up to date${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠ Backend dist folder not found${NC}"
    BACKEND_STALE=true
    NEEDS_REBUILD=true
fi

# Check frontend
echo ""
echo "Checking frontend..."
FRONTEND_SRC="$ROOT_DIR/frontend/src"
FRONTEND_DIST="$ROOT_DIR/frontend/dist"

if [ -d "$FRONTEND_DIST" ]; then
    # Find newest source file
    NEWEST_FE_SRC=$(find "$FRONTEND_SRC" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" \) -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)
    NEWEST_FE_SRC_TIME=$(stat -c %Y "$NEWEST_FE_SRC" 2>/dev/null || echo 0)

    # Find the main bundle (should be newer than all source)
    MAIN_BUNDLE=$(find "$FRONTEND_DIST/assets" -name "*.js" -type f 2>/dev/null | head -1)
    MAIN_BUNDLE_TIME=$(stat -c %Y "$MAIN_BUNDLE" 2>/dev/null || echo 0)

    if [ "$NEWEST_FE_SRC_TIME" -gt "$MAIN_BUNDLE_TIME" ]; then
        echo -e "  ${RED}✗ Frontend dist is STALE${NC}"
        echo "    Newest source: $NEWEST_FE_SRC"
        echo "    Main bundle:   $MAIN_BUNDLE"
        FRONTEND_STALE=true
        NEEDS_REBUILD=true
    else
        echo -e "  ${GREEN}✓ Frontend dist is up to date${NC}"
    fi
else
    echo -e "  ${YELLOW}⚠ Frontend dist folder not found${NC}"
    FRONTEND_STALE=true
    NEEDS_REBUILD=true
fi

# Summary
echo ""
echo "========================================"
echo " Summary"
echo "========================================"

if [ "$NEEDS_REBUILD" = true ]; then
    echo -e "${RED}Build is OUT OF SYNC with source!${NC}"
    echo ""
    echo "Run the following to fix:"
    if [ "$BACKEND_STALE" = true ]; then
        echo "  cd backend && npm run build"
    fi
    if [ "$FRONTEND_STALE" = true ]; then
        echo "  cd frontend && npm run build"
    fi
    exit 1
else
    echo -e "${GREEN}All builds are in sync!${NC}"
    exit 0
fi

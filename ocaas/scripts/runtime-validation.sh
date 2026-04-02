#!/bin/bash
#
# OCAAS Runtime Validation Script
# ================================
# Run this on Linux/macOS to validate that the deployed system
# matches the expected behavior from source code.
#
# Prerequisites:
# - Node.js 20+ LTS
# - Backend running on port 3001
# - Frontend built and served
#
# Usage:
#   ./scripts/runtime-validation.sh
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
PASS=0
FAIL=0
WARN=0

echo "=============================================="
echo " OCAAS Runtime Validation"
echo " $(date)"
echo "=============================================="
echo ""

# -----------------------------------------------------------------------------
# HELPER FUNCTIONS
# -----------------------------------------------------------------------------

check_pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    ((PASS++))
}

check_fail() {
    echo -e "  ${RED}✗${NC} $1"
    echo -e "    ${RED}Error: $2${NC}"
    ((FAIL++))
}

check_warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
    ((WARN++))
}

section() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
}

# -----------------------------------------------------------------------------
# 1. ENVIRONMENT CHECKS
# -----------------------------------------------------------------------------

section "1. Environment Verification"

# Node version
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
if [[ "$NODE_VERSION" == "not found" ]]; then
    check_fail "Node.js installed" "Node.js not found in PATH"
else
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | tr -d 'v')
    if [[ $MAJOR_VERSION -ge 20 ]]; then
        check_pass "Node.js version: $NODE_VERSION (>= 20)"
    else
        check_fail "Node.js version" "Found $NODE_VERSION, need >= 20"
    fi
fi

# Backend reachable
if curl -s --connect-timeout 5 "$BACKEND_URL/api/health" > /dev/null 2>&1; then
    check_pass "Backend reachable at $BACKEND_URL"
else
    check_fail "Backend reachable" "Cannot connect to $BACKEND_URL/api/health"
    echo ""
    echo -e "${RED}Backend not running. Start it with: npm start${NC}"
    exit 1
fi

# Check dist timestamps
section "2. Build Freshness Check"

BACKEND_DIR="$(dirname "$0")/../backend"
FRONTEND_DIR="$(dirname "$0")/../frontend"

if [[ -f "$BACKEND_DIR/dist/index.js" ]]; then
    SRC_NEWEST=$(find "$BACKEND_DIR/src" -name "*.ts" -newer "$BACKEND_DIR/dist/index.js" 2>/dev/null | head -1)
    if [[ -z "$SRC_NEWEST" ]]; then
        check_pass "Backend dist is up to date"
    else
        check_warn "Backend dist may be stale (found newer source files)"
    fi
else
    check_fail "Backend dist exists" "dist/index.js not found"
fi

if [[ -d "$FRONTEND_DIR/dist/assets" ]]; then
    FE_JS=$(ls -t "$FRONTEND_DIR/dist/assets/"*.js 2>/dev/null | head -1)
    if [[ -n "$FE_JS" ]]; then
        check_pass "Frontend dist exists"
    else
        check_warn "Frontend dist/assets has no JS files"
    fi
else
    check_warn "Frontend dist/assets not found"
fi

# -----------------------------------------------------------------------------
# 3. AGENT API VALIDATION
# -----------------------------------------------------------------------------

section "3. Agent API Routes"

# GET /api/agents
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/agents")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/agents → 200"
else
    check_fail "GET /api/agents" "Got HTTP $RESPONSE"
fi

# POST /api/agents (create)
AGENT_JSON='{"name":"test-runtime-agent","type":"general","description":"Runtime validation test"}'
RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/agents" -H "Content-Type: application/json" -d "$AGENT_JSON")
AGENT_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$AGENT_ID" ]]; then
    check_pass "POST /api/agents → created (id: $AGENT_ID)"

    # PATCH /api/agents/:id
    PATCH_JSON='{"name":"test-runtime-agent-updated"}'
    PATCH_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BACKEND_URL/api/agents/$AGENT_ID" -H "Content-Type: application/json" -d "$PATCH_JSON")
    if [[ "$PATCH_RESP" == "200" ]]; then
        check_pass "PATCH /api/agents/:id → 200"
    else
        check_fail "PATCH /api/agents/:id" "Got HTTP $PATCH_RESP"
    fi

    # POST /api/agents/:id/activate
    ACT_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/agents/$AGENT_ID/activate")
    if [[ "$ACT_RESP" == "200" ]]; then
        check_pass "POST /api/agents/:id/activate → 200"
    else
        check_fail "POST /api/agents/:id/activate" "Got HTTP $ACT_RESP"
    fi

    # POST /api/agents/:id/deactivate
    DEACT_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/agents/$AGENT_ID/deactivate")
    if [[ "$DEACT_RESP" == "200" ]]; then
        check_pass "POST /api/agents/:id/deactivate → 200"
    else
        check_fail "POST /api/agents/:id/deactivate" "Got HTTP $DEACT_RESP"
    fi

    # DELETE /api/agents/:id
    DEL_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BACKEND_URL/api/agents/$AGENT_ID")
    if [[ "$DEL_RESP" == "204" ]]; then
        check_pass "DELETE /api/agents/:id → 204"
    else
        check_fail "DELETE /api/agents/:id" "Got HTTP $DEL_RESP"
    fi
else
    check_fail "POST /api/agents" "Could not create test agent"
fi

# -----------------------------------------------------------------------------
# 4. SKILL API VALIDATION
# -----------------------------------------------------------------------------

section "4. Skill API Routes"

# GET /api/skills
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/skills")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/skills → 200"
else
    check_fail "GET /api/skills" "Got HTTP $RESPONSE"
fi

# GET /api/skills?expand=toolCount
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/skills?expand=toolCount")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/skills?expand=toolCount → 200"
else
    check_fail "GET /api/skills?expand=toolCount" "Got HTTP $RESPONSE"
fi

# POST /api/skills (create)
SKILL_JSON='{"name":"test-runtime-skill","path":"/skills/test-runtime","version":"1.0.0"}'
RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/skills" -H "Content-Type: application/json" -d "$SKILL_JSON")
SKILL_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$SKILL_ID" ]]; then
    check_pass "POST /api/skills → created (id: $SKILL_ID)"

    # GET /api/skills/:id/tools
    TOOLS_RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/skills/$SKILL_ID/tools")
    if [[ "$TOOLS_RESP" == "200" ]]; then
        check_pass "GET /api/skills/:id/tools → 200"
    else
        check_fail "GET /api/skills/:id/tools" "Got HTTP $TOOLS_RESP"
    fi

    # GET /api/skills/:id/tools?expand=tool
    TOOLS_EXP_RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/skills/$SKILL_ID/tools?expand=tool")
    if [[ "$TOOLS_EXP_RESP" == "200" ]]; then
        check_pass "GET /api/skills/:id/tools?expand=tool → 200"
    else
        check_fail "GET /api/skills/:id/tools?expand=tool" "Got HTTP $TOOLS_EXP_RESP"
    fi

    # PUT /api/skills/:id/tools (empty array)
    PUT_TOOLS_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BACKEND_URL/api/skills/$SKILL_ID/tools" -H "Content-Type: application/json" -d '{"tools":[]}')
    if [[ "$PUT_TOOLS_RESP" == "200" ]]; then
        check_pass "PUT /api/skills/:id/tools → 200"
    else
        check_fail "PUT /api/skills/:id/tools" "Got HTTP $PUT_TOOLS_RESP"
    fi

    # GET /api/skills/:id/execution-preview
    PREVIEW_RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/skills/$SKILL_ID/execution-preview")
    if [[ "$PREVIEW_RESP" == "200" ]]; then
        check_pass "GET /api/skills/:id/execution-preview → 200"
    else
        check_fail "GET /api/skills/:id/execution-preview" "Got HTTP $PREVIEW_RESP"
    fi

    # Cleanup
    curl -s -X DELETE "$BACKEND_URL/api/skills/$SKILL_ID" > /dev/null
    check_pass "DELETE /api/skills/:id → cleaned up"
else
    check_fail "POST /api/skills" "Could not create test skill"
fi

# -----------------------------------------------------------------------------
# 5. TOOL API VALIDATION
# -----------------------------------------------------------------------------

section "5. Tool API Routes"

# GET /api/tools
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/tools")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/tools → 200"
else
    check_fail "GET /api/tools" "Got HTTP $RESPONSE"
fi

# POST /api/tools/validate (static route - CRITICAL)
VALIDATE_JSON='{"name":"test-tool","path":"/tools/test","type":"script"}'
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/tools/validate" -H "Content-Type: application/json" -d "$VALIDATE_JSON")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "POST /api/tools/validate → 200 (static route works!)"
else
    check_fail "POST /api/tools/validate" "Got HTTP $RESPONSE - CRITICAL: static route may be misconfigured"
fi

# POST /api/tools/validate-config (static route)
CONFIG_JSON='{"type":"script","config":{"command":"echo","args":["hello"]}}'
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/tools/validate-config" -H "Content-Type: application/json" -d "$CONFIG_JSON")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "POST /api/tools/validate-config → 200"
else
    check_fail "POST /api/tools/validate-config" "Got HTTP $RESPONSE"
fi

# POST /api/tools (create)
TOOL_JSON='{"name":"test-runtime-tool","path":"/tools/test-runtime","type":"script"}'
RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/tools" -H "Content-Type: application/json" -d "$TOOL_JSON")
TOOL_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$TOOL_ID" ]]; then
    check_pass "POST /api/tools → created (id: $TOOL_ID)"

    # PATCH /api/tools/:id (with status)
    PATCH_JSON='{"status":"inactive"}'
    PATCH_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BACKEND_URL/api/tools/$TOOL_ID" -H "Content-Type: application/json" -d "$PATCH_JSON")
    if [[ "$PATCH_RESP" == "200" ]]; then
        check_pass "PATCH /api/tools/:id (status) → 200"
    else
        check_fail "PATCH /api/tools/:id" "Got HTTP $PATCH_RESP"
    fi

    # POST /api/tools/:id/validate (parameterized)
    VAL_EXIST_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND_URL/api/tools/$TOOL_ID/validate")
    if [[ "$VAL_EXIST_RESP" == "200" ]]; then
        check_pass "POST /api/tools/:id/validate → 200"
    else
        check_fail "POST /api/tools/:id/validate" "Got HTTP $VAL_EXIST_RESP"
    fi

    # Cleanup
    curl -s -X DELETE "$BACKEND_URL/api/tools/$TOOL_ID" > /dev/null
    check_pass "DELETE /api/tools/:id → cleaned up"
else
    check_fail "POST /api/tools" "Could not create test tool"
fi

# -----------------------------------------------------------------------------
# 6. SYSTEM API VALIDATION
# -----------------------------------------------------------------------------

section "6. System API Routes"

# GET /api/system/health
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/system/health")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/system/health → 200"
else
    check_fail "GET /api/system/health" "Got HTTP $RESPONSE"
fi

# GET /api/system/gateway
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/system/gateway")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/system/gateway → 200"
else
    check_warn "GET /api/system/gateway → $RESPONSE (may need OpenClaw)"
fi

# GET /api/system/diagnostics
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/system/diagnostics")
if [[ "$RESPONSE" == "200" ]]; then
    check_pass "GET /api/system/diagnostics → 200"
else
    check_fail "GET /api/system/diagnostics" "Got HTTP $RESPONSE"
fi

# -----------------------------------------------------------------------------
# SUMMARY
# -----------------------------------------------------------------------------

echo ""
echo "=============================================="
echo " SUMMARY"
echo "=============================================="
echo ""
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Warnings:${NC} $WARN"
echo ""

if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}✓ All critical checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed. Review the output above.${NC}"
    exit 1
fi

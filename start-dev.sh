#!/usr/bin/env bash
#
# Start all GCUID development services on Linux/macOS.
#
# Launches the API server, Web UI, and the four connector services in
# background processes. Writes per-service logs to staging/logs/ and
# PIDs to staging/data/*.pid. Run this from the repository root.
#
# Usage:
#   ./start-dev.sh                  # start everything
#   ./start-dev.sh --skip-connectors
#   ./start-dev.sh --skip-web
#   ./start-dev.sh --help

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="${REPO_ROOT}/staging"

API_PORT=5182
WEB_PORT=5181
CONNECTOR_PORTS=(5183 5184 5185 5186)
# Source servers own their own SQLite files; connectors HTTP-proxy to them.
# Ports 5188-5191 (5187 reserved for ea-mcp-bridge — see /e/github/.dev-ports.json).
SOURCE_PORTS=(5188 5189 5190 5191)

SKIP_CONNECTORS=false
SKIP_WEB=false
SKIP_SOURCES=false

for arg in "$@"; do
    case "$arg" in
        --skip-connectors) SKIP_CONNECTORS=true ;;
        --skip-web)        SKIP_WEB=true ;;
        --skip-sources)    SKIP_SOURCES=true ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-sources      Skip starting the four source servers (5188-5191)"
            echo "  --skip-connectors   Skip starting the four connector services"
            echo "  --skip-web          Skip starting the Web UI"
            echo "  --help, -h          Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

echo ""
echo "======================================================"
echo "  GCUID Development Environment"
echo "======================================================"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────────

if [ ! -f "${STAGING_DIR}/package.json" ]; then
    echo "ERROR: staging/package.json not found. Run this script from the repo root." >&2
    exit 1
fi

if [ ! -f "${STAGING_DIR}/data/registry.db" ]; then
    echo "No database found -- running seed-data..."
    ( cd "${STAGING_DIR}" && npm run seed-data )
    echo "Databases created."
    echo ""
fi

# After staging/ was added as a root workspace (commit 4cb2da7), npm may hoist
# staging's deps to root node_modules. Accept either location.
declare -a REQUIRED_PACKAGES=(jexl better-sqlite3 tsx)
MISSING_PKG=0
for pkg in "${REQUIRED_PACKAGES[@]}"; do
    if [ ! -d "${STAGING_DIR}/node_modules/${pkg}" ] && [ ! -d "${REPO_ROOT}/node_modules/${pkg}" ]; then
        echo "MISSING  ${pkg} -- run: cd staging && npm install" >&2
        MISSING_PKG=1
    fi
done
if [ "${MISSING_PKG}" = "1" ]; then
    exit 1
fi

if [ "${SKIP_WEB}" = false ] && [ ! -d "${STAGING_DIR}/web-ui/node_modules" ]; then
    echo "MISSING  staging/web-ui/node_modules -- run: cd staging/web-ui && npm install" >&2
    exit 1
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

check_port() {
    local port=$1
    if command -v lsof >/dev/null 2>&1; then
        lsof -i ":${port}" >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -ltn "sport = :${port}" 2>/dev/null | grep -q LISTEN
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ltn 2>/dev/null | grep -qE "[.:]${port}[[:space:]]"
    else
        return 1  # No way to detect; assume free
    fi
}

start_service() {
    local label=$1
    local command=$2
    local port=$3
    local log_file=$4
    local pid_file=$5

    if check_port "${port}"; then
        echo "  SKIP  ${label} -- port ${port} already in use"
        return 1
    fi

    echo "  START ${label} on port ${port}"
    # nohup + disown: see Sources block for rationale.
    nohup bash -c "cd \"${STAGING_DIR}\" && exec ${command}" \
        > "${log_file}" 2>&1 &
    local svc_pid=$!
    echo "${svc_pid}" > "${pid_file}"
    disown "${svc_pid}" 2>/dev/null || true
    return 0
}

mkdir -p "${STAGING_DIR}/logs"

# ── API Server ───────────────────────────────────────────────────────────────

echo "API Server"
start_service "API Server" "npm run start-api" "${API_PORT}" \
    "${STAGING_DIR}/logs/api.log" "${STAGING_DIR}/data/.api.pid" \
    && sleep 2

# ── Web UI ───────────────────────────────────────────────────────────────────

if [ "${SKIP_WEB}" = false ]; then
    echo ""
    echo "Web UI"
    start_service "Web UI" "npm run start-web" "${WEB_PORT}" \
        "${STAGING_DIR}/logs/web.log" "${STAGING_DIR}/data/.web.pid" \
        && sleep 2
fi

# ── Source Servers ───────────────────────────────────────────────────────────
# Connectors HTTP-proxy to these. Launch first so they're ready when
# connectors try to dial them.

if [ "${SKIP_SOURCES}" = false ]; then
    echo ""
    echo "Source Servers"

    any_source_in_use=false
    for port in "${SOURCE_PORTS[@]}"; do
        if check_port "${port}"; then
            any_source_in_use=true
            break
        fi
    done

    if [ "${any_source_in_use}" = true ]; then
        echo "  SKIP  Sources -- one or more ports already in use"
    else
        echo "  START All source servers (ports 5188, 5189, 5190, 5191)"
        # nohup + disown so backgrounded children survive the parent script exit.
        # Without these, killing the smoke's wrapper process tree takes the
        # source servers with it and the next assertion fails.
        nohup bash -c "cd \"${STAGING_DIR}\" && exec npx tsx scripts/start-sources-all.ts" \
            > "${STAGING_DIR}/logs/sources.log" 2>&1 &
        sources_pid=$!
        echo "${sources_pid}" > "${STAGING_DIR}/data/.sources.pid"
        disown "${sources_pid}" 2>/dev/null || true
        sleep 2
    fi
fi

# ── Connectors ───────────────────────────────────────────────────────────────

if [ "${SKIP_CONNECTORS}" = false ]; then
    echo ""
    echo "Connector Services"

    any_in_use=false
    for port in "${CONNECTOR_PORTS[@]}"; do
        if check_port "${port}"; then
            any_in_use=true
            break
        fi
    done

    if [ "${any_in_use}" = true ]; then
        echo "  SKIP  Connectors -- one or more ports already in use"
    else
        echo "  START All connectors (ports 5183, 5184, 5185, 5186)"
        # nohup + disown: see Sources block for rationale.
        nohup bash -c "cd \"${STAGING_DIR}\" && exec npm run start-connectors" \
            > "${STAGING_DIR}/logs/connectors.log" 2>&1 &
        connectors_pid=$!
        echo "${connectors_pid}" > "${STAGING_DIR}/data/.connectors.pid"
        disown "${connectors_pid}" 2>/dev/null || true
        sleep 2
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "======================================================"
echo "  Ready"
echo "======================================================"
echo ""
echo "  Web UI      http://localhost:${WEB_PORT}"
echo "  API         http://localhost:${API_PORT}"
echo "  API health  http://localhost:${API_PORT}/health"

if [ "${SKIP_CONNECTORS}" = false ]; then
    echo "  HR          http://localhost:5183"
    echo "  LDAP        http://localhost:5184"
    echo "  Engineering http://localhost:5185"
    echo "  Finance     http://localhost:5186"
fi

if [ "${SKIP_SOURCES}" = false ]; then
    echo "  HR source     http://localhost:5188"
    echo "  LDAP source   http://localhost:5189"
    echo "  Eng source    http://localhost:5190"
    echo "  Fin source    http://localhost:5191"
fi

echo ""
echo "  Logs are in staging/logs/"
echo "  PIDs are in staging/data/.*.pid (api, web, connectors, sources)"
echo "  Run ./stop-dev.sh to stop everything."
echo ""

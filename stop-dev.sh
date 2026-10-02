#!/usr/bin/env bash
#
# Stop all GCUID development services on Linux/macOS.
#
# Kills any process listed in staging/data/*.pid, then falls back to
# killing anything listening on the standard GCUID ports (5181-5186 + 5188-5191).
# 5187 is owned by ea-mcp-bridge and is intentionally NOT included.
# Run this from the repository root.
#
# Usage:
#   ./stop-dev.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAGING_DIR="${REPO_ROOT}/staging"

PORTS=(5182 5181 5183 5184 5185 5186 5188 5189 5190 5191)
SERVICE_NAMES=(
    "API Server"
    "Web UI"
    "HR Connector"
    "LDAP Connector"
    "Engineering Connector"
    "Finance Connector"
    "HR Source"
    "LDAP Source"
    "Engineering Source"
    "Finance Source"
)

stopped_count=0

echo ""
echo "======================================================"
echo "  GCUID Development Environment -- Stopping"
echo "======================================================"
echo ""

# ── Stop by PID file ─────────────────────────────────────────────────────────

if compgen -G "${STAGING_DIR}/data/.*.pid" >/dev/null; then
    for pid_file in "${STAGING_DIR}"/data/.*.pid; do
        [ -f "${pid_file}" ] || continue
        pid=$(cat "${pid_file}" 2>/dev/null || echo "")
        service_name=$(basename "${pid_file}" .pid | sed 's/^\.//; s/_/ /g')

        if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
            echo "  STOP  ${service_name} (PID: ${pid})"
            kill "${pid}" 2>/dev/null || true
            stopped_count=$((stopped_count + 1))
        else
            echo "  SKIP  ${service_name} (not running)"
        fi

        rm -f "${pid_file}"
    done
fi

# ── Fallback: kill by port ───────────────────────────────────────────────────

for i in "${!PORTS[@]}"; do
    port=${PORTS[$i]}
    service_name=${SERVICE_NAMES[$i]}

    pid=""
    if command -v lsof >/dev/null 2>&1; then
        pid=$(lsof -ti ":${port}" 2>/dev/null || true)
    elif command -v fuser >/dev/null 2>&1; then
        pid=$(fuser "${port}/tcp" 2>/dev/null | awk '{print $1}')
    elif [ -r /proc/net/tcp ]; then
        # Linux without lsof/fuser: scan /proc/net/tcp + walk /proc/*/fd
        # local_address is hex IP:PORT; state 0A = LISTEN
        local hex_port inode fd_dir
        hex_port=$(printf '%04X' "${port}")
        inode=$(awk -v hp=":${hex_port}" '$2 ~ hp && $4 == "0A" {print $10; exit}' /proc/net/tcp 2>/dev/null)
        if [ -n "${inode}" ]; then
            for fd_dir in /proc/[0-9]*/fd; do
                [ -d "${fd_dir}" ] || continue
                if ls -l "${fd_dir}" 2>/dev/null | grep -q "socket:\[${inode}\]"; then
                    pid=$(basename "$(dirname "${fd_dir}")")
                    break
                fi
            done
        fi
    fi

    if [ -n "${pid}" ]; then
        echo "  STOP  ${service_name} (port ${port}, PID: ${pid})"
        kill "${pid}" 2>/dev/null || true
        stopped_count=$((stopped_count + 1))
    fi
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "======================================================"

if [ "${stopped_count}" -eq 0 ]; then
    echo "  No services were running."
else
    echo "  Stopped ${stopped_count} service(s)."
fi

echo "======================================================"
echo ""

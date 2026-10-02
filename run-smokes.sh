#!/usr/bin/env bash
#
# Run all GCUID smoke tests in sequence.
#
# Wraps scripts/run-smokes.js (the cross-platform dispatcher). Passes through
# all arguments. Use this from the repository root the same way you use
# start-dev.sh / stop-dev.sh.
#
# Usage:
#   ./run-smokes.sh                  # default: live-stack-compatible smokes
#   ./run-smokes.sh --list           # show all available smokes
#   ./run-smokes.sh --all            # include destructive smokes (no stack running)
#   ./run-smokes.sh invariants       # run smokes matching "invariants"
#   ./run-smokes.sh --help           # full help from run-smokes.js
#
# Exit codes:
#   0  — all smokes passed
#   1  — one or more smokes failed
#   2  — orchestrator crashed
#
# Requires: Node 18+ on PATH (the dispatcher runs through tsx).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCHER="${REPO_ROOT}/scripts/run-smokes.js"

if [[ ! -f "${DISPATCHER}" ]]; then
    echo "ERROR: dispatcher not found at ${DISPATCHER}" >&2
    exit 2
fi

# On Windows (MSYS/Cygwin), ${REPO_ROOT} comes back as /e/GitHub/... (POSIX-style),
# but `node` is a Windows binary and doesn't understand MSYS paths. Convert
# to a native Windows path before exec'ing. On Linux/macOS this is a no-op.
if [[ "${OS:-}" == "Windows_NT" ]] && command -v cygpath >/dev/null 2>&1; then
    DISPATCHER="$(cygpath -w "${DISPATCHER}")"
fi

# Ensure dependencies are installed (tsx may live at staging/node_modules/.bin/tsx
# OR at root node_modules/.bin/tsx when staging/ is a root workspace and deps hoist)
STAGING_DIR="${REPO_ROOT}/staging"
TSX_FOUND=0
for candidate in "${STAGING_DIR}/node_modules/.bin/tsx" "${REPO_ROOT}/node_modules/.bin/tsx"; do
    if [[ -x "${candidate}" ]]; then TSX_FOUND=1; break; fi
done
if [[ ${TSX_FOUND} -eq 0 ]]; then
    echo "Installing staging dependencies (one-time)..." >&2
    (cd "${STAGING_DIR}" && npm install --silent)
fi

exec node "${DISPATCHER}" "$@"

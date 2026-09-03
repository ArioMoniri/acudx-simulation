#!/usr/bin/env bash
#
# restart.sh — bounce the AcuDx gateway, then ensure the whole stack is up.
#
# Default behaviour: STOP the gateway and start it again (the common case — you
# redeployed the app and want it reloaded), while LEAVING llama-server running
# (a 7B model reload is expensive). start.sh is idempotent, so anything already
# up is left alone and only what is down is (re)started.
#
#   Usage:
#     ./restart.sh                # restart the gateway; keep llama-server up
#     RESTART_LLAMA=1 ./restart.sh # also stop + restart llama-server
#
# Env-driven: shares every variable with start.sh (RUN_DIR, APP_PORT, LLAMA_PORT,
# …). Set them the same way you set them for start.sh.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUN_DIR="${RUN_DIR:-/data/acudx-sim/run}"
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-8890}"
LLAMA_HOST="${LLAMA_HOST:-127.0.0.1}"
LLAMA_PORT="${LLAMA_PORT:-3040}"
STOP_WAIT_S="${STOP_WAIT_S:-10}"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

# stop_pidfile FILE NAME — TERM the pid, escalate to KILL, then remove the file.
stop_pidfile() {
  local f="$1" name="$2" pid i=0
  [[ -f "${f}" ]] || { info "no pidfile for ${name} (${f})"; return 0; }
  pid="$(cat "${f}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    info "stopping ${name} (pid ${pid})"
    kill "${pid}" 2>/dev/null || true
    while (( i < STOP_WAIT_S )) && kill -0 "${pid}" 2>/dev/null; do sleep 1; i=$(( i + 1 )); done
    if kill -0 "${pid}" 2>/dev/null; then
      info "${name} did not exit; sending KILL"
      kill -9 "${pid}" 2>/dev/null || true
    fi
  else
    info "${name} not running (stale pidfile)"
  fi
  rm -f "${f}"
}

step "AcuDx restart"

# --- stop the gateway ------------------------------------------------------
stop_pidfile "${RUN_DIR}/gateway.pid" "gateway"
# Best-effort belt-and-suspenders (in case it was started outside a pidfile).
pkill -f "uvicorn server.app:app.*--port ${APP_PORT}" 2>/dev/null || true

# --- optionally stop llama-server ------------------------------------------
if [[ "${RESTART_LLAMA:-0}" == "1" ]]; then
  stop_pidfile "${RUN_DIR}/llama-server.pid" "llama-server"
  pkill -f "llama-server.*--port ${LLAMA_PORT}" 2>/dev/null || true
else
  info "leaving llama-server running (set RESTART_LLAMA=1 to bounce it too)"
fi

# --- bring everything back up (idempotent) ---------------------------------
step "Re-running start.sh"
exec "${SCRIPT_DIR}/start.sh"

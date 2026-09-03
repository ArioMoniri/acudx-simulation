#!/usr/bin/env bash
#
# start.sh — bring up the AcuDx model stack on the GPU pod (idempotent).
#
# Starts, if not already listening:
#   1. llama-server  (Qwen2.5-7B-Instruct, the local OpenAI-compatible LLM)
#   2. the AcuDx gateway  (uvicorn server.app:app — the only path to a model)
#
# Idempotent: each service is started ONLY when nothing is already listening on
# its port, so re-running is safe (it becomes a no-op for anything already up).
# Env-driven: every knob below is overridable from the environment; the DEFAULTS
# match the build brief and server/deploy.sh. Nothing here reaches the network
# except the local model endpoints — the gateway keeps AIRGAPPED enforcement.
#
#   Usage:
#     ./start.sh              # start whatever is down; leave what is up
#     GATEWAY_ONLY=1 ./start.sh   # start only the gateway (assume llama is up)
#     LLAMA_ONLY=1   ./start.sh   # start only llama-server
#
set -euo pipefail

# --- paths -----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# server/bin -> server -> src root (the dir that CONTAINS the `server` package).
SRC_ROOT="${SRC_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

# --- llama-server (override via env) ---------------------------------------
LLAMA_BIN="${LLAMA_BIN:-/data/llama.cpp/build/bin/llama-server}"
MODEL_PATH="${MODEL_PATH:-/data/acudx-sim/models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf}"
LLAMA_HOST="${LLAMA_HOST:-127.0.0.1}"
LLAMA_PORT="${LLAMA_PORT:-3040}"
CTX="${CTX:-8192}"
THREADS="${THREADS:-32}"
NGL="${NGL:-0}"
JINJA="${JINJA:---jinja}"            # set JINJA="" to drop the flag
LLAMA_WAIT_S="${LLAMA_WAIT_S:-180}"  # model load is slow on CPU (-ngl 0)

# --- gateway (override via env; defaults mirror deploy.sh) ------------------
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-8890}"
VENV="${VENV:-/data/acudx-sim/.venv}"
APP_WAIT_S="${APP_WAIT_S:-30}"

# --- gateway runtime env (passed through to the app process) ---------------
export AIRGAPPED="${AIRGAPPED:-true}"
export LLM_BASE_URL="${LLM_BASE_URL:-http://${LLAMA_HOST}:${LLAMA_PORT}/v1}"
export LLM_MODEL="${LLM_MODEL:-qwen2.5-7b-instruct}"
export EMBED_URL="${EMBED_URL:-http://127.0.0.1:8003}"
export RERANK_URL="${RERANK_URL:-http://127.0.0.1:8004}"

# --- run/log dirs (pidfiles + logs) ----------------------------------------
RUN_DIR="${RUN_DIR:-/data/acudx-sim/run}"
LOG_DIR="${LOG_DIR:-/data/acudx-sim/logs}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-1}"

# --- tiny helpers ----------------------------------------------------------
step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '    \033[1;33mWARN\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

# 0.0.0.0 is a bind wildcard; probe it on loopback.
probe_host() { [[ "$1" == "0.0.0.0" || -z "$1" ]] && echo "127.0.0.1" || echo "$1"; }

# is_up HOST PORT — true if something is accepting TCP there (no extra deps).
is_up() {
  local host port
  host="$(probe_host "$1")"; port="$2"
  timeout "${PROBE_TIMEOUT}" bash -c "exec 3<>/dev/tcp/${host}/${port}" >/dev/null 2>&1
}

# wait_up HOST PORT SECONDS NAME — poll until up or the budget elapses.
wait_up() {
  local host="$1" port="$2" budget="$3" name="$4" i=0
  while (( i < budget )); do
    if is_up "$host" "$port"; then
      info "${name} is accepting connections on $(probe_host "$host"):${port}"
      return 0
    fi
    sleep 1; i=$(( i + 1 ))
  done
  warn "${name} did not come up within ${budget}s (continuing; check ${LOG_DIR})"
  return 1
}

mkdir -p "${RUN_DIR}" "${LOG_DIR}"

step "AcuDx start — src root ${SRC_ROOT}"
info "llama : ${LLAMA_HOST}:${LLAMA_PORT}  model=$(basename "${MODEL_PATH}")"
info "gateway: ${APP_HOST}:${APP_PORT}  AIRGAPPED=${AIRGAPPED}  LLM_BASE_URL=${LLM_BASE_URL}"

# --- 1. llama-server -------------------------------------------------------
if [[ "${GATEWAY_ONLY:-0}" == "1" ]]; then
  step "Skipping llama-server (GATEWAY_ONLY=1)"
elif is_up "${LLAMA_HOST}" "${LLAMA_PORT}"; then
  step "llama-server already up on ${LLAMA_HOST}:${LLAMA_PORT} — leaving it"
else
  step "Starting llama-server"
  [[ -x "${LLAMA_BIN}" ]] || die "llama binary not found or not executable: ${LLAMA_BIN}"
  [[ -f "${MODEL_PATH}" ]] || die "model file not found: ${MODEL_PATH}"
  # shellcheck disable=SC2086  # $JINJA is an intentional optional flag
  nohup "${LLAMA_BIN}" -m "${MODEL_PATH}" \
    --host "${LLAMA_HOST}" --port "${LLAMA_PORT}" \
    -c "${CTX}" -t "${THREADS}" -ngl "${NGL}" ${JINJA} \
    >>"${LOG_DIR}/llama-server.log" 2>&1 &
  echo $! > "${RUN_DIR}/llama-server.pid"
  info "llama-server pid $(cat "${RUN_DIR}/llama-server.pid") (log: ${LOG_DIR}/llama-server.log)"
  wait_up "${LLAMA_HOST}" "${LLAMA_PORT}" "${LLAMA_WAIT_S}" "llama-server" || true
fi

# --- 2. gateway ------------------------------------------------------------
if [[ "${LLAMA_ONLY:-0}" == "1" ]]; then
  step "Skipping gateway (LLAMA_ONLY=1)"
  exit 0
fi

if is_up "${APP_HOST}" "${APP_PORT}"; then
  step "gateway already up on ${APP_HOST}:${APP_PORT} — leaving it"
else
  step "Starting AcuDx gateway"
  if [[ -x "${VENV}/bin/python" ]]; then
    PY="${VENV}/bin/python"
  else
    PY="$(command -v python3 || command -v python)"
    warn "venv python not found at ${VENV}/bin/python; falling back to ${PY}"
  fi
  [[ -n "${PY}" ]] || die "no python interpreter found"
  ( cd "${SRC_ROOT}" && \
    nohup "${PY}" -m uvicorn server.app:app --host "${APP_HOST}" --port "${APP_PORT}" \
      >>"${LOG_DIR}/gateway.log" 2>&1 & \
    echo $! > "${RUN_DIR}/gateway.pid" )
  info "gateway pid $(cat "${RUN_DIR}/gateway.pid") (log: ${LOG_DIR}/gateway.log)"
  wait_up "${APP_HOST}" "${APP_PORT}" "${APP_WAIT_S}" "gateway" || true
fi

step "Done. Smoke-test with:"
info "  ${VENV}/bin/python ${SRC_ROOT}/server/smoke_test.py --base-url http://127.0.0.1:${APP_PORT}"

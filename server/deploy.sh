#!/usr/bin/env bash
#
# deploy.sh — ship the AcuDx gateway (server/) to the GPU pod and (re)build its venv.
#
# What it does (idempotent, additive, NO destructive ops):
#   1. rsync this server/ directory to the pod  (root@10.6.110.10:30405 -> /data/acudx-sim/src/server)
#   2. create the venv if missing, then refresh deps from requirements.txt
#   3. PRINT the launch command — it does NOT start the server (the operator launches it)
#
# It never deletes anything on the pod: rsync runs WITHOUT --delete, so files the
# gateway does not own (a sibling's app.py/config.py, an operator .env, model caches)
# are left untouched. Secrets are never shipped (.env is excluded).
#
# Everything is overridable from the environment; the DEFAULTS match the build brief.
#
#   Usage:
#     ./deploy.sh              # sync + venv refresh, then print launch command
#     DRY_RUN=1 ./deploy.sh    # show what rsync WOULD do; make no remote changes
#     SKIP_VENV=1 ./deploy.sh  # sync only; do not touch the remote venv
#
set -euo pipefail

# --- configuration (override via env) --------------------------------------
SSH_USER="${SSH_USER:-root}"
REMOTE_HOST="${REMOTE_HOST:-10.6.110.10}"
SSH_PORT="${SSH_PORT:-30405}"

REMOTE_BASE="${REMOTE_BASE:-/data/acudx-sim}"
REMOTE_SRC="${REMOTE_SRC:-${REMOTE_BASE}/src}"
REMOTE_SERVER="${REMOTE_SERVER:-${REMOTE_SRC}/server}"
VENV="${VENV:-${REMOTE_BASE}/.venv}"

# Deploy-target defaults surfaced in the printed launch command (see docs/architecture/02).
APP_HOST="${APP_HOST:-0.0.0.0}"
APP_PORT="${APP_PORT:-8890}"
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:3040/v1}"
LLM_MODEL="${LLM_MODEL:-qwen2.5-7b-instruct}"
EMBED_URL="${EMBED_URL:-http://127.0.0.1:8003}"
RERANK_URL="${RERANK_URL:-http://127.0.0.1:8004}"
AIRGAPPED="${AIRGAPPED:-true}"

# The directory this script lives in == the server/ package to ship.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SSH="ssh -p ${SSH_PORT}"
SSH_TARGET="${SSH_USER}@${REMOTE_HOST}"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

# --- 0. summary ------------------------------------------------------------
step "AcuDx gateway deploy"
info "local source : ${SCRIPT_DIR}/"
info "remote target: ${SSH_TARGET}:${REMOTE_SERVER}  (ssh port ${SSH_PORT})"
info "remote venv  : ${VENV}"
info "dry run      : ${DRY_RUN:-0}   skip venv: ${SKIP_VENV:-0}"

# --- 1. preflight: local files + ssh reachability --------------------------
step "Preflight: check local package + pod reachability"
for f in grounding.py guidelines_seed.py requirements.txt; do
  if [[ -f "${SCRIPT_DIR}/${f}" ]]; then
    info "found ${f}"
  else
    info "WARNING: ${SCRIPT_DIR}/${f} is missing (continuing)"
  fi
done

if ${SSH} -o ConnectTimeout=8 -o BatchMode=yes "${SSH_TARGET}" 'echo ok' >/dev/null 2>&1; then
  info "ssh reachable: ${SSH_TARGET}"
else
  info "NOTE: could not verify ssh (key/agent/network). rsync + ssh steps may prompt or fail."
fi

# --- 2. ensure remote directory exists -------------------------------------
step "Ensure remote directory ${REMOTE_SERVER}"
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  info "[dry-run] would: mkdir -p ${REMOTE_SERVER}"
else
  ${SSH} "${SSH_TARGET}" "mkdir -p '${REMOTE_SERVER}'"
  info "ok"
fi

# --- 3. rsync (additive; NO --delete; excludes junk + secrets) -------------
step "rsync server/ -> pod"
RSYNC_FLAGS=(-avz --human-readable --itemize-changes)
[[ "${DRY_RUN:-0}" == "1" ]] && RSYNC_FLAGS+=(--dry-run)
RSYNC_EXCLUDES=(
  --exclude '__pycache__/' --exclude '*.pyc' --exclude '*.pyo'
  --exclude '.venv/' --exclude 'venv/'
  --exclude '.env' --exclude '.env.*'
  --exclude '.DS_Store' --exclude '.pytest_cache/' --exclude '*.egg-info/'
)
# Trailing slash on the source copies the CONTENTS of server/ into REMOTE_SERVER/.
rsync "${RSYNC_FLAGS[@]}" "${RSYNC_EXCLUDES[@]}" \
  -e "ssh -p ${SSH_PORT}" \
  "${SCRIPT_DIR}/" "${SSH_TARGET}:${REMOTE_SERVER}/"
info "rsync complete"

# --- 4. venv create (if missing) + deps refresh ----------------------------
if [[ "${SKIP_VENV:-0}" == "1" ]]; then
  step "Skipping venv (SKIP_VENV=1)"
elif [[ "${DRY_RUN:-0}" == "1" ]]; then
  step "Venv refresh"
  info "[dry-run] would: python3 -m venv ${VENV} (if missing) && pip install -r ${REMOTE_SERVER}/requirements.txt"
else
  step "Create/refresh venv at ${VENV} and install deps"
  # Single remote shell: create venv if absent, upgrade pip, install requirements.
  ${SSH} "${SSH_TARGET}" bash -s <<REMOTE
set -euo pipefail
if [[ ! -d "${VENV}" ]]; then
  echo "    creating venv: ${VENV}"
  python3 -m venv "${VENV}"
else
  echo "    venv exists: ${VENV}"
fi
"${VENV}/bin/python" -m pip install --upgrade pip >/dev/null
if [[ -f "${REMOTE_SERVER}/requirements.txt" ]]; then
  echo "    pip install -r ${REMOTE_SERVER}/requirements.txt"
  "${VENV}/bin/pip" install -r "${REMOTE_SERVER}/requirements.txt"
else
  echo "    NOTE: no requirements.txt on pod; installing baseline runtime deps"
  "${VENV}/bin/pip" install 'fastapi>=0.110,<1.0' 'uvicorn[standard]>=0.27,<1.0' \
    'httpx>=0.27,<1.0' 'pydantic>=2.6,<3.0' 'pydantic-settings>=2.1,<3.0'
fi
echo "    deps ready"
REMOTE
  info "venv ready"
fi

# --- 5. print launch command (do NOT auto-start) ---------------------------
step "Deploy done. Launch the gateway on the pod with:"
cat <<LAUNCH

  ${SSH} ${SSH_TARGET}
  cd ${REMOTE_SRC}
  AIRGAPPED=${AIRGAPPED} \\
  LLM_BASE_URL=${LLM_BASE_URL} LLM_MODEL=${LLM_MODEL} \\
  EMBED_URL=${EMBED_URL} RERANK_URL=${RERANK_URL} \\
  ${VENV}/bin/python -m uvicorn server.app:app --host ${APP_HOST} --port ${APP_PORT}

  # (module entrypoint, if server/app.py exposes one:  ${VENV}/bin/python -m server.app)
  # then smoke-test from the pod or a tunnel:
  #   python3 ${REMOTE_SERVER}/smoke_test.py --base-url http://127.0.0.1:${APP_PORT}

LAUNCH

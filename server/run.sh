#!/usr/bin/env bash
# AcuDx backend gateway — launch on the GPU pod.
# The llama-server (Qwen2.5-7B) and the embed/rerank side-cars are started
# SEPARATELY; this only runs the gateway that calls them.
set -euo pipefail

# Run from the repo root so `server` is an importable package.
cd "$(dirname "$0")/.."

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8890}"

exec uvicorn server.app:app --host "$HOST" --port "$PORT" "$@"

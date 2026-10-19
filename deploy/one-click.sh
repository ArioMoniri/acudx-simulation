#!/usr/bin/env bash
# AcuDx one-click deploy on a fresh Ubuntu host with Docker.
# Usage: DOMAIN=sim.example.edu ./deploy/one-click.sh
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Install Docker first: https://docs.docker.com/engine/install/"; exit 1; }
[ -f .env ] || { cp .env.example .env; sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 24)/" .env; echo "Created .env with a random ADMIN_TOKEN"; }
if [ -n "${DOMAIN:-}" ]; then sed -i "s/^DOMAIN=.*/DOMAIN=${DOMAIN}/" .env; fi
docker compose build
docker compose up -d
echo "AcuDx is starting. Open https://${DOMAIN:-localhost}/ . Admin token is in .env (ADMIN_TOKEN)."

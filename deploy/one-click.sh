#!/usr/bin/env bash
# AcuDx one-click production deploy on a fresh Ubuntu 22.04/24.04 host.
#
#   sudo DOMAIN=sim.example.edu LAMBDA_SSH_KEY_NAME=<lambda ssh key name> ./deploy/one-click.sh
#
# DOMAIN      public name whose A record points at this host. Unset: <public-ip>.sslip.io.
#             Caddy obtains a Let's Encrypt certificate for it on the first request.
# LAMBDA_KEY  Lambda Cloud API key for on-demand GPU workers. Read from /etc/acudx/lambda.key
#             (mode 0600) when present, else from the environment. Never written to git or logs.
#
# What it does (idempotent; secrets are generated once and kept):
#   1. installs Docker when missing;
#   2. writes root-only secrets under /etc/acudx (gateway admin token, registry sealing key,
#      Keycloak admin and database passwords);
#   3. renders the production Keycloak realm for https://$DOMAIN and starts the stack
#      (docker-compose.prod.yml: Caddy+web, gateway, relay, Keycloak, Postgres);
#   4. first run only: provisions one account per role with random temporary passwords
#      (root-only /var/lib/acudx/bootstrap/credentials.json), registers Keycloak as the
#      gateway identity provider, and mints a single-use 72 h retrieval code for
#      https://$DOMAIN/bootstrap/credentials (saved to /root/acudx-retrieval-code.txt).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
umask 077

ETC=/etc/acudx
STATE=/var/lib/acudx
COMPOSE=(docker compose --env-file "$ETC/compose.env" -f "$REPO/docker-compose.prod.yml")
# Host-local overrides (resource limits, extra mounts) live outside git, next to the secrets.
[ -f "$ETC/compose.override.yml" ] && COMPOSE+=(-f "$ETC/compose.override.yml")

log() { printf '[one-click] %s\n' "$*"; }
rand_hex() { openssl rand -hex "$1"; }
rand_pw() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

# --- 1. Docker ------------------------------------------------------------------------------ #
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  log "installing Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 || apt-get install -y -q docker.io docker-compose-plugin
  systemctl enable --now docker
fi

# --- 2. Domain + secrets -------------------------------------------------------------------- #
install -d -m 700 "$ETC" "$STATE" "$STATE/bootstrap"
install -d -m 755 "$STATE/keycloak-import"
if [ -z "${DOMAIN:-}" ] && [ -f "$ETC/compose.env" ]; then DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ETC/compose.env")"; fi
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
  DOMAIN="${IP}.sslip.io"
fi
printf 'DOMAIN=%s\n' "$DOMAIN" > "$ETC/compose.env"
log "domain: $DOMAIN"

if [ ! -f "$ETC/keycloak.env" ]; then
  KC_DB_PW="$(rand_pw 40)"
  printf 'KC_BOOTSTRAP_ADMIN_PASSWORD=%s\nKC_DB_PASSWORD=%s\n' "$(rand_pw 40)" "$KC_DB_PW" > "$ETC/keycloak.env"
  printf 'POSTGRES_PASSWORD=%s\n' "$KC_DB_PW" > "$ETC/keycloak-db.env"
  unset KC_DB_PW
  log "generated Keycloak admin and database passwords ($ETC/keycloak.env)"
fi

if [ -z "${LAMBDA_KEY:-}" ] && [ -f "$ETC/lambda.key" ]; then LAMBDA_KEY="$(cat "$ETC/lambda.key")"; fi
if [ ! -f "$ETC/gateway.env" ]; then
  {
    printf 'ADMIN_TOKEN=%s\n' "$(rand_hex 32)"
    # Fernet key: 32 random bytes, url-safe base64.
    printf 'ACUDX_SECRET_KEY=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_')"
  } > "$ETC/gateway.env"
  log "generated ADMIN_TOKEN and ACUDX_SECRET_KEY ($ETC/gateway.env)"
fi
# Settings that may change between deploys are rewritten in place (secrets above are kept).
python3 - "$ETC/gateway.env" <<'PY'
import os, sys
path = sys.argv[1]
keep = [l for l in open(path).read().splitlines()
        if l.split("=", 1)[0] not in {"LAMBDA_KEY", "LAMBDA_SSH_KEY_NAME", "GPU_IDLE_MINUTES", "GPU_DAILY_BUDGET_USD"}]
old = {l.split("=", 1)[0]: l.split("=", 1)[1] for l in open(path).read().splitlines() if "=" in l}
key = os.environ.get("LAMBDA_KEY") or old.get("LAMBDA_KEY", "")
ssh = os.environ.get("LAMBDA_SSH_KEY_NAME") or old.get("LAMBDA_SSH_KEY_NAME", "")
idle = os.environ.get("GPU_IDLE_MINUTES") or old.get("GPU_IDLE_MINUTES", "20")
if key: keep.append(f"LAMBDA_KEY={key}")
if ssh: keep.append(f"LAMBDA_SSH_KEY_NAME={ssh}")
keep.append(f"GPU_IDLE_MINUTES={idle}")
fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as fh:
    fh.write("\n".join(keep) + "\n")
os.replace(path + ".tmp", path)
PY
unset LAMBDA_KEY
if grep -q '^LAMBDA_KEY=.' "$ETC/gateway.env"; then
  log "LAMBDA_KEY present: GPU workers launch on demand"
else
  log "LAMBDA_KEY missing: GPU workers cannot launch until it is added to $ETC/gateway.env"
fi
chmod 600 "$ETC"/*.env

# --- 3. Realm + stack ----------------------------------------------------------------------- #
python3 "$REPO/deploy/keycloak/render-prod-realm.py" --domain "$DOMAIN" --out "$STATE/keycloak-import/realm-acudx.json"
log "building and starting the stack"
"${COMPOSE[@]}" up -d --build

log "waiting for Keycloak and the gateway"
for _ in $(seq 1 120); do
  if "${COMPOSE[@]}" exec -T server python -c "import urllib.request as u; u.urlopen('http://keycloak:8080/idp/realms/acudx', timeout=3); u.urlopen('http://127.0.0.1:8890/health', timeout=3)" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

# --- 4. Identity provider (every run: follows a DOMAIN change) + accounts and code (first run) - #
ACCOUNTS=(--no-accounts)
FIRST=0
if [ ! -f "$STATE/bootstrap/credentials.json" ]; then
  ACCOUNTS=(--login-url "https://$DOMAIN/signin")
  FIRST=1
  log "provisioning one account per role"
fi
sed -n 's/^KC_BOOTSTRAP_ADMIN_PASSWORD=//p' "$ETC/keycloak.env" | "${COMPOSE[@]}" exec -T server \
  python -m server.bootstrap.provision --keycloak http://keycloak:8080/idp --admin-password-stdin \
  --sync-client-origin "https://$DOMAIN" --register-idp "https://$DOMAIN/idp/realms/acudx" "${ACCOUNTS[@]}"
if [ "$FIRST" = 1 ]; then
  "$REPO/deploy/rotate-bootstrap-code.sh"
else
  log "accounts already provisioned; mint a new retrieval code with deploy/rotate-bootstrap-code.sh"
fi

log "done: https://$DOMAIN/"
log "admin token: $ETC/gateway.env (ADMIN_TOKEN); retrieval code: /root/acudx-retrieval-code.txt"

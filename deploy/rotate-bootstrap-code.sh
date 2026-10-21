#!/usr/bin/env bash
# Mint a new single-use retrieval code for https://<domain>/bootstrap/credentials (server only).
#
#   ssh <host> sudo /opt/acudx/deploy/rotate-bootstrap-code.sh [--reset-passwords] [--ttl-hours 72]
#
# --reset-passwords  first give every role account a fresh random TEMPORARY password in Keycloak
#                    (UPDATE_PASSWORD on next sign-in) and rewrite credentials.json, so the person
#                    receiving the code gets untouched accounts.
# The previous code stops working. The new code is printed once and saved to
# /root/acudx-retrieval-code.txt (0600). Passwords are never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
umask 077
ETC=/etc/acudx
COMPOSE=(docker compose --env-file "$ETC/compose.env" -f "$REPO/docker-compose.prod.yml")
# Host-local overrides (resource limits, extra mounts) live outside git, next to the secrets.
[ -f "$ETC/compose.override.yml" ] && COMPOSE+=(-f "$ETC/compose.override.yml")
RESET=0
TTL=72
while [ $# -gt 0 ]; do
  case "$1" in
    --reset-passwords) RESET=1 ;;
    --ttl-hours) TTL="$2"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
DOMAIN="$(sed -n 's/^DOMAIN=//p' "$ETC/compose.env")"

if [ "$RESET" = 1 ]; then
  sed -n 's/^KC_BOOTSTRAP_ADMIN_PASSWORD=//p' "$ETC/keycloak.env" | "${COMPOSE[@]}" exec -T server \
    python -m server.bootstrap.provision --keycloak http://keycloak:8080/idp --admin-password-stdin \
    --login-url "https://$DOMAIN/signin"
fi

CODE="$("${COMPOSE[@]}" exec -T server python -m server.bootstrap.mint --ttl-hours "$TTL" --actor rotate-script)"
printf '%s\n' "$CODE" > /root/acudx-retrieval-code.txt
chmod 600 /root/acudx-retrieval-code.txt
echo "retrieval URL : https://$DOMAIN/bootstrap/credentials"
echo "retrieval code: $CODE (single use, expires in ${TTL} h; saved to /root/acudx-retrieval-code.txt)"

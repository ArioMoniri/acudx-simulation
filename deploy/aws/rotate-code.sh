#!/usr/bin/env bash
# Operator side: mint a new single-use retrieval code (optionally after giving every account a
# fresh temporary password) and refresh its SSM copy.
#
#   deploy/aws/rotate-code.sh [--reset-passwords] [--ttl-hours 72] [--ssh]
#
# Default (--https): calls /bootstrap/operator/reset-accounts and /bootstrap/operator/mint-code
# with the operator token ($OPERATOR_TOKEN_FILE, else SSM $SSM_PREFIX/operator_token). No SSH.
# --ssh: runs deploy/rotate-bootstrap-code.sh on the host instead (humans with SSH access).
# The code is printed once; passwords never are.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/aws/lib.sh
. "$HERE/lib.sh"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
STORE_SECRETS_IN_SSM="${STORE_SECRETS_IN_SSM:-1}"
RESET=0
TTL=72
MODE=https
while [ $# -gt 0 ]; do
  case "$1" in
    --reset-passwords) RESET=1 ;;
    --ttl-hours) TTL="$2"; shift ;;
    --https) MODE=https ;;
    --ssh) MODE=ssh ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
case "$TTL" in ''|*[!0-9]*) die "--ttl-hours takes a whole number of hours" ;; esac
EIP="$(aws_none "$(aws_do 198.51.100.10 ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" \
  --query 'Addresses[0].PublicIp' --output text)")"
[ -n "$EIP" ] || die "no Elastic IP tagged $NAME in $AWS_REGION"
BASE="https://${DOMAIN:-$EIP.sslip.io}"
if [ "$DRY_RUN" = 1 ]; then
  log "DRY-RUN would ($MODE): reset=$RESET, mint a code (ttl ${TTL} h) on $BASE"
  exit 0
fi

if [ "$MODE" = ssh ]; then
  ARGS=(--ttl-hours "$TTL")
  [ "$RESET" = 1 ] && ARGS+=(--reset-passwords)
  ssh -i "$KEY_DIR/$KEY_NAME.pem" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$EIP" \
    "sudo /opt/acudx/deploy/rotate-bootstrap-code.sh ${ARGS[*]}"
  CODE="$(ssh -i "$KEY_DIR/$KEY_NAME.pem" -o ConnectTimeout=10 "ubuntu@$EIP" 'sudo head -n1 /root/acudx-retrieval-code.txt')"
else
  if [ "$RESET" = 1 ]; then
    op_post "$BASE" /bootstrap/operator/reset-accounts | python3 -c \
      'import json,sys; d=json.load(sys.stdin); print("reset:", ", ".join(a["username"] for a in d["accounts"]))'
  fi
  CODE="$(op_post "$BASE" /bootstrap/operator/mint-code "{\"ttl_hours\": $TTL}" | json_field code)"
fi
[ -n "$CODE" ] || die "no code returned"
if [ "$STORE_SECRETS_IN_SSM" = 1 ]; then
  put_secure "$SSM_PREFIX/retrieval_code" "$CODE"
  log "updated $SSM_PREFIX/retrieval_code"
fi
echo "retrieval URL : $BASE/bootstrap/credentials"
echo "retrieval code: $CODE (single use, ${TTL} h)"

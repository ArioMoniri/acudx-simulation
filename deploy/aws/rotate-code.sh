#!/usr/bin/env bash
# Operator side: mint a new single-use retrieval code on the EC2 host over SSH and (optionally)
# refresh its SSM SecureString copy with the operator's credentials.
#
#   deploy/aws/rotate-code.sh [--reset-passwords] [--ttl-hours 72]
#
# Options are passed to deploy/rotate-bootstrap-code.sh on the host. The code is printed once.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/aws/lib.sh
. "$HERE/lib.sh"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
STORE_SECRETS_IN_SSM="${STORE_SECRETS_IN_SSM:-1}"
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --reset-passwords) ARGS+=("$1") ;;
    --ttl-hours) ARGS+=("$1" "$2"); shift ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
EIP="$(aws_none "$(aws_do 198.51.100.10 ec2 describe-addresses --filters "Name=tag:Name,Values=$NAME" \
  --query 'Addresses[0].PublicIp' --output text)")"
[ -n "$EIP" ] || die "no Elastic IP tagged $NAME in $AWS_REGION"
SSH=(ssh -i "$KEY_DIR/$KEY_NAME.pem" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$EIP")
if [ "$DRY_RUN" = 1 ]; then
  log "DRY-RUN would run: sudo /opt/acudx/deploy/rotate-bootstrap-code.sh ${ARGS[*]:-} on $EIP"
  exit 0
fi
"${SSH[@]}" "sudo /opt/acudx/deploy/rotate-bootstrap-code.sh ${ARGS[*]:-}"
if [ "$STORE_SECRETS_IN_SSM" = 1 ]; then
  CODE="$("${SSH[@]}" 'sudo head -n1 /root/acudx-retrieval-code.txt')"
  put_secure "$SSM_PREFIX/retrieval_code" "$CODE"
  unset CODE
  log "updated $SSM_PREFIX/retrieval_code"
fi

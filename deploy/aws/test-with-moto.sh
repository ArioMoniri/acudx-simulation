#!/usr/bin/env bash
# Offline test of provision.sh, rotate-code.sh and teardown.sh against a local moto server.
#
#   python3 -m venv /tmp/moto && /tmp/moto/bin/pip install "moto[server]"
#   MOTO_SERVER=/tmp/moto/bin/moto_server deploy/aws/test-with-moto.sh
#
# Checks: two provision runs leave exactly one instance / EIP / security group (idempotent),
# IMDSv2 required, no instance profile, 50 GB encrypted gp3, 0600 key file, ingress 22 from
# SSH_CIDR only, teardown removes everything and is itself idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MOTO_SERVER="${MOTO_SERVER:-moto_server}"
PORT="${MOTO_PORT:-5055}"
WORK="$(mktemp -d)"
"$MOTO_SERVER" -p "$PORT" > "$WORK/moto.log" 2>&1 &
MOTO=$!
trap 'kill $MOTO; rm -rf "$WORK"' EXIT
sleep 3
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy LAMBDA_KEY
export AWS_ENDPOINT_URL="http://127.0.0.1:$PORT" AWS_ACCESS_KEY_ID=testing AWS_SECRET_ACCESS_KEY=testing
export AWS_REGION=eu-central-1 AWS_DEFAULT_REGION=eu-central-1
export SSH_CIDR=203.0.113.4/32 KEY_DIR="$WORK/keys" SKIP_REMOTE=1 NAME=acudx-web-prod
AMI_ID="$(aws ec2 describe-images --owners amazon --query 'Images[0].ImageId' --output text)"
export AMI_ID
fail() { echo "FAIL: $*"; exit 1; }
q() { aws "$@" --output text; }

"$HERE/provision.sh" > "$WORK/run1.log" 2>&1 || { cat "$WORK/run1.log"; fail "first provision"; }
"$HERE/provision.sh" > "$WORK/run2.log" 2>&1 || { cat "$WORK/run2.log"; fail "second provision"; }
grep -q "reusing instance" "$WORK/run2.log" || fail "second run did not reuse the instance"
F=(--filters "Name=tag:Name,Values=acudx-web-prod" "Name=instance-state-name,Values=running")
[ "$(q ec2 describe-instances "${F[@]}" --query 'length(Reservations[].Instances[])')" = 1 ] || fail "instance count"
[ "$(q ec2 describe-addresses --query 'length(Addresses)')" = 1 ] || fail "EIP count"
[ "$(q ec2 describe-instances "${F[@]}" --query 'Reservations[0].Instances[0].MetadataOptions.HttpTokens')" = required ] || fail "IMDSv2"
[ "$(q ec2 describe-instances "${F[@]}" --query 'Reservations[0].Instances[0].IamInstanceProfile')" = None ] || fail "instance profile present"
[ "$(q ec2 describe-volumes --query 'Volumes[0].[Size,VolumeType,Encrypted]' | tr '\t' ' ')" = "50 gp3 True" ] || fail "root volume"
[ "$(stat -c %a "$WORK/keys/acudx-web-prod-key.pem")" = 600 ] || fail "key file mode"
# shellcheck disable=SC2016  # backticks are a JMESPath literal, not a shell expansion
SSH_SRC="$(q ec2 describe-security-groups --filters Name=group-name,Values=acudx-web-prod-sg \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp')"
[ "$SSH_SRC" = 203.0.113.4/32 ] || fail "ssh ingress $SSH_SRC"
DRY_RUN=1 "$HERE/rotate-code.sh" --reset-passwords > "$WORK/rotate.log" 2>&1 || fail "rotate dry run"
aws ssm put-parameter --name /acudx/acudx-web-prod/admin_token --type SecureString --value x >/dev/null
CONFIRM=acudx-web-prod "$HERE/teardown.sh" > "$WORK/down1.log" 2>&1 || { cat "$WORK/down1.log"; fail "teardown"; }
[ "$(q ec2 describe-instances "${F[@]}" --query 'length(Reservations[].Instances[])')" = 0 ] || fail "instance left"
[ "$(q ec2 describe-addresses --query 'length(Addresses)')" = 0 ] || fail "EIP left"
[ "$(q ec2 describe-key-pairs --query 'length(KeyPairs)')" = 0 ] || fail "key pair left"
[ "$(q ssm get-parameters-by-path --path /acudx/acudx-web-prod --query 'length(Parameters)')" = 0 ] || fail "parameters left"
CONFIRM=acudx-web-prod "$HERE/teardown.sh" > "$WORK/down2.log" 2>&1 || fail "second teardown"
echo "PASS: provision x2 (idempotent), rotate dry run, teardown x2"

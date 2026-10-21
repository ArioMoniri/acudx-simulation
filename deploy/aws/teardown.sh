#!/usr/bin/env bash
# Remove the AcuDx web host created by deploy/aws/provision.sh (only resources tagged
# Name=$NAME and acudx:stack=$NAME, plus the named key pair and the SSM prefix).
#
#   CONFIRM=$NAME deploy/aws/teardown.sh          # really delete
#   DRY_RUN=1 deploy/aws/teardown.sh              # print the calls only
#
# Environment: NAME, AWS_REGION (default eu-central-1), KEEP_SECRETS=1 (keep the SSM
# parameters), KEEP_KEY=1 (keep the EC2 key pair).
# Before terminating, any on-demand GPU worker the gateway runs on Lambda is stopped through
# the gateway's admin API (best effort, over SSH), so no GPU instance is left billing.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/aws/lib.sh
. "$HERE/lib.sh"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
if [ "$DRY_RUN" != 1 ] && [ "${CONFIRM:-}" != "$NAME" ]; then
  die "set CONFIRM=$NAME to delete the stack (or DRY_RUN=1 to preview)"
fi

INSTANCE_IDS="$(aws_none "$(aws_do i-dryrun ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
  "Name=tag:$STACK_TAG_KEY,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)")"
read -r ALLOC_ID EIP <<<"$(aws_do "eipalloc-dryrun 198.51.100.10" ec2 describe-addresses \
  --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].[AllocationId,PublicIp]' --output text)"
ALLOC_ID="$(aws_none "${ALLOC_ID:-}")"

# Stop the gateway's GPU worker first (it lives on Lambda, outside this AWS stack).
if [ -n "$INSTANCE_IDS" ] && [ -n "${EIP:-}" ] && [ -f "$KEY_DIR/$KEY_NAME.pem" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY-RUN would POST /admin/gpu/stop on the gateway at $EIP"
  else
    if ssh -i "$KEY_DIR/$KEY_NAME.pem" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$EIP" \
      "cd /opt/acudx && sudo docker compose --env-file /etc/acudx/compose.env -f docker-compose.prod.yml exec -T server \
       sh -c 'curl -fsS -X POST -H \"X-Admin-Token: \$ADMIN_TOKEN\" http://127.0.0.1:8890/admin/gpu/stop'"; then
      log "GPU worker stop requested"
    else
      log "could not reach the gateway to stop a GPU worker: check Lambda by hand"
    fi
  fi
fi

if [ -n "$INSTANCE_IDS" ]; then
  # shellcheck disable=SC2086  # word splitting of the id list is intended
  aws_do "" ec2 terminate-instances --instance-ids $INSTANCE_IDS --query 'TerminatingInstances[].InstanceId' --output text >/dev/null
  # shellcheck disable=SC2086
  aws_do "" ec2 wait instance-terminated --instance-ids $INSTANCE_IDS
  log "terminated $INSTANCE_IDS"
fi
if [ -n "$ALLOC_ID" ]; then
  aws_do "" ec2 release-address --allocation-id "$ALLOC_ID"
  log "released Elastic IP $EIP"
fi
SG_ID="$(aws_none "$(aws_do sg-dryrun ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
  "Name=tag:$STACK_TAG_KEY,Values=$NAME" --query 'SecurityGroups[0].GroupId' --output text)")"
if [ -n "$SG_ID" ]; then
  aws_do "" ec2 delete-security-group --group-id "$SG_ID"
  log "deleted security group $SG_ID"
fi
if [ "${KEEP_KEY:-0}" != 1 ]; then
  aws_do "" ec2 delete-key-pair --key-name "$KEY_NAME"
  log "deleted key pair $KEY_NAME (local $KEY_DIR/$KEY_NAME.pem kept)"
fi
if [ "${KEEP_SECRETS:-0}" != 1 ]; then
  NAMES="$(aws_none "$(aws_do "$SSM_PREFIX/admin_token" ssm get-parameters-by-path --path "$SSM_PREFIX" --recursive \
    --query 'Parameters[].Name' --output text)")"
  if [ -n "$NAMES" ]; then
    # shellcheck disable=SC2086
    aws_do "" ssm delete-parameters --names $NAMES --query 'DeletedParameters' --output text >/dev/null
    log "deleted SSM parameters under $SSM_PREFIX"
  fi
fi
log "teardown of $NAME done"

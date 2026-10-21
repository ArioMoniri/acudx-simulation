#!/usr/bin/env bash
# Create (or reuse) the AcuDx web host on AWS EC2 and deploy it WITHOUT SSH: everything goes
# through EC2 user-data, the EC2 API and HTTPS. Idempotent. See deploy/aws/README.md.
#
#   [LAMBDA_KEY=...] [ANTHROPIC_KEY=...] deploy/aws/provision.sh
#
# Flow: security group (80/443; 22 only when SSH_CIDR is set) -> key pair (optional human SSH)
# -> Elastic IP (so the domain <eip>.sslip.io is known before launch) -> instance with cloud-init
# that clones the public repository at BRANCH/COMMIT and runs deploy/one-click.sh -> wait on the
# EC2 console output and https://<domain>/bootstrap/status -> POST /bootstrap/provision once with
# the one-time PROVISION_TOKEN and the API keys -> keep the operator token it returns -> mint the
# single-use retrieval code through /bootstrap/operator/mint-code.
#
# The instance has no instance profile and no AWS credentials. Secrets are generated on the
# instance and stay root-only there. This script (operator side) keeps the operator token and
# the retrieval code in $KEY_DIR (0600) and, unless STORE_SECRETS_IN_SSM=0, in SSM SecureString.
#
# Environment
#   AWS_REGION      default eu-central-1. A long-term key (AKIA...) drops AWS_SESSION_TOKEN.
#   NAME            default acudx-web-prod.
#   INSTANCE_TYPE   default t3.large (x86_64); t4g.large (arm64) also works.
#   VOLUME_GB       default 50 (gp3, encrypted).
#   DOMAIN          custom domain whose A record points at the Elastic IP; default <eip>.sslip.io.
#   REPO_URL        default https://github.com/ArioMoniri/acudx-simulation.git (public).
#   BRANCH          default claude/clever-mendel-dtbc1n.
#   COMMIT          commit to deploy (must be on BRANCH); default: the branch head at boot.
#   LAMBDA_KEY      Lambda Cloud key for on-demand GPU workers, sent once over HTTPS.
#   ANTHROPIC_KEY   optional Claude key, sent once over HTTPS (sealed in the gateway registry).
#   LAMBDA_SSH_KEY_NAME  Lambda ssh key name for GPU workers (default acudx-web-prod-key).
#   SSH_CIDR        optional: open 22 from this CIDR for humans (the scripts never use SSH).
#   KEY_DIR         operator-side secrets directory (default ~/.ssh): EC2 key, provision and
#                   operator tokens, all 0600.
#   WAIT_MINUTES    default 50: how long to wait for the stack to come up.
#   STORE_SECRETS_IN_SSM  1 (default) or 0.
#   AMI_ID          override the Ubuntu 24.04 AMI lookup.
#   DRY_RUN=1       print every AWS call instead of sending it (no credentials needed).
#   EC2_DRY_RUN=1   send RunInstances with --dry-run (permission check only).
#   SKIP_REMOTE=1   create the AWS resources only; no waiting, no HTTPS steps (tests).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/aws/lib.sh
. "$HERE/lib.sh"

SSH_CIDR="${SSH_CIDR:-}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"
VOLUME_GB="${VOLUME_GB:-50}"
DOMAIN="${DOMAIN:-}"
REPO_URL="${REPO_URL:-https://github.com/ArioMoniri/acudx-simulation.git}"
BRANCH="${BRANCH:-claude/clever-mendel-dtbc1n}"
COMMIT="${COMMIT:-none}"
LAMBDA_SSH_KEY_NAME="${LAMBDA_SSH_KEY_NAME:-acudx-web-prod-key}"
STORE_SECRETS_IN_SSM="${STORE_SECRETS_IN_SSM:-1}"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
WAIT_MINUTES="${WAIT_MINUTES:-50}"
EC2_DRY_RUN="${EC2_DRY_RUN:-0}"
PROVISION_TOKEN_FILE="$KEY_DIR/$NAME-provision.token"
# A dry run never leaves a token file behind.
[ "$DRY_RUN" = 1 ] && PROVISION_TOKEN_FILE="$(mktemp)" && trap 'rm -f "$PROVISION_TOKEN_FILE"' EXIT
if [ -n "$SSH_CIDR" ]; then case "$SSH_CIDR" in */*) ;; *) die "SSH_CIDR must be a CIDR such as 203.0.113.4/32" ;; esac; fi
case "$BRANCH$COMMIT" in *[!A-Za-z0-9._/-]*) die "BRANCH and COMMIT may only use [A-Za-z0-9._/-]" ;; esac
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

ACCOUNT="$(aws_do 123456789012 sts get-caller-identity --query Account --output text)"
log "account $ACCOUNT, region $AWS_REGION, stack $NAME"

# --- security group (default VPC) ----------------------------------------------------------- #
VPC_ID="$(aws_none "$(aws_do vpc-dryrun ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)")"
[ -n "$VPC_ID" ] || die "no default VPC in $AWS_REGION"
SG_ID="$(aws_none "$(aws_do "" ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
  "Name=vpc-id,Values=$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text)")"
if [ -z "$SG_ID" ]; then
  SG_ID="$(aws_do sg-dryrun ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "AcuDx web host: 80/443 public, 22 only from an operator CIDR if given" \
    --tag-specifications "$(tag_spec security-group)" --query GroupId --output text)"
  log "created security group $SG_ID"
fi
authorize() { # authorize PORT CIDR [ipv6]
  local perm out
  if [ "${3:-}" = ipv6 ]; then
    perm="IpProtocol=tcp,FromPort=$1,ToPort=$1,Ipv6Ranges=[{CidrIpv6=$2}]"
  else
    perm="IpProtocol=tcp,FromPort=$1,ToPort=$1,IpRanges=[{CidrIp=$2}]"
  fi
  if ! out="$(aws_do "" ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions "$perm" 2>&1)"; then
    case "$out" in *InvalidPermission.Duplicate*) ;; *) die "authorize $1 $2: $out" ;; esac
  fi
}
[ -n "$SSH_CIDR" ] && authorize 22 "$SSH_CIDR"
authorize 80 0.0.0.0/0
authorize 443 0.0.0.0/0
authorize 80 ::/0 ipv6
authorize 443 ::/0 ipv6

# --- key pair (only for optional human SSH) -------------------------------------------------- #
KEY_FILE="$KEY_DIR/$KEY_NAME.pem"
if [ -z "$(aws_none "$(aws_do "" ec2 describe-key-pairs --filters "Name=key-name,Values=$KEY_NAME" \
    --query 'KeyPairs[0].KeyName' --output text)")" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    aws_do "" ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
      --tag-specifications "$(tag_spec key-pair)" --query KeyMaterial --output text >/dev/null
  else
    ( umask 077; aws ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
        --tag-specifications "$(tag_spec key-pair)" --query KeyMaterial --output text > "$KEY_FILE" )
    chmod 600 "$KEY_FILE"
    log "created key pair $KEY_NAME ($KEY_FILE), for optional human SSH only"
  fi
fi

# --- Elastic IP first: the domain must be known before launch -------------------------------- #
read -r ALLOC_ID EIP <<<"$(aws_do "None None" ec2 describe-addresses \
  --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].[AllocationId,PublicIp]' --output text)"
ALLOC_ID="$(aws_none "${ALLOC_ID:-}")"
if [ -z "$ALLOC_ID" ]; then
  read -r ALLOC_ID EIP <<<"$(aws_do "eipalloc-dryrun 198.51.100.10" ec2 allocate-address --domain vpc \
    --tag-specifications "$(tag_spec elastic-ip)" --query '[AllocationId,PublicIp]' --output text)"
  log "allocated Elastic IP $EIP ($ALLOC_ID)"
fi
DOMAIN="${DOMAIN:-$EIP.sslip.io}"
BASE="https://$DOMAIN"
log "domain $DOMAIN"

# --- AMI ----------------------------------------------------------------------------------- #
ARCH="$(aws_do x86_64 ec2 describe-instance-types --instance-types "$INSTANCE_TYPE" \
  --query 'InstanceTypes[0].ProcessorInfo.SupportedArchitectures[0]' --output text)"
case "$ARCH" in arm64) AMI_ARCH=arm64 ;; x86_64) AMI_ARCH=amd64 ;; *) die "unsupported architecture $ARCH" ;; esac
AMI_ID="${AMI_ID:-$(aws_do ami-dryrun ssm get-parameters --names \
  "/aws/service/canonical/ubuntu/server/24.04/stable/current/$AMI_ARCH/hvm/ebs-gp3/ami-id" \
  --query 'Parameters[0].Value' --output text)}"
AMI_ID="$(aws_none "$AMI_ID")"
[ -n "$AMI_ID" ] || die "Ubuntu 24.04 $AMI_ARCH AMI not found (set AMI_ID)"

# --- instance ------------------------------------------------------------------------------ #
INSTANCE_ID="$(aws_none "$(aws_do "" ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" \
  "Name=tag:$STACK_TAG_KEY,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)")"
if [ -z "$INSTANCE_ID" ]; then
  # A fresh one-time PROVISION_TOKEN per launch, kept 0600 here until it has been used.
  ( umask 077; python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$PROVISION_TOKEN_FILE" )
  USER_DATA="$(mktemp)"
  chmod 600 "$USER_DATA"
  sed -e "s|__NAME__|$NAME|g" -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__LAMBDA_SSH_KEY_NAME__|$LAMBDA_SSH_KEY_NAME|g" \
    -e "s|__REPO_URL__|$REPO_URL|g" -e "s|__BRANCH__|$BRANCH|g" -e "s|__COMMIT__|$COMMIT|g" \
    -e "s|__PROVISION_TOKEN__|$(cat "$PROVISION_TOKEN_FILE")|g" "$HERE/cloud-init.yaml.tpl" > "$USER_DATA"
  if grep -q '__[A-Z_]*__' "$USER_DATA"; then die "unfilled double-underscore marker in cloud-init"; fi
  if [ "$EC2_DRY_RUN" = 1 ]; then
    out="$(aws ec2 run-instances --dry-run --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
      --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
      --metadata-options "HttpTokens=required,HttpEndpoint=enabled" --user-data "file://$USER_DATA" 2>&1 || true)"
    rm -f "$USER_DATA" "$PROVISION_TOKEN_FILE"
    case "$out" in *DryRunOperation*) log "EC2_DRY_RUN: RunInstances would succeed"; exit 0 ;;
      *) die "EC2_DRY_RUN: RunInstances would fail: $out" ;; esac
  fi
  INSTANCE_ID="$(aws_do i-dryrun ec2 run-instances --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true,Encrypted=true}" \
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1" \
    --tag-specifications "$(tag_spec instance)" "$(tag_spec volume)" \
    --user-data "file://$USER_DATA" --query 'Instances[0].InstanceId' --output text)"
  rm -f "$USER_DATA"
  log "launched $INSTANCE_ID ($INSTANCE_TYPE, $AMI_ID, $BRANCH ${COMMIT/none/head})"
else
  log "reusing instance $INSTANCE_ID (user-data is only read at first boot)"
fi
aws_do "" ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws_do "" ec2 associate-address --allocation-id "$ALLOC_ID" --instance-id "$INSTANCE_ID" \
  --allow-reassociation --query AssociationId --output text >/dev/null

summary() {
  local ssm=""
  [ "$STORE_SECRETS_IN_SSM" = 1 ] && ssm=" (and SSM $SSM_PREFIX/operator_token)"
  cat <<EOF
AcuDx web host
  instance   : $INSTANCE_ID ($INSTANCE_TYPE, $AWS_REGION)
  public ip  : $EIP ($ALLOC_ID)
  url        : $BASE/
  status     : $BASE/bootstrap/status
  handoff    : $BASE/bootstrap/credentials
  operator   : $OPERATOR_TOKEN_FILE$ssm
EOF
}
if [ "${SKIP_REMOTE:-0}" = 1 ] || [ "$DRY_RUN" = 1 ]; then
  [ "$DRY_RUN" = 1 ] && log "DRY-RUN would: wait for $BASE/bootstrap/status, POST /bootstrap/provision, mint the code"
  summary
  exit 0
fi

# --- wait for the stack (EC2 console + HTTPS status) ----------------------------------------- #
log "waiting up to $WAIT_MINUTES min for the stack (cloud-init, image builds, Keycloak first start)"
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
last=""
ready=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  st="$(curl -fsS --max-time 15 "$BASE/bootstrap/status" 2>/dev/null || true)"
  stage_now="$(printf '%s' "$st" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("deploy",{}).get("stage",""))
except Exception: print("")' 2>/dev/null || true)"
  if [ -z "$stage_now" ]; then
    stage_now="$(aws ec2 get-console-output --instance-id "$INSTANCE_ID" --latest --output text 2>/dev/null \
      | grep -o 'ACUDX-STAGE: .*' | tail -n1 || true)"
  fi
  if [ -n "$stage_now" ] && [ "$stage_now" != "$last" ]; then log "progress: $stage_now"; last="$stage_now"; fi
  case "$stage_now" in
    ready) ready=1; break ;;
    *failed*) die "deploy failed on the host: $stage_now (EC2 console output has the tail of the log)" ;;
  esac
  sleep 20
done
[ "$ready" = 1 ] || die "the stack did not report ready within $WAIT_MINUTES min; last stage: ${last:-none}"

# --- keys over HTTPS, once ------------------------------------------------------------------- #
pstate="$(curl -fsS "$BASE/bootstrap/status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["provision_token"])')"
if [ "$pstate" = active ]; then
  [ -s "$PROVISION_TOKEN_FILE" ] || die "the host waits for its PROVISION_TOKEN but $PROVISION_TOKEN_FILE is missing"
  BODY="$(mktemp)"; RESP="$(mktemp)"
  chmod 600 "$BODY" "$RESP"
  PROVISION_TOKEN="$(cat "$PROVISION_TOKEN_FILE")" python3 - > "$BODY" <<'PY'
import json, os
body = {"token": os.environ["PROVISION_TOKEN"]}
for k, env in (("lambda_key", "LAMBDA_KEY"), ("anthropic_key", "ANTHROPIC_KEY")):
    if os.environ.get(env):
        body[k] = os.environ[env]
print(json.dumps(body))
PY
  curl -fsS --max-time 60 -H 'content-type: application/json' --data-binary "@$BODY" "$BASE/bootstrap/provision" > "$RESP" \
    || { rm -f "$BODY" "$RESP"; die "POST /bootstrap/provision failed"; }
  rm -f "$BODY"
  ( umask 077; json_field operator_token < "$RESP" > "$OPERATOR_TOKEN_FILE" )
  log "keys applied: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["applied"])' "$RESP")"
  rm -f "$RESP" "$PROVISION_TOKEN_FILE"
  if [ "$STORE_SECRETS_IN_SSM" = 1 ]; then
    put_secure "$SSM_PREFIX/operator_token" "$(cat "$OPERATOR_TOKEN_FILE")"
    [ -n "${LAMBDA_KEY:-}" ] && put_secure "$SSM_PREFIX/lambda_key" "$LAMBDA_KEY"
    [ -n "${ANTHROPIC_KEY:-}" ] && put_secure "$SSM_PREFIX/anthropic_key" "$ANTHROPIC_KEY"
  fi
  log "operator token saved to $OPERATOR_TOKEN_FILE (0600)"
else
  log "provision token is $pstate on the host: keys were already sent (keep using the operator token)"
fi

# --- single-use retrieval code ------------------------------------------------------------- #
CODE="$(op_post "$BASE" /bootstrap/operator/mint-code '{"ttl_hours": 72}' | json_field code)"
[ -n "$CODE" ] || die "could not mint a retrieval code"
if [ "$STORE_SECRETS_IN_SSM" = 1 ]; then put_secure "$SSM_PREFIX/retrieval_code" "$CODE"; fi
summary
echo "  code       : $CODE (single use, 72 h)"

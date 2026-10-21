#!/usr/bin/env bash
# Create (or reuse) the AcuDx web host on AWS EC2 and deploy the stack on it. Idempotent:
# every resource is looked up by name / tags first and created only when missing; a re-run
# re-copies the code and re-runs the (idempotent) on-host deploy. See deploy/aws/README.md.
#
#   SSH_CIDR=203.0.113.4/32 [LAMBDA_KEY=...] deploy/aws/provision.sh
#
# The instance gets NO instance profile and no AWS credentials. Secrets are generated on the
# instance by deploy/one-click.sh and stay root-only there; this script (the operator's side,
# with the operator's credentials) optionally copies them to SSM Parameter Store.
#
# Environment
#   SSH_CIDR        required. CIDR allowed to reach port 22 (the operator IP /32).
#   AWS_REGION      default eu-central-1.
#   NAME            default acudx-web-prod (tags, key pair name prefix, SSM prefix /acudx/$NAME).
#   INSTANCE_TYPE   default t3.large (x86_64). t4g.large (arm64) also works: every image in
#                   docker-compose.prod.yml is multi-arch; the AMI architecture follows the type.
#   VOLUME_GB       default 50 (gp3, encrypted root volume).
#   DOMAIN          custom domain whose A record you point at the Elastic IP; default
#                   <elastic-ip>.sslip.io (no DNS work needed).
#   BRANCH          git ref copied to the host, default claude/clever-mendel-dtbc1n (falls back
#                   to HEAD when the ref does not exist locally).
#   LAMBDA_KEY      Lambda Cloud API key for on-demand GPU workers. Sent over SSH on stdin to
#                   /etc/acudx/lambda.key (0600); never on a command line, never printed. When
#                   unset, an existing SSM copy ($SSM_PREFIX/lambda_key) is used.
#   LAMBDA_SSH_KEY_NAME  Lambda ssh key name the gateway attaches to GPU workers
#                   (default acudx-web-prod-key, registered in the Lambda account).
#   STORE_SECRETS_IN_SSM  1 (default): copy the generated secrets and the retrieval code to SSM
#                   SecureString parameters under $SSM_PREFIX (from this machine). 0: keep them
#                   only on the instance.
#   KEY_DIR         where the new EC2 key pair's private key is saved (default ~/.ssh).
#   AMI_ID          override the Ubuntu 24.04 AMI lookup.
#   DRY_RUN=1       print every AWS call instead of sending it (no credentials needed).
#   EC2_DRY_RUN=1   send RunInstances with --dry-run (permission check only, nothing launched).
#   SKIP_REMOTE=1   create the AWS resources only; skip the SSH copy and deploy (tests).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=deploy/aws/lib.sh
. "$HERE/lib.sh"

SSH_CIDR="${SSH_CIDR:?set SSH_CIDR to the CIDR allowed to reach port 22, e.g. 203.0.113.4/32}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.large}"
VOLUME_GB="${VOLUME_GB:-50}"
DOMAIN="${DOMAIN:-}"
BRANCH="${BRANCH:-claude/clever-mendel-dtbc1n}"
LAMBDA_SSH_KEY_NAME="${LAMBDA_SSH_KEY_NAME:-acudx-web-prod-key}"
STORE_SECRETS_IN_SSM="${STORE_SECRETS_IN_SSM:-1}"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
EC2_DRY_RUN="${EC2_DRY_RUN:-0}"
case "$SSH_CIDR" in */*) ;; *) die "SSH_CIDR must be a CIDR such as 203.0.113.4/32" ;; esac

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
    --description "AcuDx web host: 22 from operator, 80/443 public" \
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
authorize 22 "$SSH_CIDR"
authorize 80 0.0.0.0/0
authorize 443 0.0.0.0/0
authorize 80 ::/0 ipv6
authorize 443 ::/0 ipv6

# --- key pair ------------------------------------------------------------------------------ #
KEY_FILE="$KEY_DIR/$KEY_NAME.pem"
if [ -z "$(aws_none "$(aws_do "" ec2 describe-key-pairs --filters "Name=key-name,Values=$KEY_NAME" \
    --query 'KeyPairs[0].KeyName' --output text)")" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    aws_do "" ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
      --tag-specifications "$(tag_spec key-pair)" --query KeyMaterial --output text >/dev/null
  else
    mkdir -p "$KEY_DIR"
    chmod 700 "$KEY_DIR"
    ( umask 077; aws ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
        --tag-specifications "$(tag_spec key-pair)" --query KeyMaterial --output text > "$KEY_FILE" )
    chmod 600 "$KEY_FILE"
    log "created key pair $KEY_NAME, private key saved to $KEY_FILE"
  fi
elif [ ! -f "$KEY_FILE" ] && [ "$DRY_RUN" != 1 ]; then
  log "key pair $KEY_NAME exists in AWS but $KEY_FILE is missing here: the SSH steps need that key"
fi

# --- Elastic IP ---------------------------------------------------------------------------- #
read -r ALLOC_ID EIP <<<"$(aws_do "None None" ec2 describe-addresses \
  --filters "Name=tag:Name,Values=$NAME" --query 'Addresses[0].[AllocationId,PublicIp]' --output text)"
ALLOC_ID="$(aws_none "${ALLOC_ID:-}")"
if [ -z "$ALLOC_ID" ]; then
  read -r ALLOC_ID EIP <<<"$(aws_do "eipalloc-dryrun 198.51.100.10" ec2 allocate-address --domain vpc \
    --tag-specifications "$(tag_spec elastic-ip)" --query '[AllocationId,PublicIp]' --output text)"
  log "allocated Elastic IP $EIP ($ALLOC_ID)"
fi
DOMAIN="${DOMAIN:-$EIP.sslip.io}"
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
  USER_DATA="$(mktemp)"
  sed -e "s|__NAME__|$NAME|g" -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__LAMBDA_SSH_KEY_NAME__|$LAMBDA_SSH_KEY_NAME|g" \
    "$HERE/cloud-init.yaml.tpl" > "$USER_DATA"
  if grep -q '__[A-Z_]*__' "$USER_DATA"; then die "unfilled double-underscore marker in cloud-init"; fi
  if [ "$EC2_DRY_RUN" = 1 ]; then
    # Permission check only: EC2 answers DryRunOperation when the call WOULD have succeeded.
    out="$(aws ec2 run-instances --dry-run --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
      --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
      --metadata-options "HttpTokens=required,HttpEndpoint=enabled" --user-data "file://$USER_DATA" 2>&1 || true)"
    rm -f "$USER_DATA"
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
  log "launched $INSTANCE_ID ($INSTANCE_TYPE, $AMI_ID)"
else
  log "reusing instance $INSTANCE_ID"
fi
aws_do "" ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws_do "" ec2 associate-address --allocation-id "$ALLOC_ID" --instance-id "$INSTANCE_ID" \
  --allow-reassociation --query AssociationId --output text >/dev/null

# --- code, secrets and deploy over SSH ----------------------------------------------------- #
SSH=(ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$EIP")
if [ "${SKIP_REMOTE:-0}" = 1 ]; then
  log "SKIP_REMOTE=1: not copying code or deploying"
elif [ "$DRY_RUN" = 1 ]; then
  log "DRY-RUN would: wait for SSH + cloud-init; copy git archive of $BRANCH to /opt/acudx; send LAMBDA_KEY on stdin"
  log "DRY-RUN would: run deploy/aws/instance-bootstrap.sh; copy generated secrets to SSM under $SSM_PREFIX"
else
  log "waiting for SSH and cloud-init on $EIP"
  for _ in $(seq 1 60); do "${SSH[@]}" true 2>/dev/null && break; sleep 10; done
  "${SSH[@]}" 'cloud-init status --wait >/dev/null 2>&1 || true; command -v docker >/dev/null' \
    || die "cloud-init did not install Docker on $EIP (see /var/log/cloud-init-output.log)"
  REF="$BRANCH"
  git -C "$REPO_ROOT" rev-parse --verify --quiet "$REF" >/dev/null || REF=HEAD
  log "copying $REF to /opt/acudx"
  git -C "$REPO_ROOT" archive --format=tar "$REF" server web multiplayer infra deploy docker-compose.prod.yml \
    | "${SSH[@]}" 'sudo rm -rf /opt/acudx.new && sudo mkdir -p /opt/acudx.new && sudo tar -x -C /opt/acudx.new \
        && sudo rm -rf /opt/acudx && sudo mv /opt/acudx.new /opt/acudx'
  KEY_VALUE="${LAMBDA_KEY:-}"
  if [ -z "$KEY_VALUE" ]; then
    KEY_VALUE="$(aws_none "$(aws ssm get-parameter --with-decryption --name "$SSM_PREFIX/lambda_key" \
      --query Parameter.Value --output text 2>/dev/null || true)")"
  fi
  if [ -n "$KEY_VALUE" ]; then
    printf '%s' "$KEY_VALUE" | "${SSH[@]}" 'sudo install -d -m 700 /etc/acudx && sudo sh -c "umask 077; cat > /etc/acudx/lambda.key"'
    log "LAMBDA_KEY delivered to /etc/acudx/lambda.key (0600)"
    if [ "$STORE_SECRETS_IN_SSM" = 1 ] && [ -n "${LAMBDA_KEY:-}" ]; then put_secure "$SSM_PREFIX/lambda_key" "$KEY_VALUE"; fi
  else
    log "no LAMBDA_KEY: the gateway cannot launch GPU workers until /etc/acudx/lambda.key exists"
  fi
  unset KEY_VALUE
  "${SSH[@]}" 'sudo /opt/acudx/deploy/aws/instance-bootstrap.sh'
  if [ "$STORE_SECRETS_IN_SSM" = 1 ]; then
    remote_val() { "${SSH[@]}" "sudo sed -n 's/^$2=//p' $1 | head -n1"; }
    put_secure "$SSM_PREFIX/admin_token" "$(remote_val /etc/acudx/gateway.env ADMIN_TOKEN)"
    put_secure "$SSM_PREFIX/acudx_secret_key" "$(remote_val /etc/acudx/gateway.env ACUDX_SECRET_KEY)"
    put_secure "$SSM_PREFIX/keycloak_admin_password" "$(remote_val /etc/acudx/keycloak.env KC_BOOTSTRAP_ADMIN_PASSWORD)"
    put_secure "$SSM_PREFIX/keycloak_db_password" "$(remote_val /etc/acudx/keycloak.env KC_DB_PASSWORD)"
    CODE="$("${SSH[@]}" 'sudo head -n1 /root/acudx-retrieval-code.txt 2>/dev/null || true')"
    if [ -n "$CODE" ]; then put_secure "$SSM_PREFIX/retrieval_code" "$CODE"; fi
    unset CODE
    log "secrets copied to SSM SecureString parameters under $SSM_PREFIX/"
  fi
fi

cat <<EOF
AcuDx web host
  instance   : $INSTANCE_ID ($INSTANCE_TYPE, $AWS_REGION)
  public ip  : $EIP ($ALLOC_ID)
  url        : https://$DOMAIN/
  handoff    : https://$DOMAIN/bootstrap/credentials
  code       : ssh -i $KEY_FILE ubuntu@$EIP sudo cat /root/acudx-retrieval-code.txt
               (or: aws ssm get-parameter --with-decryption --name $SSM_PREFIX/retrieval_code --query Parameter.Value --output text)
  ssh        : ssh -i $KEY_FILE ubuntu@$EIP
EOF

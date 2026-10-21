#!/usr/bin/env bash
# Runs ON the EC2 instance as root (provision.sh calls it over SSH after copying the code):
#
#   sudo /opt/acudx/deploy/aws/instance-bootstrap.sh
#
# Reads /etc/acudx/aws.env (written by cloud-init) and runs deploy/one-click.sh with the stack's
# DOMAIN. The Lambda key, when the operator sent one, is already in /etc/acudx/lambda.key (0600).
# Every secret one-click.sh generates stays root-only on this host (/etc/acudx, /var/lib/acudx,
# /root/acudx-retrieval-code.txt); the instance has no AWS credentials and writes nothing to AWS.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
umask 077
# shellcheck disable=SC1091
. /etc/acudx/aws.env
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DOMAIN="$DOMAIN" LAMBDA_SSH_KEY_NAME="$LAMBDA_SSH_KEY_NAME" "$REPO/deploy/one-click.sh"
echo "instance bootstrap done: https://$DOMAIN/"

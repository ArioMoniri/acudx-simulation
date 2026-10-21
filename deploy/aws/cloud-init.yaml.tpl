#cloud-config
# AcuDx web host on EC2 (rendered by deploy/aws/provision.sh, which fills every double-underscore marker).
# SSH-free: installs Docker and git, clones the public repository at the requested branch/commit,
# and runs deploy/aws/instance-bootstrap.sh (deploy/one-click.sh). The only secret here is the
# one-time PROVISION_TOKEN: deploy/one-click.sh arms its hash and deletes this file, and the
# first POST /bootstrap/provision burns it (24 h expiry otherwise). Progress goes to the EC2
# console output (ACUDX-STAGE lines) and to https://<domain>/bootstrap/status.
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - git
  - python3
  - curl
  - openssl
write_files:
  - path: /etc/acudx/aws.env
    permissions: "0600"
    owner: root:root
    content: |
      NAME=__NAME__
      DOMAIN=__DOMAIN__
      LAMBDA_SSH_KEY_NAME=__LAMBDA_SSH_KEY_NAME__
      REPO_URL=__REPO_URL__
      BRANCH=__BRANCH__
      COMMIT=__COMMIT__
  - path: /etc/acudx/provision.token
    permissions: "0600"
    owner: root:root
    content: __PROVISION_TOKEN__
runcmd:
  - [chmod, "700", /etc/acudx]
  - [systemctl, enable, --now, docker]
  - - bash
    - -c
    - |
      set -uo pipefail
      say() { echo "ACUDX-STAGE: $*" | tee /dev/console; }
      . /etc/acudx/aws.env
      say cloud_init "packages installed, cloning $REPO_URL $BRANCH ${COMMIT:-HEAD}"
      rm -rf /opt/acudx
      if ! git clone --branch "$BRANCH" "$REPO_URL" /opt/acudx; then say failed "git clone"; exit 1; fi
      if [ -n "$COMMIT" ] && [ "$COMMIT" != none ]; then
        git -C /opt/acudx checkout --detach "$COMMIT" || { say failed "commit $COMMIT not on $BRANCH"; exit 1; }
      fi
      say repo_cloned "$(git -C /opt/acudx rev-parse --short HEAD)"
      umask 077   # the deploy log is root-only
      if /opt/acudx/deploy/aws/instance-bootstrap.sh > /var/log/acudx-deploy.log 2>&1; then
        say ready "https://$DOMAIN/"
      else
        say failed "see /var/log/acudx-deploy.log"
        tail -n 40 /var/log/acudx-deploy.log > /dev/console
      fi

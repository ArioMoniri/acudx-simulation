#cloud-config
# AcuDx web host on EC2 (rendered by deploy/aws/provision.sh, which fills every double-underscore marker).
# Installs Docker and git and records the stack settings. The instance has no AWS credentials:
# provision.sh then copies the branch over SSH and runs deploy/aws/instance-bootstrap.sh, which
# runs deploy/one-click.sh (secrets are generated here and stay root-only on this host).
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
runcmd:
  - [chmod, "700", /etc/acudx]
  - [systemctl, enable, --now, docker]
  - [usermod, -aG, docker, ubuntu]

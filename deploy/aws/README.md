# AcuDx web host on AWS EC2

The web host (Caddy + web app, gateway, rooms relay, Keycloak, Postgres) runs on one EC2
instance in `eu-central-1`. GPU workers stay on Lambda Cloud and are launched on demand by
the gateway. The instance has **no instance profile**: it never holds AWS credentials. Every
secret is generated on the instance by `deploy/one-click.sh` and stays root-only there; the
operator's machine copies them to SSM Parameter Store (SecureString) with the operator's own
credentials.

| File | What it does |
|---|---|
| `provision.sh` | Idempotent. Security group in the default VPC (22 from `SSH_CIDR`, 80/443 open), ed25519 key pair, Elastic IP, Ubuntu 24.04 instance (t3.large, 50 GB encrypted gp3, IMDSv2 required), cloud-init (Docker, git), code copy over SSH, `instance-bootstrap.sh`, SSM copies of the secrets |
| `cloud-init.yaml.tpl` | Installs Docker and git, writes `/etc/acudx/aws.env` (stack name, domain, Lambda ssh key name) |
| `instance-bootstrap.sh` | On the instance: runs `deploy/one-click.sh` with the stack's domain |
| `rotate-code.sh` | Operator side: mints a new single-use retrieval code over SSH (optionally resets the temporary passwords) and refreshes its SSM copy |
| `teardown.sh` | Stops the gateway's Lambda GPU worker, terminates the instance, releases the EIP, deletes the security group, key pair and SSM parameters. Needs `CONFIRM=<name>` |
| `iam-policy.json` | Minimal operator policy for these scripts (EC2 + SSM only; no IAM, no Route53) |
| `test-with-moto.sh` | Offline test of provision / rotate / teardown against a local moto server |

Every script supports `DRY_RUN=1` (prints each AWS call, sends nothing, needs no credentials;
secret values are never printed). `provision.sh` also supports `EC2_DRY_RUN=1` (sends
`RunInstances --dry-run`: a permission check that launches nothing).

## Step list for the launch session (follow verbatim)

Run from the repository root of a checkout of `claude/clever-mendel-dtbc1n` (commit the work
first: the code copied to the host is `git archive` of `BRANCH`, default
`claude/clever-mendel-dtbc1n`; set `BRANCH=HEAD` to ship the current commit).

1. Credentials and region (IAM user `acudx-deploy`, AmazonEC2FullAccess + AmazonSSMFullAccess
   or `iam-policy.json`):

   ```bash
   export AWS_REGION=eu-central-1
   aws sts get-caller-identity
   ```

2. Operator IP for SSH (a /32), and the Lambda key for GPU workers (it is sent on stdin over
   SSH and stored as an SSM SecureString; never put it on a command line):

   ```bash
   export SSH_CIDR="$(curl -fsS https://checkip.amazonaws.com)/32"
   # LAMBDA_KEY must already be in the environment of this session (it is in the coordinator's).
   test -n "$LAMBDA_KEY" && echo "LAMBDA_KEY present"
   ```

   If the session reaches the internet through an egress proxy, `checkip` returns the
   proxy's address: use that, since that is where SSH will come from. If SSH on port 22 is not
   allowed out of the session, stop and report it: the scripts need SSH to the host.

3. Static checks and a dry run (no AWS calls):

   ```bash
   shellcheck -x -P SCRIPTDIR deploy/aws/*.sh deploy/one-click.sh deploy/rotate-bootstrap-code.sh
   DRY_RUN=1 deploy/aws/provision.sh
   ```

4. Permission check without launching:

   ```bash
   EC2_DRY_RUN=1 deploy/aws/provision.sh   # expect "RunInstances would succeed"
   ```

   This already creates (idempotently) the security group, key pair and Elastic IP; the next
   step reuses them. The private key is saved to `~/.ssh/acudx-web-prod-key.pem` (0600).

5. Launch and deploy (about 15 to 25 minutes: cloud-init, image builds, Keycloak first start):

   ```bash
   deploy/aws/provision.sh 2>&1 | tee /tmp/acudx-provision.log
   ```

   The summary at the end prints the instance id, type, region, Elastic IP, the URL
   `https://<eip>.sslip.io/` and the handoff URL. To use a custom domain instead, point its A
   record at the Elastic IP and run `DOMAIN=sim.example.edu deploy/aws/provision.sh` (or on
   the host: `sudo DOMAIN=sim.example.edu /opt/acudx/deploy/one-click.sh`).

6. Read the retrieval code (single use, 72 h):

   ```bash
   aws ssm get-parameter --with-decryption --name /acudx/acudx-web-prod/retrieval_code \
     --query Parameter.Value --output text
   ```

7. Verify (Playwright; checklist in `docs/review/09-production-deploy.md` section 4). Every role
   signs in with its temporary password, sets a new one in the Keycloak UPDATE_PASSWORD step,
   lands on its panel, and the UI and API role gates hold; the student starts a case. Do not
   redeem the retrieval code in the test.

   ```bash
   EIP=<elastic ip>; KEY=~/.ssh/acudx-web-prod-key.pem
   umask 077; ssh -i $KEY ubuntu@$EIP sudo cat /var/lib/acudx/bootstrap/credentials.json > /tmp/acudx-creds.json
   (cd web && npm ci && BASE_URL=https://$EIP.sslip.io CREDENTIALS_FILE=/tmp/acudx-creds.json \
     SHOTS_DIR=../docs/review/evidence/09-production-live START_CASE=1 node ../deploy/verify/verify-roles.mjs)
   rm -f /tmp/acudx-creds.json
   # the case start answers 503 model_warming and launches a GPU worker on Lambda:
   curl -fsS -u "$LAMBDA_KEY:" https://cloud.lambda.ai/api/v1/instances | python3 -m json.tool | grep -E '"(id|name|status)"'
   # stop it through the gateway, then confirm on Lambda that it is terminating / gone:
   ssh -i $KEY ubuntu@$EIP "cd /opt/acudx && sudo docker compose --env-file /etc/acudx/compose.env -f docker-compose.prod.yml \
     exec -T server sh -c 'curl -fsS -X POST -H \"X-Admin-Token: \$ADMIN_TOKEN\" http://127.0.0.1:8890/admin/gpu/stop'"
   curl -fsS -u "$LAMBDA_KEY:" https://cloud.lambda.ai/api/v1/instances | python3 -m json.tool | grep -E '"(id|name|status)"'
   ```

   Only touch the `acudx-worker-*` instance this run launched; never `acudx-wm-phase-a-*`,
   `Liver`, or other workers.

8. Hand the accounts over untouched: reset every account to a fresh temporary password and
   mint a new code (this also refreshes the SSM copy):

   ```bash
   deploy/aws/rotate-code.sh --reset-passwords
   ```

   Report the URL, the usernames and roles, the handoff URL and this code. Never report a
   password.

9. Teardown (only when asked):

   ```bash
   CONFIRM=acudx-web-prod deploy/aws/teardown.sh
   ```

## Costs

t3.large on-demand in eu-central-1 is about 0.096 USD per hour (about 70 USD per month), plus
the 50 GB gp3 volume (about 4.8 USD per month) and the Elastic IP's public IPv4 charge (about
0.005 USD per hour). GPU workers on Lambda are billed separately, only while running; the
gateway's idle reaper terminates them after `GPU_IDLE_MINUTES` (default 20).

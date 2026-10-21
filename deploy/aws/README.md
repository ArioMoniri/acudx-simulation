# AcuDx web host on AWS EC2 (no SSH needed)

The web host (Caddy + web app, gateway, rooms relay, Keycloak, Postgres) runs on one EC2
instance in `eu-central-1`. GPU workers stay on Lambda Cloud and are launched on demand by the
gateway. The whole deploy runs over the EC2 API and HTTPS, so a session whose only egress is
HTTPS (through a proxy) can do it end to end. SSH stays available for humans (`SSH_CIDR`).

How it works:

1. `provision.sh` allocates the Elastic IP first, so the domain `<eip>.sslip.io` is known, then
   launches Ubuntu 24.04 (t3.large, 50 GB encrypted gp3, IMDSv2 with hop limit 1, no instance
   profile) with cloud-init user-data. The user-data carries one secret only: a random one-time
   `PROVISION_TOKEN` (kept 0600 on the operator side in `~/.ssh/acudx-web-prod-provision.token`).
2. cloud-init installs Docker and git, clones the public repository at `BRANCH` (and `COMMIT` if
   given) and runs `deploy/one-click.sh`, which generates every secret on the instance
   (root-only), builds and starts the stack, provisions the eight role accounts, arms the hash of
   the PROVISION_TOKEN and deletes its plaintext. Progress: `ACUDX-STAGE` lines in the EC2 console
   output, then `GET https://<domain>/bootstrap/status`.
3. `provision.sh` waits for `ready`, then sends the API keys ONCE:
   `POST /bootstrap/provision {token, lambda_key?, anthropic_key?}`. The gateway seals the
   Anthropic key in its registry, writes the Lambda key root-only, burns the token (410 after) and
   returns an operator token, shown only in that response. `provision.sh` keeps it 0600 in
   `~/.ssh/acudx-web-prod-operator.token` and in SSM (`/acudx/acudx-web-prod/operator_token`).
4. Operator actions over HTTPS with that token (`X-Operator-Token`; a verified super_admin bearer
   works too): `/bootstrap/operator/mint-code`, `/bootstrap/operator/reset-accounts`,
   `/bootstrap/operator/gpu`, `/bootstrap/operator/gpu/stop`.

| File | What it does |
|---|---|
| `provision.sh` | Idempotent launch and the HTTPS steps above |
| `cloud-init.yaml.tpl` | Docker, git clone, `instance-bootstrap.sh`, progress lines on the console |
| `instance-bootstrap.sh` | On the instance: runs `deploy/one-click.sh` with the stack's domain |
| `rotate-code.sh` | New single-use code (`--reset-passwords` first gives every account a fresh temporary password); HTTPS by default, `--ssh` for humans |
| `teardown.sh` | Stops the Lambda GPU worker over HTTPS, terminates the instance, releases the EIP, deletes the security group, key pair, SSM parameters and the local token files. Needs `CONFIRM=<name>` |
| `iam-policy.json` | Minimal operator policy (EC2 + SSM only; no IAM, no Route53) |
| `test-with-moto.sh` | Offline test against a local moto server |

Every script supports `DRY_RUN=1` (prints each AWS call, sends nothing, prints no secret).
`provision.sh` also supports `EC2_DRY_RUN=1` (`RunInstances --dry-run`, launches nothing).
With a long-term key (`AKIA...`) the scripts drop any `AWS_SESSION_TOKEN` in the environment.

## Step list for the launch session (follow verbatim)

Run from the repository root of a checkout of `claude/clever-mendel-dtbc1n`. The instance clones
the PUBLIC repository itself, so the commit to deploy must be pushed; set `COMMIT=<sha>` to pin
it (default: the branch head when the instance boots).

1. Credentials and region (IAM user `acudx-deploy`: AmazonEC2FullAccess + AmazonSSMFullAccess, or
   `iam-policy.json`). Long-term keys only; the scripts unset a stray session token themselves:

   ```bash
   export AWS_REGION=eu-central-1
   env -u AWS_SESSION_TOKEN aws sts get-caller-identity
   ```

2. Keys for the gateway, from the session environment (sent once over HTTPS, never on a command
   line): `LAMBDA_KEY` (GPU workers, required for on-demand capacity) and, optionally,
   `ANTHROPIC_KEY` (Claude as the default model route; without it the super_admin can paste one in
   Admin, Providers, `anthropic` later).

   ```bash
   test -n "$LAMBDA_KEY" && echo "LAMBDA_KEY present"; test -n "${ANTHROPIC_KEY:-}" && echo "ANTHROPIC_KEY present"
   ```

3. Static checks and a dry run (no AWS calls):

   ```bash
   shellcheck -x -P SCRIPTDIR deploy/aws/*.sh deploy/one-click.sh deploy/rotate-bootstrap-code.sh
   DRY_RUN=1 deploy/aws/provision.sh
   ```

4. Permission check without launching (creates the security group, key pair and EIP, reused next):

   ```bash
   EC2_DRY_RUN=1 deploy/aws/provision.sh      # expect "RunInstances would succeed"
   ```

5. Launch and deploy; about 15 to 30 minutes. The script prints each stage, sends the keys, keeps
   the operator token and prints the URL and a first single-use retrieval code:

   ```bash
   deploy/aws/provision.sh 2>&1 | tee /tmp/acudx-provision.log
   ```

   If it stops waiting, re-run it: it reuses everything and continues. Progress by hand:
   `curl -s https://<eip>.sslip.io/bootstrap/status` and
   `aws ec2 get-console-output --instance-id <id> --latest --output text | grep ACUDX-STAGE`.

6. Verify over HTTPS with Playwright (from `web/`). The script mints a code, reads the temporary
   passwords once, signs in as every role (forced new password, landing panel, UI and API gates),
   starts a case as the student (with `LAMBDA_KEY` and no Claude key the answer is
   `model_warming`; it then waits for the GPU worker and stops it), and with `FINALIZE=1` resets
   every account to a fresh temporary password and prints the final code to hand over:

   ```bash
   cd web && npm ci
   NODE_USE_ENV_PROXY=1 BASE_URL=https://<eip>.sslip.io OPERATOR_TOKEN_FILE=~/.ssh/acudx-web-prod-operator.token \
     SHOTS_DIR=../docs/review/evidence/09-production-live START_CASE=1 FINALIZE=1 \
     node ../deploy/verify/verify-roles.mjs
   cd ..
   ```

   With a Claude key the case start is served by Claude and no GPU worker launches; to exercise
   the worker path anyway, send only `LAMBDA_KEY` first and paste the Anthropic key in the admin
   panel afterwards.

7. Confirm the GPU worker on Lambda (only the `acudx-worker-*` instance this run launched; never
   touch `acudx-wm-*`, `Liver` or other instances):

   ```bash
   curl -fsS -u "$LAMBDA_KEY:" https://cloud.lambda.ai/api/v1/instances \
     | python3 -c 'import json,sys; [print(i["id"], i.get("name"), i["status"], i["instance_type"]["name"]) for i in json.load(sys.stdin)["data"]]'
   ```

   The worker should show `terminating`/`terminated` after the stop in step 6. If one is still
   active: `deploy/aws/rotate-code.sh` is not needed; stop it with
   `curl -fsS -X POST -H "X-Operator-Token: $(cat ~/.ssh/acudx-web-prod-operator.token)" https://<domain>/bootstrap/operator/gpu/stop`
   (or let the idle reaper do it after 20 minutes).

8. Hand over: the final code printed in step 6 (or a new one with
   `deploy/aws/rotate-code.sh --reset-passwords`). Report the URL, the eight usernames and roles,
   `https://<domain>/bootstrap/credentials`, the code, the instance id / type / region and the
   price. Never report a password.

9. Teardown (only when asked): `CONFIRM=acudx-web-prod deploy/aws/teardown.sh`.

## Custom domain

Point the domain's A record at the Elastic IP, then `DOMAIN=sim.example.edu deploy/aws/provision.sh`
for a new instance, or on the host `sudo DOMAIN=sim.example.edu /opt/acudx/deploy/one-click.sh`
(Caddy obtains the certificate; Keycloak and the gateway follow the new name).

## Costs

t3.large on-demand in eu-central-1 is about 0.096 USD per hour (about 70 USD per month), plus the
50 GB gp3 volume (about 4.8 USD per month) and the public IPv4 charge (about 0.005 USD per hour).
GPU workers on Lambda are billed separately, only while running; the idle reaper terminates them
after `GPU_IDLE_MINUTES` (default 20).

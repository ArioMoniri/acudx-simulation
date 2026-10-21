# AcuDx production runbook

Applies to a host deployed with `deploy/one-click.sh` (directly, or through
`deploy/aws/provision.sh`). Commands run on the host as root unless marked "operator".

## Layout

| Path | What | Mode |
|---|---|---|
| `/opt/acudx` | code (git archive of the deployed branch) | root |
| `/etc/acudx/compose.env` | `DOMAIN` | 0600 |
| `/etc/acudx/gateway.env` | `ADMIN_TOKEN`, `ACUDX_SECRET_KEY` (registry sealing key), `LAMBDA_KEY`, `ANTHROPIC_KEY` (if given), `LAMBDA_SSH_KEY_NAME`, `GPU_IDLE_MINUTES` | 0600 |
| `/etc/acudx/keycloak.env`, `keycloak-db.env` | Keycloak admin and database passwords | 0600 |
| `/etc/acudx/lambda.key`, `anthropic.key` | Lambda and (optional) Anthropic keys as delivered by the operator | 0600 |
| `/etc/acudx/compose.override.yml` | optional host-local compose overrides (picked up automatically) | 0600 |
| `/var/lib/acudx/bootstrap/` | `credentials.json` (temporary passwords), `code.json` (salted hash of the retrieval code), `audit.log` | 0700 dir, 0600 files |
| `/root/acudx-retrieval-code.txt` | the current retrieval code | 0600 |
| Docker volumes `acudx_server_data`, `acudx_keycloak_db`, `acudx_caddy_data` | gateway SQLite (registry, telemetry, cases), Keycloak Postgres, TLS certificates | |

Shorthand used below:

```bash
cd /opt/acudx
C="docker compose --env-file /etc/acudx/compose.env -f docker-compose.prod.yml"
```

## Status and logs

```bash
$C ps
$C logs -f --tail=200 server        # gateway
$C logs -f --tail=200 keycloak
$C logs -f --tail=200 web           # Caddy (TLS, ACME)
curl -fsS https://$(sed -n 's/^DOMAIN=//p' /etc/acudx/compose.env)/api/health
$C exec -T server sh -c 'curl -fsS -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:8890/admin/gpu/status'
tail -n 50 /var/lib/acudx/bootstrap/audit.log   # every handoff attempt (never the code or a password)
```

## Restart

```bash
$C restart server          # one service
$C up -d                   # everything, without rebuilding
```

## Update / redeploy from a branch

AWS host without SSH: user-data only runs at first boot, so an update of a running instance
is a new instance (`CONFIRM=acudx-web-prod deploy/aws/teardown.sh` then
`deploy/aws/provision.sh` with the new `BRANCH`/`COMMIT`; the accounts are provisioned again), or,
with SSH, the in-place update below.

On the host (SSH):

```bash
git -C /opt/acudx fetch origin <branch> && git -C /opt/acudx checkout -B <branch> origin/<branch>
sudo /opt/acudx/deploy/one-click.sh
```

## Without SSH: status and operator actions over HTTPS

```bash
curl -s https://<domain>/bootstrap/status            # deploy stage, handoff state, which keys are set
H="X-Operator-Token: $(cat ~/.ssh/acudx-web-prod-operator.token)"   # operator side only
curl -fsS -X POST -H "$H" https://<domain>/bootstrap/operator/reset-accounts   # fresh temporary passwords
curl -fsS -X POST -H "$H" -d '{"ttl_hours":72}' https://<domain>/bootstrap/operator/mint-code
curl -fsS -H "$H" https://<domain>/bootstrap/operator/gpu                  # GPU worker status
curl -fsS -X POST -H "$H" https://<domain>/bootstrap/operator/gpu/stop     # stop it now
```

The operator token comes from the one-time `POST /bootstrap/provision` (see
`deploy/aws/README.md`); a signed-in super_admin's bearer is accepted instead. Wrong tokens are
rate limited and locked out like the retrieval code; every call is in
`/var/lib/acudx/bootstrap/audit.log`. `deploy/aws/rotate-code.sh` wraps the two account calls.
The account reset uses the realm's own service client `acudx-provisioner` (manage-users,
view-users, view-realm in realm `acudx` only), whose secret `one-click.sh` writes root-only to
`/var/lib/acudx/bootstrap/kc-provisioner.json`; the gateway never holds the Keycloak master
admin password.

## Rotate the retrieval code / hand accounts over again

```bash
sudo /opt/acudx/deploy/rotate-bootstrap-code.sh                    # new code, same temporary passwords
sudo /opt/acudx/deploy/rotate-bootstrap-code.sh --reset-passwords  # fresh temporary passwords too
deploy/aws/rotate-code.sh [--reset-passwords]                      # operator, AWS: same, plus the SSM copy
```

The previous code stops working immediately. Each code is single use and expires after 72 h
(`--ttl-hours N` to change). After five wrong codes the page locks for 15 minutes; after 20 the
code is disabled and only a rotation opens the page again. `--reset-passwords` also logs every
account out.

## Change the domain

Point the new name's A record at the host, then:

```bash
sudo DOMAIN=sim.example.edu /opt/acudx/deploy/one-click.sh
```

Caddy obtains the new certificate, Keycloak's hostname and the `acudx-web` client redirect URIs
follow, and the gateway's identity provider row is re-registered with the new issuer.

## Model provider and GPU workers

- With no Claude key and no other LLM row, every model call goes to the on-demand Lambda GPU worker. A
  case start answers `503 model_warming` while the worker boots and launches it in the
  background; the idle reaper terminates it after `GPU_IDLE_MINUTES` (20). Policy (idle window,
  allowlist, regions, `max_workers` default 3, 0 disables launches, no budget cap by default):
  Admin console, GPU tab, or `PUT /admin/gpu/policy`.
- Claude is the default model route (`server/providers/anthropic_provider.py`). Its key comes
  from `ANTHROPIC_KEY` on the host (`/etc/acudx/anthropic.key` or the environment of
  `one-click.sh`, written to `gateway.env`), else from the admin panel: sign in as
  `acudx-super-admin` (or `acudx-admin`), Admin, Providers, edit the `anthropic` row, paste the
  key, Save. The panel key is sealed with `ACUDX_SECRET_KEY` and never returned to the browser.
  When both exist the host key wins. With no key from either source, model calls go to the GPU
  worker as described above.
- Stop a running worker now: `$C exec -T server sh -c 'curl -fsS -X POST -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:8890/admin/gpu/stop'`.

## Backup

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p /var/backups/acudx && chmod 700 /var/backups/acudx
$C exec -T keycloak-db pg_dump -U keycloak -d keycloak | gzip > /var/backups/acudx/keycloak-$TS.sql.gz
$C exec -T server python -c "import sqlite3; s=sqlite3.connect('/app/server/data/acudx.db'); d=sqlite3.connect('/app/server/data/backup.db'); s.backup(d); d.close()"
docker cp "$($C ps -q server)":/app/server/data/backup.db /var/backups/acudx/gateway-$TS.db
tar -C / -czf /var/backups/acudx/etc-$TS.tgz etc/acudx var/lib/acudx/bootstrap
chmod 600 /var/backups/acudx/*
```

`etc-*.tgz` holds every secret, including `ACUDX_SECRET_KEY`: without it the sealed provider
keys in the gateway database cannot be decrypted. Copy backups off the host encrypted.

Restore: stop the stack (`$C down`), restore `/etc/acudx` and `/var/lib/acudx/bootstrap` from
the tarball, `$C up -d keycloak-db`, `gunzip -c keycloak-*.sql.gz | $C exec -T keycloak-db psql -U keycloak -d keycloak`,
copy the gateway database into the `acudx_server_data` volume as `acudx.db`, then `$C up -d`.

## Keycloak administration

The admin console is not exposed on the internet (`/idp/admin` answers 404 at Caddy). Use an
SSH tunnel to the container network or `kcadm.sh` inside the container:

```bash
$C exec keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/idp \
  --realm master --user admin   # prompts for the password in /etc/acudx/keycloak.env
```

## Tear down

AWS: `CONFIRM=acudx-web-prod deploy/aws/teardown.sh` (operator). Elsewhere: stop any GPU
worker first (above), then `$C down` (add `-v` to delete the data volumes).

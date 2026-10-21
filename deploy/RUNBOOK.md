# AcuDx production runbook

Applies to a host deployed with `deploy/one-click.sh` (directly, or through
`deploy/aws/provision.sh`). Commands run on the host as root unless marked "operator".

## Layout

| Path | What | Mode |
|---|---|---|
| `/opt/acudx` | code (git archive of the deployed branch) | root |
| `/etc/acudx/compose.env` | `DOMAIN` | 0600 |
| `/etc/acudx/gateway.env` | `ADMIN_TOKEN`, `ACUDX_SECRET_KEY` (registry sealing key), `LAMBDA_KEY`, `LAMBDA_SSH_KEY_NAME`, `GPU_IDLE_MINUTES` | 0600 |
| `/etc/acudx/keycloak.env`, `keycloak-db.env` | Keycloak admin and database passwords | 0600 |
| `/etc/acudx/lambda.key` | Lambda API key as delivered by the operator | 0600 |
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

Operator, from a checkout of the branch (AWS host):

```bash
BRANCH=claude/clever-mendel-dtbc1n SSH_CIDR=<your ip>/32 deploy/aws/provision.sh
```

It reuses the instance, copies `git archive` of the branch to `/opt/acudx`, and re-runs
`one-click.sh`, which keeps every existing secret, rebuilds the images and recreates changed
containers. Accounts and the retrieval code are left alone.

Any other host:

```bash
git -C /opt/acudx fetch origin <branch> && git -C /opt/acudx checkout -B <branch> origin/<branch>
sudo /opt/acudx/deploy/one-click.sh
```

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

- With no LLM row in the registry, every model call goes to the on-demand Lambda GPU worker. A
  case start answers `503 model_warming` while the worker boots and launches it in the
  background; the idle reaper terminates it after `GPU_IDLE_MINUTES` (20). Policy (idle window,
  allowlist, regions, `max_workers` 1 or 0 to disable launches, no budget cap by default):
  Admin console, GPU tab, or `PUT /admin/gpu/policy`.
- To use Anthropic: sign in as `acudx-super-admin` (or `acudx-admin`), Admin, Providers, Add,
  kind LLM, "Use the Anthropic API", paste the key, Save. The key is sealed with
  `ACUDX_SECRET_KEY` in the registry and never returned to the browser. The gateway calls it
  through the native Messages API and stops using the GPU worker for model calls.
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

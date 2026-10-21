# 09 Production deploy: accounts per role, one-time handoff, AWS web host

Status on 2026-10-21: the production stack, the role accounts and the one-time handoff are
built and verified end to end on a local run of the real `deploy/one-click.sh` (section 2).
The AWS launch and the live verification run in a new session with fresh credentials
(`deploy/aws/README.md`, section 4 below). No Lambda instance was launched for hosting; the
`acudx-web-prod` poll for `cpu_4x_general` (7 polls, no capacity) was stopped when the owner
moved hosting to AWS, and the Lambda instance list was empty afterwards.

## 1. What was built

| Area | Files |
|---|---|
| Production stack: Caddy (TLS, web), gateway, rooms relay at `/ws`, Keycloak 26 on Postgres at `/idp` (admin console not published), one-time handoff at `/bootstrap/*` | `docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/Dockerfile.*`, `.dockerignore` |
| One-click deploy: Docker install, root-only secrets in `/etc/acudx`, realm render, accounts, identity provider, retrieval code; idempotent, follows a `DOMAIN` change | `deploy/one-click.sh`, `deploy/keycloak/render-prod-realm.py` |
| One account per role, random 24-character temporary passwords (UPDATE_PASSWORD), no password on any command line or in any log | `server/bootstrap/provision.py` |
| Single-use retrieval code (160 bits, 72 h), salted hash at rest, constant-time compare, per-IP limit, global lockout and burn, HTTPS only, audit log | `server/bootstrap/handoff.py`, `server/bootstrap/routes.py`, `server/bootstrap/mint.py`, `deploy/rotate-bootstrap-code.sh` |
| Model routing in production: Claude first (`server/providers/anthropic_provider.py`, merged from the Claude route work) with its key from `ANTHROPIC_KEY` or, when that is unset, the key pasted on the admin panel's `anthropic` row; with no key from either source, case generation follows the OpenAI-compatible registry rows, else the on-demand GPU worker, which a case start launches in the background (`503 model_warming`) | `server/orchestration/llm.py`, `server/orchestration/routes.py`, `server/providers/anthropic_provider.py`, `server/registry/routes.py` |
| Case start needs a signed-in user under OIDC (an anonymous POST could otherwise launch a GPU worker) | `server/orchestration/routes.py` |
| GPU policy `max_workers` (pool, default 3; 0 disables launches); idle reaper and no budget cap unchanged | `server/providers/gpu_worker.py` |
| Admin console opens for a verified admin / super_admin bearer (no bootstrap token in the browser), where the Claude key is pasted on the `anthropic` row | `web/src/lib/adminApi.ts`, `web/src/components/admin/*` |
| Each role lands on its panel after sign-in (admin, super_admin -> /admin, dean -> /dean, faculty -> /faculty, learners -> /) | `web/src/lib/navigation.ts`, `web/src/pages/AuthCallbackPage.tsx` |
| AWS: provision (SG, key pair, EIP, Ubuntu 24.04 t3.large, 50 GB encrypted gp3, IMDSv2, no instance profile), rotate, teardown, minimal IAM policy, moto test | `deploy/aws/*` |
| Operations | `deploy/RUNBOOK.md` |
| Live verification script (Playwright) | `deploy/verify/verify-roles.mjs` |

## 2. Local production-stack run (2026-10-21)

`sudo DOMAIN=acudx.localhost ./deploy/one-click.sh` in the build sandbox, with a host-local
`/etc/acudx/compose.override.yml` that only adds the sandbox's TLS-intercepting proxy CA to the
image builds and trusts Caddy's local CA in the gateway (the sandbox cannot get a Let's Encrypt
certificate). No Lambda key was given, so no GPU worker could launch.

| Check | Result |
|---|---|
| First run: build, start, realm import, 8 accounts, identity provider, code | exit 0 |
| Second run (idempotent): secrets kept, accounts untouched, client and IdP re-synced | exit 0 |
| `GET /api/health`, `/`, `/idp/realms/acudx/.well-known/openid-configuration` | 200 |
| `http://` -> `https://` | 308 |
| `/idp/admin/...` from outside | 404 |
| `/api/v1/auth/config` | mode `oidc`, issuer `https://acudx.localhost/idp/realms/acudx`, discovery ok |
| Anonymous `POST /api/v2/case/generate/stream` | 401 `unauthenticated` |
| Handoff: right code | 200, table with the 8 usernames and roles |
| Handoff: same code again, then GET | 410, 410 |
| Handoff: wrong code | 401, counted (audit log has `minted`, `revealed`, `burned`, no secret) |
| `verify-roles.mjs` over all 8 accounts | PASS (below) |

`verify-roles.mjs` per account: Keycloak asked for a new password (UPDATE_PASSWORD), landing
page, UI gates on /faculty, /dean, /admin, `/v1/auth/me` primary role and `verified=true`, API
gates (`/v1/faculty/queue`, `/v1/dean/cohort`, `/admin/providers`):

| Account | Lands on | UI opens | API 200 | API refused |
|---|---|---|---|---|
| acudx-student | / | none | none | faculty 403, dean 403, admin 401 |
| acudx-resident | / | none | none | same |
| acudx-nurse | / | none | none | same |
| acudx-paramedic | / | none | none | same |
| acudx-faculty | /faculty | /faculty | faculty | dean 403, admin 401 |
| acudx-dean | /dean | /faculty, /dean | faculty, dean | admin 401 |
| acudx-admin | /admin (console, bearer) | all | all | none |
| acudx-super-admin | /admin (console, bearer) | all | all | none |

The student's case start answered `503 model_unreachable` here (no Lambda key in the sandbox);
with `LAMBDA_KEY` set it answers `503 model_warming` and launches the worker
(`server/tests/test_prod_model_routing.py::test_preflight_starts_the_gpu_worker_in_the_background_and_answers_model_warming`).
After the run every account was reset to a fresh temporary password with
`deploy/rotate-bootstrap-code.sh --reset-passwords`.

Screenshots: `docs/review/evidence/09-production-smoke/` (`<role>-landing.png`,
`admin-admin.png`, `super_admin-admin.png`, `super_admin-providers.png`, `super_admin-anthropic-key.png` (the Claude key field on the seeded anthropic row),
`handoff-form.png`, `handoff-form-390.png`, `handoff-wrong-code.png`). The revealed table is
not captured on purpose: it holds passwords.

### Defects the run found and fixed

1. Every sign-in failed with "Invalid scopes: openid profile email": the realm import listed
   its own `clientScopes`, which replaces Keycloak's built-in scopes. The `org` mapper moved
   onto the client; the realm lists no client scopes (`test_prod_realm.py`).
2. Nurse and paramedic signed in as `student`: the realm's default roles included `student`.
   Removed from the realm, and `provision.py` strips any AcuDx role from
   `default-roles-acudx` on every run.
3. The web image did not build: `tsc` checks a test that imports
   `server/tests/fixtures/course_parity.json`, which the Dockerfile did not copy.
4. A local `web/node_modules` broke the image build: no `.dockerignore` existed.
5. The identity provider row showed as failing: the public name resolves to the Docker gateway
   (private), which the SSRF guard refuses for a host name; the domain is now on
   `LOCAL_ALLOWLIST` in `docker-compose.prod.yml`.
6. The admin console asked for the bootstrap token after a reload: it now re-renders when the
   OIDC session refreshes.
7. The rooms relay was unreachable over HTTPS: the client dialled `wss://<host>/`, Caddy routes
   `/ws*`; the client now dials `wss://<host>/ws`.

## 3. Tests

- `server/tests/test_bootstrap_handoff.py`: single use, expiry, global lockout (right code
  refused while locked), per-IP limit, burn after 20 failures, rotation, HTTPS only, audit
  without secrets, 404 when not provisioned, mint CLI writes 0600.
- `server/tests/test_bootstrap_provision.py`: one account per role, exactly one AcuDx role each,
  temporary passwords of 20+ characters, idempotent re-run with new passwords, client sync,
  default roles cleaned, 0600 / 0700 files.
- `server/tests/test_prod_model_routing.py` (env key wins over the panel key, panel key feeds the
  provider, the anthropic row is never used as an OpenAI endpoint, model_warming, sign-in),
  `test_prod_realm.py`, `test_gpu_worker.py`
  (`max_workers`).
- `deploy/aws/test-with-moto.sh`: provision twice (idempotent), IMDSv2, no instance profile,
  50 GB encrypted gp3, 0600 key file, SSH only from `SSH_CIDR`, teardown twice. PASS.
- `shellcheck -x` on every deploy script: clean. `DRY_RUN=1` on provision and teardown: no
  secret value in the output.

## 4. SSH-free deploy path (after the blocked launch, 2026-10-21)

Cloud sessions cannot open outbound TCP 22, so the AWS path no longer uses SSH:
user-data clones the public repository and runs `one-click.sh`; the keys arrive once over
HTTPS (`POST /bootstrap/provision` with the one-time PROVISION_TOKEN from the user-data, then
burned); operator actions use `/bootstrap/operator/*` with the operator token that call returns
(or a super_admin bearer); progress is on the EC2 console output and `/bootstrap/status`
(`server/bootstrap/operator.py`, `server/bootstrap/tokens.py`, `deploy/aws/*`).

Local rehearsal of exactly that flow on the production stack (token written to
`/etc/acudx/provision.token` as cloud-init does, then HTTPS only):

| Step | Result |
|---|---|
| one-click stages | starting, building, stack_starting, provisioning, ready; token armed, plaintext file removed |
| `GET /bootstrap/status` | stage `ready`, `provision_token: active`, no secret in the body |
| `POST /bootstrap/provision` (token) | 200, operator token returned; same token again 410 |
| `POST /bootstrap/operator/reset-accounts` (operator token) | 200, 8 usernames and roles, no password |
| `POST /bootstrap/operator/mint-code` without a token | 401 |
| `verify-roles.mjs` with `OPERATOR_TOKEN_FILE`, `FINALIZE=1` | code minted and read once (second use 410), 8 accounts PASS, accounts reset, final code minted |
| status afterwards | `provision_token: used` |

Tests: `server/tests/test_bootstrap_operator.py` (single use, expiry, lockout, HTTPS only, no key
or token echoed in responses or the audit log, operator token or super_admin only, admin refused,
GPU stop gated), `test_bootstrap_provision.py::test_service_client_gets_only_user_management_in_this_realm`,
`deploy/aws/test-with-moto.sh` (user-data clones the repo, carries the provision token and no API key).

## 5. Live verification checklist (launch session)

Follow `deploy/aws/README.md` steps 1 to 9. Record here: instance id, type, region, Elastic IP,
URL, `verify-roles.mjs` output with `START_CASE=1`, the Lambda instance id of the GPU worker the
case start launched, its stop through `/bootstrap/operator/gpu/stop` and the Lambda API answer
showing it `terminated`, and the final code printed by `verify-roles.mjs` with `FINALIZE=1`. Screenshots go to
`docs/review/evidence/09-production-live/`.

### Launch attempt 2026-10-21 (cloud session): stopped at step 3

- Step 1: the IAM keys authenticate as `user/acudx-deploy` only when `AWS_SESSION_TOKEN` is
  not set. The session carried an unrelated session token that made STS answer
  `InvalidClientTokenId`. Long-lived IAM user keys take no session token: run the scripts with
  `env -u AWS_SESSION_TOKEN` (or unset it) in such a session.
- Step 2: outbound TCP 22 is blocked from the session (tested against github.com and an
  AWS eu-central-1 address); egress goes only through the HTTPS proxy (egress IP
  160.79.106.142). Per the README the run stopped here: provision, verify and rotate all need
  SSH to the host, and with no instance profile SSM Run Command is not an alternative.
- Step 3: `shellcheck -x` clean; `DRY_RUN=1 provision.sh` exit 0, no secret value in output.
- Steps 4 to 8 not run. No AWS resource was created (no security group, key pair, Elastic IP
  or instance) and no Lambda worker was launched.
- Resolution: the AWS path is now SSH-free (section 4); the scripts drop a stray session token
  when the access key is a long-term `AKIA` key. Re-run `deploy/aws/README.md` from step 1.

### Launch 2026-10-21 (cloud session, user-approved commands): live

Host: EC2 `i-0edbc807a19024f48`, t3.large, eu-central-1 (about 0.096 USD per hour on demand,
plus gp3 and public IPv4), Elastic IP 63.178.127.100 (`eipalloc-0001501d370fdb563`), URL
`https://63.178.127.100.sslip.io/`, deployed commit `cff3c64`. Security group, key pair and
Elastic IP reused from the previous session. Operator token: `~/.ssh/acudx-web-prod-operator.token`
(0600, session container) and SSM SecureString `/acudx/acudx-web-prod/operator_token`.

| README step | Result |
|---|---|
| 1 credentials | `user/acudx-deploy`, account 235229001983 |
| 2 keys | `LAMBDA_KEY` and `ANTHROPIC_KEY` present; both sent at provision (`applied: anthropic, lambda`) |
| 3 static checks | shellcheck clean; `DRY_RUN=1` exit 0 |
| 4 permission check | `RunInstances would succeed` |
| 5 launch | cloud-init, build, `ready` in about 13 min; provision token used, then 410 |
| 6 verify (`START_CASE=1 FINALIZE=1`) | 8 accounts PASS (76 checks); case start HTTP 200 on Claude; accounts reset; final code minted |
| 6 GPU worker (operator routes) | launched by `POST /api/admin/gpu/start` (super_admin bearer, Claude configured so a case start launches none), seen by `GET /bootstrap/operator/gpu` (gpu_1x_a10, us-east-1, booting), stopped by `POST /bootstrap/operator/gpu/stop` (terminated) |
| 7 Lambda API | both `acudx-worker-*` (the one above and the one the defect below launched) terminating, then none listed; other instances untouched |
| 8 hand over | `/bootstrap/credentials` with the final code (not opened by the session) |
| 9 teardown | not run (not asked) |

Live-site checks: 8 roles land on their panels; `/idp/admin/` 404; `http://` 308 to `https://`;
anonymous case start 401; anonymous `mint-code` 401; reused provision token 410; a student
generated a fever case (opening ready in 7 s) and the typed question "When did your fever start,
and how high has it been?" got an in-character reply from the patient (provider anthropic).

Defects the run found:

- The boot probe of the anthropic row ran before `/bootstrap/provision` sent the key and stored
  `last_probe_ok=false` ("key not configured"). Sealing the key left that result in place, so
  `anthropic_enabled()` stayed false: case starts answered `model_warming` and launched a GPU
  worker although Claude was configured (stopped at once). Fix: `RegistryStore.update_provider`
  clears the probe result when the key, base URL or model changes
  (`test_new_key_url_or_model_clears_a_stale_probe_result`). This host runs the earlier commit;
  it was put right by re-running the provider probe from the admin API (ok, 200). A new launch
  carries the fix.
- `verify-roles.mjs` counted the anthropic edit button while the providers table still showed
  its skeleton (one false FAIL); it now waits for the row.

Evidence: `docs/review/evidence/09-production-live/` (the anthropic drawer shot is not committed:
it shows the key's last four characters).

### Patient video on the production path (2026-10-21, after the launch)

The live site showed a still portrait for the call (no voice, no lip sync, no case signs). The causes,
found on a local copy of this stack with real Lambda workers and fixed on the branch, are in
docs/architecture/18 section 6.7: a 24 GB A10 chosen as the cheapest card, no case portraits in the
gateway image, no worker at case start, the ladder giving up before the edit server was up, the idle
reaper stopping a worker the learner was waiting for, the voice image failing on a PPA outage, the first
request after a reload going out without a bearer, and an orphan sweep that would stop another gateway's
workers. A redeploy of the live host picks them up; `AVATAR_PREWARM_ON_CASE_START` is on in
docker-compose.prod.yml. The live site itself was not signed in to for this work.

### Redeploy 2026-10-21 to 7bbd84c (user-approved terminate and relaunch)

The user approved replacing the live host so it carries the fixes from their live test. The old
instance `i-0edbc807a19024f48` (cff3c64) was terminated after `/bootstrap/operator/gpu/stop` (no
worker running). The Elastic IP 63.178.127.100, security group and key pair were kept.
`provision.sh` launched `i-05722e5305a69cc12` (t3.large, eu-central-1) at `7bbd84c`. It was ready
in about 14 min, and both keys were sent at provision (`applied: anthropic, lambda`). The Claude
route was selected from the first case start, so the stale-probe fix (88e2f03) holds. Lambda had
one instance not owned by this gateway (`PRP-ICU-MODEL`); it was left alone (no
`GPU_SWEEP_UNOWNED`).

| Check | Result |
|---|---|
| `verify-roles.mjs` `START_CASE=1 FINALIZE=1` | PASS, 8 accounts, 76 checks; case start HTTP 200 on Claude; accounts reset; final code minted |
| 8 roles land on their panels; UI and API gates | PASS |
| `/idp/admin/` 404, `http://` 308 to https, anonymous case start 401, anonymous mint-code 401, reused provision token 410 | PASS |
| Student in TR, stat lab | PASS: Laktat ordered from İstemler (chemistry, 50 min sim turnaround) landed as `Sonuçlandı` after 45 s real time (lab wait cap 45 s, scale 6); 6.2 mmol/L flagged HH |
| Guidance (Rehberlik), septic shock case | PASS: cited card (sepsis risk criteria) with NICE NG253 pill, verified 2026-10-19, and Surviving Sepsis Campaign 2021 sources |
| Patient video call: warming panel | PASS: `live-start-panel` stages starting, video_services (Adım 2/3), preparing (Adım 3/3), connecting |
| Patient video call: live, talking, lip-synced, audio | PASS: webrtc mode, "Canlı video", audio from the GPU worker (Chatterbox multilingual), MuseTalk 1.5 video. A typed TR question got an in-character spoken reply (12.6 s audio, 632 frames, first frame 2.7 s; tile: first frame 3921 ms, speech start 3934 ms, audio-to-lip −520 ms). Live audio track on an unmuted audio element; mouth region moves for the length of the reply only |
| Video timing, cold worker | Prewarm launched at case start (20:53:57 UTC), machine ready +6 min, call clicked 21:01:01, live video 21:11:09: 606 s after the click, about 17 min 20 s from cold |
| GPU workers | One `acudx-worker-*-gebcbd193-*` (gpu_1x_a100_sxm4, us-east-1) launched by the prewarm, stopped with `/bootstrap/operator/gpu/stop`; Lambda API then listed no instance. GPU spend that day about 0.73 USD |

How the run was driven: a student session in Chromium through the real UI. Only the generate
request had `blueprint.condition_id` added (septic_shock for the guidance and lab checks, then
migraine for the spoken reply, because the untreated septic-shock patient was in arrest by then).

Defects and observations (not fixed in this run):

- Avatar cross-fade ghosting: when the call switches between the idle loop and a speaking clip,
  the two clips have different framing (wider neutral face vs closer pained face), so one or two
  frames show a double image (`tr-video-crossfade-ghosting.png`).
- Mojibake seen once in the patient status line under the name while the Director was updating
  ("korkmuEџ … kafasД± karДџД±k", UTF-8 read as Windows-1251; `tr-status-line-mojibake.png`). It
  was not in the stored case or the page a minute later, and the web client decodes UTF-8
  everywhere. Not reproduced; source unknown.
- A first `FINALIZE` run failed only the student, because the session's own sign-in had already
  used the student's temporary password after the last reset. Resetting first and re-running
  passed. Not a site defect.

Evidence: `docs/review/evidence/09-production-live/tr-*.png` and the role screenshots (the
anthropic key drawer shot is again left out).

### Follow-up on the live findings (2026-10-21, private gateway and Lambda workers, not the live site)

The five findings above were reproduced and fixed on a private gateway with Claude and two Lambda A100
40 GB workers (2.37 USD); details in docs/architecture/18 sections 6.3.9, 6.6.1 and 6.8, evidence in
docs/media/live-avatar/prod-path-v2/. The live site was not touched; a redeploy carries the fixes.

| Finding | Cause | Now |
|---|---|---|
| Reply latency 12.6 s | guard, whole Opus reply, a second request, TTS, one after another | reply streamed into the call clause by clause, persona started next to the guard; EN 1.8 to 2.5 s; TR 5.5 s (worker Chatterbox on a 40 GB card) |
| Lips -520 ms | a picture switch mid-reply with other framing, meter window cut short | switches wait for silence, one frame for every picture, whole-line meter, closed loop, paced audio: EN 0 to +40 ms on six of six lines, TR five of six inside ±80 ms |
| Cross-fade ghost | edits shifted and scaled, fade from a frozen frame | edits registered onto the portrait, faded on matched loop frames; a pair whose framing still differs is cut (9f843ed's safety net) |
| Cold start 17 min 20 s | three images built on every boot, serial start | content-keyed images from the registry or the Lambda filesystem, parallel start: 8 min 5 s to a ready worker from the cache; the call then still takes about 90 s |
| Mojibake | the narrator model returned mood_tr already mis-decoded (found by 7ef1701); no decode of ours gives Windows-1251 | the Director repairs or drops such text (7ef1701); in addition every gateway text reply names `charset=utf-8` and worker replies are decoded as UTF-8; tests with ı ş ğ ü ö ç İ |


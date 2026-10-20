# AcuDx Backend Gateway

The FastAPI gateway in front of AcuDx's model, voice, results, guideline,
identity and GPU providers. It is a small, async, typed app that **calls**
endpoints and never loads a model itself. Every model call flows through one
component (`ModelGateway`), which is where the **air-gapped, zero-egress**
invariant is enforced, and every provider is resolved from the admin registry.

> Education only. Synthetic patients only. No real patient-data path.

## How it maps to `docs/architecture`

| Module | Doc | What it realises |
|---|---|---|
| `config.py` | `02`, `12` | `pydantic-settings` config + the **no-egress guard**: under `AIRGAPPED` it refuses to resolve any non-local endpoint before a socket opens. |
| `model_gateway.py` | `02` | The **only path to a model**: async `chat()` over OpenAI-compatible `/v1/chat/completions`, retries, timeouts, tier map, `embed()` / `rerank()` adapters. |
| `scope_guard.py`, `persona.py` | `13`, `01` | Deterministic Scope and Injection Guard (EN + TR); two-tier persona boundary and the post-generation FactAssertionGate. |
| `orchestration/` | `15` | Case generator v2 (LangGraph graph, three-judge council, repair) and the Clinical Director; SQLite checkpoints and learner memory. |
| `results/`, `results_routes.py` | `14` | Results engine: sourced reference ranges, kinetics, synthesized 12-lead ECG, verified image bank with laterality guard. |
| `guidelines/`, `grounding.py` | `16` | Verified `GuidelineStatement` store, verifier, attending tips, `/v1/ground`. |
| `registry/`, `telemetry/` | `17` | Provider registry (keys sealed with Fernet), admin console API, per-call cost rows, optional OTel spans. |
| `voice/` | `18` | `/v1/voice/*`: TTS, STT, capabilities and the LiveKit room token, resolved from the registry. |
| `auth/`, `learning/` | `19` | OIDC token verification (JWKS), roles from claims unioned with `user_roles`, hash-chained encounter events, dean and faculty routes. |
| `providers/` | `12`, section below | Lambda Cloud client and the on-demand GPU worker manager. |
| `app.py` | `10` | Mounts every router above plus `/health`, `/status`, `/v1/guard`, `/v1/patient/turn`, `/v1/grade`, `/v1/case/generate` (v1), `/v1/ground`. |

## Endpoints

Routers mounted in `app.py` (paths as declared in each `routes.py`). Routes under `/admin/*` need `X-Admin-Token` (or an admin bearer token); when `ADMIN_TOKEN` is unset they answer `503`.

| Area | Routes |
|---|---|
| Core | `GET /health`, `GET /status`, `POST /v1/guard`, `POST /v1/patient/turn`, `POST /v1/grade`, `POST /v1/case/generate` (v1, single call), `POST /v1/ground` |
| Case generator v2 (`orchestration/routes.py`) | `POST /v2/case/generate`, `POST /v2/case/generate/stream`, `POST /v2/case/template` (labelled `meta.source = "template"`), `GET /v2/case/{thread_id}`, `POST /v2/director/step`, `GET /v2/learner/{learner_id}` |
| Results (`results_routes.py`) | `POST /v1/results/resolve`, `POST /v1/results/ecg`, `GET /v1/results/reference-ranges`, `GET /v1/imaging/resolve` |
| Guidelines (`guidelines/routes.py`) | `GET /v1/guidelines/statements`, `GET /v1/guidelines/statements/{id}`, `GET /v1/guidelines/tips`, `POST /admin/guidelines/verify` |
| Voice (`voice/routes.py`) | `POST /v1/voice/tts`, `POST /v1/voice/stt`, `GET /v1/voice/capabilities`, `POST /v1/voice/room`, `GET /admin/voice/agent-config` |
| Identity (`auth/routes.py`) | `GET /v1/auth/config`, `GET /v1/auth/me`, `GET /admin/users`, `PUT /admin/users/{sub}/roles`, `DELETE /admin/users/{sub}` |
| Learning and panels (`learning/routes.py`) | `POST /v1/events/encounter`, `GET /v1/me/assignments`, `GET /v1/dean/cohort`, `GET /v1/dean/export`, `GET /v1/dean/chain`, `GET /v1/faculty/queue`, `POST /v1/faculty/review/{batch_id}`, `POST /v1/faculty/cases/submit`, `POST /v1/faculty/cases/{id}/decide`, `POST /v1/faculty/assign`, `GET /v1/faculty/assignments`, `GET /v1/faculty/roster` |
| Registry and telemetry (`registry/routes.py`) | `GET/POST /admin/providers`, `GET/PUT/DELETE /admin/providers/{id}`, `POST /admin/providers/{id}/probe`, `GET/PUT /admin/settings`, `GET /admin/health`, `GET /admin/telemetry/summary`, `GET /admin/telemetry/gpu` |
| GPU worker (`admin_routes.py`) | `GET /admin/gpu/status`, `POST /admin/gpu/start`, `POST /admin/gpu/stop`, `GET /admin/gpu/boot-log`, `GET /admin/gpu/ledger`, `GET/PUT /admin/gpu/policy` |

### `POST /v1/patient/turn` request

```json
{
  "learner_msg": "When did the chest pain start?",
  "case_state": {
    "persona": {"name": "Rosa", "age": 71, "affect_baseline": "frightened"},
    "narrative": ["heavy chest tightness", "breathless on minimal effort"],
    "sanctioned_facts": []
  },
  "history": [{"role": "assistant", "content": "It hurts to breathe, doctor."}],
  "case_context": {"scope_terms": ["chest pain", "myocardial infarction"]}
}
```

`sanctioned_facts` are the only clinical values the patient may state this turn
(e.g. `"The nurse says your oxygen is 88%"`). Any number the model invents that
is **not** in that set is flagged and neutralised by the FactAssertionGate.

## Configuration (env / `.env`)

Every field of `Settings` in `config.py`, overridable by the env var of the same name (case-insensitive). Providers configured in the admin registry take precedence over the LLM env fields at resolution time.

| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `local` | `local` \| `api`. `api` uses `OPENAI_*` and is blocked by the egress guard while `AIRGAPPED=true`. |
| `LLM_BASE_URL` | `http://127.0.0.1:3040/v1` | Local OpenAI-compatible server. |
| `LLM_MODEL` | `qwen2.5-7b-instruct` | |
| `LLM_API_KEY` | `sk-local` | Sent as Bearer; llama-server ignores it. |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | unset | API fallback, selected by `LLM_PROVIDER=api`. |
| `CASEGEN_BASE_URL` / `CASEGEN_MODEL` / `CASEGEN_API_KEY` | unset (inherit LLM) | Endpoint for the case author and repair nodes. |
| `JUDGE_BASE_URL` / `JUDGE_MODEL` / `JUDGE_API_KEY` | unset (inherit LLM) | Endpoint for the judge council and the Director narrator. |
| `ACUDX_DB_PATH` | `server/data/acudx.db` | SQLite: LangGraph checkpoints, learner memory, GPU state and ledger, registry, telemetry, users, events. |
| `EMBED_URL` / `EMBED_DIM` / `EMBED_MODEL` | `http://127.0.0.1:8003` / `768` / `ytu-ce-cosmos/modernbert-tr-embed` | Embedding side-car. |
| `RERANK_URL` / `RERANK_MODEL` | `http://127.0.0.1:8004` / `ytu-ce-cosmos/modernbert-tr-reranker` | Reranker side-car. |
| `AIRGAPPED` | `true` | Refuse any non-local endpoint (no egress). Compose sets `false`. |
| `LOCAL_ALLOWLIST` | empty | Extra hosts or CIDRs treated as local. CSV or JSON list. |
| `HOST` / `PORT` | `127.0.0.1` / `8890` | |
| `CORS_ORIGINS` | empty | Extra origins; localhost and 127.0.0.1 on any port are always allowed. CSV or JSON. |
| `REQUEST_TIMEOUT_S` / `CONNECT_TIMEOUT_S` / `PROBE_TIMEOUT_S` / `MAX_RETRIES` | `60` / `5` / `2` / `2` | httpx tuning. |
| `STATUS_DISK_PATH` | `/data` | Falls back to `/` if absent. |
| `AUTH_MODE` | `local` | `local` (unverified local profiles, `X-Auth-Mode: local`) \| `oidc` (verified bearer JWT required). The registry setting `auth_mode` overrides it. |
| `ACUDX_SECRET_KEY` | unset | Fernet key sealing provider API keys at rest; unset means keys cannot be stored (never plaintext). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | When set, every gateway call emits an OpenTelemetry `gen_ai.*` span (deps in `requirements-telemetry.txt`). |
| `ADMIN_TOKEN` | unset | Guards `/admin/*`; unset means `503`. |
| `PROBE_INTERVAL_MINUTES` | `10` | Enabled provider rows are probed on this schedule (`server/registry/jobs.py`); `0` disables. |
| `RETENTION_PURGE_INTERVAL_MINUTES` | `60` | How often `model_calls` rows older than the console's `telemetry.retention_days` are purged; `0` disables. |
| GPU worker vars | see the table below | `LAMBDA_KEY`, `LAMBDA_SSH_KEY_NAME`, `GPU_*`. |

## Run

```bash
# From the repo root:
python -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt

# llama-server + embed/rerank side-cars are started separately, then:
bash server/run.sh
#   -> uvicorn server.app:app --host 127.0.0.1 --port 8890

# Self-test the guard with no server / no venv beyond stdlib+regex:
python -m server.scope_guard
```

`run.sh` respects `HOST` / `PORT` and forwards extra args to uvicorn
(e.g. `bash server/run.sh --reload` in dev).

Tests: `pip install -r server/requirements-dev.txt && python -m pytest server/tests -q` (`pytest.ini` at the repo root; network is intercepted, nothing is launched).

## On-demand GPU worker (Lambda Cloud)

`server/providers/gpu_worker.py` launches a single GPU worker **only when a
request needs one and no healthy worker exists**, and the idle reaper (an
asyncio task started in the app lifespan) terminates it after
`GPU_IDLE_MINUTES` without a request. There is never an always-on instance.

* Provider client: `server/providers/lambda_cloud.py` (typed `httpx` client for
  `https://cloud.lambda.ai/api/v1`, basic auth with the key as username).
  Response models match live captures in `server/tests/fixtures/lambda/`.
* Instance choice: cheapest allow-listed type that has capacity now
  (default allowlist `gpu_1x_a100_sxm4, gpu_1x_a10, gpu_1x_a100, gpu_1x_h100_pcie`),
  optionally restricted/ranked by `region_preference`.
* Budget: a launch is refused when `spent_today + one projected hour` would
  exceed `daily_budget_usd` (UTC day). Spend is computed from the ledger.
* Worker image: `infra/gpu-worker/cloud-init.yaml` (vLLM + Kokoro TTS +
  speaches STT behind Caddy on `<ip-with-dashes>.sslip.io`, every route needs
  `Authorization: Bearer <token>`; the token is `secrets.token_urlsafe(32)`,
  generated per launch and stored server-side only). The manager appends
  tcp/80 and tcp/443 from `0.0.0.0/0` to the account firewall if missing
  (`PUT /firewall-rules` replaces everything, so existing rules are kept).
  Because the public IP exists only after launch, the manager renders
  `WORKER_DOMAIN=auto` and the worker derives its own sslip.io name at boot.
* Readiness: poll `GET /instances/{id}` until `active` with an IP, then
  `GET https://<domain>/healthz` until 200. Worker endpoints:
  `/v1` (OpenAI-compatible, served model `acudx-llm`), `/tts/v1/audio/speech`,
  `/stt/v1/audio/transcriptions`.
* Persistence: SQLite at `ACUDX_DB_PATH` (default `server/data/acudx.db`):
  tables `gpu_workers`, `gpu_ledger` (cost per run, reason: `idle`, `admin`,
  `boot_timeout`, …) and `gpu_policy` (admin overrides).
* **AIRGAPPED=true (default) fails closed**: `ensure_worker()` raises
  `AirgappedRefused` and `/admin/gpu/status` reports `can_launch: false` with
  the reason. Set `AIRGAPPED=false` explicitly to allow Lambda Cloud egress.

### Env

| Var | Default | Meaning |
|---|---|---|
| `LAMBDA_KEY` (alias `LAMBDA_API_KEY`) | unset | Lambda Cloud API key |
| `LAMBDA_SSH_KEY_NAME` | unset | name of exactly one registered ssh key |
| `GPU_IDLE_MINUTES` | `20` | idle window before termination |
| `GPU_READY_TIMEOUT_S` | `2700` | how long a fresh worker may take to pass /healthz before it is terminated (cold boot pulls the vLLM image and the model weights) |
| `GPU_FILE_SYSTEM_NAME` | unset | Lambda file system to attach at launch (pre-baked weights shorten the cold start) |
| `GPU_BOOT_TIMEOUT_S` | `900` | how long the provider may take to report the instance active with an IP |
| `GPU_DAILY_BUDGET_USD` | unset | optional daily cap in USD; unset means no cap (idle workers still stop after `GPU_IDLE_MINUTES`) |
| `GPU_LLM_MODEL` | `Qwen/Qwen3-32B-AWQ` | model vLLM loads on the worker |
| `GPU_INSTANCE_ALLOWLIST` | see above | CSV or JSON list |
| `GPU_REGION_PREFERENCE` | empty | CSV or JSON list, ordered |
| `ADMIN_TOKEN` | unset | guards `/admin/*`; unset → `503` |
| `ACUDX_DB_PATH` | `server/data/acudx.db` | SQLite path |

### Admin API (`X-Admin-Token: $ADMIN_TOKEN`)

| Route | Purpose |
|---|---|
| `GET /admin/gpu/status` | worker (no token), policy, spend today, `can_launch` + refusal reason |
| `POST /admin/gpu/start` | `ensure_worker()`; `409 {reason: airgapped|not_configured|budget_exceeded|no_capacity|worker_failed}` |
| `POST /admin/gpu/stop` | terminate the active worker (ledger reason `admin`) |
| `GET /admin/gpu/ledger?limit=` | cost ledger entries + `spent_today_usd` |
| `GET/PUT /admin/gpu/policy` | `idle_minutes`, `daily_budget_usd`, `allowlist`, `llm_model`, `region_preference` |

Tests: `python -m pytest server/tests -q` (deps in `server/requirements-dev.txt`;
network is intercepted with `respx`, nothing is launched).

## Air-gap behaviour

`AIRGAPPED=true` (the default) makes the gateway the single enforcement point:
resolving the LLM endpoint runs `guard_egress()`, and every `chat()` / `embed()`
/ `rerank()` re-checks per call. A config that points at a public host raises
`EgressBlocked` **at startup** (or per request) rather than dialling out — the
same welded-shut posture as the air-gapped reference architecture (`12`).

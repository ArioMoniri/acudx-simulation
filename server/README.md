# AcuDx Backend Gateway (Phase-0 / MVP)

The **pod-side chokepoint** in front of AcuDx's local, open-weight model stack.
It is a small, async, typed FastAPI app that **calls** model endpoints — it never
loads a model itself, so it stays resource-light and starts in well under a
second. Every model call flows through one component (`ModelGateway`), which is
where the **air-gapped, zero-egress** invariant is mechanically enforced.

> Education only. Synthetic patients only. No real patient-data path.

## How it maps to `docs/architecture`

| Module | Doc | What it realises |
|---|---|---|
| `config.py` | `02 §13.1.2`, `12` | `pydantic-settings` config + the **no-egress guard**: under `AIRGAPPED` it refuses to resolve any non-local LLM/embed/rerank endpoint (fails closed at resolution time, before a socket opens). |
| `model_gateway.py` | `02 §1–5, §10` | The **only path to a model**. Async `chat()` over OpenAI-compatible `/v1/chat/completions`, robust parsing (`content` **or** `reasoning_content`, `<think>…</think>` stripped), retries + timeouts, a per-task **tier map** (`patient`/`guard`/`grade`) structured for future T1→T2→T3 routing, and thin defensive `embed()`/`rerank()` adapters. |
| `scope_guard.py` | `13 §3` | The **Scope & Injection Guard** — deterministic, pure, local. Classifies every learner utterance into `in-scope` / `off-topic` / `answer-seeking` / `injection` / `unsafe` (EN + TR). Hard classes dominate, fail-closed. Ships a `__main__` self-test. |
| `persona.py` | `01 §2, §6`; `13 §4.5` | The **two-tier boundary** for the roleplay layer: `build_patient_turn()` injects a "KNOWN CASE FACTS" block and forbids the persona from sourcing clinical facts; `fact_assertion_gate()` is the post-generation **FactAssertionGate** that flags/strips any unsanctioned number, dose, or diagnosis. |
| `app.py` | `13 §1`, `02`, `05` | The HTTP surface wiring guard → route-by-class → persona + gateway → FactGate, plus `/health`, `/status`, and a lazy delegation to the sibling-owned grounding engine. |

Sibling-owned (imported by name, not written here): `grounding.py`,
`guidelines_seed.py`, `deploy.sh`, `smoke_test.py`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + resolved provider/model + `airgapped` flag. |
| `GET`  | `/status` | `{disk, ram}` (from `statvfs('/data')` + `/proc/meminfo`) and reachability of the LLM / embed / rerank pods. |
| `POST` | `/v1/guard` | `{text, case_context?}` → `{cls, score, rationale, action, layers}`. |
| `POST` | `/v1/patient/turn` | Guard the utterance; **injection/unsafe** are blocked deterministically (no LLM); soft classes go to the persona model, then through the FactAssertionGate. |
| `POST` | `/v1/ground` | Delegates to `server.grounding.ground()` (lazy import → `503` if unavailable). |

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

| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `local` | `local` \| `api`. `api` uses `OPENAI_*` and is blocked by the egress guard while `AIRGAPPED=true`. |
| `LLM_BASE_URL` | `http://127.0.0.1:3040/v1` | Local llama-server (Qwen2.5-7B-Instruct). |
| `LLM_MODEL` | `qwen2.5-7b-instruct` | |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | — | API fallback, selected by `LLM_PROVIDER=api`. |
| `EMBED_URL` | `http://127.0.0.1:8003` | modernbert-tr-embed (dim 768). Payload shape is probed defensively. |
| `RERANK_URL` | `http://127.0.0.1:8004` | query+docs → scores. |
| `AIRGAPPED` | `true` | When true, refuse any non-local model endpoint (no egress). |
| `LOCAL_ALLOWLIST` | _(empty)_ | Extra hosts/CIDRs treated as local (in-VPC GPU pool). Comma-sep or JSON. |
| `HOST` / `PORT` | `127.0.0.1` / `8890` | |
| `CORS_ORIGINS` | _(empty)_ | Extra origins; localhost/127.0.0.1 (any port) are always allowed for the tunnelled web demo. |
| `STATUS_DISK_PATH` | `/data` | Falls back to `/` if absent. |

The embed/rerank services already run on the pod. Their exact request/response
shapes should be **confirmed at deploy time**; `model_gateway._parse_embeddings`
/ `_parse_rerank` already try the common shapes, so any fix is a one-liner.

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
| `GPU_BOOT_TIMEOUT_S` | `900` | how long the provider may take to report the instance active with an IP |
| `GPU_DAILY_BUDGET_USD` | `25.0` | hard daily cap |
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

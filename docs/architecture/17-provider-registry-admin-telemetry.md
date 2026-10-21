# 17. Provider registry, admin console and per-call telemetry

Status: implemented (server/registry, server/telemetry, web/src/pages/AdminPage.tsx). Owner: Fullstack engineer. Related: 02 (model gateway), 12 (air-gapped reference), 16 research (provider prices, telemetry stack), review 01 section 4.

## 1. Why

Protocol rule 2.3: every provider (model, voice, video, imaging, identity, GPU) is configured in the admin panel and persisted server-side, and no key is ever shipped to the browser. Before this wave the gateway read one LLM endpoint from environment variables and nothing recorded what a model call cost. This document describes the runtime registry that replaces env-only configuration, the admin API and console that operate it, and the telemetry that prices every call.

## 2. Components

```
web/src/pages/AdminPage.tsx            /admin (RoleGate admin) -> token gate -> 5 tabs
web/src/components/admin/*             Overview, Providers (+drawer), GPU, Telemetry, Settings
web/src/components/charts/*            evilcharts (MIT) Recharts compositions on AcuDx tokens
web/src/lib/adminApi.ts                typed client, X-Admin-Token from sessionStorage only
web/src/lib/adminCharts.ts             pure data shaping for charts and tables

server/registry/store.py               SQLite `providers` + `settings`, Fernet at rest
server/registry/resolve.py             resolve(kind): priority, air-gap, probes, GPU fallback
server/registry/probe.py               real health calls, 5 s budget, result persisted
server/registry/routes.py              /admin/providers, /admin/settings, /admin/health, /admin/telemetry/*
server/telemetry/prices.py             versioned USD per 1M token table (2026-10-19)
server/telemetry/events.py             `model_calls` rows, request context, summary math, OTel spans
server/model_gateway.py                resolves through the registry, records every call
server/admin_routes.py                 unchanged: /admin/gpu/* and the X-Admin-Token guard
```

All server state lives in one SQLite file, `ACUDX_DB_PATH` (default `server/data/acudx.db`), next to the GPU worker tables from document 16.

## 3. Data model

### 3.1 `providers`

| column | notes |
|---|---|
| id | autoincrement |
| kind | one of `llm`, `embed`, `rerank`, `stt`, `tts`, `avatar`, `imaging`, `identity`, `telemetry` (CHECK constraint) |
| name | operator label, shown in telemetry |
| base_url | http(s) URL, trailing slash stripped |
| model | served model id, optional |
| api_key_encrypted | Fernet token or NULL |
| key_last4 | last four characters of the plaintext key, for the UI hint only |
| region | free text |
| enabled | 0/1 |
| priority | lower wins; seeded local rows are 0, hosted fallbacks 10, new rows default 100 |
| extra | JSON object for provider-specific options |
| created_at, updated_at | epoch seconds |
| last_probe_at, last_probe_ok, last_probe_latency_ms, last_probe_error | written by POST /probe |

### 3.2 `settings`

`key TEXT PRIMARY KEY, value TEXT (JSON), updated_at`. The console writes `budgets.llm_daily_usd`, `telemetry.retention_days`, `locale.default`, `operator.contact` and any raw keys the operator adds. PUT merges per key.

### 3.3 `model_calls`

One row per gateway attempt: `ts, kind, provider, model, tokens_in, tokens_out, cached_tokens, latency_ms, cost_usd, price_version, route, tenant, user_hash, encounter_id, ok, error`. Indexed on `ts`.

## 4. Secrets

* Keys are sealed with `cryptography.fernet.Fernet` using `ACUDX_SECRET_KEY`. Generate one with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and keep it out of git.
* Without the key the store raises `SecretKeyMissing`; the API answers 409 with the instructions above and the console shows a banner. Providers without a key can still be saved, so a local llama-server deployment works with no secret configured.
* The gateway logs the instructions at startup when the key is unset.
* API responses carry only `has_key` and `key_last4`. The ciphertext never leaves the process; `ProviderRecord.__repr__` and `ProviderEndpoint.__repr__` hide it from logs.
* The console's key field is a write-only password input. On edit it starts empty; leaving it empty keeps the stored key, typing replaces it, a checkbox clears it (`api_key: ""`).
* The admin token itself is held in `sessionStorage` only and sent as `X-Admin-Token`; it is never written to localStorage or a cookie.

## 5. Resolution

`RegistryResolver.resolve(kind)`:

1. Enabled rows of that kind ordered by `priority, id`.
2. Under `AIRGAPPED=true`, rows whose host fails `config.is_local_endpoint` (loopback, private, link-local, or in `LOCAL_ALLOWLIST`) are refused. The check is shared with the existing egress guard so there is one definition of "local".
3. Rows whose last probe failed are skipped. An unprobed row is eligible, so a freshly added provider works before anyone presses Probe.
4. For `llm` only, when the list is empty and a worker manager is wired, `worker_manager.ensure_worker()` launches or reuses the on-demand GPU worker (document 16) and its `/v1` endpoint is returned with `source="gpu_worker"`. `WorkerRefused` (air-gapped, not configured, budget, no capacity) yields `None`.
5. The gateway calls `resolver.touch(endpoint)` after every call; for a worker endpoint this resets the idle window.

Env seed: on the first start with an empty table the gateway imports `LLM_*` (and `OPENAI_*` when set), `EMBED_URL` and `RERANK_URL` as rows tagged `extra.seeded_from = "env"`. If a seeded row has no sealed key (no secret key yet, or the dummy `sk-local`), the resolver reads the key from the environment at call time, so existing deployments keep working untouched. The seed never runs again once a row exists.

The gateway without a resolver (unit tests, scripts) keeps the env-only behaviour of document 02.

## 6. Probes

`POST /admin/providers/{id}/probe` performs a real HTTP GET with a 5 s timeout against kind-specific paths: `/models` for OpenAI-compatible kinds, `/v1/projects` (Deepgram style) for STT, `/v1/user` then `/v1/models` for TTS, `/health` for avatar, `/.well-known/openid-configuration` for identity, `/api/public/health` for a Langfuse sink. Auth headers follow the kind (`Authorization: Bearer`, `Token`, or `xi-api-key`). The air-gap guard runs before any socket opens and reports `EgressBlocked`. Model ids from a `/models` reply are returned so the UI can show what the endpoint serves. The outcome is written on the row and feeds resolution rule 3.

`server/registry/jobs.py` runs the same probe on a schedule: `ProbeScheduler` probes every enabled row every `PROBE_INTERVAL_MINUTES` (default 10, `0` disables) from the app lifespan, so `last_probe_*` and `/admin/health` stay current without an operator pressing Probe. Disabled rows are skipped; the status of the job (runs, last run, last result, last error) is reported under `jobs.provider_probe` in `/admin/health`.

## 7. Telemetry

* `TelemetryRecorder.record()` is called by `ModelGateway.chat`, `embed` and `rerank` on success and on failure. Token counts come from the provider's `usage` block (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`).
* Cost is computed once, in the gateway, from `server/telemetry/prices.py`. The table is versioned (`PRICE_TABLE_VERSION = "2026-10-19"`), every row cites its source page, cached input tokens use the discounted rate when the provider publishes one, and self-hosted endpoints (`local`, `gpu_worker`, env seeds) cost 0 because their money is accounted by the hour in `gpu_ledger`. The billing slug is derived from the endpoint host (`api.deepinfra.com` to `deepinfra`) so operators can name rows freely.
* Request context (`route`, `tenant`, `user_hash`, `encounter_id`) is bound per request by a FastAPI middleware through a `contextvars` slot (`call_context`). User ids arrive as `X-User-Id` and are stored as a 16-hex SHA-256 prefix; `X-Tenant` and `X-Encounter-Id` pass through. Education only, no PHI path.
* When `OTEL_EXPORTER_OTLP_ENDPOINT` is set and `server/requirements-telemetry.txt` is installed, each call also emits one span named `gen_ai.<operation> <provider>` with `gen_ai.system`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cached_input_tokens` and `acudx.*` attributes (cost, route, tenant, encounter, price version). The import is optional; the gateway runs without the SDK.
* Retention: `RetentionPurger` (`server/registry/jobs.py`) reads `telemetry.retention_days` from the settings table (the console's nested `telemetry` object or the flat key) every `RETENTION_PURGE_INTERVAL_MINUTES` (default 60) and calls `TelemetryRecorder.purge_older_than(days)`; unset, null or `0` keeps everything. Reported under `jobs.telemetry_retention` in `/admin/health`.
* `GET /admin/telemetry/summary?window=24h|7d|30d` aggregates in Python over the window: calls, errors, error rate, cost, tokens, p50/p95 latency (linear interpolation), by provider / model / route / kind, and a complete bucket series (hourly for 24h, daily otherwise, right-inclusive buckets, empty buckets present). `GET /admin/telemetry/gpu` rolls up `gpu_ledger` by instance type with today, 7 d and 30 d spend.

## 8. Admin API

All routes share the constant-time `X-Admin-Token` guard from `server/admin_routes.py` (503 when `ADMIN_TOKEN` is unset, 401 on a bad token).

| method | path | body / query | result |
|---|---|---|---|
| GET | /admin/providers | `?kind=` | `{providers[], kinds[], secrets_configured}` |
| POST | /admin/providers | ProviderIn | 201 public view |
| GET, PUT, DELETE | /admin/providers/{id} | ProviderPatch on PUT | public view, 204 on delete |
| POST | /admin/providers/{id}/probe | | probe result |
| GET, PUT | /admin/settings | `{settings: {...}}` on PUT | `{settings}` |
| GET | /admin/health | | `{status, airgapped, secrets_configured, db, providers, gpu, disk, jobs}` |
| GET | /admin/telemetry/summary | `?window=` | summary |
| GET | /admin/telemetry/gpu | `?limit=` | ledger roll-up |
| GET, POST, PUT | /admin/gpu/{status,start,stop,ledger,policy} | | unchanged from document 16 |

## 9. Console

Route `/admin` is behind `RoleGate roles={["admin"]}`; `admin` is a new `ProfileRole`, maps to its own "View as" vantage, and is the only vantage whose nav shows the Admin link. The page opens on a sign-in card; the token is verified with one `GET /admin/health` before anything renders, and a 401 from any later call returns the operator to the gate.

Tabs:

* Overview: health tiles (database, providers, disk, secret storage), 24 h cost, calls, error rate, p95, the active GPU worker with a stop button, calls by kind.
* Providers: kind filter, table with status dot, kind badge, endpoint, model, priority, key hint, last probe, enabled switch (optimistic), probe, edit, delete. The drawer creates or edits one row; the key field is write-only.
* GPU: policy form (idle minutes, daily budget, allow-list, model, region preference), start/stop with the refusal reason surfaced, cost per day chart, ledger table.
* Telemetry: window switch (24h, 7d, 30d), KPI stats, calls over time (stacked succeeded/failed), cost over time, p50/p95 latency, share of cost by provider, calls by provider/model/route.
* Settings: typed fields for the keys the app reads plus a raw JSON editor; saves merge server-side.

Design rules applied: every chart sits in `ChartFrame` with a "View as table" twin (design system section 5), series colours come from the theme tokens so dark mode and the no-colour-alone rule hold (succeeded vs failed also differ by stacking position and legend text), motion follows `prefers-reduced-motion` (evilcharts falls back to no reveal, the drawer drops its transition), the table reflows by hiding secondary columns under 768 px and never scrolls the page sideways, and all strings live in `web/src/i18n/features/admin.{en,tr}.json`.

Charts are the evilcharts shadcn registry items `recharts-area-chart`, `recharts-bar-chart`, `recharts-line-chart`, `recharts-pie-chart` and their registry dependencies, vendored under `web/src/components/charts/` with the MIT header, `@/lib/cn`, React 18 `useContext`, and the AcuDx Tailwind v4 tokens.

## 10. Operations

* First start: set `ADMIN_TOKEN` and `ACUDX_SECRET_KEY`; the env config appears as seeded rows. Add hosted providers in the console; press Probe; the lowest priority reachable row serves traffic.
* Air-gapped pods: leave `AIRGAPPED=true`; hosted rows can exist but are refused at resolution and probe time and show as unreachable.
* Failover: a failed probe removes a row from resolution until the next probe succeeds; the GPU worker is the last resort for `llm`.
* Telemetry export: install `server/requirements-telemetry.txt`, set `OTEL_EXPORTER_OTLP_ENDPOINT` (Langfuse `/api/public/otel` or a collector), restart.

## 11. Tests

* `server/tests/test_registry_store.py`: schema, encryption round trip, public view never leaks, refusal without secret key, update semantics, wrong key, settings, env seed.
* `server/tests/test_registry_resolve.py`: priority order, air-gap refusal and allow-list, probe-aware skipping, env key fallback, GPU worker fallback and touch, frozen endpoint hides key.
* `server/tests/test_registry_routes.py`: guard, CRUD, 409 without secret key, probes via respx (success, failure, non-2xx, air-gap), settings, health, telemetry endpoints, main app mounts.
* `server/tests/test_registry_jobs.py`: scheduled probes touch enabled rows only and persist, the loop runs and stops, interval 0 disables, a failing iteration is recorded and survived; retention setting parsing (nested, flat, null, 0, non-numeric), purge honours the window, `purge_older_than` count and non-positive guard.
* `server/tests/test_telemetry.py`: price table, cost with cached discount, row writes, percentile math, summary math and buckets, OTel span attributes, gateway hooks for chat/embed/rerank, failure rows.
* `web/src/lib/adminApi.test.ts`, `web/src/lib/adminCharts.test.ts`: client headers and error mapping, series and share shaping, ledger folding, formatting, provider tones.

## 12. Open items

* Per-tenant budgets: the summary already groups by tenant-capable columns; the console shows global totals only.
* Jobs run in-process per gateway instance; with several replicas each one probes and purges on its own schedule (harmless, but a leader election or a single jobs replica would avoid duplicate probes).

## 13. Claude route

The Anthropic provider is a registry row too (`name = anthropic`, `extra.api = "anthropic"`, priority 0), created on every start when missing. It is served by `server/providers/anthropic_provider.py`, not by `/chat/completions`, and is reported under `anthropic` in `/admin/providers` and `/admin/health` (`Anthropic key not configured` until `ANTHROPIC_KEY` is set). Model per role, request shape, fallback, cache-aware pricing and the `cache_write_tokens` telemetry column: document 20, section 2.

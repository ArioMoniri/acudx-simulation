"""Reachability probes for registry providers (real HTTP, 5 s budget).

Each provider kind has a documented health path:

* ``llm`` / ``embed`` / ``rerank``: OpenAI-compatible ``GET /models`` (model ids
  are returned so the UI can offer them in the model picker);
* ``stt``: Deepgram-style ``GET /v1/projects`` (any authenticated 2xx);
* ``tts``: ElevenLabs-style ``GET /v1/user`` (falls back to ``/v1/models``);
* ``avatar``: ``GET /health``; ``imaging``: ``GET /``; ``identity``: OIDC discovery
  ``GET /.well-known/openid-configuration``; ``telemetry``: ``GET /api/public/health``
  (Langfuse) with ``/health`` as fallback.

The air-gap guard runs first: a hosted URL under ``AIRGAPPED`` is reported as
``EgressBlocked`` without opening a socket. Results are persisted on the row.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from server import net_guard
from server.config import EgressBlocked, Settings
from server.registry.store import ProviderRecord, RegistryStore

PROBE_TIMEOUT_S = 5.0

# kind -> ordered candidate paths (relative to base_url). First 2xx wins.
HEALTH_PATHS: dict[str, tuple[str, ...]] = {
    "llm": ("/models",),
    "embed": ("/v1/models", "/models", "/health", "/"),
    "rerank": ("/v1/models", "/models", "/health", "/"),
    "stt": ("/v1/projects", "/health", "/"),
    "tts": ("/v1/user", "/v1/models", "/health", "/"),
    "avatar": ("/health", "/healthz", "/"),
    "imaging": ("/", "/health"),
    "identity": ("/.well-known/openid-configuration", "/realms/master", "/"),
    "telemetry": ("/api/public/health", "/health", "/"),
}


def _auth_headers(kind: str, api_key: str | None, base_url: str | None = None) -> dict[str, str]:
    if not api_key:
        return {}
    # An OpenAI-compatible voice row (the GPU worker's Kokoro or Chatterbox behind Caddy,
    # speaches, a local server) takes a bearer; the vendor schemes stay for the vendors.
    if kind in ("stt", "tts") and base_url and _openai_compatible_voice(base_url):
        return {"Authorization": f"Bearer {api_key}"}
    if kind == "stt":
        return {"Authorization": f"Token {api_key}"}      # Deepgram
    if kind == "tts":
        return {"xi-api-key": api_key}                     # ElevenLabs
    return {"Authorization": f"Bearer {api_key}"}


def _openai_compatible_voice(base_url: str) -> bool:
    return not any(h in base_url for h in ("elevenlabs.io", "deepgram.com"))


def _is_tavus(rec: ProviderRecord) -> bool:
    transport = str(rec.extra.get("transport") or "").lower()
    return rec.kind == "avatar" and (transport == "tavus" or "tavusapi.com" in rec.base_url
                                     or (not transport and rec.name.lower() == "tavus"))


def _model_ids(data: Any) -> list[str]:
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return [str(m.get("id")) for m in data["data"] if isinstance(m, dict) and m.get("id")]
    if isinstance(data, dict) and isinstance(data.get("models"), list):
        return [str(m.get("id") or m.get("name")) for m in data["models"] if isinstance(m, dict)]
    return []


async def probe_provider(rec: ProviderRecord, *, api_key: str | None, settings: Settings,
                         client: httpx.AsyncClient, store: RegistryStore | None = None) -> dict[str, Any]:
    """Run the kind-specific health call, persist the outcome, return the result."""
    result: dict[str, Any] = {"provider_id": rec.id, "kind": rec.kind, "ok": False, "status": None,
                              "latency_ms": None, "error": None, "url": None, "models": []}
    try:
        settings.guard_egress(rec.base_url)
    except EgressBlocked as exc:
        result.update(error="EgressBlocked", detail=str(exc))
        _persist(store, rec.id, result)
        return result

    try:
        # SSRF guard (review 04 O5): never metadata or link-local; a name resolving privately
        # must be on LOCAL_ALLOWLIST (literal private IPs stay allowed for on-prem providers).
        await net_guard.check_probe_url(rec.base_url, allow_private=settings.local_allowlist)
    except net_guard.BlockedDestination as exc:
        result.update(error="BlockedDestination", detail=str(exc))
        _persist(store, rec.id, result)
        return result

    if rec.kind == "identity":
        from server.auth.config import identity_config_from_record

        cfg_error = identity_config_from_record(rec).config_error
        if cfg_error:
            # Review 04 O9: surfaced as the row's probe error in the admin providers panel.
            result.update(error="IdentityMisconfigured", detail=cfg_error)
            _persist(store, rec.id, result)
            return result

    headers = _auth_headers(rec.kind, api_key, rec.base_url)
    base = rec.base_url.rstrip("/")
    paths = HEALTH_PATHS.get(rec.kind, ("/",))
    if _is_tavus(rec):
        # Tavus has no health route; List PALs (GET /v2/pals, x-api-key) checks reachability and
        # the key in one call (https://docs.tavus.io/api-reference/pals/list-pals).
        headers = {"x-api-key": api_key} if api_key else {}
        paths = ("/v2/pals?limit=1",)
    last: dict[str, Any] = {}
    for path in paths:
        url = f"{base}{path}"
        t0 = time.monotonic()
        try:
            resp = await client.get(url, headers=headers, timeout=PROBE_TIMEOUT_S)
            latency = round((time.monotonic() - t0) * 1000.0, 1)
            last = {"url": url, "status": resp.status_code, "latency_ms": latency}
            if 200 <= resp.status_code < 300:
                models: list[str] = []
                try:
                    models = _model_ids(resp.json())
                except ValueError:
                    pass
                result.update(ok=True, url=url, status=resp.status_code, latency_ms=latency, models=models)
                _persist(store, rec.id, result)
                return result
            if resp.status_code in (401, 403):
                break   # auth failure: trying other paths will not help
        except httpx.HTTPError as exc:
            last = {"url": url, "error": type(exc).__name__, "latency_ms": round((time.monotonic() - t0) * 1000.0, 1)}
            if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
                break   # host unreachable: no point in trying other paths
    result.update(url=last.get("url"), status=last.get("status"), latency_ms=last.get("latency_ms"),
                  error=last.get("error") or (f"HTTP {last.get('status')}" if last.get("status") else "unreachable"))
    _persist(store, rec.id, result)
    return result


def _persist(store: RegistryStore | None, provider_id: int, result: dict[str, Any]) -> None:
    if store is not None:
        store.set_probe_result(provider_id, ok=bool(result["ok"]), latency_ms=result.get("latency_ms"),
                               error=None if result["ok"] else result.get("error"))

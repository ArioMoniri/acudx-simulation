"""
grounding.py — the AcuDx Guideline-Grounding retrieval slice (Phase-0 / MVP).

Realizes the retrieval + hard-citation-gate core of
docs/architecture/05-guideline-grounding-engine.md:

    filter (country, BEFORE rank)  ->  dense retrieval (EMBED_URL)  ->  rerank (RERANK_URL)
    ->  HARD CITATION GATE (citation-or-drop)  ->  {passages, grounded}

Design constraints honored:
  * RESOURCE-LIGHT: this module loads NO models. It only *calls* the embed/rerank
    endpoints that already run on the pod (ModernBERT-TR embed @ :8003, reranker @ :8004).
  * Async + typed (pydantic v2) + httpx.
  * Defensive adapters: EmbedClient / RerankClient each try a couple of common request
    shapes and parse a couple of common response shapes, so the exact payload the real
    services expect is a one-line fix in `_REQUEST_SHAPES` / `_parse_*`.
  * Air-gap friendly: every call is to a local (127.0.0.1) endpoint; nothing egresses.
  * Graceful degradation: if the endpoints are unreachable we fall back to a local,
    deterministic hashing-embedding cosine so /v1/ground still returns something — clearly
    flagged `degraded: true` / `mode: "hashing-fallback"`.
  * Statement embeddings are cached in-process on first call.

Public entry point:
    await ground(query, country, locale="en", k=4) -> dict

The sibling-owned FastAPI app (server/app.py) imports and calls `ground()` for /v1/ground.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx
from pydantic import BaseModel, Field

from server import guidelines_seed as seed

logger = logging.getLogger("acudx.grounding")

# ---------------------------------------------------------------------------
# Configuration — read from the sibling-owned server.config.settings when present,
# otherwise from env, otherwise from the deploy defaults. We look the values up
# defensively (accepting either UPPER_SNAKE or lower_snake attribute names) so we
# do not couple to the exact field naming the config owner chooses.
# ---------------------------------------------------------------------------

_DEFAULTS = {
    "EMBED_URL": "http://127.0.0.1:8003",
    "RERANK_URL": "http://127.0.0.1:8004",
    "EMBED_DIM": 768,               # ytu-ce-cosmos/modernbert-tr-embed
    "GROUNDING_TIMEOUT_S": 4.0,     # out-of-band clock 2; seconds are fine
    "GROUNDING_RELEVANCE_MIN": 0.0, # relevance gate; conservative default keeps demo output
    "AIRGAPPED": True,
}


def _load_settings() -> Any:
    """Import the sibling config lazily so this module stays importable standalone
    (e.g. for the smoke test or a unit test) even before config.py exists.

    The config owner exposes a cached ``get_settings()`` singleton (and may also
    expose a module-level ``settings``); we accept either. Field names on that
    object are lower_snake (``embed_url``, ``rerank_url``, ...), which ``_cfg``
    already probes for."""
    try:
        from server import config as _config  # type: ignore
    except Exception:  # ImportError, or a partially-built config module
        return None
    getter = getattr(_config, "get_settings", None)
    if callable(getter):
        try:
            return getter()
        except Exception:
            pass
    return getattr(_config, "settings", None)


def _cfg(name: str, default: Any = None) -> Any:
    """Resolve a config value: settings.<NAME> / settings.<name> -> env[NAME] -> default."""
    settings = _load_settings()
    if settings is not None:
        for attr in (name, name.lower(), name.upper()):
            if hasattr(settings, attr):
                val = getattr(settings, attr)
                if val is not None:
                    return val
    env = os.environ.get(name)
    if env is not None:
        return env
    return default if default is not None else _DEFAULTS.get(name)


# ---------------------------------------------------------------------------
# Typed result models (pydantic v2)
# ---------------------------------------------------------------------------

class Citation(BaseModel):
    body: str = ""
    title: str = ""
    reference: str = ""
    url: str = ""
    pub_date: str = ""
    # Provenance from the verified GuidelineStatement store (server/guidelines/store.py).
    doi: str = ""
    edition: str = ""
    verified_at: str = ""


class Passage(BaseModel):
    id: str
    statement: str                       # localized, safe-to-show text
    citation: Citation
    url: str = ""
    council: str = ""
    country: str = ""
    topic: str = ""
    score: float = 0.0                   # final (post-rerank, or cosine in degraded modes)


class GroundResult(BaseModel):
    passages: List[Passage] = Field(default_factory=list)
    grounded: bool = False               # true iff >=1 cited passage survived the gate
    degraded: bool = False               # true if we did not use the real embed+rerank path
    mode: str = "embed+rerank"           # embed+rerank | embed-only | hashing-fallback | condition-scope
    scope: str = "corpus"                # corpus | condition (candidates limited to the case's tips)
    query: str = ""
    country: str = ""
    locale: str = "en"
    detail: str = ""                     # short human-readable note (e.g. why degraded)


# ---------------------------------------------------------------------------
# Endpoint adapters — the ONLY place that knows the wire shape of the pod services.
# Each client tries request shapes in order and remembers the first that worked.
# ---------------------------------------------------------------------------

class EmbedUnavailable(RuntimeError):
    pass


class RerankUnavailable(RuntimeError):
    pass


# Candidate request bodies for the embedder, in priority order. `{texts}` is what the
# task described; `{input}` is the OpenAI-compatible shape; `{inputs}` is HF TEI's shape.
_EMBED_REQUEST_SHAPES: Tuple[str, ...] = ("input", "texts", "inputs")
# Candidate document-field names for the reranker.
_RERANK_DOC_FIELDS: Tuple[str, ...] = ("documents", "texts", "passages", "docs")


class EmbedClient:
    """Thin async adapter over EMBED_URL. POSTs a batch of texts and returns one vector
    per text. Tolerant of several request/response shapes — correct one is auto-detected
    and cached in `self._shape`; to hard-pin it, set `_shape` to a value in
    _EMBED_REQUEST_SHAPES."""

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.base_url = (base_url or str(_cfg("EMBED_URL"))).rstrip("/")
        self.timeout = float(timeout or _cfg("GROUNDING_TIMEOUT_S", 4.0))
        self.model = str(_cfg("EMBED_MODEL", "ytu-ce-cosmos/modernbert-tr-embed"))
        self._shape: Optional[str] = None
        self._path: Optional[str] = None

    # Try a couple of common paths; most servers mount the embed op at "/embed",
    # "/embeddings", "/v1/embeddings", or the bare root.
    _PATHS: Tuple[str, ...] = ("/v1/embeddings", "/embeddings", "/embed", "")

    async def embed(self, texts: Sequence[str]) -> List[List[float]]:
        if not texts:
            return []
        # Fast path: reuse the shape/path we already validated this process.
        attempts: List[Tuple[str, str]] = []
        if self._shape and self._path is not None:
            attempts.append((self._path, self._shape))
        for path in self._PATHS:
            for shape in _EMBED_REQUEST_SHAPES:
                if (path, shape) not in attempts:
                    attempts.append((path, shape))

        last_err: Optional[Exception] = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                for path, shape in attempts:
                    url = f"{self.base_url}{path}"
                    payload = {shape: list(texts), "model": self.model}
                    try:
                        resp = await client.post(url, json=payload)
                    except Exception as exc:  # connection refused, timeout, DNS...
                        last_err = exc
                        continue
                    if resp.status_code >= 400:
                        last_err = RuntimeError(f"{url} -> HTTP {resp.status_code}")
                        continue
                    try:
                        vectors = _parse_embed_response(resp.json(), n_inputs=len(texts))
                    except Exception as exc:
                        last_err = exc
                        continue
                    if vectors and len(vectors) == len(texts):
                        self._shape, self._path = shape, path  # remember what worked
                        return vectors
                    last_err = RuntimeError(f"{url} returned {len(vectors)} vecs for {len(texts)} inputs")
        except Exception as exc:  # pragma: no cover — client construction failure
            last_err = exc
        raise EmbedUnavailable(f"embed endpoint {self.base_url} unusable: {last_err}")


class RerankClient:
    """Thin async adapter over RERANK_URL. POSTs a query + candidate docs and returns one
    relevance score per doc, aligned to the input order."""

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.base_url = (base_url or str(_cfg("RERANK_URL"))).rstrip("/")
        self.timeout = float(timeout or _cfg("GROUNDING_TIMEOUT_S", 4.0))
        self.model = str(_cfg("RERANK_MODEL", "ytu-ce-cosmos/modernbert-tr-reranker"))
        self._doc_field: Optional[str] = None
        self._path: Optional[str] = None

    _PATHS: Tuple[str, ...] = ("/v1/rerank", "/rerank", "")

    async def rerank(self, query: str, docs: Sequence[str]) -> List[float]:
        if not docs:
            return []
        attempts: List[Tuple[str, str]] = []
        if self._doc_field and self._path is not None:
            attempts.append((self._path, self._doc_field))
        for path in self._PATHS:
            for field in _RERANK_DOC_FIELDS:
                if (path, field) not in attempts:
                    attempts.append((path, field))

        last_err: Optional[Exception] = None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                for path, field in attempts:
                    url = f"{self.base_url}{path}"
                    payload = {"query": query, field: list(docs), "model": self.model}
                    try:
                        resp = await client.post(url, json=payload)
                    except Exception as exc:
                        last_err = exc
                        continue
                    if resp.status_code >= 400:
                        last_err = RuntimeError(f"{url} -> HTTP {resp.status_code}")
                        continue
                    try:
                        scores = _parse_rerank_response(resp.json(), n_docs=len(docs))
                    except Exception as exc:
                        last_err = exc
                        continue
                    if scores and len(scores) == len(docs):
                        self._doc_field, self._path = field, path
                        return scores
                    last_err = RuntimeError(f"{url} returned {len(scores)} scores for {len(docs)} docs")
        except Exception as exc:  # pragma: no cover
            last_err = exc
        raise RerankUnavailable(f"rerank endpoint {self.base_url} unusable: {last_err}")


# --- response parsers (kept separate so they are trivial to correct) ---------

def _parse_embed_response(data: Any, n_inputs: int) -> List[List[float]]:
    """Accept the common embedding response shapes:
      * [[...], [...]]                          (TEI / bare list of vectors)
      * {"embeddings": [[...], ...]}
      * {"data": [{"embedding": [...]}, ...]}   (OpenAI-compatible)
      * {"vectors": [[...], ...]}
    """
    # bare list
    if isinstance(data, list):
        if data and isinstance(data[0], (int, float)) and n_inputs == 1:
            return [[float(x) for x in data]]  # single flat vector
        return [[float(x) for x in vec] for vec in data]
    if isinstance(data, dict):
        for key in ("embeddings", "vectors", "data", "result", "results", "output"):
            if key in data:
                inner = data[key]
                if isinstance(inner, list) and inner and isinstance(inner[0], dict):
                    # OpenAI style: [{"embedding":[...]}, ...]
                    out = []
                    for item in inner:
                        vec = item.get("embedding") or item.get("vector") or item.get("values")
                        if vec is None:
                            raise ValueError("embedding item missing vector")
                        out.append([float(x) for x in vec])
                    return out
                if isinstance(inner, list):
                    return [[float(x) for x in vec] for vec in inner]
    raise ValueError(f"unrecognized embed response shape: {type(data)}")


def _parse_rerank_response(data: Any, n_docs: int) -> List[float]:
    """Accept the common rerank response shapes, returning scores in INPUT doc order:
      * [{"index": i, "score"/"relevance_score": s}, ...]   (Cohere / TEI style, any order)
      * {"results": [ ... same ... ]}
      * {"scores": [s0, s1, ...]}                            (already aligned)
      * [s0, s1, ...]                                        (already aligned)
    """
    results = data
    if isinstance(data, dict):
        if "scores" in data and isinstance(data["scores"], list):
            return [float(x) for x in data["scores"]]
        for key in ("results", "data", "result", "output", "ranking"):
            if key in data and isinstance(data[key], list):
                results = data[key]
                break

    if isinstance(results, list):
        if results and isinstance(results[0], (int, float)):
            return [float(x) for x in results]  # already aligned
        if results and isinstance(results[0], dict):
            scores = [0.0] * n_docs
            for rank, item in enumerate(results):
                idx = item.get("index", item.get("document_index", rank))
                score = item.get("score", item.get("relevance_score", item.get("relevance")))
                if score is None:
                    raise ValueError("rerank item missing score")
                if isinstance(idx, int) and 0 <= idx < n_docs:
                    scores[idx] = float(score)
            return scores
    raise ValueError(f"unrecognized rerank response shape: {type(data)}")


# ---------------------------------------------------------------------------
# Local deterministic fallback embedder (no model, no network).
# A hashing bag-of-tokens embedding — good enough for a "clearly degraded" cosine
# so the endpoint never hard-fails when the pod services are down.
# ---------------------------------------------------------------------------

_HASH_DIM = 512
_TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)  # unicode word chars (keeps Turkish)


def _hash_embed(text: str, dim: int = _HASH_DIM) -> List[float]:
    vec = [0.0] * dim
    tokens = _TOKEN_RE.findall((text or "").lower())
    for tok in tokens:
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if (h >> 8) & 1 else -1.0
        vec[idx] += sign
    return vec


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


# ---------------------------------------------------------------------------
# In-process statement-embedding cache.
# Keyed by (embedder_id, locale, text_hash) so a swap of embedder or locale is a new key
# and a real-vs-fallback embedding never collide.
# ---------------------------------------------------------------------------

_STMT_VEC_CACHE: Dict[Tuple[str, str, str], List[float]] = {}
_CACHE_LOCK = asyncio.Lock()

_embed_client: Optional[EmbedClient] = None
_rerank_client: Optional[RerankClient] = None


def _clients() -> Tuple[EmbedClient, RerankClient]:
    global _embed_client, _rerank_client
    if _embed_client is None:
        _embed_client = EmbedClient()
    if _rerank_client is None:
        _rerank_client = RerankClient()
    return _embed_client, _rerank_client


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


async def _statement_vectors_real(
    statements: List[Dict[str, Any]],
    locale: str,
    embedder_id: str,
    embed_fn: Any,
) -> List[List[float]]:
    """Return real embeddings for each statement (localized text), embedding only the
    cache-missing ones in a single batched call via `embed_fn`. `embedder_id` namespaces
    the cache so a swap of embedder/gateway is a new key. Raises EmbedUnavailable on failure."""
    texts = [seed.localized_text(s, locale) for s in statements]
    keys = [(embedder_id, locale, _text_hash(t)) for t in texts]

    async with _CACHE_LOCK:
        missing_idx = [i for i, k in enumerate(keys) if k not in _STMT_VEC_CACHE]
        if missing_idx:
            to_embed = [texts[i] for i in missing_idx]
            vectors = await embed_fn(to_embed)  # may raise EmbedUnavailable
            for i, vec in zip(missing_idx, vectors):
                _STMT_VEC_CACHE[keys[i]] = vec
        return [_STMT_VEC_CACHE[k] for k in keys]


async def _resolve_embed_fn(gateway: Any) -> Tuple[str, Any]:
    """Pick the embed callable: the app's Model Gateway if it exposes `embed()`
    (doc 05), else grounding's own `EmbedClient`. Returns (embedder_id, async embed_fn)."""
    if gateway is not None and hasattr(gateway, "embed"):
        async def _gw_embed(texts: Sequence[str]) -> List[List[float]]:
            try:
                return await gateway.embed(list(texts))
            except Exception as exc:  # normalize the gateway's error to ours
                raise EmbedUnavailable(f"gateway.embed failed: {exc}") from exc
        return ("gateway", _gw_embed)
    client, _ = _clients()
    return (client.base_url, client.embed)


async def _resolve_rerank_fn(gateway: Any) -> Any:
    """Pick the rerank callable: gateway.rerank() if present, else grounding's RerankClient.
    The returned async fn raises RerankUnavailable on failure."""
    if gateway is not None and hasattr(gateway, "rerank"):
        async def _gw_rerank(query: str, docs: Sequence[str]) -> List[float]:
            try:
                return await gateway.rerank(query, list(docs))
            except Exception as exc:
                raise RerankUnavailable(f"gateway.rerank failed: {exc}") from exc
        return _gw_rerank
    _, client = _clients()
    return client.rerank


def _statement_vectors_hash(statements: List[Dict[str, Any]], locale: str) -> List[List[float]]:
    """Deterministic fallback embeddings (also cached, under the 'hashing' embedder id)."""
    out: List[List[float]] = []
    for s in statements:
        text = seed.localized_text(s, locale)
        key = ("hashing", locale, _text_hash(text))
        vec = _STMT_VEC_CACHE.get(key)
        if vec is None:
            vec = _hash_embed(text)
            _STMT_VEC_CACHE[key] = vec
        out.append(vec)
    return out


# ---------------------------------------------------------------------------
# Verified corpus (projection of the SQLite GuidelineStatement store).
# ---------------------------------------------------------------------------

def condition_scope(condition: Optional[str], stages: Optional[Sequence[str]]) -> set:
    """Ids of the verified statements the attending tips of ``condition`` cite at ``stages``
    (every stage when None). Empty when the condition has no tips or the store is unavailable."""
    try:
        from server.guidelines import tips as tips_mod
        from server.guidelines.store import get_store

        store = get_store()
        wanted = [s for s in (stages or tips_mod.STAGES) if s in tips_mod.STAGES]
        ids: set = set()
        for st in wanted:
            ids |= tips_mod.statement_ids_for_stage(store, st, condition=condition)
        return ids
    except Exception as exc:  # pragma: no cover - defensive: a broken store must not 500 /v1/ground
        logger.warning("condition scope unavailable: %s", exc)
        return set()


def verified_statements() -> List[Dict[str, Any]]:
    """Verified GuidelineStatements in the legacy dict shape the retrieval code consumes.
    Returns [] (never the unverified seed) when the store cannot be opened."""
    try:
        from server.guidelines.store import get_store, statement_to_legacy

        return [statement_to_legacy(s) for s in get_store().verified()]
    except Exception as exc:  # pragma: no cover - defensive: a broken store must not 500 /v1/ground
        logger.warning("guideline store unavailable: %s", exc)
        return []


# ---------------------------------------------------------------------------
# The public grounding call.
# ---------------------------------------------------------------------------

async def ground(
    query: str,
    country: str = "GLOBAL",
    locale: str = "en",
    k: int = 4,
    gateway: Any = None,
    condition: Optional[str] = None,
    stages: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Ground `query` against the seed GuidelineStatement corpus.

    Pipeline (doc 05 §4-5):
      1. Country filter BEFORE rank.
      2. Dense retrieval: embed query + candidate statements via EMBED_URL, cosine, keep top-N.
      3. Rerank the top-N via RERANK_URL.
      4. HARD CITATION GATE: drop any statement without a citation (citation-or-refuse).
      5. Return {passages, grounded, ...}. Always returns something; degraded paths flagged.

    `gateway` (optional): the app's managed `ModelGateway`. When passed, embed/rerank
    route through it (doc 05: "every embed/rerank goes through the Model Gateway"),
    reusing its egress guard and pooled client. When omitted, grounding uses its own
    thin `EmbedClient`/`RerankClient` so it stays self-contained and standalone-testable.

    Never raises for an unreachable endpoint — it degrades to a local hashing cosine.

    ``condition`` (the case's ICD-10 code or catalogue id) with ``stages`` (the attending-tip
    stages the encounter has reached) limits the candidates to the verified statements the
    curated tips of that condition cite at those stages (``scope = "condition"``). Their
    relevance is established by curation, so without an embed endpoint (the production host
    has none) the answer is ranked lexically inside that set and is NOT degraded
    (``mode = "condition-scope"``). A condition without tips keeps the unscoped behaviour.
    Live report 2026-10-21: every interview guidance card was "unavailable" in production
    because each unscoped answer was degraded.
    """
    query = (query or "").strip()
    country = (country or "GLOBAL").strip() or "GLOBAL"
    locale = (locale or "en").strip().lower() or "en"
    k = max(1, int(k or 4))

    result = GroundResult(query=query, country=country, locale=locale)
    if not query:
        result.detail = "empty query"
        return result.model_dump()

    # ---- 1. country filter BEFORE rank -------------------------------------
    # Candidates come from the VERIFIED guideline store only (status=verified). The raw seed
    # corpus is never retrieved over: an unverified statement must not reach a learner.
    candidates = [s for s in verified_statements() if seed.in_country_scope(s, country)]
    if not candidates:
        result.detail = f"no verified statements in scope for country={country}"
        return result.model_dump()
    scope_ids = condition_scope(condition, stages) if condition else set()
    scoped = [s for s in candidates if s.get("id") in scope_ids]
    if scoped:
        candidates = scoped
        result.scope = "condition"

    embedder_id, embed_fn = await _resolve_embed_fn(gateway)

    # ---- 2. dense retrieval (real embed, else hashing fallback) ------------
    mode = "embed+rerank"
    degraded = False
    detail = ""
    try:
        q_vec = (await embed_fn([query]))[0]
        stmt_vecs = await _statement_vectors_real(candidates, locale, embedder_id, embed_fn)
    except EmbedUnavailable as exc:
        logger.warning("embed endpoint unavailable, using hashing fallback: %s", exc)
        q_vec = _hash_embed(query)
        stmt_vecs = _statement_vectors_hash(candidates, locale)
        if result.scope == "condition":
            mode = "condition-scope"
            detail = "no embed endpoint; ranked lexically within the case condition's tip statements"
        else:
            mode = "hashing-fallback"
            degraded = True
            detail = "embed endpoint unreachable; local hashing-cosine fallback"

    scored = sorted(
        ((_cosine(q_vec, sv), s) for sv, s in zip(stmt_vecs, candidates)),
        key=lambda t: t[0],
        reverse=True,
    )
    top_n = scored[: max(k * 3, k)]  # candidate pool handed to the reranker

    # ---- 3. rerank (only meaningful on the real-embedding path) ------------
    if mode == "embed+rerank":
        docs = [seed.localized_text(s, locale) for _, s in top_n]
        try:
            rerank_fn = await _resolve_rerank_fn(gateway)
            rr_scores = await rerank_fn(query, docs)
            reranked = sorted(
                (
                    {"score": float(rr_scores[i]), "statement": top_n[i][1]}
                    for i in range(len(top_n))
                ),
                key=lambda d: d["score"],
                reverse=True,
            )
            ranked = [(d["score"], d["statement"]) for d in reranked]
        except RerankUnavailable as exc:
            logger.warning("RERANK_URL unavailable, keeping cosine order: %s", exc)
            ranked = top_n
            mode = "embed-only"
            degraded = True
            detail = "rerank endpoint unreachable; cosine ordering retained"
    else:
        ranked = top_n

    # ---- 4. hard citation gate + relevance gate + top-k --------------------
    relevance_min = float(_cfg("GROUNDING_RELEVANCE_MIN", 0.0))
    passages: List[Passage] = []
    for score, s in ranked:
        if not seed.has_citation(s):        # CITATION-OR-DROP — the safety spine
            continue
        if score < relevance_min:
            continue
        cite = dict(s.get("citation", {}))
        passages.append(
            Passage(
                id=s.get("id", ""),
                statement=seed.localized_text(s, locale),
                citation=Citation(**{k2: cite.get(k2, "") for k2 in Citation.model_fields}),
                url=str(cite.get("url", "") or s.get("url", "")),
                council=s.get("council", ""),
                country=s.get("country", ""),
                topic=s.get("topic", ""),
                score=round(float(score), 6),
            )
        )
        if len(passages) >= k:
            break

    result.passages = passages
    result.grounded = len(passages) > 0
    result.degraded = degraded
    result.mode = mode
    result.detail = detail or ("ok" if result.grounded else "no cited statement above relevance gate")
    return result.model_dump()


# ---------------------------------------------------------------------------
# Manual local check:  python -m server.grounding "septic shock antibiotics" GLOBAL en
# (Runs against the real endpoints if up, else exercises the hashing fallback.)
# ---------------------------------------------------------------------------
if __name__ == "__main__":  # pragma: no cover
    import json
    import sys

    q = sys.argv[1] if len(sys.argv) > 1 else "antibiotic timing in septic shock"
    c = sys.argv[2] if len(sys.argv) > 2 else "GLOBAL"
    loc = sys.argv[3] if len(sys.argv) > 3 else "en"
    out = asyncio.run(ground(q, c, loc, k=4))
    print(json.dumps(out, ensure_ascii=False, indent=2))

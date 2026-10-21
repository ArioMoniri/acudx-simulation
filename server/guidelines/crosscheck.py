"""Independent second verification pass over ``verified`` GuidelineStatements.

The first pass (``server.guidelines.verifier``) finds the passage that best supports a
statement and records it as ``verification_quote``. This pass re-checks that evidence from
scratch, the way a second reviewer would, and demotes a statement to ``failed`` when any
check does not hold:

1. **Fresh fetch.** The document is fetched again (``verification_url``, else
   ``fetch_url``, else ``source_url``) with the same SSRF, robots and size guards.
2. **Quote present verbatim.** Every part of the recorded quote (composite quotes are split
   on ``[...]``) must occur in the fetched text after whitespace and Unicode punctuation are
   normalised. A quote that cannot be found means the evidence is stale or invented.
3. **Numbers covered.** Every number in ``statement_en`` (doses, thresholds, timings) must
   occur in the quote. This is the deterministic numeric gate of docs/architecture/05
   section 9 ("Wrong drug dose / threshold"): a statement may not carry a figure its
   evidence does not state.
4. **Support re-located.** The lexical locator is run again on the fresh text and must
   still clear the verifier's threshold.

A statement that passes gets ``crosscheck ok <date>`` appended to ``verification_note``.

Run::

    python -m server.guidelines.crosscheck --ids gs_a gs_b --export server/guidelines/statements.verified.json
"""

from __future__ import annotations

import argparse
import asyncio
import html
import logging
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

import httpx

from server.guidelines import verifier as V
from server.guidelines.store import EXPORT_PATH, GuidelineStatement, GuidelineStore, get_store, utcnow_iso

logger = logging.getLogger("acudx.guidelines.crosscheck")

CROSSCHECK_ID = "agent:acudx-crosscheck/1"
_NUM = re.compile(r"\d+(?:\.\d+)?")


def _flat(text: str) -> str:
    text = html.unescape(text or "").translate(V._UNICODE_FIX).lower()  # noqa: SLF001 - shared normalisation table
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_parts(quote: str) -> List[str]:
    parts = [p.strip().strip("…").strip() for p in (quote or "").split("[...]")]
    return [p for p in parts if p]


def numbers(text: str) -> List[str]:
    out = []
    for n in _NUM.findall(V.normalise(text)):
        n = n.rstrip("0").rstrip(".") if "." in n else n
        out.append(n)
    return out


def missing_numbers(statement: str, quote: str) -> List[str]:
    have = set(numbers(quote))
    return sorted({n for n in numbers(statement) if n not in have})


def quote_present(quote: str, document: str) -> List[str]:
    """Return the quote parts that are NOT found in ``document`` (empty list = all found)."""
    doc = _flat(document)
    return [p for p in quote_parts(quote) if _flat(p) and _flat(p) not in doc]


@dataclass
class CrossOutcome:
    statement_id: str
    ok: bool
    reason: str


async def crosscheck_statement(stmt: GuidelineStatement, client: httpx.AsyncClient, *, cache: Dict[str, V.Fetched],
                               robots: V.RobotsCache, limiter: V.RateLimiter) -> CrossOutcome:
    if stmt.status != "verified" or not stmt.verification_quote:
        return CrossOutcome(stmt.id, False, "not verified by the first pass")
    url = stmt.verification_url or stmt.fetch_url or stmt.source_url
    fetched = cache.get(url)
    if fetched is None:
        fetched = await V.fetch_document(url, client, robots=robots, limiter=limiter)
        cache[url] = fetched
    if fetched.error:
        return CrossOutcome(stmt.id, False, f"crosscheck fetch failed: {fetched.error}")
    absent = quote_present(stmt.verification_quote, fetched.text)
    if absent:
        return CrossOutcome(stmt.id, False, f"crosscheck: quote not found in source: {absent[0][:160]!r}")
    miss = missing_numbers(stmt.statement_en, stmt.verification_quote)
    if miss:
        return CrossOutcome(stmt.id, False, f"crosscheck: numbers in the statement absent from the quote: {miss}")
    match = await V.locate_support(stmt.statement_en, fetched.text, None)
    ok, why = V.passes(match, V.MIN_SCORE)
    if not ok:
        return CrossOutcome(stmt.id, False, f"crosscheck: support not re-located ({why})")
    return CrossOutcome(stmt.id, True, f"crosscheck ok {utcnow_iso()[:10]} (quote verbatim; "
                                       f"{len(numbers(stmt.statement_en))} numbers covered; score {match.score:.2f})")


async def crosscheck_store(store: GuidelineStore, *, ids: Optional[Sequence[str]] = None,
                           client: Optional[httpx.AsyncClient] = None, concurrency: int = 4) -> Dict[str, object]:
    stmts = [s for s in store.list(ids=list(ids) if ids else None) if s.status == "verified"]
    robots, limiter = V.RobotsCache(), V.RateLimiter()
    cache: Dict[str, V.Fetched] = {}
    sem = asyncio.Semaphore(max(1, concurrency))
    own = client is None
    client = client or httpx.AsyncClient(timeout=V.DEFAULT_TIMEOUT_S)
    outcomes: List[CrossOutcome] = []
    locks: Dict[str, asyncio.Lock] = {}

    async def _one(s: GuidelineStatement) -> None:
        url = s.verification_url or s.fetch_url or s.source_url
        async with sem, locks.setdefault(url, asyncio.Lock()):
            out = await crosscheck_statement(s, client, cache=cache, robots=robots, limiter=limiter)
        note = s.verification_note.split("; crosscheck")[0]
        if out.ok:
            by = s.verified_by if CROSSCHECK_ID in s.verified_by else f"{s.verified_by}+{CROSSCHECK_ID}"
            store.set_verification(s.id, status="verified", verified_by=by, method=s.verification_method,
                                   quote=s.verification_quote, note=f"{note}; {out.reason}",
                                   verification_url=s.verification_url, retrieved_at=utcnow_iso())
        else:
            store.set_verification(s.id, status="failed", method=s.verification_method, quote="",
                                   note=f"{note}; {out.reason}", verification_url=s.verification_url)
        outcomes.append(out)

    try:
        await asyncio.gather(*(_one(s) for s in stmts))
    finally:
        if own:
            await client.aclose()
    return {"checked": len(outcomes), "passed": sum(o.ok for o in outcomes),
            "rejected": {o.statement_id: o.reason for o in outcomes if not o.ok}, "ran_at": utcnow_iso()}


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Independent second verification pass over verified statements.")
    ap.add_argument("--db", default=None)
    ap.add_argument("--ids", nargs="*", default=None)
    ap.add_argument("--export", default=str(EXPORT_PATH))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    store = get_store(args.db)
    summary = asyncio.run(crosscheck_store(store, ids=args.ids))
    store.export_json(args.export)
    print(f"checked={summary['checked']} passed={summary['passed']} rejected={len(summary['rejected'])}")
    for sid, why in dict(summary["rejected"]).items():  # type: ignore[arg-type]
        print(f"  REJECT {sid}: {why[:220]}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

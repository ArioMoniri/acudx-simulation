"""Verification pipeline for GuidelineStatement drafts.

For each draft statement the verifier

1. refuses homepage-only sources outright (``https://www.saglik.gov.tr``, ``.../emergencycare``)
   because a homepage can never evidence a specific recommendation;
2. fetches ``fetch_url or source_url`` with httpx (timeouts, a per-host rate limit, a
   robots.txt check, a conservative User-Agent) and refuses JavaScript walls / logins;
3. extracts text: PDF via pypdf, JATS/XML via tag stripping, HTML via trafilatura with an
   lxml full-text fallback (the longer of the two wins, because trafilatura mis-picks the
   main block on some NICE chapters);
4. locates the passage that supports ``statement_en``: sentence windows (1 to 3 sentences)
   are scored by weighted recall of the statement's content terms (numbers weigh double,
   UK/US spellings and common drug synonyms are normalised, a light suffix stemmer is
   applied). When an ``embed_fn`` is available (the Model Gateway's embed adapter) the top
   lexical candidates are re-scored by cosine similarity and the two scores are blended;
   when it is unavailable the pipeline stays purely lexical;
5. marks the row ``verified`` (recording the quote, the fetched URL, method and verifier
   id) or ``failed`` with a reason in ``verification_note``.

Run over the store::

    python -m server.guidelines.verifier --export server/guidelines/statements.verified.json
"""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import math
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple
from urllib import robotparser
from urllib.parse import urlparse

import httpx

from server.guidelines.store import EXPORT_PATH, GuidelineStatement, GuidelineStore, get_store, utcnow_iso

logger = logging.getLogger("acudx.guidelines.verifier")

USER_AGENT = "AcuDxGuidelineVerifier/0.1 (+https://acudx.dev; clinical-education research; contact: info@getvivax.com)"
DEFAULT_TIMEOUT_S = float(os.environ.get("ACUDX_VERIFY_TIMEOUT_S", "40"))
MIN_SCORE = float(os.environ.get("ACUDX_VERIFY_MIN_SCORE", "0.50"))
# A composite quote (two excerpts joined by " [...] ") is allowed when one window cannot
# cover a statement that condenses two neighbouring recommendations. Each part must carry
# at least this share of the statement's terms so a composite is never two stray fragments.
COMPOSITE_MIN_PART = float(os.environ.get("ACUDX_VERIFY_COMPOSITE_MIN_PART", "0.20"))
# A stitched quote must clear a higher bar than a single passage (audit of the first runs:
# composites at exactly 0.50 paired weakly related fragments; singles at 0.50 read as support).
COMPOSITE_MIN_SCORE = float(os.environ.get("ACUDX_VERIFY_COMPOSITE_MIN_SCORE", "0.55"))
MIN_MATCHED_TERMS = int(os.environ.get("ACUDX_VERIFY_MIN_TERMS", "5"))
PER_HOST_INTERVAL_S = float(os.environ.get("ACUDX_VERIFY_HOST_INTERVAL_S", "1.0"))
MAX_BYTES = 25 * 1024 * 1024
MAX_PDF_PAGES = 400
QUOTE_MAX_CHARS = 900
WINDOW_MAX_CHARS = 1000

EmbedFn = Callable[[Sequence[str]], Awaitable[List[List[float]]]]

# Known landing/homepage sources that can never evidence a recommendation.
LANDING_PAGE_HOSTS = {"www.saglik.gov.tr", "saglik.gov.tr", "www.tepdad.org.tr", "tepdad.org.tr"}
LANDING_PAGE_PATHS = {("www.who.int", "/emergencycare"), ("www.who.int", "/health-topics/emergency-care")}
JS_WALL_MARKERS = ("enable javascript and cookies to continue", "checking your browser before accessing",
                   "this site requires javascript", "attention required! | cloudflare")
LOGIN_MARKERS = ("login for health professionals", "/login/?returnurl")


# ---------------------------------------------------------------------------
# Text normalisation and the lexical locator
# ---------------------------------------------------------------------------

_STOP = set("""
a an the and or of in on at to by for with without from as is are be been being was were if not no than then
so such any all every each after before during over under more less into onto out up down it its their they them
he she his her who whom which that this these those there here do does did done has have had can could will would
should must may might also include including other both either neither about around per via rather instead well
very when where while whilst until unless because but however only even still just like people person patients
patient adults adult children child women woman men man give given giving offer offered offering use used using
consider considered take taking taken think thinking ensure make making following follow based part provide
provided treat treating treatment manage managing management assess assessing assessment clinical care need needs
needed within level levels one two three
""".split())

_SYNONYMS = {
    "adrenaline": "epinephrine", "noradrenaline": "norepinephrine", "acetaminophen": "paracetamol",
    "nac": "acetylcysteine", "n-acetylcysteine": "acetylcysteine", "ecg": "electrocardiogram",
    "ekg": "electrocardiogram", "iv": "intravenous", "im": "intramuscular", "ct": "computed tomography",
    "ctpa": "computed tomography pulmonary angiogram", "bp": "blood pressure", "hr": "heart rate",
    "map": "mean arterial pressure", "mmhg": "mm hg", "ml": "ml", "mls": "ml", "litre": "l", "liter": "l",
    "litres": "l", "liters": "l", "hours": "hr", "hour": "hr", "hrs": "hr", "h": "hr", "minutes": "min",
    "minute": "min", "mins": "min", "sulphate": "sulfate", "haemoglobin": "hemoglobin", "pci": "pci",
    "percutaneous coronary intervention": "pci", "stemi": "stemi", "nstemi": "nstemi", "a&e": "emergency department",
    "ae": "emergency department", "ed": "emergency department", "pe": "pulmonary embolism", "dvt": "deep vein thrombosis",
    "spo2": "oxygen saturation", "sao2": "oxygen saturation", "pef": "peak expiratory flow", "k": "potassium",
    "dextrose": "glucose", "bicarb": "bicarbonate",
}

_UNICODE_FIX = str.maketrans({
    chr(0x2010): "-", chr(0x2011): "-", chr(0x2012): "-", chr(0x2013): "-", chr(0x2014): "-", chr(0x2212): "-",
    chr(0x00AD): "", chr(0x2018): "'", chr(0x2019): "'", chr(0x201C): '"', chr(0x201D): '"',
    chr(0x00A0): " ", chr(0x2009): " ", chr(0x202F): " ", chr(0x2264): "<=", chr(0x2265): ">=",
    chr(0x00B7): " ", chr(0x2022): " ", chr(0x00AE): "", chr(0x2122): "",
})

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?(?:-[a-z0-9]+)*")
_NUM_RE = re.compile(r"^[0-9]+(?:\.[0-9]+)?$")


def normalise(text: str) -> str:
    text = (text or "").translate(_UNICODE_FIX).lower()
    # UK -> US spelling families used by the clinical sources.
    text = re.sub(r"\boe(dema|sophag)", r"e\1", text)
    text = re.sub(r"(h)aem", r"\1em", text)
    text = re.sub(r"(an|isch|hyperkal|hypokal|hypon|hypercalc|hypogly|hypergly|leuk|ur|dysl|ket|acid|tox)aem",
                  r"\1em", text)
    # "94-98%" / "6-12 h" / "100-120 mmhg" are ranges: expose both numbers as tokens.
    text = re.sub(r"(\d)\s*(?:-|to)\s*(\d)", r"\1 to \2", text)
    text = re.sub(r"\b(\d+(?:\.\d+)?)\s*(mg|ml|mmol|mcg|g|l|kg|units?|unit|iu|hr|h|min|mmhg|%)", r"\1 \2", text)
    text = text.replace("%", " %")
    return text


def _stem(tok: str) -> str:
    if len(tok) <= 4 or _NUM_RE.match(tok):
        return tok
    for suf in ("ically", "ations", "ation", "ingly", "ities", "ness", "ment", "ings", "ing", "ies", "ous", "ive",
                "ers", "ed", "es", "ly", "al", "er", "s"):
        if tok.endswith(suf) and len(tok) - len(suf) >= 4:
            return tok[: -len(suf)]
    return tok


def tokens(text: str) -> List[str]:
    out: List[str] = []
    for raw in _TOKEN_RE.findall(normalise(text)):
        raw = _SYNONYMS.get(raw, raw)
        for part in raw.split():
            out.append(_stem(part))
    return out


def content_terms(statement: str) -> Dict[str, float]:
    """Weighted set of the statement's content terms (numbers weigh 2.0)."""
    weights: Dict[str, float] = {}
    for tok in tokens(statement):
        if tok in _STOP or (len(tok) < 3 and not _NUM_RE.match(tok)):
            continue
        weights[tok] = 2.0 if _NUM_RE.match(tok) else 1.0
    return weights


_SENT_SPLIT = re.compile(r"(?<=[.;:!?])\s+(?=[A-Z0-9(\[\"'•\-])|\s+(?=\d+\.\d+(?:\.\d+)?\s+[A-Z])|\s+(?=•|•|- )")


def split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", (text or "").translate(_UNICODE_FIX)).strip()
    parts = [p.strip() for p in _SENT_SPLIT.split(text) if p and p.strip()]
    # Merge micro-fragments (bullet labels, numbering) into the following sentence.
    merged: List[str] = []
    for p in parts:
        if merged and len(merged[-1]) < 25:
            merged[-1] = merged[-1] + " " + p
        else:
            merged.append(p)
    return merged


@dataclass
class SupportMatch:
    score: float
    quote: str
    matched_terms: int
    total_terms: int
    numeric_matched: int
    numeric_total: int
    method: str = "lexical"
    lexical_score: float = 0.0
    embedding_score: Optional[float] = None
    start: int = 0   # sentence index range [start, end) of the quote
    end: int = 0
    composite: bool = False


def _score_window(window_tokens: set, weights: Dict[str, float]) -> Tuple[float, int, int, int]:
    total = sum(weights.values()) or 1.0
    got = 0.0
    matched = 0
    num_total = 0
    num_matched = 0
    for term, w in weights.items():
        is_num = bool(_NUM_RE.match(term))
        num_total += int(is_num)
        if term in window_tokens:
            got += w
            matched += 1
            num_matched += int(is_num)
    return got / total, matched, num_total, num_matched


def lexical_candidates(statement: str, text: str, top_k: int = 5) -> List[SupportMatch]:
    """Best sentence windows (1 to 3 consecutive sentences) by weighted term recall."""
    weights = content_terms(statement)
    if not weights:
        return []
    sents = split_sentences(text)
    if not sents:
        return []
    sent_tokens = [set(tokens(s)) for s in sents]
    seen: Dict[str, SupportMatch] = {}
    for i in range(len(sents)):
        acc: set = set()
        chars = 0
        for j in range(i, min(i + 3, len(sents))):
            chars += len(sents[j]) + 1
            if chars > WINDOW_MAX_CHARS and j > i:
                break
            acc |= sent_tokens[j]
            score, matched, num_total, num_matched = _score_window(acc, weights)
            if score <= 0.0:
                continue
            quote = " ".join(sents[i: j + 1])
            prev = seen.get(quote)
            if prev is None or score > prev.score:
                seen[quote] = SupportMatch(score=round(score, 4), quote=quote, matched_terms=matched,
                                           total_terms=len(weights), numeric_matched=num_matched,
                                           numeric_total=num_total, lexical_score=round(score, 4),
                                           start=i, end=j + 1)
    ranked = sorted(seen.values(), key=lambda m: (m.score, -len(m.quote)), reverse=True)
    # Prefer the shortest window among near-equal scores so quotes stay tight.
    singles = ranked[:top_k]
    composite = _best_composite(ranked[: max(top_k * 3, 12)], weights, sents)
    if composite is not None and (not singles or composite.score > singles[0].score):
        singles.insert(0, composite)
    return singles[:top_k]


def _best_composite(cands: List[SupportMatch], weights: Dict[str, float], sents: List[str]) -> Optional[SupportMatch]:
    """Best pair of non-overlapping windows whose union covers the statement."""
    best: Optional[SupportMatch] = None
    for a_idx, a in enumerate(cands):
        if a.lexical_score < COMPOSITE_MIN_PART:
            continue
        a_tokens = set(tokens(a.quote))
        for b in cands[a_idx + 1:]:
            if b.lexical_score < COMPOSITE_MIN_PART:
                continue
            if not (a.end <= b.start or b.end <= a.start):
                continue  # overlapping ranges
            union = a_tokens | set(tokens(b.quote))
            score, matched, num_total, num_matched = _score_window(union, weights)
            if best is None or score > best.score:
                first, second = (a, b) if a.start < b.start else (b, a)
                quote = first.quote + " [...] " + second.quote
                best = SupportMatch(score=round(score, 4), quote=quote, matched_terms=matched,
                                    total_terms=len(weights), numeric_matched=num_matched, numeric_total=num_total,
                                    lexical_score=round(score, 4), start=first.start, end=second.end, composite=True)
    return best


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


async def locate_support(statement: str, text: str, embed_fn: Optional[EmbedFn] = None) -> Optional[SupportMatch]:
    """Return the best supporting window, blending embedding similarity when available."""
    cands = lexical_candidates(statement, text)
    if not cands:
        return None
    if embed_fn is not None:
        try:
            vecs = await embed_fn([statement] + [c.quote for c in cands])
            q = vecs[0]
            for c, v in zip(cands, vecs[1:]):
                cos = max(0.0, _cosine(q, v))
                c.embedding_score = round(cos, 4)
                c.score = round(0.6 * c.lexical_score + 0.4 * cos, 4)
                c.method = "lexical+embedding"
            cands.sort(key=lambda m: m.score, reverse=True)
        except Exception as exc:  # embedding is optional; never fail verification on it
            logger.info("embed adapter unavailable, lexical only: %s", exc)
    return cands[0]


def passes(match: Optional[SupportMatch], min_score: float = MIN_SCORE) -> Tuple[bool, str]:
    if match is None:
        return False, "no candidate passage found in source text"
    if match.composite and match.score < max(min_score, COMPOSITE_MIN_SCORE):
        return False, (f"composite passage score {match.score:.2f} below the composite threshold "
                       f"{max(min_score, COMPOSITE_MIN_SCORE):.2f} ({match.matched_terms}/{match.total_terms} terms)")
    if match.score < min_score:
        return False, (f"best passage score {match.score:.2f} below threshold {min_score:.2f} "
                       f"({match.matched_terms}/{match.total_terms} terms)")
    if match.matched_terms < MIN_MATCHED_TERMS:
        return False, f"only {match.matched_terms} content terms matched (minimum {MIN_MATCHED_TERMS})"
    if match.numeric_total and match.numeric_matched == 0:
        return False, "none of the statement's numeric values appear in the best passage"
    return True, ""


# ---------------------------------------------------------------------------
# Fetching and extraction
# ---------------------------------------------------------------------------

def is_homepage_only(url: str) -> bool:
    try:
        p = urlparse(url)
    except ValueError:
        return True
    host = (p.netloc or "").lower()
    path = (p.path or "").rstrip("/")
    if host in LANDING_PAGE_HOSTS:
        return True
    if (host, path or "/") in LANDING_PAGE_PATHS or (host, p.path) in LANDING_PAGE_PATHS:
        return True
    return path in ("", "/")


class RobotsCache:
    def __init__(self) -> None:
        self._parsers: Dict[str, Optional[robotparser.RobotFileParser]] = {}

    async def allowed(self, client: httpx.AsyncClient, url: str) -> bool:
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._parsers:
            rp = robotparser.RobotFileParser()
            try:
                r = await client.get(base + "/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=15)
                if r.status_code == 200 and "text" in r.headers.get("content-type", "text/plain"):
                    rp.parse(r.text.splitlines())
                    self._parsers[base] = rp
                else:
                    self._parsers[base] = None  # no robots -> allowed
            except Exception:
                self._parsers[base] = None
        rp = self._parsers[base]
        if rp is None:
            return True
        return rp.can_fetch(USER_AGENT, url) or rp.can_fetch("*", url)


class RateLimiter:
    def __init__(self, interval_s: float = PER_HOST_INTERVAL_S) -> None:
        self.interval = interval_s
        self._last: Dict[str, float] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    async def wait(self, url: str) -> None:
        host = urlparse(url).netloc.lower()
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            delay = self._last.get(host, 0.0) + self.interval - now
            if delay > 0:
                await asyncio.sleep(delay)
            self._last[host] = time.monotonic()


@dataclass
class Fetched:
    url: str
    final_url: str
    status: int
    content_type: str
    text: str
    kind: str  # html | pdf | xml | text
    error: str = ""
    retrieved_at: str = field(default_factory=utcnow_iso)


def _strip_xml(xml: str) -> str:
    xml = re.sub(r"<(front|back|ref-list)[\s\S]*?</\1>", " ", xml)
    xml = re.sub(r"<[^>]+>", " ", xml)
    return re.sub(r"\s+", " ", xml)


def _lxml_text(raw: str) -> str:
    try:
        from lxml import html as LH
    except Exception:  # pragma: no cover
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw))
    try:
        doc = LH.fromstring(raw)
    except Exception:
        return ""
    for bad in doc.xpath("//script|//style|//noscript|//nav|//header|//footer|//svg|//form"):
        parent = bad.getparent()
        if parent is not None:
            parent.remove(bad)
    body = doc.find("body")
    return re.sub(r"\s+", " ", (body if body is not None else doc).text_content()).strip()


def extract_text(content: bytes, content_type: str, url: str) -> Tuple[str, str]:
    """Return (text, kind) for a fetched document."""
    ctype = (content_type or "").lower()
    if "pdf" in ctype or url.lower().endswith(".pdf") or content[:5] == b"%PDF-":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(content))
        pages = reader.pages[:MAX_PDF_PAGES]
        text = " ".join((p.extract_text() or "") for p in pages)
        return re.sub(r"\s+", " ", text), "pdf"
    raw = content.decode("utf-8", errors="replace")
    if "xml" in ctype and "html" not in ctype:
        return _strip_xml(raw), "xml"
    if "html" in ctype or raw.lstrip()[:200].lower().startswith(("<!doctype html", "<html")):
        traf = ""
        try:
            import trafilatura

            traf = trafilatura.extract(raw, include_comments=False, include_tables=True, favor_recall=True) or ""
        except Exception as exc:  # pragma: no cover
            logger.info("trafilatura failed on %s: %s", url, exc)
        full = _lxml_text(raw)
        text = full if len(full) > len(traf) * 1.3 else traf
        return re.sub(r"\s+", " ", text), "html"
    return re.sub(r"\s+", " ", raw), "text"


async def fetch_document(url: str, client: httpx.AsyncClient, *, robots: Optional[RobotsCache] = None,
                         limiter: Optional[RateLimiter] = None) -> Fetched:
    robots = robots or RobotsCache()
    limiter = limiter or RateLimiter()
    if not await robots.allowed(client, url):
        return Fetched(url=url, final_url=url, status=0, content_type="", text="", kind="",
                       error="disallowed by robots.txt")
    await limiter.wait(url)
    try:
        r = await client.get(url, headers={"User-Agent": USER_AGENT,
                                           "Accept": "text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,*/*;q=0.5"},
                             follow_redirects=True, timeout=DEFAULT_TIMEOUT_S)
    except httpx.HTTPError as exc:
        return Fetched(url=url, final_url=url, status=0, content_type="", text="", kind="",
                       error=f"fetch error: {type(exc).__name__}: {exc}"[:300])
    if len(r.content) > MAX_BYTES:
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type="", text="", kind="",
                       error=f"document larger than {MAX_BYTES} bytes")
    ctype = r.headers.get("content-type", "")
    if r.status_code >= 400:
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text="", kind="",
                       error=f"HTTP {r.status_code}")
    try:
        text, kind = extract_text(r.content, ctype, str(r.url))
    except Exception as exc:
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text="", kind="",
                       error=f"extraction failed: {type(exc).__name__}: {exc}"[:300])
    low = text[:600].lower()
    if any(m in low for m in JS_WALL_MARKERS):
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text="", kind=kind,
                       error="source behind a JavaScript/anti-bot wall; document not retrievable headlessly")
    if any(m in low for m in LOGIN_MARKERS) or "/login" in str(r.url).lower():
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text="", kind=kind,
                       error="source requires a login; document not publicly retrievable")
    if len(text) < 200:
        return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text=text, kind=kind,
                       error=f"only {len(text)} characters of text extracted")
    return Fetched(url=url, final_url=str(r.url), status=r.status_code, content_type=ctype, text=text, kind=kind)


# ---------------------------------------------------------------------------
# Verifying statements
# ---------------------------------------------------------------------------

_URL_LOCKS: Dict[str, asyncio.Lock] = {}


@dataclass
class VerificationOutcome:
    statement_id: str
    status: str                      # verified | failed
    reason: str = ""
    quote: str = ""
    score: float = 0.0
    method: str = ""
    verification_url: str = ""
    retrieved_at: str = ""


def _replaced_notice(text: str) -> str:
    low = text[:1500].lower()
    m = re.search(r"this guideline has been (updated and )?replaced by[^.]{0,200}", low)
    return m.group(0) if m else ""


async def verify_statement(stmt: GuidelineStatement, client: httpx.AsyncClient, *, embed_fn: Optional[EmbedFn] = None,
                           robots: Optional[RobotsCache] = None, limiter: Optional[RateLimiter] = None,
                           min_score: float = MIN_SCORE,
                           cache: Optional[Dict[str, Fetched]] = None) -> VerificationOutcome:
    url = stmt.fetch_url or stmt.source_url
    if not url:
        return VerificationOutcome(stmt.id, "failed", "no source_url recorded")
    if is_homepage_only(stmt.source_url) and not stmt.fetch_url:
        return VerificationOutcome(stmt.id, "failed",
                                   "homepage-only source_url; the exact document URL is not recorded, so the "
                                   "statement cannot be evidenced")
    fetched: Optional[Fetched] = None
    if cache is None:
        fetched = await fetch_document(url, client, robots=robots, limiter=limiter)
    else:
        # One fetch per document even when several statements cite it concurrently.
        lock = _URL_LOCKS.setdefault(url, asyncio.Lock())
        async with lock:
            fetched = cache.get(url)
            if fetched is None:
                fetched = await fetch_document(url, client, robots=robots, limiter=limiter)
                cache[url] = fetched
    if fetched.error:
        return VerificationOutcome(stmt.id, "failed", fetched.error, verification_url=fetched.final_url or url,
                                   retrieved_at=fetched.retrieved_at)
    notice = _replaced_notice(fetched.text)
    if notice and len(fetched.text) < 2000:
        return VerificationOutcome(stmt.id, "failed", f"source withdrawn: {notice}", verification_url=fetched.final_url,
                                   retrieved_at=fetched.retrieved_at)
    match = await locate_support(stmt.statement_en, fetched.text, embed_fn)
    ok, why = passes(match, min_score)
    if not ok or match is None:
        best = f"; best candidate: {match.quote[:200]!r}" if match else ""
        return VerificationOutcome(stmt.id, "failed", why + best, score=match.score if match else 0.0,
                                   method=match.method if match else "lexical",
                                   verification_url=fetched.final_url, retrieved_at=fetched.retrieved_at)
    quote = match.quote
    if len(quote) > QUOTE_MAX_CHARS:
        quote = quote[: QUOTE_MAX_CHARS - 1].rsplit(" ", 1)[0] + "…"
    audit = (f"score {match.score:.2f}; {match.matched_terms}/{match.total_terms} terms"
             + ("; composite quote" if match.composite else "")
             + (f"; embedding {match.embedding_score:.2f}" if match.embedding_score is not None else "")
             + f"; {fetched.kind} {len(fetched.text)} chars")
    return VerificationOutcome(stmt.id, "verified", reason=audit, quote=quote, score=match.score, method=match.method,
                               verification_url=fetched.final_url, retrieved_at=fetched.retrieved_at)


def _gateway_embed_fn() -> Optional[EmbedFn]:
    """Use the app's Model Gateway embed adapter when the pod's embed side-car is up."""
    try:
        from server.config import get_settings
        from server.model_gateway import ModelGateway

        settings = get_settings()
        gw = ModelGateway(settings)
    except Exception:
        return None

    async def _embed(texts: Sequence[str]) -> List[List[float]]:
        await gw.start()
        try:
            return await gw.embed(list(texts))
        finally:
            await gw.aclose()

    return _embed


async def verify_store(store: GuidelineStore, *, ids: Optional[Sequence[str]] = None, only_status: Optional[str] = "draft",
                       embed_fn: Optional[EmbedFn] = None, verified_by: str = "agent:acudx-guideline-verifier/0.1",
                       concurrency: int = 4, min_score: float = MIN_SCORE,
                       client: Optional[httpx.AsyncClient] = None) -> Dict[str, Any]:
    """Verify every matching statement and write the outcome back. Returns a summary."""
    stmts = store.list(ids=list(ids) if ids else None)
    if only_status:
        stmts = [s for s in stmts if s.status == only_status]
    robots, limiter = RobotsCache(), RateLimiter()
    cache: Dict[str, Fetched] = {}
    sem = asyncio.Semaphore(max(1, concurrency))
    if embed_fn is not None:
        # Probe once: an unreachable embed side-car must not cost a retry per statement.
        try:
            await embed_fn(["probe"])
        except Exception as exc:
            logger.info("embed adapter unavailable (%s); verifying lexically", exc)
            embed_fn = None
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_S)
    outcomes: List[VerificationOutcome] = []

    async def _one(s: GuidelineStatement) -> None:
        async with sem:
            out = await verify_statement(s, client, embed_fn=embed_fn, robots=robots, limiter=limiter,
                                         min_score=min_score, cache=cache)
        store.set_verification(s.id, status=out.status, verified_by=verified_by if out.status == "verified" else "",
                               method=out.method, quote=out.quote, note=out.reason,
                               verification_url=out.verification_url, retrieved_at=out.retrieved_at)
        outcomes.append(out)

    try:
        await asyncio.gather(*(_one(s) for s in stmts))
    finally:
        if own_client:
            await client.aclose()
    verified = sorted(o.statement_id for o in outcomes if o.status == "verified")
    failed = {o.statement_id: o.reason for o in outcomes if o.status != "verified"}
    return {"checked": len(outcomes), "verified": len(verified), "failed": len(failed),
            "verified_ids": verified, "failed_reasons": dict(sorted(failed.items())),
            "counts": store.count_by_status(), "ran_at": utcnow_iso()}


async def verify_and_export(store: GuidelineStore, export_path: Optional[str] = None, **kw: Any) -> Dict[str, Any]:
    summary = await verify_store(store, **kw)
    store.export_json(export_path or EXPORT_PATH)
    return summary


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Verify GuidelineStatement drafts against their sources.")
    ap.add_argument("--db", default=None, help="SQLite path (default ACUDX_DB_PATH or server/data/acudx.db)")
    ap.add_argument("--export", default=str(EXPORT_PATH), help="JSON export path written after the run")
    ap.add_argument("--ids", nargs="*", default=None, help="only these statement ids")
    ap.add_argument("--all", action="store_true", help="re-verify every row, not only drafts")
    ap.add_argument("--min-score", type=float, default=MIN_SCORE)
    ap.add_argument("--no-embed", action="store_true", help="skip the gateway embed adapter")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    store = get_store(args.db)
    embed_fn = None if args.no_embed else _gateway_embed_fn()
    summary = asyncio.run(verify_and_export(store, args.export, ids=args.ids, only_status=None if args.all else "draft",
                                            embed_fn=embed_fn, min_score=args.min_score, concurrency=args.concurrency))
    print(f"checked={summary['checked']} verified={summary['verified']} failed={summary['failed']}")
    for sid, why in summary["failed_reasons"].items():
        print(f"  FAIL {sid}: {why[:220]}")
    print("counts:", summary["counts"])
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

"""SQLite-backed store for verified, versioned GuidelineStatement records.

Schema (one row per statement)::

    id, statement_en, statement_tr, source_body, source_title, source_url, fetch_url, doi,
    edition_or_version, published_date, retrieved_at, verified_at, verified_by,
    verification_method, verification_quote, verification_url, verification_note,
    license_tag, scope (JSON), condition_codes (JSON), topic, status

``status`` is one of ``draft`` (migrated, never checked), ``verified`` (a supporting passage
was located in the fetched source and recorded in ``verification_quote``), ``failed`` (the
verifier could not support the statement; the reason is in ``verification_note``) or
``retired``. Only ``verified`` rows may reach a learner.

The DB path comes from ``ACUDX_DB_PATH`` (default ``server/data/acudx.db``). ``":memory:"``
is accepted for tests. ``export_json`` / ``import_json`` round-trip the whole table so the
repository can carry the verification evidence (``server/guidelines/statements.verified.json``).
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from pydantic import BaseModel, Field

STATUSES = ("draft", "verified", "failed", "retired")

_HERE = Path(__file__).resolve().parent
SERVER_DIR = _HERE.parent
DEFAULT_DB_PATH = SERVER_DIR / "data" / "acudx.db"
EXPORT_PATH = _HERE / "statements.verified.json"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_db_path() -> str:
    return os.environ.get("ACUDX_DB_PATH") or str(DEFAULT_DB_PATH)


class GuidelineStatement(BaseModel):
    """One versioned, cited, verifiable recommendation record."""

    id: str
    statement_en: str
    statement_tr: str = ""
    source_body: str
    source_title: str
    source_url: str
    # Where the verifier fetches the exact document when the learner-facing source_url is a
    # DOI or publisher page that cannot be fetched headlessly (e.g. a Europe PMC mirror).
    fetch_url: str = ""
    doi: str = ""
    edition_or_version: str = ""
    published_date: str = ""
    retrieved_at: str = ""
    verified_at: str = ""
    verified_by: str = ""
    verification_method: str = ""
    verification_quote: str = ""
    verification_url: str = ""
    verification_note: str = ""
    license_tag: str = "open"
    scope: Dict[str, Any] = Field(default_factory=lambda: {"countries": ["GLOBAL"], "specialties": []})
    condition_codes: List[str] = Field(default_factory=list)
    topic: str = ""
    status: str = "draft"

    def learner_view(self, locale: str = "en") -> Dict[str, Any]:
        """The payload a learner may see (never includes a non-verified record)."""
        text = self.statement_tr if (locale == "tr" and self.statement_tr) else self.statement_en
        return {
            "id": self.id,
            "statement": text,
            "statement_en": self.statement_en,
            "statement_tr": self.statement_tr,
            "source_body": self.source_body,
            "source_title": self.source_title,
            "source_url": self.source_url,
            "doi": self.doi,
            "edition_or_version": self.edition_or_version,
            "published_date": self.published_date,
            "verified_at": self.verified_at,
            "verification_method": self.verification_method,
            "verification_quote": self.verification_quote,
            "license_tag": self.license_tag,
            "scope": self.scope,
            "condition_codes": list(self.condition_codes),
            "topic": self.topic,
            "status": self.status,
        }


_COLUMNS: Sequence[str] = tuple(GuidelineStatement.model_fields.keys())
_JSON_COLUMNS = {"scope", "condition_codes"}

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS guideline_statement (
    {", ".join(f"{c} TEXT" + (" PRIMARY KEY" if c == "id" else " NOT NULL DEFAULT ''") for c in _COLUMNS)}
);
CREATE INDEX IF NOT EXISTS idx_gs_status ON guideline_statement(status);
CREATE INDEX IF NOT EXISTS idx_gs_topic ON guideline_statement(topic);
"""


def _encode(stmt: GuidelineStatement) -> Dict[str, str]:
    row: Dict[str, str] = {}
    for col in _COLUMNS:
        val = getattr(stmt, col)
        row[col] = json.dumps(val, ensure_ascii=False) if col in _JSON_COLUMNS else str(val or "")
    return row


def _decode(row: sqlite3.Row) -> GuidelineStatement:
    data: Dict[str, Any] = {}
    for col in _COLUMNS:
        raw = row[col]
        if col in _JSON_COLUMNS:
            try:
                data[col] = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                data[col] = None
            if data[col] is None:
                data[col] = {} if col == "scope" else []
        else:
            data[col] = raw or ""
    return GuidelineStatement(**data)


def code_matches(requested: str, candidate: str) -> bool:
    """ICD code join: exact, or one is a dotted/undotted prefix of the other
    (``I21`` matches ``I21.3``; ``K35.80`` matches ``K35.8``)."""
    a = requested.strip().upper().replace(" ", "")
    b = candidate.strip().upper().replace(" ", "")
    if not a or not b:
        return False
    if a == b:
        return True
    a_flat, b_flat = a.replace(".", ""), b.replace(".", "")
    return a_flat.startswith(b_flat) or b_flat.startswith(a_flat)


class GuidelineStore:
    """Thin synchronous SQLite wrapper (statements are a few hundred rows at most)."""

    def __init__(self, path: Optional[str] = None):
        self.path = path or default_db_path()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self.init_schema()

    # -- lifecycle ----------------------------------------------------------
    def init_schema(self) -> None:
        with self._conn:
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        self._conn.close()

    # -- writes -------------------------------------------------------------
    def upsert(self, stmt: GuidelineStatement) -> None:
        row = _encode(stmt)
        cols = ", ".join(_COLUMNS)
        marks = ", ".join(f":{c}" for c in _COLUMNS)
        updates = ", ".join(f"{c}=excluded.{c}" for c in _COLUMNS if c != "id")
        with self._conn:
            self._conn.execute(
                f"INSERT INTO guideline_statement ({cols}) VALUES ({marks}) "
                f"ON CONFLICT(id) DO UPDATE SET {updates}",
                row,
            )

    def upsert_many(self, stmts: Iterable[GuidelineStatement]) -> int:
        n = 0
        for s in stmts:
            self.upsert(s)
            n += 1
        return n

    def add_draft(self, stmt: GuidelineStatement, *, overwrite_verified: bool = False) -> bool:
        """Insert or refresh a draft. A row that is already ``verified`` keeps its evidence
        unless ``overwrite_verified`` is set (re-authoring a statement invalidates its quote,
        so the caller must opt in). Returns True when the row was written."""
        existing = self.get(stmt.id)
        if existing is not None:
            unchanged = (existing.statement_en == stmt.statement_en and existing.statement_tr == stmt.statement_tr
                         and existing.source_url == stmt.source_url and existing.fetch_url == stmt.fetch_url)
            if unchanged and (existing.status != "verified" or not overwrite_verified):
                return False  # same text, same source: keep the row (and its evidence or failure reason)
        # Reset the evidence fields; keep the authored verification_note (e.g. a URL refinement).
        stmt = stmt.model_copy(update={"status": "draft", "verified_at": "", "verification_quote": "",
                                       "verification_method": "", "verification_url": "", "verified_by": ""})
        self.upsert(stmt)
        return True

    def set_verification(
        self,
        statement_id: str,
        *,
        status: str,
        verified_by: str = "",
        method: str = "",
        quote: str = "",
        note: str = "",
        verification_url: str = "",
        retrieved_at: str = "",
    ) -> None:
        if status not in STATUSES:
            raise ValueError(f"unknown status {status!r}")
        verified_at = utcnow_iso() if status == "verified" else ""
        with self._conn:
            self._conn.execute(
                "UPDATE guideline_statement SET status=?, verified_at=?, verified_by=?, "
                "verification_method=?, verification_quote=?, verification_note=?, "
                "verification_url=?, retrieved_at=COALESCE(NULLIF(?, ''), retrieved_at) WHERE id=?",
                (status, verified_at, verified_by, method, quote, note, verification_url,
                 retrieved_at, statement_id),
            )

    def delete(self, statement_id: str) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM guideline_statement WHERE id=?", (statement_id,))

    # -- reads --------------------------------------------------------------
    def get(self, statement_id: str) -> Optional[GuidelineStatement]:
        cur = self._conn.execute("SELECT * FROM guideline_statement WHERE id=?", (statement_id,))
        row = cur.fetchone()
        return _decode(row) if row else None

    def get_verified(self, statement_id: str) -> Optional[GuidelineStatement]:
        s = self.get(statement_id)
        return s if s is not None and s.status == "verified" else None

    def list(
        self,
        *,
        status: Optional[str] = None,
        condition: Optional[str] = None,
        ids: Optional[Sequence[str]] = None,
        topic: Optional[str] = None,
    ) -> List[GuidelineStatement]:
        sql = "SELECT * FROM guideline_statement"
        clauses: List[str] = []
        params: List[Any] = []
        if status:
            clauses.append("status=?")
            params.append(status)
        if topic:
            clauses.append("topic=?")
            params.append(topic)
        if ids is not None:
            if not ids:
                return []
            clauses.append(f"id IN ({','.join('?' for _ in ids)})")
            params.extend(ids)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY id"
        out = [_decode(r) for r in self._conn.execute(sql, params)]
        if condition:
            codes = resolve_condition_codes(condition)
            out = [s for s in out if any(code_matches(c, sc) for c in codes for sc in s.condition_codes)]
        return out

    def verified(self, **kw: Any) -> List[GuidelineStatement]:
        return self.list(status="verified", **kw)

    def count_by_status(self) -> Dict[str, int]:
        counts = {s: 0 for s in STATUSES}
        for row in self._conn.execute("SELECT status, COUNT(*) AS n FROM guideline_statement GROUP BY status"):
            counts[row["status"]] = row["n"]
        return counts

    def __len__(self) -> int:
        return int(self._conn.execute("SELECT COUNT(*) FROM guideline_statement").fetchone()[0])

    # -- export / import ----------------------------------------------------
    def export_json(self, path: Optional[os.PathLike[str] | str] = None) -> Dict[str, Any]:
        rows = [s.model_dump() for s in self.list()]
        payload = {
            "schema": "acudx.GuidelineStatement/1",
            "exported_at": utcnow_iso(),
            "counts": self.count_by_status(),
            "statements": rows,
        }
        if path is not None:
            Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return payload

    def import_json(self, path: os.PathLike[str] | str, *, replace: bool = False) -> int:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        rows = data.get("statements", data if isinstance(data, list) else [])
        if replace:
            with self._conn:
                self._conn.execute("DELETE FROM guideline_statement")
        return self.upsert_many(GuidelineStatement(**r) for r in rows)

    # -- seeding ------------------------------------------------------------
    def seed(self, *, include_legacy: bool = True, include_open: bool = True) -> int:
        """Migrate the seed corpora into the table as drafts. Verified rows whose text and
        source did not change keep their evidence. Returns the number of rows written."""
        from server.guidelines import seed_open  # local import: seed_open imports nothing from here at module load

        written = 0
        if include_legacy:
            for stmt in legacy_statements():
                if self.add_draft(stmt):
                    written += 1
        if include_open:
            for stmt in seed_open.open_statements():
                if self.add_draft(stmt):
                    written += 1
        return written


# ---------------------------------------------------------------------------
# Condition-code resolution (ICD-10 code, catalog id or free-text label)
# ---------------------------------------------------------------------------

def resolve_condition_codes(condition: str) -> List[str]:
    """Resolve ``condition`` to ICD-10 codes: a code is returned as-is; a
    ``server.condition_catalog`` id or (case-insensitive) label maps to its icd10 code."""
    cond = (condition or "").strip()
    if not cond:
        return []
    try:
        from server.condition_catalog import CATALOG
    except Exception:  # pragma: no cover - catalog is part of the repo
        CATALOG = []  # type: ignore[assignment]
    lowered = cond.lower()
    codes: List[str] = []
    for entry in CATALOG:
        if entry.get("id", "").lower() == lowered or entry.get("label_en", "").lower() == lowered \
                or entry.get("label_tr", "").lower() == lowered:
            codes.append(str(entry.get("icd10", "")))
    if codes:
        return [c for c in codes if c]
    # Looks like an ICD code (letter + digits, optional dot).
    import re

    if re.fullmatch(r"[A-Za-z][0-9]{1,2}(\.[0-9A-Za-z]{1,4})?[A-Za-z]?", cond):
        return [cond.upper()]
    return [cond]


# ---------------------------------------------------------------------------
# Legacy seed migration (server/guidelines_seed.py -> GuidelineStatement drafts)
# ---------------------------------------------------------------------------

def legacy_to_statement(rec: Dict[str, Any]) -> GuidelineStatement:
    """Project a ``guidelines_seed`` record onto the store schema. The learner-facing
    ``source_url`` is refined to the exact document URL where ``seed_open`` records one
    (e.g. a NICE landing page -> its Recommendations chapter); the original stays in
    ``verification_note`` for audit."""
    from server.guidelines import seed_open

    cite = rec.get("citation") or {}
    body = rec.get("statement") or {}
    url = str(cite.get("url") or rec.get("url") or "")
    refined = seed_open.URL_REFINEMENTS.get(rec["id"])
    note = ""
    if refined and refined != url:
        note = f"source_url refined from landing page {url} to the exact document"
        url = refined
    topic = rec.get("topic", "")
    scope = dict(rec.get("scope") or {})
    specialties = [rec.get("domain", "")] if rec.get("domain") else []
    return GuidelineStatement(
        id=rec["id"],
        statement_en=body.get("en", "") if isinstance(body, dict) else str(body),
        statement_tr=body.get("tr", "") if isinstance(body, dict) else "",
        source_body=str(cite.get("body") or rec.get("council") or ""),
        source_title=str(cite.get("title") or ""),
        source_url=url,
        fetch_url=seed_open.FETCH_URLS.get(rec["id"], ""),
        doi=seed_open.DOI_BY_ID.get(rec["id"], ""),
        edition_or_version=str(cite.get("reference") or ""),
        published_date=str(cite.get("pub_date") or rec.get("effective_date") or ""),
        license_tag=str(rec.get("license_tag") or "open"),
        scope={"countries": list(scope.get("countries") or [rec.get("country", "GLOBAL")]),
               "specialties": specialties,
               "population": scope.get("population", "adult"),
               "care_setting": list(scope.get("care_setting") or [])},
        condition_codes=list(seed_open.TOPIC_CONDITION_CODES.get(topic, [])),
        topic=topic,
        status="draft",
        verification_note=note,
    )


def legacy_statements() -> List[GuidelineStatement]:
    from server import guidelines_seed

    return [legacy_to_statement(r) for r in guidelines_seed.all_statements()]


def statement_to_legacy(stmt: GuidelineStatement) -> Dict[str, Any]:
    """Inverse projection used by ``server.grounding`` so its retrieval code keeps one shape."""
    countries = list((stmt.scope or {}).get("countries") or ["GLOBAL"])
    return {
        "id": stmt.id,
        "statement": {"en": stmt.statement_en, "tr": stmt.statement_tr or stmt.statement_en},
        "country": countries[0] if countries else "GLOBAL",
        "council": stmt.source_body,
        "topic": stmt.topic,
        "domain": ((stmt.scope or {}).get("specialties") or [""])[0],
        "scope": {"countries": countries, "council": stmt.source_body,
                  "population": (stmt.scope or {}).get("population", "adult"),
                  "care_setting": (stmt.scope or {}).get("care_setting", [])},
        "citation": {
            "body": stmt.source_body,
            "title": stmt.source_title,
            "reference": stmt.edition_or_version,
            "url": stmt.source_url,
            "pub_date": stmt.published_date,
            "doi": stmt.doi,
            "edition": stmt.edition_or_version,
            "verified_at": stmt.verified_at,
        },
        "url": stmt.source_url,
        "effective_date": stmt.published_date,
        "reviewed_date": stmt.verified_at[:10] if stmt.verified_at else "",
        "license_tag": stmt.license_tag,
        "condition_codes": list(stmt.condition_codes),
        "status": stmt.status,
        "embedding": None,
    }


# ---------------------------------------------------------------------------
# Process-wide store (opened lazily; falls back to the repo's verified export)
# ---------------------------------------------------------------------------

_STORE: Optional[GuidelineStore] = None


def get_store(path: Optional[str] = None) -> GuidelineStore:
    """Return the shared store. On first open, an EMPTY database is populated from
    ``statements.verified.json`` (the committed evidence) so a fresh deployment serves
    verified statements without any network access, then topped up with new drafts."""
    global _STORE
    if _STORE is None or (path is not None and path != _STORE.path):
        store = GuidelineStore(path)
        if len(store) == 0 and EXPORT_PATH.exists():
            store.import_json(EXPORT_PATH)
        store.seed()
        _STORE = store
    return _STORE


def reset_store() -> None:
    global _STORE
    if _STORE is not None:
        _STORE.close()
    _STORE = None

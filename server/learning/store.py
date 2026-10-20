"""SQLite store for encounter batches (hash-chained per org), reviews, case
submissions and assignments, plus the pure aggregation used by the dean panel.

Tables
------
``encounter_batches``  one row per finished encounter: the raw event log and the
                       summary as JSON, ``body_sha256`` over the canonical body,
                       ``prev_hash`` (previous row of the same org, genesis =
                       64 zeros) and ``chain_hash = sha256(prev_hash + body_sha256)``.
                       Append-only: a re-submitted encounter returns the stored row.
``encounter_reviews``  faculty review state for a flagged encounter (safety miss or
                       wrong diagnosis), with the co-signed per-domain overrides.
``case_submissions``   authored cases awaiting faculty review.
``assignments``        a case assigned to a learner by faculty / dean; completed
                       when that learner's encounter for the case is ingested.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

GENESIS = "0" * 64
DOMAINS: tuple[str, ...] = ("history", "exam", "reasoning", "communication", "management", "professionalism")
BANDS: tuple[str, ...] = ("emerging", "developing", "proficient", "strong", "exemplary")
WINDOWS: dict[str, int | None] = {"7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400, "all": None}

# Same thresholds as web/src/state/progressStore.ts bandFromCompetence.
_BAND_EDGES = ((0.85, "exemplary"), (0.68, "strong"), (0.52, "proficient"), (0.36, "developing"))


def band_from_competence(c: float) -> str:
    for edge, name in _BAND_EDGES:
        if c >= edge:
            return name
    return "emerging"


def canonical(body: Any) -> bytes:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def chain_next(prev_hash: str, body_sha256: str) -> str:
    return sha256_hex((prev_hash + body_sha256).encode("ascii"))


def user_hash(sub: str) -> str:
    return hashlib.sha256(sub.encode("utf-8")).hexdigest()[:16]


class LearningStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._mem: sqlite3.Connection | None = None
        if db_path == ":memory:":
            self._mem = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
            self._mem.row_factory = sqlite3.Row
        else:
            Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._conn().executescript(
            """
            CREATE TABLE IF NOT EXISTS encounter_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org TEXT NOT NULL,
                user_sub TEXT NOT NULL,
                user_hash TEXT NOT NULL,
                user_name TEXT,
                encounter_id TEXT NOT NULL,
                case_id TEXT NOT NULL,
                received_at REAL NOT NULL,
                started_at REAL,
                ended_at REAL,
                event_count INTEGER NOT NULL,
                body TEXT NOT NULL,
                summary TEXT NOT NULL,
                body_sha256 TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                chain_hash TEXT NOT NULL,
                UNIQUE (org, user_sub, encounter_id)
            );
            CREATE INDEX IF NOT EXISTS encounter_batches_org_time ON encounter_batches (org, received_at);
            CREATE TABLE IF NOT EXISTS encounter_reviews (
                batch_id INTEGER PRIMARY KEY REFERENCES encounter_batches(id),
                org TEXT NOT NULL,
                status TEXT NOT NULL,
                reasons TEXT NOT NULL DEFAULT '[]',
                flagged_at REAL NOT NULL,
                reviewer_sub TEXT,
                reviewer_name TEXT,
                decision TEXT,
                note TEXT,
                overrides TEXT,
                points INTEGER,
                cosigned INTEGER NOT NULL DEFAULT 0,
                reviewed_at REAL
            );
            CREATE TABLE IF NOT EXISTS case_submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org TEXT NOT NULL,
                case_id TEXT NOT NULL,
                title TEXT NOT NULL,
                author_sub TEXT NOT NULL,
                author_name TEXT,
                submitted_at REAL NOT NULL,
                status TEXT NOT NULL,
                reviewer_sub TEXT,
                reviewed_at REAL,
                note TEXT,
                payload TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS case_submissions_org_status ON case_submissions (org, status);
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org TEXT NOT NULL,
                case_id TEXT NOT NULL,
                title TEXT,
                assigned_by TEXT NOT NULL,
                assignee_sub TEXT NOT NULL,
                reason TEXT,
                due_at REAL,
                created_at REAL NOT NULL,
                completed_at REAL
            );
            CREATE INDEX IF NOT EXISTS assignments_org_assignee ON assignments (org, assignee_sub);
            """
        )

    def _conn(self) -> sqlite3.Connection:
        if self._mem is not None:
            return self._mem
        c = sqlite3.connect(self.db_path, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    # ------------------------------------------------------------------ ingest #
    def head(self, org: str) -> tuple[int, str]:
        row = self._conn().execute(
            "SELECT id, chain_hash FROM encounter_batches WHERE org = ? ORDER BY id DESC LIMIT 1", (org,)
        ).fetchone()
        return (int(row["id"]), str(row["chain_hash"])) if row else (0, GENESIS)

    def ingest(self, *, org: str, user_sub: str, user_name: str | None, encounter_id: str, case_id: str,
               started_at: float | None, ended_at: float | None, events: list[dict[str, Any]],
               summary: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Append a batch; returns (row, created). Idempotent on (org, user_sub, encounter_id)."""
        c = self._conn()
        existing = c.execute(
            "SELECT * FROM encounter_batches WHERE org = ? AND user_sub = ? AND encounter_id = ?",
            (org, user_sub, encounter_id),
        ).fetchone()
        if existing:
            return self._batch_row(existing), False
        body = {"encounter_id": encounter_id, "case_id": case_id, "started_at": started_at, "ended_at": ended_at,
                "events": events, "summary": summary}
        body_hash = sha256_hex(canonical(body))
        c.execute("BEGIN IMMEDIATE")
        try:
            _, prev = self.head(org)
            chain = chain_next(prev, body_hash)
            now = time.time()
            cur = c.execute(
                "INSERT INTO encounter_batches (org, user_sub, user_hash, user_name, encounter_id, case_id, received_at, "
                "started_at, ended_at, event_count, body, summary, body_sha256, prev_hash, chain_hash) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (org, user_sub, user_hash(user_sub), user_name, encounter_id, case_id, now, started_at, ended_at,
                 len(events), json.dumps(body, ensure_ascii=False), json.dumps(summary, ensure_ascii=False),
                 body_hash, prev, chain),
            )
            batch_id = int(cur.lastrowid or 0)
            reasons = flag_reasons(summary)
            if reasons:
                c.execute(
                    "INSERT INTO encounter_reviews (batch_id, org, status, reasons, flagged_at) VALUES (?, ?, 'flagged', ?, ?)",
                    (batch_id, org, json.dumps(reasons), now),
                )
            c.execute(
                "UPDATE assignments SET completed_at = ? WHERE org = ? AND assignee_sub = ? AND case_id = ? "
                "AND completed_at IS NULL",
                (now, org, user_sub, case_id),
            )
            c.execute("COMMIT")
        except Exception:
            c.execute("ROLLBACK")
            raise
        row = c.execute("SELECT * FROM encounter_batches WHERE id = ?", (batch_id,)).fetchone()
        return self._batch_row(row), True

    @staticmethod
    def _batch_row(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["summary"] = json.loads(d["summary"])
        d.pop("body", None)
        return d

    def batches(self, org: str, *, since: float | None = None, user_sub: str | None = None) -> list[dict[str, Any]]:
        c = self._conn()
        sql = "SELECT * FROM encounter_batches WHERE org = ?"
        args: list[Any] = [org]
        if since is not None:
            sql += " AND received_at >= ?"
            args.append(since)
        if user_sub is not None:
            sql += " AND user_sub = ?"
            args.append(user_sub)
        sql += " ORDER BY id"
        return [self._batch_row(r) for r in c.execute(sql, args).fetchall()]

    def verify_chain(self, org: str) -> dict[str, Any]:
        """Recompute every link of an org's chain; reports the first broken row, if any."""
        c = self._conn()
        rows = c.execute("SELECT id, body, body_sha256, prev_hash, chain_hash FROM encounter_batches WHERE org = ? ORDER BY id",
                         (org,)).fetchall()
        prev = GENESIS
        for r in rows:
            body_hash = sha256_hex(canonical(json.loads(r["body"])))
            if body_hash != r["body_sha256"] or r["prev_hash"] != prev or chain_next(prev, body_hash) != r["chain_hash"]:
                return {"ok": False, "length": len(rows), "broken_at": int(r["id"]), "head": None}
            prev = r["chain_hash"]
        return {"ok": True, "length": len(rows), "broken_at": None, "head": prev if rows else None}

    # ----------------------------------------------------------------- reviews #
    def flagged(self, org: str) -> list[dict[str, Any]]:
        c = self._conn()
        rows = c.execute(
            "SELECT r.*, b.user_hash, b.user_name, b.case_id, b.encounter_id, b.summary, b.received_at "
            "FROM encounter_reviews r JOIN encounter_batches b ON b.id = r.batch_id "
            "WHERE r.org = ? AND r.status = 'flagged' ORDER BY r.flagged_at", (org,)
        ).fetchall()
        return [self._review_row(r) for r in rows]

    def reviews(self, org: str, *, limit: int = 100) -> list[dict[str, Any]]:
        c = self._conn()
        rows = c.execute(
            "SELECT r.*, b.user_hash, b.user_name, b.case_id, b.encounter_id, b.summary, b.received_at "
            "FROM encounter_reviews r JOIN encounter_batches b ON b.id = r.batch_id "
            "WHERE r.org = ? ORDER BY r.flagged_at DESC LIMIT ?", (org, limit)
        ).fetchall()
        return [self._review_row(r) for r in rows]

    @staticmethod
    def _review_row(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["reasons"] = json.loads(d.get("reasons") or "[]")
        d["overrides"] = json.loads(d["overrides"]) if d.get("overrides") else None
        d["cosigned"] = bool(d.get("cosigned"))
        d["summary"] = json.loads(d["summary"]) if isinstance(d.get("summary"), str) else d.get("summary")
        return d

    def review(self, org: str, batch_id: int, *, reviewer_sub: str, reviewer_name: str | None, decision: str,
               note: str | None, overrides: dict[str, str] | None, points: int | None, cosigned: bool) -> dict[str, Any] | None:
        c = self._conn()
        row = c.execute("SELECT batch_id FROM encounter_reviews WHERE org = ? AND batch_id = ?", (org, batch_id)).fetchone()
        if row is None:
            exists = c.execute("SELECT id FROM encounter_batches WHERE org = ? AND id = ?", (org, batch_id)).fetchone()
            if exists is None:
                return None
            c.execute("INSERT INTO encounter_reviews (batch_id, org, status, reasons, flagged_at) VALUES (?, ?, 'flagged', '[]', ?)",
                      (batch_id, org, time.time()))
        c.execute(
            "UPDATE encounter_reviews SET status = 'reviewed', reviewer_sub = ?, reviewer_name = ?, decision = ?, note = ?, "
            "overrides = ?, points = ?, cosigned = ?, reviewed_at = ? WHERE org = ? AND batch_id = ?",
            (reviewer_sub, reviewer_name, decision, note, json.dumps(overrides) if overrides else None, points,
             int(cosigned), time.time(), org, batch_id),
        )
        r = c.execute(
            "SELECT r.*, b.user_hash, b.user_name, b.case_id, b.encounter_id, b.summary, b.received_at "
            "FROM encounter_reviews r JOIN encounter_batches b ON b.id = r.batch_id WHERE r.batch_id = ?", (batch_id,)
        ).fetchone()
        return self._review_row(r)

    # ------------------------------------------------------------- submissions #
    def submit_case(self, *, org: str, case_id: str, title: str, author_sub: str, author_name: str | None,
                    payload: dict[str, Any]) -> dict[str, Any]:
        c = self._conn()
        cur = c.execute(
            "INSERT INTO case_submissions (org, case_id, title, author_sub, author_name, submitted_at, status, payload) "
            "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
            (org, case_id, title, author_sub, author_name, time.time(), json.dumps(payload, ensure_ascii=False)),
        )
        return self._submission(c.execute("SELECT * FROM case_submissions WHERE id = ?", (cur.lastrowid,)).fetchone())

    def submissions(self, org: str, status: str | None = "pending") -> list[dict[str, Any]]:
        c = self._conn()
        if status:
            rows = c.execute("SELECT * FROM case_submissions WHERE org = ? AND status = ? ORDER BY submitted_at", (org, status)).fetchall()
        else:
            rows = c.execute("SELECT * FROM case_submissions WHERE org = ? ORDER BY submitted_at DESC", (org,)).fetchall()
        return [self._submission(r) for r in rows]

    def decide_case(self, org: str, submission_id: int, *, status: str, reviewer_sub: str, note: str | None) -> dict[str, Any] | None:
        c = self._conn()
        cur = c.execute(
            "UPDATE case_submissions SET status = ?, reviewer_sub = ?, reviewed_at = ?, note = ? WHERE org = ? AND id = ?",
            (status, reviewer_sub, time.time(), note, org, submission_id),
        )
        if cur.rowcount == 0:
            return None
        return self._submission(c.execute("SELECT * FROM case_submissions WHERE id = ?", (submission_id,)).fetchone())

    @staticmethod
    def _submission(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["payload"] = json.loads(d.get("payload") or "{}")
        return d

    # ------------------------------------------------------------- assignments #
    def assign(self, *, org: str, case_id: str, title: str | None, assigned_by: str, assignees: list[str],
               reason: str | None, due_at: float | None) -> list[dict[str, Any]]:
        c = self._conn()
        now = time.time()
        ids: list[int] = []
        for sub in dict.fromkeys(assignees):
            open_row = c.execute(
                "SELECT id FROM assignments WHERE org = ? AND case_id = ? AND assignee_sub = ? AND completed_at IS NULL",
                (org, case_id, sub),
            ).fetchone()
            if open_row:
                ids.append(int(open_row["id"]))
                continue
            cur = c.execute(
                "INSERT INTO assignments (org, case_id, title, assigned_by, assignee_sub, reason, due_at, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (org, case_id, title, assigned_by, sub, reason, due_at, now),
            )
            ids.append(int(cur.lastrowid or 0))
        if not ids:
            return []
        marks = ",".join("?" for _ in ids)
        return [dict(r) for r in c.execute(f"SELECT * FROM assignments WHERE id IN ({marks}) ORDER BY id", ids).fetchall()]

    def assignments(self, org: str, *, assignee_sub: str | None = None, open_only: bool = False) -> list[dict[str, Any]]:
        c = self._conn()
        sql = "SELECT * FROM assignments WHERE org = ?"
        args: list[Any] = [org]
        if assignee_sub is not None:
            sql += " AND assignee_sub = ?"
            args.append(assignee_sub)
        if open_only:
            sql += " AND completed_at IS NULL"
        sql += " ORDER BY created_at DESC"
        return [dict(r) for r in c.execute(sql, args).fetchall()]

    def learner_subs(self, org: str) -> list[str]:
        c = self._conn()
        return [str(r["user_sub"]) for r in c.execute("SELECT DISTINCT user_sub FROM encounter_batches WHERE org = ?", (org,)).fetchall()]

    # -------------------------------------------------------------- roster #
    def roster(self, org: str, directory: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Users seen in the org (directory rows + anyone who sent encounters) with activity counts."""
        c = self._conn()
        agg = {
            str(r["user_sub"]): dict(r)
            for r in c.execute(
                "SELECT user_sub, user_hash, MAX(user_name) AS user_name, COUNT(*) AS encounters, MAX(received_at) AS last_at "
                "FROM encounter_batches WHERE org = ? GROUP BY user_sub", (org,)
            ).fetchall()
        }
        open_assign = Counter(str(r["assignee_sub"]) for r in c.execute(
            "SELECT assignee_sub FROM assignments WHERE org = ? AND completed_at IS NULL", (org,)).fetchall())
        safety = Counter()
        for b in self.batches(org):
            if b["summary"].get("safety_miss"):
                safety[b["user_sub"]] += 1
        out: dict[str, dict[str, Any]] = {}
        for d in directory:
            out[d["sub"]] = {"sub": d["sub"], "user_hash": user_hash(d["sub"]), "name": d.get("name"), "email": d.get("email"),
                             "roles": d.get("roles") or [], "encounters": 0, "last_at": d.get("last_seen_at"),
                             "open_assignments": open_assign.get(d["sub"], 0), "safety_misses": 0}
        for sub, a in agg.items():
            row = out.setdefault(sub, {"sub": sub, "user_hash": a["user_hash"], "name": a.get("user_name"), "email": None,
                                       "roles": [], "encounters": 0, "last_at": None,
                                       "open_assignments": open_assign.get(sub, 0), "safety_misses": 0})
            row["encounters"] = int(a["encounters"])
            row["name"] = row.get("name") or a.get("user_name")
            row["last_at"] = max(filter(None, [row.get("last_at"), a.get("last_at")]), default=None)
            row["safety_misses"] = safety.get(sub, 0)
        return sorted(out.values(), key=lambda r: ((r.get("name") or "").lower(), r["sub"]))


# ----------------------------------------------------------------------------- #
# pure helpers                                                                  #
# ----------------------------------------------------------------------------- #
def flag_reasons(summary: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if summary.get("safety_miss"):
        reasons.append("safety_miss")
    if summary.get("diagnosis_correct") is False:
        reasons.append("diagnosis_incorrect")
    return reasons


def _domain_scores(summary: dict[str, Any]) -> list[dict[str, Any]]:
    ds = summary.get("domain_scores")
    return [d for d in ds if isinstance(d, dict) and d.get("key") in DOMAINS] if isinstance(ds, list) else []


def window_since(window: str, now: float) -> float | None:
    secs = WINDOWS.get(window, WINDOWS["30d"])
    return None if secs is None else now - secs


def aggregate_cohort(batches: list[dict[str, Any]], *, now: float, window: str) -> dict[str, Any]:
    """Cohort read-outs from stored batches: bands by domain, calibration, at-risk learners, activity series."""
    bands: dict[str, Counter] = {d: Counter() for d in DOMAINS}
    cal_gap: dict[str, list[float]] = defaultdict(list)
    cal_dir: dict[str, Counter] = {d: Counter() for d in DOMAINS}
    per_user: dict[str, dict[str, Any]] = {}
    briers: list[float] = []
    dx_ok = 0
    safety = 0
    for b in batches:
        s = b["summary"]
        u = per_user.setdefault(b["user_hash"], {"user_hash": b["user_hash"], "encounters": 0, "safety_misses": 0,
                                                 "dx_correct": 0, "comp": defaultdict(list), "gaps": [], "last_at": 0.0})
        u["encounters"] += 1
        u["last_at"] = max(u["last_at"], float(b["received_at"]))
        if s.get("safety_miss"):
            safety += 1
            u["safety_misses"] += 1
        if s.get("diagnosis_correct"):
            dx_ok += 1
            u["dx_correct"] += 1
        if isinstance(s.get("brier"), (int, float)):
            briers.append(float(s["brier"]))
        if isinstance(s.get("overall_gap"), (int, float)):
            u["gaps"].append(float(s["overall_gap"]))
        for d in _domain_scores(s):
            key = d["key"]
            if not d.get("scored"):
                bands[key]["withheld"] += 1
                continue
            comp = float(d.get("competence") or 0.0)
            conf = float(d.get("confidence") or 0.0)
            bands[key][str(d.get("band") or band_from_competence(comp))] += 1
            u["comp"][key].append(comp)
            delta = conf - comp
            cal_gap[key].append(abs(delta))
            cal_dir[key]["over" if delta > 0.12 else "under" if delta < -0.12 else "well"] += 1

    learners: list[dict[str, Any]] = []
    for u in per_user.values():
        domains: dict[str, dict[str, Any]] = {}
        weak = 0
        for key in DOMAINS:
            vals = u["comp"].get(key, [])
            if vals:
                mean = sum(vals) / len(vals)
                domains[key] = {"band": band_from_competence(mean), "competence": round(mean, 3), "n": len(vals)}
                if mean < 0.52:
                    weak += 1
            else:
                domains[key] = {"band": "withheld", "competence": None, "n": 0}
        n = u["encounters"]
        reasons: list[str] = []
        if u["safety_misses"] > 0 and u["safety_misses"] / n >= 0.34:
            reasons.append("safety")
        if weak >= 2:
            reasons.append("competence")
        if n >= 2 and u["dx_correct"] / n < 0.5:
            reasons.append("diagnosis")
        mean_gap = round(sum(u["gaps"]) / len(u["gaps"]), 3) if u["gaps"] else None
        if mean_gap is not None and mean_gap > 0.3:
            reasons.append("calibration")
        weakest = min((k for k in DOMAINS if domains[k]["competence"] is not None),
                      key=lambda k: domains[k]["competence"], default=None)
        learners.append({"user_hash": u["user_hash"], "handle": u["user_hash"][:6].upper(), "encounters": n,
                         "safety_misses": u["safety_misses"], "dx_accuracy": round(u["dx_correct"] / n, 3),
                         "mean_gap": mean_gap, "domains": domains, "weakest_domain": weakest,
                         "at_risk": bool(reasons), "reasons": reasons, "last_at": u["last_at"]})
    learners.sort(key=lambda x: (not x["at_risk"], -(x["safety_misses"]), x["handle"]))

    since = window_since(window, now)
    bucket = 86400 if window in ("7d", "30d") else 7 * 86400
    start = since if since is not None else (min((float(b["received_at"]) for b in batches), default=now) // bucket) * bucket
    series: list[dict[str, Any]] = []
    counts: dict[int, Counter] = defaultdict(Counter)
    users_in: dict[int, set[str]] = defaultdict(set)
    for b in batches:
        i = int((float(b["received_at"]) - start) // bucket)
        counts[i]["encounters"] += 1
        users_in[i].add(b["user_hash"])
    n_buckets = int((now - start) // bucket) + 1
    for i in range(max(0, n_buckets)):
        series.append({"bucket_start": start + i * bucket, "encounters": counts[i]["encounters"], "learners": len(users_in[i])})

    total = len(batches)
    return {
        "encounters": total,
        "learner_count": len(per_user),
        "kpis": {
            "dx_accuracy": round(dx_ok / total, 3) if total else None,
            "safety_miss_rate": round(safety / total, 3) if total else None,
            "mean_brier": round(sum(briers) / len(briers), 3) if briers else None,
            "at_risk": sum(1 for x in learners if x["at_risk"]),
        },
        "bands_by_domain": {d: {**{b: bands[d][b] for b in BANDS}, "withheld": bands[d]["withheld"]} for d in DOMAINS},
        "calibration": {
            "by_domain": [
                {"domain": d, "n": len(cal_gap[d]),
                 "mean_gap": round(sum(cal_gap[d]) / len(cal_gap[d]), 3) if cal_gap[d] else None,
                 "over": cal_dir[d]["over"], "under": cal_dir[d]["under"], "well": cal_dir[d]["well"]}
                for d in DOMAINS
            ],
        },
        "learners": learners,
        "activity": series,
    }


def export_rows(batches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """De-identified accreditation rows: masked handle, domain bands, outcome flags. No names, no subs."""
    rows: list[dict[str, Any]] = []
    for b in batches:
        s = b["summary"]
        rows.append({
            "handle": b["user_hash"][:6].upper(),
            "encounter": b["encounter_id"],
            "case_id": b["case_id"],
            "received_at": b["received_at"],
            "diagnosis_correct": bool(s.get("diagnosis_correct")),
            "safety_miss": bool(s.get("safety_miss")),
            "brier": s.get("brier"),
            "bands": {d["key"]: d.get("band") for d in _domain_scores(s)},
            "chain_hash": b["chain_hash"],
        })
    return rows

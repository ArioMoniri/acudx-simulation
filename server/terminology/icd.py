"""ICD-10-CM FY2027 and ICD-11 MMS 2026-01: load, search, relate.

Data files are built by ``scripts/terminology/build_terminology.py`` from the
official releases (CDC/NCHS ICD-10-CM, public domain; WHO ICD-11 MMS simple
tabulation, CC BY-ND 3.0 IGO, kept unmodified with code, title and URI as the
WHO terms of use require). Nothing here calls the network.

Search ranks a query against the code (prefix, dot optional) and against the
title plus the ICD-10-CM alphabetic-index phrases that point at the code (the
index is the official synonym source: "heart attack" reaches I21.9 through
"Attack, heart"). Every query token must prefix-match a word of the entry.
"""

from __future__ import annotations

import bisect
import gzip
import json
import os
import re
import threading
from array import array
from typing import Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
ICD10CM_PATH = os.path.join(DATA_DIR, "icd10cm-fy2027.json.gz")
ICD11_PATH = os.path.join(DATA_DIR, "icd11-mms-2026-01.json.gz")

_WORD = re.compile(r"[a-z0-9]+")
# Words that carry no meaning for a search (kept short on purpose: "of" and
# "with" matter less than the clinical words, but "type 1" must keep its digit).
_STOP = frozenset({"and", "or", "the", "of", "in", "to", "a", "an", "by", "for", "as", "at", "on", "nec", "nos"})


# Common clinical abbreviations a learner types, expanded to the words of the
# official titles. This table is an AcuDx addition, not part of ICD-10-CM or
# ICD-11; it only rewrites the query and never changes a code or a title.
ABBREVIATIONS: dict[str, str] = {
    "mi": "myocardial infarction", "ami": "acute myocardial infarction",
    "acs": "acute coronary", "pe": "pulmonary embolism",
    "dvt": "deep vein thrombosis", "dka": "diabetic ketoacidosis", "hhs": "hyperosmolar hyperglycemic",
    "copd": "chronic obstructive pulmonary disease", "uti": "urinary tract infection", "chf": "heart failure",
    "hf": "heart failure", "af": "atrial fibrillation", "afib": "atrial fibrillation", "svt": "supraventricular tachycardia",
    "vt": "ventricular tachycardia", "aki": "acute kidney failure", "ckd": "chronic kidney disease",
    "cap": "pneumonia", "tia": "transient cerebral ischemic attack", "sah": "subarachnoid hemorrhage",
    "ich": "intracerebral hemorrhage", "gi": "gastrointestinal", "gib": "gastrointestinal hemorrhage",
    "ugib": "upper gastrointestinal hemorrhage", "sbo": "intestinal obstruction", "ards": "acute respiratory distress syndrome",
    "htn": "hypertension", "dm": "diabetes mellitus", "t1dm": "type 1 diabetes mellitus", "t2dm": "type 2 diabetes mellitus",
    "ptx": "pneumothorax", "ra": "rheumatoid arthritis", "sle": "systemic lupus erythematosus", "ms": "multiple sclerosis",
    "tb": "tuberculosis", "rsv": "respiratory syncytial",
    "aaa": "abdominal aortic aneurysm", "ibd": "inflammatory bowel", "gerd": "gastro esophageal reflux",
}


def _tokens(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


def normalise_icd10(code: str) -> str:
    """Upper case, no dot: ``i21.09`` -> ``I2109``."""
    return re.sub(r"[^A-Z0-9]", "", str(code or "").upper())


def dotted_icd10(code: str) -> str:
    c = normalise_icd10(code)
    return c if len(c) <= 3 else f"{c[:3]}.{c[3:]}"


class _Index:
    """Token index over one code system (immutable after build)."""

    def __init__(self, path: str, system: str) -> None:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            payload = json.load(fh)
        self.meta = {k: v for k, v in payload.items() if k != "codes"}
        self.system = system
        self.rows: list[list[Any]] = payload["codes"]
        self.by_code: dict[str, int] = {}
        postings: dict[str, array] = {}
        title_words: list[frozenset[str]] = []
        for i, row in enumerate(self.rows):
            self.by_code[normalise_icd10(row[0]) if system == "icd10cm" else row[0].upper()] = i
            title_toks = _tokens(row[1])
            title_words.append(frozenset(title_toks))
            extra = row[3] if system == "icd10cm" else []
            seen: set[str] = set()
            for tok in title_toks + [t for phrase in extra for t in _tokens(phrase)]:
                if tok not in seen:
                    seen.add(tok)
                    postings.setdefault(tok, array("I")).append(i)
        self.title_words = title_words
        self.vocab = sorted(postings)
        self.postings = postings
        self.codes_sorted = sorted(self.by_code)

    # ------------------------------------------------------------------ #
    def _prefix_docs(self, tok: str) -> set[int]:
        out: set[int] = set()
        lo = bisect.bisect_left(self.vocab, tok)
        for j in range(lo, len(self.vocab)):
            word = self.vocab[j]
            if not word.startswith(tok):
                break
            out.update(self.postings[word])
            if len(out) > 60000:
                break
        return out

    def entry(self, i: int, score: float = 0.0, matched: Optional[str] = None) -> dict[str, Any]:
        row = self.rows[i]
        if self.system == "icd10cm":
            return {"system": "icd10cm", "code": row[0], "title": row[1], "billable": bool(row[2]),
                    "matched_term": matched, "score": round(score, 3)}
        return {"system": "icd11", "code": row[0], "title": row[1], "leaf": bool(row[2]), "uri": row[3],
                "browser_url": f"https://icd.who.int/browse/{self.meta.get('release', 'latest')}/mms/en#{row[3].rsplit('/', 1)[-1]}",
                "matched_term": matched, "score": round(score, 3)}

    def lookup(self, code: str) -> Optional[dict[str, Any]]:
        key = normalise_icd10(code) if self.system == "icd10cm" else str(code).upper()
        i = self.by_code.get(key)
        return None if i is None else self.entry(i)

    def search(self, query: str, limit: int = 25, billable_only: bool = False) -> list[dict[str, Any]]:
        q = (query or "").strip()
        if not q:
            return []
        results: dict[int, tuple[float, Optional[str]]] = {}
        code_q = normalise_icd10(q) if self.system == "icd10cm" else q.upper().replace(" ", "")
        # 1. Code prefix (I21, i21.0, 1A0, BA41).
        if re.fullmatch(r"[A-Z0-9]{2,8}", code_q) and re.search(r"\d", code_q):
            lo = bisect.bisect_left(self.codes_sorted, code_q)
            for j in range(lo, min(len(self.codes_sorted), lo + 400)):
                c = self.codes_sorted[j]
                if not c.startswith(code_q):
                    break
                i = self.by_code[c]
                results[i] = (100.0 - 0.5 * (len(c) - len(code_q)), None)
        # 2. Words: every token must prefix-match a word of title or index terms.
        toks = _tokens(q)
        if len(toks) == 1 and toks[0] in ABBREVIATIONS:
            toks = _tokens(ABBREVIATIONS[toks[0]])
        if toks:
            docs: Optional[set[int]] = None
            for tok in sorted(toks, key=len, reverse=True):
                hit = self._prefix_docs(tok)
                docs = hit if docs is None else docs & hit
                if not docs:
                    break
            for i in docs or ():
                row = self.rows[i]
                tw = self.title_words[i]
                in_title = sum(1 for t in toks if any(w.startswith(t) for w in tw))
                exact = sum(1 for t in toks if t in tw)
                matched = None
                phrase_hit = 0.0
                if in_title < len(toks) and self.system == "icd10cm":
                    for p in row[3]:
                        pw = _tokens(p)
                        if all(any(w.startswith(t) for w in pw) for t in toks):
                            matched = p
                            # An index phrase holding every word is as good as the title.
                            phrase_hit = 6.0 * (len(toks) - in_title) + (2.0 if pw and pw[0].startswith(toks[0]) else 0.0)
                            break
                score = 40.0 + 6.0 * in_title + 3.0 * exact + phrase_hit - 1.2 * max(0, len(tw) - len(toks))
                if row[1].lower().startswith(q.lower()):
                    score += 4.0
                if "unspecified" in tw and "unspecified" not in toks:
                    score += 2.5  # the unspecified code is the usual pick when the query names no detail
                billable = bool(row[2])
                score += 2.0 if billable else 0.0
                if self.system == "icd10cm" and row[0][:1] in "OPZVWXY" and not any(
                        t.startswith(("pregn", "newborn", "neonat", "birth", "deliver", "history", "screen", "encounter")) for t in toks):
                    # Obstetric, perinatal, factor (Z) and external-cause chapters only lead when asked for.
                    score -= 6.0
                prev = results.get(i)
                if prev is None or prev[0] < score:
                    results[i] = (score, matched)
        ranked = sorted(results.items(), key=lambda kv: (-kv[1][0], self.rows[kv[0]][0]))
        out = []
        for i, (score, matched) in ranked:
            if billable_only and not self.rows[i][2]:
                continue
            out.append(self.entry(i, score, matched))
            if len(out) >= limit:
                break
        return out


_lock = threading.Lock()
_cache: dict[str, Optional[_Index]] = {}


def _get(system: str) -> Optional[_Index]:
    with _lock:
        if system not in _cache:
            path = ICD10CM_PATH if system == "icd10cm" else ICD11_PATH
            _cache[system] = _Index(path, system) if os.path.exists(path) else None
        return _cache[system]


def icd10cm() -> Optional[_Index]:
    return _get("icd10cm")


def icd11() -> Optional[_Index]:
    return _get("icd11")


def status() -> dict[str, Any]:
    out: dict[str, Any] = {}
    for system, path in (("icd10cm", ICD10CM_PATH), ("icd11", ICD11_PATH)):
        idx = _get(system)
        out[system] = {"available": idx is not None, "count": len(idx.rows) if idx else 0,
                       **({k: idx.meta.get(k) for k in ("release", "effective", "licence", "citation", "source", "browser") if idx.meta.get(k)} if idx else {})}
    return out


def ancestors_icd10(code: str) -> list[str]:
    """Dotted ancestor categories of an ICD-10-CM code that exist in the release
    (``I21.09`` -> ``["I21.0", "I21"]``)."""
    idx = icd10cm()
    c = normalise_icd10(code)
    out = []
    for n in range(len(c) - 1, 2, -1):
        cand = c[:n]
        if idx is None or cand in idx.by_code:
            out.append(dotted_icd10(cand))
    return out


def relate_icd10(committed: str, target: str) -> dict[str, Any]:
    """How a committed code relates to the target code, for debrief scoring.

    * ``exact``: same code;
    * ``more_specific``: the committed code is a descendant of the target
      (``I21.09`` committed for ``I21.0``), counted as correct;
    * ``less_specific``: the committed code is an ancestor (``I21`` for ``I21.09``);
    * ``same_category``: same three-character category;
    * ``same_block``: same chapter letter and first digit (an adjacent block);
    * ``unrelated``.
    """
    a, b = normalise_icd10(committed), normalise_icd10(target)
    idx = icd10cm()
    known = {"committed_known": bool(idx and a in idx.by_code), "target_known": bool(idx and b in idx.by_code)}
    if not a or not b:
        rel = "unrelated"
    elif a == b:
        rel = "exact"
    elif a.startswith(b):
        rel = "more_specific"
    elif b.startswith(a):
        rel = "less_specific"
    elif a[:3] == b[:3]:
        rel = "same_category"
    elif a[:2] == b[:2]:
        rel = "same_block"
    else:
        rel = "unrelated"
    return {"committed": dotted_icd10(a), "target": dotted_icd10(b), "relation": rel,
            "credit": rel in ("exact", "more_specific"), **known}

"""AcuDx Gateway — decomposed rubric grading (transcript -> banded DomainScore).

Realises the **GRADE** tier of ``docs/architecture/02`` for the assessment layer.
Grading is deliberately *decomposed* and *evidence-forced*:

* A small, fixed **6-domain rubric** (below) breaks an encounter into concrete,
  independently-checkable criteria. The model never scores "the encounter" — it
  only ever answers one narrow yes/no criterion at a time.
* For **each item** the Model Gateway ``grade`` tier is asked, at
  ``temperature=0``, for ``{met, evidence_span, confidence}``. ``evidence_span``
  is a **forced verbatim quote**: the model must copy an exact substring of the
  transcript, and code then *verifies* that quote is really present — a fabricated
  quote fails the check and the item cannot count as met (the LLM proposes, the
  code disposes).
* Aggregation to a **band** is 100% deterministic and code-side. We return
  **bands only — never raw scores or decimals** (item -> met + confidence band;
  domain -> band; encounter -> band).

Every model call is routed through the caller-supplied gateway's ``chat()`` (the
one chokepoint that enforces the ``AIRGAPPED`` no-egress invariant), so this
module opens no sockets of its own and self-tests fully offline.

Education only. No real patient-data path.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol


# --------------------------------------------------------------------------- #
# The fixed 6-domain rubric                                                    #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class RubricItem:
    """One independently-checkable criterion within a domain."""

    id: str
    criterion: str          # phrased for the grader (English; the model reasons in EN)


@dataclass(frozen=True)
class RubricDomain:
    """A named competency domain and its criteria."""

    id: str
    title_en: str
    title_tr: str
    items: tuple[RubricItem, ...]


def _dom(id_: str, en: str, tr: str, items: list[tuple[str, str]]) -> RubricDomain:
    return RubricDomain(id_, en, tr, tuple(RubricItem(i, c) for i, c in items))


# Six domains, four criteria each (24 items). Criteria are case-agnostic so the
# same rubric grades any generated encounter; they judge the CLINICIAN (learner).
RUBRIC: tuple[RubricDomain, ...] = (
    _dom("history_taking", "History taking", "Öykü alma", [
        ("hx_presenting", "Elicits the presenting complaint and establishes its onset and timeline."),
        ("hx_characterise", "Characterises the main symptom (e.g. site, severity, quality, aggravating or relieving factors)."),
        ("hx_redflags", "Screens for relevant red-flag or associated symptoms."),
        ("hx_context", "Gathers relevant past history, medications, allergies, or risk factors."),
    ]),
    _dom("examination", "Examination and investigations", "Muayene ve tetkik", [
        ("ex_targeted", "Proposes a focused physical examination relevant to the complaint."),
        ("ex_vitals", "Seeks objective data or vital signs from staff or charts rather than asking the patient to self-report numbers."),
        ("ex_investigations", "Requests appropriate and justified investigations or tests."),
        ("ex_no_overtest", "Avoids clearly unnecessary or scattergun testing."),
    ]),
    _dom("clinical_reasoning", "Clinical reasoning", "Klinik muhakeme", [
        ("cr_differential", "Articulates a plausible differential diagnosis."),
        ("cr_prioritise", "Prioritises the most dangerous or most likely diagnosis."),
        ("cr_evidence", "Links gathered findings to the reasoning (uses data to support or refute)."),
        ("cr_updates", "Updates the working diagnosis as new information appears."),
    ]),
    _dom("management", "Management and safety", "Yönetim ve güvenlik", [
        ("mg_initial", "States an appropriate initial management or stabilisation step."),
        ("mg_safety", "Addresses immediate safety or escalation where indicated."),
        ("mg_followup", "Specifies follow-up, safety-netting, or disposition."),
        ("mg_guideline", "Management is consistent with standard first-line practice."),
    ]),
    _dom("communication", "Communication and empathy", "İletişim ve empati", [
        ("co_empathy", "Acknowledges the patient's concern or emotion with empathy."),
        ("co_plain", "Explains in plain language, avoiding unexplained jargon."),
        ("co_checks", "Checks the patient's understanding or invites questions."),
        ("co_shared", "Involves the patient in decisions (shared decision-making)."),
    ]),
    _dom("professionalism", "Professionalism and ethics", "Profesyonellik ve etik", [
        ("pr_respect", "Maintains a respectful, non-judgemental manner throughout."),
        ("pr_consent", "Seeks consent or explains before examining or intervening."),
        ("pr_boundaries", "Stays within role and does not assert false certainty."),
        ("pr_safety_culture", "Responds appropriately to any safety or safeguarding cue."),
    ]),
)

DOMAIN_BY_ID: dict[str, RubricDomain] = {d.id: d for d in RUBRIC}
ITEM_BY_ID: dict[str, RubricItem] = {it.id: it for d in RUBRIC for it in d.items}
TOTAL_ITEMS: int = sum(len(d.items) for d in RUBRIC)

# Bands (best -> worst). ``ungraded`` is the sentinel when the model could not be
# reached for any item in scope (infra degraded, not the learner's fault).
BANDS: tuple[str, ...] = ("strong", "adequate", "developing", "insufficient")
UNGRADED = "ungraded"
CONFIDENCE_BANDS: tuple[str, ...] = ("high", "medium", "low")

# Deterministic thresholds. An item only *counts* as met when the model says met,
# the quote is verified verbatim, AND confidence clears CONF_MIN.
CONF_MIN = 0.5
_QUOTE_MIN_CHARS = 4      # a verified quote must be at least this long (avoid "a")


class ChatGateway(Protocol):
    """Structural type: anything with the ModelGateway ``chat()`` coroutine."""

    async def chat(self, messages: list[dict[str, str]], *, task: str = ...,
                   max_tokens: int | None = ..., temperature: float | None = ...,
                   stop: list[str] | None = ...) -> Any: ...


# --------------------------------------------------------------------------- #
# Pure helpers (deterministic; directly unit-tested by _selftest)             #
# --------------------------------------------------------------------------- #
def band_for_fraction(fraction: float) -> str:
    """Map a met-fraction in [0, 1] to a competency band (deterministic)."""
    if fraction >= 0.80:
        return "strong"
    if fraction >= 0.60:
        return "adequate"
    if fraction >= 0.35:
        return "developing"
    return "insufficient"


def confidence_band(confidence: float) -> str:
    """Map a raw confidence in [0, 1] to a coarse band (no decimals leak out)."""
    if confidence >= 0.75:
        return "high"
    if confidence >= 0.50:
        return "medium"
    return "low"


def _norm(text: str) -> str:
    """Lowercase + collapse whitespace, for forgiving verbatim-quote matching."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def verify_quote(span: str, transcript: str) -> bool:
    """True iff ``span`` is a real (whitespace-normalised) substring of transcript.

    The **forced-quote** backstop: the grader must copy evidence out of the
    transcript, so a hallucinated justification (a quote not actually present)
    can never let an item count as met.
    """
    span_n = _norm(span)
    if len(span_n) < _QUOTE_MIN_CHARS:
        return False
    return span_n in _norm(transcript)


def normalize_transcript(transcript: Any) -> str:
    """Coerce a transcript (str, or list of turns) into flat, labelled text.

    Accepts a plain string, or a list of turns shaped like
    ``{"role"|"speaker": ..., "content"|"text": ...}`` (the web app's and the
    orchestrator's wire shapes). Speaker labels help the grader attribute
    behaviour to the CLINICIAN vs the PATIENT.
    """
    if isinstance(transcript, str):
        return transcript.strip()
    if isinstance(transcript, dict):
        transcript = transcript.get("turns") or transcript.get("history") or []
    lines: list[str] = []
    for turn in transcript or []:
        if isinstance(turn, str):
            lines.append(turn)
            continue
        if not isinstance(turn, dict):
            continue
        speaker = str(turn.get("role") or turn.get("speaker") or "").strip().lower()
        if speaker in ("assistant", "patient"):
            label = "PATIENT"
        elif speaker in ("user", "clinician", "learner", "doctor"):
            label = "CLINICIAN"
        else:
            label = speaker.upper() or "TURN"
        content = turn.get("content") or turn.get("text") or ""
        if content:
            lines.append(f"{label}: {content}")
    return "\n".join(lines).strip()


# --------------------------------------------------------------------------- #
# Per-item verdict + grader prompt                                            #
# --------------------------------------------------------------------------- #
@dataclass
class ItemVerdict:
    """The graded outcome of a single rubric item (internal; carries a float)."""

    item_id: str
    criterion: str
    met: bool = False           # COUNTED met (raw_met AND verified AND conf>=CONF_MIN)
    raw_met: bool = False       # what the model claimed
    evidence_span: str = ""     # verified verbatim quote (empty if unverified)
    confidence: float = 0.0
    verified: bool = False      # quote actually found in the transcript
    ok: bool = False            # the model responded and parsed (not degraded)
    note: str | None = None     # degraded reason / fabricated-quote flag

    def to_public(self) -> dict[str, Any]:
        """Response shape — bands only, no raw decimals."""
        out: dict[str, Any] = {
            "id": self.item_id,
            "criterion": self.criterion,
            "met": self.met,
            "confidence": confidence_band(self.confidence) if self.ok else None,
            "evidence": self.evidence_span,
        }
        if self.note:
            out["note"] = self.note
        return out


_GRADER_SYSTEM = (
    "You are a strict clinical-education examiner. You grade EXACTLY ONE rubric "
    "criterion at a time against a transcript of a simulated doctor-patient "
    "encounter. Grade only the CLINICIAN's (learner's) behaviour, never the "
    "patient's.\n\n"
    "Rules:\n"
    "1. `met` is true only if the transcript shows clear evidence the CLINICIAN "
    "satisfied THIS criterion. Otherwise false. Do not credit intentions that "
    "were not carried out.\n"
    "2. `evidence_span` MUST be a short, VERBATIM quote copied character-for-"
    "character from the transcript that justifies your decision. If `met` is "
    "false, use an empty string.\n"
    "3. `confidence` is a number from 0.0 to 1.0.\n"
    "4. Output ONLY one JSON object, no prose and no code fences:\n"
    '   {"met": true|false, "evidence_span": "<verbatim quote or empty>", '
    '"confidence": <0.0-1.0>}'
)


def build_item_prompt(item: RubricItem, domain: RubricDomain, transcript: str) -> list[dict[str, str]]:
    """Assemble the ``grade`` tier messages for one rubric item."""
    user = f"CRITERION (domain: {domain.title_en}): {item.criterion}\n\nTRANSCRIPT:\n{transcript}"
    return [
        {"role": "system", "content": _GRADER_SYSTEM},
        {"role": "user", "content": user},
    ]


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Pull the first balanced ``{...}`` object out of a model reply, tolerantly."""
    if not text:
        return None
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start : i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break  # malformed; try the next '{'
        start = text.find("{", start + 1)
    return None


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1", "met", "y")
    return False


def _coerce_conf(value: Any) -> float:
    try:
        c = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, c))


def parse_item_verdict(item: RubricItem, transcript: str, reply_text: str) -> ItemVerdict:
    """Parse one model reply into a verified :class:`ItemVerdict` (deterministic).

    The forced-quote rule is enforced here: an item can only *count* as met when
    the model said met, its quote is verified verbatim in the transcript, and its
    confidence clears ``CONF_MIN``.
    """
    verdict = ItemVerdict(item_id=item.id, criterion=item.criterion)
    obj = _extract_json_object(reply_text)
    if obj is None:
        verdict.note = "unparseable_reply"
        return verdict

    verdict.ok = True
    verdict.raw_met = _coerce_bool(obj.get("met"))
    verdict.confidence = _coerce_conf(obj.get("confidence"))
    raw_span = obj.get("evidence_span") or obj.get("evidence") or ""
    raw_span = (raw_span if isinstance(raw_span, str) else str(raw_span)).strip().strip('"').strip()

    verdict.verified = bool(raw_span) and verify_quote(raw_span, transcript)
    if verdict.verified:
        verdict.evidence_span = raw_span
    if verdict.raw_met and not verdict.verified:
        verdict.note = "evidence_not_found"   # claimed met, quote not in transcript
    verdict.met = verdict.raw_met and verdict.verified and verdict.confidence >= CONF_MIN
    return verdict


# --------------------------------------------------------------------------- #
# Orchestration + deterministic aggregation                                    #
# --------------------------------------------------------------------------- #
async def _grade_item(gateway: ChatGateway, item: RubricItem, domain: RubricDomain,
                      transcript: str, sem: asyncio.Semaphore,
                      captured: dict[str, Any]) -> ItemVerdict:
    """Grade one item via the gateway ``grade`` tier (temp 0). Never raises."""
    messages = build_item_prompt(item, domain, transcript)
    async with sem:
        try:
            result = await gateway.chat(messages, task="grade", temperature=0.0, max_tokens=192)
        except Exception as exc:  # noqa: BLE001 — degrade this item, keep grading
            v = ItemVerdict(item_id=item.id, criterion=item.criterion)
            v.note = f"degraded:{type(exc).__name__}"
            return v
    if "model" not in captured and getattr(result, "model", None):
        captured["model"] = result.model
    return parse_item_verdict(item, transcript, getattr(result, "text", "") or "")


def _aggregate_domain(domain: RubricDomain, verdicts: list[ItemVerdict]) -> dict[str, Any]:
    """Deterministic code-side aggregation of a domain's items to a band."""
    total = len(domain.items)
    graded = sum(1 for v in verdicts if v.ok)
    met = sum(1 for v in verdicts if v.met)
    band = UNGRADED if graded == 0 else band_for_fraction(met / total)
    return {
        "domain": domain.id,
        "title": {"en": domain.title_en, "tr": domain.title_tr},
        "band": band,
        "met_count": met,          # integer counts only — not a score/decimal
        "item_count": total,
        "graded_count": graded,
        "items": [v.to_public() for v in verdicts],
    }


def _empty_result(locale: str) -> dict[str, Any]:
    domains = [_aggregate_domain(d, [ItemVerdict(it.id, it.criterion) for it in d.items])
               for d in RUBRIC]
    return {
        "overall_band": UNGRADED,
        "domains": domains,
        "meta": {"locale": locale, "item_count": TOTAL_ITEMS, "graded_count": 0,
                 "degraded_count": 0, "temperature": 0.0, "tier": "grade",
                 "model": None, "empty_transcript": True},
    }


async def grade_transcript(transcript: Any, gateway: ChatGateway, *,
                           locale: str = "en", concurrency: int | None = None) -> dict[str, Any]:
    """Grade a full transcript against the fixed rubric -> banded result dict.

    * ``transcript`` may be a string or a list of turns (see
      :func:`normalize_transcript`).
    * Every item is graded independently through ``gateway.chat(task="grade")`` at
      ``temperature=0`` (the gateway applies the AIRGAPPED egress guard).
    * The returned structure carries **bands only** — no raw scores or decimals.
    """
    text = normalize_transcript(transcript)
    if not text:
        return _empty_result(locale)   # nothing to grade — no model call

    if concurrency is None:
        try:
            concurrency = max(1, int(os.environ.get("GRADE_CONCURRENCY", "4")))
        except ValueError:
            concurrency = 4
    sem = asyncio.Semaphore(concurrency)
    captured: dict[str, Any] = {}

    pairs = [(d, it) for d in RUBRIC for it in d.items]   # grade all items concurrently
    verdicts = await asyncio.gather(
        *(_grade_item(gateway, it, d, text, sem, captured) for (d, it) in pairs)
    )
    by_domain: dict[str, list[ItemVerdict]] = {d.id: [] for d in RUBRIC}
    for (d, _it), v in zip(pairs, verdicts):
        by_domain[d.id].append(v)
    domains = [_aggregate_domain(d, by_domain[d.id]) for d in RUBRIC]

    graded_all = sum(1 for v in verdicts if v.ok)
    met_all = sum(1 for v in verdicts if v.met)
    overall = UNGRADED if graded_all == 0 else band_for_fraction(met_all / TOTAL_ITEMS)
    return {
        "overall_band": overall,
        "domains": domains,
        "meta": {"locale": locale, "item_count": TOTAL_ITEMS, "graded_count": graded_all,
                 "degraded_count": sum(1 for v in verdicts if not v.ok),
                 "temperature": 0.0, "tier": "grade", "model": captured.get("model"),
                 "empty_transcript": False},
    }


# --------------------------------------------------------------------------- #
# Self-test — `python -m server.rubric` (fully offline; a fake gateway)        #
# --------------------------------------------------------------------------- #
@dataclass
class _FakeResult:
    text: str
    model: str = "fake-grader"


@dataclass
class _FakeGateway:
    """Canned grader: replies per item id from a script; records the tasks seen."""

    script: dict[str, dict[str, Any]] = field(default_factory=dict)
    tasks_seen: list[str] = field(default_factory=list)
    fail: bool = False

    async def chat(self, messages, *, task="patient", max_tokens=None, temperature=None, stop=None):
        self.tasks_seen.append(task)
        assert temperature == 0.0, "grader must call the model at temperature 0"
        if self.fail:
            raise RuntimeError("simulated gateway outage")
        user = messages[-1]["content"]     # recover the item by its criterion text
        for item_id, payload in self.script.items():
            if ITEM_BY_ID[item_id].criterion[:40] in user:
                return _FakeResult(json.dumps(payload))
        return _FakeResult(json.dumps({"met": False, "evidence_span": "", "confidence": 0.9}))


def _selftest() -> None:
    failures = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failures
        failures += 0 if cond else 1
        print(f"[{'ok ' if cond else 'FAIL'}] {name}")

    # pure helpers
    check("band 1.0 -> strong", band_for_fraction(1.0) == "strong")
    check("band 0.80 -> strong", band_for_fraction(0.80) == "strong")
    check("band 0.60 -> adequate", band_for_fraction(0.60) == "adequate")
    check("band 0.50 -> developing", band_for_fraction(0.50) == "developing")
    check("band 0.10 -> insufficient", band_for_fraction(0.10) == "insufficient")
    check("conf 0.9/0.5/0.2 -> high/medium/low",
          (confidence_band(0.9), confidence_band(0.5), confidence_band(0.2)) == ("high", "medium", "low"))
    check("rubric = 6 domains / 24 items", len(RUBRIC) == 6 and TOTAL_ITEMS == 24)

    transcript = (
        "CLINICIAN: When did the chest pain start and where exactly is it?\n"
        "PATIENT: It started this morning, right in the centre.\n"
        "CLINICIAN: I'm sorry you're going through this. Let me check your vitals with the nurse."
    )
    # forced-quote verification
    check("verify real quote", verify_quote("When did the chest pain start", transcript))
    check("reject fabricated quote", not verify_quote("your troponin is 5.2", transcript))
    check("reject too-short quote", not verify_quote("it", transcript))

    v = parse_item_verdict(ITEM_BY_ID["hx_presenting"], transcript,
                           '{"met": true, "evidence_span": "When did the chest pain start", "confidence": 0.9}')
    check("parse: verified met counts", v.met and v.verified and v.ok)
    v2 = parse_item_verdict(ITEM_BY_ID["ex_vitals"], transcript,
                            '{"met": true, "evidence_span": "troponin came back at 5.2", "confidence": 0.95}')
    check("parse: fabricated quote rejected", (not v2.met) and v2.note == "evidence_not_found")
    v3 = parse_item_verdict(ITEM_BY_ID["co_empathy"], transcript,
                            '{"met": true, "evidence_span": "I\'m sorry you\'re going through this", "confidence": 0.3}')
    check("parse: low-confidence met excluded", (not v3.met) and v3.ok)
    v4 = parse_item_verdict(ITEM_BY_ID["hx_presenting"], transcript,
                            'Sure!\n```json\n{"met": false, "evidence_span": "", "confidence": 0.8}\n```')
    check("parse: fenced json ok", v4.ok and not v4.met)

    norm = normalize_transcript([{"role": "user", "content": "Any chest pain?"},
                                 {"role": "assistant", "content": "Yes, since morning."}])
    check("normalize labels clinician+patient",
          "CLINICIAN: Any chest pain?" in norm and "PATIENT: Yes, since morning." in norm)

    # end-to-end with a fake gateway: all history items met, everything else unmet
    hx_quote = "When did the chest pain start"
    script = {it.id: ({"met": True, "evidence_span": hx_quote, "confidence": 0.9}
                      if it.id.startswith("hx_") else
                      {"met": False, "evidence_span": "", "confidence": 0.9})
              for d in RUBRIC for it in d.items}
    gw = _FakeGateway(script=script)
    out = asyncio.run(grade_transcript(transcript, gw, locale="en"))
    check("e2e: only grade tier used", set(gw.tasks_seen) == {"grade"})
    check("e2e: 24 grade calls", len(gw.tasks_seen) == 24)
    hx = next(d for d in out["domains"] if d["domain"] == "history_taking")
    check("e2e: history all met -> strong", hx["band"] == "strong" and hx["met_count"] == 4)
    exam = next(d for d in out["domains"] if d["domain"] == "examination")
    check("e2e: examination none met -> insufficient", exam["band"] == "insufficient")
    check("e2e: 4/24 -> overall insufficient", out["overall_band"] == "insufficient")
    check("e2e: bands only (no stray band values)",
          all(d["band"] in (*BANDS, UNGRADED) for d in out["domains"]))
    check("e2e: model captured", out["meta"]["model"] == "fake-grader")

    # degraded gateway -> everything ungraded, still returns
    out2 = asyncio.run(grade_transcript(transcript, _FakeGateway(fail=True)))
    check("degraded: overall ungraded", out2["overall_band"] == UNGRADED)
    check("degraded: all domains ungraded", all(d["band"] == UNGRADED for d in out2["domains"]))
    check("degraded: degraded_count == 24", out2["meta"]["degraded_count"] == 24)

    # empty transcript -> ungraded, no model call
    out3 = asyncio.run(grade_transcript("   ", _FakeGateway()))
    check("empty: ungraded + flagged", out3["overall_band"] == UNGRADED and out3["meta"]["empty_transcript"])

    print()
    if failures:
        raise SystemExit(f"{failures} rubric self-test(s) FAILED")
    print(f"All rubric self-tests passed ({TOTAL_ITEMS} items, {len(RUBRIC)} domains).")


if __name__ == "__main__":
    _selftest()

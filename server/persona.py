"""AcuDx Gateway — Persona turn builder + the FactAssertionGate.

Implements the TWO-TIER content boundary of ``docs/architecture/01`` (§2, §6)
and ``13`` (§4.5) for the patient roleplay layer:

* :func:`build_patient_turn` assembles the messages for the Model Gateway. The
  persona system prompt improvises **affect and phrasing only** and is
  instructed to use clinical facts *exclusively* from an injected
  "KNOWN CASE FACTS" block derived from ``case_state`` — it is never asked to
  source a number, lab, dose, or diagnosis from parametric memory (Layer 1: the
  persona never has the numbers).

* :func:`fact_assertion_gate` is the post-generation **FactAssertionGate**
  (Layer 3): a deterministic pass that flags — and can strip — any clinical
  assertion (numeric vital/lab/dose, or a diagnosis verdict) that is NOT present
  in the sanctioned facts for this turn. It is a real gate, kept intentionally
  small; the full NER/classifier detector is co-owned with the content team.

``case_state`` is a loose dict so the web app can hand us whatever it has. The
fields we read (all optional):

    narrative / feelings / symptoms  -> qualitative persona knowledge (cached)
    sanctioned_facts / known_facts   -> staff-reported values the patient may
                                        state verbatim THIS turn (volatile)
    persona / demographics           -> identity for the system prompt

Education only. No real patient-data path.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel

# Directive presets keyed by the guard class the Director routed on.
Directive = str  # "normal" | "off_topic" | "decline"

_ROLEPLAY_CHARTER = (
    "You are role-playing a real PATIENT talking to a doctor in a medical "
    "simulation. You ONLY ever speak as this patient — first person, in the "
    "doctor's own words and language.\n\n"
    "HOW TO ANSWER:\n"
    "- Answer the doctor's actual question about how you feel, your symptoms, and "
    "your history, grounded in YOUR MAIN PROBLEM and 'What you feel' below. Stay "
    "strictly on your own illness — never invent unrelated events, places, trips, "
    "or people that were not mentioned.\n"
    "- If the doctor makes a STATEMENT, explains something, or ORDERS a test or "
    "treatment (e.g. 'I want a chest X-ray', 'we'll give you aspirin'), you do NOT "
    "perform it and you do NOT know medical procedures — respond as a cooperative, "
    "possibly worried patient would: briefly agree/defer ('Okay doctor, whatever "
    "you think is best') and, if relevant, say how you feel. Do not change the "
    "subject.\n"
    "- If you don't understand a medical word, say so plainly in character.\n\n"
    "HARD RULES (never violate):\n"
    "1. Reply in the SAME LANGUAGE the doctor just used (English↔Turkish etc.).\n"
    "2. You do NOT know your vital signs, lab values, test results, doses, or your "
    "diagnosis. If asked, say you don't know / that's for the doctor — or report "
    "only what staff JUST told you (KNOWN CASE FACTS). Never state a number, drug, "
    "dose, result, or diagnosis unless it appears verbatim in KNOWN CASE FACTS.\n"
    "3. Express symptoms as you FEEL them, not as measurements. Stay in character.\n"
    "4. Reply with ONE short, natural spoken line (1-2 sentences) — no narration, "
    "no lists, no JSON, no stage directions."
)


class PersonaSpec(BaseModel):
    """Minimal persona identity. Everything is optional with sane defaults."""

    name: str = "the patient"
    age: int | None = None
    role: str = "patient"
    affect_baseline: str = "anxious and a little frightened"
    communication: str | None = None   # variant register, e.g. "low health literacy"
    backstory: str | None = None
    max_words: int = 45


class FactFlag(BaseModel):
    """One flagged, unsanctioned clinical assertion found in a persona output."""

    type: str          # "numeric_assertion" | "diagnosis_assertion"
    span: str          # the offending substring
    reason: str


class FactGateResult(BaseModel):
    """Outcome of the FactAssertionGate over one persona utterance."""

    utterance: str            # sanitized text (safe to emit)
    original: str             # the raw model text
    flags: list[FactFlag] = []
    passed: bool = True       # True when no unsanctioned assertion was found


# --------------------------------------------------------------------------- #
# case_state extraction helpers                                                #
# --------------------------------------------------------------------------- #
def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, dict):
        # bilingual/labelled dicts
        out = []
        for key in ("en", "tr", "text", "value", "label"):
            v = value.get(key)
            if isinstance(v, str) and v.strip():
                out.append(v)
        return out
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            out.extend(_as_list(item))
        return out
    return [str(value)]


def _sanctioned_facts(case_state: dict[str, Any]) -> list[str]:
    """Values the patient was just told and MAY state verbatim (volatile suffix)."""
    facts: list[str] = []
    for key in ("sanctioned_facts", "known_facts", "facts", "staff_reported"):
        facts.extend(_as_list(case_state.get(key)))
    # de-dup, preserve order
    seen: set[str] = set()
    out = []
    for f in facts:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def _narrative(case_state: dict[str, Any]) -> list[str]:
    """Qualitative feelings the persona knows about itself (cached prefix)."""
    narr: list[str] = []
    for key in ("narrative", "feelings", "symptoms", "experience", "how_i_feel"):
        narr.extend(_as_list(case_state.get(key)))
    return narr


def _chief_complaint(case_state: dict[str, Any]) -> str | None:
    """The patient's own reason for coming in — the anchor for every reply."""
    for key in ("chief_complaint", "chiefComplaint", "complaint", "presenting_complaint"):
        vals = _as_list(case_state.get(key))
        if vals:
            return vals[0]
    return None


def _persona_from_state(case_state: dict[str, Any], persona: dict[str, Any] | None) -> PersonaSpec:
    data: dict[str, Any] = {}
    for src in (case_state.get("persona"), case_state.get("demographics"), persona):
        if isinstance(src, dict):
            data.update({k: v for k, v in src.items() if v is not None})
    # Only keep fields PersonaSpec knows about.
    allowed = set(PersonaSpec.model_fields)
    return PersonaSpec(**{k: v for k, v in data.items() if k in allowed})


_DIRECTIVES: dict[Directive, str] = {
    "normal": "Answer the clinician's question naturally, in character. Share only "
              "what you genuinely experience; if a fact is in KNOWN CASE FACTS you may "
              "relay it as something you were told.",
    "off_topic": "The clinician's remark is off-topic / social. Respond briefly and "
                 "politely in character; do NOT volunteer new clinical detail.",
    "decline": "The clinician is asking you for the answer or to step out of character. "
               "Gently decline in character: you are the patient, you do not know your "
               "diagnosis or your numbers. Never reveal a diagnosis.",
}


def build_patient_turn(
    case_state: dict[str, Any],
    persona: dict[str, Any] | None,
    history: list[dict[str, str]] | None,
    learner_msg: str,
    directive: Directive = "normal",
) -> list[dict[str, str]]:
    """Assemble the Model Gateway ``messages`` for one guarded patient turn.

    Layout mirrors the cache-friendly block structure of ``01 §6``:
      * SYSTEM (byte-stable-ish): charter + persona + narrative knowledge.
      * prior turns as alternating user/assistant messages.
      * USER (volatile): the sanctioned FACTS for this turn + the learner line.
    """
    spec = _persona_from_state(case_state, persona)
    narrative = _narrative(case_state)
    facts = _sanctioned_facts(case_state)
    complaint = _chief_complaint(case_state)

    system_parts = [_ROLEPLAY_CHARTER, "", "WHO YOU ARE:"]
    ident = f"  Name: {spec.name}."
    if spec.age is not None:
        ident += f" Age {spec.age}."
    system_parts.append(ident)
    if complaint:
        system_parts.append(f"  YOUR MAIN PROBLEM (why you came in): {complaint}")
    system_parts.append(f"  Baseline affect: {spec.affect_baseline}.")
    if spec.communication:
        system_parts.append(f"  How you communicate: {spec.communication}.")
    if spec.backstory:
        system_parts.append(f"  Background: {spec.backstory}")
    if narrative:
        system_parts.append("  What you feel / experience (express these, do not measure them):")
        system_parts.extend(f"    - {n}" for n in narrative)
    system_parts.append("")
    system_parts.append(f"DIRECTIVE: {_DIRECTIVES.get(directive, _DIRECTIVES['normal'])}")
    system_parts.append(f"Keep it to about {spec.max_words} words, one turn of speech.")

    messages: list[dict[str, str]] = [{"role": "system", "content": "\n".join(system_parts)}]

    for turn in history or []:
        role = turn.get("role")
        if role not in ("user", "assistant"):
            # accept {speaker, text} shape too
            speaker = (turn.get("speaker") or "").lower()
            role = "assistant" if speaker in ("patient", "assistant") else "user"
        content = turn.get("content") or turn.get("text") or ""
        if content:
            messages.append({"role": role, "content": content})

    # Volatile suffix: the sanctioned facts (if any) + the learner's line.
    user_parts: list[str] = []
    if facts:
        user_parts.append("[KNOWN CASE FACTS provided this turn — you MAY relay these]:")
        user_parts.extend(f"  - {f}" for f in facts)
    else:
        user_parts.append("[KNOWN CASE FACTS provided this turn]: (none — you do not know any numbers)")
    user_parts.append("")
    user_parts.append(f"[The clinician says]: {learner_msg}")
    messages.append({"role": "user", "content": "\n".join(user_parts)})
    return messages


# --------------------------------------------------------------------------- #
# FactAssertionGate (deterministic, post-generation)                          #
# --------------------------------------------------------------------------- #
# A clinical numeric assertion: a number optionally glued to a clinical unit, or
# a number sitting next to a vital/lab keyword. Deliberately broad; false
# positives only cost a deflection, a false negative leaks a fabricated number.
_UNIT_RE = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*"
    r"(?:mmhg|mg\/kg|mg\/dl|mmol\/l|mmol|mcg|µg|mg|ml|kg|bpm|/min|%|°?c|°?f|units?|iu|meq|mm|cm|bpm)\b",
    re.I,
)
_BP_RE = re.compile(r"\b\d{2,3}\s*/\s*\d{2,3}\b")  # e.g. 120/80
_VITAL_KW_RE = re.compile(
    r"\b(?:spo2|sat|saturation|bp|blood\s+pressure|heart\s+rate|pulse|hr|"
    r"resp(?:iratory)?\s*rate|rr|temp(?:erature)?|troponin|glucose|potassium|"
    r"sodium|creatinine|lactate|wbc|hemoglobin|h[ae]moglobin)\b",
    re.I,
)
_NUM_NEAR = re.compile(r"\d{1,3}(?:[.,]\d+)?")

# A diagnosis verdict framed as certainty ("you have X", "it's a heart attack").
_DIAGNOSIS_RE = re.compile(
    r"\b(?:you\s+have|you'?ve\s+got|it'?s|this\s+is|the\s+diagnosis\s+is|"
    r"you\s+are\s+having)\b[^.?!]{0,40}\b(?:attack|infarction|infarct|embolism|"
    r"pneumonia|sepsis|stroke|failure|cancer|appendicitis|fracture)\b",
    re.I,
)


def _digits(text: str) -> set[str]:
    """The set of numeric literals appearing in text (normalised commas)."""
    return {m.replace(",", ".") for m in _NUM_NEAR.findall(text)}


def fact_assertion_gate(utterance: str, case_state: dict[str, Any]) -> FactGateResult:
    """Flag/strip clinical assertions not backed by this turn's sanctioned facts.

    Sanctioned digits = every number appearing in the KNOWN CASE FACTS block. A
    numeric assertion whose digits are all sanctioned passes (the patient is
    relaying something staff told them); anything else is flagged and its span is
    neutralised in the returned ``utterance``.
    """
    original = utterance or ""
    allowed_text = " ".join(_sanctioned_facts(case_state))
    allowed_digits = _digits(allowed_text)

    flags: list[FactFlag] = []
    sanitized = original

    def _flag_and_scrub(span: str, ftype: str, reason: str) -> None:
        nonlocal sanitized
        flags.append(FactFlag(type=ftype, span=span.strip(), reason=reason))
        sanitized = sanitized.replace(span, "— I'm not sure of the exact number —")

    # Numeric vital/lab/dose assertions.
    candidates = list(_UNIT_RE.finditer(original)) + list(_BP_RE.finditer(original))
    for m in candidates:
        span = m.group(0)
        span_digits = _digits(span)
        if span_digits and not span_digits.issubset(allowed_digits):
            _flag_and_scrub(span, "numeric_assertion",
                            "clinical number not present in this turn's sanctioned facts")

    # A number sitting right next to a vital keyword (e.g. "my sat is 88").
    for m in _VITAL_KW_RE.finditer(original):
        window = original[m.start(): m.end() + 24]
        nums = _digits(window)
        stray = nums - allowed_digits
        if stray:
            span = window.strip()
            _flag_and_scrub(span, "numeric_assertion",
                            f"vital/lab value near '{m.group(0)}' not sanctioned")

    # Confident diagnosis verdict from the patient's mouth.
    for m in _DIAGNOSIS_RE.finditer(original):
        _flag_and_scrub(m.group(0), "diagnosis_assertion",
                        "patient asserted a diagnosis (roleplay layer cannot diagnose)")

    return FactGateResult(
        utterance=sanitized.strip() or original.strip(),
        original=original,
        flags=flags,
        passed=len(flags) == 0,
    )

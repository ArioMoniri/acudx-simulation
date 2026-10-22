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
    sanctioned_facts / known_facts   -> facts the learner's actual questions (and
                                        staff) sanctioned THIS turn (volatile)
    vitals_adjectives / affect /     -> the Clinical Director's live state, voiced
    complications / live_events         as feelings (volatile, see live_state_lines)
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


# Live state -> how the patient feels (review 06a 4.5: the persona consumes the Director).
# Plain feelings only: the patient never states a number or a clinical label.
_FELT: dict[str, str] = {
    "tachycardic": "your heart is racing",
    "bradycardic": "you feel weak and slowed down",
    "hypotensive": "you feel faint and light-headed when you lift your head",
    "hypertensive": "you have a pounding head",
    "tachypnoeic": "you are breathing fast",
    "bradypnoeic": "you can barely be bothered to breathe",
    "hypoxic": "you are struggling for breath",
    "severely hypoxic": "you can only get a few words out between breaths",
    "febrile": "you feel hot and shivery",
    "high fever": "you have a high fever: you feel burning hot and shaky, never call it a low-grade fever",
    "hypothermic": "you feel very cold",
    "drowsy": "you are drowsy and slow to answer",
    "unresponsive": "you can only mumble",
    "short of breath": "you are short of breath",
    "in severe pain": "the pain is severe",
    "very anxious": "you are frightened",
}


def _scale(v: Any) -> float:
    """Director dyspnea and anxiety arrive on 0-1 (some clients send 0-10); return 0-10."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f * 10.0 if f <= 1.0 else f


def live_state_lines(case_state: dict[str, Any]) -> list[str]:
    """How the patient is RIGHT NOW, from the Clinical Director's live state.

    Reads ``vitals_adjectives`` (computed from the Director's vitals), ``affect``
    (pain, dyspnea, anxiety, consciousness, mood) and fired ``complications`` and
    turns them into felt experience, so the patient sounds worse while desaturating
    and better after treatment. No numbers, no diagnosis."""
    lines: list[str] = []
    seen: set[str] = set()
    for adj in _as_list(case_state.get("vitals_adjectives")):
        felt = _FELT.get(adj.strip().lower())
        if felt and felt not in seen:
            seen.add(felt)
            lines.append(felt)
    affect = case_state.get("affect")
    if isinstance(affect, dict):
        mood = affect.get("mood_en") or affect.get("mood")
        if isinstance(mood, str) and mood.strip():
            lines.append(f"your mood: {mood.strip()}")
        try:
            pain = float(affect.get("pain") or 0)   # Director pain is 0-10
        except (TypeError, ValueError):
            pain = 0.0
        if pain >= 7 and "the pain is severe" not in seen:
            lines.append("the pain is severe")
        elif 0 < pain <= 2:
            lines.append("the pain has eased a lot")
        if _scale(affect.get("dyspnea")) >= 6 and "you are short of breath" not in seen:
            lines.append("you are short of breath: speak in short phrases")
        consciousness = str(affect.get("consciousness") or "").lower()
        if consciousness == "drowsy" and "you are drowsy and slow to answer" not in seen:
            lines.append("you are drowsy and slow to answer")
        elif consciousness == "unresponsive":
            lines.append("you can only mumble a word or two")
    complications = _as_list(case_state.get("complications"))
    if complications:
        lines.append("you feel clearly worse than when you arrived")
    for event in _as_list(case_state.get("live_events")):
        lines.append(f"you notice: {event}")
    # How the voice should sound on a live video call, from the same server-side look as the face
    # (server/voice/avatar/appearance.py voice_style): breathless phrasing, pain, cough, drowsiness.
    for line in _as_list(case_state.get("voice")):
        if line not in lines:
            lines.append(line)
    return lines


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

    # Volatile suffix: how the patient is right now (live Director state), the sanctioned
    # facts (if any) and the learner's line. Kept out of the system block so the prefix
    # stays byte-stable for prefix caching while the state changes every turn.
    user_parts: list[str] = []
    now = live_state_lines(case_state)
    if now:
        user_parts.append("[HOW YOU ARE RIGHT NOW - let it show in how you speak, never as numbers]:")
        user_parts.extend(f"  - {line}" for line in now)
        user_parts.append("  Never describe your symptoms as milder (or worse) than this; it is your real state now.")
        user_parts.append("")
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
# A clinical numeric assertion, in English or Turkish: a number glued to a clinical unit ("39,4
# derece", "500 mg", "92%"), a percent written first ("%92", "yüzde 88"), a blood pressure ("140/90",
# "140 over 90", "140'a 90", "140 bölü 90"), or a number shortly after a vital or lab word ("ateşim
# 39,4", "nabzım dakikada 120", "my sats were 88"). Deliberately broad; a false positive only costs a
# deflection, a false negative lets the patient voice a number nobody gave them. Turkish writes the
# decimal comma ("39,4") and the thousands dot ("1.200"); both are normalised before comparing.
_NUM = r"(?<![\w.,])\d+(?:[.,]\d+)*"
_SUFFIX = r"(?:['’][^\W\d_]+)?"          # Turkish case suffix: 39,4'tü, 140'a
_UNITS = (
    r"mm\s*hg|mg\s*/\s*kg|mg\s*/\s*dl|mmol\s*/\s*l|mmol|meq|mcg|µg|mg|ml|kg|bpm|iu|"
    r"/\s*min|/\s*dk|%|°\s*[cf]?|°|degrees?|percent|per\s*cent|milligrams?|micrograms?|grams?|"
    r"millilit(?:er|re)s?|units?|beats?|breaths?|"
    r"derece\w*|miligram\w*|mikrogram\w*|gram\w*|mililitre\w*|ünite\w*|birim\w*|atım\w*|"
    r"soluk\w*|nefes\w*"
)
_UNIT_RE = re.compile(rf"{_NUM}{_SUFFIX}\s*(?:{_UNITS})(?![^\W\d_])", re.I)
_PCT_FIRST_RE = re.compile(rf"(?:%|\byüzde)\s*{_NUM}{_SUFFIX}", re.I)
_BP_RE = re.compile(
    rf"(?<![\w.,])\d{{2,3}}{_SUFFIX}\s*(?:/|\bover\b|\bbölü\b|üzerine)\s*\d{{2,3}}(?![\d])"
    rf"|(?<![\w.,])\d{{2,3}}['’](?:a|e|ya|ye)\s+\d{{1,3}}(?![\d])",
    re.I,
)
_VITAL_KW_RE = re.compile(
    r"\b(?:spo2|o2|sats?|saturation|bp|blood\s+pressure|heart\s+rate|pulse|hr|"
    r"resp(?:iratory)?\s*rate|rr|temp(?:erature)?|fever|oxygen|sugar|troponin|glucose|potassium|"
    r"sodium|creatinine|lactate|wbc|h[ae]moglobin|"
    r"ateş\w*|tansiyon\w*|kan\s+basınc\w*|nab[ıi]z\w*|nabz\w*|kalp\s+atış\w*|"
    r"şeker\w*|oksijen\w*|satür\w*|solunum\w*|potasyum\w*|sodyum\w*|kreatinin\w*|laktat\w*|"
    r"hemoglobin\w*|troponin\w*|glukoz\w*|glikoz\w*|derece\w*)",
    re.I,
)
_NUM_TOKEN_RE = re.compile(rf"{_NUM}{_SUFFIX}(?:\s*(?:{_UNITS})(?![^\W\d_]))?", re.I)
_KW_WINDOW = 32

# A diagnosis verdict framed as certainty ("you have X", "it's a heart attack", "bende zatürre var").
_DIAGNOSIS_RE = re.compile(
    r"\b(?:you\s+have|you'?ve\s+got|it'?s|this\s+is|the\s+diagnosis\s+is|"
    r"you\s+are\s+having)\b[^.?!]{0,40}\b(?:attack|infarction|infarct|embolism|"
    r"pneumonia|sepsis|stroke|failure|cancer|appendicitis|fracture)\b",
    re.I,
)
_DX_TR = (r"(?:zatürre\w*|pnömoni\w*|kalp\s+kriz\w*|enfarktüs\w*|emboli\w*|inme\w*|"
          r"felç\w*|sepsis\w*|kanser\w*|apandisit\w*|kırık\w*|yetmezli\w*)")
_DIAGNOSIS_TR_RE = re.compile(
    rf"\b(?:bende|sende|sizde|onda)\s+(?:[^\W\d_]+\s+){{0,4}}?{_DX_TR}\s+var\b"
    rf"|\b{_DX_TR}\s+geçiriyor\w*"
    rf"|\b(?:teşhis|tanı)\w*\s+(?:[^\W\d_]+\s+){{0,3}}?{_DX_TR}",
    re.I,
)
# Case-sensitive on purpose: with re.I the dotted capital I matches every English "I".
_TR_MARK_RE = re.compile(r"[çğıöşüÇĞİÖŞÜ]"
                         r"|\b(?:ve|bir|bu|ama|benim|oldu|var|idi|imi\u015f|tansiyon\w*)\b")
_SCRUB = {
    "en": {"numeric_assertion": "I'm not sure of the exact number", "diagnosis_assertion": "I don't know what it is"},
    "tr": {"numeric_assertion": "tam sayıyı bilmiyorum", "diagnosis_assertion": "ne olduğunu bilmiyorum"},
}


def _norm_number(tok: str) -> str:
    """'39,4' and '39.4' -> '39.4'; '1.200' and '1,200' (thousands) -> '1200'; '120' -> '120'."""
    t = tok.strip()
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", t):
        return re.sub(r"[.,]", "", t)
    return t.replace(",", ".")


def _digits(text: str) -> set[str]:
    """The numbers appearing in text, normalised (decimal comma, thousands separators)."""
    return {_norm_number(m) for m in re.findall(_NUM, text)}


def _gate_lang(text: str, lang: str | None) -> str:
    if lang:
        return "tr" if lang.lower().startswith("tr") else "en"
    return "tr" if _TR_MARK_RE.search(text or "") else "en"


def fact_assertion_gate(utterance: str, case_state: dict[str, Any], *, lang: str | None = None) -> FactGateResult:
    """Flag/strip clinical assertions not backed by this turn's sanctioned facts.

    Sanctioned digits = every number appearing in the KNOWN CASE FACTS block. A
    numeric assertion whose digits are all sanctioned passes (the patient is
    relaying something staff told them); anything else is flagged and its span is
    replaced in the returned ``utterance`` by a short deflection in the reply's
    language (``lang``, else detected from the text).
    """
    original = utterance or ""
    allowed_digits = _digits(" ".join(_sanctioned_facts(case_state)))
    spans: list[tuple[int, int, str, str]] = []

    def _check(start: int, end: int, reason: str) -> None:
        nums = _digits(original[start:end])
        if nums and not nums.issubset(allowed_digits):
            spans.append((start, end, "numeric_assertion", reason))

    for rx in (_UNIT_RE, _PCT_FIRST_RE, _BP_RE):
        for m in rx.finditer(original):
            _check(m.start(), m.end(), "clinical number not present in this turn's sanctioned facts")

    # A number shortly after a vital or lab word ("my sat is 88", "nabzım dakikada 120"): only the
    # number (with its suffix and unit) is replaced, the words around it stay.
    for m in _VITAL_KW_RE.finditer(original):
        window_end = min(len(original), m.end() + _KW_WINDOW)
        for n in _NUM_TOKEN_RE.finditer(original, m.end(), window_end):
            _check(n.start(), n.end(), f"vital/lab value near '{m.group(0)}' not sanctioned")

    for rx in (_DIAGNOSIS_RE, _DIAGNOSIS_TR_RE):
        for m in rx.finditer(original):
            spans.append((m.start(), m.end(), "diagnosis_assertion",
                          "patient asserted a diagnosis (roleplay layer cannot diagnose)"))

    if not spans:
        return FactGateResult(utterance=original.strip(), original=original, flags=[], passed=True)

    words = _SCRUB[_gate_lang(original, lang)]
    spans.sort(key=lambda s: (s[0], -s[1]))
    merged: list[list[Any]] = []
    for s in spans:
        if merged and s[0] < merged[-1][1]:
            last = merged[-1]
            last[1] = max(last[1], s[1])
            if s[2] == "diagnosis_assertion":
                last[2] = s[2]
            continue
        merged.append(list(s))
    flags = [FactFlag(type=t, span=original[a:b].strip(), reason=r) for a, b, t, r in merged]
    out, pos = [], 0
    for a, b, t, _r in merged:
        out.append(original[pos:a])
        out.append(f", {words[t]},")
        pos = b
    out.append(original[pos:])
    sanitized = "".join(out)
    sanitized = re.sub(r"\s+,", ",", sanitized)
    sanitized = re.sub(r",\s*([.?!;:])", r"\1", sanitized)
    sanitized = re.sub(r",(\s*,)+", ",", sanitized)
    sanitized = re.sub(r"^\s*,\s*", "", sanitized)
    sanitized = re.sub(r",\s*$", "", sanitized)
    sanitized = re.sub(r",(?=\S)", ", ", sanitized)
    sanitized = re.sub(r"[ \t]{2,}", " ", sanitized).strip()
    return FactGateResult(utterance=sanitized or original.strip(), original=original, flags=flags, passed=False)

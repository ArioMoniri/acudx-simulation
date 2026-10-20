"""Clinical Director: adapts the live case to what the learner does, turn by turn.

A LangGraph subgraph runs once per learner action::

    perceive -> physiology -> complications -> narrate -> emit

* ``perceive``       records the action, advances the clock, resolves which
                     sanctioned facts the action unlocks, applies treatment
                     effects from the case's own treatment table (with the
                     generic class table as fallback).
* ``physiology``     recomputes the vitals deterministically from the baseline
                     trajectory plus every active effect ramp, then clamps to
                     hard bounds (HR 20-250, SpO2 0-100, ...).
* ``complications``  fires planned complications whose deadline has passed
                     (for example deterioration when a time-critical treatment
                     was never given) and logs why.
* ``narrate``        decides patient affect and a short in-character line. It is
                     deterministic by default; when a model is supplied it may
                     make ONE bounded call for wording and affect only. The
                     model never changes a vital, a fact or a complication.
* ``emit``           produces ``patient_visible_changes`` and ``director_notes``.

Public API::

    state = CaseState.from_spec(spec)
    state, visible, notes = next_state(state, action)            # deterministic
    state, visible, notes = await anext_state(state, action, llm) # + narrator model
"""

from __future__ import annotations

import operator
import time
from typing import Annotated, Any, Literal, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from server.orchestration.judges import EFFECT_CAPS, VITAL_BOUNDS
from server.orchestration.llm import ModelOutputInvalid, ModelUnreachable, StructuredLLM
from server.orchestration.trace import make_event

VITAL_KEYS: tuple[str, ...] = ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")
ActionKind = Literal["question", "exam", "order", "treatment", "elapsed"]

# Default sim-time cost of an action when the client does not say.
DEFAULT_ELAPSED_MS: dict[str, int] = {
    "question": 30_000, "exam": 60_000, "order": 45_000, "treatment": 60_000, "elapsed": 0,
}

# Time-critical treatment deadline by ESI (None: no planned deterioration).
DEADLINE_BY_ESI_MS: dict[int, Optional[int]] = {1: 10 * 60_000, 2: 20 * 60_000, 3: 40 * 60_000, 4: None, 5: None}

# Deterioration applied when the deadline is missed, scaled by acuity.
DETERIORATION_BY_ESI: dict[int, list[dict[str, Any]]] = {
    1: [{"key": "hr", "delta": 22, "onsetMs": 180_000}, {"key": "spo2", "delta": -6, "onsetMs": 180_000},
        {"key": "systolic", "delta": -18, "onsetMs": 180_000}, {"key": "rr", "delta": 6, "onsetMs": 180_000}],
    2: [{"key": "hr", "delta": 15, "onsetMs": 240_000}, {"key": "spo2", "delta": -4, "onsetMs": 240_000},
        {"key": "systolic", "delta": -12, "onsetMs": 240_000}, {"key": "rr", "delta": 4, "onsetMs": 240_000}],
    3: [{"key": "hr", "delta": 10, "onsetMs": 300_000}, {"key": "spo2", "delta": -2, "onsetMs": 300_000},
        {"key": "rr", "delta": 3, "onsetMs": 300_000}],
}

# Adverse response to a contraindicated treatment (bounded, immediate onset).
CONTRAINDICATED_ADVERSE: list[dict[str, Any]] = [
    {"key": "hr", "delta": 12, "onsetMs": 120_000}, {"key": "systolic", "delta": -10, "onsetMs": 120_000},
]

# Generic physiology by treatment class, mirroring web/src/domain/treatments.ts
# genericEffect (the client fallback) so both sides agree when a case carries
# no bespoke effect for an agent. Each entry: (keywords, gate, effects).
GENERIC_EFFECTS: tuple[tuple[tuple[str, ...], str, list[dict[str, Any]]], ...] = (
    (("oxygen", "o2"), "spo2<94", [{"key": "spo2", "delta": 5, "onsetMs": 120_000}]),
    (("saline", "ringer", "fluid", "bolus", "crystalloid"), "systolic<100",
     [{"key": "systolic", "delta": 12, "onsetMs": 180_000}, {"key": "diastolic", "delta": 6, "onsetMs": 180_000}]),
    (("paracetam", "acetamin", "antipyr"), "tempC>38", [{"key": "tempC", "delta": -0.8, "onsetMs": 300_000}]),
    (("nitro",), "", [{"key": "systolic", "delta": -8, "onsetMs": 90_000}]),
    (("salbut", "albuter", "bronch", "nebul"), "rr>20",
     [{"key": "rr", "delta": -4, "onsetMs": 120_000}, {"key": "spo2", "delta": 3, "onsetMs": 120_000}]),
    (("morphin", "fentan", "opioid", "analges"), "",
     [{"key": "hr", "delta": -6, "onsetMs": 120_000}, {"key": "rr", "delta": -2, "onsetMs": 120_000}]),
    (("naloxon",), "", [{"key": "rr", "delta": 4, "onsetMs": 60_000}, {"key": "spo2", "delta": 4, "onsetMs": 60_000}]),
    (("beta", "metoprol", "esmolol", "diltiaz"), "hr>90",
     [{"key": "hr", "delta": -15, "onsetMs": 300_000}, {"key": "systolic", "delta": -10, "onsetMs": 300_000}]),
    # Acceptance 2026-10-20: antibiotics do not defervesce a patient inside a
    # session (median time to clinical stability in CAP is about 3 days, Halm et
    # al. JAMA 1998, https://jamanetwork.com/journals/jama/fullarticle/187516);
    # the old -0.6 C at 30 min contradicted review 02 finding 14.
    (("antibiot", "ceftriax", "pipera", "merope", "vancomy", "amoxic", "levoflox", "clarithro", "doxycyc",
      "gentamic", "clindamy", "metronid", "chloramph", "artesun", "oseltam", "antivir", "antimalar"), "", []),
)


# --------------------------------------------------------------------------- #
# State                                                                        #
# --------------------------------------------------------------------------- #
class Vitals(BaseModel):
    hr: float = 80
    systolic: float = 120
    diastolic: float = 76
    rr: float = 16
    spo2: float = 97
    tempC: float = 37.0


class Effect(BaseModel):
    key: str
    delta: float
    onsetMs: int = 0


class ActiveEffect(BaseModel):
    source: str                  # treatment code or complication id
    key: str
    delta: float
    onsetMs: int
    startMs: int


class Complication(BaseModel):
    id: str
    reason: str
    deadline_ms: int
    required_any_of: list[str] = Field(default_factory=list)
    effects: list[Effect] = Field(default_factory=list)
    fired_at_ms: Optional[int] = None
    cancelled: bool = False
    cancel_reason: Optional[str] = None


class Affect(BaseModel):
    pain: float = 5.0            # 0-10
    anxiety: float = 0.4         # 0-1
    dyspnea: float = 0.2         # 0-1
    consciousness: Literal["alert", "drowsy", "unresponsive"] = "alert"
    mood_en: str = "worried but cooperative"
    mood_tr: str = "endişeli ama iş birliği yapıyor"


class TreatmentRow(BaseModel):
    code: str
    label_en: str = ""
    label_tr: str = ""
    appropriateness: str = "neutral"
    effects: list[Effect] = Field(default_factory=list)
    narrative_en: str = ""
    narrative_tr: str = ""


class CaseState(BaseModel):
    """The Director's authoritative view of one live encounter."""

    case_id: str = ""
    condition_id: str = ""
    condition_label_en: str = ""
    condition_label_tr: str = ""
    system: str = ""
    acuity_esi: int = 3
    t_ms: int = 0
    vitals: Vitals = Field(default_factory=Vitals)
    baseline: list[dict[str, Any]] = Field(default_factory=list)      # vitals trajectory points
    treatments: list[TreatmentRow] = Field(default_factory=list)
    administered: list[dict[str, Any]] = Field(default_factory=list)
    active_effects: list[ActiveEffect] = Field(default_factory=list)
    pending_complications: list[Complication] = Field(default_factory=list)
    affect: Affect = Field(default_factory=Affect)
    sanctioned_facts: list[str] = Field(default_factory=list)
    facts_by_trigger: dict[str, list[str]] = Field(default_factory=dict)  # "question:onset" -> facts
    revealed: dict[str, list[str]] = Field(default_factory=lambda: {"question": [], "exam": [], "order": [], "treatment": []})
    errors: list[dict[str, Any]] = Field(default_factory=list)
    log: list[dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def from_spec(cls, spec: dict[str, Any], *, case_id: str = "") -> "CaseState":
        cond = spec.get("condition") or {}
        tv = spec.get("triage_vitals") or {}
        baseline = list(spec.get("vitals_trajectory") or [])
        if not baseline and tv:
            baseline = [{"atMs": 0, **tv}]
        treatments = [TreatmentRow.model_validate({
            "code": str(t.get("code") or t.get("label_en") or f"t{i}"),
            "label_en": t.get("label_en", ""), "label_tr": t.get("label_tr", ""),
            "appropriateness": t.get("appropriateness", "neutral"),
            "effects": [e for e in (t.get("effects") or []) if e.get("key")],
            "narrative_en": t.get("narrative_en", ""), "narrative_tr": t.get("narrative_tr", ""),
        }) for i, t in enumerate(spec.get("treatments") or [])]
        facts: dict[str, list[str]] = {}
        for h in spec.get("hpi") or []:
            facts.setdefault(f"question:{h.get('intent')}", []).append(str(h.get("answer_en") or ""))
        for e in spec.get("exam") or []:
            facts.setdefault(f"exam:{e.get('maneuver')}", []).append(str(e.get("finding_en") or ""))
        for lab in spec.get("labs") or []:
            code = str(lab.get("code") or lab.get("label_en") or "")
            facts.setdefault(f"order:{code}", []).append(
                f"{lab.get('label_en')}: {lab.get('value')} {lab.get('unit', '')}".strip())
        for im in spec.get("imaging") or []:
            code = str(im.get("code") or im.get("modality_en") or "")
            facts.setdefault(f"order:{code}", []).append(f"{im.get('modality_en')}: {im.get('findings_en')}")
        esi = int(spec.get("acuity_esi") or 3)
        state = cls(
            case_id=case_id or str(spec.get("seed") or ""),
            condition_id=str((spec.get("meta") or {}).get("condition_id") or cond.get("label_en") or ""),
            condition_label_en=str(cond.get("label_en") or ""), condition_label_tr=str(cond.get("label_tr") or ""),
            system=str(cond.get("system") or ""),
            acuity_esi=esi, treatments=treatments, baseline=baseline, facts_by_trigger=facts,
            vitals=Vitals.model_validate({k: tv.get(k, getattr(Vitals(), k)) for k in VITAL_KEYS}) if tv else Vitals(),
        )
        state.affect = _affect_from_vitals(state.vitals, state.affect, esi)
        deadline = DEADLINE_BY_ESI_MS.get(esi)
        indicated = [t.code for t in treatments if t.appropriateness == "indicated"]
        # D-18: paracetamol, cultures and assessment rows do not avert the
        # deadline; only a definitive treatment does (antibiotics, fluids,
        # source control, the condition's specific therapy).
        definitive = [t.code for t in treatments if t.appropriateness == "indicated"
                      and not any(s in f"{t.code} {t.label_en}".lower() for s in SUPPORTIVE_ROW_STEMS)]
        indicated = definitive or indicated
        if deadline is not None and indicated:
            state.pending_complications.append(Complication(
                id="missed_time_critical_treatment",
                reason=(f"ESI {esi} case: no indicated treatment ({', '.join(indicated)}) "
                        f"given within {deadline // 60_000} min"),
                deadline_ms=deadline, required_any_of=indicated,
                effects=[Effect.model_validate(e) for e in DETERIORATION_BY_ESI.get(esi, [])],
            ))
        return state


class Action(BaseModel):
    kind: ActionKind
    ref: str = ""                       # intent | maneuver | order code | treatment code
    elapsed_ms: Optional[int] = None    # sim time this action consumes (default per kind)
    utterance: Optional[str] = None     # learner's words (for the narrator only)
    locale: str = "en"


class DirectorRun(TypedDict, total=False):
    case: dict[str, Any]
    action: dict[str, Any]
    new_facts: list[str]
    fired: list[dict[str, Any]]
    notes: list[dict[str, Any]]
    utterance_en: str
    utterance_tr: str
    visible: dict[str, Any]
    trace: Annotated[list[dict[str, Any]], operator.add]


# --------------------------------------------------------------------------- #
# Deterministic physiology                                                     #
# --------------------------------------------------------------------------- #
def clamp_vitals(v: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key in VITAL_KEYS:
        lo, hi = VITAL_BOUNDS[key]
        val = float(v.get(key, 0.0))
        out[key] = max(lo, min(hi, val))
    if out["diastolic"] >= out["systolic"]:
        out["diastolic"] = max(VITAL_BOUNDS["diastolic"][0], out["systolic"] - 20)
    for key in ("hr", "systolic", "diastolic", "rr", "spo2"):
        out[key] = float(round(out[key]))
    out["tempC"] = round(out["tempC"], 1)
    return out


def baseline_at(points: list[dict[str, Any]], t_ms: int, fallback: Vitals) -> dict[str, float]:
    """Linear interpolation along the authored trajectory; flat beyond the ends."""
    if not points:
        return fallback.model_dump()
    pts = sorted(points, key=lambda p: int(p.get("atMs", 0)))
    if t_ms <= int(pts[0].get("atMs", 0)):
        return {k: float(pts[0].get(k, getattr(fallback, k))) for k in VITAL_KEYS}
    if t_ms >= int(pts[-1].get("atMs", 0)):
        return {k: float(pts[-1].get(k, getattr(fallback, k))) for k in VITAL_KEYS}
    for a, b in zip(pts, pts[1:]):
        ta, tb = int(a.get("atMs", 0)), int(b.get("atMs", 0))
        if ta <= t_ms <= tb:
            f = 0.0 if tb == ta else (t_ms - ta) / (tb - ta)
            return {k: float(a.get(k, getattr(fallback, k))) + f * (float(b.get(k, getattr(fallback, k))) - float(a.get(k, getattr(fallback, k))))
                    for k in VITAL_KEYS}
    return {k: float(pts[-1].get(k, getattr(fallback, k))) for k in VITAL_KEYS}


def ramp(delta: float, onset_ms: int, elapsed_ms: int) -> float:
    if elapsed_ms <= 0:
        return 0.0
    if onset_ms <= 0 or elapsed_ms >= onset_ms:
        return delta
    return delta * (elapsed_ms / onset_ms)


def compute_vitals(state: CaseState) -> dict[str, float]:
    v = baseline_at(state.baseline, state.t_ms, state.vitals)
    for eff in state.active_effects:
        if eff.key in v:
            v[eff.key] += ramp(eff.delta, eff.onsetMs, state.t_ms - eff.startMs)
    return clamp_vitals(v)


# The web formulary (web/src/domain/treatments.ts TREATMENT_CATALOG) sends
# RxNorm-style codes ("161", "2193") with no label, so the keyword table above
# never matched them: the acceptance run of 2026-10-20 logged "0 effect(s) from
# generic class table" for paracetamol at 38.9 C and for ceftriaxone in sepsis.
FORMULARY_NAMES: dict[str, str] = {
    "7806": "oxygen", "313002": "iv fluid bolus crystalloid", "1191": "aspirin", "4917": "nitroglycerin",
    "7052": "morphine opioid analgesic", "2193": "ceftriaxone antibiotic", "435": "salbutamol nebuliser",
    "448": "adenosine", "5856": "insulin infusion", "7242": "naloxone", "6470": "lorazepam",
    "161": "paracetamol antipyretic analgesic", "26225": "ondansetron", "3992-im": "adrenaline im",
    "3992": "adrenaline iv", "8410": "alteplase",
    # Acceptance 2026-10-20 D-17: non-beta-lactam and allergy-safe antimicrobials.
    "11124": "vancomycin antibiotic", "82122": "levofloxacin antibiotic", "21212": "clarithromycin antibiotic",
    "3640": "doxycycline antibiotic", "4413": "gentamicin antibiotic", "2582": "clindamycin antibiotic",
    "29561": "meropenem antibiotic", "6922": "metronidazole antibiotic", "2348": "chloramphenicol antibiotic",
    "pip-tazo": "piperacillin-tazobactam antibiotic", "artesunate": "artesunate antimalarial",
    "260101": "oseltamivir antiviral", "3264": "dexamethasone corticosteroid",
}

# Formulary antimicrobials. Any of them satisfies an "antibiotics" row; a
# drug-named row ("ceftriaxone + dexamethasone") is satisfied by its stem too.
ANTIBIOTIC_CODES: frozenset[str] = frozenset({
    "2193", "11124", "82122", "21212", "3640", "4413", "2582", "29561", "6922", "2348", "pip-tazo",
})
_ABX_ROW_STEMS: tuple[str, ...] = ("antibiot", "abx", "antimicrob")
# Rows that are tests or procedures, never satisfied by giving a drug (acceptance
# 2026-10-20: "Blood cultures before antibiotics" matched the antibiotic stem).
DIAGNOSTIC_ROW_STEMS: tuple[str, ...] = ("culture", "film", "test", "aspirat", "swab", "mark ", "look for",
                                         "drain", "washout", "ercp", "decompress", "referral", "source control")
# Supportive rows that must not avert the "missed time-critical treatment"
# deadline on their own: paracetamol does not treat sepsis (D-18).
SUPPORTIVE_ROW_STEMS: tuple[str, ...] = ("antipyr", "paracetam", "analges", "culture", "film", "test", "mark ",
                                         "look for", "assess", "monitor", "observ", "document")

# Word stems that let a formulary drug stand for a case's abstract treatment row
# ("IV antibiotics + fluids", "Immediate IV ceftriaxone + dexamethasone").
# Only rows marked indicated or neutral are matched this way: giving an
# antibiotic is never "Delay antibiotics pending cultures".
FORMULARY_ROW_STEMS: dict[str, tuple[str, ...]] = {
    "2193": ("antibiot", "abx", "ceftriax"),
    "11124": _ABX_ROW_STEMS + ("vancomy",),
    "82122": _ABX_ROW_STEMS + ("levoflox", "fluoroquin", "quinolon"),
    "21212": _ABX_ROW_STEMS + ("clarithro", "macrolid"),
    "3640": _ABX_ROW_STEMS + ("doxycyc",),
    "4413": _ABX_ROW_STEMS + ("gentamic", "aminoglyc"),
    "2582": _ABX_ROW_STEMS + ("clindamy",),
    "29561": _ABX_ROW_STEMS + ("merope", "carbapen"),
    "6922": _ABX_ROW_STEMS + ("metronid",),
    "2348": _ABX_ROW_STEMS + ("chloramph",),
    "pip-tazo": _ABX_ROW_STEMS + ("pipera", "tazobac"),
    "artesunate": ("artesun", "antimalar"),
    "260101": ("oseltam", "antivir"),
    "3264": ("dexameth", "steroid", "corticost"),
    "313002": ("fluid", "crystalloid", "saline"),
    "7806": ("oxygen",),
    "161": ("analges", "antipyr", "paracetam"),
    "7052": ("analges", "opioid", "morphin"),
    "435": ("bronchodil", "salbut", "saba"),
    "3992-im": ("adrenaline", "epinephrine"),
    "7242": ("naloxon",),
    "5856": ("insulin",),
    "1191": ("aspirin", "antiplatelet"),
}


def match_treatment_row(state: "CaseState", code: str) -> "TreatmentRow | None":
    """The case-table row an administered code stands for: exact code first,
    then a formulary drug matched to a non-contraindicated row by its stems."""
    exact = next((t for t in state.treatments if t.code == code), None)
    if exact is not None:
        return exact
    stems = FORMULARY_ROW_STEMS.get(code, ())
    if not stems:
        return None
    for row in state.treatments:
        if row.appropriateness == "contraindicated":
            continue
        hay = f"{row.code} {row.label_en}".lower()
        lead = row.label_en.lower()
        if any(lead.startswith(s) or f" {s}" in f" {lead[:40]}" for s in DIAGNOSTIC_ROW_STEMS):
            continue
        # A combined "antibiotics + fluids" row is satisfied by the antibiotic,
        # never by the fluid bolus or oxygen alone.
        if code not in ANTIBIOTIC_CODES and any(s in hay for s in FORMULARY_ROW_STEMS["2193"]):
            continue
        if any(s in hay for s in stems):
            return row
    return None


def generic_effects_for(code: str, label: str, vitals: Vitals) -> list[Effect]:
    needle = f"{code} {label}".lower()
    for keywords, gate, effects in GENERIC_EFFECTS:
        if not any(k in needle for k in keywords):
            continue
        if gate:
            key, op, thr = _parse_gate(gate)
            cur = float(getattr(vitals, key))
            if op == "<" and not cur < thr:
                return []
            if op == ">" and not cur > thr:
                return []
        return [Effect.model_validate(e) for e in effects]
    return []


def _parse_gate(gate: str) -> tuple[str, str, float]:
    op = "<" if "<" in gate else ">"
    key, thr = gate.split(op)
    return key, op, float(thr)


def _bounded(effects: list[Effect]) -> list[Effect]:
    out: list[Effect] = []
    for e in effects:
        cap = EFFECT_CAPS.get(e.key)
        if cap is None:
            continue
        d = max(-cap, min(cap, float(e.delta)))
        out.append(Effect(key=e.key, delta=d, onsetMs=max(0, int(e.onsetMs))))
    return out


def _affect_from_vitals(v: Vitals, prev: Affect, esi: int) -> Affect:
    """Deterministic affect: driven by oxygenation, pressure, rate and acuity."""
    hypox = max(0.0, (94 - v.spo2) / 20.0)
    tachy = max(0.0, (v.hr - 100) / 60.0)
    shock = max(0.0, (95 - v.systolic) / 40.0)
    dyspnea = min(1.0, hypox + max(0.0, (v.rr - 20) / 20.0))
    anxiety = min(1.0, 0.25 + 0.3 * (5 - esi) / 4 + 0.4 * (hypox + tachy))
    if v.systolic < 70 or v.spo2 < 75:
        cons: Literal["alert", "drowsy", "unresponsive"] = "unresponsive"
    elif v.systolic < 85 or v.spo2 < 86 or shock > 0.3:
        cons = "drowsy"
    else:
        cons = "alert"
    if cons == "unresponsive":
        mood_en, mood_tr = "not responding to voice", "sese yanıt vermiyor"
    elif cons == "drowsy":
        mood_en, mood_tr = "drowsy and slow to answer", "uykuya meyilli, yavaş yanıt veriyor"
    elif anxiety > 0.7:
        mood_en, mood_tr = "frightened, asking what is wrong", "korkmuş, ne olduğunu soruyor"
    elif anxiety > 0.45:
        mood_en, mood_tr = "worried but cooperative", "endişeli ama iş birliği yapıyor"
    else:
        mood_en, mood_tr = "calm and cooperative", "sakin ve iş birliği yapıyor"
    return Affect(pain=prev.pain, anxiety=round(anxiety, 2), dyspnea=round(dyspnea, 2),
                  consciousness=cons, mood_en=mood_en, mood_tr=mood_tr)


def deterministic_utterance(state: CaseState, action: Action, new_facts: list[str], fired: list[dict[str, Any]]) -> tuple[str, str]:
    a = state.affect
    if a.consciousness == "unresponsive":
        return "(no verbal response)", "(sözel yanıt yok)"
    if fired:
        return ("I feel worse, doctor. Something is changing.", "Daha kötü hissediyorum doktor. Bir şeyler değişiyor.")
    if action.kind == "question" and new_facts:
        return new_facts[0], new_facts[0]
    if action.kind == "treatment":
        return ("Okay, whatever you think is best.", "Tamam, siz nasıl uygun görürseniz.")
    if action.kind == "exam":
        return ("Go ahead, doctor.", "Buyurun doktor.")
    if a.consciousness == "drowsy":
        return ("I'm so tired... what did you ask?", "Çok yorgunum... ne sormuştunuz?")
    return ("I don't know about that, you'd have to check.", "Onu bilmiyorum, sizin bakmanız gerekir.")


# --------------------------------------------------------------------------- #
# Nodes                                                                        #
# --------------------------------------------------------------------------- #
def node_perceive(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    action = Action.model_validate(run["action"])
    elapsed = action.elapsed_ms if action.elapsed_ms is not None else DEFAULT_ELAPSED_MS.get(action.kind, 0)
    state.t_ms += max(0, int(elapsed))
    notes: list[dict[str, Any]] = []
    new_facts: list[str] = []

    if action.kind in ("question", "exam", "order") and action.ref:
        key = f"{action.kind}:{action.ref}"
        facts = state.facts_by_trigger.get(key, [])
        fresh = [f for f in facts if f not in state.sanctioned_facts]
        new_facts.extend(fresh)
        state.sanctioned_facts.extend(fresh)
        if action.ref not in state.revealed.setdefault(action.kind, []):
            state.revealed[action.kind].append(action.ref)
        if not facts:
            notes.append({"at_ms": state.t_ms, "note": f"{action.kind} '{action.ref}' unlocks nothing in this case",
                          "why": "no authored datum behind this trigger (counts as low-value action)"})

    if action.kind == "treatment" and action.ref:
        row = match_treatment_row(state, action.ref)
        label = " ".join(x for x in ((row.label_en if row else ""), FORMULARY_NAMES.get(action.ref, "")) if x)
        effects = _bounded(row.effects) if row and row.effects else _bounded(
            generic_effects_for(action.ref, label, state.vitals))
        for e in effects:
            state.active_effects.append(ActiveEffect(source=action.ref, key=e.key, delta=e.delta,
                                                     onsetMs=e.onsetMs, startMs=state.t_ms))
        state.administered.append({"code": action.ref, "at_ms": state.t_ms, "effects": [e.model_dump() for e in effects]})
        state.revealed.setdefault("treatment", []).append(action.ref)
        appr = row.appropriateness if row else "neutral"
        if appr == "contraindicated":
            for e in CONTRAINDICATED_ADVERSE:
                state.active_effects.append(ActiveEffect(source=f"adverse:{action.ref}", startMs=state.t_ms, **e))
            state.errors.append({"at_ms": state.t_ms, "kind": "contraindicated_treatment", "detail": action.ref})
            notes.append({"at_ms": state.t_ms, "note": f"contraindicated treatment {action.ref} given",
                          "why": f"{row.narrative_en if row else 'listed as contraindicated for this case'}; adverse response applied"})
        else:
            notes.append({"at_ms": state.t_ms, "note": f"treatment {action.ref} applied ({appr})",
                          "why": f"{len(effects)} effect(s) from {'case table' if row and row.effects else 'generic class table'}"})
        for c in state.pending_complications:
            if not c.cancelled and c.fired_at_ms is None and (
                    action.ref in c.required_any_of or (row is not None and row.code in c.required_any_of)):
                c.cancelled = True
                c.cancel_reason = f"{action.ref} given at {state.t_ms // 1000}s, before the {c.deadline_ms // 1000}s deadline"
                notes.append({"at_ms": state.t_ms, "note": f"complication '{c.id}' averted", "why": c.cancel_reason})

    state.log.append({"at_ms": state.t_ms, "kind": action.kind, "ref": action.ref})
    return {"case": state.model_dump(), "new_facts": new_facts, "notes": notes,
            "trace": [make_event("director:perceive", started=started, kind=action.kind, ref=action.ref)]}


def node_physiology(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    state.vitals = Vitals.model_validate(compute_vitals(state))
    return {"case": state.model_dump(), "trace": [make_event("director:physiology", started=started, t_ms=state.t_ms)]}


def node_complications(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    fired: list[dict[str, Any]] = []
    notes = list(run.get("notes") or [])
    for c in state.pending_complications:
        if c.cancelled or c.fired_at_ms is not None:
            continue
        if state.t_ms >= c.deadline_ms:
            c.fired_at_ms = state.t_ms
            for e in _bounded(c.effects):
                state.active_effects.append(ActiveEffect(source=c.id, key=e.key, delta=e.delta,
                                                         onsetMs=e.onsetMs, startMs=state.t_ms))
            state.errors.append({"at_ms": state.t_ms, "kind": "missed_deadline", "detail": c.id})
            fired.append({"id": c.id, "at_ms": state.t_ms, "reason": c.reason})
            notes.append({"at_ms": state.t_ms, "note": f"complication '{c.id}' fired", "why": c.reason})
    if fired:
        state.vitals = Vitals.model_validate(compute_vitals(state))
    state.affect = _affect_from_vitals(state.vitals, state.affect, state.acuity_esi)
    return {"case": state.model_dump(), "fired": fired, "notes": notes,
            "trace": [make_event("director:complications", started=started, fired=[f["id"] for f in fired])]}


NARRATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "utterance_en": {"type": "string"},
        "utterance_tr": {"type": "string"},
        "pain": {"type": "number"},
        "mood_en": {"type": "string"},
        "mood_tr": {"type": "string"},
    },
    "required": ["utterance_en", "utterance_tr", "pain", "mood_en", "mood_tr"],
}


def _narrate_messages(state: CaseState, action: Action, new_facts: list[str], fired: list[dict[str, Any]]) -> list[dict[str, str]]:
    system = (
        "ROLE: director\n"
        "You voice a SYNTHETIC patient's affect in a medical simulation. Return ONE JSON "
        "object: utterance_en, utterance_tr (one or two short sentences, first person, in "
        "character), pain (0-10), mood_en, mood_tr. You may ONLY state facts listed under "
        "SANCTIONED FACTS. Never state numbers, drug names, test results or a diagnosis "
        "that are not in that list."
    )
    user = (
        f"CONDITION (hidden from the patient): {state.condition_label_en}\n"
        f"AFFECT: consciousness={state.affect.consciousness}, anxiety={state.affect.anxiety}, "
        f"dyspnea={state.affect.dyspnea}, mood={state.affect.mood_en}\n"
        f"LEARNER ACTION: {action.kind} {action.ref} {action.utterance or ''}\n"
        f"JUST HAPPENED: {'; '.join(f['reason'] for f in fired) or 'nothing new'}\n"
        f"SANCTIONED FACTS: {new_facts or '(none this turn)'}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def node_narrate_deterministic(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    action = Action.model_validate(run["action"])
    en, tr = deterministic_utterance(state, action, run.get("new_facts") or [], run.get("fired") or [])
    return {"utterance_en": en, "utterance_tr": tr,
            "trace": [make_event("director:narrate", started=started, deterministic_only=True)]}


def make_narrate_model(llm: StructuredLLM):
    async def node_narrate_model(run: DirectorRun) -> dict[str, Any]:
        started = time.monotonic()
        state = CaseState.model_validate(run["case"])
        action = Action.model_validate(run["action"])
        new_facts = run.get("new_facts") or []
        fired = run.get("fired") or []
        en, tr = deterministic_utterance(state, action, new_facts, fired)
        if state.affect.consciousness == "unresponsive":
            return {"utterance_en": en, "utterance_tr": tr,
                    "trace": [make_event("director:narrate", started=started, deterministic_only=True, why="unresponsive")]}
        try:
            reply = await llm.complete_json(
                _narrate_messages(state, action, new_facts, fired), schema=NARRATE_SCHEMA,
                schema_name="director_affect", role="judge", temperature=0.6, max_tokens=240,
            )
        except (ModelUnreachable, ModelOutputInvalid) as exc:
            return {"utterance_en": en, "utterance_tr": tr,
                    "trace": [make_event("director:narrate", started=started, status="fail",
                                         note=f"{type(exc).__name__}; deterministic line used")]}
        d = reply.data
        try:
            state.affect.pain = max(0.0, min(10.0, float(d.get("pain", state.affect.pain))))
        except (TypeError, ValueError):
            pass
        if str(d.get("mood_en") or "").strip():
            state.affect.mood_en = str(d["mood_en"])[:120]
        if str(d.get("mood_tr") or "").strip():
            state.affect.mood_tr = str(d["mood_tr"])[:120]
        return {
            "case": state.model_dump(),
            "utterance_en": str(d.get("utterance_en") or en)[:400],
            "utterance_tr": str(d.get("utterance_tr") or tr)[:400],
            "trace": [make_event("director:narrate", started=started, model=reply.model,
                                 model_requested=reply.model_requested, provider=reply.provider,
                                 tokens_in=reply.tokens_in, tokens_out=reply.tokens_out)],
        }
    return node_narrate_model


def node_emit(run: DirectorRun) -> dict[str, Any]:
    state = CaseState.model_validate(run["case"])
    visible = {
        "t_ms": state.t_ms,
        "vitals": state.vitals.model_dump(),
        "affect": state.affect.model_dump(),
        "utterance_en": run.get("utterance_en", ""),
        "utterance_tr": run.get("utterance_tr", ""),
        "new_facts": run.get("new_facts") or [],
        "complications_fired": [f["id"] for f in run.get("fired") or []],
    }
    return {"visible": visible}


def build_director_graph(llm: StructuredLLM | None = None):
    g: StateGraph = StateGraph(DirectorRun)
    g.add_node("perceive", node_perceive)
    g.add_node("physiology", node_physiology)
    g.add_node("complications", node_complications)
    g.add_node("narrate", make_narrate_model(llm) if llm is not None else node_narrate_deterministic)
    g.add_node("emit", node_emit)
    g.add_edge(START, "perceive")
    g.add_edge("perceive", "physiology")
    g.add_edge("physiology", "complications")
    g.add_edge("complications", "narrate")
    g.add_edge("narrate", "emit")
    g.add_edge("emit", END)
    return g


_DETERMINISTIC = build_director_graph(None).compile()


def _unpack(out: dict[str, Any]) -> tuple[CaseState, dict[str, Any], list[dict[str, Any]]]:
    state = CaseState.model_validate(out["case"])
    notes = list(out.get("notes") or [])
    visible = dict(out.get("visible") or {})
    visible["trace"] = list(out.get("trace") or [])
    return state, visible, notes


def next_state(case_state: CaseState | dict[str, Any], action: Action | dict[str, Any]) -> tuple[CaseState, dict[str, Any], list[dict[str, Any]]]:
    """Deterministic Director step (no model). Returns (state, visible, notes)."""
    cs = case_state if isinstance(case_state, dict) else case_state.model_dump()
    ac = action if isinstance(action, dict) else action.model_dump()
    out = _DETERMINISTIC.invoke({"case": cs, "action": ac, "trace": []})
    return _unpack(out)


async def anext_state(case_state: CaseState | dict[str, Any], action: Action | dict[str, Any],
                      llm: StructuredLLM | None = None) -> tuple[CaseState, dict[str, Any], list[dict[str, Any]]]:
    """Director step with the bounded narrator model when ``llm`` is given."""
    cs = case_state if isinstance(case_state, dict) else case_state.model_dump()
    ac = action if isinstance(action, dict) else action.model_dump()
    graph = build_director_graph(llm).compile() if llm is not None else _DETERMINISTIC
    out = await graph.ainvoke({"case": cs, "action": ac, "trace": []})
    return _unpack(out)

"""Clinical Director: adapts the live case to what the learner does, turn by turn.

A LangGraph subgraph runs once per learner action::

    perceive -> physiology -> complications -> narrate -> emit

* ``perceive``       records the action, advances the clock, resolves which
                     sanctioned facts the action unlocks, and turns a treatment
                     into a course event: the case row it stands for, its
                     treatment classes (from the catalogue code, never a
                     substring), antimicrobial spectrum, allergen class and
                     volume. Omission rows ("delay antibiotics") are not
                     administrable; the timer scores them.
* ``physiology``     runs the shared course engine (``course.simulate``,
                     review 06b) from arrival to now: per-condition severity
                     that keeps rising untreated, treatment effect curves,
                     harm rules, lactate, CBG and potassium, branches to new
                     diagnoses and the explicit cardiac-arrest state.
* ``complications``  diffs the new snapshot against the last one: guideline
                     targets met or breached, harms, branches opened, arrest
                     and ROSC, new exam findings (added to the sanctioned
                     facts so re-examining the patient shows them), each
                     logged with why.
* ``narrate``        decides patient affect and a short in-character line. It is
                     deterministic by default; when a model is supplied it may
                     make ONE bounded call for wording and affect only. The
                     model never changes a vital, a fact or a complication.
* ``emit``           produces ``patient_visible_changes`` and ``director_notes``.

Public API::

    state = CaseState.from_spec(spec)
    state, visible, notes = next_state(state, action)            # deterministic
    state, visible, notes = await anext_state(state, action, llm) # + narrator model
    state, visible, notes = await director_step(store, thread_id, action)  # CaseStore-backed
"""

from __future__ import annotations

import inspect
import operator
import re
import time
from typing import Annotated, Any, Literal, Optional, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from server import case_fixtures as FX
from server.orchestration import course as COURSE
from server.orchestration.judges import EFFECT_CAPS, VITAL_BOUNDS
from server.orchestration.llm import ModelOutputInvalid, ModelUnreachable, StructuredLLM
from server.orchestration.trace import make_event

VITAL_KEYS: tuple[str, ...] = ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")
ActionKind = Literal["question", "exam", "order", "treatment", "elapsed", "position"]

# Default sim-time cost of an action when the client does not say.
DEFAULT_ELAPSED_MS: dict[str, int] = {
    "question": 30_000, "exam": 60_000, "order": 45_000, "treatment": 60_000, "elapsed": 0, "position": 15_000,
}


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


class Complication(BaseModel):
    """A guideline target for one treatment group (06b F06): due time, the codes
    that meet it and, once decided, whether it was met or breached."""

    id: str
    reason: str
    deadline_ms: int
    required_any_of: list[str] = Field(default_factory=list)
    effects: list[Effect] = Field(default_factory=list)
    fired_at_ms: Optional[int] = None
    cancelled: bool = False
    cancel_reason: Optional[str] = None
    source: str = ""
    group: str = ""
    process: str = ""


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
    role: str = "definitive"      # definitive | supportive | diagnostic | omission (06b F29)


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
    baseline: list[dict[str, Any]] = Field(default_factory=list)      # authored trajectory (fallback rule only)
    treatments: list[TreatmentRow] = Field(default_factory=list)
    administered: list[dict[str, Any]] = Field(default_factory=list)
    pending_complications: list[Complication] = Field(default_factory=list)
    affect: Affect = Field(default_factory=Affect)
    sanctioned_facts: list[str] = Field(default_factory=list)
    facts_by_trigger: dict[str, list[str]] = Field(default_factory=dict)  # "question:onset" -> facts
    revealed: dict[str, list[str]] = Field(default_factory=lambda: {"question": [], "exam": [], "order": [], "treatment": []})
    errors: list[dict[str, Any]] = Field(default_factory=list)
    log: list[dict[str, Any]] = Field(default_factory=list)
    # Course engine (review 06b): the input minus events, the events, and the
    # last snapshot the Director diffed against.
    course: dict[str, Any] = Field(default_factory=dict)
    events: list[dict[str, Any]] = Field(default_factory=list)
    snapshot: dict[str, Any] = Field(default_factory=dict)

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
            "role": row_role(t),
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
        cid = resolve_condition_id(spec)
        state = cls(
            case_id=case_id or str(spec.get("seed") or ""),
            condition_id=cid or str(cond.get("label_en") or ""),
            condition_label_en=str(cond.get("label_en") or ""), condition_label_tr=str(cond.get("label_tr") or ""),
            system=str(cond.get("system") or ""),
            acuity_esi=esi, treatments=treatments, baseline=baseline, facts_by_trigger=facts,
            vitals=Vitals.model_validate({k: tv.get(k, getattr(Vitals(), k)) for k in VITAL_KEYS}) if tv else Vitals(),
        )
        state.course = build_course_input(spec, cid, state.vitals, baseline)
        state.snapshot = COURSE.simulate({**state.course, "events": []}, 0)
        state.vitals = Vitals.model_validate(state.snapshot["vitals"])
        state.affect = _affect_from_snapshot(state.snapshot, state.affect, esi)
        state.pending_complications = _complications_from_targets(state)
        return state


class Action(BaseModel):
    kind: ActionKind
    ref: str = ""                       # intent | maneuver | order code | treatment code | position
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
    prev_snapshot: dict[str, Any]
    trace: Annotated[list[dict[str, Any]], operator.add]


# --------------------------------------------------------------------------- #
# Spec to course input                                                         #
# --------------------------------------------------------------------------- #
_LACTATE_CODES = ("2524-7", "32693-4")
_GLUCOSE_CODES = ("2345-7", "2339-0", "15074-8", "41653-7")
_K_CODES = ("2823-3", "6298-4")
_UREA_CODES = ("3094-0", "22664-7", "3091-6")
_COURSE_FLAGS = frozenset({"heart_failure", "renal_failure", "copd", "beta_blocked", "pde5", "rv_infarct", "killip2",
                           "red_flags", "hypercapnic_target"})


def resolve_condition_id(spec: dict[str, Any]) -> str:
    """Catalogue id of the spec's condition (meta first, then label, then ICD-10)."""
    meta = spec.get("meta") or {}
    if meta.get("condition_id"):
        return str(meta["condition_id"])
    cond = spec.get("condition") or {}
    if cond.get("id"):
        return str(cond["id"])
    from server.condition_catalog import CATALOG
    label = str(cond.get("label_en") or "").strip().lower()
    icd10 = str(cond.get("icd10") or "").strip()
    for c in CATALOG:
        if label and c["label_en"].lower() == label:
            return c["id"]
    for c in CATALOG:
        if icd10 and c["icd10"] == icd10:
            return c["id"]
    return ""


def _num(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _text(spec: dict[str, Any], key: str) -> str:
    v = spec.get(key)
    if isinstance(v, list):
        return " ".join(str(x) for x in v)
    return str(v or "")


def parse_allergies(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Structured allergies (06b section 4.3) from the authored list or the free text."""
    out: list[dict[str, Any]] = []
    authored = (spec.get("course") or {}).get("allergies") or spec.get("allergies") or []
    if isinstance(authored, list):
        for a in authored:
            if isinstance(a, dict) and a.get("agent_class") in ("penicillin", "cephalosporin", "nsaid", "opioid", "contrast", "sulfonamide"):
                out.append({"agent_class": a["agent_class"], "reaction": str(a.get("reaction") or "rash")})
    if out:
        return out
    text = _text(spec, "allergies_en").lower()
    if not text or "no known" in text or "nkda" in text:
        return out

    def reaction(seg: str) -> str:
        if "anaphyla" in seg:
            return "anaphylaxis"
        if "wheeze" in seg or "bronchospasm" in seg:
            return "bronchospasm"
        if "swelling" in seg or "angioedema" in seg:
            return "angioedema"
        if "itch" in seg:
            return "pruritus"
        return "rash"
    for seg in re.split(r"[;\n]", text):
        if any(w in seg for w in ("penicillin", "amoxicillin", "co-amoxiclav", "flucloxacillin")):
            out.append({"agent_class": "penicillin", "reaction": reaction(seg)})
        if any(w in seg for w in ("aspirin", "ibuprofen", "nsaid")):
            out.append({"agent_class": "nsaid", "reaction": reaction(seg)})
        if any(w in seg for w in ("morphine", "codeine")):
            out.append({"agent_class": "opioid", "reaction": reaction(seg)})
        if "contrast" in seg:
            out.append({"agent_class": "contrast", "reaction": reaction(seg)})
        if "sulfonamide" in seg or "sulpha" in seg:
            out.append({"agent_class": "sulfonamide", "reaction": reaction(seg)})
    return out


def _flags(spec: dict[str, Any], rule: dict[str, Any]) -> list[str]:
    pmh = (_text(spec, "pmh_en") + " " + _text(spec, "meds_en")).lower()
    flags: set[str] = set()
    if "heart failure" in pmh or "cardiac failure" in pmh:
        flags.add("heart_failure")
    if any(w in pmh for w in ("dialysis", "end-stage renal", "end stage renal", "esrd", "ckd stage 5")):
        flags.add("renal_failure")
    if "copd" in pmh or "chronic obstructive" in pmh:
        flags.add("copd")
        flags.add("hypercapnic_target")
    if any(w in pmh for w in ("bisoprolol", "atenolol", "metoprolol", "propranolol", "beta-blocker", "beta blocker")):
        flags.add("beta_blocked")
    if any(w in pmh for w in ("sildenafil", "tadalafil", "vardenafil")):
        flags.add("pde5")
    for f in (spec.get("course") or {}).get("flags") or []:
        if f in _COURSE_FLAGS:
            flags.add(str(f))
    return sorted(flags)


def _curb65(spec: dict[str, Any], tv: Vitals, gcs: float) -> int:
    age = _num((spec.get("demographics") or {}).get("age")) or 45
    urea = None
    for lab in spec.get("labs") or []:
        if str(lab.get("code")) in _UREA_CODES:
            val = _num(lab.get("value"))
            unit = str(lab.get("unit") or "").lower()
            if val is not None:
                urea = val / 2.8 if "mg" in unit else val      # BUN mg/dL to urea mmol/L
    score = int(gcs < 15) + int(urea is not None and urea > 7) + int(tv.rr >= 30) + \
        int(tv.systolic < 90 or tv.diastolic <= 60) + int(age >= 65)
    return int((spec.get("course") or {}).get("curb65") or score)


def build_course_input(spec: dict[str, Any], cid: str, tv: Vitals, trajectory: list[dict[str, Any]]) -> dict[str, Any]:
    """The engine input for this case: condition (its rule library is looked up), arrival state, patient, seed."""
    cid = cid or "unclassified"
    rule = COURSE.library_for(cid)[cid]
    # No course rule (ESI 3 to 5 long tail): the stable fallback rule keeps the
    # authored trajectory, so these cases behave as before.
    traj: list[dict[str, Any]] = trajectory if rule.get("fallback") else []
    t0: dict[str, Any] = tv.model_dump()
    bed0 = dict(rule.get("bedside0") or {})
    for lab in spec.get("labs") or []:
        code = str(lab.get("code") or "")
        val = _num(lab.get("value"))
        if val is None:
            continue
        unit = str(lab.get("unit") or "").lower()
        if code in _LACTATE_CODES:
            bed0["lactate"] = val
        elif code in _GLUCOSE_CODES and rule.get("metabolic") in ("dka", "hypo"):
            bed0["cbg"] = val / 18.0 if "mg" in unit else val
        elif code in _K_CODES and rule.get("metabolic") in ("dka", "hyperk"):
            bed0["k"] = val
    for k, v in ((spec.get("course") or {}).get("bedside0") or {}).items():
        if k in ("gcs", "crt", "mottle", "urine", "pain", "lactate", "cbg", "k") and _num(v) is not None:
            bed0[k] = float(v)
    t0.update(bed0)
    demo = spec.get("demographics") or {}
    seed_raw = spec.get("seed")
    seed = int(seed_raw) if isinstance(seed_raw, (int, float)) or str(seed_raw or "").isdigit() else COURSE.fnv1a(str(seed_raw or cid))
    patient = {
        "weight_kg": _num(demo.get("weight_kg")) or 70.0,
        "age": _num(demo.get("age")) or 45.0,
        "difficulty": int(spec.get("difficulty") or 3),
        "flags": _flags(spec, rule),
        "allergies": parse_allergies(spec),
        "curb65": _curb65(spec, tv, float(t0.get("gcs", 15))),
    }
    return {"condition_id": cid, "t0": t0, "seed": seed, "patient": patient, "trajectory": traj}


# --------------------------------------------------------------------------- #
# Deterministic physiology helpers (kept for the trajectory fallback + tests)  #
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


# The web formulary (web/src/domain/treatments.ts TREATMENT_CATALOG) sends
# RxNorm-style codes ("161", "2193") with no label.
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

# Formulary antimicrobials. Any of them may match an "antibiotics" row; the
# course engine then checks the agent's spectrum against the condition (F11).
ANTIBIOTIC_CODES: frozenset[str] = frozenset({
    "2193", "11124", "82122", "21212", "3640", "4413", "2582", "29561", "6922", "2348", "pip-tazo",
})
_ABX_ROW_STEMS: tuple[str, ...] = ("antibiot", "abx", "antimicrob")
# Rows that are tests or procedures, never satisfied by giving a drug (acceptance
# 2026-10-20: "Blood cultures before antibiotics" matched the antibiotic stem).
DIAGNOSTIC_ROW_STEMS: tuple[str, ...] = ("culture", "film", "test", "aspirat", "swab", "mark ", "look for",
                                         "drain", "washout", "ercp", "decompress", "referral", "source control")
# Contraindicated rows that describe NOT acting (06b F09): scored by the target
# timer, never administered.
OMISSION_ROW_STEMS: tuple[str, ...] = ("delay", "withhold", "wait", "await", "watchful", "discharge", "safety-net",
                                       "safety net", "continue nephrotoxins", "single oral")

# Word stems that let a formulary drug stand for a case's abstract treatment row
# ("IV antibiotics + fluids", "Immediate IV ceftriaxone + dexamethasone").
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


def row_role(t: dict[str, Any]) -> str:
    """Explicit row role (06b F29) instead of substring stems in the deadline logic."""
    label = str(t.get("label_en") or "").lower()
    appr = str(t.get("appropriateness") or "neutral")
    if appr == "contraindicated" and any(label.startswith(s) or f" {s}" in f" {label[:30]}" for s in OMISSION_ROW_STEMS):
        return "omission"
    lead = f" {label[:40]}"
    if any(label.startswith(s) or f" {s}" in lead for s in DIAGNOSTIC_ROW_STEMS[:7]):
        return "diagnostic"
    from server.orchestration.normalize import classify_treatment
    classes = set(classify_treatment(f"{t.get('label_en') or ''} {t.get('code') or ''}"))
    if classes and classes <= {"antipyretic", "analgesia", "oxygen", "antiemetic"}:
        return "supportive"
    return "definitive"


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


_PENICILLIN_WORDS = ("penicillin", "amoxicillin", "co-amoxiclav", "co amoxiclav", "flucloxacillin", "piperacillin",
                     "benzylpenicillin", "ampicillin")


def treatment_classes(code: str, row: Optional[TreatmentRow]) -> list[str]:
    """Classes of an administered item: the catalogue code first, then the row label (whole words)."""
    from server.orchestration.normalize import classify_treatment
    if code in FX.CODE_CLASSES:
        return list(FX.CODE_CLASSES[code])
    text = " ".join(x for x in ((row.label_en if row else ""), (row.code if row else code), FORMULARY_NAMES.get(code, "")) if x)
    return classify_treatment(text)


def course_event(state: CaseState, code: str, at_ms: int, kind: str = "treatment") -> dict[str, Any]:
    """One engine event for an administered item (or an order / a position change)."""
    seq = len(state.events)
    if kind != "treatment":
        return {"kind": kind, "code": code, "at_ms": at_ms, "seq": seq, "label": ""}
    row = match_treatment_row(state, code)
    label = f"{row.label_en if row else ''} {FORMULARY_NAMES.get(code, '')}".lower()
    acls = FX.AGENT_ALLERGY_CLASS.get(code, "")
    if not acls and any(w in label for w in _PENICILLIN_WORDS):
        acls = "penicillin"
    vol = 500.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*(ml|l)\b", label)
    if m:
        v = float(m.group(1)) * (1000.0 if m.group(2) == "l" else 1.0)
        if 100.0 <= v <= 1000.0:
            vol = v
    return {
        "kind": "treatment", "code": code, "row": row.code if row else "", "at_ms": at_ms, "seq": seq,
        "classes": treatment_classes(code, row), "agents": list(FX.AGENT_COVERAGE.get(code, [])),
        "allergy_class": acls, "volume_ml": vol, "appropriateness": row.appropriateness if row else "neutral",
        "effects": _bounded_effects(row.effects) if row else [],
    }


def _bounded_effects(effects: list[Effect]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in effects:
        cap = EFFECT_CAPS.get(e.key)
        if cap is None:
            continue
        out.append({"key": e.key, "delta": max(-cap, min(cap, float(e.delta))), "onsetMs": max(0, int(e.onsetMs))})
    return out


def _complications_from_targets(state: CaseState) -> list[Complication]:
    out: list[Complication] = []
    for t in state.snapshot.get("targets") or []:
        if t.get("due_ms") is None:
            continue
        codes = list(t.get("codes") or [])
        classes = set(t.get("classes") or [])
        codes += [c for c, cls in FX.CODE_CLASSES.items() if classes & set(cls) and c not in codes]
        out.append(Complication(
            id=t["id"], deadline_ms=int(t["due_ms"]), required_any_of=codes, source=t.get("source", ""),
            group=t.get("group", ""), process=t.get("process", ""),
            reason=(f"{t.get('label_en') or t.get('group')} not given within {int(t['due_ms']) // 60_000} min "
                    f"({t.get('basis')}: {t.get('source')})"),
            fired_at_ms=int(t["due_ms"]) if t.get("status") == "breached" else None,
            cancelled=t.get("status") in ("met", "not_needed"),
        ))
    return out


def _affect_from_snapshot(snap: dict[str, Any], prev: Affect, esi: int) -> Affect:
    """Deterministic affect from the course state: GCS drives consciousness (06b F13)."""
    v = snap.get("vitals") or {}
    b = snap.get("bedside") or {}
    gcs = float(b.get("gcs", 15))
    spo2, hr, sbp, rr = float(v.get("spo2", 97)), float(v.get("hr", 80)), float(v.get("systolic", 120)), float(v.get("rr", 16))
    hypox = max(0.0, (94 - spo2) / 20.0)
    tachy = max(0.0, (hr - 100) / 60.0)
    dyspnea = min(1.0, hypox + max(0.0, (rr - 20) / 20.0))
    anxiety = min(1.0, 0.25 + 0.3 * (5 - esi) / 4 + 0.4 * (hypox + tachy))
    if not b.get("pulse", True) or gcs <= 8:
        cons: Literal["alert", "drowsy", "unresponsive"] = "unresponsive"
    elif gcs <= 13 or sbp < 80:
        cons = "drowsy"
    else:
        cons = "alert"
    if cons == "unresponsive":
        mood_en, mood_tr = "not responding to voice", "sese yanıt vermiyor"
    elif cons == "drowsy":
        mood_en, mood_tr = "drowsy and confused, slow to answer", "uykulu ve konfüze, yavaş yanıt veriyor"
    elif anxiety > 0.7:
        mood_en, mood_tr = "frightened, asking what is wrong", "korkmuş, ne olduğunu soruyor"
    elif anxiety > 0.45:
        mood_en, mood_tr = "worried but cooperative", "endişeli ama iş birliği yapıyor"
    else:
        mood_en, mood_tr = "calm and cooperative", "sakin ve iş birliği yapıyor"
    pain = float(b.get("pain", prev.pain))
    return Affect(pain=pain, anxiety=round(anxiety, 2), dyspnea=round(dyspnea if b.get("pulse", True) else 1.0, 2),
                  consciousness=cons, mood_en=mood_en, mood_tr=mood_tr)


def deterministic_utterance(state: CaseState, action: Action, new_facts: list[str], fired: list[dict[str, Any]]) -> tuple[str, str]:
    a = state.affect
    b = state.snapshot.get("bedside") or {}
    if not b.get("pulse", True):
        return "(no pulse, not breathing)", "(nabız yok, solunum yok)"
    if a.consciousness == "unresponsive":
        return "(no verbal response)", "(sözel yanıt yok)"
    said = [f for f in fired if f.get("say_en")]
    if said:
        return said[-1]["say_en"], said[-1].get("say_tr") or said[-1]["say_en"]
    if float(b.get("gcs", 15)) <= 12:
        return ("(a relative) He's not making sense now, doctor.", "(yakını) Artık anlamsız konuşuyor doktor.")
    if any(f.get("kind") in ("missed_target", "harm") for f in fired) and state.snapshot.get("phase") in ("deteriorating", "peri_arrest"):
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
        if action.kind == "order":
            state.events.append(course_event(state, action.ref, state.t_ms, "order"))

    if action.kind == "position" and action.ref:
        state.events.append(course_event(state, action.ref, state.t_ms, "position"))

    if action.kind == "treatment" and action.ref:
        row = match_treatment_row(state, action.ref)
        appr = row.appropriateness if row else "neutral"
        state.revealed.setdefault("treatment", []).append(action.ref)
        if row is not None and row.role == "omission":
            notes.append({"at_ms": state.t_ms, "note": f"'{action.ref}' is an omission, not an administrable item",
                          "why": f"{row.label_en}: scored by the target timer, no physiological effect (06b F09)"})
        else:
            ev = course_event(state, action.ref, state.t_ms)
            state.events.append(ev)
            state.administered.append({"code": action.ref, "at_ms": state.t_ms, "row": ev["row"], "classes": ev["classes"]})
            if appr == "contraindicated":
                state.errors.append({"at_ms": state.t_ms, "kind": "contraindicated_treatment", "detail": action.ref})
                notes.append({"at_ms": state.t_ms, "note": f"contraindicated treatment {action.ref} given",
                              "why": f"{row.narrative_en if row else 'listed as contraindicated for this case'}; specific harm rule applied"})
            else:
                notes.append({"at_ms": state.t_ms, "note": f"treatment {action.ref} applied ({appr})",
                              "why": f"classes {', '.join(ev['classes']) or 'none'}; row {ev['row'] or 'none'}"
                                     f"{'; spectrum ' + '/'.join(ev['agents']) if ev['agents'] else ''}"})

    state.log.append({"at_ms": state.t_ms, "kind": action.kind, "ref": action.ref})
    return {"case": state.model_dump(), "new_facts": new_facts, "notes": notes,
            "trace": [make_event("director:perceive", started=started, kind=action.kind, ref=action.ref)]}


def node_physiology(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    snap = COURSE.simulate({**state.course, "events": state.events}, state.t_ms)
    prev = state.snapshot
    state.snapshot = snap
    state.vitals = Vitals.model_validate(snap["vitals"])
    return {"case": state.model_dump(), "prev_snapshot": prev,
            "trace": [make_event("director:physiology", started=started, t_ms=state.t_ms, phase=snap["phase"],
                                 severity=snap["severity"])]}


def _new(items: list[dict[str, Any]], old: list[dict[str, Any]], key: tuple[str, ...]) -> list[dict[str, Any]]:
    seen = {tuple(o.get(k) for k in key) for o in old}
    return [i for i in items if tuple(i.get(k) for k in key) not in seen]


def node_complications(run: DirectorRun) -> dict[str, Any]:
    started = time.monotonic()
    state = CaseState.model_validate(run["case"])
    prev = run.get("prev_snapshot") or {}
    snap = state.snapshot
    fired: list[dict[str, Any]] = []
    notes = list(run.get("notes") or [])
    new_facts = list(run.get("new_facts") or [])
    t = state.t_ms
    old_targets = {(x["process"], x["id"]): x for x in prev.get("targets") or []}
    for tg in snap.get("targets") or []:
        before = old_targets.get((tg["process"], tg["id"]), {}).get("status", "pending")
        if tg["status"] == before:
            continue
        if tg["status"] == "met":
            notes.append({"at_ms": t, "note": f"target '{tg['id']}' met (complication averted)",
                          "why": f"{tg.get('label_en') or tg['group']} at {int(tg['met_ms']) // 60_000} min, due by "
                                 f"{int(tg['due_ms']) // 60_000} min ({tg['source']})"})
        elif tg["status"] == "breached":
            why = (f"{tg.get('label_en') or tg['group']} not given within {int(tg['due_ms']) // 60_000} min "
                   f"({tg.get('basis')}: {tg['source']})" if tg.get("due_ms") is not None else tg["source"])
            fired.append({"id": tg["id"], "kind": "missed_target", "at_ms": t, "reason": why})
            state.errors.append({"at_ms": t, "kind": "missed_target", "detail": tg["id"]})
            notes.append({"at_ms": t, "note": f"complication '{tg['id']}' fired", "why": why})
    for h in _new(snap.get("harms") or [], prev.get("harms") or [], ("id", "at_ms", "src")):
        kind = "contraindicated_treatment" if h["id"].startswith("row_harm:") or h["id"] == "contraindicated_treatment" else h["id"]
        if kind != "contraindicated_treatment":
            state.errors.append({"at_ms": h["at_ms"], "kind": kind, "detail": h.get("src") or h["id"]})
        fired.append({"id": h["id"], "kind": "harm", "at_ms": h["at_ms"], "reason": h["why_en"]})
        notes.append({"at_ms": h["at_ms"], "note": f"harm '{h['id']}'", "why": h["why_en"]})
    for entry in _new(snap.get("log") or [], prev.get("log") or [], ("kind", "id", "at_ms", "parent")):
        if entry["kind"] == "branch":
            fired.append({"id": entry["id"], "kind": "branch", "at_ms": entry["at_ms"], "reason": entry["why_en"],
                          "say_en": entry.get("say_en", ""), "say_tr": entry.get("say_tr", "")})
            notes.append({"at_ms": entry["at_ms"], "note": f"branch: {entry['parent']} -> {entry['id']}", "why": entry["why_en"]})
            state.log.append({"at_ms": entry["at_ms"], "kind": "branch", "ref": entry["id"], "why": entry["why_en"]})
        elif entry["kind"] == "arrest":
            fired.append({"id": "cardiac_arrest", "kind": "arrest", "at_ms": entry["at_ms"], "reason": entry["why_en"]})
            state.errors.append({"at_ms": entry["at_ms"], "kind": "cardiac_arrest", "detail": entry["id"]})
            notes.append({"at_ms": entry["at_ms"], "note": f"cardiac arrest ({entry['id']}): ALS", "why": entry["why_en"]})
        elif entry["kind"] == "rosc":
            fired.append({"id": "rosc", "kind": "rosc", "at_ms": entry["at_ms"], "reason": entry["why_en"]})
            notes.append({"at_ms": entry["at_ms"], "note": "ROSC", "why": entry["why_en"]})
        elif entry["kind"] == "spectrum":
            notes.append({"at_ms": entry["at_ms"], "note": f"inadequate spectrum for '{entry['id']}'", "why": entry["why_en"]})
    for f in _new(snap.get("findings") or [], prev.get("findings") or [], ("id",)):
        key = f"exam:{f['exam']}"
        state.facts_by_trigger.setdefault(key, [])
        if f["en"] not in state.facts_by_trigger[key]:
            state.facts_by_trigger[key].insert(0, f["en"])
        notes.append({"at_ms": f["at_ms"], "note": f"new finding on {f['exam']}", "why": f["en"]})
        if f["exam"] in state.revealed.get("exam", []) and f["en"] not in state.sanctioned_facts and f.get("exam") == "skin":
            # Visible from the end of the bed: purpura, mottling and urticaria need no manoeuvre.
            state.sanctioned_facts.append(f["en"])
            new_facts.append(f["en"])
    state.pending_complications = _complications_from_targets(state)
    state.affect = _affect_from_snapshot(snap, state.affect, state.acuity_esi)
    return {"case": state.model_dump(), "fired": fired, "notes": notes, "new_facts": new_facts,
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
        "that are not in that list. If the patient's GCS is 12 or less, speak as a relative."
    )
    b = state.snapshot.get("bedside") or {}
    user = (
        f"CONDITION (hidden from the patient): {state.condition_label_en}; active: {', '.join(state.snapshot.get('active_diagnoses') or [])}\n"
        f"AFFECT: consciousness={state.affect.consciousness}, GCS={b.get('gcs')}, airway={b.get('airway')}, "
        f"anxiety={state.affect.anxiety}, dyspnea={state.affect.dyspnea}, mood={state.affect.mood_en}\n"
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
                schema_name="director_affect", role="judge", temperature=0.6, max_tokens=240, node="narrator",
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


def results_view(state: CaseState) -> dict[str, Any]:
    """What the results engine reads from the live Director (06b F19, F20)."""
    snap = state.snapshot
    b = snap.get("bedside") or {}
    live = [p for p in snap.get("processes") or [] if not p.get("superseded")]
    branch = next((p["id"] for p in reversed(live) if not p.get("primary") and p["id"] in FX.CONDITION_COURSE
                   and FX.CONDITION_COURSE[p["id"]].get("pattern") != "stable"), None)
    return {
        "condition_id": branch or state.condition_id, "primary_condition_id": state.condition_id,
        "t_ms": snap.get("t_ms", state.t_ms), "severity": snap.get("severity", 0.0), "phase": snap.get("phase"),
        "map": b.get("map"), "shock": bool((b.get("map") or 99) < 65 or snap.get("pressor_on") or not b.get("pulse", True)),
        "lactate": b.get("lactate"), "cbg": b.get("cbg"), "k": b.get("k"), "vitals": snap.get("vitals"),
        "active_diagnoses": snap.get("active_diagnoses") or [],
        "metabolic": COURSE.library_for(str(state.course.get("condition_id") or "unclassified"))
        .get(str(state.course.get("condition_id") or "unclassified"), {}).get("metabolic"),
    }


def node_emit(run: DirectorRun) -> dict[str, Any]:
    state = CaseState.model_validate(run["case"])
    snap = state.snapshot
    fired = run.get("fired") or []
    visible = {
        "t_ms": state.t_ms,
        "vitals": state.vitals.model_dump(),
        "affect": state.affect.model_dump(),
        "utterance_en": run.get("utterance_en", ""),
        "utterance_tr": run.get("utterance_tr", ""),
        "new_facts": run.get("new_facts") or [],
        "complications_fired": [f["id"] for f in fired if f.get("kind") in ("missed_target", "branch", "arrest")],
        "bedside": snap.get("bedside") or {},
        "phase": snap.get("phase"),
        "severity": snap.get("severity"),
        "active_diagnoses": snap.get("active_diagnoses") or [],
        "events": fired,
        "targets": [{k: tg.get(k) for k in ("id", "group", "status", "due_ms", "met_ms", "source", "basis", "label_en", "label_tr")}
                    for tg in snap.get("targets") or []],
        "results": results_view(state),
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


# --------------------------------------------------------------------------- #
# Server-authoritative state (CaseStore)                                       #
# --------------------------------------------------------------------------- #
class CaseStoreLike(Protocol):
    """``server/orchestration/store.py`` CaseStore: one record per ``thread_id``.
    ``get`` and ``put`` may be sync or async; the Director keeps its state under
    the record's ``"director"`` key and reads the generated ``"spec"`` from it."""

    def get(self, thread_id: str) -> Any: ...

    def put(self, thread_id: str, record: dict[str, Any]) -> Any: ...


class MemoryCaseStore:
    """Process-local CaseStore with the same get/put signature (used when no
    persistent store is configured, and in tests)."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}

    def get(self, thread_id: str) -> Optional[dict[str, Any]]:
        rec = self._data.get(thread_id)
        return None if rec is None else dict(rec)

    def put(self, thread_id: str, record: dict[str, Any]) -> None:
        self._data[thread_id] = dict(record)


async def _maybe(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def default_case_store() -> CaseStoreLike:
    """The shared CaseStore when ``server/orchestration/store.py`` provides one."""
    try:
        from server.orchestration import store as _store  # type: ignore[attr-defined]
    except ImportError:
        return MemoryCaseStore()
    factory = getattr(_store, "get_case_store", None) or getattr(_store, "CaseStore", None)
    return factory() if callable(factory) else MemoryCaseStore()


async def director_step(store: CaseStoreLike, thread_id: str, action: Action | dict[str, Any], *,
                        spec: Optional[dict[str, Any]] = None, llm: StructuredLLM | None = None
                        ) -> tuple[CaseState, dict[str, Any], list[dict[str, Any]]]:
    """One Director step whose state is read from and written to the CaseStore
    (server authoritative, 06a P21): the client sends only ``thread_id`` and the
    action. A first step builds the state from the stored generated spec."""
    rec = await _maybe(store.get(thread_id))
    rec = dict(rec) if isinstance(rec, dict) else {}
    if rec.get("director"):
        state = CaseState.model_validate(rec["director"])
    else:
        source = spec or rec.get("spec")
        if not source:
            raise LookupError(f"no generated case stored for thread {thread_id!r}")
        state = CaseState.from_spec(source, case_id=thread_id)
    new_state, visible, notes = await anext_state(state, action, llm)
    rec["director"] = new_state.model_dump()
    await _maybe(store.put(thread_id, rec))
    return new_state, visible, notes


__all__ = [
    "Action", "Affect", "CaseState", "CaseStoreLike", "Complication", "MemoryCaseStore", "Vitals", "anext_state",
    "build_course_input", "build_director_graph", "course_event", "default_case_store", "director_step", "match_treatment_row",
    "next_state", "parse_allergies", "resolve_condition_id", "results_view", "row_role", "treatment_classes",
]

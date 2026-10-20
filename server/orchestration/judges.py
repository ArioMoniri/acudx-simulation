"""The three-judge council that reviews every authored case draft.

Each judge is *deterministic first, model second*: cheap code checks that can
fail a draft outright run before any model is asked, and the model is asked
only when code could not already decide. The verdict shape is identical for
all three so ``aggregate`` can count votes:

    {"judge": str, "round": int, "verdict": "pass"|"fail", "veto": bool,
     "issues": [str], "repair_hints": [str],
     "deterministic": {...}, "model": {...} | None}

* ``clinical_consistency`` checks that vitals, labs and exam cohere with the
  condition (physiological ranges, trajectory shape, ESI vs vitals band).
* ``safety_dosing`` checks treatments and contraindications against the
  condition fixture (a fixture-contraindicated treatment can never be marked
  indicated) and bounds every treatment effect. Its ``fail`` is a **veto**
  even at the model phase.

A deterministic failure from any judge is also a veto: code-checked facts
(SpO2 above 100, a missing red flag) are not put to a vote.
* ``pedagogy`` checks difficulty, red flags and ESI against the catalog entry.

The verdict vocabulary and the panel idea follow the PoLL / robust-aggregator
notes in ``docs/research/16`` section 1.4: high-stakes "accept" decisions on
dosing go to a deterministic check, not to more votes.
"""

from __future__ import annotations

import json
import time
from typing import Any

from server import case_fixtures
from server import case_generator as CG
from server.condition_catalog import complaint_keys
from server.orchestration import normalize as N
from server.orchestration.llm import StructuredLLM
from server.orchestration.trace import make_event

JUDGES: tuple[str, ...] = ("clinical_consistency", "safety_dosing", "pedagogy")

# Absolute physiological bounds shared with the Director (server/orchestration/director.py).
VITAL_BOUNDS: dict[str, tuple[float, float]] = {
    "hr": (20, 250),
    "systolic": (40, 260),
    "diastolic": (20, 160),
    "rr": (0, 80),          # infants in respiratory distress exceed 60/min
    "spo2": (0, 100),
    "tempC": (25.0, 43.0),  # severe hypothermia is below 28 C
}

# Largest plausible single-treatment effect per vital (absolute delta).
EFFECT_CAPS: dict[str, float] = {
    # hr 80: cardioversion or adenosine ends a tachyarrhythmia (VT 180 to sinus 100).
    "hr": 80, "systolic": 50, "diastolic": 30, "rr": 15, "spo2": 15, "tempC": 2.5, "pain": 10,
}

# ESI acuity -> acceptable triage vitals envelope (wider than the template bands).
# Adults only (children are exempt from hr and rr). ESI 1 and 2 allow the rates
# of a tachyarrhythmia (SVT runs 150 to 250/min); danger-zone vitals push a
# patient to ESI 2, so ESI 3 keeps the narrower band.
_ESI_ENVELOPE: dict[int, dict[str, tuple[float, float]]] = {
    1: {"hr": (30, 230), "systolic": (50, 220), "spo2": (50, 100), "rr": (4, 50)},
    2: {"hr": (40, 210), "systolic": (70, 220), "spo2": (80, 100), "rr": (8, 40)},
    3: {"hr": (45, 140), "systolic": (80, 200), "spo2": (88, 100), "rr": (10, 32)},
    4: {"hr": (50, 120), "systolic": (90, 180), "spo2": (92, 100), "rr": (10, 26)},
    5: {"hr": (50, 110), "systolic": (95, 170), "spo2": (94, 100), "rr": (10, 24)},
}

# Evidence-bound verdicts (live finding 2026-10-20: the 14B judges vetoed correct
# content, for example "gallstones are not typically associated with
# cholangitis"). Every issue must cite one evidence key offered in the prompt
# (a fixture or catalog field) and quote its value; anything else is a note.
JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "fail"]},
        "issues": {
            "type": "array", "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string"},
                    "evidence": {"type": "string"},
                    "evidence_value": {"type": "string"},
                    "problem": {"type": "string"},
                    "fix": {"type": "string"},
                },
                "required": ["field", "evidence", "evidence_value", "problem", "fix"],
            },
        },
        "notes": {"type": "array", "maxItems": 4, "items": {"type": "string"}},
    },
    "required": ["verdict", "issues", "notes"],
}

# Deterministic rules a judge may name. Code already checked them before the
# model was asked, so a model issue citing one is re-checked, never trusted.
RULE_IDS: tuple[str, ...] = (
    "vital_bounds", "diastolic_below_systolic", "trajectory_order", "esi_envelope", "lab_flag", "lab_unit",
    "labs_present", "imaging_present", "exam_present", "treatment_code", "fixture_appropriateness",
    "effect_caps", "effect_plausibility", "indicated_and_distractor", "difficulty_band", "acuity_band",
    "hpi_count", "hpi_onset", "red_flag_hpi", "red_flags_structured", "complaint_adherence",
)


def _vitals_ok(v: dict[str, Any], issues: list[str], label: str) -> None:
    for key, (lo, hi) in VITAL_BOUNDS.items():
        val = v.get(key)
        if val is None:
            issues.append(f"{label}: missing {key}")
            continue
        try:
            fval = float(val)
        except (TypeError, ValueError):
            issues.append(f"{label}: {key} is not numeric")
            continue
        if not (lo <= fval <= hi):
            issues.append(f"{label}: {key}={fval} outside {lo}-{hi}")
    try:
        if float(v.get("diastolic", 0)) >= float(v.get("systolic", 0)):
            issues.append(f"{label}: diastolic >= systolic")
    except (TypeError, ValueError):
        pass


# --------------------------------------------------------------------------- #
# Deterministic checks                                                         #
# --------------------------------------------------------------------------- #
def check_clinical_consistency(draft: dict[str, Any], cond: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = []
    triage = draft.get("triage_vitals") or {}
    _vitals_ok(triage, issues, "triage_vitals")
    traj = draft.get("vitals_trajectory") or []
    last_t = -1
    for i, pt in enumerate(traj):
        _vitals_ok(pt, issues, f"vitals_trajectory[{i}]")
        at = pt.get("atMs", 0)
        try:
            at = int(at)
        except (TypeError, ValueError):
            at = 0
        if at <= last_t and i > 0:
            issues.append(f"vitals_trajectory[{i}]: atMs not increasing")
        last_t = at
    esi = int(draft.get("acuity_esi") or cond.get("typical_acuity") or 3)
    env = dict(_ESI_ENVELOPE.get(esi, _ESI_ENVELOPE[3]))
    try:
        age = int((draft.get("demographics") or {}).get("age") or 40)
    except (TypeError, ValueError):
        age = 40
    if age < 16:
        # The envelope is adult; children's heart and respiratory rates run higher.
        env.pop("hr", None)
        env.pop("rr", None)
    for key, (lo, hi) in env.items():
        try:
            val = float(triage.get(key))
        except (TypeError, ValueError):
            continue
        if not (lo <= val <= hi):
            issues.append(f"triage {key}={val} implausible for ESI {esi} (expected {lo}-{hi})")
    if not draft.get("exam"):
        issues.append("no exam findings (rule:exam_present)")
    labs = draft.get("labs") or []
    if not labs:
        issues.append("no labs authored (rule:labs_present)")
    if not draft.get("imaging"):
        issues.append("no imaging authored (rule:imaging_present)")
    issues.extend(N.lab_unit_problems(labs))
    for lab in labs:
        lo, hi, val = lab.get("ref_low"), lab.get("ref_high"), lab.get("value")
        flag = str(lab.get("flag") or "N").upper()
        try:
            if lo is not None and hi is not None and val is not None:
                fv, flo, fhi = float(val), float(lo), float(hi)
                if flag == "N" and not (flo <= fv <= fhi):
                    issues.append(f"lab {lab.get('code') or lab.get('label_en')}: value {fv} outside ref but flagged N")
                if flag in ("H", "HH") and fv < flo:
                    issues.append(f"lab {lab.get('code') or lab.get('label_en')}: flagged high but below reference")
                if flag in ("L", "LL") and fv > fhi:
                    issues.append(f"lab {lab.get('code') or lab.get('label_en')}: flagged low but above reference")
        except (TypeError, ValueError):
            continue
    return {"ok": not issues, "issues": issues}


def fixture_contraindicated_codes(cond_id: str) -> set[str]:
    fixture = case_fixtures.CONDITION_FIXTURES.get(cond_id) or {}
    return {t[0] for t in fixture.get("treatments", []) if t[3] == "contraindicated"}


def fixture_indicated_codes(cond_id: str) -> set[str]:
    fixture = case_fixtures.CONDITION_FIXTURES.get(cond_id) or {}
    return {t[0] for t in fixture.get("treatments", []) if t[3] == "indicated"}


def check_safety_dosing(draft: dict[str, Any], cond: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = []
    treatments = draft.get("treatments") or []
    if not treatments:
        issues.append("no treatments authored")
    contra = fixture_contraindicated_codes(cond.get("id", ""))
    indicated = fixture_indicated_codes(cond.get("id", ""))
    appr = {str(t.get("code") or t.get("label_en")): str(t.get("appropriateness") or "neutral") for t in treatments}
    for code, a in appr.items():
        if code in contra and a == "indicated":
            issues.append(f"treatment {code} is contraindicated for {cond.get('id')} but marked indicated")
        if code in indicated and a == "contraindicated":
            issues.append(f"treatment {code} is first-line for {cond.get('id')} but marked contraindicated")
    if treatments and not any(a == "indicated" for a in appr.values()):
        issues.append("no indicated treatment")
    if treatments and not any(a == "contraindicated" for a in appr.values()):
        issues.append("no contraindicated distractor treatment")
    vocab = {v["code"] for v in N.condition_treatments(cond)}
    for t in treatments:
        code = str(t.get("code") or "")
        if not code or not (code in vocab or N.known_treatment_code(code)):
            issues.append(f"treatment {t.get('label_en')!r} has no catalogue code {code!r}; use one of "
                          f"{', '.join(sorted(vocab))} (rule:treatment_code)")
        issues.extend(f"{p} (rule:effect_plausibility)" for p in N.effect_problems(t))
    for t in treatments:
        for eff in t.get("effects") or []:
            key = str(eff.get("key") or "")
            cap = EFFECT_CAPS.get(key)
            try:
                delta = abs(float(eff.get("delta", 0)))
            except (TypeError, ValueError):
                issues.append(f"treatment {t.get('code')}: non-numeric effect delta")
                continue
            if cap is None:
                issues.append(f"treatment {t.get('code')}: unknown effect key {key!r}")
            elif delta > cap:
                issues.append(f"treatment {t.get('code')}: effect {key} delta {delta} exceeds cap {cap}")
    return {"ok": not issues, "issues": issues}


def check_pedagogy(draft: dict[str, Any], cond: dict[str, Any]) -> dict[str, Any]:
    issues: list[str] = []
    diff = draft.get("difficulty")
    try:
        if not (1 <= int(diff) <= 5):
            issues.append(f"difficulty {diff} outside 1-5")
    except (TypeError, ValueError):
        issues.append("difficulty missing")
    esi = draft.get("acuity_esi")
    try:
        esi_i = int(esi)
        typical = int(cond.get("typical_acuity") or esi_i)
        if abs(esi_i - typical) > 1:
            issues.append(f"acuity_esi {esi_i} differs from typical {typical} by more than 1")
    except (TypeError, ValueError):
        issues.append("acuity_esi missing")
    hpi = draft.get("hpi") or []
    if not (4 <= len(hpi) <= 10):
        issues.append(f"hpi has {len(hpi)} items (expected 4-10)")
    if cond.get("red_flags") and not any(bool(h.get("red_flag")) for h in hpi):
        issues.append("condition has red flags but no hpi item is marked red_flag")
    intents = [h.get("intent") for h in hpi]
    if "onset" not in intents:
        issues.append("hpi lacks an onset item")
    if cond.get("red_flags") and not draft.get("red_flags"):
        issues.append("condition has red flags but the case has no structured red_flags (rule:red_flags_structured)")
    issues.extend(complaint_problems(draft, cond.get("requested_complaint")))
    return {"ok": not issues, "issues": issues}


def complaint_problems(draft: dict[str, Any], requested: str | None) -> list[str]:
    """The chief complaint must present the requested complaint (rule:complaint_adherence).

    At least one requested complaint key must appear in the chief complaint, and
    every requested key in the chief complaint or the HPI answers. Free-text
    requests with no recognised complaint key are not checked."""
    wanted = complaint_keys(requested or "")
    if not wanted:
        return []
    cc = f"{draft.get('chief_complaint_en') or ''} {draft.get('chief_complaint_tr') or ''}"
    hpi = " ".join(f"{h.get('answer_en') or ''} {h.get('answer_tr') or ''}" for h in draft.get("hpi") or [])
    in_cc = set(complaint_keys(cc))
    anywhere = in_cc | set(complaint_keys(hpi))
    out: list[str] = []
    if not in_cc & set(wanted):
        out.append(f"chief complaint {draft.get('chief_complaint_en')!r} does not present the requested complaint "
                   f"{requested!r} (rule:complaint_adherence)")
    missing = [k for k in wanted if k not in anywhere]
    if missing:
        out.append(f"requested complaint parts {missing} absent from chief complaint and hpi (rule:complaint_adherence)")
    return out


DETERMINISTIC = {
    "clinical_consistency": check_clinical_consistency,
    "safety_dosing": check_safety_dosing,
    "pedagogy": check_pedagogy,
}

_JUDGE_FOCUS = {
    "clinical_consistency": (
        "Check that the vitals, exam findings, labs and imaging of the DRAFT do not contradict "
        "the reference EVIDENCE for this condition."
    ),
    "safety_dosing": (
        "Check that each treatment's appropriateness agrees with the reference EVIDENCE "
        "(an evidence 'indicated' item must not be marked contraindicated and vice versa)."
    ),
    "pedagogy": (
        "Check that a learner can reach the diagnosis: the reference red flags and typical "
        "complaint in the EVIDENCE must be elicitable from the DRAFT's hpi and exam."
    ),
}


def evidence_index(cond: dict[str, Any]) -> dict[str, str]:
    """Citable reference facts for a condition: ``key -> value``.

    The keys are the only evidence a model judge may cite. Values come from the
    catalog entry and the resolved condition fixture (fixture over system
    profile), the same reviewed data the deterministic template uses."""
    ev: dict[str, str] = {}
    ev["catalog.label"] = f"{cond.get('label_en', '')}"
    ev["catalog.typical_complaint"] = f"{cond.get('typical_complaint_en', '')}"
    ev["catalog.typical_acuity"] = f"ESI {cond.get('typical_acuity', '')}"
    for i, rf in enumerate(cond.get("red_flags") or []):
        ev[f"catalog.red_flags[{i}]"] = str(rf.get("en") or "")
    if not cond.get("system"):
        return ev
    prof = CG._resolve_fixture(cond)
    for i, row in enumerate(prof.get("labs") or []):
        code, en, _tr, val, unit, lo, hi, flag = row[:8]
        ev[f"fixture.labs[{i}]"] = f"{en} ({code}) {val} {unit} ref {lo}-{hi} flag {flag}"
    img = prof.get("imaging")
    if img:
        ev["fixture.imaging"] = f"{img[1]}: {img[3]}"
    for i, ex in enumerate(prof.get("exam") or []):
        ev[f"fixture.exam[{i}]"] = f"{ex[0]}: {ex[3]}"
    for t in prof.get("treatments") or []:
        ev[f"fixture.treatments[{t[0]}]"] = f"{t[1]}: {t[3]}"
    return ev


def _compact(draft: dict[str, Any]) -> str:
    """Draft without free-text bulk the judge does not need."""
    keep = {k: v for k, v in draft.items() if k not in ("meta", "guideline_anchor_ids", "guideline_anchors")}
    return json.dumps(keep, ensure_ascii=False, separators=(",", ":"))


def judge_messages(name: str, draft: dict[str, Any], cond: dict[str, Any]) -> list[dict[str, str]]:
    system = (
        f"ROLE: judge:{name}\n"
        "You are one reviewer on a three-judge council for a medical-education case "
        "simulator. Synthetic patients only. Deterministic code has ALREADY verified vital "
        "bounds, lab flags and units, treatment codes, effect plausibility, red flags and the "
        "difficulty and acuity bands; do not repeat those checks. You may raise an issue ONLY "
        "when a DRAFT field contradicts one EVIDENCE line: cite that line's key exactly in "
        "'evidence' and copy its value into 'evidence_value'. General medical opinions, style "
        "remarks and suggestions go into 'notes', never into 'issues'. When nothing in the "
        "draft contradicts the evidence, answer verdict 'pass' with no issues."
    )
    ev = evidence_index(cond)
    lines = "\n".join(f"- {k}: {v}" for k, v in ev.items())
    user = (
        f"FOCUS\n{_JUDGE_FOCUS[name]}\n\n"
        f"EVIDENCE (the only citable keys)\n{lines}\n\n"
        f"DRAFT\n{_compact(draft)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _overlap(quote: str, value: str) -> float:
    q = N._tokens(quote)
    if not q:
        return 0.0
    return len(q & N._tokens(value)) / len(q)


def bind_issues(raw_issues: list[Any], draft: dict[str, Any], cond: dict[str, Any]
                ) -> tuple[list[dict[str, Any]], list[str]]:
    """Split a model judge's issues into evidence-bound issues and plain notes.

    An issue is bound when it cites an evidence key offered for this condition
    and quotes that key's value (at least 60 % of the quoted tokens appear in
    it). A ``rule:<id>`` citation is re-checked by code; since the deterministic
    phase already passed, it becomes a note. Everything else (free text, unknown
    keys, misquoted values) is a note."""
    ev = evidence_index(cond)
    bound: list[dict[str, Any]] = []
    notes: list[str] = []
    for item in raw_issues or []:
        if not isinstance(item, dict):
            text = str(item).strip()
            if text:
                notes.append(text)
            continue
        key = str(item.get("evidence") or "").strip()
        problem = str(item.get("problem") or "").strip()
        field = str(item.get("field") or "").strip()
        summary = f"{field}: {problem}".strip(": ")
        if key.startswith("rule:"):
            notes.append(f"{summary} (cited {key}; deterministic re-check found no violation)")
            continue
        if key not in ev:
            notes.append(f"{summary} (no citable evidence{': ' + key if key else ''})")
            continue
        if _overlap(str(item.get("evidence_value") or ""), ev[key]) < 0.6:
            notes.append(f"{summary} (evidence {key} misquoted)")
            continue
        bound.append({"field": field, "evidence": key, "evidence_value": ev[key], "problem": problem,
                      "fix": str(item.get("fix") or "").strip()})
    return bound, notes


async def run_judge(
    name: str,
    draft: dict[str, Any],
    cond: dict[str, Any],
    llm: StructuredLLM | None,
    *,
    round_no: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run one judge. Returns ``(vote, trace_event)``.

    The deterministic check runs first; when it fails the model is not asked
    (the vote is already decided and tokens are saved). When ``llm`` is None the
    judge is deterministic only. At the model phase only evidence-bound issues
    (see :func:`bind_issues`) count; free-form opinions are returned as
    ``notes`` and never fail or veto a draft."""
    started = time.monotonic()
    det = DETERMINISTIC[name](draft, cond)
    # A deterministic failure is a fact, not an opinion: it always vetoes.
    vote: dict[str, Any] = {
        "judge": name, "round": round_no, "verdict": "pass" if det["ok"] else "fail",
        "veto": not det["ok"],
        "issues": list(det["issues"]), "repair_hints": [], "notes": [], "deterministic": det, "model": None,
    }
    if not det["ok"] or llm is None:
        return vote, make_event(f"judge:{name}", started=started, status="ok",
                                verdict=vote["verdict"], deterministic_only=True)

    reply = await llm.complete_json(
        judge_messages(name, draft, cond), schema=JUDGE_SCHEMA, schema_name="judge_verdict",
        role="judge", temperature=0.0, max_tokens=500,
    )
    raw_verdict = str(reply.data.get("verdict") or "pass").lower()
    bound, notes = bind_issues(list(reply.data.get("issues") or []), draft, cond)
    notes += [str(n).strip() for n in (reply.data.get("notes") or []) if str(n).strip()]
    notes += [str(h).strip() for h in (reply.data.get("repair_hints") or []) if str(h).strip()]
    verdict = "fail" if bound else "pass"
    vote.update({
        "verdict": verdict,
        # The safety judge vetoes on a bound issue only; the other two vote.
        "veto": (name == "safety_dosing" and verdict == "fail"),
        "issues": [f"{b['field']}: {b['problem']} (evidence {b['evidence']}: {b['evidence_value']})" for b in bound],
        "repair_hints": [b["fix"] for b in bound if b["fix"]],
        "notes": notes,
        "model": {"model": reply.model, "verdict": raw_verdict, "bound_issues": len(bound), "notes": len(notes)},
    })
    return vote, make_event(
        f"judge:{name}", started=started, model=reply.model, model_requested=reply.model_requested,
        provider=reply.provider, tokens_in=reply.tokens_in, tokens_out=reply.tokens_out,
        cost_usd=reply.extras.get("cost_usd"), cost_basis=reply.extras.get("cost_basis"),
        verdict=verdict, model_verdict=raw_verdict, bound_issues=len(bound), notes=len(notes),
    )


def aggregate_votes(votes: list[dict[str, Any]], round_no: int) -> dict[str, Any]:
    """Majority of ``pass`` with a safety veto. Only the current round counts."""
    current = [v for v in votes if int(v.get("round", 0)) == round_no]
    passes = sum(1 for v in current if v.get("verdict") == "pass")
    vetoed = any(bool(v.get("veto")) for v in current)
    accepted = (not vetoed) and passes * 2 > max(len(current), 1)
    issues = [f"[{v['judge']}] {i}" for v in current for i in v.get("issues", [])]
    hints = [f"[{v['judge']}] {h}" for v in current for h in v.get("repair_hints", [])]
    notes = [f"[{v['judge']}] {n}" for v in current for n in v.get("notes", [])]
    return {
        "round": round_no, "votes": len(current), "passes": passes, "vetoed": vetoed,
        "decision": "accept" if accepted else "repair", "issues": issues, "repair_hints": hints,
        "notes": notes,
    }

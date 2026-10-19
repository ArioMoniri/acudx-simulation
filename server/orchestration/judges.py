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
from server.orchestration.llm import StructuredLLM
from server.orchestration.trace import make_event

JUDGES: tuple[str, ...] = ("clinical_consistency", "safety_dosing", "pedagogy")

# Absolute physiological bounds shared with the Director (server/orchestration/director.py).
VITAL_BOUNDS: dict[str, tuple[float, float]] = {
    "hr": (20, 250),
    "systolic": (40, 260),
    "diastolic": (20, 160),
    "rr": (0, 60),
    "spo2": (0, 100),
    "tempC": (30.0, 43.0),
}

# Largest plausible single-treatment effect per vital (absolute delta).
EFFECT_CAPS: dict[str, float] = {
    "hr": 40, "systolic": 50, "diastolic": 30, "rr": 15, "spo2": 15, "tempC": 2.5, "pain": 10,
}

# ESI acuity -> acceptable triage vitals envelope (wider than the template bands).
_ESI_ENVELOPE: dict[int, dict[str, tuple[float, float]]] = {
    1: {"hr": (30, 190), "systolic": (50, 220), "spo2": (50, 100), "rr": (4, 50)},
    2: {"hr": (40, 170), "systolic": (70, 220), "spo2": (80, 100), "rr": (8, 40)},
    3: {"hr": (45, 140), "systolic": (85, 200), "spo2": (88, 100), "rr": (10, 32)},
    4: {"hr": (50, 120), "systolic": (90, 180), "spo2": (92, 100), "rr": (10, 26)},
    5: {"hr": (50, 110), "systolic": (95, 170), "spo2": (94, 100), "rr": (10, 24)},
}

JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "fail"]},
        "issues": {"type": "array", "items": {"type": "string"}},
        "repair_hints": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "issues", "repair_hints"],
}


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
    env = _ESI_ENVELOPE.get(esi, _ESI_ENVELOPE[3])
    for key, (lo, hi) in env.items():
        try:
            val = float(triage.get(key))
        except (TypeError, ValueError):
            continue
        if not (lo <= val <= hi):
            issues.append(f"triage {key}={val} implausible for ESI {esi} (expected {lo}-{hi})")
    if not draft.get("exam"):
        issues.append("no exam findings")
    labs = draft.get("labs") or []
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
    return {"ok": not issues, "issues": issues}


DETERMINISTIC = {
    "clinical_consistency": check_clinical_consistency,
    "safety_dosing": check_safety_dosing,
    "pedagogy": check_pedagogy,
}

_JUDGE_FOCUS = {
    "clinical_consistency": (
        "Check that triage vitals, the vitals trajectory, exam findings, labs and imaging "
        "are mutually coherent and typical for the stated condition and ESI acuity. "
        "Fail on contradictions (for example normal exam with critical vitals, labs that "
        "argue against the diagnosis, imaging findings of a different disease)."
    ),
    "safety_dosing": (
        "Check every treatment: is each 'indicated' treatment really first-line for this "
        "condition, is each 'contraindicated' one really harmful here, and are the stated "
        "physiological effects plausible in size and direction? Fail on any unsafe pairing."
    ),
    "pedagogy": (
        "Check the teaching value: does the difficulty match the clues given, are the "
        "red flags elicitable through the hpi items, is the ESI acuity sensible, and are "
        "the Turkish and English texts equivalent? Fail when a learner could not reach the "
        "diagnosis from the material or when the difficulty label is wrong."
    ),
}


def _compact(draft: dict[str, Any]) -> str:
    """Draft without free-text bulk the judge does not need."""
    keep = {k: v for k, v in draft.items() if k not in ("meta",)}
    return json.dumps(keep, ensure_ascii=False, separators=(",", ":"))


def judge_messages(name: str, draft: dict[str, Any], cond: dict[str, Any]) -> list[dict[str, str]]:
    system = (
        f"ROLE: judge:{name}\n"
        "You are one reviewer on a three-judge council for a medical-education case "
        "simulator. Synthetic patients only. You answer with ONE JSON object: "
        '{"verdict": "pass"|"fail", "issues": [..], "repair_hints": [..]}. '
        "Be strict but concrete: every issue must name the field and the fix."
    )
    user = (
        f"FOCUS\n{_JUDGE_FOCUS[name]}\n\n"
        f"CONDITION\n- id: {cond.get('id')}\n- label: {cond.get('label_en')} / {cond.get('label_tr')}\n"
        f"- system: {cond.get('system')}\n- typical ESI: {cond.get('typical_acuity')}\n"
        f"- red flags: {'; '.join(r.get('en', '') for r in cond.get('red_flags', []))}\n\n"
        f"DRAFT\n{_compact(draft)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


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
    judge is deterministic only."""
    started = time.monotonic()
    det = DETERMINISTIC[name](draft, cond)
    # A deterministic failure is a fact, not an opinion: it always vetoes. The
    # model phase only vetoes for the safety judge; the other two are votes.
    vote: dict[str, Any] = {
        "judge": name, "round": round_no, "verdict": "pass" if det["ok"] else "fail",
        "veto": not det["ok"],
        "issues": list(det["issues"]), "repair_hints": [], "deterministic": det, "model": None,
    }
    if not det["ok"] or llm is None:
        return vote, make_event(f"judge:{name}", started=started, status="ok",
                                verdict=vote["verdict"], deterministic_only=True)

    reply = await llm.complete_json(
        judge_messages(name, draft, cond), schema=JUDGE_SCHEMA, schema_name="judge_verdict",
        role="judge", temperature=0.0, max_tokens=600,
    )
    verdict = str(reply.data.get("verdict") or "fail").lower()
    issues = [str(i) for i in (reply.data.get("issues") or []) if str(i).strip()]
    hints = [str(h) for h in (reply.data.get("repair_hints") or []) if str(h).strip()]
    if verdict not in ("pass", "fail"):
        verdict = "fail"
    vote.update({
        "verdict": verdict,
        "veto": (name == "safety_dosing" and verdict == "fail"),
        "issues": issues,
        "repair_hints": hints,
        "model": {"model": reply.model, "verdict": verdict},
    })
    return vote, make_event(
        f"judge:{name}", started=started, model=reply.model, model_requested=reply.model_requested,
        provider=reply.provider, tokens_in=reply.tokens_in, tokens_out=reply.tokens_out,
        verdict=verdict,
    )


def aggregate_votes(votes: list[dict[str, Any]], round_no: int) -> dict[str, Any]:
    """Majority of ``pass`` with a safety veto. Only the current round counts."""
    current = [v for v in votes if int(v.get("round", 0)) == round_no]
    passes = sum(1 for v in current if v.get("verdict") == "pass")
    vetoed = any(bool(v.get("veto")) for v in current)
    accepted = (not vetoed) and passes * 2 > max(len(current), 1)
    issues = [f"[{v['judge']}] {i}" for v in current for i in v.get("issues", [])]
    hints = [f"[{v['judge']}] {h}" for v in current for h in v.get("repair_hints", [])]
    return {
        "round": round_no, "votes": len(current), "passes": passes, "vetoed": vetoed,
        "decision": "accept" if accepted else "repair", "issues": issues, "repair_hints": hints,
    }

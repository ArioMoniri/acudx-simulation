"""Minute-by-minute Director harness (review 06b), as a reusable test fixture.

``docs/review/evidence/director_sim_06b.py`` is the script the reviewers used
to drive ``next_state`` for 120 simulated minutes. This module is the same
harness without the hard-coded path and prints: it builds a template case for a
condition, optionally overrides the arrival vitals with the 06b section 5
values, applies a plan of ``(minute, kind, ref)`` actions and records the
visible state every minute. ``test_director_sim_06b.py`` and
``test_course_acceptance_06b.py`` use it; ``scripts/gen_course_tables.py``
uses :data:`SCENARIOS` to write the shared parity fixture the browser mirror
replays.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Optional

from server import case_generator as CG
from server.condition_catalog import CATALOG
from server.orchestration import director as D

COND = {c["id"]: c for c in CATALOG}
MIN = 60_000

# 06b section 5 arrival values (t0) used by the acceptance tests and parity fixture.
T0: dict[str, dict[str, float]] = {
    "septic_shock": {"hr": 126, "systolic": 80, "diastolic": 44, "rr": 26, "spo2": 93, "tempC": 39.2},
    "sepsis_uncomplicated": {"hr": 112, "systolic": 106, "diastolic": 62, "rr": 23, "spo2": 95, "tempC": 38.9},
    "pneumonia_cap": {"hr": 108, "systolic": 114, "diastolic": 66, "rr": 26, "spo2": 91, "tempC": 39.0},
    "bacterial_meningitis": {"hr": 112, "systolic": 118, "diastolic": 70, "rr": 20, "spo2": 96, "tempC": 39.4},
    "pyelonephritis": {"hr": 104, "systolic": 122, "diastolic": 74, "rr": 18, "spo2": 97, "tempC": 39.0},
    "dka": {"hr": 118, "systolic": 102, "diastolic": 60, "rr": 28, "spo2": 98, "tempC": 36.8},
    "acs_stemi": {"hr": 98, "systolic": 136, "diastolic": 82, "rr": 20, "spo2": 96, "tempC": 36.9},
    "pulmonary_embolism": {"hr": 116, "systolic": 108, "diastolic": 68, "rr": 26, "spo2": 89, "tempC": 37.2},
    "anaphylaxis": {"hr": 128, "systolic": 82, "diastolic": 46, "rr": 28, "spo2": 91, "tempC": 36.9},
    "heart_failure_acute": {"hr": 116, "systolic": 162, "diastolic": 92, "rr": 30, "spo2": 87, "tempC": 36.8},
}


def spec_for(cid: str, seed: int = 7, *, t0: bool = True, **course: Any) -> dict[str, Any]:
    """A template case for ``cid`` (the generator's own deterministic path)."""
    c = COND[cid]
    spec = CG.build_template_spec(c, seed=seed, locale="en", acuity=c["typical_acuity"], difficulty=3,
                                  rng=random.Random(seed))
    spec["meta"] = {"condition_id": cid}
    if t0 and cid in T0:
        spec["triage_vitals"] = dict(T0[cid])
        spec["vitals_trajectory"] = [{"atMs": 0, **T0[cid]}]
    if course:
        spec["course"] = course
    return spec


@dataclass
class Run:
    cid: str
    label: str
    state: D.CaseState
    minutes: dict[int, dict[str, Any]] = field(default_factory=dict)   # minute -> visible
    notes: list[dict[str, Any]] = field(default_factory=list)

    def v(self, minute: int, key: str) -> float:
        return float(self.minutes[minute]["vitals"][key])

    def b(self, minute: int, key: str) -> Any:
        return self.minutes[minute]["bedside"][key]

    def fired(self) -> list[str]:
        return [c for m in sorted(self.minutes) for c in self.minutes[m]["complications_fired"]]

    def events(self) -> list[dict[str, Any]]:
        return [e for m in sorted(self.minutes) for e in self.minutes[m].get("events") or []]


def run(cid: str, plan: list[tuple[int, str, str]] = (), *, label: str = "", until: int = 120, seed: int = 7,
        spec: Optional[dict[str, Any]] = None, **course: Any) -> Run:
    """Drive the Director minute by minute; actions at minute m happen before minute m+1 elapses."""
    sp = spec if spec is not None else spec_for(cid, seed, **course)
    state = D.CaseState.from_spec(sp)
    out = Run(cid=cid, label=label, state=state)
    out.minutes[0] = {"vitals": state.vitals.model_dump(), "bedside": state.snapshot["bedside"],
                      "complications_fired": [], "phase": state.snapshot["phase"], "events": [],
                      "severity": state.snapshot["severity"], "active_diagnoses": state.snapshot["active_diagnoses"]}
    for m in range(0, until):
        fired: list[str] = []
        events: list[dict[str, Any]] = []
        for (mm, kind, ref) in plan:
            if mm == m:
                state, vis, notes = D.next_state(state, D.Action(kind=kind, ref=ref, elapsed_ms=0))
                out.notes.extend(notes)
                fired += vis["complications_fired"]
                events += vis.get("events") or []
        state, vis, notes = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=MIN))
        out.notes.extend(notes)
        vis = dict(vis)
        vis["complications_fired"] = fired + vis["complications_fired"]
        vis["events"] = events + (vis.get("events") or [])
        out.minutes[m + 1] = vis
    out.state = state
    return out


# Scenarios of the reviewers' simulation (06b section 2), minute -> treatment
# code. ``313002`` is the formulary 500 mL bolus; row codes are the case's own.
SCENARIOS: dict[str, list[tuple[str, list[tuple[int, str, str]]]]] = {
    "septic_shock": [("none", []), ("fluids only", [(5, "treatment", "313002")]),
                     ("bundle", [(5, "treatment", "iv_fluids"), (10, "treatment", "abx"), (20, "treatment", "vasopressor")]),
                     ("noradrenaline only", [(5, "treatment", "vasopressor")]),
                     ("10 boluses", [(m, "treatment", "313002") for m in range(2, 40, 4)])],
    "sepsis_uncomplicated": [("none", []), ("paracetamol only", [(5, "treatment", "161")]),
                             ("ceftriaxone", [(10, "treatment", "2193")])],
    "pneumonia_cap": [("none", []), ("abx+o2", [(10, "treatment", "severity_abx"), (10, "treatment", "oxygen")])],
    "bacterial_meningitis": [("none", []), ("ceftriaxone at 50min", [(50, "treatment", "2193")])],
    "pyelonephritis": [("none", []), ("ceftriaxone", [(15, "treatment", "2193")])],
    "dka": [("none", []), ("insulin bolus first", [(5, "treatment", "insulin_bolus_first")]),
            ("fluids then FRIII", [(5, "treatment", "fluids_first"), (20, "treatment", "fixed_insulin")])],
    "acs_stemi": [("none", []), ("aspirin only", [(5, "treatment", "asa_p2y12")]), ("routine o2", [(3, "treatment", "routine_o2")]),
                  ("aspirin+pci", [(5, "treatment", "asa_p2y12"), (8, "treatment", "primary_pci")])],
    "pulmonary_embolism": [("none", []), ("anticoag", [(10, "treatment", "anticoag")]),
                           ("2 L fluid", [(m, "treatment", "313002") for m in (5, 10, 15, 20)])],
    "anaphylaxis": [("none", []), ("IM adrenaline", [(3, "treatment", "3992-im")]), ("fluids only", [(3, "treatment", "313002")])],
    "heart_failure_acute": [("none", []), ("3 L fluid", [(m, "treatment", "313002") for m in (5, 10, 15, 20, 25, 30)]),
                            ("decongestion", [(5, "treatment", "niv_nitrate"), (10, "treatment", "iv_diuretic")])],
}
MARKS: tuple[int, ...] = (0, 10, 30, 60, 90, 120)

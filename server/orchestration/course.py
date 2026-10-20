"""Shared physiology model for the dynamic case course (review 06b).

One deterministic engine turns a condition's course rule plus what the learner
did into the patient's state at any time. The Clinical Director
(``director.py``) is authoritative and calls :func:`simulate` every step; the
browser mirror (``web/src/domain/clinicalCourse.ts``) is a line-by-line port
that reads the same generated tables (``web/src/domain/courseTables.generated.ts``),
and ``server/tests/test_course_parity.py`` plus ``clinicalCourseParity.test.ts``
hold the two to the same numbers.

Model, per minute of simulated time:

* Each active **process** (the presenting condition and any branch it opened)
  has a severity ``s``. Untreated it rises at ``rate_h`` per hour; once every
  disease-modifying treatment group is met (after its lag) it falls at
  ``recover_h`` toward ``floor``; an active-window group (IM adrenaline,
  naloxone, a nebuliser) reverses it only while the dose acts.
* Vitals and bedside signs interpolate from the values at the process start to
  the rule's ``peri`` anchors (severity 1) or ``well`` anchors (severity 0).
* Treatment classes add effect curves (onset, then wane) on top, with context
  rules: oxygen depends on the shunt and the current saturation, fluid
  response wanes with volume and harms in pulmonary oedema, renal failure and
  RV failure, noradrenaline titrates to MAP 68, nitrates and IV adrenaline
  have specific harms.
* Lactate, capillary glucose and potassium integrate from perfusion, insulin,
  dextrose and potassium replacement.
* Branches open new processes (pneumonia to septic shock, PE to obstructive
  shock), with seeded probabilities; allergy exposure opens anaphylaxis.
* Severity 1, MAP below 40 or SpO2 below 60 for 3 minutes, or a seeded VF
  means cardiac arrest: vitals read zero, ``pulse`` is false and the ALS
  algorithm applies until defibrillation (shockable) or adrenaline plus a
  treated cause (non-shockable) restores circulation.

Every function is pure; nothing reads a clock or a global random source.
Rounding is half-up (:func:`rnd`) so Python and TypeScript agree.
"""

from __future__ import annotations

import copy
import math
from typing import Any, Optional

from server import case_fixtures as FX

MIN_MS = 60_000
VITAL_KEYS: tuple[str, ...] = ("hr", "systolic", "diastolic", "rr", "spo2", "tempC")
BED_KEYS: tuple[str, ...] = ("gcs", "crt", "mottle", "urine", "pain")
ANCHOR_KEYS: tuple[str, ...] = VITAL_KEYS + BED_KEYS
ARREST_SUSTAIN_MIN = 3
DEFAULT_BEDSIDE: dict[str, float] = {"gcs": 15, "crt": 2, "mottle": 0, "urine": 50, "pain": 3,
                                     "lactate": 1.2, "cbg": 6.0, "k": 4.2}
# Display bounds (judges.VITAL_BOUNDS for vitals; arrest reads zero separately).
BOUNDS: dict[str, tuple[float, float]] = {
    "hr": (20, 250), "systolic": (40, 260), "diastolic": (20, 160), "rr": (0, 80), "spo2": (0, 100),
    "tempC": (25.0, 43.0), "gcs": (3, 15), "crt": (1, 10), "mottle": (0, 5), "urine": (0, 400), "pain": (0, 10),
}
RULE_KEYS: tuple[str, ...] = (
    "s0", "rate_h", "recover_h", "floor", "lag_min", "arrest_rhythm", "start_arrest", "fluid", "fluid_limit_ml",
    "fluid_persistent", "o2_response", "hypercapnic", "metabolic", "resolve_below", "peri", "well", "bedside0",
    "groups", "targets", "branches", "findings", "harm_rules", "row_classes", "row_harms",
)


# --------------------------------------------------------------------------- #
# Small shared helpers (mirrored exactly in TypeScript)                        #
# --------------------------------------------------------------------------- #
def rnd(x: float, d: int = 0) -> float:
    """Half-up rounding identical to the TypeScript mirror."""
    f = 10 ** d
    return math.floor(x * f + 0.5) / f


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for ch in text.encode("ascii", "replace"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def u01(seed: Any, *parts: str) -> float:
    """Seeded uniform in [0, 1) from the case seed and an id path."""
    return fnv1a("|".join([str(seed), *parts])) / 4294967296.0


def mean_ap(sbp: float, dbp: float) -> float:
    return (sbp + 2.0 * dbp) / 3.0


def curve(dt_min: float, onset: float, wane: Optional[list]) -> float:
    """0..1 effect shape: linear ramp over ``onset``, then linear fade over ``wane``."""
    if dt_min <= 0:
        return 0.0
    up = 1.0 if onset <= 0 else min(1.0, dt_min / onset)
    if wane is None:
        return up
    w0, w1 = float(wane[0]), float(wane[1])
    if dt_min <= w0:
        return up
    if dt_min >= w1:
        return 0.0
    return up * (1.0 - (dt_min - w0) / (w1 - w0))


# --------------------------------------------------------------------------- #
# Rule library                                                                 #
# --------------------------------------------------------------------------- #
def expand_rule(cid: str) -> Optional[dict[str, Any]]:
    """The condition's course rule with its pattern defaults filled in, or None."""
    raw = FX.CONDITION_COURSE.get(cid)
    if raw is None:
        return None
    pat = FX.COURSE_PATTERNS.get(str(raw.get("pattern") or "stable"), FX.COURSE_PATTERNS["stable"])
    rule: dict[str, Any] = {"id": cid, "pattern": raw.get("pattern") or "stable"}
    for key in RULE_KEYS:
        if key in ("peri", "well", "bedside0"):
            merged = dict(pat.get(key) or {})
            merged.update(raw.get(key) or {})
            rule[key] = merged
        elif key in raw:
            rule[key] = copy.deepcopy(raw[key])
        elif key in pat:
            rule[key] = copy.deepcopy(pat[key])
    for key, default in (("groups", []), ("targets", []), ("branches", []), ("findings", []), ("harm_rules", []),
                         ("row_classes", {}), ("row_harms", {}), ("fluid", "neutral"), ("o2_response", 0.4),
                         ("hypercapnic", False), ("metabolic", None), ("resolve_below", None), ("start_arrest", None),
                         ("fluid_limit_ml", None), ("fluid_persistent", False), ("arrest_rhythm", None)):
        rule.setdefault(key, copy.deepcopy(default))
    return rule


def library_for(cid: str) -> dict[str, dict[str, Any]]:
    """The rule and every rule its branches (transitively) can open."""
    out: dict[str, dict[str, Any]] = {}
    todo = [cid, "anaphylaxis_iatrogenic", "hypoglycemia"]
    while todo:
        nxt = todo.pop()
        if nxt in out or not nxt:
            continue
        rule = expand_rule(nxt)
        if rule is None:
            continue
        out[nxt] = rule
        for b in rule["branches"]:
            todo.append(b.get("to") or "")
        for h in rule["row_harms"].values():
            todo.append(h.get("branch") or "")
        if "beta_blocker_killip" in rule["harm_rules"]:
            todo.append("cardiogenic_shock")
        if "lp_before_ct" in rule["harm_rules"]:
            todo.append("cerebral_oedema_dka")
        if rule.get("hypercapnic"):
            todo.append("type2_respiratory_failure")
        if rule.get("fluid") == "rv":
            todo.append("pe_high_risk")
    return out


# --------------------------------------------------------------------------- #
# Engine                                                                       #
# --------------------------------------------------------------------------- #
def _cmp(a: float, op: str, b: float) -> bool:
    if op == ">=":
        return a >= b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    if op == "<":
        return a < b
    if op == "==":
        return a == b
    return a != b


class _Sim:
    def __init__(self, inp: dict[str, Any]) -> None:
        self.inp = inp
        self.lib: dict[str, dict[str, Any]] = inp["library"]
        self.seed = inp.get("seed", 0)
        pat = inp.get("patient") or {}
        self.weight = float(pat.get("weight_kg") or 70)
        self.age = float(pat.get("age") or 45)
        self.flags: list[str] = list(pat.get("flags") or [])
        self.allergies: list[dict[str, Any]] = list(pat.get("allergies") or [])
        self.difficulty = float(pat.get("difficulty") or 3)
        self.curb65 = float(pat.get("curb65") or 0)
        t0 = inp["t0"]
        bed_rule = self.lib[inp["condition_id"]].get("bedside0") or {}
        self.t0 = {k: float(t0[k]) for k in ANCHOR_KEYS if k in t0}
        for k in BED_KEYS:
            self.t0.setdefault(k, float(bed_rule.get(k, DEFAULT_BEDSIDE[k])))
        self.traj = sorted([p for p in inp.get("trajectory") or [] if isinstance(p, dict)], key=lambda p: int(p.get("atMs", 0)))
        self.events = sorted([e for e in inp.get("events") or []], key=lambda e: (int(e.get("at_ms", 0)), int(e.get("seq", 0))))
        self.procs: list[dict[str, Any]] = []
        self.effects: list[dict[str, Any]] = []
        self.harms: list[dict[str, Any]] = []
        self.log: list[dict[str, Any]] = []
        self.findings: list[dict[str, Any]] = []
        self.targets: dict[str, dict[str, Any]] = {}
        self.pending: list[dict[str, Any]] = []      # scheduled branch openings
        self.fluid_ml = 0.0
        self.fluid_first_hour = 0.0
        self.class_doses: dict[str, list[int]] = {}
        self.code_doses: dict[str, list[int]] = {}
        self.coverage: dict[str, set[str]] = {}     # per proc:group -> agent coverage union
        self.met: dict[str, int] = {}               # per proc:group -> minute first met
        self.active_doses: dict[str, list[int]] = {}  # per proc:group -> minutes of doses
        self.pressor_start: Optional[int] = None
        self.insulin_start: Optional[int] = None
        self.dextrose_start: Optional[int] = None
        self.k_replace_start: Optional[int] = None
        self.dextrose_boluses: list[int] = []
        self.k_drops: list[int] = []
        self.dialysis_start: Optional[int] = None
        self.oxygen_on = False
        bed0 = (self.lib[inp["condition_id"]].get("bedside0") or {})
        self.lactate = float(t0.get("lactate", bed0.get("lactate", DEFAULT_BEDSIDE["lactate"])))
        self.cbg = float(t0.get("cbg", bed0.get("cbg", DEFAULT_BEDSIDE["cbg"])))
        self.k = float(t0.get("k", bed0.get("k", DEFAULT_BEDSIDE["k"])))
        self.low_map_run = 0
        self.low_spo2_run = 0
        self.arrest: Optional[dict[str, Any]] = None
        self.arrests: list[dict[str, Any]] = []
        self.transient_rhythm: Optional[tuple[str, int]] = None
        self.lp_done = False
        self.ct_done = False
        self.m = 0
        self._open(inp["condition_id"], 0, None, why_en="presenting condition", why_tr="başvuru tanısı", primary=True)
        rule = self.lib[inp["condition_id"]]
        if rule.get("start_arrest"):
            self._arrest(0, str(rule["start_arrest"]), inp["condition_id"], "presented in cardiac arrest")

    # ---- processes ------------------------------------------------------ #
    def _open(self, rid: str, minute: int, parent: Optional[dict[str, Any]], *, why_en: str, why_tr: str,
              s_start: Optional[float] = None, supersede: bool = False, primary: bool = False,
              say_en: str = "", say_tr: str = "", lactate_min: Optional[float] = None) -> None:
        rule = self.lib.get(rid)
        if rule is None or any(p["id"] == rid for p in self.procs):
            return
        v_start = self.t0.copy() if primary else self._disease(minute)
        s0 = float(rule["s0"] if s_start is None else s_start)
        proc = {"id": rid, "s": s0, "s_start": s0, "start": minute, "v_start": v_start, "superseded": False,
                "resolved": False, "rate_mult": 1.0, "why_en": why_en, "why_tr": why_tr, "primary": primary,
                "trend": 0.0}
        if supersede and parent is not None:
            parent["superseded"] = True
        self.procs.append(proc)
        if lactate_min is not None:
            self.lactate = max(self.lactate, float(lactate_min))
        if not primary:
            self.log.append({"at_ms": minute * MIN_MS, "kind": "branch", "id": rid, "parent": parent["id"] if parent else "",
                             "why_en": why_en, "why_tr": why_tr, "say_en": say_en, "say_tr": say_tr})

    def _live(self) -> list[dict[str, Any]]:
        return [p for p in self.procs if not p["superseded"]]

    def _gkey(self, p: dict[str, Any], g: dict[str, Any]) -> str:
        return f"{p['id']}:{g['id']}"

    def _group_met(self, p: dict[str, Any], g: dict[str, Any], minute: int) -> bool:
        key = self._gkey(p, g)
        if g.get("active_min"):
            return any(minute - d < int(g["active_min"]) and d <= minute for d in self.active_doses.get(key, []))
        at = self.met.get(key)
        return at is not None and at <= minute

    def _unmet(self, p: dict[str, Any], gid: str, minute: int) -> bool:
        rule = self.lib[p["id"]]
        for g in rule["groups"]:
            if g["id"] == gid:
                key = self._gkey(p, g)
                if g.get("active_min"):
                    return not self.active_doses.get(key)
                return not (key in self.met and self.met[key] <= minute)
        return False

    # ---- disease vitals ------------------------------------------------- #
    def _delta(self, p: dict[str, Any]) -> dict[str, float]:
        rule = self.lib[p["id"]]
        s, s_start = p["s"], p["s_start"]
        out: dict[str, float] = {}
        if s >= s_start:
            f = 0.0 if s_start >= 1.0 else (s - s_start) / (1.0 - s_start)
            anchors = rule["peri"]
        else:
            f = 1.0 if s_start <= 0 else (s_start - s) / s_start
            anchors = rule["well"]
        for k, target in anchors.items():
            base = p["v_start"].get(k)
            if base is None:
                continue
            out[k] = f * (float(target) - base)
        return out

    def _disease(self, minute: int) -> dict[str, float]:
        v = self.t0.copy()
        for p in self.procs:
            for k, d in self._delta(p).items():
                v[k] = v.get(k, 0.0) + d
        return v

    # ---- treatment events ---------------------------------------------- #
    def _classes(self, e: dict[str, Any]) -> list[str]:
        rule = self.lib[self.inp["condition_id"]]
        row = str(e.get("row") or "")
        if row and row in rule["row_classes"]:
            return list(rule["row_classes"][row])
        return list(e.get("classes") or [])

    def _vitals_now(self, minute: int) -> dict[str, float]:
        return self._compose(minute * MIN_MS, minute)

    def _add_effect(self, cls: str, minute: int, at_ms: int, scale: float = 1.0, key: str = "") -> None:
        spec = FX.CLASS_EFFECTS.get(cls)
        if spec is None:
            return
        for k, d in spec["effects"].items():
            self.effects.append({"key": k, "delta": float(d) * scale, "at_ms": at_ms, "onset": float(spec["onset"]),
                                 "wane": spec["wane"], "src": key or cls})

    def _custom_effect(self, effects: dict[str, float], at_ms: int, onset: float, wane: Optional[list], src: str) -> None:
        for k, d in effects.items():
            self.effects.append({"key": k, "delta": float(d), "at_ms": at_ms, "onset": float(onset), "wane": wane, "src": src})

    def _harm(self, hid: str, minute: int, en: str, tr: str, src: str = "") -> None:
        self.harms.append({"id": hid, "at_ms": minute * MIN_MS, "why_en": en, "why_tr": tr, "src": src})

    def _apply_event(self, e: dict[str, Any], minute: int) -> None:
        kind = str(e.get("kind") or "treatment")
        code = str(e.get("code") or "")
        row = str(e.get("row") or "")
        at_ms = int(e.get("at_ms", 0))
        primary_rule = self.lib[self.inp["condition_id"]]
        if kind == "order":
            low = f"{code} {e.get('label') or ''}".lower()
            if "ct" in low.split() or "ct head" in low or "ct-head" in low or "head ct" in low or code in ("24725-4", "30799-1"):
                self.ct_done = True
            if "lumbar" in low or low.split()[:1] == ["lp"] or code in ("lp", "lumbar_puncture"):
                if "lp_before_ct" in primary_rule["harm_rules"] and not self.ct_done:
                    v = self._vitals_now(minute)
                    if v.get("gcs", 15) < 13 or "red_flags" in self.flags:
                        self._harm("lp_before_ct", minute, "Lumbar puncture before CT with red flags: herniation risk (IDSA 2004; NICE NG240)",
                                   "Kırmızı bayrak varken BT öncesi lomber ponksiyon: herniasyon riski (IDSA 2004; NICE NG240)", code)
                        self.pending.append({"at": minute + 30, "to": "cerebral_oedema_dka", "parent": self.procs[0]["id"],
                                             "why_en": "Herniation after lumbar puncture with red flags (IDSA 2004)",
                                             "why_tr": "Kırmızı bayraklı hastada LP sonrası herniasyon (IDSA 2004)", "supersede": False, "s_start": 0.5})
            self._satisfy(code, row, [], [], minute)
            return
        if kind == "position":
            if "posture" in primary_rule["harm_rules"] and code in ("sit_up", "stand") and self._vitals_now(minute).get("systolic", 120) < 90:
                self._harm("posture", minute, "Sitting or standing a hypotensive anaphylaxis patient: empty-ventricle arrest (Pumphrey 2003)",
                           "Hipotansif anafilaksi hastasını oturtmak veya ayağa kaldırmak: boş ventrikül arresti (Pumphrey 2003)", code)
                self._arrest(minute, "PEA", self.procs[0]["id"], "posture change in hypotensive anaphylaxis")
            return
        classes = self._classes(e)
        agents = list(e.get("agents") or [])
        appr = str(e.get("appropriateness") or "neutral")
        for c in classes:
            self.class_doses.setdefault(c, []).append(minute)
        self.code_doses.setdefault(code, []).append(minute)
        v = self._vitals_now(minute)
        sbp = v.get("systolic", 120)
        # Allergy exposure (06b section 4.3).
        acls = str(e.get("allergy_class") or "")
        if acls:
            self._allergy(acls, minute, code)
        # Row-specific harm of a contraindicated item (F09).
        rh = primary_rule["row_harms"].get(row) if row else None
        if rh is not None:
            self._row_harm(row, rh, minute, at_ms)
        in_arrest = self.arrest is not None
        handled_vitals = False
        if in_arrest:
            if "rhythm" in classes and self.arrest["rhythm"] in ("VF", "pVT"):
                self.arrest["shock_at"] = minute
            if "adrenaline_iv" in classes:
                self.arrest["adrenaline_at"] = minute
        if "fluids" in classes and not in_arrest:
            self._fluids(e, minute, at_ms)
            handled_vitals = True
        if "oxygen" in classes and "niv" not in classes and not in_arrest:
            self.oxygen_on = True
            spo2 = v.get("spo2", 97)
            resp = float(primary_rule.get("o2_response") or 0.4)
            for p in self._live():
                resp = min(resp, float(self.lib[p["id"]].get("o2_response") or resp))
            gain = 0.0 if spo2 >= 94 else min(15.0, (98.0 - spo2) * resp)
            if gain > 0:
                self._custom_effect({"spo2": gain}, at_ms, 5, None, code)
            if any(self.lib[p["id"]].get("hypercapnic") for p in self._live()) and row not in ("controlled_o2",) \
                    and spo2 + gain > 92:
                self._harm("o2_hypercapnia", minute, "High-flow oxygen to SpO2 above 92 % with hypercapnic risk (BTS 2017; Austin 2010)",
                           "Hiperkapni riskinde SpO2 %92 üzerine yüksek akım oksijen (BTS 2017; Austin 2010)", code)
                self.pending.append({"at": minute + 30, "to": "type2_respiratory_failure", "parent": self.procs[0]["id"],
                                     "why_en": "Oxygen-induced hypercapnia: type 2 respiratory failure (BTS 2017)",
                                     "why_tr": "Oksijene bağlı hiperkapni: tip 2 solunum yetmezliği (BTS 2017)", "supersede": False})
            handled_vitals = True
        if "niv" in classes and not in_arrest:
            self.oxygen_on = True
            self._add_effect("niv", minute, at_ms, key=code)
            handled_vitals = True
        if "vasopressor" in classes and not in_arrest and self.pressor_start is None:
            self.pressor_start = minute
            handled_vitals = True
        if "adrenaline_iv" in classes and not in_arrest:
            ana = any(self.lib[p["id"]].get("pattern") == "upper_airway" for p in self._live())
            im_doses = len(self.class_doses.get("adrenaline_im", []))
            if ana and im_doses < 2:
                self._harm("iv_adrenaline_bolus", minute, "IV adrenaline bolus outside cardiac arrest: severe hypertension and VT (RCUK 2021)",
                           "Kardiyak arrest dışında İ.V. adrenalin bolusu: ağır hipertansiyon ve VT (RCUK 2021)", code)
                self._add_effect("adrenaline_iv_bolus", minute, at_ms, key=code)
                self.transient_rhythm = ("VT", minute + 5)
            elif self.pressor_start is None:
                self.pressor_start = minute
            handled_vitals = True
        if "adrenaline_im" in classes and not in_arrest:
            self._add_effect("adrenaline_im", minute, at_ms, key=code)
            handled_vitals = True
        if "nitrate" in classes and not in_arrest:
            if sbp < 90 or "rv_infarct" in self.flags or "pde5" in self.flags:
                self._harm("gtn_hypotension", minute, "Nitrate with SBP below 90, RV infarct or a PDE-5 inhibitor: profound hypotension (ESC 2023)",
                           "SKB 90 altı, RV infarktı veya PDE-5 inhibitörüyle nitrat: derin hipotansiyon (ESC 2023)", code)
                self._add_effect("nitrate_harm", minute, at_ms, key=code)
            elif sbp > 110:
                self._add_effect("nitrate", minute, at_ms, key=code)
                if primary_rule.get("fluid") == "pulmonary_oedema":
                    self._custom_effect({"rr": -4, "spo2": 2}, at_ms, 5, None, code)
            handled_vitals = True
        if "opioid" in classes or "benzodiazepine" in classes:
            seizing = any(self.lib[p["id"]].get("pattern") == "seizure" for p in self._live())
            depressed = v.get("rr", 16) < 12 or v.get("gcs", 15) < 13
            sedative_on_board = any(minute - d <= 60 and d < minute for c in ("opioid", "benzodiazepine") for d in self.class_doses.get(c, []))
            if not seizing and (depressed or sedative_on_board):
                self._harm("opioid_hypoventilation", minute, "Opioid or benzodiazepine in a patient already hypoventilating or sedated (AHA 2020)",
                           "Zaten hipoventile veya sedatize hastada opioid ya da benzodiazepin (AHA 2020)", code)
                self._add_effect("opioid_harm", minute, at_ms, key=code)
            elif "opioid" in classes:
                self._add_effect("opioid", minute, at_ms, key=code)
            handled_vitals = True
        if "analgesia" in classes and "opioid" not in classes:
            self._add_effect("analgesia", minute, at_ms, key=code)
        if "naloxone" in classes:
            opioid = any(self.lib[p["id"]].get("pattern") == "tox_resp_depression" for p in self._live()) or bool(self.class_doses.get("opioid"))
            if opioid:
                self._add_effect("naloxone", minute, at_ms, key=code)
        if "antipyretic" in classes and v.get("tempC", 37) > 38.0:
            self._add_effect("antipyretic", minute, at_ms, key=code)
        if "bronchodilator" in classes:
            self._add_effect("bronchodilator", minute, at_ms, key=code)
        if "loop_diuretic" in classes:
            self._add_effect("loop_diuretic", minute, at_ms, key=code)
        if "beta_blocker_iv" in classes:
            self._add_effect("beta_blocker_iv", minute, at_ms, key=code)
            killip = v.get("spo2", 97) < 94 or sbp < 100 or "killip2" in self.flags
            if "beta_blocker_killip" in primary_rule["harm_rules"] and killip:
                self._harm("beta_blocker_killip", minute, "IV beta-blocker with Killip II or more or SBP below 100: cardiogenic shock (COMMIT 2005)",
                           "Killip II ve üzeri veya SKB 100 altında İ.V. beta bloker: kardiyojenik şok (COMMIT 2005)", code)
                self.pending.append({"at": minute + 20, "to": "cardiogenic_shock", "parent": self.procs[0]["id"],
                                     "why_en": "IV beta-blocker in pump failure (COMMIT 2005)", "why_tr": "Pompa yetmezliğinde İ.V. beta bloker (COMMIT 2005)",
                                     "supersede": True})
        if "glucagon" in classes and "beta_blocked" in self.flags:
            self._add_effect("glucagon", minute, at_ms, key=code)
        if "thrombolytic" in classes:
            high_risk = any(p["id"] == "pe_high_risk" for p in self._live())
            if high_risk:
                self._add_effect("thrombolytic_pe", minute, at_ms, key=code)
            elif "thrombolysis_intermediate_pe" in primary_rule["harm_rules"]:
                self._harm("thrombolysis_intermediate_pe", minute, "Systemic thrombolysis in intermediate-risk PE without decompensation: bleeding risk, no benefit (PEITHO 2014)",
                           "Dekompanse olmayan orta riskli PE'de sistemik tromboliz: kanama riski, yarar yok (PEITHO 2014)", code)
            if "lysis_bp_gate" in primary_rule["harm_rules"] and (sbp > 185 or v.get("diastolic", 80) > 110):
                self._harm("lysis_bp_gate", minute, "Thrombolysis with BP above 185/110: intracranial haemorrhage risk (AHA/ASA 2019)",
                           "KB 185/110 üzerindeyken tromboliz: intrakraniyal kanama riski (AHA/ASA 2019)", code)
        # Metabolic drivers.
        if "insulin_frii" in classes and self.insulin_start is None:
            self.insulin_start = minute
            if "insulin_low_k" in primary_rule["harm_rules"] and self.k < 3.3:
                self._harm("insulin_low_k", minute, "Insulin started with K below 3.3 mmol/L: hypokalaemia and arrhythmia (ADA 2024; JBDS 2023)",
                           "K 3.3 mmol/L altında insülin başlandı: hipokalemi ve aritmi (ADA 2024; JBDS 2023)", code)
        if "insulin_bolus" in classes:
            self.k_drops.append(minute)
            if self.lib[self.inp["condition_id"]].get("metabolic") == "hypo":
                self.cbg = max(1.0, self.cbg - 1.0)
        if "potassium" in classes and self.k_replace_start is None:
            self.k_replace_start = minute
        if "dextrose" in classes:
            if primary_rule.get("metabolic") == "dka":
                if self.dextrose_start is None:
                    self.dextrose_start = minute
            else:
                self.dextrose_boluses.append(minute)
        if "glucagon" in classes and primary_rule.get("metabolic") == "hypo":
            self.dextrose_boluses.append(minute)
        if "insulin_dextrose" in classes:
            self.k_drops.append(minute)
        if row in ("urgent_dialysis", "dialysis_referral") and self.dialysis_start is None:
            self.dialysis_start = minute + 60
        if appr == "contraindicated" and rh is None and not handled_vitals:
            self._harm("contraindicated_treatment", minute, "Contraindicated for this patient; no specific acute physiological effect (process error)",
                       "Bu hasta için kontrendike; özgül akut fizyolojik etkisi yok (süreç hatası)", code)
        self._satisfy(code, row, classes, agents, minute)

    def _row_harm(self, row: str, rh: dict[str, Any], minute: int, at_ms: int) -> None:
        self._harm("row_harm:" + row, minute, rh["en"], rh["tr"], row)
        if rh.get("effects"):
            self._custom_effect(rh["effects"], at_ms, float(rh.get("onset_min") or 5), None, row)
        if float(rh.get("rate_mult") or 1.0) != 1.0:
            for p in self._live():
                p["rate_mult"] = max(p["rate_mult"], float(rh["rate_mult"]))
        fires = u01(self.seed, "rowharm", row) < float(rh.get("p") or 1.0)
        if rh.get("arrest") and fires:
            self._arrest(minute + 2, str(rh["arrest"]), self.procs[0]["id"], rh["en"])
        if rh.get("branch") and fires:
            self.pending.append({"at": minute + 20, "to": rh["branch"], "parent": self.procs[0]["id"],
                                 "why_en": rh["en"], "why_tr": rh["tr"], "supersede": False})

    def _allergy(self, acls: str, minute: int, code: str) -> None:
        for a in self.allergies:
            if str(a.get("agent_class")) != acls:
                continue
            reaction = str(a.get("reaction") or "rash")
            if acls in ("penicillin",) and reaction == "anaphylaxis":
                self._harm("allergen_exposure", minute, "Penicillin given to a patient with penicillin anaphylaxis (NICE CG183)",
                           "Penisilin anafilaksisi olan hastaya penisilin verildi (NICE CG183)", code)
                self.pending.append({"at": minute + 5, "to": "anaphylaxis_iatrogenic", "parent": self.procs[0]["id"],
                                     "why_en": "Iatrogenic anaphylaxis after a known allergen (Pumphrey 2000: median 5 min to arrest in fatal IV reactions)",
                                     "why_tr": "Bilinen alerjen sonrası iyatrojenik anafilaksi (Pumphrey 2000)", "supersede": False,
                                     "say_en": "My throat is closing... I can't breathe.", "say_tr": "Boğazım kapanıyor... nefes alamıyorum."})
            elif acls == "penicillin":
                self._harm("allergen_exposure", minute, "Penicillin given with a rash-only history: urticarial rash (NICE CG183)",
                           "Yalnızca döküntü öyküsüyle penisilin: ürtikeryal döküntü (NICE CG183)", code)
                self.findings.append({"id": "drug_rash", "at_ms": (minute + 45) * MIN_MS, "exam": "skin",
                                      "en": "A new urticarial rash over the trunk; no wheeze or swelling.",
                                      "tr": "Gövdede yeni ürtikeryal döküntü; hırıltı veya şişlik yok."})
            elif acls == "nsaid":
                self._harm("allergen_exposure", minute, "Aspirin in aspirin/NSAID-exacerbated respiratory disease: bronchospasm (ESC 2023)",
                           "Aspirin/NSAİİ ile alevlenen solunum hastalığında aspirin: bronkospazm (ESC 2023)", code)
                self._custom_effect({"rr": 6, "spo2": -4}, minute * MIN_MS, 15, None, code)
                self.findings.append({"id": "drug_wheeze", "at_ms": (minute + 15) * MIN_MS, "exam": "respiratory",
                                      "en": "New widespread expiratory wheeze after aspirin.", "tr": "Aspirinden sonra yeni yaygın ekspiratuvar hışıltı."})
            elif acls == "opioid":
                self.findings.append({"id": "pruritus", "at_ms": (minute + 15) * MIN_MS, "exam": "skin",
                                      "en": "Itching and flushing along the arm (opioid pseudo-allergy).",
                                      "tr": "Kol boyunca kaşıntı ve kızarıklık (opioid psödoalerjisi)."})
            elif acls == "contrast":
                self.findings.append({"id": "contrast_hives", "at_ms": (minute + 10) * MIN_MS, "exam": "skin",
                                      "en": "Hives after contrast.", "tr": "Kontrast sonrası kurdeşen."})

    def _fluids(self, e: dict[str, Any], minute: int, at_ms: int) -> None:
        vol = float(e.get("volume_ml") or 500)
        scale = vol / 500.0
        before = self.fluid_ml
        self.fluid_ml += vol
        if minute < 60:
            self.fluid_first_hour += vol
        mode = "neutral"
        limit = None
        persistent = False
        for p in self._live():
            r = self.lib[p["id"]]
            fm = str(r.get("fluid") or "neutral")
            if fm == "pulmonary_oedema" or (fm == "renal" and mode != "pulmonary_oedema") or \
                    (fm == "rv" and mode not in ("pulmonary_oedema", "renal")) or \
                    (fm in ("responsive", "haemorrhage") and mode == "neutral"):
                mode = fm
            if r.get("fluid_limit_ml"):
                limit = float(r["fluid_limit_ml"])
            persistent = persistent or bool(r.get("fluid_persistent"))
        if "heart_failure" in self.flags:
            mode = "pulmonary_oedema"
        if "renal_failure" in self.flags and mode != "pulmonary_oedema":
            mode = "renal"
        spec = FX.CLASS_EFFECTS["fluids"]
        wane = None if persistent else spec["wane"]
        if mode == "pulmonary_oedema":
            self._harm("fluid_overload", minute, "Fluid bolus in pulmonary oedema: SpO2 falls, crackles rise (ESC 2021 HF)",
                       "Pulmoner ödemde sıvı bolusu: SpO2 düşer, raller artar (ESC 2021 KY)", str(e.get("code")))
            self._custom_effect({"spo2": -3 * scale, "rr": 4 * scale}, at_ms, 15, None, "fluid_overload")
            self.findings.append({"id": f"crackles_{len(self.harms)}", "at_ms": (minute + 15) * MIN_MS, "exam": "respiratory",
                                  "en": "Crackles have extended further up both lung fields after the fluid.",
                                  "tr": "Sıvıdan sonra raller her iki akciğerde daha yukarı uzandı."})
            return
        if mode == "renal":
            if self.fluid_ml > 1000:
                self._harm("fluid_overload", minute, "Fluid beyond 1 L in oligo-anuric renal failure: overload (NICE CG174)",
                           "Oligo-anürik böbrek yetmezliğinde 1 L üzeri sıvı: yüklenme (NICE CG174)", str(e.get("code")))
                self._custom_effect({"spo2": -2 * scale, "rr": 3 * scale}, at_ms, 15, None, "fluid_overload")
                return
            factor = 0.5
        elif mode == "rv":
            if self.fluid_ml > 500:
                self._harm("fluid_rv", minute, "More than 500 mL fluid in RV failure: RV overdistension lowers BP (ESC 2019 PE)",
                           "Sağ ventrikül yetmezliğinde 500 mL üzeri sıvı: RV distansiyonu KB'yi düşürür (ESC 2019 PE)", str(e.get("code")))
                self._custom_effect({"systolic": -12 * scale, "diastolic": -6 * scale}, at_ms, 20, None, "fluid_rv")
                return
            factor = 0.5
        elif mode in ("responsive", "haemorrhage"):
            cap = limit if limit is not None else 30.0 * self.weight
            if before >= cap:
                self._harm("fluid_nonresponse", minute, "Further fluid after about 30 mL/kg without response: oedema, not pressure (SSC 2021; Glassford 2014)",
                           "Yanıtsız yaklaşık 30 mL/kg sonrası ek sıvı: basınç değil ödem (SSC 2021; Glassford 2014)", str(e.get("code")))
                self._custom_effect({"spo2": -2 * scale}, at_ms, 15, None, "fluid_nonresponse")
                return
            factor = 1.0 if before < 1000 else max(0.0, (cap - before) / max(1.0, cap - 1000.0))
        else:
            factor = 0.5
        for k, d in spec["effects"].items():
            self.effects.append({"key": k, "delta": float(d) * factor * scale, "at_ms": at_ms, "onset": float(spec["onset"]),
                                 "wane": wane, "src": "fluids"})

    def _satisfy(self, code: str, row: str, classes: list[str], agents: list[str], minute: int) -> None:
        for p in self._live():
            rule = self.lib[p["id"]]
            for g in rule["groups"]:
                key = self._gkey(p, g)
                hit_row = bool(row) and row in g["codes"]
                hit_code = code in g["codes"]
                hit_cls = any(c in g["classes"] for c in classes)
                if not (hit_row or hit_code or hit_cls):
                    continue
                needs = g.get("needs") or []
                if needs:
                    # A named formulary agent is checked for spectrum; an abstract
                    # case row (no agent coverage known) is taken as adequate.
                    if agents:
                        cov = self.coverage.setdefault(key, set())
                        cov.update(agents)
                        if not all(n in cov for n in needs):
                            self.log.append({"at_ms": minute * MIN_MS, "kind": "spectrum", "id": g["id"], "parent": p["id"],
                                             "why_en": f"{code} does not cover {', '.join(n for n in needs if n not in cov)} for this condition",
                                             "why_tr": f"{code} bu durum için {', '.join(n for n in needs if n not in cov)} kapsamıyor"})
                            continue
                    elif not (hit_row or hit_code):
                        continue
                if g.get("active_min"):
                    self.active_doses.setdefault(key, []).append(minute)
                if key not in self.met:
                    self.met[key] = minute

    # ---- arrest --------------------------------------------------------- #
    def _arrest(self, minute: int, rhythm: str, cause: str, why: str) -> None:
        if self.arrest is not None:
            return
        self.arrest = {"rhythm": rhythm, "at": minute, "cause": cause, "why": why, "shock_at": None, "adrenaline_at": None}
        self.arrests.append({"rhythm": rhythm, "at_ms": minute * MIN_MS, "cause": cause, "why": why})
        self.log.append({"at_ms": minute * MIN_MS, "kind": "arrest", "id": rhythm, "parent": cause,
                         "why_en": f"Cardiac arrest ({rhythm}): {why}. Start ALS: CPR 30:2, attach the defibrillator, "
                                   f"{'shock' if rhythm in ('VF', 'pVT') else 'adrenaline 1 mg IV as soon as possible'} (ERC 2021)",
                         "why_tr": f"Kardiyak arrest ({rhythm}): {why}. İYD başlatın: KPR 30:2, defibrilatörü bağlayın (ERC 2021)"})

    def _try_rosc(self, minute: int) -> None:
        a = self.arrest
        if a is None:
            return
        rosc = False
        if a["rhythm"] in ("VF", "pVT") and a["shock_at"] is not None and minute >= a["shock_at"] + 1:
            rosc = True
        elif a["rhythm"] in ("PEA", "asystole") and a["adrenaline_at"] is not None:
            cause = next((p for p in self.procs if p["id"] == a["cause"]), None)
            treated = True
            if cause is not None:
                rule = self.lib[cause["id"]]
                for g in rule["groups"]:
                    if g.get("modifies") and not (self._gkey(cause, g) in self.met or self.active_doses.get(self._gkey(cause, g))):
                        treated = False
            if treated and minute >= a["adrenaline_at"] + 2:
                rosc = True
        if rosc:
            for p in self._live():
                if p["s"] >= 0.9:
                    p["s"] = 0.9
            self.log.append({"at_ms": minute * MIN_MS, "kind": "rosc", "id": a["rhythm"], "parent": a["cause"],
                             "why_en": "Return of spontaneous circulation; post-resuscitation care (ERC 2021)",
                             "why_tr": "Spontan dolaşımın geri dönüşü; resüsitasyon sonrası bakım (ERC 2021)"})
            self.arrest = None
            self.low_map_run = 0
            self.low_spo2_run = 0

    # ---- per-minute step ------------------------------------------------ #
    def _step(self, minute: int) -> None:
        for p in self._live():
            rule = self.lib[p["id"]]
            p["trend"] = 0.0
            if self.arrest is not None:
                continue
            groups = [g for g in rule["groups"] if g.get("modifies")]
            perm = [g for g in groups if not g.get("active_min")]
            act = [g for g in groups if g.get("active_min")]
            lag_default = int(rule.get("lag_min") or 0)
            perm_met = bool(perm) and all(
                self._gkey(p, g) in self.met and minute - self.met[self._gkey(p, g)] >= int(g["lag_min"] if g.get("lag_min") is not None else lag_default)
                for g in perm)
            active = [g for g in act if self._group_met(p, g, minute)]
            recover = None
            if perm_met:
                recover = float(rule["recover_h"])
                for g in perm:
                    if g.get("recover_h") is not None:
                        recover = float(g["recover_h"])
            elif active:
                recover = max(float(g["recover_h"] if g.get("recover_h") is not None else rule["recover_h"]) for g in active)
            elif p["resolved"]:
                recover = float(rule["recover_h"])
            if recover is not None:
                ds = -recover / 60.0
                floor = float(rule["floor"])
                if p["s"] > floor:
                    p["s"] = max(floor, p["s"] + ds)
                else:
                    ds = 0.0
            else:
                ds = float(rule["rate_h"]) * p["rate_mult"] / 60.0
                p["s"] = min(1.0, p["s"] + ds)
            p["trend"] = ds
            rb = rule.get("resolve_below")
            if rb is not None and p["s"] <= float(rb):
                p["resolved"] = True
        self._labs(minute)

    def _labs(self, minute: int) -> None:
        rule = self.lib[self.inp["condition_id"]]
        lr = FX.LAB_RATES
        v = self._compose(minute * MIN_MS, minute)
        perfused = self.arrest is None and mean_ap(v["systolic"], v["diastolic"]) >= 65 and v.get("crt", 2) <= 3
        smax = max([p["s"] for p in self._live() if self.lib[p["id"]].get("arrest_rhythm") or self.lib[p["id"]].get("pattern") in
                    ("distributive_shock", "haemorrhagic_shock", "obstructive_shock", "cardiogenic", "upper_airway")] or [0.0])
        if not perfused:
            plateau = 1.0 + 9.0 * smax
            self.lactate += (plateau - self.lactate) * (1.0 - math.exp(-1.0 / float(lr["lactate_plateau_tau_min"])))
        else:
            hl = float(lr["lactate_half_life_min"])
            untreated = any(self._unmet(p, g["id"], minute) for p in self._live() for g in self.lib[p["id"]]["groups"] if g.get("modifies"))
            if untreated:
                hl *= 2.0
            self.lactate = 1.0 + (self.lactate - 1.0) * 2.0 ** (-1.0 / hl)
        met = rule.get("metabolic")
        if met == "dka":
            if self.insulin_start is not None and minute > self.insulin_start:
                rate = float(lr["dka_cbg_insulin_h"])
                if self.dextrose_start is not None and minute > self.dextrose_start:
                    rate += float(lr["dextrose_offset_h"])
                dt = minute - self.insulin_start
                krate = float(lr["dka_k_insulin_h"] if dt <= 240 else lr["dka_k_insulin_late_h"])
                if self.k_replace_start is not None and minute > self.k_replace_start:
                    krate += float(lr["k_replacement_h"])
                self.k += krate / 60.0
            elif self.fluid_ml > 0:
                rate = float(lr["dka_cbg_fluids_h"])
            else:
                rate = float(lr["dka_cbg_untreated_h"])
            self.cbg += rate / 60.0
        elif met == "hypo":
            self.cbg += float(lr["hypo_cbg_untreated_h"] if not self.dextrose_boluses else lr["post_dextrose_h"]) / 60.0
        elif met == "hyperk":
            krate = float(lr["hyperk_untreated_h"])
            if self.dialysis_start is not None and minute > self.dialysis_start:
                krate += float(lr["dialysis_k_h"])
            self.k += krate / 60.0
        for d in self.dextrose_boluses:
            if d < minute <= d + int(lr["dextrose_bolus_min"]):
                self.cbg += float(lr["dextrose_bolus_mmol"]) / float(lr["dextrose_bolus_min"])
        for d in self.k_drops:
            if d < minute <= d + int(lr["insulin_dextrose_min"]):
                self.k += float(lr["insulin_dextrose_k"]) / float(lr["insulin_dextrose_min"])
        self.cbg = clamp(self.cbg, 1.0, 60.0)
        self.k = clamp(self.k, 1.5, 9.5)

    # ---- composition ---------------------------------------------------- #
    def _traj_offset(self, t_ms: int) -> dict[str, float]:
        """Authored trajectory drift, used only by the fallback rule of a condition with no course rule."""
        pts = self.traj
        if len(pts) < 2:
            return {}
        out: dict[str, float] = {}
        for k in VITAL_KEYS:
            series = [(int(p.get("atMs", 0)), float(p[k])) for p in pts if p.get(k) is not None]
            if len(series) < 2:
                continue
            val = series[-1][1]
            if t_ms <= series[0][0]:
                val = series[0][1]
            else:
                for (ta, va), (tb, vb) in zip(series, series[1:]):
                    if ta <= t_ms <= tb:
                        val = va if tb == ta else va + (t_ms - ta) / (tb - ta) * (vb - va)
                        break
            out[k] = val - series[0][1]
        return out

    def _compose(self, t_ms: int, minute: int) -> dict[str, float]:
        v = self._disease(minute)
        for k, d in self._traj_offset(t_ms).items():
            v[k] = v.get(k, 0.0) + d
        for e in self.effects:
            if e["at_ms"] > t_ms:
                continue
            dt = (t_ms - e["at_ms"]) / MIN_MS
            v[e["key"]] = v.get(e["key"], 0.0) + e["delta"] * curve(dt, e["onset"], e["wane"])
        if self.pressor_start is not None and minute >= self.pressor_start and self.arrest is None:
            smax = max([p["s"] for p in self._live()] or [0.0])
            cap = 40.0 if smax < 0.9 else max(0.0, 40.0 * (1.0 - smax) / 0.1)
            need = max(0.0, 68.0 - mean_ap(v["systolic"], v["diastolic"]))
            ramp = min(1.0, (t_ms - self.pressor_start * MIN_MS) / (10.0 * MIN_MS))
            d = min(need / 0.7333, cap) * max(0.0, ramp)
            v["systolic"] += d
            v["diastolic"] += 0.6 * d
            v["hr"] += 3.0 * max(0.0, ramp)
            v["crt"] = v.get("crt", 2.0) - 2.5 * max(0.0, ramp)
        g = v.get("gcs", 15.0)
        if self.cbg < 3.5:
            g = min(g, 15.0 - (3.5 - self.cbg) * 4.0)
        if mean_ap(v["systolic"], v["diastolic"]) < 45:
            g -= 2.0
        if v["spo2"] < 80:
            g -= 3.0
        v["gcs"] = g
        return v

    # ---- triggers ------------------------------------------------------- #
    def _state_value(self, key: str, p: dict[str, Any], v: dict[str, float], minute: int) -> float:
        if key == "s":
            return p["s"]
        if key == "map":
            return mean_ap(v["systolic"], v["diastolic"])
        if key == "sbp":
            return v["systolic"]
        if key in v:
            return v[key]
        if key == "t_min":
            return float(minute)
        if key == "pt_min":
            return float(minute - p["start"])
        if key == "lactate":
            return self.lactate
        if key == "cbg":
            return self.cbg
        if key == "k":
            return self.k
        if key == "fluid_ml":
            return self.fluid_ml
        if key == "fluid_ml_60":
            return self.fluid_first_hour
        if key == "pressor_on":
            return 1.0 if self.pressor_start is not None else 0.0
        if key == "age":
            return self.age
        if key == "curb65":
            return self.curb65
        if key == "difficulty":
            return self.difficulty
        if key.startswith("unmet:"):
            return 1.0 if self._unmet(p, key[6:], minute) else 0.0
        if key.startswith("flag:"):
            return 1.0 if key[5:] in self.flags else 0.0
        return 0.0

    def _conds(self, conds: list[dict[str, Any]], p: dict[str, Any], v: dict[str, float], minute: int) -> bool:
        return all(_cmp(self._state_value(c["k"], p, v, minute), c["op"], float(c["v"])) for c in conds)

    def _triggers(self, minute: int) -> None:
        v = self._compose(minute * MIN_MS, minute)
        for item in [x for x in self.pending if x["at"] <= minute]:
            self.pending.remove(item)
            parent = next((p for p in self.procs if p["id"] == item["parent"]), None)
            self._open(item["to"], minute, parent, why_en=item["why_en"], why_tr=item["why_tr"],
                       s_start=item.get("s_start"), supersede=bool(item.get("supersede")),
                       say_en=item.get("say_en", ""), say_tr=item.get("say_tr", ""))
        for p in list(self._live()):
            rule = self.lib[p["id"]]
            for b in rule["branches"]:
                tag = f"{p['id']}>{b['id']}"
                if any(x.get("tag") == tag for x in self.log):
                    continue
                if float(b.get("p") or 1.0) < 1.0 and u01(self.seed, p["id"], b["id"]) >= float(b["p"]):
                    continue
                if b.get("window"):
                    lo, hi = float(b["window"][0]), float(b["window"][1])
                    at = lo + u01(self.seed, p["id"], b["id"], "t") * (hi - lo)
                    if minute - p["start"] < at:
                        continue
                if not self._conds(b.get("when") or [], p, v, minute):
                    continue
                self.log.append({"at_ms": minute * MIN_MS, "kind": "trigger", "id": b["id"], "tag": tag, "parent": p["id"],
                                 "why_en": b["why_en"], "why_tr": b["why_tr"]})
                if b.get("arrest"):
                    self._arrest(minute, str(b["arrest"]), p["id"], b["why_en"])
                elif b.get("to"):
                    self._open(b["to"], minute, p, why_en=b["why_en"], why_tr=b["why_tr"], s_start=b.get("s_start"),
                               supersede=bool(b.get("supersede")), say_en=b.get("say_en", ""), say_tr=b.get("say_tr", ""),
                               lactate_min=b.get("lactate_min"))
        # Arrest from severity or sustained hypotension or hypoxia.
        if self.arrest is None:
            for p in self._live():
                rule = self.lib[p["id"]]
                if rule.get("arrest_rhythm") and p["s"] >= 1.0:
                    self._arrest(minute, str(rule["arrest_rhythm"]), p["id"], f"{p['id']} reached peri-arrest severity untreated")
                    break
        if self.arrest is None:
            self.low_map_run = self.low_map_run + 1 if mean_ap(v["systolic"], v["diastolic"]) < 40 else 0
            self.low_spo2_run = self.low_spo2_run + 1 if v["spo2"] < 60 else 0
            if self.low_map_run >= ARREST_SUSTAIN_MIN:
                self._arrest(minute, "PEA", self._live()[0]["id"], "MAP below 40 mmHg for 3 minutes")
            elif self.low_spo2_run >= ARREST_SUSTAIN_MIN:
                self._arrest(minute, "PEA", self._live()[0]["id"], "SpO2 below 60 % for 3 minutes")
        if self.arrest is None and self.k < 2.5 and self.lib[self.inp["condition_id"]].get("metabolic") == "dka":
            self._arrest(minute, "VF", self.procs[0]["id"], "potassium below 2.5 mmol/L")
        self._try_rosc(minute)
        # Hypokalaemia and hypoglycaemia on insulin (06b section 4.2).
        if self.insulin_start is not None:
            if self.k < 3.0 and not any(h["id"] == "hypokalaemic_arrhythmia_risk" for h in self.harms):
                self._harm("hypokalaemic_arrhythmia_risk", minute, "K below 3.0 mmol/L on insulin: ectopy, U waves and VT hazard (JBDS 2023; ADA 2024)",
                           "İnsülin altında K 3.0 mmol/L altı: ektopi, U dalgası ve VT riski (JBDS 2023; ADA 2024)")
            if self.cbg < 4.0 and not any(h["id"] == "hypoglycaemia" for h in self.harms):
                self._harm("hypoglycaemia", minute, "CBG below 4 mmol/L on insulin without 10 % glucose (JBDS 2023)",
                           "%10 glukoz olmadan insülin altında KKŞ 4 mmol/L altı (JBDS 2023)")
                self._open("hypoglycemia", minute, self.procs[0], why_en="Iatrogenic hypoglycaemia on fixed-rate insulin without 10 % glucose (JBDS 2023)",
                           why_tr="%10 glukoz olmadan sabit hızlı insülinle iyatrojenik hipoglisemi (JBDS 2023)", s_start=0.4,
                           say_en="I feel shaky and sweaty.", say_tr="Titriyorum ve terliyorum.")
        # Targets (guideline time, separate from physiology; 06b F06).
        for p in self._live():
            rule = self.lib[p["id"]]
            for t in rule["targets"]:
                key = f"{p['id']}:{t['id']}"
                g = next((x for x in rule["groups"] if x["id"] == t["group"]), None)
                if g is None:
                    continue
                gk = self._gkey(p, g)
                st = self.targets.get(key)
                if st is None:
                    st = {"id": t["id"], "process": p["id"], "group": t["group"], "status": "pending",
                          "due_ms": (p["start"] + int(t.get("by_min") or 0)) * MIN_MS, "met_ms": None,
                          "source": t["source"], "basis": t.get("basis", "guideline"), "label_en": g.get("label_en", ""),
                          "label_tr": g.get("label_tr", ""), "codes": list(g["codes"]), "classes": list(g["classes"])}
                    self.targets[key] = st
                if st["status"] != "pending":
                    continue
                if t.get("type") == "repeat":
                    doses = self.active_doses.get(gk, [])
                    if not doses:
                        st["due_ms"] = None
                        continue
                    first = doses[0]
                    check = first + int(t["after_min"])
                    st["due_ms"] = (check + int(t["grace_min"])) * MIN_MS
                    if len(doses) >= 2:
                        st["status"] = "met"
                        st["met_ms"] = doses[1] * MIN_MS
                    elif minute >= check + int(t["grace_min"]):
                        vc = self._compose(check * MIN_MS, check)
                        st["status"] = "breached" if self._conds(t.get("when") or [], p, vc, check) else "not_needed"
                    continue
                met_at = self.met.get(gk)
                if met_at is None and self.active_doses.get(gk):
                    met_at = self.active_doses[gk][0]
                if met_at is not None and met_at * MIN_MS <= st["due_ms"]:
                    st["status"] = "met"
                    st["met_ms"] = met_at * MIN_MS
                elif minute * MIN_MS >= st["due_ms"] and met_at is None:
                    st["status"] = "breached"
        # Findings that appear over time.
        for p in self._live():
            rule = self.lib[p["id"]]
            for f in rule["findings"]:
                fid = f"{p['id']}:{f['id']}"
                if any(x["id"] == fid for x in self.findings):
                    continue
                if self._conds(f.get("when") or [], p, v, minute):
                    self.findings.append({"id": fid, "at_ms": minute * MIN_MS, "exam": f["exam"], "en": f["en"], "tr": f["tr"]})

    # ---- run ------------------------------------------------------------ #
    def run(self, t_ms: int) -> dict[str, Any]:
        last = max(0, int(t_ms)) // MIN_MS
        evs = [e for e in self.events if int(e.get("at_ms", 0)) <= t_ms]
        idx = 0
        for minute in range(0, last + 1):
            self.m = minute
            if minute > 0:
                self._step(minute)
            while idx < len(evs) and int(evs[idx].get("at_ms", 0)) // MIN_MS <= minute:
                self._apply_event(evs[idx], minute)
                idx += 1
            self._triggers(minute)
        return self._snapshot(int(t_ms), last)

    def _snapshot(self, t_ms: int, minute: int) -> dict[str, Any]:
        v = self._compose(t_ms, minute)
        rhythm = "sinus"
        pulse = True
        if self.arrest is not None:
            rhythm = self.arrest["rhythm"]
            pulse = False
        elif self.transient_rhythm is not None and minute <= self.transient_rhythm[1]:
            rhythm = self.transient_rhythm[0]
        elif self.k < 3.0:
            rhythm = "sinus with ectopy (U waves)"
        elif self.k >= 6.5:
            rhythm = "sinus with peaked T waves"
        elif v["hr"] > 100:
            rhythm = "sinus tachycardia"
        elif v["hr"] < 50:
            rhythm = "bradycardia"
        vitals: dict[str, float] = {}
        for k in VITAL_KEYS:
            lo, hi = BOUNDS[k]
            vitals[k] = clamp(v.get(k, self.t0.get(k, 0.0)), lo, hi)
        if vitals["diastolic"] >= vitals["systolic"]:
            vitals["diastolic"] = max(BOUNDS["diastolic"][0], vitals["systolic"] - 20)
        for k in ("hr", "systolic", "diastolic", "rr", "spo2"):
            vitals[k] = rnd(vitals[k])
        vitals["tempC"] = rnd(vitals["tempC"], 1)
        bed: dict[str, Any] = {}
        for k in BED_KEYS:
            lo, hi = BOUNDS[k]
            bed[k] = rnd(clamp(v.get(k, DEFAULT_BEDSIDE[k]), lo, hi))
        if self.arrest is not None:
            for k in ("hr", "systolic", "diastolic", "rr", "spo2"):
                vitals[k] = 0.0
            bed["gcs"] = 3.0
            bed["urine"] = 0.0
        smax = max([p["s"] for p in self._live()] or [0.0])
        map_ = rnd(mean_ap(vitals["systolic"], vitals["diastolic"]))
        trend = sum(p["trend"] for p in self._live())
        if self.arrest is not None:
            phase = "arrest"
        elif smax >= 0.85 or map_ < 50 or vitals["spo2"] < 80:
            phase = "peri_arrest"
        elif trend > 0 and smax > 0.0:
            phase = "deteriorating"
        elif trend < 0:
            phase = "improving"
        else:
            phase = "stable"
        gcs = bed["gcs"]
        avpu = "A" if gcs >= 15 else "C" if gcs >= 13 else "V" if gcs >= 9 else "P" if gcs >= 6 else "U"
        airway = "patent"
        if any(self.lib[p["id"]].get("pattern") == "upper_airway" for p in self._live()):
            s_air = max(p["s"] for p in self._live() if self.lib[p["id"]].get("pattern") == "upper_airway")
            airway = "obstructed" if s_air >= 0.9 else "stridor" if s_air >= 0.7 else "patent"
        if gcs <= 8 and airway == "patent" and self.arrest is None:
            airway = "at risk"
        mottle = bed["mottle"]
        skin = "mottled" if mottle >= 2 else "cool" if bed["crt"] >= 4 else "warm"
        bedside = {
            "map": map_, "gcs": gcs, "avpu": avpu, "cbg": rnd(self.cbg, 1), "k": rnd(self.k, 1), "lactate": rnd(self.lactate, 1),
            "crt_s": bed["crt"], "mottling": mottle, "skin": skin, "urine_ml_h": bed["urine"], "pain": bed["pain"],
            "airway": airway, "rhythm": rhythm, "pulse": pulse, "fluid_in_ml": rnd(self.fluid_ml),
            "o2": self.oxygen_on, "news2": news2(vitals, avpu, self.oxygen_on, "hypercapnic_target" in self.flags) if pulse else 20,
        }
        return {
            "t_ms": t_ms, "vitals": vitals, "bedside": bedside, "severity": rnd(smax, 3), "phase": phase,
            "processes": [{"id": p["id"], "s": rnd(p["s"], 3), "onset_ms": p["start"] * MIN_MS, "superseded": p["superseded"],
                           "resolved": p["resolved"], "primary": p["primary"], "why_en": p["why_en"], "why_tr": p["why_tr"]}
                          for p in self.procs],
            "active_diagnoses": [p["id"] for p in self._live() if self.lib[p["id"]].get("pattern") != "stable" or p["primary"]
                                 or p["id"] == "refractory_shock"],
            "harms": self.harms, "targets": list(self.targets.values()), "findings": [f for f in self.findings if f["at_ms"] <= t_ms],
            "log": self.log, "arrests": self.arrests, "pressor_on": self.pressor_start is not None,
        }


def news2(v: dict[str, float], avpu: str, on_o2: bool, scale2: bool = False) -> int:
    """NEWS2 aggregate score (RCP 2017 chart; scale 1 for SpO2 unless told otherwise)."""
    s = 0
    rr = v["rr"]
    s += 3 if rr <= 8 else 1 if rr <= 11 else 0 if rr <= 20 else 2 if rr <= 24 else 3
    sp = v["spo2"]
    if scale2:
        s += 3 if sp <= 83 else 2 if sp <= 85 else 1 if sp <= 87 else 0
    else:
        s += 3 if sp <= 91 else 2 if sp <= 93 else 1 if sp <= 95 else 0
    s += 2 if on_o2 else 0
    sbp = v["systolic"]
    s += 3 if sbp <= 90 else 2 if sbp <= 100 else 1 if sbp <= 110 else 0 if sbp <= 219 else 3
    hr = v["hr"]
    s += 3 if hr <= 40 else 1 if hr <= 50 else 0 if hr <= 90 else 1 if hr <= 110 else 2 if hr <= 130 else 3
    s += 0 if avpu == "A" else 3
    t = v["tempC"]
    s += 3 if t <= 35.0 else 1 if t <= 36.0 else 0 if t <= 38.0 else 1 if t <= 39.0 else 2
    return s


def simulate(inp: dict[str, Any], t_ms: int) -> dict[str, Any]:
    """The patient's state at ``t_ms`` from the course input (pure)."""
    return _Sim(inp).run(t_ms)


__all__ = ["ANCHOR_KEYS", "MIN_MS", "VITAL_KEYS", "curve", "expand_rule", "fnv1a", "library_for", "news2", "rnd",
           "simulate", "u01"]

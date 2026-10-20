"""Parametric lab kinetics: pure functions of (condition, severity, time, treatments).

Every function here is deterministic, side-effect free and returns values clamped
to the physiologic bounds in :data:`BOUNDS`. Time is in hours since symptom
onset (``t_h``); treatments are :class:`Treatment` records whose ``t_h`` is the
hour they were started. ``severity`` is a 0..1 scalar the engine derives from
the case (ESI acuity, authored lab magnitude).

Each constant cites its source in the docstring of the function that uses it.
Where a source gives a range, the midpoint is used and the range is quoted.
Nothing here is a clinical decision tool; it exists to make simulated results
move the way textbooks and the cited studies say they move. Education only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

# --------------------------------------------------------------------------- #
# Treatment vocabulary (the engine maps free-text case treatments onto these). #
# --------------------------------------------------------------------------- #
TREATMENT_CODES: tuple[str, ...] = (
    "insulin_infusion",      # fixed-rate IV insulin (DKA); amount = units/kg/h
    "insulin_dextrose",      # hyperkalaemia bolus (10 U + glucose)
    "dextrose",              # 10 % glucose infusion alongside FRIII (DKA)
    "iv_fluids",             # crystalloid; amount = litres
    "prbc",                  # packed red cells; amount = units
    "oxygen",                # amount = FiO2 (0.21..1.0); device in ``note``
    "antibiotics",
    "vasopressor",
    "reperfusion_pci",
    "thrombolysis",
    "nac",                   # acetylcysteine (does not change the level)
    "calcium_gluconate",
    "salbutamol",            # nebulised, hyperkalaemia
    "potassium_replacement",
    "dialysis",
    "source_control",        # surgery / drainage / obstruction relief
)


@dataclass(frozen=True)
class Treatment:
    """One administered treatment. ``t_h`` = hours after symptom onset."""

    code: str
    t_h: float
    amount: Optional[float] = None
    note: str = ""


# --------------------------------------------------------------------------- #
# Physiologic bounds (clamp targets).                                          #
# Lower/upper values are survivable extremes reported in the literature, not   #
# reference limits. Sources: Kost GJ, JAMA 1990;263:704 (critical limits,     #
# doi 10.1001/jama.1990.03440050098042) for the inner envelope; the outer      #
# extremes are the widest values the cited kinetics papers report (troponin:   #
# PMC10432699; lactate: Vincent 2016 PMID 27520452; paracetamol: MHRA 2012).   #
# --------------------------------------------------------------------------- #
BOUNDS: dict[str, tuple[float, float]] = {
    "hs_ctnt_ng_L": (1.0, 100000.0),
    "hs_ctni_ng_L": (1.0, 200000.0),
    "lactate_mmol_L": (0.3, 30.0),
    "crp_mg_L": (0.1, 600.0),
    "pct_ng_mL": (0.01, 1000.0),
    "creatinine_mg_dL": (0.2, 30.0),
    "glucose_mmol_L": (0.5, 120.0),
    "ketones_mmol_L": (0.0, 20.0),
    "hco3_mmol_L": (2.0, 50.0),
    "ph": (6.70, 7.80),
    "pco2_mmHg": (8.0, 150.0),
    "pao2_mmHg": (20.0, 680.0),
    "spo2_pct": (40.0, 100.0),
    "potassium_mmol_L": (1.5, 9.5),
    "hemoglobin_g_dL": (2.0, 25.0),
    "paracetamol_mg_L": (0.0, 1500.0),
}


def clamp(value: float, key: str) -> float:
    lo, hi = BOUNDS[key]
    return min(hi, max(lo, float(value)))


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, float(x)))


def _first(treatments: Iterable[Treatment], *codes: str) -> Optional[Treatment]:
    best: Optional[Treatment] = None
    for tr in treatments:
        if tr.code in codes and (best is None or tr.t_h < best.t_h):
            best = tr
    return best


def _gamma_rise(t: float, peak_h: float, k: float) -> float:
    """Unit-peak gamma-shaped rise: 0 at t=0, 1 at ``peak_h``."""
    if t <= 0.0:
        return 0.0
    x = t / peak_h
    return (x ** k) * math.exp(k * (1.0 - x))


# --------------------------------------------------------------------------- #
# Troponin                                                                     #
# --------------------------------------------------------------------------- #
TROPONIN_PARAMS: dict[str, dict[str, float | dict[str, float]]] = {
    "hs_ctnt": {
        "peak_h": 11.2, "fast_half_life_h": 15.0, "slow_half_life_h": 280.0,
        "fast_fraction": 0.35, "rise_k": 2.5, "log10_peak_min": 2.0, "log10_peak_span": 2.7,
        "url_ng_L": {"female": 9.0, "male": 16.0, "any": 14.0},
    },
    "hs_ctni": {
        "peak_h": 8.3, "fast_half_life_h": 15.0, "slow_half_life_h": 40.0,
        "fast_fraction": 0.35, "rise_k": 2.5, "log10_peak_min": 2.0, "log10_peak_span": 2.7,
        "url_ng_L": {"female": 16.0, "male": 34.0, "any": 26.0},
    },
}

# ESC 2020 NSTE-ACS Table 5, 0 h/1 h algorithm, ng/L (verified 2026-10-19 at
# https://academic.oup.com/eurheartj/article/42/14/1289/5898842, doi 10.1093/eurheartj/ehaa575).
ESC_0H1H_CUTOFFS: dict[str, dict[str, float]] = {
    "hs_ctnt": {"very_low": 5, "low": 12, "no_delta": 3, "high": 52, "delta": 5},
    "hs_ctni": {"very_low": 4, "low": 5, "no_delta": 2, "high": 64, "delta": 6},
}


def troponin(
    assay: str,
    t_h: float,
    severity: float,
    treatments: Sequence[Treatment] = (),
    sex: str = "any",
) -> float:
    """High-sensitivity troponin (ng/L) at ``t_h`` hours after symptom onset.

    Shape: gamma-shaped rise to a peak, then biexponential decay.

    Constants and sources
    - Time to peak: hs-cTnI 8.3 h (IQR 6.3 to 15.7), hs-cTnT 11.2 h (IQR 6.3 to
      30.9) after presentation; 50 percent of peak reached at 44.6 h (cTnI) vs
      115.9 h (cTnT): van Doorn WPTM et al., J Appl Lab Med 2020;5:239,
      doi 10.1373/jalm.2019.029785 (verified 2026-10-19). The slow half-lives
      (40 h cTnI, 280 h cTnT) with a 0.35 fast fraction reproduce those 50 percent
      times within the reported IQR.
    - Fast-phase half-life 15 h: midpoint of the 12.4 to 17.3 h range reported
      across hs assays after STEMI (Mair J et al., PMC10432699, 2023).
    - Reperfusion washout: earlier and higher peak after PCI or lysis (same
      source); modelled as peak time = max(reperfusion + 2 h, 4 h), peak x1.3.
    - 99th percentile URLs: hs-cTnT Elecsys 14 ng/L overall, 9 female / 16 male;
      hs-cTnI Architect 26 overall, 16 female / 34 male (Apple FS, Collinson PO,
      IFCC Task Force, Clin Chem 2012;58:54, doi 10.1373/clinchem.2011.165795;
      Gore MO et al., J Am Coll Cardiol 2014;63:1441, doi 10.1016/j.jacc.2013.12.032).
    - Peak magnitude: 10 ** (2.0 + 2.7 * severity) ng/L, i.e. 100 ng/L for a tiny
      NSTEMI to 50,000 ng/L for a large STEMI, spanning the medians reported by
      the STEMI kinetics study above. ``severity`` 0..1.
    - Rise exponent 2.5 gives about 40 percent of peak at 3 h, matching the
      observation that about a third of patients cross rule-out thresholds only
      around 3 h after onset (research doc 15, section 5).
    """
    p = TROPONIN_PARAMS[assay]
    url = p["url_ng_L"]  # type: ignore[assignment]
    baseline = 0.4 * float(url.get(sex, url["any"]))  # type: ignore[union-attr]
    sev = _clamp01(severity)
    if sev <= 0.0 or t_h <= 0.0:
        return clamp(baseline, f"{assay}_ng_L")
    peak_h = float(p["peak_h"])
    peak = 10 ** (float(p["log10_peak_min"]) + float(p["log10_peak_span"]) * sev)
    rep = _first(treatments, "reperfusion_pci", "thrombolysis")
    if rep is not None and rep.t_h < peak_h:
        peak_h = max(rep.t_h + 2.0, 4.0)
        peak *= 1.3
    if t_h <= peak_h:
        shape = _gamma_rise(t_h, peak_h, float(p["rise_k"]))
    else:
        dt = t_h - peak_h
        a = float(p["fast_fraction"])
        shape = a * 2 ** (-dt / float(p["fast_half_life_h"])) + (1 - a) * 2 ** (-dt / float(p["slow_half_life_h"]))
    return clamp(baseline + peak * shape, f"{assay}_ng_L")


def troponin_rule(assay: str, value_0h: float, value_1h: Optional[float] = None) -> str:
    """ESC 2020 0 h/1 h classification: ``rule_out`` / ``rule_in`` / ``observe``.

    Cut-offs from :data:`ESC_0H1H_CUTOFFS` (ESC 2020 NSTE-ACS, Table 5). With a
    single value only the very-low rule-out and high rule-in branches apply.
    """
    c = ESC_0H1H_CUTOFFS[assay]
    if value_0h >= c["high"]:
        return "rule_in"
    if value_1h is None:
        return "rule_out" if value_0h < c["very_low"] else "observe"
    delta = value_1h - value_0h
    if value_0h < c["very_low"] or (value_0h < c["low"] and delta < c["no_delta"]):
        return "rule_out"
    if delta >= c["delta"]:
        return "rule_in"
    return "observe"


# --------------------------------------------------------------------------- #
# Lactate                                                                      #
# --------------------------------------------------------------------------- #
def lactate(
    t_h: float,
    severity: float,
    treatments: Sequence[Treatment] = (),
    hepatic_impairment: bool = False,
    initial: Optional[float] = None,
) -> float:
    """Blood lactate (mmol/L) in hypoperfusion, with first-order clearance after
    resuscitation.

    Constants and sources
    - Untreated shock: lactate rises toward a plateau of 1.0 + 9 * severity
      mmol/L with a 4 h time constant (plateau span chosen so severity 1 reaches
      the ~10 mmol/L seen in refractory septic shock cohorts summarised by
      Vincent JL et al., Crit Care 2016;20:257, PMID 27520452, verified
      2026-10-19, which also supports sampling every 1 to 2 h).
    - Clearance after perfusion is restored (first fluids or vasopressor):
      first-order, half-life 2.0 h, so one hour clears ~30 percent, comfortably
      above the 10 percent per 6 h clearance associated with survival (Nguyen HB
      et al., Crit Care Med 2004;32:1637, doi 10.1097/01.CCM.0000132904.35713.A7)
      and the 10 to 20 percent per 2 h target in research doc 15 section 5.
    - Hepatic impairment doubles the half-life (4.0 h): the liver clears most
      lactate (Vincent 2016).
    - Floor 1.0 mmol/L (upper half of the 0.5 to 2.2 mmol/L reference interval,
      MedlinePlus 003507, reviewed 2025-05-19).
    """
    sev = _clamp01(severity)
    plateau = 1.0 + 9.0 * sev
    start = 1.0 if initial is None else float(initial)
    rest = _first(treatments, "iv_fluids", "vasopressor", "prbc", "source_control")
    t_restore = rest.t_h if rest is not None else None
    t_shock_end = t_h if t_restore is None else min(t_h, t_restore)
    value = plateau + (start - plateau) * math.exp(-max(t_shock_end, 0.0) / 4.0) if sev > 0 else start
    if t_restore is not None and t_h > t_restore:
        half_life = 4.0 if hepatic_impairment else 2.0
        value = 1.0 + (value - 1.0) * 2 ** (-(t_h - t_restore) / half_life)
    return clamp(value, "lactate_mmol_L")


# --------------------------------------------------------------------------- #
# Inflammatory markers                                                         #
# --------------------------------------------------------------------------- #
def crp(t_h: float, severity: float, treatments: Sequence[Treatment] = ()) -> float:
    """C-reactive protein (mg/L).

    Constants and sources (Pepys MB, Hirschfield GM, J Clin Invest 2003;111:1805,
    doi 10.1172/JCI18921, verified 2026-10-19): rises above 5 mg/L by about 6 h,
    peaks around 48 h, plasma half-life about 19 h, healthy median 0.8 mg/L.
    Peak magnitude 20 + 280 * severity mg/L spans a mild viral illness to
    bacterial sepsis. Once antibiotics or source control start, the stimulus
    is assumed to end 24 h later and CRP then decays with the 19 h half-life.
    """
    sev = _clamp01(severity)
    baseline = 0.8
    if sev <= 0.0:
        return clamp(baseline, "crp_mg_L")
    peak = 20.0 + 280.0 * sev
    lag = 6.0
    stop = _first(treatments, "antibiotics", "source_control")
    t_end = None if stop is None else stop.t_h + 24.0
    t_eff = t_h if t_end is None else min(t_h, t_end)
    value = baseline + peak * _gamma_rise(max(t_eff - lag, 0.0), 48.0 - lag, 3.0)
    if t_end is not None and t_h > t_end:
        value = baseline + (value - baseline) * 2 ** (-(t_h - t_end) / 19.0)
    return clamp(value, "crp_mg_L")


def procalcitonin(t_h: float, severity: float, treatments: Sequence[Treatment] = (), bacterial: bool = True) -> float:
    """Procalcitonin (ng/mL).

    Constants and sources: PCT rises within 2 to 4 h, peaks at 12 to 24 h and
    has a half-life of about 24 h (Schuetz P et al., BMC Med 2011;9:107,
    doi 10.1186/1741-7015-9-107; Meisner M, Ann Lab Med 2014;34:263,
    doi 10.3343/alm.2014.34.4.263). Sepsis thresholds 0.5 and 2 ng/mL (same
    sources). Peak 0.3 + 30 * severity ng/mL for bacterial infection; viral
    illness stays near 0.1 ng/mL. After antibiotics the level falls with the
    24 h half-life from 12 h after the first dose.
    """
    baseline = 0.05
    sev = _clamp01(severity)
    if sev <= 0.0 or not bacterial:
        return clamp(baseline + 0.05 * sev, "pct_ng_mL")
    peak = 0.3 + 30.0 * sev
    stop = _first(treatments, "antibiotics", "source_control")
    t_end = None if stop is None else stop.t_h + 12.0
    t_eff = t_h if t_end is None else min(t_h, t_end)
    value = baseline + peak * _gamma_rise(max(t_eff - 2.0, 0.0), 16.0, 2.0)
    if t_end is not None and t_h > t_end:
        value = baseline + (value - baseline) * 2 ** (-(t_h - t_end) / 24.0)
    return clamp(value, "pct_ng_mL")


# --------------------------------------------------------------------------- #
# Creatinine in AKI                                                            #
# --------------------------------------------------------------------------- #
def creatinine_aki(
    t_h: float,
    baseline_mg_dl: float,
    severity: float,
    treatments: Sequence[Treatment] = (),
) -> float:
    """Serum creatinine (mg/dL) after an abrupt GFR fall.

    Model: single-compartment approach to the new steady state
    SCr_ss = baseline / (1 - f), f = 0.95 * severity (fraction of GFR lost),
    time constant 9 h / (1 - f).

    Constants and sources
    - With a 90 percent fall in clearance the absolute rise at 24 h is 1.8 to
      2.0 mg/dL regardless of baseline (Waikar SS, Bonventre JV, J Am Soc
      Nephrol 2009;20:672, doi 10.1681/ASN.2008070669, verified 2026-10-19). The
      9 h base time constant reproduces 2.1 mg/dL at 24 h for f = 0.9.
    - Recovery after fluids, source control or obstruction relief: decay toward
      baseline with a 24 h half-life (the KDIGO 2012 AKI guideline, Kidney Int
      Suppl 2012;2:1, defines recovery windows in days; the half-life is a
      modelling choice inside that window).
    - Dialysis: a session removes about 60 percent (KDOQI 2015 haemodialysis
      adequacy target spKt/V 1.2 implies a urea reduction ratio near 65 percent;
      Am J Kidney Dis 2015;66:884, doi 10.1053/j.ajkd.2015.07.015).
    """
    sev = _clamp01(severity)
    base = max(0.2, float(baseline_mg_dl))
    if sev <= 0.0 or t_h <= 0.0:
        return clamp(base, "creatinine_mg_dL")
    f = 0.95 * sev
    ss = base / (1.0 - f)
    tau = 9.0 / (1.0 - f)
    recovery = _first(treatments, "iv_fluids", "source_control")
    t_inj_end = t_h if recovery is None else min(t_h, recovery.t_h)
    value = ss - (ss - base) * math.exp(-max(t_inj_end, 0.0) / tau)
    if recovery is not None and t_h > recovery.t_h:
        value = base + (value - base) * 2 ** (-(t_h - recovery.t_h) / 24.0)
    for tr in treatments:
        if tr.code == "dialysis" and t_h >= tr.t_h:
            value = base + (value - base) * 0.4
    return clamp(value, "creatinine_mg_dL")


def kdigo_stage(baseline_mg_dl: float, current_mg_dl: float) -> int:
    """KDIGO 2012 AKI stage from creatinine alone (0 = no AKI).

    Stage 1: 1.5 to 1.9 x baseline or rise of at least 0.3 mg/dL; stage 2:
    2.0 to 2.9 x; stage 3: 3.0 x or at least 4.0 mg/dL. Source: KDIGO Clinical
    Practice Guideline for Acute Kidney Injury, Kidney Int Suppl 2012;2:1, Table 2
    (PDF verified 2026-10-19,
    https://kdigo.org/wp-content/uploads/2016/10/KDIGO-2012-AKI-Guideline-English.pdf).
    """
    ratio = current_mg_dl / max(baseline_mg_dl, 0.2)
    if ratio >= 3.0 or current_mg_dl >= 4.0:
        return 3
    if ratio >= 2.0:
        return 2
    if ratio >= 1.5 or (current_mg_dl - baseline_mg_dl) >= 0.3:
        return 1
    return 0


# --------------------------------------------------------------------------- #
# Diabetic ketoacidosis                                                        #
# --------------------------------------------------------------------------- #
def henderson_hasselbalch_ph(hco3_mmol_l: float, pco2_mmhg: float) -> float:
    """pH = 6.1 + log10(HCO3 / (0.03 x pCO2)) (standard bicarbonate buffer equation)."""
    return clamp(6.1 + math.log10(max(hco3_mmol_l, 0.5) / (0.03 * max(pco2_mmhg, 1.0))), "ph")


def winters_pco2(hco3_mmol_l: float) -> float:
    """Expected pCO2 (mmHg) in compensated metabolic acidosis: 1.5 x HCO3 + 8
    (Albert MS, Dell RB, Winters RW, Ann Intern Med 1967;66:312,
    doi 10.7326/0003-4819-66-2-312)."""
    return clamp(1.5 * hco3_mmol_l + 8.0, "pco2_mmHg")


def dka_state(
    t_h: float,
    severity: float,
    treatments: Sequence[Treatment] = (),
) -> dict[str, float]:
    """Glucose, ketones, bicarbonate, pH, pCO2 and potassium in DKA.

    Constants and sources (JBDS-IP, The Management of Diabetic Ketoacidosis in
    Adults, revised March 2023, PDF verified 2026-10-19,
    https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf):
    - Diagnosis: ketones above 3.0 mmol/L, glucose above 11.0 mmol/L, bicarbonate
      below 15.0 mmol/L and/or venous pH below 7.3.
    - Targets on a fixed-rate insulin infusion (0.1 units/kg/h): ketones fall at
      least 0.5 mmol/L/h, bicarbonate rises 3.0 mmol/L/h, glucose falls 3.0
      mmol/L/h; potassium kept 4.0 to 5.5 mmol/L; resolution at ketones below
      0.6 and pH above 7.3.
    - Presentation values scale with severity: glucose 15 + 20 s, ketones 3 + 5 s,
      bicarbonate 18 - 14 s (floor 4), potassium 4.5 + 1.5 s (whole-body
      depletion with extracellular shift).
    - Untreated drift: glucose +0.5, ketones +0.2, bicarbonate -0.5 mmol/L/h.
    - Fluids without insulin lower glucose about 1 mmol/L/h by dilution and
      renal loss (JBDS, section on fluids); ketones do not fall without insulin.
    - pCO2 from Winter's formula; pH from Henderson-Hasselbalch; potassium falls
      0.5 mmol/L/h for the first 4 h of insulin then 0.2 mmol/L/h unless
      replaced (JBDS potassium table).
    """
    sev = _clamp01(severity)
    glucose = 15.0 + 20.0 * sev
    ketones = 3.0 + 5.0 * sev
    hco3 = max(4.0, 18.0 - 14.0 * sev)
    potassium = 4.5 + 1.5 * sev
    ins = _first(treatments, "insulin_infusion")
    fl = _first(treatments, "iv_fluids")
    t_ins = None if ins is None else ins.t_h
    t_fl = None if fl is None else fl.t_h
    # Phase 1: untreated drift up to first intervention.
    t_first = min(x for x in (t_ins, t_fl, t_h) if x is not None)
    t_first = max(0.0, min(t_first, t_h))
    glucose += 0.5 * t_first
    ketones += 0.2 * t_first
    hco3 -= 0.5 * t_first
    # Phase 2: fluids only (before insulin).
    if t_fl is not None and t_h > t_fl:
        t_fluid_only_end = t_h if t_ins is None else min(t_h, max(t_ins, t_fl))
        glucose -= 1.0 * max(0.0, t_fluid_only_end - t_fl)
    # Phase 3: insulin running.
    if t_ins is not None and t_h > t_ins:
        dt = t_h - t_ins
        glucose -= 3.0 * dt
        ketones -= 0.5 * dt
        hco3 += 3.0 * dt
        potassium -= 0.5 * min(dt, 4.0) + 0.2 * max(0.0, dt - 4.0)
        krep = _first(treatments, "potassium_replacement")
        if krep is not None and t_h >= krep.t_h:
            potassium = max(potassium, 4.0)
    # Review 06b F18: no floor under insulin. Without 10 % glucose the fall
    # continues into hypoglycaemia; once 10 % glucose runs (JBDS: add it when
    # CBG is below 14 mmol/L) it offsets the insulin and holds about 6 mmol/L
    # (design midpoint of the JBDS 6 to 10 mmol/L target).
    dex = _first(treatments, "dextrose")
    if dex is not None and t_ins is not None and t_h > dex.t_h:
        glucose = max(glucose, 6.0)
    glucose = clamp(glucose if t_ins is not None else max(glucose, 5.0), "glucose_mmol_L")
    ketones = clamp(max(ketones, 0.3), "ketones_mmol_L")
    hco3 = clamp(min(hco3, 24.0), "hco3_mmol_L")
    pco2 = winters_pco2(hco3) if hco3 < 22.0 else 40.0
    ph = henderson_hasselbalch_ph(hco3, pco2)
    return {
        "glucose_mmol_L": round(glucose, 1),
        "ketones_mmol_L": round(ketones, 1),
        "hco3_mmol_L": round(hco3, 1),
        "pco2_mmHg": round(pco2, 0),
        "ph": round(ph, 2),
        "potassium_mmol_L": round(clamp(potassium, "potassium_mmol_L"), 1),
        "resolved": float(ketones < 0.6 and ph > 7.3),
    }


# --------------------------------------------------------------------------- #
# Potassium shifts                                                             #
# --------------------------------------------------------------------------- #
def _pulse(dt: float, onset_h: float, hold_h: float, end_h: float) -> float:
    """Unit effect that ramps up over ``onset_h``, holds, and fades by ``end_h``."""
    if dt <= 0.0:
        return 0.0
    if dt < onset_h:
        return dt / onset_h
    if dt < hold_h:
        return 1.0
    if dt < end_h:
        return max(0.0, 1.0 - (dt - hold_h) / (end_h - hold_h))
    return 0.0


def potassium(
    t_h: float,
    initial: float,
    treatments: Sequence[Treatment] = (),
    ph_change: float = 0.0,
    ongoing_release: float = 0.0,
) -> float:
    """Serum potassium (mmol/L) after shifting therapies.

    Constants and sources (UK Kidney Association, Clinical Practice Guideline:
    Treatment of Acute Hyperkalaemia in Adults, 2023,
    https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults):
    - Insulin-glucose (10 units soluble insulin with glucose) lowers K by 0.65 to
      1.0 mmol/L, onset within 15 min, peak at 60 min, lasting 4 to 6 h: modelled
      as -0.8 mmol/L with a 1 h ramp, hold to 2 h, gone by 6 h.
    - Nebulised salbutamol 10 to 20 mg lowers K by 0.5 to 1.0 mmol/L, onset 15 to
      30 min, lasting about 2 h: modelled as -0.7 with a 0.5 h ramp, hold to 1 h,
      gone by 3 h.
    - Calcium salts do not change serum potassium (membrane stabilisation only).
    - Haemodialysis lowers K rapidly: modelled as exponential approach to 4.0
      mmol/L with a 1 h half-life after the session starts.
    - Acid-base: K rises about 0.6 mmol/L per 0.1 unit fall in pH in mineral
      acidosis (Adrogue HJ, Madias NE, Am J Med 1981;71:456,
      doi 10.1016/0002-9343(81)90182-0). ``ph_change`` is the change since
      ``initial`` was measured.
    - ``ongoing_release`` (mmol/L/h) models continuing release in rhabdomyolysis,
      tumour lysis or anuria; it is a case parameter, not a literature constant.
    """
    value = float(initial) + ongoing_release * max(t_h, 0.0) - 6.0 * ph_change
    for tr in treatments:
        dt = t_h - tr.t_h
        if tr.code == "insulin_dextrose":
            value -= 0.8 * _pulse(dt, 1.0, 2.0, 6.0)
        elif tr.code == "salbutamol":
            value -= 0.7 * _pulse(dt, 0.5, 1.0, 3.0)
        elif tr.code == "dialysis" and dt > 0.0:
            value = 4.0 + (value - 4.0) * 2 ** (-dt / 1.0)
    return clamp(value, "potassium_mmol_L")


# --------------------------------------------------------------------------- #
# Haemoglobin in haemorrhage                                                   #
# --------------------------------------------------------------------------- #
def hemoglobin_hemorrhage(
    t_h: float,
    baseline_g_dl: float,
    blood_loss_ml: float,
    treatments: Sequence[Treatment] = (),
    weight_kg: float = 70.0,
    bleeding_rate_ml_h: float = 0.0,
    controlled_at_h: Optional[float] = None,
) -> float:
    """Haemoglobin (g/dL) after acute blood loss, crystalloid and transfusion.

    Constants and sources
    - Blood volume 70 mL/kg (about 7 percent of body weight in adults; ATLS 10th
      edition, Shock chapter; Nadler SB et al., Surgery 1962;51:224).
    - Whole-blood loss does not change the concentration until plasma refills:
      transcapillary refill modelled with an 8 h time constant so most of the
      fall is visible by 24 h (ATLS, same chapter: haemoglobin is an unreliable
      early marker of acute loss).
    - Crystalloid: about 25 percent of an infused litre remains intravascular
      after the distribution phase (Hahn RG, Anesthesiology 2010;113:470,
      doi 10.1097/ALN.0b013e3181dcd88f), diluting haemoglobin by
      BV / (BV + 0.25 x volume).
    - One unit of packed red cells raises haemoglobin by about 1 g/dL (10 g/L)
      in a 70 kg adult (NICE NG24 Blood transfusion, 2015,
      https://www.nice.org.uk/guidance/ng24), scaled by 70 / weight.
    """
    bv_ml = 70.0 * max(weight_kg, 10.0)
    t_bleed_end = t_h if controlled_at_h is None else min(t_h, controlled_at_h)
    total_loss = float(blood_loss_ml) + bleeding_rate_ml_h * max(t_bleed_end, 0.0)
    loss_fraction = min(0.9, total_loss / bv_ml)
    hb_eq = baseline_g_dl * (1.0 - loss_fraction)
    value = baseline_g_dl - (baseline_g_dl - hb_eq) * (1.0 - math.exp(-max(t_h, 0.0) / 8.0))
    for tr in treatments:
        if t_h < tr.t_h:
            continue
        if tr.code == "iv_fluids":
            retained = 0.25 * 1000.0 * float(tr.amount or 1.0)
            value *= bv_ml / (bv_ml + retained)
        elif tr.code == "prbc":
            value += 1.0 * float(tr.amount or 1.0) * (70.0 / max(weight_kg, 10.0))
    return clamp(value, "hemoglobin_g_dL")


# --------------------------------------------------------------------------- #
# Oxygenation                                                                  #
# --------------------------------------------------------------------------- #
# FiO2 by delivery device. BTS Guideline for oxygen use in adults in healthcare
# and emergency settings (O'Driscoll BR et al., Thorax 2017;72:ii1,
# doi 10.1136/thoraxjnl-2016-209729): nasal cannulae 1 to 6 L/min give roughly
# 24 to 44 percent (about 4 percent per L/min above room air), simple mask
# 5 to 10 L/min 40 to 60 percent, reservoir mask 15 L/min 60 to 90 percent.
DEVICE_FIO2: dict[str, float] = {
    "room_air": 0.21,
    "nasal_cannula_2L": 0.28,
    "nasal_cannula_4L": 0.36,
    "nasal_cannula_6L": 0.44,
    "simple_mask": 0.50,
    "venturi_28": 0.28,
    "venturi_40": 0.40,
    "non_rebreather": 0.85,
    "hfnc": 0.60,
    "niv": 0.60,
    "ventilator": 1.00,
}


def severinghaus_spo2(pao2_mmhg: float) -> float:
    """Oxyhaemoglobin saturation (percent) from PO2 (mmHg).

    Severinghaus JW, J Appl Physiol 1979;46:599, doi 10.1152/jappl.1979.46.3.599:
    S = 1 / (23400 / (P^3 + 150 P) + 1).
    """
    p = max(pao2_mmhg, 1.0)
    s = 1.0 / (23400.0 / (p ** 3 + 150.0 * p) + 1.0)
    return clamp(100.0 * s, "spo2_pct")


def oxygenation(
    severity: float,
    treatments: Sequence[Treatment] = (),
    t_h: float = 0.0,
    paco2_mmhg: float = 40.0,
    patm_mmhg: float = 760.0,
) -> dict[str, float]:
    """FiO2, PaO2 and SpO2 for a lung-disease severity under oxygen therapy.

    Constants and sources
    - Alveolar gas equation PAO2 = FiO2 x (Patm - 47) - PaCO2 / 0.8 (water vapour
      47 mmHg at 37 C, respiratory quotient 0.8; Lumb AB, Nunn's Applied
      Respiratory Physiology, 8th ed., chapter 10).
    - Venous admixture: PaO2 = (PAO2 - 10) x (1 - s) + 40 x s where the normal
      A-a gradient is 10 mmHg and mixed venous PO2 is 40 mmHg (Nunn, chapter 7);
      s = 0.05 + 0.70 x severity is a linearised shunt fraction (a modelling
      simplification: true shunt corrects less with FiO2 than this does).
    - SpO2 from PaO2 via :func:`severinghaus_spo2`.
    - FiO2 from the latest oxygen treatment (``amount`` = FiO2, or ``note``
      naming a :data:`DEVICE_FIO2` device), else room air.
    """
    fio2 = 0.21
    latest: Optional[Treatment] = None
    for tr in treatments:
        if tr.code == "oxygen" and tr.t_h <= t_h and (latest is None or tr.t_h >= latest.t_h):
            latest = tr
    if latest is not None:
        if latest.amount is not None:
            fio2 = min(1.0, max(0.21, float(latest.amount)))
        elif latest.note in DEVICE_FIO2:
            fio2 = DEVICE_FIO2[latest.note]
    pao2_alv = fio2 * (patm_mmhg - 47.0) - paco2_mmhg / 0.8
    s = 0.05 + 0.70 * _clamp01(severity)
    pao2 = clamp((pao2_alv - 10.0) * (1.0 - s) + 40.0 * s, "pao2_mmHg")
    return {
        "fio2": round(fio2, 2),
        "pao2_mmHg": round(pao2, 0),
        "spo2_pct": round(severinghaus_spo2(pao2), 0),
        "aa_gradient_mmHg": round(max(0.0, pao2_alv - pao2), 0),
    }


def venous_from_arterial(ph: float, pco2_mmhg: float, hco3_mmol_l: float, pao2_mmhg: float, shock: bool = False) -> dict[str, float]:
    """Convert arterial gas values to expected peripheral venous values.

    Byrne AL et al., Respirology 2014;19:168, doi 10.1111/resp.12225 (verified
    2026-10-19): arterial pH 0.03 higher than venous (95 percent CI 0.029 to
    0.038); venous pCO2 bias wide (-10.7 to +2.4 mmHg), modelled as +5 mmHg;
    arterial PO2 36.9 mmHg higher than venous (CI 27.2 to 46.6). Bicarbonate
    about 1.2 mmol/L lower in venous blood (Kelly AM, Hong Kong J Emerg Med
    2013;20:166, doi 10.1177/102490791302000307). In shock the venoarterial gaps
    widen (research doc 15 section 5): pH gap 0.06, pCO2 gap 10.
    """
    gap_ph = 0.06 if shock else 0.03
    gap_pco2 = 10.0 if shock else 5.0
    return {
        "ph": round(clamp(ph - gap_ph, "ph"), 2),
        "pco2_mmHg": round(clamp(pco2_mmhg + gap_pco2, "pco2_mmHg"), 0),
        "hco3_mmol_L": round(clamp(hco3_mmol_l - 1.2, "hco3_mmol_L"), 1),
        "po2_mmHg": round(min(45.0, max(25.0, pao2_mmhg - 36.9)), 0),
    }


# --------------------------------------------------------------------------- #
# Paracetamol (acetaminophen)                                                  #
# --------------------------------------------------------------------------- #
def paracetamol_nomogram_line(t_h: float, line: str = "uk") -> Optional[float]:
    """Treatment-line concentration (mg/L) at ``t_h`` hours post-ingestion.

    - UK (MHRA, Drug Safety Update, September 2012, verified 2026-10-19 at
      https://www.gov.uk/drug-safety-update/treating-paracetamol-overdose-with-intravenous-acetylcysteine-new-guidance):
      a single line joining 100 mg/L at 4 h and 15 mg/L at 15 h, i.e. a 4.02 h
      half-life.
    - US Rumack-Matthew line: 150 mg/L (micrograms/mL) at 4 h with the same 4 h
      half-life (Rumack BH, Matthew H, Pediatrics 1975;55:871).
    The nomogram is only interpretable from 4 h to 24 h (both sources).
    """
    if t_h < 4.0 or t_h > 24.0:
        return None
    start = 100.0 if line == "uk" else 150.0
    half_life = 11.0 * math.log(2.0) / math.log(100.0 / 15.0)
    return start * 2 ** (-(t_h - 4.0) / half_life)


def paracetamol_level(
    t_h: float,
    dose_mg: float,
    weight_kg: float = 70.0,
    treatments: Sequence[Treatment] = (),
    line: str = "uk",
) -> dict[str, float | bool | None]:
    """Plasma paracetamol (mg/L) after a single acute ingestion, with the nomogram verdict.

    One-compartment model with first-order absorption:
    C(t) = F D / V x ka / (ka - ke) x (exp(-ke t) - exp(-ka t)).

    Constants and sources (Forrest JA, Clements JA, Prescott LF, Clin
    Pharmacokinet 1982;7:93, doi 10.2165/00003088-198207020-00001): oral
    bioavailability about 0.9 at therapeutic doses, volume of distribution 0.8
    to 1.0 L/kg (0.9 used), elimination half-life 1.5 to 3 h (2.5 h used), with
    prolongation beyond 4 h in hepatotoxic overdose (Prescott LF, same review):
    half-life 4 h when the ingested dose exceeds 150 mg/kg. Absorption rate
    0.7 /h gives a plasma peak near 2 h, delayed in overdose. Acetylcysteine
    does not alter the measured level; its presence is reported for the
    narrative layer only.
    """
    f, vd_l_kg = 0.9, 0.9
    dose_per_kg = float(dose_mg) / max(weight_kg, 10.0)
    half_life = 4.0 if dose_per_kg > 150.0 else 2.5
    ke = math.log(2.0) / half_life
    ka = 0.7
    v = vd_l_kg * weight_kg
    if t_h <= 0.0:
        conc = 0.0
    else:
        conc = (f * dose_mg / v) * (ka / (ka - ke)) * (math.exp(-ke * t_h) - math.exp(-ka * t_h))
    conc = clamp(conc, "paracetamol_mg_L")
    line_value = paracetamol_nomogram_line(t_h, line)
    nac = _first(treatments, "nac")
    return {
        "level_mg_L": round(conc, 1),
        "nomogram_line_mg_L": None if line_value is None else round(line_value, 1),
        "above_line": None if line_value is None else bool(conc >= line_value),
        "interpretable": line_value is not None,
        "nac_started": nac is not None and nac.t_h <= t_h,
    }

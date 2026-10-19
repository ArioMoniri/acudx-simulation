"""12-lead ECG synthesis (ECGSYN-style Gaussian morphology) and SVG rendering.

The signal model follows the McSharry/Clifford ECGSYN idea of composing each
beat from Gaussian waves (P, Q, R, S, T) whose centre, width and amplitude set
the morphology (McSharry PE et al., IEEE Trans Biomed Eng 2003;50:289,
doi 10.1109/TBME.2003.808805; NeuroKit2 ``ecg_simulate(method="ecgsyn")``,
https://neuropsychology.github.io/NeuroKit/functions/ecg.html). Instead of the
three-ODE attractor we evaluate the Gaussian sum directly per lead, which is
deterministic, fast, and lets every pathology be expressed as explicit,
auditable rule edits (ST shift per lead, T inversion, QRS width, P suppression,
RR irregularity) rather than learned behaviour.

Calibration and layout follow the clinical standard: 25 mm/s, 10 mm/mV, 1 mm
minor and 5 mm major grid, 3 x 4 panel of 2.5 s per lead plus a 10 s lead II
rhythm strip (research doc 15, section 3.2).

Lead amplitude tables are typical adult values from textbook normal limits
(e.g. R in V5 up to 2.6 mV, S in V1 up to 2.5 mV; T upright in I, II, V3-V6;
QRS 70 to 100 ms; PR 120 to 200 ms; QTc under 450/460 ms): Goldberger AL,
Goldberger's Clinical Electrocardiography, 9th ed., chapters 3 to 5, and the
AHA/ACCF/HRS recommendations for ECG standardization (Rautaharju PM et al.,
Circulation 2009;119:e241, doi 10.1161/CIRCULATIONAHA.108.191096). Pathology
criteria (STEMI thresholds, reciprocal change, S1Q3T3, hyperkalaemia pattern,
pericarditis PR depression, WPW short PR with delta wave) follow the Fourth
Universal Definition of MI (Thygesen K et al., Eur Heart J 2019;40:237,
doi 10.1093/eurheartj/ehy462) and Goldberger chapters 9, 12 and 13.

Output: ``synthesize()`` returns a dict with ``fs`` (500 Hz), ``duration_s``,
``leads`` (name -> list of mV samples), ``measurements`` and ``beats``.
Education only; the tracing is synthetic and labelled so.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Optional

import numpy as np

FS = 500
DURATION_S = 10.0
LEADS: tuple[str, ...] = ("I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6")

PATTERNS: tuple[str, ...] = (
    "normal", "sinus_tachycardia", "sinus_bradycardia",
    "stemi_anterior", "stemi_inferior", "stemi_lateral", "stemi_posterior",
    "nstemi", "atrial_fibrillation", "svt", "vt", "complete_heart_block",
    "hyperkalemia", "pericarditis", "pulmonary_embolism", "wpw", "long_qt",
)

# Typical normal wave amplitudes in mV per lead (Goldberger ch. 3 to 5).
_P = dict(I=0.10, II=0.15, III=0.05, aVR=-0.10, aVL=0.03, aVF=0.10, V1=0.05, V2=0.05, V3=0.07, V4=0.08, V5=0.08, V6=0.07)
_Q = dict(I=-0.05, II=-0.05, III=-0.03, aVR=0.00, aVL=-0.03, aVF=-0.04, V1=0.00, V2=0.00, V3=0.00, V4=-0.02, V5=-0.05, V6=-0.06)
_R = dict(I=0.80, II=1.20, III=0.50, aVR=0.15, aVL=0.40, aVF=0.90, V1=0.30, V2=0.60, V3=1.00, V4=1.60, V5=1.50, V6=1.20)
_S = dict(I=-0.10, II=-0.15, III=-0.20, aVR=-0.90, aVL=-0.30, aVF=-0.15, V1=-1.20, V2=-1.60, V3=-1.20, V4=-0.60, V5=-0.30, V6=-0.10)
_T = dict(I=0.25, II=0.30, III=0.10, aVR=-0.25, aVL=0.10, aVF=0.20, V1=-0.05, V2=0.30, V3=0.45, V4=0.40, V5=0.35, V6=0.25)


@dataclass
class BeatParams:
    """Morphology for one beat family. Times in seconds, amplitudes in mV."""

    pr_s: float = 0.16
    qrs_s: float = 0.09
    qtc_s: float = 0.40
    p_scale: float = 1.0
    p_width_s: float = 0.025
    t_scale: dict[str, float] = field(default_factory=dict)      # per-lead multiplier (negative inverts)
    t_width_s: float = 0.05
    st_mv: dict[str, float] = field(default_factory=dict)        # ST deviation per lead at J+60 ms
    pr_seg_mv: dict[str, float] = field(default_factory=dict)    # PR segment deviation (pericarditis)
    r_override: dict[str, float] = field(default_factory=dict)   # replace R amplitude
    s_override: dict[str, float] = field(default_factory=dict)
    q_override: dict[str, float] = field(default_factory=dict)
    delta_mv: float = 0.0                                        # WPW delta wave amplitude scale
    wide_morphology: bool = False                                # VT/escape: LBBB-like bundle pattern
    p_present: bool = True


@dataclass
class RhythmParams:
    rate_bpm: float = 75.0
    irregular: bool = False          # AF: RR coefficient of variation 0.2
    fibrillatory_mv: float = 0.0     # AF baseline f-wave amplitude
    atrial_rate_bpm: Optional[float] = None   # complete heart block: independent P train
    rhythm: str = "sinus"


def _gauss(t: np.ndarray, mu: float, sigma: float, amp: float) -> np.ndarray:
    return amp * np.exp(-((t - mu) ** 2) / (2.0 * sigma * sigma))


def _smooth_window(t: np.ndarray, start: float, end: float, ramp: float) -> np.ndarray:
    """Plateau of 1 between start and end with cosine ramps of width ``ramp``."""
    w = np.zeros_like(t)
    up = (t >= start - ramp) & (t < start)
    w[up] = 0.5 * (1 - np.cos(np.pi * (t[up] - (start - ramp)) / ramp))
    mid = (t >= start) & (t <= end)
    w[mid] = 1.0
    down = (t > end) & (t <= end + ramp)
    w[down] = 0.5 * (1 + np.cos(np.pi * (t[down] - end) / ramp))
    return w


def _beat(t: np.ndarray, lead: str, bp: BeatParams, rr_s: float, with_p: bool = True) -> np.ndarray:
    """One beat for ``lead``; ``t`` is time relative to the R peak (seconds)."""
    qt = bp.qtc_s * math.sqrt(max(rr_s, 0.3))  # Bazett: QT = QTc x sqrt(RR)
    qrs_half = bp.qrs_s / 2.0
    r_sigma = bp.qrs_s / 7.5
    r = bp.r_override.get(lead, _R[lead])
    s = bp.s_override.get(lead, _S[lead])
    q = bp.q_override.get(lead, _Q[lead])
    if bp.wide_morphology:
        # Monomorphic wide complex: predominantly negative in V1-V3, positive in lateral leads.
        sign = -1.0 if lead in ("V1", "V2", "V3", "aVR") else 1.0
        r, s, q = 1.2 * sign, -0.35 * sign, 0.0
    y = _gauss(t, 0.0, r_sigma, r)
    y += _gauss(t, -qrs_half * 0.55, r_sigma * 0.7, q)
    y += _gauss(t, qrs_half * 0.6, r_sigma * 0.85, s)
    if bp.delta_mv:
        y += _gauss(t, -qrs_half * 0.9, 0.018, bp.delta_mv * (0.35 if r > 0 else -0.2))
    # ST segment plateau from J point (end of QRS) to T onset, blending into T.
    j = qrs_half + 0.01
    t_peak = qt - 0.5 * (4.0 * bp.t_width_s)
    st = bp.st_mv.get(lead, 0.0)
    if st:
        y += st * _smooth_window(t, j, t_peak - 0.05, 0.03)
    # T wave (discordant to QRS in wide-complex rhythms).
    t_amp = _T[lead] * bp.t_scale.get(lead, 1.0)
    if bp.wide_morphology:
        t_amp = -0.35 * (1.0 if r > 0 else -1.0)
    y += _gauss(t, t_peak, bp.t_width_s, t_amp)
    if with_p and bp.p_present:
        p_center = -(bp.pr_s + 0.5 * 0.08) - qrs_half * 0.4
        y += _gauss(t, p_center, bp.p_width_s, _P[lead] * bp.p_scale)
        pr = bp.pr_seg_mv.get(lead, 0.0)
        if pr:
            y += pr * _smooth_window(t, p_center + 0.05, -qrs_half - 0.005, 0.015)
    return y


def _pattern(name: str, rate_bpm: Optional[float]) -> tuple[BeatParams, RhythmParams]:
    bp = BeatParams()
    rp = RhythmParams(rate_bpm=rate_bpm or 75.0)
    inferior, lateral, anterior = ("II", "III", "aVF"), ("I", "aVL", "V5", "V6"), ("V1", "V2", "V3", "V4")
    if name == "normal":
        pass
    elif name == "sinus_tachycardia":
        rp.rate_bpm = rate_bpm or 115.0
    elif name == "sinus_bradycardia":
        rp.rate_bpm = rate_bpm or 48.0
    elif name == "stemi_anterior":
        bp.st_mv = {"V1": 0.25, "V2": 0.40, "V3": 0.45, "V4": 0.35, "II": -0.10, "III": -0.15, "aVF": -0.12}
        bp.t_scale = {"V2": 1.6, "V3": 1.5, "V4": 1.4}
        bp.r_override = {"V2": 0.25, "V3": 0.45}
    elif name == "stemi_inferior":
        bp.st_mv = {"II": 0.25, "III": 0.35, "aVF": 0.30, "I": -0.12, "aVL": -0.20}
        bp.t_scale = {"II": 1.4, "III": 1.8, "aVF": 1.5, "aVL": -1.2}
        rp.rate_bpm = rate_bpm or 58.0
    elif name == "stemi_lateral":
        bp.st_mv = {"I": 0.20, "aVL": 0.25, "V5": 0.25, "V6": 0.25, "III": -0.15, "aVF": -0.10}
    elif name == "stemi_posterior":
        bp.st_mv = {"V1": -0.15, "V2": -0.25, "V3": -0.20}
        bp.r_override = {"V1": 0.70, "V2": 1.10}
        bp.t_scale = {"V1": 4.0, "V2": 1.5}
    elif name == "nstemi":
        bp.st_mv = {"V4": -0.15, "V5": -0.20, "V6": -0.15, "I": -0.10, "II": -0.08}
        bp.t_scale = {"V4": -1.0, "V5": -1.2, "V6": -1.0, "I": -0.8, "aVL": -0.8}
    elif name == "atrial_fibrillation":
        rp = RhythmParams(rate_bpm=rate_bpm or 125.0, irregular=True, fibrillatory_mv=0.05, rhythm="atrial_fibrillation")
        bp.p_present = False
    elif name == "svt":
        rp = RhythmParams(rate_bpm=rate_bpm or 180.0, rhythm="svt")
        bp.p_present = False
        bp.st_mv = {"V4": -0.08, "V5": -0.10, "V6": -0.08}  # rate-related depression
    elif name == "vt":
        rp = RhythmParams(rate_bpm=rate_bpm or 170.0, rhythm="vt")
        bp = BeatParams(qrs_s=0.16, p_present=False, wide_morphology=True, qtc_s=0.44)
    elif name == "complete_heart_block":
        rp = RhythmParams(rate_bpm=rate_bpm or 38.0, atrial_rate_bpm=80.0, rhythm="complete_heart_block")
        bp = BeatParams(qrs_s=0.14, p_present=False, wide_morphology=True, qtc_s=0.44)
    elif name == "hyperkalemia":
        bp = BeatParams(pr_s=0.22, qrs_s=0.13, p_scale=0.3, t_width_s=0.028,
                        t_scale={lead: 2.4 for lead in LEADS if _T[lead] > 0})
        rp.rate_bpm = rate_bpm or 62.0
    elif name == "pericarditis":
        diffuse = [lead for lead in LEADS if lead not in ("aVR", "V1")]
        bp.st_mv = {lead: 0.15 for lead in diffuse}
        bp.st_mv["aVR"] = -0.10
        bp.pr_seg_mv = {lead: -0.08 for lead in diffuse}
        bp.pr_seg_mv["aVR"] = 0.08
        rp.rate_bpm = rate_bpm or 95.0
    elif name == "pulmonary_embolism":
        rp.rate_bpm = rate_bpm or 112.0
        bp.s_override = {"I": -0.35}
        bp.q_override = {"III": -0.25}
        bp.t_scale = {"III": -1.5, "V1": 3.0, "V2": -0.9, "V3": -0.7}
        bp.r_override = {"V1": 0.55}
    elif name == "wpw":
        bp = BeatParams(pr_s=0.09, qrs_s=0.13, delta_mv=1.0)
    elif name == "long_qt":
        bp = BeatParams(qtc_s=0.52, t_width_s=0.07)
        rp.rate_bpm = rate_bpm or 64.0
    else:
        raise ValueError(f"unknown ECG pattern: {name}")
    return bp, rp


def _rr_series(rp: RhythmParams, rng: np.random.Generator) -> list[float]:
    base = 60.0 / rp.rate_bpm
    rrs: list[float] = []
    t = 0.3
    while t < DURATION_S + 1.0:
        rr = base * (1.0 + rng.normal(0.0, 0.2)) if rp.irregular else base * (1.0 + rng.normal(0.0, 0.015))
        rr = max(0.25, rr)
        rrs.append(rr)
        t += rr
    return rrs


def synthesize(pattern: str, rate_bpm: Optional[float] = None, seed: int = 0, noise_mv: float = 0.01) -> dict:
    """Synthesize a 10 s, 500 Hz 12-lead ECG for ``pattern``.

    Deterministic for a given ``(pattern, rate_bpm, seed)``. ``rate_bpm`` is
    the ventricular rate; patterns with a characteristic rate use it when
    ``rate_bpm`` is None.
    """
    if pattern not in PATTERNS:
        raise ValueError(f"unknown ECG pattern: {pattern}")
    bp, rp = _pattern(pattern, rate_bpm)
    rng = np.random.default_rng(seed)
    n = int(DURATION_S * FS)
    time = np.arange(n) / FS
    rrs = _rr_series(rp, rng)
    r_times: list[float] = []
    t = 0.3
    for rr in rrs:
        r_times.append(t)
        t += rr
    leads: dict[str, np.ndarray] = {lead: np.zeros(n) for lead in LEADS}
    for i, rt in enumerate(r_times):
        rr = rrs[i]
        rel = time - rt
        for lead in LEADS:
            leads[lead] += _beat(rel, lead, bp, rr, with_p=rp.atrial_rate_bpm is None)
    if rp.atrial_rate_bpm:  # independent P train (complete heart block)
        p_period = 60.0 / rp.atrial_rate_bpm
        pt = 0.1
        while pt < DURATION_S:
            for lead in LEADS:
                leads[lead] += _gauss(time, pt, 0.025, _P[lead])
            pt += p_period
    for lead in LEADS:
        if rp.fibrillatory_mv:
            leads[lead] += rp.fibrillatory_mv * np.sin(2 * np.pi * 6.5 * time + rng.uniform(0, 2 * np.pi)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.7 * time))
        leads[lead] += 0.02 * np.sin(2 * np.pi * 0.15 * time + rng.uniform(0, 2 * np.pi))  # baseline wander
        leads[lead] += rng.normal(0.0, noise_mv, n)
    rate = 60.0 / float(np.mean(rrs[: max(1, len([x for x in r_times if x <= DURATION_S]))]))
    mean_rr = 60.0 / rate
    measurements = {
        "rate_bpm": round(rate, 0),
        "rhythm": rp.rhythm,
        "regular": not rp.irregular,
        "pr_ms": None if not bp.p_present or rp.atrial_rate_bpm else round(bp.pr_s * 1000),
        "qrs_ms": round(bp.qrs_s * 1000),
        "qt_ms": round(bp.qtc_s * math.sqrt(mean_rr) * 1000),
        "qtc_ms": round(bp.qtc_s * 1000),
        "axis_deg": _axis(leads),
        "st_deviation_mv": {lead: round(v, 2) for lead, v in bp.st_mv.items()},
        "t_inversion_leads": sorted(lead for lead, s in bp.t_scale.items() if s < 0 and _T[lead] > 0),
        "atrial_rate_bpm": rp.atrial_rate_bpm,
        "pattern": pattern,
        "interpretation": INTERPRETATION[pattern],
    }
    return {
        "fs": FS,
        "duration_s": DURATION_S,
        "pattern": pattern,
        "seed": seed,
        "leads": {lead: [round(float(v), 4) for v in leads[lead]] for lead in LEADS},
        "beats": {"r_peak_s": [round(x, 3) for x in r_times if x <= DURATION_S]},
        "measurements": measurements,
        "calibration": {"paper_speed_mm_s": 25, "gain_mm_mV": 10},
        "is_synthetic": True,
        "generator": "acudx.results.ecg ECGSYN-style v1",
    }


def _axis(leads: dict[str, np.ndarray]) -> int:
    """Frontal QRS axis from net deflection in I and aVF (degrees)."""
    i_net = float(np.sum(leads["I"][np.abs(leads["I"]) > 0.15]))
    f_net = float(np.sum(leads["aVF"][np.abs(leads["aVF"]) > 0.15]))
    return int(round(math.degrees(math.atan2(f_net, i_net))))


INTERPRETATION: dict[str, str] = {
    "normal": "Sinus rhythm, normal intervals, no ST or T wave abnormality.",
    "sinus_tachycardia": "Sinus tachycardia, otherwise normal complexes.",
    "sinus_bradycardia": "Sinus bradycardia, otherwise normal complexes.",
    "stemi_anterior": "ST elevation V1-V4 with reciprocal inferior ST depression: anterior STEMI (LAD territory).",
    "stemi_inferior": "ST elevation II, III, aVF with reciprocal depression in I and aVL: inferior STEMI.",
    "stemi_lateral": "ST elevation I, aVL, V5, V6 with reciprocal inferior depression: lateral STEMI.",
    "stemi_posterior": "ST depression V1-V3 with tall R waves and upright T in V1-V2: posterior infarction pattern.",
    "nstemi": "Horizontal ST depression and T inversion in lateral leads without ST elevation: ischaemia / NSTE-ACS pattern.",
    "atrial_fibrillation": "Irregularly irregular narrow-complex rhythm with no P waves: atrial fibrillation.",
    "svt": "Regular narrow-complex tachycardia without visible P waves: supraventricular tachycardia.",
    "vt": "Regular wide-complex tachycardia: ventricular tachycardia until proven otherwise.",
    "complete_heart_block": "P waves dissociated from a slow wide escape rhythm: complete (third-degree) AV block.",
    "hyperkalemia": "Tall peaked T waves, flattened P waves, prolonged PR and widened QRS: hyperkalaemia pattern.",
    "pericarditis": "Diffuse concave ST elevation with PR depression and reciprocal change in aVR: acute pericarditis.",
    "pulmonary_embolism": "Sinus tachycardia with S1Q3T3 and anterior T inversion (right ventricular strain): consistent with pulmonary embolism.",
    "wpw": "Short PR with a delta wave and widened QRS: Wolff-Parkinson-White pre-excitation.",
    "long_qt": "Sinus rhythm with QTc over 500 ms: long QT.",
}


# --------------------------------------------------------------------------- #
# Measurement helpers (used by tests and the engine)                           #
# --------------------------------------------------------------------------- #
def st_level(ecg: dict, lead: str, offset_ms: int = 60) -> float:
    """Mean ST deviation (mV) at J + ``offset_ms`` relative to the TP baseline,
    averaged over the beats in the strip. J is taken as R peak + QRS/2 + 10 ms."""
    fs = ecg["fs"]
    sig = np.asarray(ecg["leads"][lead])
    m = ecg["measurements"]
    qrs_s = m["qrs_ms"] / 1000.0
    qt_s = m["qt_ms"] / 1000.0
    pr_s = (m["pr_ms"] or 100) / 1000.0
    vals = []
    peaks = ecg["beats"]["r_peak_s"]
    for prev, r in zip(peaks, peaks[1:]):
        j = int((r + qrs_s / 2 + 0.01 + offset_ms / 1000.0) * fs)
        # TP segment: after the previous T wave ends, before this P wave starts.
        a = prev + qt_s + 0.06
        b = r - pr_s - 0.10
        if b - a < 0.03:
            a = b - 0.03
        base_a, base_b = int(a * fs), int(b * fs)
        if base_a < 0 or j + 5 >= len(sig):
            continue
        baseline = float(np.median(sig[base_a:base_b]))
        vals.append(float(np.mean(sig[j - 2 : j + 3])) - baseline)
    return float(np.mean(vals)) if vals else 0.0


def qrs_width_ms(ecg: dict, lead: str = "II", threshold_mv: float = 0.12) -> float:
    """Measured QRS duration: span around each R peak where |slope| or |amplitude|
    exceeds a threshold, averaged over beats."""
    fs = ecg["fs"]
    sig = np.asarray(ecg["leads"][lead])
    widths = []
    for r in ecg["beats"]["r_peak_s"]:
        c = int(r * fs)
        lo, hi = max(0, c - int(0.12 * fs)), min(len(sig) - 1, c + int(0.12 * fs))
        seg = np.abs(sig[lo:hi] - np.median(sig[max(0, lo - 60) : lo]))
        idx = np.where(seg > threshold_mv)[0]
        if len(idx) >= 2:
            widths.append((idx[-1] - idx[0]) / fs * 1000.0)
    return float(np.mean(widths)) if widths else 0.0


def measured_rate(ecg: dict) -> float:
    r = ecg["beats"]["r_peak_s"]
    if len(r) < 2:
        return 0.0
    return 60.0 / float(np.mean(np.diff(r)))


# --------------------------------------------------------------------------- #
# SVG renderer: 25 mm/s, 10 mm/mV, 3 x 4 + lead II rhythm strip                #
# --------------------------------------------------------------------------- #
_LAYOUT = (("I", "aVR", "V1", "V4"), ("II", "aVL", "V2", "V5"), ("III", "aVF", "V3", "V6"))


def render_svg(ecg: dict, px_per_mm: float = 4.0, downsample: int = 2) -> str:
    """Render the 12-lead as an SVG string at 25 mm/s and 10 mm/mV.

    Columns show the simultaneous 2.5 s slices of each lead; a 10 s lead II
    rhythm strip sits below. Minor grid 1 mm, major grid 5 mm, calibration
    pulse 1 mV x 200 ms at the start of each row.
    """
    mm = px_per_mm
    speed, gain = 25.0, 10.0
    col_w_mm, row_h_mm, margin_mm = 2.5 * speed, 35.0, 8.0
    width_mm = 4 * col_w_mm + 2 * margin_mm + 10
    height_mm = 4 * row_h_mm + 2 * margin_mm
    w, h = width_mm * mm, height_mm * mm
    fs = ecg["fs"]
    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0f}" height="{h:.0f}" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="12-lead ECG, synthetic">',
        f'<rect width="{w:.0f}" height="{h:.0f}" fill="#fff8f6"/>',
        '<g stroke="#f3b9b0" stroke-width="0.5">',
    ]
    for x in range(0, int(width_mm) + 1):
        out.append(f'<line x1="{x*mm:.1f}" y1="0" x2="{x*mm:.1f}" y2="{h:.0f}"/>')
    for y in range(0, int(height_mm) + 1):
        out.append(f'<line x1="0" y1="{y*mm:.1f}" x2="{w:.0f}" y2="{y*mm:.1f}"/>')
    out.append('</g><g stroke="#e58a7c" stroke-width="1">')
    for x in range(0, int(width_mm) + 1, 5):
        out.append(f'<line x1="{x*mm:.1f}" y1="0" x2="{x*mm:.1f}" y2="{h:.0f}"/>')
    for y in range(0, int(height_mm) + 1, 5):
        out.append(f'<line x1="0" y1="{y*mm:.1f}" x2="{w:.0f}" y2="{y*mm:.1f}"/>')
    out.append('</g>')

    def trace(lead: str, t0: float, t1: float, x0_mm: float, base_y_mm: float) -> None:
        sig = ecg["leads"][lead]
        a, b = int(t0 * fs), min(len(sig), int(t1 * fs))
        pts = []
        for i in range(a, b, downsample):
            x = (x0_mm + (i / fs - t0) * speed) * mm
            y = (base_y_mm - sig[i] * gain) * mm
            pts.append(f"{x:.1f},{y:.1f}")
        out.append(f'<polyline fill="none" stroke="#111" stroke-width="1.2" points="{" ".join(pts)}"/>')
        out.append(f'<text x="{(x0_mm + 1) * mm:.1f}" y="{(base_y_mm - 14) * mm:.1f}" font-family="sans-serif" font-size="{3.2 * mm:.1f}" fill="#111">{lead}</text>')

    def calibration(x0_mm: float, base_y_mm: float) -> None:
        pts = [(x0_mm, base_y_mm), (x0_mm + 1, base_y_mm), (x0_mm + 1, base_y_mm - 10), (x0_mm + 6, base_y_mm - 10), (x0_mm + 6, base_y_mm), (x0_mm + 7, base_y_mm)]
        out.append('<polyline fill="none" stroke="#111" stroke-width="1.2" points="' + " ".join(f"{x*mm:.1f},{y*mm:.1f}" for x, y in pts) + '"/>')

    for r, row in enumerate(_LAYOUT):
        base_y = margin_mm + row_h_mm * r + 22
        calibration(margin_mm, base_y)
        for c, lead in enumerate(row):
            trace(lead, c * 2.5, (c + 1) * 2.5, margin_mm + 8 + c * col_w_mm, base_y)
    base_y = margin_mm + row_h_mm * 3 + 22
    calibration(margin_mm, base_y)
    trace("II", 0.0, min(DURATION_S, 4 * col_w_mm / speed - 0.32), margin_mm + 8, base_y)
    m = ecg["measurements"]
    footer = (f"25 mm/s  10 mm/mV  500 Hz   HR {m['rate_bpm']:.0f}  PR {m['pr_ms'] or '-'} ms  QRS {m['qrs_ms']} ms  "
              f"QTc {m['qtc_ms']} ms  axis {m['axis_deg']}   SYNTHETIC TRACING, education only")
    out.append(f'<text x="{margin_mm * mm:.1f}" y="{(height_mm - 2) * mm:.1f}" font-family="sans-serif" font-size="{3 * mm:.1f}" fill="#333">{footer}</text>')
    out.append("</svg>")
    return "\n".join(out)

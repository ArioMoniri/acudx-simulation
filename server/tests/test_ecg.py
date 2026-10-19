"""ECG synthesis: pathology morphologies are present where the rules say, and
the output is deterministic, bounded and renderable."""

from __future__ import annotations

import pytest

from server.results import ecg


@pytest.fixture(scope="module")
def strips() -> dict[str, dict]:
    return {p: ecg.synthesize(p, seed=7) for p in ecg.PATTERNS}


def test_shape_and_determinism():
    a = ecg.synthesize("normal", seed=3)
    b = ecg.synthesize("normal", seed=3)
    assert a["fs"] == 500 and a["duration_s"] == 10.0
    assert set(a["leads"]) == set(ecg.LEADS)
    assert all(len(v) == 5000 for v in a["leads"].values())
    assert a["leads"]["II"] == b["leads"]["II"]
    assert a["is_synthetic"] is True
    c = ecg.synthesize("normal", seed=4)
    assert c["leads"]["II"] != a["leads"]["II"]


def test_amplitudes_physiologic(strips):
    for name, s in strips.items():
        for lead, samples in s["leads"].items():
            assert max(abs(x) for x in samples) < 5.0, (name, lead)


def test_normal_intervals_and_rate(strips):
    m = strips["normal"]["measurements"]
    assert 60 <= m["rate_bpm"] <= 100
    assert 120 <= m["pr_ms"] <= 200 and 70 <= m["qrs_ms"] <= 100 and m["qtc_ms"] < 450
    assert abs(ecg.measured_rate(strips["normal"]) - m["rate_bpm"]) < 5
    for lead in ("I", "II", "V2", "V5"):
        assert abs(ecg.st_level(strips["normal"], lead)) < 0.08, lead


def test_anterior_stemi_st_elevation_v1_v4_with_reciprocal_inferior_depression(strips):
    s = strips["stemi_anterior"]
    for lead in ("V1", "V2", "V3", "V4"):
        assert ecg.st_level(s, lead) >= 0.15, lead  # at least 1.5 mm
    for lead in ("II", "III", "aVF"):
        assert ecg.st_level(s, lead) <= -0.05, lead
    assert "anterior STEMI" in s["measurements"]["interpretation"]


def test_inferior_stemi_territory(strips):
    s = strips["stemi_inferior"]
    for lead in ("II", "III", "aVF"):
        assert ecg.st_level(s, lead) >= 0.15, lead
    for lead in ("I", "aVL"):
        assert ecg.st_level(s, lead) <= -0.05, lead


def test_lateral_and_posterior(strips):
    lat = strips["stemi_lateral"]
    for lead in ("I", "aVL", "V5", "V6"):
        assert ecg.st_level(lat, lead) >= 0.12, lead
    post = strips["stemi_posterior"]
    for lead in ("V1", "V2", "V3"):
        assert ecg.st_level(post, lead) <= -0.08, lead


def test_nstemi_depression_and_t_inversion_without_elevation(strips):
    s = strips["nstemi"]
    for lead in ("V4", "V5", "V6"):
        assert ecg.st_level(s, lead) <= -0.08, lead
    assert all(v <= 0.05 for v in (ecg.st_level(s, lead) for lead in ecg.LEADS))
    assert {"V4", "V5", "V6"} <= set(s["measurements"]["t_inversion_leads"])


def test_rates_by_rhythm(strips):
    assert 100 < strips["atrial_fibrillation"]["measurements"]["rate_bpm"] < 160
    assert 150 <= ecg.measured_rate(strips["svt"]) <= 220
    assert 140 <= ecg.measured_rate(strips["vt"]) <= 220
    assert 30 <= ecg.measured_rate(strips["complete_heart_block"]) <= 45
    assert strips["complete_heart_block"]["measurements"]["atrial_rate_bpm"] == 80.0
    assert 100 <= ecg.measured_rate(strips["sinus_tachycardia"]) <= 140
    assert 100 <= ecg.measured_rate(strips["pulmonary_embolism"]) <= 130


def test_af_is_irregular_and_has_no_p(strips):
    s = strips["atrial_fibrillation"]
    import statistics
    rr = [b - a for a, b in zip(s["beats"]["r_peak_s"], s["beats"]["r_peak_s"][1:])]
    assert statistics.pstdev(rr) / statistics.mean(rr) > 0.08
    assert s["measurements"]["pr_ms"] is None and s["measurements"]["regular"] is False


def test_qrs_width_wide_vs_narrow(strips):
    narrow = ecg.qrs_width_ms(strips["normal"], "V5")
    assert 60 <= narrow <= 110
    assert ecg.qrs_width_ms(strips["vt"], "V5") >= 120
    assert strips["vt"]["measurements"]["qrs_ms"] >= 120
    assert strips["complete_heart_block"]["measurements"]["qrs_ms"] >= 120
    assert strips["hyperkalemia"]["measurements"]["qrs_ms"] >= 120


def test_hyperkalemia_peaked_t(strips):
    s = strips["hyperkalemia"]
    n = strips["normal"]
    peak_k = max(s["leads"]["V3"])
    peak_n = max(n["leads"]["V3"])
    # T wave taller than normal T but the configured R is the same: check T region max
    import numpy as np
    r = s["beats"]["r_peak_s"][2]
    seg = np.asarray(s["leads"]["V3"])[int((r + 0.15) * 500) : int((r + 0.45) * 500)]
    seg_n = np.asarray(n["leads"]["V3"])[int((n["beats"]["r_peak_s"][2] + 0.15) * 500) : int((n["beats"]["r_peak_s"][2] + 0.45) * 500)]
    assert seg.max() > 1.8 * seg_n.max()
    assert s["measurements"]["pr_ms"] > 200
    assert peak_k > 0 and peak_n > 0


def test_pericarditis_diffuse_elevation_with_avr_reciprocal(strips):
    s = strips["pericarditis"]
    for lead in ("I", "II", "III", "aVF", "V3", "V5"):
        assert ecg.st_level(s, lead) >= 0.08, lead
    assert ecg.st_level(s, "aVR") <= -0.05


def test_pe_s1q3t3(strips):
    s = strips["pulmonary_embolism"]
    import numpy as np
    r = s["beats"]["r_peak_s"][2]
    lead_i = np.asarray(s["leads"]["I"])[int((r - 0.06) * 500) : int((r + 0.08) * 500)]
    lead_iii = np.asarray(s["leads"]["III"])[int((r - 0.08) * 500) : int((r + 0.06) * 500)]
    assert lead_i.min() <= -0.2   # S1
    assert lead_iii.min() <= -0.15  # Q3
    assert "III" in s["measurements"]["t_inversion_leads"]  # T3
    assert {"V2", "V3"} <= set(s["measurements"]["t_inversion_leads"])


def test_wpw_and_long_qt(strips):
    w = strips["wpw"]["measurements"]
    assert w["pr_ms"] < 120 and w["qrs_ms"] >= 110
    q = strips["long_qt"]["measurements"]
    assert q["qtc_ms"] > 500


def test_unknown_pattern_rejected():
    with pytest.raises(ValueError):
        ecg.synthesize("bigeminy")


def test_svg_render_calibration(strips):
    svg = ecg.render_svg(strips["stemi_anterior"], px_per_mm=4.0)
    assert svg.startswith("<svg") and svg.rstrip().endswith("</svg>")
    assert "25 mm/s" in svg and "10 mm/mV" in svg and "SYNTHETIC" in svg
    for lead in ecg.LEADS:
        assert f">{lead}<" in svg
    # 2.5 s per column at 25 mm/s = 62.5 mm = 250 px at 4 px/mm: width at least four columns
    import re
    width = int(re.search(r'width="(\d+)"', svg).group(1))
    assert width >= 4 * 250
    assert svg.count("<polyline") >= 12 + 1 + 4

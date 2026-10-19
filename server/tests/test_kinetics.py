"""Kinetics layer: bounded, monotone where physiology says so, treatment responsive."""

from __future__ import annotations

import math

import pytest

from server.results import kinetics as k
from server.results.kinetics import Treatment


def _monotone(xs: list[float], increasing: bool) -> bool:
    pairs = zip(xs, xs[1:])
    return all((b >= a - 1e-9) if increasing else (b <= a + 1e-9) for a, b in pairs)


# --------------------------------------------------------------------------- troponin
class TestTroponin:
    def test_peak_near_published_time_to_peak(self):
        for assay, expected in (("hs_ctni", 8.3), ("hs_ctnt", 11.2)):
            ts = [x / 4 for x in range(0, 200)]
            vals = [k.troponin(assay, t, 0.7) for t in ts]
            t_peak = ts[vals.index(max(vals))]
            assert abs(t_peak - expected) < 0.3, assay

    def test_rises_before_peak_and_falls_after(self):
        rise = [k.troponin("hs_ctnt", t, 0.6) for t in (0, 1, 2, 4, 8, 11)]
        fall = [k.troponin("hs_ctnt", t, 0.6) for t in (12, 24, 48, 96, 200)]
        assert _monotone(rise, True) and _monotone(fall, False)

    def test_ctni_falls_faster_than_ctnt(self):
        """JALM 2020: 50 percent of peak at ~45 h (cTnI) vs ~116 h (cTnT)."""
        def half_time(assay: str) -> float:
            ts = [x / 2 for x in range(0, 800)]
            vals = [k.troponin(assay, t, 0.8) for t in ts]
            peak = max(vals)
            i_peak = vals.index(peak)
            for i in range(i_peak, len(ts)):
                if vals[i] <= 0.5 * peak:
                    return ts[i]
            return math.inf
        hi, ht = half_time("hs_ctni"), half_time("hs_ctnt")
        assert 30 < hi < 70
        assert 90 < ht < 160
        assert hi < ht

    def test_zero_severity_is_below_99th_percentile(self):
        for assay in ("hs_ctni", "hs_ctnt"):
            for sex in ("female", "male"):
                v = k.troponin(assay, 6.0, 0.0, sex=sex)
                assert v < k.TROPONIN_PARAMS[assay]["url_ng_L"][sex]  # type: ignore[index]

    def test_severity_scales_peak_and_stays_bounded(self):
        lo = k.troponin("hs_ctnt", 11.2, 0.1)
        hi = k.troponin("hs_ctnt", 11.2, 1.0)
        assert lo < hi <= k.BOUNDS["hs_ctnt_ng_L"][1]
        assert k.troponin("hs_ctni", 8.0, 5.0) <= k.BOUNDS["hs_ctni_ng_L"][1]

    def test_reperfusion_pulls_peak_earlier(self):
        untreated = [k.troponin("hs_ctnt", t, 0.8) for t in (3, 5, 7)]
        treated = [k.troponin("hs_ctnt", t, 0.8, [Treatment("reperfusion_pci", 1.5)]) for t in (3, 5, 7)]
        assert treated[0] > untreated[0]

    def test_esc_rule(self):
        assert k.troponin_rule("hs_ctnt", 3.0) == "rule_out"
        assert k.troponin_rule("hs_ctnt", 60.0) == "rule_in"
        assert k.troponin_rule("hs_ctnt", 20.0, 21.0) == "observe"
        assert k.troponin_rule("hs_ctnt", 20.0, 30.0) == "rule_in"
        assert k.troponin_rule("hs_ctni", 4.5, 5.5) == "rule_out"


# --------------------------------------------------------------------------- lactate
class TestLactate:
    def test_untreated_shock_rises_and_is_bounded(self):
        vals = [k.lactate(t, 0.9) for t in (0, 1, 3, 6, 12)]
        assert _monotone(vals, True)
        assert vals[-1] <= k.BOUNDS["lactate_mmol_L"][1]

    def test_clears_after_fluids(self):
        fluids = [Treatment("iv_fluids", 2.0, amount=2.0)]
        before = k.lactate(2.0, 0.8, fluids)
        after2 = k.lactate(4.0, 0.8, fluids)
        after6 = k.lactate(8.0, 0.8, fluids)
        assert after2 < before and after6 < after2
        # at least 10 percent clearance over 2 h (Nguyen 2004 target)
        assert (before - after2) / before > 0.10

    def test_hepatic_impairment_slows_clearance(self):
        fluids = [Treatment("iv_fluids", 1.0)]
        assert k.lactate(5.0, 0.8, fluids, hepatic_impairment=True) > k.lactate(5.0, 0.8, fluids)

    def test_no_severity_stays_normal(self):
        assert k.lactate(10.0, 0.0) <= 2.2


# --------------------------------------------------------------------------- inflammatory
class TestInflammatory:
    def test_crp_lags_then_peaks_near_48h(self):
        assert k.crp(2.0, 0.8) < 5.0
        ts = list(range(0, 120, 2))
        vals = [k.crp(float(t), 0.8) for t in ts]
        assert 40 <= ts[vals.index(max(vals))] <= 56

    def test_crp_falls_after_antibiotics(self):
        abx = [Treatment("antibiotics", 6.0)]
        assert k.crp(72.0, 0.8, abx) < k.crp(72.0, 0.8)

    def test_pct_peaks_earlier_than_crp_and_viral_stays_low(self):
        ts = list(range(0, 72))
        pct = [k.procalcitonin(float(t), 0.8) for t in ts]
        assert 10 <= ts[pct.index(max(pct))] <= 30
        assert k.procalcitonin(24.0, 0.8, bacterial=False) < 0.5
        assert k.procalcitonin(24.0, 0.8) > 2.0


# --------------------------------------------------------------------------- creatinine
class TestCreatinine:
    def test_waikar_24h_rise_for_90pct_loss(self):
        rise = k.creatinine_aki(24.0, 1.0, 0.9 / 0.95) - 1.0
        assert 1.5 <= rise <= 2.5

    def test_recovers_after_fluids_and_dialysis_drops(self):
        fl = [Treatment("iv_fluids", 24.0)]
        assert k.creatinine_aki(72.0, 1.0, 0.8, fl) < k.creatinine_aki(72.0, 1.0, 0.8)
        hd = [Treatment("dialysis", 48.0)]
        assert k.creatinine_aki(49.0, 1.0, 0.9, hd) < k.creatinine_aki(49.0, 1.0, 0.9)

    def test_kdigo_stage(self):
        assert k.kdigo_stage(1.0, 1.1) == 0
        assert k.kdigo_stage(1.0, 1.35) == 1
        assert k.kdigo_stage(1.0, 2.2) == 2
        assert k.kdigo_stage(1.0, 3.5) == 3
        assert k.kdigo_stage(1.0, 4.1) == 3


# --------------------------------------------------------------------------- DKA
class TestDka:
    def test_presentation_meets_jbds_criteria(self):
        s = k.dka_state(0.0, 0.7)
        assert s["glucose_mmol_L"] > 11.0 and s["ketones_mmol_L"] > 3.0
        assert s["hco3_mmol_L"] < 15.0 and s["ph"] < 7.3

    def test_insulin_moves_at_jbds_rates(self):
        tx = [Treatment("insulin_infusion", 2.0, amount=0.1), Treatment("iv_fluids", 1.0, amount=1.0)]
        s0 = k.dka_state(2.0, 0.7, tx)
        s1 = k.dka_state(3.0, 0.7, tx)
        assert s0["glucose_mmol_L"] - s1["glucose_mmol_L"] >= 2.9
        assert s0["ketones_mmol_L"] - s1["ketones_mmol_L"] >= 0.49
        assert s1["hco3_mmol_L"] - s0["hco3_mmol_L"] >= 2.9
        assert s1["potassium_mmol_L"] < s0["potassium_mmol_L"]

    def test_resolves_and_stays_bounded(self):
        tx = [Treatment("insulin_infusion", 1.0), Treatment("iv_fluids", 0.5), Treatment("potassium_replacement", 2.0)]
        # ketones 7.5 mmol/L falling 0.5 mmol/L/h need about 15 h of insulin (JBDS: resolved by 24 h)
        s = k.dka_state(20.0, 0.9, tx)
        assert s["resolved"] == 1.0
        assert k.dka_state(8.0, 0.9, tx)["resolved"] == 0.0
        assert s["glucose_mmol_L"] >= 10.0 and s["potassium_mmol_L"] >= 4.0
        assert k.BOUNDS["ph"][0] <= s["ph"] <= k.BOUNDS["ph"][1]

    def test_winters_and_hh(self):
        assert abs(k.winters_pco2(10.0) - 23.0) < 1e-9
        assert abs(k.henderson_hasselbalch_ph(24.0, 40.0) - 7.40) < 0.01


# --------------------------------------------------------------------------- potassium
class TestPotassium:
    def test_insulin_dextrose_nadir_within_ukka_band_then_rebounds(self):
        tx = [Treatment("insulin_dextrose", 0.0)]
        drop = 6.8 - k.potassium(1.0, 6.8, tx)
        assert 0.65 <= drop <= 1.0
        assert k.potassium(8.0, 6.8, tx) == pytest.approx(6.8)

    def test_calcium_does_not_shift_and_dialysis_normalises(self):
        assert k.potassium(1.0, 6.8, [Treatment("calcium_gluconate", 0.0)]) == pytest.approx(6.8)
        assert k.potassium(4.0, 7.5, [Treatment("dialysis", 0.0)]) < 4.5

    def test_acidosis_raises_potassium(self):
        assert k.potassium(0.0, 4.0, ph_change=-0.1) == pytest.approx(4.6)


# --------------------------------------------------------------------------- haemoglobin
class TestHemoglobin:
    def test_acute_loss_lags_then_falls(self):
        early = k.hemoglobin_hemorrhage(0.25, 14.0, 1500.0)
        late = k.hemoglobin_hemorrhage(24.0, 14.0, 1500.0)
        assert early > 13.0 and late < early
        assert late == pytest.approx(14.0 * (1 - 1500 / 4900), abs=0.3)

    def test_fluids_dilute_and_prbc_raise(self):
        base = k.hemoglobin_hemorrhage(6.0, 14.0, 1000.0)
        diluted = k.hemoglobin_hemorrhage(6.0, 14.0, 1000.0, [Treatment("iv_fluids", 1.0, amount=2.0)])
        transfused = k.hemoglobin_hemorrhage(6.0, 14.0, 1000.0, [Treatment("prbc", 1.0, amount=2.0)])
        assert diluted < base
        assert transfused == pytest.approx(base + 2.0, abs=0.01)

    def test_bounded(self):
        assert k.hemoglobin_hemorrhage(48.0, 14.0, 6000.0) >= k.BOUNDS["hemoglobin_g_dL"][0]


# --------------------------------------------------------------------------- oxygen
class TestOxygen:
    def test_severinghaus_landmarks(self):
        assert k.severinghaus_spo2(100.0) > 97.0
        assert 88.0 < k.severinghaus_spo2(60.0) < 92.0
        assert 70.0 < k.severinghaus_spo2(40.0) < 78.0

    def test_healthy_room_air(self):
        o = k.oxygenation(0.0)
        assert 85 <= o["pao2_mmHg"] <= 105 and o["spo2_pct"] >= 96

    def test_oxygen_improves_saturation(self):
        ra = k.oxygenation(0.8)
        nrb = k.oxygenation(0.8, [Treatment("oxygen", 0.0, note="non_rebreather")], t_h=1.0)
        fio2 = k.oxygenation(0.8, [Treatment("oxygen", 0.0, amount=0.6)], t_h=1.0)
        assert ra["spo2_pct"] < 92
        assert nrb["spo2_pct"] > ra["spo2_pct"] and nrb["fio2"] == 0.85
        assert fio2["fio2"] == 0.6

    def test_venous_offsets(self):
        v = k.venous_from_arterial(7.40, 40.0, 24.0, 95.0)
        assert v["ph"] == pytest.approx(7.37)
        assert v["pco2_mmHg"] == 45 and v["hco3_mmol_L"] == pytest.approx(22.8)
        assert 25 <= v["po2_mmHg"] <= 45


# --------------------------------------------------------------------------- paracetamol
class TestParacetamol:
    def test_nomogram_line_endpoints(self):
        assert k.paracetamol_nomogram_line(4.0) == pytest.approx(100.0)
        assert k.paracetamol_nomogram_line(15.0) == pytest.approx(15.0, abs=0.2)
        assert k.paracetamol_nomogram_line(3.0) is None and k.paracetamol_nomogram_line(25.0) is None
        assert k.paracetamol_nomogram_line(4.0, line="us") == pytest.approx(150.0)

    def test_large_overdose_is_above_line_and_bounded(self):
        r = k.paracetamol_level(4.0, 30000.0, weight_kg=70.0)
        assert r["interpretable"] and r["above_line"] is True
        assert r["level_mg_L"] <= k.BOUNDS["paracetamol_mg_L"][1]

    def test_therapeutic_dose_below_line_and_nac_flag(self):
        r = k.paracetamol_level(4.0, 1000.0, treatments=[Treatment("nac", 3.0)])
        assert r["above_line"] is False and r["nac_started"] is True
        assert r["level_mg_L"] < 20.0

    def test_level_declines_over_time(self):
        vals = [k.paracetamol_level(t, 20000.0)["level_mg_L"] for t in (4, 8, 12, 16)]
        assert _monotone(vals, False)

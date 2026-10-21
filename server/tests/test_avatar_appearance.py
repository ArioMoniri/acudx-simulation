"""Per-case patient appearance: signs read from the server case state only, the severity ladder, the
edit prompt for the image generator, the variant choice that never shows a sign the patient does not
have now, and the voice style that goes with it."""

from __future__ import annotations

from server.voice.avatar import appearance as ap


def _spec(**over):
    spec = {
        "demographics": {"age": 64, "sex": "female"},
        "chief_complaint_en": "fever and shaking chills since last night",
        "triage_note": "Febrile, looks unwell.",
        "acuity_esi": 2,
        "exam": [
            {"maneuver": "general", "finding_en": "Flushed and diaphoretic, warm to touch.", "abnormal": True},
            {"maneuver": "chest", "finding_en": "Coarse crackles at the right base.", "abnormal": True},
        ],
        "hpi": [{"intent": "onset", "answer_en": "I started coughing two days ago."}],
        "triage_vitals": {"hr": 112, "systolic": 104, "diastolic": 62, "rr": 24, "spo2": 93, "tempC": 39.2},
    }
    spec.update(over)
    return spec


def _director(**snap):
    bedside = {"skin": "warm", "mottling": 0, "pain": 3, "gcs": 15, "pulse": True}
    bedside.update(snap.pop("bedside", {}))
    vitals = {"hr": 112, "systolic": 104, "diastolic": 62, "rr": 24, "spo2": 93, "tempC": 39.2}
    vitals.update(snap.pop("vitals", {}))
    affect = {"pain": 3, "consciousness": "alert"}
    affect.update(snap.pop("affect", {}))
    return {"vitals": vitals, "affect": affect,
            "snapshot": {"vitals": vitals, "bedside": bedside, "phase": snap.pop("phase", "deteriorating"),
                         "severity": snap.pop("severity", 0.4), "findings": snap.pop("findings", [])}}


def test_fever_case_reads_flush_sweat_and_breathlessness_from_the_case():
    look = ap.look_from_case(_spec(), _director())
    assert look.signs["fever_flush"] == 2          # 39.2 C
    assert look.signs["diaphoresis"] >= 1          # "diaphoretic" in the exam text
    assert look.signs["resp_distress"] == 1        # rr 24
    assert "jaundice" not in look.signs and "cyanosis" not in look.signs and "mottling" not in look.signs
    assert look.cough is True                       # "coughing" in the history
    assert look.identity == {"age": 64, "sex": "female", "ethnicity": None}


def test_no_sign_is_invented_without_case_evidence():
    spec = _spec(exam=[], hpi=[], chief_complaint_en="ankle pain after a fall", triage_note="Walked in.",
                 triage_vitals={"hr": 80, "systolic": 128, "diastolic": 80, "rr": 16, "spo2": 98, "tempC": 36.8})
    d = _director(vitals={"hr": 80, "rr": 16, "spo2": 98, "tempC": 36.8, "systolic": 128}, phase="stable",
                  severity=0.0, affect={"pain": 6}, bedside={"pain": 6})
    look = ap.look_from_case(spec, d)
    assert set(look.signs) == {"pain"}
    assert look.cough is False


def test_live_shock_and_arrest_states_come_from_the_director_snapshot():
    mottled = ap.look_from_case(_spec(), _director(bedside={"skin": "mottled", "mottling": 3}, vitals={"systolic": 78},
                                                   phase="peri_arrest", severity=0.9))
    assert mottled.signs["mottling"] == 2 and mottled.signs["pallor"] >= 1
    arrest = ap.look_from_case(_spec(), _director(bedside={"pulse": False, "gcs": 3}, phase="arrest",
                                                  affect={"consciousness": "unresponsive"}))
    assert arrest.signs.get("unresponsive") == 2 and arrest.phase == "arrest"


def test_ethnicity_is_used_only_when_the_case_gives_it():
    look = ap.look_from_case(_spec(demographics={"age": 30, "sex": "male", "ethnicity": "Turkish"}), _director())
    assert look.identity["ethnicity"] == "Turkish"
    assert "Turkish" in ap.edit_prompt(look)


def test_edit_prompt_keeps_identity_and_lists_only_the_changes():
    look = ap.look_from_case(_spec(), _director())
    p = ap.edit_prompt(look)
    assert "same person" in p.lower() and "mouth closed" in p.lower()
    assert "flushed" in p and "sweat" in p and "breath" in p
    assert "jaundice" not in p.lower() and "yellow" not in p.lower() and "blue" not in p.lower()
    assert "—" not in p


def test_look_key_is_stable_and_level_sensitive():
    a = ap.look_from_case(_spec(), _director())
    b = ap.look_from_case(_spec(), _director())
    c = ap.look_from_case(_spec(), _director(vitals={"tempC": 38.2}))
    assert a.key == b.key and a.key != c.key and len(a.key) == 10


def test_ladder_has_three_or_four_distinct_severity_states_from_improved_to_critical():
    look = ap.look_from_case(_spec(), _director())
    ladder = ap.ladder(look)
    names = [n for n, _ in ladder]
    assert names[:4] == ["presenting", "worse", "critical", "improved"] or set(names) <= {
        "presenting", "worse", "critical", "improved", "unresponsive"}
    assert 3 <= len(ladder) <= 5
    keys = [lk.key for _, lk in ladder]
    assert len(set(keys)) == len(keys)
    improved = dict(ladder)["improved"]
    assert improved.signs.get("fever_flush", 0) < look.signs["fever_flush"]
    assert "diaphoresis" in improved.signs or "diaphoresis" in look.signs  # text findings stay until improved
    assert dict(ladder).get("unresponsive") is not None    # ESI 2: arrest frame prepared up front


def test_choose_variant_never_shows_a_sign_the_patient_does_not_have_now():
    look = ap.look_from_case(_spec(), _director())
    ladder = dict(ap.ladder(look))
    prepared = {lk.key: lk for lk in ladder.values()}
    # Improving patient: the "worse" picture would show more than is there, so it is never chosen.
    better = ap.look_from_case(_spec(), _director(vitals={"tempC": 38.1, "rr": 18, "spo2": 96}, phase="improving"))
    pick = ap.choose_variant(better, prepared)
    assert pick is not None
    assert all(better.signs.get(s, 0) >= lvl for s, lvl in pick.signs.items())
    exact = ap.choose_variant(look, prepared)
    assert exact is not None and exact.key == look.key


def test_choose_variant_returns_none_when_nothing_prepared_fits():
    look = ap.look_from_case(_spec(exam=[], hpi=[], chief_complaint_en="headache", triage_note="",
                                   triage_vitals={"tempC": 36.9, "rr": 14, "spo2": 99}),
                             _director(vitals={"tempC": 36.9, "rr": 14, "spo2": 99}, phase="stable", affect={"pain": 2}))
    worse = ap.Look(signs={"pain": 2, "fever_flush": 1}, phase="deteriorating", identity=look.identity)
    pick = ap.choose_variant(look, {worse.key: worse})
    assert pick is None


def test_voice_style_follows_the_look():
    calm = ap.voice_style(ap.Look(signs={}, phase="stable", identity={}))
    assert calm["speed"] == 1.0 and calm["silent"] is False and calm["persona_lines"] == []
    breathless = ap.voice_style(ap.Look(signs={"resp_distress": 2, "pain": 2}, phase="deteriorating", identity={},
                                        cough=True))
    assert breathless["speed"] < 1.0
    joined = " ".join(breathless["persona_lines"])
    assert "short" in joined and "breath" in joined and "pain" in joined and "cough" in joined
    gone = ap.voice_style(ap.Look(signs={"unresponsive": 2}, phase="arrest", identity={}))
    assert gone["silent"] is True


def test_speakable_turns_cough_markers_into_sounds_and_drops_stage_directions():
    assert ap.speakable("I... (cough) can't breathe", "en") == "I... ahem, can't breathe"
    assert ap.speakable("Nefes... (öksürük) alamıyorum", "tr") == "Nefes... öhö, alamıyorum"
    assert ap.speakable("*winces* It hurts", "en") == "It hurts"

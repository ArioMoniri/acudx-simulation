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


def test_negated_and_peripheral_findings_are_not_drawn():
    """Live case 2026-10-21 (pneumonia, model-authored): "no signs of cyanosis or clubbing" and
    "Cyanosis noted around the nail" must not put blue lips on the face; "accessory muscles" must."""
    spec = _spec(exam=[
        {"maneuver": "general", "finding_en": "Appears unwell, diaphoretic. Skin warm, no signs of cyanosis or clubbing."},
        {"maneuver": "resp", "finding_en": "Using accessory muscles of respiration."},
        {"maneuver": "hands", "finding_en": "Cyanosis noted around the nail beds."},
        {"maneuver": "abd", "finding_en": "Not jaundiced. No pallor."},
    ], hpi=[], chief_complaint_en="Cough and fever for three days", triage_note="")
    look = ap.look_from_case(spec, _director(vitals={"spo2": 93}))
    assert "cyanosis" not in look.signs and "jaundice" not in look.signs and "pallor" not in look.signs
    assert look.signs.get("accessory_muscles") == 1 and look.signs.get("diaphoresis") == 1
    central = ap.look_from_case(_spec(exam=[{"maneuver": "g", "finding_en": "Central cyanosis of the lips."}], hpi=[]),
                                _director())
    assert central.signs.get("cyanosis") == 1


def test_arrival_text_signs_go_once_the_live_vitals_settle():
    spec = _spec(exam=[{"maneuver": "g", "finding_en": "Tachypnoeic, using accessory muscles, diaphoretic."}])
    sick = ap.look_from_case(spec, _director(vitals={"rr": 22, "spo2": 93}))
    assert sick.signs.get("resp_distress") == 1 and sick.signs.get("accessory_muscles") == 1
    well = ap.look_from_case(spec, _director(vitals={"rr": 16, "spo2": 97, "tempC": 37.2}, phase="improving"))
    assert not {"resp_distress", "accessory_muscles", "diaphoresis", "fever_flush"} & set(well.signs)


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
    assert "feverish" in p and "no rash" in p and "sweat" in p and "breath" in p
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


def _afebrile(**over):
    v = {"hr": 88, "systolic": 124, "diastolic": 76, "rr": 16, "spo2": 98, "tempC": 36.9}
    return _spec(triage_vitals=v, chief_complaint_en="", triage_note="", hpi=[], exam=over.pop("exam", []), **over)


def _exam(text):
    return [{"maneuver": "general", "finding_en": text, "abnormal": True}]


def test_visible_findings_the_case_states_are_drawn_in_en_and_tr():
    cases = {
        "petechiae": "Scattered petechiae over the face and chest.",
        "purpura": "Non-blanching purpuric rash on the trunk and face.",
        "urticaria": "Widespread urticaria, raised wheals on the neck.",
        "scleral_icterus": "Scleral icterus noted.",
        "flushing": "Face flushed, lips swelling.",
        "periorbital_oedema": "Periorbital oedema, worse in the morning.",
        "facial_droop": "Right-sided facial droop and slurred speech.",
        "facial_swelling": "Lip swelling and tongue swelling (angioedema).",
        "dehydration": "Dry mucous membranes and sunken eyes.",
        "wound": "A 3 cm laceration on the left forehead.",
        "burn": "Partial-thickness burns to the face and neck, singed eyebrows.",
    }
    for sign, text in cases.items():
        look = ap.look_from_case(_afebrile(exam=_exam(text)), None)
        assert look.signs.get(sign), (sign, look.signs)
        prompt = ap.edit_prompt(look)
        assert ap._PHRASES[sign][0] in prompt
    tr = {"petechiae": "Yüzde ve göğüste peteşiler.", "urticaria": "Boyunda ürtiker plakları.",
          "facial_droop": "Sağ tarafta yüzde kayma var.", "dehydration": "Ağız kuruluğu ve çökük gözler."}
    for sign, text in tr.items():
        assert ap.look_from_case(_afebrile(exam=[{"maneuver": "general", "finding_en": text}]), None).signs.get(sign), sign


def test_new_findings_are_never_invented_negated_or_drawn_off_the_portrait():
    assert not ap.look_from_case(_afebrile(exam=_exam("No petechiae, no rash, no urticaria.")), None).signs
    assert not ap.look_from_case(_afebrile(exam=_exam("No facial droop.")), None).signs
    # A wound on the leg does not show on a head-and-shoulders portrait.
    assert "wound" not in ap.look_from_case(_afebrile(exam=_exam("A 3 cm laceration on the left shin.")), None).signs
    assert "burn" not in ap.look_from_case(_afebrile(exam=_exam("Burns to both hands.")), None).signs
    # A febrile flushed face is the fever flush, not a second flush sign.
    assert "flushing" not in ap.look_from_case(_spec(), _director()).signs


def test_edit_prompt_carries_our_guardrails_and_drops_clear_skin_for_a_rash():
    plain = ap.edit_prompt(ap.look_from_case(_afebrile(exam=_exam("Dry mucous membranes.")), None))
    assert "fully clothed" in plain and "no nudity" in plain and "nothing sexual" in plain and "no blood" in plain
    assert "no rash" in plain
    rash = ap.edit_prompt(ap.look_from_case(_afebrile(exam=_exam("Non-blanching purpuric rash.")), None))
    assert "no rash" not in rash and "non-blanching" in rash
    wound = ap.edit_prompt(ap.look_from_case(_afebrile(exam=_exam("Laceration on the forehead.")), None))
    assert "no blood" not in wound and "fully clothed" in wound


def test_older_look_keys_are_unchanged_by_the_new_signs():
    look = ap.Look(signs={"fever_flush": 2, "diaphoresis": 1})
    import hashlib

    assert look.key == hashlib.sha256(b"fever_flush2,diaphoresis1").hexdigest()[:10]

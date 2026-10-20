"""The persona consumes the Clinical Director's live state (review 06a 2.2 and 4.5)."""

from __future__ import annotations

from server.persona import build_patient_turn, live_state_lines


def _user_block(case_state: dict) -> str:
    return build_patient_turn(case_state, {"name": "Ayse"}, [], "How are you feeling now?")[-1]["content"]


def test_deterioration_changes_what_the_patient_is_told_about_themselves():
    arrival = _user_block({"vitals_adjectives": ["vitals within usual limits"],
                           "affect": {"pain": 3, "dyspnea": 0.1, "consciousness": "alert", "mood_en": "worried"}})
    worse = _user_block({"vitals_adjectives": ["tachycardic", "hypotensive", "severely hypoxic"],
                         "affect": {"pain": 8, "dyspnea": 0.8, "consciousness": "drowsy", "mood_en": "frightened"},
                         "complications": ["missed_time_critical_treatment"]})
    assert "struggling" not in arrival and "few words" in worse and "faint" in worse
    assert "drowsy" in worse and "pain is severe" in worse and "worse than when you arrived" in worse
    assert "your mood: frightened" in worse


def test_live_state_never_hands_the_persona_a_number_or_a_label():
    lines = live_state_lines({"vitals_adjectives": ["hypoxic", "febrile"], "affect": {"pain": 9}})
    text = " ".join(lines)
    assert not any(ch.isdigit() for ch in text)
    assert "hypoxic" not in text and "febrile" not in text


def test_a_high_fever_is_never_voiced_as_low_grade():
    """Live case 2026-10-20: triage 39.2 C, the patient said 'a low-grade fever'."""
    block = _user_block({"vitals_adjectives": ["febrile", "high fever"]})
    assert "high fever" in block and "never call it a low-grade fever" in block
    assert "Never describe your symptoms as milder" in block


def test_improvement_is_voiced_too():
    assert "the pain has eased a lot" in live_state_lines({"affect": {"pain": 1, "consciousness": "alert"}})


def test_live_state_stays_out_of_the_cacheable_system_block():
    a = build_patient_turn({"vitals_adjectives": ["tachycardic"]}, {"name": "A"}, [], "hi")
    b = build_patient_turn({"vitals_adjectives": ["hypotensive"]}, {"name": "A"}, [], "hi")
    assert a[0] == b[0]          # byte-stable system prefix
    assert a[-1] != b[-1]


def test_only_sanctioned_facts_are_offered_verbatim():
    msgs = build_patient_turn({"sanctioned_facts": ["It started this morning."]}, None, [], "When did it start?")
    assert "It started this morning." in msgs[-1]["content"]
    none = build_patient_turn({}, None, [], "When did it start?")
    assert "(none" in none[-1]["content"]

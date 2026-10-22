"""FactAssertionGate in English and Turkish (server/persona.py, docs/architecture/01 section 6).

Production 2026-10-21: Turkish replies carried numbers the gate did not see ("39,4 derece", "%92",
"140'a 90"), so a number the patient cannot know reached the call's voice."""

from __future__ import annotations

import pytest

from server.persona import fact_assertion_gate


def gate(text: str, facts: list[str] | None = None):
    return fact_assertion_gate(text, {"sanctioned_facts": facts or []})


@pytest.mark.parametrize("text", [
    "My temperature was 39.4 degrees this morning.",
    "They said my oxygen was 92%.",
    "My blood pressure is 140/90.",
    "My blood pressure was 140 over 90 at home.",
    "My pulse is 120 beats per minute.",
    "I took 500 mg of paracetamol.",
    "I took 500 milligrams of paracetamol.",
    "My sugar was 250 this morning.",
    "My sats were 88.",
    "My temp is 39,4.",
])
def test_english_numbers_are_flagged(text: str) -> None:
    r = gate(text)
    assert not r.passed, text
    assert any(f.type == "numeric_assertion" for f in r.flags)
    assert not any(ch.isdigit() for ch in r.utterance), r.utterance


@pytest.mark.parametrize("text", [
    "Ateşim 39,4 derece çıktı.",
    "Sabah 39,4 dereceydi ateşim.",
    "Ateşim 39.4'tü.",
    "Oksijenim %92 diyorlardı.",
    "Satürasyonum yüzde 88 imiş.",
    "Tansiyonum 140'a 90 çıktı.",
    "Tansiyonum 14'e 9 idi.",
    "Tansiyonum 140/90.",
    "Tansiyonum 140 bölü 90 çıktı.",
    "Nabzım 120 civarındaydı.",
    "Nabzım dakikada 120.",
    "Şekerim 250 çıkmış.",
    "500 mg parol aldım.",
    "İki kere 500 miligram parasetamol içtim.",
    "Kan şekerim 1.200 olmuş.",
    "Potasyumum 6,1 imiş.",
])
def test_turkish_numbers_are_flagged(text: str) -> None:
    r = gate(text)
    assert not r.passed, text
    assert any(f.type == "numeric_assertion" for f in r.flags)
    assert not any(ch.isdigit() for ch in r.utterance), r.utterance


def test_turkish_scrub_is_turkish_and_has_no_dash() -> None:
    r = gate("Ateşim 39,4 derece çıktı, çok üşüyorum.")
    assert "tam sayıyı bilmiyorum" in r.utterance
    assert "—" not in r.utterance and "–" not in r.utterance
    assert "çok üşüyorum" in r.utterance


def test_english_scrub_has_no_dash() -> None:
    r = gate("My temperature was 39.4 degrees, I feel awful.")
    assert "not sure of the exact number" in r.utterance
    assert "—" not in r.utterance and "–" not in r.utterance


@pytest.mark.parametrize("text,facts", [
    ("Hemşire ateşimin 39,4 derece olduğunu söyledi.", ["Hemşire: ateş 39,4 °C"]),
    ("Hemşire ateşimin 39,4 derece olduğunu söyledi.", ["Temperature 39.4 C"]),
    ("Doktor tansiyonumun 140'a 90 olduğunu söyledi.", ["BP 140/90 mmHg"]),
    ("The nurse said my oxygen was 92%.", ["SpO2 92 %"]),
    ("Oksijenim %92 dediler.", ["SpO2 92%"]),
])
def test_sanctioned_numbers_pass(text: str, facts: list[str]) -> None:
    r = gate(text, facts)
    assert r.passed, (text, r.flags)
    assert r.utterance == text


@pytest.mark.parametrize("text", [
    "Üç gündür öksürüyorum, 2 gece hiç uyuyamadım.",
    "I have had this cough for 3 days.",
    "45 yaşındayım, iki çocuğum var.",
    "I'm 45 and I work nights.",
    "Saat 7'de başladı.",
    "It started at 7 this morning.",
])
def test_ordinary_numbers_pass(text: str) -> None:
    r = gate(text)
    assert r.passed, (text, r.flags)


@pytest.mark.parametrize("text", [
    "Bence bende zatürre var.",
    "Kalp krizi geçiriyorum, biliyorum.",
    "I think it's a heart attack.",
])
def test_diagnosis_verdicts_flagged(text: str) -> None:
    r = gate(text)
    assert any(f.type == "diagnosis_assertion" for f in r.flags), text


def test_fear_of_a_diagnosis_is_not_a_verdict() -> None:
    assert gate("Kalp krizi olmasından korkuyorum.").passed
    assert gate("I'm scared it could be my heart.").passed

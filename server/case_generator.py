"""AcuDx Gateway — dynamic clinical case synthesis (effectively unlimited cases).

Turns a sampled condition (``server/condition_catalog.py``) into a full,
structured ``GeneratedCaseSpec`` for the simulator. The open model does the
*creative* work (bilingual phrasing, plausible findings, a coherent narrative);
the catalog entry and this module supply the *spine* (ICD/DSM codes, the fixed
intent/maneuver vocabularies, the deterministic templated fallback).

Design guarantees
-----------------
* **One bounded model call per request.** ``gateway.chat(task="case")`` with a
  capped ``max_tokens`` and ``temperature≈0.6`` — no loops, no batches, CPU-safe.
* **Never hard-fails.** The model output is parsed robustly (code-fence tolerant),
  gap-filled from a complete deterministic template, then validated with pydantic.
  On *any* failure — model unreachable (AIRGAPPED egress guard, timeout, 5xx),
  unparseable JSON, or a schema violation — the deterministic templated spec is
  returned instead. Callers always get a schema-valid 200.
* **Authoritative codes.** After validation the condition block, seed and locale
  are overwritten from the catalog/constraints so the model can never inject a
  wrong ICD code.
* **Vocabulary-aligned.** ``intent`` ∈ the frontend's ``QuestionIntent`` set and
  ``maneuver`` ∈ its ``ExamManeuver`` set (``web/src/domain/case.ts``); unknown
  values coerce to a safe member rather than failing the whole spec.

``GeneratedCaseSpec`` (the returned dict, plus a non-schema ``meta`` block)::

    {
      seed, locale,
      condition: {icd11, icd10, dsm5tr?, label_en, label_tr, system},
      demographics: {age, sex, name_hint},
      chief_complaint_en, chief_complaint_tr,
      acuity_esi (1-5), difficulty (1-5),
      hpi: [{intent, answer_en, answer_tr, red_flag?}],
      pmh_en, pmh_tr, meds_en, meds_tr, allergies_en, allergies_tr,
      exam: [{maneuver, system_en, system_tr, finding_en, finding_tr, abnormal}],
      triage_vitals: {hr, systolic, diastolic, rr, spo2, tempC},
      vitals_trajectory: [{atMs, hr, systolic, diastolic, rr, spo2, tempC}],
      labs: [{code, label_en, label_tr, value, unit, ref_low, ref_high, flag, category}],
      imaging: [{code, modality_en, modality_tr, findings_en, findings_tr,
                 image_query_en, image_query_tr}],
      treatments: [{code, label_en, label_tr,
                    appropriateness: "indicated"|"contraindicated"|"neutral",
                    effects: [{key, delta, onsetMs}], narrative_en, narrative_tr}],
      disposition,
      guideline_anchors: [{statement_en, statement_tr, source, citation}],
      meta: {source: "model"|"template", model, latency_ms, degraded, note?}
    }

Typical latency on the pod's local Qwen2.5-7B (llama-server): ~3-12 s for the
model path (bounded by ``max_tokens``); the templated fallback is sub-millisecond.

Education only. Synthetic patients. No real patient-data path.
"""

from __future__ import annotations

import json
import random
import re
import time
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator

from server.condition_catalog import sample_condition

# --------------------------------------------------------------------------- #
# Frontend-aligned controlled vocabularies (web/src/domain/case.ts).           #
# --------------------------------------------------------------------------- #
INTENTS: tuple[str, ...] = (
    "onset", "location", "character", "radiation", "severity", "timing",
    "aggravating", "relieving", "associated-symptoms", "red-flags",
    "past-medical-history", "medications", "allergies", "family-history",
    "social-history", "risk-factors", "ice",
)
MANEUVERS: tuple[str, ...] = (
    "general-inspection", "vitals-recheck", "cardiovascular", "respiratory",
    "abdominal", "neurological", "musculoskeletal", "skin", "ent", "focused-special",
)
APPROPRIATENESS: tuple[str, ...] = ("indicated", "contraindicated", "neutral")
DISPOSITIONS: tuple[str, ...] = (
    "admit-ccu", "admit-ward", "admit-icu", "operating-room",
    "observation", "discharge", "refer-specialty",
)

MAX_TOKENS = 1600          # bounded — one call, CPU-friendly
TEMPERATURE = 0.6


# --------------------------------------------------------------------------- #
# Lenient coercion helpers (shared by the pydantic validators).                #
# --------------------------------------------------------------------------- #
def _to_int(v: Any, default: int = 0) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


# --------------------------------------------------------------------------- #
# Pydantic schema — the validation gate (v2).                                  #
# --------------------------------------------------------------------------- #
class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ConditionRef(_Base):
    icd11: str = ""
    icd10: str = ""
    dsm5tr: Optional[str] = None
    label_en: str
    label_tr: str
    system: str


class Demographics(_Base):
    age: int
    sex: str
    name_hint: str

    @field_validator("age", mode="before")
    @classmethod
    def _age(cls, v: Any) -> int:
        return _clamp(_to_int(v, 45), 1, 105)

    @field_validator("sex", mode="before")
    @classmethod
    def _sex(cls, v: Any) -> str:
        s = str(v or "").strip().lower()
        return s if s in ("male", "female", "other") else "female"


class HpiItem(_Base):
    intent: str
    answer_en: str
    answer_tr: str
    red_flag: bool = False

    @field_validator("intent", mode="before")
    @classmethod
    def _intent(cls, v: Any) -> str:
        s = str(v or "").strip().lower().replace("_", "-").replace(" ", "-")
        return s if s in INTENTS else "associated-symptoms"


class ExamItem(_Base):
    maneuver: str
    system_en: str
    system_tr: str
    finding_en: str
    finding_tr: str
    abnormal: bool = False

    @field_validator("maneuver", mode="before")
    @classmethod
    def _maneuver(cls, v: Any) -> str:
        s = str(v or "").strip().lower().replace("_", "-").replace(" ", "-")
        return s if s in MANEUVERS else "focused-special"


class Vitals(_Base):
    hr: int
    systolic: int
    diastolic: int
    rr: int
    spo2: int
    tempC: float

    @field_validator("hr", "systolic", "diastolic", "rr", "spo2", mode="before")
    @classmethod
    def _ints(cls, v: Any) -> int:
        return _to_int(v)

    @field_validator("tempC", mode="before")
    @classmethod
    def _temp(cls, v: Any) -> float:
        try:
            return round(float(v), 1)
        except (TypeError, ValueError):
            return 37.0


class VitalsPoint(Vitals):
    atMs: int

    @field_validator("atMs", mode="before")
    @classmethod
    def _atms(cls, v: Any) -> int:
        return max(0, _to_int(v))


class Lab(_Base):
    code: str = ""
    label_en: str
    label_tr: str
    value: float | str
    unit: str = ""
    ref_low: float | str | None = None
    ref_high: float | str | None = None
    flag: str = "N"
    category: str = "chemistry"


class Imaging(_Base):
    code: str = ""
    modality_en: str
    modality_tr: str
    findings_en: str
    findings_tr: str
    image_query_en: str = ""
    image_query_tr: str = ""


class TreatmentEffect(_Base):
    key: str
    delta: float
    onsetMs: int

    @field_validator("delta", mode="before")
    @classmethod
    def _delta(cls, v: Any) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    @field_validator("onsetMs", mode="before")
    @classmethod
    def _onset(cls, v: Any) -> int:
        return max(0, _to_int(v))


class Treatment(_Base):
    code: str = ""
    label_en: str
    label_tr: str
    appropriateness: str = "neutral"
    effects: list[TreatmentEffect] = []
    narrative_en: str = ""
    narrative_tr: str = ""

    @field_validator("appropriateness", mode="before")
    @classmethod
    def _appr(cls, v: Any) -> str:
        s = str(v or "").strip().lower()
        return s if s in APPROPRIATENESS else "neutral"


class GuidelineAnchor(_Base):
    statement_en: str
    statement_tr: str
    source: str = ""
    citation: str = ""


class GeneratedCaseSpec(_Base):
    seed: int
    locale: str = "en"
    condition: ConditionRef
    demographics: Demographics
    chief_complaint_en: str
    chief_complaint_tr: str
    acuity_esi: int
    difficulty: int
    hpi: list[HpiItem]
    pmh_en: str = ""
    pmh_tr: str = ""
    meds_en: str = ""
    meds_tr: str = ""
    allergies_en: str = ""
    allergies_tr: str = ""
    exam: list[ExamItem]
    triage_vitals: Vitals
    vitals_trajectory: list[VitalsPoint] = []
    labs: list[Lab] = []
    imaging: list[Imaging] = []
    treatments: list[Treatment] = []
    disposition: str = "observation"
    guideline_anchors: list[GuidelineAnchor] = []

    @field_validator("acuity_esi", "difficulty", mode="before")
    @classmethod
    def _band(cls, v: Any) -> int:
        return _clamp(_to_int(v, 3), 1, 5)


# --------------------------------------------------------------------------- #
# Deterministic template profiles (per body system, with a DEFAULT fallback).  #
# --------------------------------------------------------------------------- #
_MALE_NAMES = ["Ahmet Y.", "Mehmet D.", "Mustafa K.", "Emre Ş.", "Can A.", "Burak Ç.", "Ali T.", "Hasan Ö."]
_FEMALE_NAMES = ["Elif D.", "Ayşe Ş.", "Zeynep K.", "Fatma Y.", "Deniz A.", "Merve A.", "Selin B.", "Naz Ü."]

# hr / systolic / diastolic / rr / spo2 / tempC bands by ESI acuity (1 sickest).
_ACUITY_BANDS: dict[int, dict[str, tuple[float, float]]] = {
    1: {"hr": (98, 128), "systolic": (88, 150), "diastolic": (55, 92), "rr": (22, 30), "spo2": (88, 95), "tempC": (36.0, 39.2)},
    2: {"hr": (90, 118), "systolic": (100, 160), "diastolic": (66, 98), "rr": (18, 26), "spo2": (91, 97), "tempC": (36.2, 38.8)},
    3: {"hr": (80, 108), "systolic": (108, 152), "diastolic": (68, 92), "rr": (16, 22), "spo2": (93, 98), "tempC": (36.3, 38.3)},
    4: {"hr": (70, 98), "systolic": (110, 142), "diastolic": (70, 88), "rr": (14, 20), "spo2": (95, 99), "tempC": (36.3, 37.6)},
    5: {"hr": (64, 92), "systolic": (110, 136), "diastolic": (70, 86), "rr": (12, 18), "spo2": (96, 100), "tempC": (36.3, 37.2)},
}


def _profile(system: str) -> dict[str, Any]:
    """Per-system template scaffold (exam target, age band, labs, imaging,
    treatments, guideline anchor). Falls back to a sane emergency default."""
    P = _PROFILES.get(system)
    return P if P is not None else _PROFILES["_default"]


# Each labs entry: (code, en, tr, value, unit, ref_low, ref_high, flag, category)
_PROFILES: dict[str, dict[str, Any]] = {
    "cardiology": {
        "maneuver": "cardiovascular", "system_en": "Cardiovascular", "system_tr": "Kardiyovasküler",
        "age": (48, 82),
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 180, "ng/L", 0, 14, "HH", "cardiac"),
            ("2160-0", "Creatinine", "Kreatinin", 1.1, "mg/dL", 0.6, 1.3, "N", "chemistry"),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Dynamic ST-T changes without ST elevation.", "ST yükselmesi olmadan dinamik ST-T değişiklikleri.",
                    "ischemic ECG ST depression 12-lead", "iskemik EKG ST çökmesi 12 derivasyon"),
        "treatments": [
            ("asa", "Aspirin 300 mg PO", "Aspirin 300 mg PO", "indicated", [("pain", -1.0, 600000)], "Loading aspirin for suspected ACS.", "Şüpheli AKS için aspirin yükleme."),
            ("gtn", "Sublingual nitrate", "Dilaltı nitrat", "indicated", [("pain", -2.0, 300000), ("systolic", -8.0, 300000)], "Nitrate eases ischaemic chest pain.", "Nitrat iskemik göğüs ağrısını azaltır."),
            ("thrombolysis", "Empiric thrombolysis", "Ampirik tromboliz", "contraindicated", [], "Not indicated without STEMI confirmation.", "STEMI doğrulanmadan endike değildir."),
        ],
        "guide": ("ESC", "2023 ESC ACS Guidelines (summary)", "Obtain a 12-lead ECG within 10 minutes and serial troponin for suspected ACS.", "Şüpheli AKS'de 10 dakika içinde EKG ve seri troponin alın."),
    },
    "pulmonology": {
        "maneuver": "respiratory", "system_en": "Respiratory", "system_tr": "Solunum",
        "age": (30, 78),
        "labs": [
            ("2703-7", "Arterial pO2", "Arteriyel pO2", 62, "mmHg", 80, 100, "L", "blood-gas"),
            ("48065-7", "D-dimer", "D-dimer", 1200, "ng/mL", 0, 500, "H", "coagulation"),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Focal opacity with preserved cardiac silhouette.", "Kalp silüeti korunmuş fokal opasite.",
                    "chest x-ray focal consolidation", "akciğer grafisi fokal konsolidasyon"),
        "treatments": [
            ("o2", "Controlled oxygen to target SpO2", "Hedef SpO2'ye kontrollü oksijen", "indicated", [("spo2", 4.0, 120000)], "Titrated oxygen corrects hypoxia.", "Titre edilen oksijen hipoksiyi düzeltir."),
            ("salbutamol", "Nebulised bronchodilator", "Nebülize bronkodilatör", "indicated", [("rr", -4.0, 300000)], "Relieves bronchospasm.", "Bronkospazmı giderir."),
            ("routine_abx", "Routine antibiotics for all comers", "Herkese rutin antibiyotik", "neutral", [], "Reserve antibiotics for a bacterial source.", "Antibiyotiği bakteriyel kaynak için saklayın."),
        ],
        "guide": ("NICE", "NICE respiratory guidance (summary)", "Give controlled oxygen titrated to a target SpO2 range and treat the underlying cause.", "Hedef SpO2 aralığına titre edilmiş kontrollü oksijen verin ve altta yatan nedeni tedavi edin."),
    },
    "gastroenterology": {
        "maneuver": "abdominal", "system_en": "Abdominal", "system_tr": "Karın",
        "age": (18, 70),
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 15.2, "10^9/L", 4.0, 11.0, "H", "haematology"),
            ("1988-5", "C-reactive protein", "CRP", 68, "mg/L", 0, 5, "H", "chemistry"),
            ("1742-6", "Alanine aminotransferase", "ALT", 40, "U/L", 0, 40, "N", "chemistry"),
        ],
        "imaging": ("24558-9", "Abdominal ultrasound", "Karın ultrasonu",
                    "Inflammatory change in the region of pain.", "Ağrı bölgesinde enflamatuar değişiklik.",
                    "abdominal ultrasound inflammation", "karın ultrasonu enflamasyon"),
        "treatments": [
            ("analgesia", "IV analgesia + antiemetic", "IV analjezi + antiemetik", "indicated", [("pain", -3.0, 300000)], "Analgesia and antiemetic for acute abdomen.", "Akut karında analjezi ve antiemetik."),
            ("iv_fluids", "IV crystalloid", "IV kristaloid", "indicated", [("hr", -8.0, 600000), ("systolic", 6.0, 600000)], "Rehydration for vomiting / poor intake.", "Kusma / az alım için rehidrasyon."),
            ("oral_intake", "Encourage oral intake", "Oral alımı teşvik", "contraindicated", [], "Keep nil by mouth if surgery is possible.", "Cerrahi olasıysa ağızdan almayın."),
        ],
        "guide": ("TEPDAD", "Acute abdomen — undergraduate summary", "Assess with bloods and imaging, keep nil by mouth if surgery is likely, and involve surgery early.", "Kan ve görüntülemeyle değerlendirin, cerrahi olasıysa ağızdan almayın ve cerrahiyi erken dahil edin."),
    },
    "neurology": {
        "maneuver": "neurological", "system_en": "Neurological", "system_tr": "Nörolojik",
        "age": (35, 80),
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 6.4, "mmol/L", 4.0, 7.8, "N", "chemistry"),
            ("2160-0", "Creatinine", "Kreatinin", 0.9, "mg/dL", 0.6, 1.3, "N", "chemistry"),
        ],
        "imaging": ("30799-1", "Non-contrast CT head", "Kontrastsız beyin BT",
                    "No acute haemorrhage; correlate clinically.", "Akut kanama yok; klinikle korele edin.",
                    "non-contrast CT head", "kontrastsız beyin BT"),
        "treatments": [
            ("glucose_check", "Check and correct glucose", "Glukozu kontrol et ve düzelt", "indicated", [], "Exclude hypoglycaemia as a stroke mimic.", "İnme taklidi olarak hipoglisemiyi dışlayın."),
            ("neuro_obs", "Frequent neuro observations", "Sık nörolojik gözlem", "indicated", [], "Detect deterioration early.", "Kötüleşmeyi erken saptayın."),
            ("empiric_anticoag", "Empiric anticoagulation before imaging", "Görüntüleme öncesi ampirik antikoagülasyon", "contraindicated", [], "Image to exclude haemorrhage first.", "Önce kanamayı dışlamak için görüntüleyin."),
        ],
        "guide": ("NICE", "Acute neurology (summary)", "Image early to separate ischaemic from haemorrhagic causes before any anticoagulation.", "Antikoagülasyondan önce iskemik ve hemorajik nedenleri ayırmak için erken görüntüleyin."),
    },
    "infectious": {
        "maneuver": "general-inspection", "system_en": "General", "system_tr": "Genel",
        "age": (18, 80),
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 16.8, "10^9/L", 4.0, 11.0, "H", "haematology"),
            ("2524-7", "Lactate", "Laktat", 2.6, "mmol/L", 0.5, 2.0, "H", "blood-gas"),
            ("1988-5", "C-reactive protein", "CRP", 120, "mg/L", 0, 5, "H", "chemistry"),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Looking for an occult source of infection.", "Gizli enfeksiyon kaynağı aranıyor.",
                    "chest x-ray infection source", "akciğer grafisi enfeksiyon kaynağı"),
        "treatments": [
            ("cultures", "Blood cultures before antibiotics", "Antibiyotik öncesi kan kültürü", "indicated", [], "Culture before antibiotics if no delay.", "Geciktirmiyorsa antibiyotik öncesi kültür alın."),
            ("abx", "Broad-spectrum IV antibiotics", "Geniş spektrumlu IV antibiyotik", "indicated", [("tempC", -0.6, 1800000)], "Early antibiotics for suspected sepsis.", "Şüpheli sepsiste erken antibiyotik."),
            ("iv_fluids", "IV fluid resuscitation", "IV sıvı resüsitasyonu", "indicated", [("hr", -10.0, 600000), ("systolic", 10.0, 600000)], "Restore perfusion.", "Perfüzyonu düzeltin."),
        ],
        "guide": ("SSC", "Surviving Sepsis Campaign (summary)", "For suspected sepsis take cultures and lactate and start antibiotics and fluids within the first hour.", "Şüpheli sepsiste kültür ve laktat alıp ilk saat içinde antibiyotik ve sıvı başlayın."),
    },
    "endocrine": {
        "maneuver": "general-inspection", "system_en": "General", "system_tr": "Genel",
        "age": (20, 75),
        "labs": [
            ("2345-7", "Plasma glucose", "Plazma glukozu", 22.0, "mmol/L", 4.0, 7.8, "HH", "chemistry"),
            ("2823-3", "Potassium", "Potasyum", 5.4, "mmol/L", 3.5, 5.0, "H", "chemistry"),
            ("1963-8", "Bicarbonate", "Bikarbonat", 12, "mmol/L", 22, 28, "L", "blood-gas"),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Sinus tachycardia; watch for potassium changes.", "Sinüs taşikardisi; potasyum değişikliklerine dikkat.",
                    "ECG hyperkalemia peaked T waves", "EKG hiperkalemi sivri T dalgası"),
        "treatments": [
            ("iv_fluids", "IV crystalloid resuscitation", "IV kristaloid resüsitasyonu", "indicated", [("hr", -8.0, 600000)], "Fluids first in DKA/HHS.", "DKA/HHS'de önce sıvı."),
            ("insulin", "Fixed-rate insulin infusion", "Sabit hızlı insulin infüzyonu", "indicated", [], "Insulin after fluids and potassium check.", "Sıvı ve potasyum sonrası insulin."),
            ("bolus_insulin_first", "IV insulin bolus before fluids", "Sıvı öncesi IV insulin bolusu", "contraindicated", [], "Give fluids first; avoid a bolus.", "Önce sıvı verin; bolustan kaçının."),
        ],
        "guide": ("TEPDAD", "Diabetic emergencies (summary)", "Resuscitate with fluids first, then start fixed-rate insulin and monitor potassium closely.", "Önce sıvıyla resüsite edin, sonra sabit hızlı insulin başlayın ve potasyumu yakın izleyin."),
    },
    "renal": {
        "maneuver": "abdominal", "system_en": "Abdominal / renal", "system_tr": "Karın / renal",
        "age": (25, 80),
        "labs": [
            ("2160-0", "Creatinine", "Kreatinin", 3.2, "mg/dL", 0.6, 1.3, "HH", "chemistry"),
            ("2823-3", "Potassium", "Potasyum", 6.1, "mmol/L", 3.5, 5.0, "HH", "chemistry"),
            ("3094-0", "Urea", "Üre", 24, "mmol/L", 2.5, 7.1, "H", "chemistry"),
        ],
        "imaging": ("24558-9", "Renal tract ultrasound", "Üriner sistem ultrasonu",
                    "Assess for obstruction / hydronephrosis.", "Obstrüksiyon / hidronefroz değerlendirmesi.",
                    "renal ultrasound hydronephrosis", "renal ultrason hidronefroz"),
        "treatments": [
            ("ecg", "ECG for hyperkalaemia", "Hiperkalemi için EKG", "indicated", [], "Screen for potassium-related ECG change.", "Potasyuma bağlı EKG değişimini tarayın."),
            ("k_treatment", "Calcium + insulin-dextrose", "Kalsiyum + insulin-dekstroz", "indicated", [], "Protect the myocardium and shift potassium.", "Miyokardı koruyun ve potasyumu kaydırın."),
            ("nephrotoxins", "Continue nephrotoxic drugs", "Nefrotoksik ilaçlara devam", "contraindicated", [], "Stop nephrotoxins in AKI.", "ABH'de nefrotoksikleri kesin."),
        ],
        "guide": ("NICE", "Acute kidney injury (summary)", "Identify and treat hyperkalaemia, stop nephrotoxins, and relieve any post-renal obstruction.", "Hiperkalemiyi saptayıp tedavi edin, nefrotoksikleri kesin ve postrenal obstrüksiyonu giderin."),
    },
    "psychiatry": {
        "maneuver": "general-inspection", "system_en": "Mental state", "system_tr": "Ruhsal durum",
        "age": (18, 55),
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 5.2, "mmol/L", 4.0, 7.8, "N", "chemistry"),
            ("3084-1", "Urate / metabolic screen", "Ürat / metabolik tarama", 5.0, "mg/dL", 3.5, 7.2, "N", "chemistry"),
        ],
        "imaging": ("11524-6", "12-lead ECG (QTc screen)", "12 derivasyonlu EKG (QTc taraması)",
                    "Baseline QTc before QT-prolonging agents.", "QT uzatan ajanlar öncesi bazal QTc.",
                    "ECG QTc measurement", "EKG QTc ölçümü"),
        "treatments": [
            ("risk_assessment", "Structured risk assessment", "Yapılandırılmış risk değerlendirmesi", "indicated", [], "Assess risk to self and others.", "Kendine ve başkalarına riski değerlendirin."),
            ("deescalation", "Verbal de-escalation, safe environment", "Sözel sakinleştirme, güvenli ortam", "indicated", [], "De-escalate before any medication.", "İlaçtan önce sakinleştirin."),
            ("organic_workup", "Exclude an organic cause", "Organik nedeni dışla", "indicated", [], "Rule out delirium / metabolic causes.", "Deliryum / metabolik nedenleri dışlayın."),
        ],
        "guide": ("TEPDAD", "Psychiatric emergency (summary)", "Ensure safety, perform a structured risk assessment, and exclude an organic cause before attributing symptoms to a primary psychiatric disorder.", "Güvenliği sağlayın, yapılandırılmış risk değerlendirmesi yapın ve semptomları birincil psikiyatrik bozukluğa bağlamadan önce organik nedeni dışlayın."),
    },
    "hematology": {
        "maneuver": "general-inspection", "system_en": "General", "system_tr": "Genel",
        "age": (18, 75),
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 7.8, "g/dL", 12.0, 16.0, "L", "haematology"),
            ("777-3", "Platelets", "Trombosit", 60, "10^9/L", 150, 400, "L", "haematology"),
            ("6690-2", "White cell count", "Lökosit", 0.6, "10^9/L", 4.0, 11.0, "LL", "haematology"),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Screen for occult infection in cytopenia.", "Sitopenide gizli enfeksiyon taraması.",
                    "chest x-ray neutropenia infection", "akciğer grafisi nötropeni enfeksiyon"),
        "treatments": [
            ("neutropenic_abx", "Immediate broad-spectrum antibiotics", "Hemen geniş spektrumlu antibiyotik", "indicated", [("tempC", -0.5, 1800000)], "Neutropenic fever is a time-critical emergency.", "Nötropenik ateş zaman kritik bir acildir."),
            ("transfuse", "Transfuse per threshold", "Eşiğe göre transfüzyon", "indicated", [], "Transfuse symptomatic anaemia.", "Semptomatik anemiyi transfüze edin."),
            ("delay_abx", "Delay antibiotics for cultures", "Kültür için antibiyotiği ertele", "contraindicated", [], "Do not delay antibiotics in neutropenic fever.", "Nötropenik ateşte antibiyotiği geciktirmeyin."),
        ],
        "guide": ("NICE", "Neutropenic sepsis (summary)", "Treat neutropenic fever as an emergency with broad-spectrum antibiotics within the hour.", "Nötropenik ateşi bir saat içinde geniş spektrumlu antibiyotikle acil olarak tedavi edin."),
    },
    "obstetrics-gynecology": {
        "maneuver": "abdominal", "system_en": "Abdominal / pelvic", "system_tr": "Karın / pelvik",
        "age": (18, 42),
        "labs": [
            ("2118-8", "Serum beta-hCG", "Serum beta-hCG", 1500, "IU/L", 0, 5, "H", "chemistry"),
            ("718-7", "Haemoglobin", "Hemoglobin", 10.5, "g/dL", 12.0, 16.0, "L", "haematology"),
        ],
        "imaging": ("24558-9", "Transvaginal ultrasound", "Transvajinal ultrason",
                    "Assess for intrauterine vs adnexal findings.", "İntrauterin ve adneksiyal bulguları değerlendirin.",
                    "transvaginal ultrasound adnexal", "transvajinal ultrason adneksiyal"),
        "treatments": [
            ("preg_test", "Urgent pregnancy test", "Acil gebelik testi", "indicated", [], "A positive test with pain flags ectopic risk.", "Ağrıyla pozitif test ektopik riskini işaret eder."),
            ("iv_access", "Large-bore IV access + group and save", "Geniş IV damar yolu + kan grubu", "indicated", [("systolic", 6.0, 600000)], "Prepare for possible haemorrhage.", "Olası kanamaya hazırlanın."),
            ("discharge_early", "Discharge without pregnancy test", "Gebelik testi olmadan taburcu", "contraindicated", [], "Never discharge pelvic pain without a pregnancy test.", "Pelvik ağrıyı gebelik testi olmadan taburcu etmeyin."),
        ],
        "guide": ("NICE", "Early pregnancy / gynae emergency (summary)", "In any woman of reproductive age with abdominal pain, do a pregnancy test and exclude ectopic pregnancy.", "Karın ağrısı olan üreme çağındaki her kadında gebelik testi yapın ve ektopik gebeliği dışlayın."),
    },
    "musculoskeletal": {
        "maneuver": "musculoskeletal", "system_en": "Musculoskeletal", "system_tr": "Kas-iskelet",
        "age": (18, 75),
        "labs": [
            ("2532-0", "Creatine kinase", "Kreatin kinaz", 320, "U/L", 30, 200, "H", "chemistry"),
            ("1988-5", "C-reactive protein", "CRP", 22, "mg/L", 0, 5, "H", "chemistry"),
        ],
        "imaging": ("43468-8", "Plain radiograph of the region", "Bölgenin düz grafisi",
                    "Assess for fracture or joint effusion.", "Kırık veya eklem efüzyonu değerlendirmesi.",
                    "limb x-ray fracture", "ekstremite grafisi kırık"),
        "treatments": [
            ("analgesia", "Multimodal analgesia", "Multimodal analjezi", "indicated", [("pain", -3.0, 300000)], "Adequate analgesia and splinting.", "Yeterli analjezi ve atelleme."),
            ("neurovascular", "Document neurovascular status", "Nörovasküler durumu kaydet", "indicated", [], "Check distal pulses and sensation.", "Distal nabız ve duyuyu kontrol edin."),
            ("tight_cast", "Apply a tight circumferential cast", "Sıkı sirküler alçı uygula", "contraindicated", [], "Avoid tight casts where swelling is expected.", "Şişme beklenen yerde sıkı alçıdan kaçının."),
        ],
        "guide": ("TEPDAD", "Limb injury (summary)", "Assess and document neurovascular status, provide analgesia, and watch for compartment syndrome.", "Nörovasküler durumu değerlendirip kaydedin, analjezi verin ve kompartman sendromuna dikkat edin."),
    },
}
_PROFILES["_default"] = {
    "maneuver": "general-inspection", "system_en": "General", "system_tr": "Genel",
    "age": (25, 75),
    "labs": [
        ("6690-2", "White cell count", "Lökosit", 12.0, "10^9/L", 4.0, 11.0, "H", "haematology"),
        ("2160-0", "Creatinine", "Kreatinin", 1.0, "mg/dL", 0.6, 1.3, "N", "chemistry"),
    ],
    "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                "No acute abnormality; correlate clinically.", "Akut anormallik yok; klinikle korele edin.",
                "chest x-ray normal", "akciğer grafisi normal"),
    "treatments": [
        ("assess", "Structured A-to-E assessment", "Yapılandırılmış ABCDE değerlendirmesi", "indicated", [], "Systematic assessment first.", "Önce sistematik değerlendirme."),
        ("analgesia", "Analgesia as needed", "Gerektiğinde analjezi", "indicated", [("pain", -2.0, 300000)], "Treat pain and monitor.", "Ağrıyı tedavi edip izleyin."),
        ("premature_dispo", "Discharge before a working diagnosis", "Çalışma tanısı öncesi taburcu", "contraindicated", [], "Reach a safe disposition first.", "Önce güvenli bir dispozisyona ulaşın."),
    ],
    "guide": ("TEPDAD", "Undifferentiated presentation (summary)", "Use a structured assessment, resuscitate as needed, and reach a safe working diagnosis before disposition.", "Yapılandırılmış değerlendirme kullanın, gerektiğinde resüsite edin ve dispozisyondan önce güvenli bir çalışma tanısına ulaşın."),
}


# --------------------------------------------------------------------------- #
# Deterministic template assembly (the always-available fallback).            #
# --------------------------------------------------------------------------- #
def _band_value(rng: random.Random, band: tuple[float, float], decimals: int = 0) -> float:
    lo, hi = band
    v = lo + rng.random() * (hi - lo)
    return round(v, decimals) if decimals else round(v)


def _triage_vitals(rng: random.Random, acuity: int) -> dict[str, Any]:
    b = _ACUITY_BANDS.get(acuity, _ACUITY_BANDS[3])
    systolic = int(_band_value(rng, b["systolic"]))
    diastolic = int(_band_value(rng, b["diastolic"]))
    if diastolic >= systolic:                    # keep it physiological
        diastolic = systolic - 30
    return {
        "hr": int(_band_value(rng, b["hr"])),
        "systolic": systolic,
        "diastolic": max(30, diastolic),
        "rr": int(_band_value(rng, b["rr"])),
        "spo2": int(_band_value(rng, b["spo2"])),
        "tempC": _band_value(rng, b["tempC"], 1),
    }


def _disposition(system: str, acuity: int) -> str:
    if acuity <= 1:
        return "admit-icu"
    if acuity == 2:
        return "admit-ccu" if system == "cardiology" else "admit-ward"
    if acuity == 3:
        return "observation"
    return "discharge"


def _hpi(cond: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
    cc_en, cc_tr = cond["typical_complaint_en"], cond["typical_complaint_tr"]
    onset_en, onset_tr = rng.choice([
        ("It came on suddenly earlier today.", "Bugün aniden başladı."),
        ("It has been building gradually over hours.", "Saatler içinde giderek arttı."),
        ("It started this morning and has not settled.", "Bu sabah başladı ve geçmedi."),
    ])
    severity = rng.randint(5, 9)
    items: list[dict[str, Any]] = [
        {"intent": "onset", "answer_en": onset_en, "answer_tr": onset_tr},
        {"intent": "character", "answer_en": f"It feels like {cc_en.lower()}.", "answer_tr": f"{cc_tr} gibi hissettiriyor."},
        {"intent": "severity", "answer_en": f"About {severity} out of ten.", "answer_tr": f"On üzerinden yaklaşık {severity}."},
        {"intent": "timing", "answer_en": "It has been fairly constant since it began.", "answer_tr": "Başladığından beri oldukça sürekli."},
        {"intent": "past-medical-history", "answer_en": "Otherwise I am generally well.", "answer_tr": "Bunun dışında genelde iyiyim."},
        {"intent": "medications", "answer_en": "I do not take any regular medicines.", "answer_tr": "Düzenli ilaç kullanmıyorum."},
        {"intent": "allergies", "answer_en": "No known drug allergies.", "answer_tr": "Bilinen ilaç alerjim yok."},
    ]
    for rf in cond.get("red_flags", [])[:2]:
        items.append({
            "intent": "red-flags",
            "answer_en": f"Yes — {rf['en'].lower()}.",
            "answer_tr": f"Evet — {rf['tr'].lower()}.",
            "red_flag": True,
        })
    return items


def _exam(cond: dict[str, Any], prof: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
    return [
        {"maneuver": "general-inspection", "system_en": "General", "system_tr": "Genel",
         "finding_en": "Uncomfortable but engaging with questions.", "finding_tr": "Rahatsız ama sorulara yanıt veriyor.",
         "abnormal": True},
        {"maneuver": prof["maneuver"], "system_en": prof["system_en"], "system_tr": prof["system_tr"],
         "finding_en": f"Findings consistent with {cond['label_en'].lower()}.",
         "finding_tr": f"{cond['label_tr']} ile uyumlu bulgular.", "abnormal": True},
        {"maneuver": "vitals-recheck", "system_en": "Vitals", "system_tr": "Vital bulgular",
         "finding_en": "Vitals rechecked and trending as charted.", "finding_tr": "Vitaller tekrar ölçüldü, seyir tabloya uygun.",
         "abnormal": False},
    ]


def _labs(prof: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for (code, en, tr, val, unit, lo, hi, flag, cat) in prof["labs"]:
        out.append({"code": code, "label_en": en, "label_tr": tr, "value": val,
                    "unit": unit, "ref_low": lo, "ref_high": hi, "flag": flag, "category": cat})
    return out


def _imaging(prof: dict[str, Any]) -> list[dict[str, Any]]:
    code, men, mtr, fen, ftr, qen, qtr = prof["imaging"]
    return [{"code": code, "modality_en": men, "modality_tr": mtr,
             "findings_en": fen, "findings_tr": ftr, "image_query_en": qen, "image_query_tr": qtr}]


def _treatments(prof: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for (code, en, tr, appr, effects, nen, ntr) in prof["treatments"]:
        out.append({
            "code": code, "label_en": en, "label_tr": tr, "appropriateness": appr,
            "effects": [{"key": k, "delta": d, "onsetMs": o} for (k, d, o) in effects],
            "narrative_en": nen, "narrative_tr": ntr,
        })
    return out


def _trajectory(triage: dict[str, Any], acuity: int) -> list[dict[str, Any]]:
    # Sicker cases drift worse; less acute cases settle. Bounded, plausible.
    worsen = acuity <= 2
    pts = []
    for i, minute in enumerate((0, 5, 15, 30)):
        f = i
        pts.append({
            "atMs": minute * 60000,
            "hr": int(triage["hr"] + (3 if worsen else -3) * f),
            "systolic": int(triage["systolic"] + (-3 if worsen else 2) * f),
            "diastolic": int(triage["diastolic"] + (-2 if worsen else 1) * f),
            "rr": int(triage["rr"] + (1 if worsen else -1) * f),
            "spo2": int(max(80, min(100, triage["spo2"] + (-1 if worsen else 1) * f))),
            "tempC": triage["tempC"],
        })
    return pts


def _demographics(cond: dict[str, Any], prof: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    lo, hi = prof["age"]
    age = rng.randint(lo, hi)
    if cond["system"] == "obstetrics-gynecology":
        sex = "female"
    elif cond["id"] in ("testicular_torsion", "bph_retention"):
        sex = "male"
    else:
        sex = rng.choice(("male", "female"))
    name = rng.choice(_MALE_NAMES if sex == "male" else _FEMALE_NAMES)
    return {"age": age, "sex": sex, "name_hint": name}


def build_template_spec(
    cond: dict[str, Any], *, seed: int, locale: str,
    acuity: int, difficulty: int, rng: random.Random,
) -> dict[str, Any]:
    """Assemble a complete, schema-valid spec from a catalog entry (no model)."""
    prof = _profile(cond["system"])
    triage = _triage_vitals(rng, acuity)
    src, cite, gen, gtr = prof["guide"]
    spec: dict[str, Any] = {
        "seed": seed,
        "locale": locale,
        "condition": {
            "icd11": cond.get("icd11", ""), "icd10": cond.get("icd10", ""),
            "dsm5tr": cond.get("dsm5tr"), "label_en": cond["label_en"],
            "label_tr": cond["label_tr"], "system": cond["system"],
        },
        "demographics": _demographics(cond, prof, rng),
        "chief_complaint_en": cond["typical_complaint_en"],
        "chief_complaint_tr": cond["typical_complaint_tr"],
        "acuity_esi": acuity,
        "difficulty": difficulty,
        "hpi": _hpi(cond, rng),
        "pmh_en": "No significant past medical history reported.",
        "pmh_tr": "Belirgin özgeçmiş bildirilmedi.",
        "meds_en": "No regular medications.", "meds_tr": "Düzenli ilaç yok.",
        "allergies_en": "No known drug allergies.", "allergies_tr": "Bilinen ilaç alerjisi yok.",
        "exam": _exam(cond, prof, rng),
        "triage_vitals": triage,
        "vitals_trajectory": _trajectory(triage, acuity),
        "labs": _labs(prof),
        "imaging": _imaging(prof),
        "treatments": _treatments(prof),
        "disposition": _disposition(cond["system"], acuity),
        "guideline_anchors": [{
            "statement_en": gen, "statement_tr": gtr, "source": src, "citation": cite,
        }],
    }
    return spec


# --------------------------------------------------------------------------- #
# Prompt + robust JSON parsing.                                                #
# --------------------------------------------------------------------------- #
_SYSTEM_PROMPT = (
    "You are a medical-education case author for a training simulator. You invent "
    "SYNTHETIC patients only — never real people or real records. You output ONE "
    "JSON object and nothing else: no prose, no markdown, no code fences.\n"
    "Every human-readable field is bilingual: an English (_en) and a Turkish (_tr) "
    "version. Keep the clinical picture internally consistent with the given "
    "condition, acuity and difficulty."
)


def _build_prompt(cond: dict[str, Any], *, locale: str, acuity: int, difficulty: int) -> list[dict[str, str]]:
    rf = "; ".join(f"{r['en']} / {r['tr']}" for r in cond.get("red_flags", [])) or "(none)"
    dsm = f"\n- DSM-5-TR: {cond['dsm5tr']}" if cond.get("dsm5tr") else ""
    user = f"""Author a full case for this condition. Output JSON only.

CONDITION
- label_en: {cond['label_en']}
- label_tr: {cond['label_tr']}
- system: {cond['system']}
- ICD-11: {cond.get('icd11', '')}
- ICD-10: {cond.get('icd10', '')}{dsm}
- typical complaint: {cond['typical_complaint_en']} / {cond['typical_complaint_tr']}
- red flags: {rf}

CONSTRAINTS
- primary locale: {locale}
- acuity_esi: {acuity}  (1 = most acute .. 5 = least)
- difficulty: {difficulty}  (1 = foundation .. 5 = expert)
- hpi[].intent MUST be one of: {', '.join(INTENTS)}
- exam[].maneuver MUST be one of: {', '.join(MANEUVERS)}
- treatments[].appropriateness MUST be one of: indicated, contraindicated, neutral
- disposition SHOULD be one of: {', '.join(DISPOSITIONS)}
- vitals must be physiologically plausible for the acuity; include ~4 trajectory points (atMs from 0)
- provide 5-8 hpi items (mark red-flag positives with "red_flag": true), 3-4 exam items,
  2-4 labs (with ref_low/ref_high/flag/category), 1-2 imaging, 3-4 treatments
  (at least one indicated and one contraindicated), and 1-2 guideline_anchors
  (source e.g. ESC/NICE/SSC/WHO/TEPDAD; use your OWN short factual summary, never
  copyrighted text).

Required JSON shape (fill every field):
{{"seed": {{int}}, "locale": "{locale}",
 "condition": {{"icd11","icd10","dsm5tr","label_en","label_tr","system"}},
 "demographics": {{"age": int, "sex": "male|female", "name_hint": str}},
 "chief_complaint_en": str, "chief_complaint_tr": str,
 "acuity_esi": {acuity}, "difficulty": {difficulty},
 "hpi": [{{"intent","answer_en","answer_tr","red_flag": bool}}],
 "pmh_en","pmh_tr","meds_en","meds_tr","allergies_en","allergies_tr": str,
 "exam": [{{"maneuver","system_en","system_tr","finding_en","finding_tr","abnormal": bool}}],
 "triage_vitals": {{"hr","systolic","diastolic","rr","spo2","tempC"}},
 "vitals_trajectory": [{{"atMs","hr","systolic","diastolic","rr","spo2","tempC"}}],
 "labs": [{{"code","label_en","label_tr","value","unit","ref_low","ref_high","flag","category"}}],
 "imaging": [{{"code","modality_en","modality_tr","findings_en","findings_tr","image_query_en","image_query_tr"}}],
 "treatments": [{{"code","label_en","label_tr","appropriateness","effects":[{{"key","delta","onsetMs"}}],"narrative_en","narrative_tr"}}],
 "disposition": str,
 "guideline_anchors": [{{"statement_en","statement_tr","source","citation"}}]}}"""
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    """Pull the first balanced ``{...}`` object out of a model reply, tolerantly
    (strips ```json fences, ignores leading/trailing prose)."""
    if not text:
        return None
    cleaned = re.sub(r"```[a-zA-Z]*", "", text).replace("```", "")
    start = cleaned.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(cleaned[start:i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break
        start = cleaned.find("{", start + 1)
    return None


# List fields where an empty model value must NOT override the template.
_LIST_FIELDS = ("hpi", "exam", "labs", "imaging", "treatments", "vitals_trajectory", "guideline_anchors")


def _merge(template: dict[str, Any], model: dict[str, Any]) -> dict[str, Any]:
    """Overlay meaningful model values on the complete template (gap-fill)."""
    out = dict(template)
    for k, v in model.items():
        if v is None:
            continue
        if isinstance(v, (list, dict, str)) and len(v) == 0:
            continue  # keep the template's populated value
        out[k] = v
    # Never let the model blank out a required list.
    for k in _LIST_FIELDS:
        if not out.get(k):
            out[k] = template[k]
    return out


def _resolve_constraints(constraints: dict[str, Any], seed: Optional[int]) -> dict[str, Any]:
    c = constraints or {}
    eff_seed = seed if seed is not None else c.get("seed")
    if eff_seed is None:
        eff_seed = random.Random().randrange(1, 2**31 - 1)
    try:
        eff_seed = int(eff_seed) & 0x7FFFFFFF
    except (TypeError, ValueError):
        eff_seed = random.Random().randrange(1, 2**31 - 1)
    locale = str(c.get("locale") or "en").lower()
    if locale not in ("en", "tr"):
        locale = "en"
    diff = c.get("difficulty")
    try:
        diff = _clamp(int(diff), 1, 5) if diff is not None else None
    except (TypeError, ValueError):
        diff = None
    return {
        "seed": eff_seed, "locale": locale,
        "system": c.get("system"), "complaint": c.get("complaint"),
        "difficulty": diff,
    }


async def generate_case_spec(
    constraints: dict[str, Any],
    gateway: Any = None,
    seed: Optional[int] = None,
) -> dict[str, Any]:
    """Generate a schema-valid ``GeneratedCaseSpec`` dict. Never raises.

    * Samples a condition (constrainable by ``system`` / ``difficulty`` /
      ``complaint``) with a seeded RNG for reproducibility.
    * Builds the deterministic template (the always-available fallback).
    * Makes ONE bounded ``gateway.chat(task="case")`` call; on any failure or
      invalid output, returns the template. On success, returns the validated,
      gap-filled spec with authoritative condition/seed/locale overwritten.
    """
    cons = _resolve_constraints(constraints, seed)
    rng = random.Random(cons["seed"])

    # 1) Sample the condition spine (deterministic under the seed).
    cond = sample_condition(
        system=cons["system"], difficulty=cons["difficulty"],
        complaint=cons["complaint"], rng=rng,
    )
    acuity = int(cond["typical_acuity"])
    difficulty = cons["difficulty"] if cons["difficulty"] is not None else int(cond["difficulty"])

    # 2) Deterministic template (used as the fallback AND the gap-fill base).
    template = build_template_spec(
        cond, seed=cons["seed"], locale=cons["locale"],
        acuity=acuity, difficulty=difficulty, rng=random.Random(cons["seed"] ^ 0x5DEECE66),
    )

    meta: dict[str, Any] = {"source": "template", "model": None, "latency_ms": 0.0, "degraded": False}

    # 3) One bounded model call. Any failure -> deterministic template.
    if gateway is not None:
        messages = _build_prompt(cond, locale=cons["locale"], acuity=acuity, difficulty=difficulty)
        t0 = time.monotonic()
        try:
            result = await gateway.chat(
                messages, task="case", max_tokens=MAX_TOKENS, temperature=TEMPERATURE,
            )
            meta["latency_ms"] = round((time.monotonic() - t0) * 1000.0, 1)
            meta["model"] = getattr(result, "model", None)
            obj = _extract_json_object(getattr(result, "text", "") or "")
            if obj is not None:
                merged = _merge(template, obj)
                spec = GeneratedCaseSpec.model_validate(merged)
                out = spec.model_dump()
                # Authoritative overrides — codes/seed/locale are never model-sourced.
                out["condition"] = dict(template["condition"])
                out["seed"] = cons["seed"]
                out["locale"] = cons["locale"]
                out["difficulty"] = difficulty
                meta["source"] = "model"
                out["meta"] = meta
                return out
            meta["degraded"] = True
            meta["note"] = "unparseable_model_reply"
        except Exception as exc:  # noqa: BLE001 — degrade to template, never raise
            meta["degraded"] = True
            meta["note"] = f"{type(exc).__name__}: {str(exc)[:120]}"
            if not meta["latency_ms"]:
                meta["latency_ms"] = round((time.monotonic() - t0) * 1000.0, 1)

    # 4) Deterministic fallback — validate to guarantee schema-conformance.
    try:
        out = GeneratedCaseSpec.model_validate(template).model_dump()
    except Exception:  # noqa: BLE001 — template is authored valid; belt & suspenders
        out = template
    out["meta"] = meta
    return out


# --------------------------------------------------------------------------- #
# Self-test — `python -m server.case_generator` (fully offline; fake gateways) #
# --------------------------------------------------------------------------- #
def _validate_public(spec: dict[str, Any]) -> bool:
    """Re-validate a returned dict against the schema (meta is non-schema)."""
    payload = {k: v for k, v in spec.items() if k != "meta"}
    GeneratedCaseSpec.model_validate(payload)
    return True


def _selftest() -> None:
    import asyncio
    from dataclasses import dataclass, field

    failures = 0

    def check(name: str, cond: bool) -> None:
        nonlocal failures
        failures += 0 if cond else 1
        print(f"[{'ok ' if cond else 'FAIL'}] {name}")

    @dataclass
    class _Res:
        text: str
        model: str = "fake-qwen"

    @dataclass
    class _GoodGateway:
        tasks: list[str] = field(default_factory=list)

        async def chat(self, messages, *, task="patient", max_tokens=None, temperature=None, stop=None):
            self.tasks.append(task)
            assert task == "case"
            assert max_tokens and max_tokens <= MAX_TOKENS
            # A minimal but valid model reply; gap-fill supplies the rest.
            payload = {
                "demographics": {"age": 61, "sex": "male", "name_hint": "Kaya T."},
                "chief_complaint_en": "Crushing central chest pain",
                "chief_complaint_tr": "Ezici orta hat göğüs ağrısı",
                "hpi": [
                    {"intent": "onset", "answer_en": "Started 40 minutes ago at rest.",
                     "answer_tr": "40 dakika önce istirahatte başladı.", "red_flag": False},
                    {"intent": "radiation", "answer_en": "It spreads to my left arm.",
                     "answer_tr": "Sol koluma yayılıyor.", "red_flag": True},
                    {"intent": "not-a-real-intent", "answer_en": "I feel sweaty.",
                     "answer_tr": "Terliyorum.", "red_flag": True},
                ],
                "exam": [
                    {"maneuver": "cardiovascular", "system_en": "CVS", "system_tr": "KVS",
                     "finding_en": "Regular, no murmur.", "finding_tr": "Düzenli, üfürüm yok.", "abnormal": False},
                ],
                "triage_vitals": {"hr": "104", "systolic": 150, "diastolic": 92, "rr": 20, "spo2": 96, "tempC": "36.8"},
                "treatments": [
                    {"code": "asa", "label_en": "Aspirin", "label_tr": "Aspirin",
                     "appropriateness": "indicated", "effects": [{"key": "pain", "delta": -1, "onsetMs": 600000}],
                     "narrative_en": "Load aspirin.", "narrative_tr": "Aspirin yükle."},
                ],
                "condition": {"icd10": "HALLUCINATED-XXX", "label_en": "wrong", "label_tr": "yanlış", "system": "x"},
            }
            return _Res("Here is the case:\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```")

    @dataclass
    class _FailGateway:
        async def chat(self, messages, *, task="patient", max_tokens=None, temperature=None, stop=None):
            raise RuntimeError("simulated AIRGAPPED egress / outage")

    @dataclass
    class _JunkGateway:
        async def chat(self, messages, *, task="patient", max_tokens=None, temperature=None, stop=None):
            return _Res("I'm sorry, I cannot output JSON right now.")

    # (a) model path: valid, schema-conform, gap-filled, codes overridden
    gw = _GoodGateway()
    out = asyncio.run(generate_case_spec({"system": "cardiology", "seed": 42, "locale": "en"}, gw))
    check("model: one 'case' chat call", gw.tasks == ["case"])
    check("model: source=model", out["meta"]["source"] == "model")
    check("model: schema-valid", _validate_public(out))
    check("model: authoritative ICD (no hallucinated code)", "HALLUCINATED" not in json.dumps(out["condition"]))
    check("model: condition system is cardiology", out["condition"]["system"] == "cardiology")
    check("model: unknown intent coerced", all(h["intent"] in INTENTS for h in out["hpi"]))
    check("model: vitals coerced to numbers", isinstance(out["triage_vitals"]["hr"], int))
    check("model: template gap-fill (labs present)", len(out["labs"]) >= 1)
    check("model: seed echoed", out["seed"] == 42)

    # (b) reproducibility: same seed -> identical template fallback
    out1 = asyncio.run(generate_case_spec({"seed": 777}, None))
    out2 = asyncio.run(generate_case_spec({"seed": 777}, None))
    check("no-gateway: source=template", out1["meta"]["source"] == "template")
    check("reproducible: same seed => same condition", out1["condition"] == out2["condition"])
    check("reproducible: same seed => same vitals", out1["triage_vitals"] == out2["triage_vitals"])
    check("template: schema-valid", _validate_public(out1))

    # (c) failing gateway -> template, degraded flagged, still 200-shaped
    outf = asyncio.run(generate_case_spec({"system": "neurology", "seed": 3}, _FailGateway()))
    check("fail: source=template", outf["meta"]["source"] == "template")
    check("fail: degraded flagged", outf["meta"]["degraded"] is True)
    check("fail: schema-valid", _validate_public(outf))

    # (d) junk (non-JSON) reply -> template
    outj = asyncio.run(generate_case_spec({"system": "gi", "seed": 9}, _JunkGateway()))
    check("junk: source=template", outj["meta"]["source"] == "template")
    check("junk: schema-valid", _validate_public(outj))

    # (e) constraints honoured across every system
    for sysname in ("emergency", "cardiology", "pulmonology", "gastroenterology",
                    "neurology", "infectious", "endocrine", "renal", "psychiatry",
                    "hematology", "obstetrics-gynecology", "musculoskeletal"):
        o = asyncio.run(generate_case_spec({"system": sysname, "seed": 5}, None))
        ok = (_validate_public(o) and o["condition"]["system"] == sysname
              and 1 <= o["acuity_esi"] <= 5 and len(o["hpi"]) >= 1
              and len(o["treatments"]) >= 1 and len(o["guideline_anchors"]) >= 1)
        check(f"system '{sysname}': constrained + valid", ok)

    # (f) difficulty constraint honoured
    od = asyncio.run(generate_case_spec({"difficulty": 5, "seed": 11}, None))
    check("difficulty: forced to 5", od["difficulty"] == 5)

    # (g) complaint constraint biases sampling
    oc = asyncio.run(generate_case_spec({"complaint": "chest pain", "seed": 2}, None))
    check("complaint: schema-valid", _validate_public(oc))

    print()
    if failures:
        raise SystemExit(f"{failures} case-generator self-test(s) FAILED")
    print("All case-generator self-tests passed.")


if __name__ == "__main__":
    _selftest()

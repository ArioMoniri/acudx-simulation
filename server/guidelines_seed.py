"""
guidelines_seed.py — a small, self-contained seed corpus of GuidelineStatement
records for the AcuDx MVP / Phase-0 slice.

Positioning (see docs/architecture/05-guideline-grounding-engine.md):
    The GuidelineStatement is the atomic unit of the GROUNDED content layer. It is a
    structured, versioned, *country/council-scoped*, cited, license-tagged record —
    NEVER an opaque PDF and NEVER verbatim copyrighted text. Facts and thresholds
    are not copyrightable; what we store is *our own* condensed, clinician-reviewable
    expression of the recommendation, cited and deep-linked back to the primary source.

This module is deliberately tiny and dependency-free: it is the demo corpus that the
Grounding Service (server/grounding.py) retrieves over. In production these records are
projections of the hash-chained Event Log in Postgres/Qdrant; here they are just dicts.

Shape of each record (a superset of the task's requested fields, kept compatible with
the doc-05 schema so real records can drop straight in):

    {
      "id": "gs_...",                 # stable statement id
      "statement": {"en": "...", "tr": "..."},   # bilingual condensed recommendation
      "country": "GLOBAL"|"US"|"UK"|"TR"|...,     # convenience mirror of scope.countries[0]
      "council": "ESC"|"SSC"|"NICE"|...,          # issuing body / council
      "topic": "acs_reperfusion",     # fine-grained retrieval key
      "domain": "cardiology"|"sepsis"|"neurology"|...,
      "scope": {"countries": [...], "council": "...", "population": "adult",
                "care_setting": ["ED", ...]},
      "citation": {"body","title","reference","url","pub_date"},
      "url": "https://...",           # convenience mirror of citation.url
      "effective_date": "YYYY-MM-DD",
      "reviewed_date":  "YYYY-MM-DD",
      "license_tag": "open"|"copyrighted-summarized"|...,
      "embedding": None,              # filled lazily/at-runtime by the Grounding Service
    }

License policy honored here (doc 05 §3.1):
    - NICE-UK / WHO / T.C. Sağlık Bakanlığı / TEPDAD material -> "open" (short summaries).
    - ESC / SSC (ACC/AHA etc.) -> "copyrighted-summarized": we store our OWN short factual
      summary and cite + deep-link only; no redistribution of source text.
No record below contains a verbatim quote of a copyrighted guideline — only cited,
clinician-style summaries of the (non-copyrightable) facts and thresholds.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# The seed corpus. ~12 records covering the demo EM cases:
#   ACS/ESC, sepsis/SSC, headache-SAH/NICE, plus Turkish (T.C. Sağlık Bakanlığı /
#   TEPDAD-aligned) records so `country=TR, locale=tr` retrieval has grounded facts.
# ---------------------------------------------------------------------------

GUIDELINE_SEED: List[Dict[str, Any]] = [
    # ----- Cardiology / ACS (ESC) --------------------------------------------
    {
        "id": "gs_esc23acs_reperfusion",
        "statement": {
            "en": (
                "In STEMI, primary PCI is the preferred reperfusion strategy when it can be "
                "delivered within 120 minutes of STEMI diagnosis. If that target cannot be met, "
                "give fibrinolysis within 10 minutes of diagnosis (absent contraindications)."
            ),
            "tr": (
                "STEMI'de, STEMI tanısından itibaren 120 dakika içinde uygulanabiliyorsa tercih "
                "edilen reperfüzyon stratejisi primer PKG'dir. Bu hedef karşılanamıyorsa, "
                "kontrendikasyon yoksa tanıdan sonra 10 dakika içinde fibrinolitik verin."
            ),
        },
        "country": "GLOBAL",
        "council": "ESC",
        "topic": "acs_stemi_reperfusion",
        "domain": "cardiology",
        "scope": {"countries": ["GLOBAL"], "council": "ESC", "population": "adult",
                  "care_setting": ["prehospital", "ED"]},
        "citation": {
            "body": "ESC",
            "title": "2023 ESC Guidelines for the management of acute coronary syndromes",
            "reference": "Eur Heart J. 2023;44(38):3720-3826",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
            "pub_date": "2023-08",
        },
        "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
        "effective_date": "2023-08-25",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },
    {
        "id": "gs_esc23acs_dapt",
        "statement": {
            "en": (
                "For ACS, start dual antiplatelet therapy: an aspirin loading dose of 150-300 mg "
                "orally (or 75-250 mg IV) plus a P2Y12 inhibitor, unless contraindicated. Prasugrel "
                "or ticagrelor is preferred over clopidogrel where not contraindicated."
            ),
            "tr": (
                "AKS'de ikili antiplatelet tedavi başlatın: kontrendikasyon yoksa 150-300 mg oral "
                "(veya 75-250 mg IV) aspirin yükleme dozu ile birlikte bir P2Y12 inhibitörü. "
                "Kontrendikasyon yoksa prasugrel veya tikagrelor klopidogrele tercih edilir."
            ),
        },
        "country": "GLOBAL",
        "council": "ESC",
        "topic": "acs_dual_antiplatelet",
        "domain": "cardiology",
        "scope": {"countries": ["GLOBAL"], "council": "ESC", "population": "adult",
                  "care_setting": ["ED", "ward"]},
        "citation": {
            "body": "ESC",
            "title": "2023 ESC Guidelines for the management of acute coronary syndromes",
            "reference": "Eur Heart J. 2023;44(38):3720-3826",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
            "pub_date": "2023-08",
        },
        "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
        "effective_date": "2023-08-25",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },
    {
        "id": "gs_esc23acs_oxygen",
        "statement": {
            "en": (
                "In ACS, supplemental oxygen is recommended only when SpO2 is below 90%. Routine "
                "oxygen for patients with SpO2 >= 90% is not recommended and may be harmful."
            ),
            "tr": (
                "AKS'de yalnızca SpO2 %90'ın altındayken ek oksijen önerilir. SpO2 >= %90 olan "
                "hastalarda rutin oksijen önerilmez ve zararlı olabilir."
            ),
        },
        "country": "GLOBAL",
        "council": "ESC",
        "topic": "acs_oxygen_threshold",
        "domain": "cardiology",
        "scope": {"countries": ["GLOBAL"], "council": "ESC", "population": "adult",
                  "care_setting": ["prehospital", "ED"]},
        "citation": {
            "body": "ESC",
            "title": "2023 ESC Guidelines for the management of acute coronary syndromes",
            "reference": "Eur Heart J. 2023;44(38):3720-3826",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
            "pub_date": "2023-08",
        },
        "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
        "effective_date": "2023-08-25",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },
    {
        "id": "gs_esc23nstemi_hstroponin",
        "statement": {
            "en": (
                "In suspected NSTE-ACS, use a high-sensitivity cardiac troponin 0 h/1 h (or 0 h/2 h) "
                "algorithm to rule in or rule out myocardial infarction, interpreted together with "
                "clinical context and the ECG."
            ),
            "tr": (
                "NSTE-AKS şüphesinde, miyokart enfarktüsünü dışlamak veya doğrulamak için yüksek "
                "duyarlıklı kardiyak troponin 0 saat/1 saat (veya 0 saat/2 saat) algoritmasını, "
                "klinik bağlam ve EKG ile birlikte yorumlayarak kullanın."
            ),
        },
        "country": "GLOBAL",
        "council": "ESC",
        "topic": "nstemi_hs_troponin_pathway",
        "domain": "cardiology",
        "scope": {"countries": ["GLOBAL"], "council": "ESC", "population": "adult",
                  "care_setting": ["ED"]},
        "citation": {
            "body": "ESC",
            "title": "2023 ESC Guidelines for the management of acute coronary syndromes",
            "reference": "Eur Heart J. 2023;44(38):3720-3826",
            "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
            "pub_date": "2023-08",
        },
        "url": "https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Coronary-Syndromes-ACS-Guidelines",
        "effective_date": "2023-08-25",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },

    # ----- Sepsis (Surviving Sepsis Campaign) --------------------------------
    {
        "id": "gs_ssc21sepsis_antibiotics",
        "statement": {
            "en": (
                "For septic shock or a high likelihood of sepsis, administer broad-spectrum IV "
                "antimicrobials immediately, ideally within 1 hour of recognition. Obtain blood "
                "cultures before antibiotics only if this does not materially delay them."
            ),
            "tr": (
                "Septik şok veya sepsis olasılığı yüksek hastalarda, geniş spektrumlu IV "
                "antimikrobiyalleri hemen, ideal olarak tanınmadan sonra 1 saat içinde uygulayın. "
                "Kan kültürlerini yalnızca antibiyotiği önemli ölçüde geciktirmiyorsa öncesinde alın."
            ),
        },
        "country": "GLOBAL",
        "council": "SSC",
        "topic": "sepsis_antibiotics_timing",
        "domain": "sepsis",
        "scope": {"countries": ["GLOBAL"], "council": "SSC", "population": "adult",
                  "care_setting": ["ED", "ICU"]},
        "citation": {
            "body": "SSC (SCCM/ESICM)",
            "title": "Surviving Sepsis Campaign: International Guidelines 2021",
            "reference": "Crit Care Med. 2021;49(11):e1063-e1143",
            "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
            "pub_date": "2021-10",
        },
        "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
        "effective_date": "2021-10-02",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },
    {
        "id": "gs_ssc21sepsis_fluids",
        "statement": {
            "en": (
                "For sepsis-induced hypoperfusion or septic shock, give at least 30 mL/kg of IV "
                "crystalloid within the first 3 hours of resuscitation, then reassess with dynamic "
                "measures rather than continuing fixed boluses."
            ),
            "tr": (
                "Sepsise bağlı hipoperfüzyon veya septik şokta, resüsitasyonun ilk 3 saati içinde "
                "en az 30 mL/kg IV kristaloid verin; ardından sabit bolusları sürdürmek yerine "
                "dinamik ölçütlerle yeniden değerlendirin."
            ),
        },
        "country": "GLOBAL",
        "council": "SSC",
        "topic": "sepsis_fluid_resuscitation",
        "domain": "sepsis",
        "scope": {"countries": ["GLOBAL"], "council": "SSC", "population": "adult",
                  "care_setting": ["ED", "ICU"]},
        "citation": {
            "body": "SSC (SCCM/ESICM)",
            "title": "Surviving Sepsis Campaign: International Guidelines 2021",
            "reference": "Crit Care Med. 2021;49(11):e1063-e1143",
            "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
            "pub_date": "2021-10",
        },
        "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
        "effective_date": "2021-10-02",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },
    {
        "id": "gs_ssc21sepsis_lactate",
        "statement": {
            "en": (
                "Use lactate to guide resuscitation in sepsis: if the initial lactate is elevated "
                "(> 2 mmol/L), remeasure within 2-4 hours and target lactate normalisation as a "
                "marker of adequate resuscitation."
            ),
            "tr": (
                "Sepsiste resüsitasyonu yönlendirmek için laktatı kullanın: başlangıç laktatı "
                "yüksekse (> 2 mmol/L), 2-4 saat içinde tekrar ölçün ve yeterli resüsitasyonun bir "
                "göstergesi olarak laktatın normalleşmesini hedefleyin."
            ),
        },
        "country": "GLOBAL",
        "council": "SSC",
        "topic": "sepsis_lactate_guided_resuscitation",
        "domain": "sepsis",
        "scope": {"countries": ["GLOBAL"], "council": "SSC", "population": "adult",
                  "care_setting": ["ED", "ICU"]},
        "citation": {
            "body": "SSC (SCCM/ESICM)",
            "title": "Surviving Sepsis Campaign: International Guidelines 2021",
            "reference": "Crit Care Med. 2021;49(11):e1063-e1143",
            "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
            "pub_date": "2021-10",
        },
        "url": "https://www.sccm.org/SurvivingSepsisCampaign/Guidelines",
        "effective_date": "2021-10-02",
        "reviewed_date": "2026-06-01",
        "license_tag": "copyrighted-summarized",
        "embedding": None,
    },

    # ----- Headache / Subarachnoid haemorrhage (NICE) ------------------------
    {
        "id": "gs_nice_sah_ct6h",
        "statement": {
            "en": (
                "For sudden-onset severe (thunderclap) headache suspicious for subarachnoid "
                "haemorrhage, a non-contrast CT head performed within 6 hours of onset and reported "
                "by an experienced reader is highly sensitive; a normal early CT makes SAH very unlikely."
            ),
            "tr": (
                "Subaraknoid kanamadan şüphelenilen ani başlangıçlı şiddetli (gök gürültüsü) baş "
                "ağrısında, başlangıçtan sonraki 6 saat içinde çekilen ve deneyimli bir okuyucu "
                "tarafından raporlanan kontrastsız beyin BT'si yüksek duyarlıdır; erken normal BT "
                "SAK'ı çok olası dışı kılar."
            ),
        },
        "country": "UK",
        "council": "NICE",
        "topic": "subarachnoid_haemorrhage_ct_timing",
        "domain": "neurology",
        "scope": {"countries": ["UK"], "council": "NICE", "population": "adult",
                  "care_setting": ["ED"]},
        "citation": {
            "body": "NICE",
            "title": "Subarachnoid haemorrhage caused by a ruptured aneurysm: diagnosis and management (NG228)",
            "reference": "NICE NG228",
            "url": "https://www.nice.org.uk/guidance/ng228",
            "pub_date": "2022-11",
        },
        "url": "https://www.nice.org.uk/guidance/ng228",
        "effective_date": "2022-11-23",
        "reviewed_date": "2026-06-01",
        "license_tag": "open",
        "embedding": None,
    },
    {
        "id": "gs_nice_sah_lp12h",
        "statement": {
            "en": (
                "If CT is negative but clinical suspicion of subarachnoid haemorrhage persists, "
                "perform a lumbar puncture no earlier than 12 hours after headache onset and examine "
                "the CSF for xanthochromia (spectrophotometry) rather than red cells alone."
            ),
            "tr": (
                "BT negatif ancak subaraknoid kanama klinik şüphesi sürüyorsa, baş ağrısı "
                "başlangıcından en erken 12 saat sonra lomber ponksiyon yapın ve BOS'u yalnızca "
                "eritrositler yerine ksantokromi (spektrofotometri) açısından inceleyin."
            ),
        },
        "country": "UK",
        "council": "NICE",
        "topic": "subarachnoid_haemorrhage_lp_timing",
        "domain": "neurology",
        "scope": {"countries": ["UK"], "council": "NICE", "population": "adult",
                  "care_setting": ["ED"]},
        "citation": {
            "body": "NICE",
            "title": "Subarachnoid haemorrhage caused by a ruptured aneurysm: diagnosis and management (NG228)",
            "reference": "NICE NG228",
            "url": "https://www.nice.org.uk/guidance/ng228",
            "pub_date": "2022-11",
        },
        "url": "https://www.nice.org.uk/guidance/ng228",
        "effective_date": "2022-11-23",
        "reviewed_date": "2026-06-01",
        "license_tag": "open",
        "embedding": None,
    },
    {
        "id": "gs_nice_headache_redflags",
        "statement": {
            "en": (
                "Treat a thunderclap headache (severe, reaching maximum intensity within 5 minutes) "
                "as a red flag for serious secondary causes such as subarachnoid haemorrhage and "
                "arrange immediate same-day assessment and neuroimaging."
            ),
            "tr": (
                "Gök gürültüsü baş ağrısını (şiddetli, 5 dakika içinde en yüksek şiddete ulaşan) "
                "subaraknoid kanama gibi ciddi ikincil nedenler için bir kırmızı bayrak olarak "
                "değerlendirin ve acilen aynı gün değerlendirme ile nörogörüntüleme ayarlayın."
            ),
        },
        "country": "UK",
        "council": "NICE",
        "topic": "headache_red_flags",
        "domain": "neurology",
        "scope": {"countries": ["UK"], "council": "NICE", "population": "adult",
                  "care_setting": ["ED", "clinic"]},
        "citation": {
            "body": "NICE",
            "title": "Headaches in over 12s: diagnosis and management (CG150)",
            "reference": "NICE CG150",
            "url": "https://www.nice.org.uk/guidance/cg150",
            "pub_date": "2012-09",
        },
        "url": "https://www.nice.org.uk/guidance/cg150",
        "effective_date": "2012-09-19",
        "reviewed_date": "2026-06-01",
        "license_tag": "open",
        "embedding": None,
    },

    # ----- Turkish locale (T.C. Sağlık Bakanlığı / TEPDAD-aligned) -----------
    {
        "id": "gs_moh_tr_acs_ecg10min",
        "statement": {
            "en": (
                "For a patient presenting to the emergency department with acute chest pain, obtain "
                "and interpret a 12-lead ECG within 10 minutes of arrival; if STEMI is identified, "
                "activate the reperfusion pathway without delay."
            ),
            "tr": (
                "Acil servise akut göğüs ağrısı ile başvuran hastada, varıştan sonra 10 dakika "
                "içinde 12 derivasyonlu EKG çekip yorumlayın; STEMI saptanırsa reperfüzyon yolağını "
                "gecikmeden aktive edin."
            ),
        },
        "country": "TR",
        "council": "T.C. Sağlık Bakanlığı",
        "topic": "acs_chest_pain_ecg_timing",
        "domain": "cardiology",
        "scope": {"countries": ["TR"], "council": "OTHER", "population": "adult",
                  "care_setting": ["ED"]},
        "citation": {
            "body": "T.C. Sağlık Bakanlığı",
            "title": "Akut Koroner Sendrom / Göğüs Ağrısı Acil Yaklaşım — özet öneri",
            "reference": "T.C. Sağlık Bakanlığı, Halk Sağlığı / Acil Sağlık Hizmetleri",
            "url": "https://www.saglik.gov.tr",
            "pub_date": "2024-01",
        },
        "url": "https://www.saglik.gov.tr",
        "effective_date": "2024-01-01",
        "reviewed_date": "2026-06-01",
        "license_tag": "open",
        "embedding": None,
    },
    {
        "id": "gs_tepdad_tr_sepsis_recognition",
        "statement": {
            "en": (
                "Recognise sepsis early in the emergency department: for a patient with suspected "
                "infection and signs of organ dysfunction, obtain cultures, measure lactate, and "
                "start broad-spectrum antibiotics and fluid resuscitation promptly."
            ),
            "tr": (
                "Acil serviste sepsisi erken tanıyın: enfeksiyon şüphesi ve organ disfonksiyonu "
                "bulguları olan hastada kültür alın, laktat ölçün ve geniş spektrumlu antibiyotik "
                "ile sıvı resüsitasyonuna hızlıca başlayın."
            ),
        },
        "country": "TR",
        "council": "TEPDAD",
        "topic": "sepsis_early_recognition_tr",
        "domain": "sepsis",
        "scope": {"countries": ["TR"], "council": "OTHER", "population": "adult",
                  "care_setting": ["ED"]},
        "citation": {
            "body": "TEPDAD (aligned) / T.C. Sağlık Bakanlığı",
            "title": "Sepsis Erken Tanı ve Yönetimi — mezuniyet öncesi acil yaklaşım özeti",
            "reference": "TEPDAD ulusal çekirdek eğitim programı ile uyumlu özet",
            "url": "https://www.tepdad.org.tr",
            "pub_date": "2023-06",
        },
        "url": "https://www.tepdad.org.tr",
        "effective_date": "2023-06-01",
        "reviewed_date": "2026-06-01",
        "license_tag": "open",
        "embedding": None,
    },
]


# ---------------------------------------------------------------------------
# Small accessor helpers (the Grounding Service consumes these).
# ---------------------------------------------------------------------------

def all_statements() -> List[Dict[str, Any]]:
    """Return deep copies of the seed corpus so callers can annotate freely
    (e.g. attach a runtime embedding) without mutating the shared seed."""
    return [copy.deepcopy(s) for s in GUIDELINE_SEED]


def localized_text(statement: Dict[str, Any], locale: str = "en") -> str:
    """Return the statement text for `locale`, falling back to English then to any
    available language. Robust to a plain-string `statement` too."""
    body = statement.get("statement", "")
    if isinstance(body, str):
        return body
    if isinstance(body, dict):
        if body.get(locale):
            return body[locale]
        if body.get("en"):
            return body["en"]
        for v in body.values():
            if v:
                return v
    return ""


def has_citation(statement: Dict[str, Any]) -> bool:
    """Hard citation gate predicate: a statement counts as grounded only if it carries
    a citation with at least a body and a URL (the deep-link back to the primary source)."""
    cite = statement.get("citation")
    if not isinstance(cite, dict):
        return False
    body = str(cite.get("body", "")).strip()
    url = str(cite.get("url", "") or statement.get("url", "")).strip()
    return bool(body) and bool(url)


def in_country_scope(statement: Dict[str, Any], country: str) -> bool:
    """Country filter, applied BEFORE ranking (doc 05 §4): a statement is in scope if the
    requested country is listed in its scope, or the statement is GLOBAL, or the request is
    GLOBAL. Case-insensitive; tolerant of the convenience `country` mirror field."""
    if not country:
        return True
    country = country.strip().upper()
    countries = statement.get("scope", {}).get("countries") or [statement.get("country", "")]
    countries = [str(c).strip().upper() for c in countries if c]
    if country == "GLOBAL":
        return True
    return country in countries or "GLOBAL" in countries


if __name__ == "__main__":  # tiny self-check when run directly
    import json
    print(f"{len(GUIDELINE_SEED)} seed GuidelineStatements")
    councils = sorted({s["council"] for s in GUIDELINE_SEED})
    countries = sorted({s["country"] for s in GUIDELINE_SEED})
    print("councils :", councils)
    print("countries:", countries)
    missing = [s["id"] for s in GUIDELINE_SEED if not has_citation(s)]
    print("without citation (should be empty):", missing)
    print(json.dumps(GUIDELINE_SEED[0], ensure_ascii=False, indent=2)[:600])

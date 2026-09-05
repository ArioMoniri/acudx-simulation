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
# Breadth pack — condition-spanning cited statements so retrieval draws on far
# more than the original ~13-row demo seed. Built with a compact helper to keep
# the table dense and readable. Each record still carries a real body + URL
# citation (so it survives the hard citation gate) and is OUR OWN concise, non-
# copyrightable summary of the facts/thresholds — never verbatim guideline text.
# License policy (doc 05 §3.1): NICE/WHO/Resus/RCOG/BTS/MoH/TEPDAD -> "open";
# ESC/AHA-ASA/SSC/GOLD -> "copyrighted-summarized" (summary + deep-link only).
# ---------------------------------------------------------------------------

def _gs(
    sid: str, en: str, tr: str, *, country: str, council: str, topic: str,
    domain: str, title: str, reference: str, url: str, pub_date: str,
    body: str | None = None, care_setting: tuple = ("ED",),
    license_tag: str = "open", effective: str = "2023-01-01",
    reviewed: str = "2026-06-01",
) -> Dict[str, Any]:
    return {
        "id": sid,
        "statement": {"en": en, "tr": tr},
        "country": country,
        "council": council,
        "topic": topic,
        "domain": domain,
        "scope": {"countries": [country], "council": council, "population": "adult",
                  "care_setting": list(care_setting)},
        "citation": {"body": body or council, "title": title, "reference": reference,
                     "url": url, "pub_date": pub_date},
        "url": url,
        "effective_date": effective,
        "reviewed_date": reviewed,
        "license_tag": license_tag,
        "embedding": None,
    }


_EXTRA_STATEMENTS: List[Dict[str, Any]] = [
    # ---- Cardiology beyond ACS --------------------------------------------
    _gs("gs_esc_aortic_dissection",
        "In suspected acute aortic dissection, obtain urgent CT angiography and control heart rate and blood pressure first with an IV beta-blocker (target heart rate ~60/min) before vasodilators; type A dissection needs emergency surgery.",
        "Şüpheli akut aort diseksiyonunda acil BT anjiyografi alın ve vazodilatörden önce IV beta-blokerle önce nabız ve tansiyonu kontrol edin (hedef nabız ~60/dk); tip A diseksiyon acil cerrahi gerektirir.",
        country="GLOBAL", council="ESC", topic="aortic_dissection_management", domain="cardiology",
        title="2014 ESC Guidelines on the diagnosis and treatment of aortic diseases",
        reference="Eur Heart J. 2014;35(41):2873-2926",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Aortic-Diseases",
        pub_date="2014-08", license_tag="copyrighted-summarized"),
    _gs("gs_esc_acute_heart_failure",
        "In acute heart failure with pulmonary congestion, give an IV loop diuretic, add IV nitrate when the systolic blood pressure allows, and use non-invasive ventilation for respiratory distress; avoid fluid loading.",
        "Pulmoner konjesyonlu akut kalp yetmezliğinde IV loop diüretik verin, sistolik tansiyon uygunsa IV nitrat ekleyin ve solunum sıkıntısında non-invaziv ventilasyon kullanın; sıvı yüklemesinden kaçının.",
        country="GLOBAL", council="ESC", topic="acute_heart_failure_management", domain="cardiology",
        title="2021 ESC Guidelines for the diagnosis and treatment of acute and chronic heart failure",
        reference="Eur Heart J. 2021;42(36):3599-3726",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-and-Chronic-Heart-Failure",
        pub_date="2021-08", license_tag="copyrighted-summarized"),
    _gs("gs_esc_af_rvr",
        "For atrial fibrillation with a rapid ventricular response, control the rate with a beta-blocker or diltiazem when stable, assess thromboembolic risk (CHA2DS2-VASc) for anticoagulation, and cardiovert immediately if there is haemodynamic instability.",
        "Hızlı ventriküler yanıtlı atriyal fibrilasyonda, stabilse beta-bloker veya diltiazemle hızı kontrol edin, antikoagülasyon için tromboembolik riski (CHA2DS2-VASc) değerlendirin ve hemodinamik instabilite varsa hemen kardiyoversiyon yapın.",
        country="GLOBAL", council="ESC", topic="atrial_fibrillation_acute", domain="cardiology",
        title="2020 ESC Guidelines for the diagnosis and management of atrial fibrillation",
        reference="Eur Heart J. 2021;42(5):373-498",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Atrial-Fibrillation-Management",
        pub_date="2020-08", license_tag="copyrighted-summarized"),
    _gs("gs_esc_pericarditis",
        "Acute pericarditis is treated with an NSAID plus colchicine as first-line therapy; a high-dose NSAID is tapered after symptoms settle, and strenuous exertion is avoided until inflammation resolves.",
        "Akut perikardit birinci basamakta NSAİİ artı kolşisin ile tedavi edilir; yüksek doz NSAİİ semptomlar geçtikten sonra azaltılır ve enflamasyon düzelene kadar ağır efordan kaçınılır.",
        country="GLOBAL", council="ESC", topic="pericarditis_treatment", domain="cardiology",
        title="2015 ESC Guidelines for the diagnosis and management of pericardial diseases",
        reference="Eur Heart J. 2015;36(42):2921-2964",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Pericardial-Diseases-Guidelines-on-the-Diagnosis-and-Management-of",
        pub_date="2015-08", license_tag="copyrighted-summarized"),
    _gs("gs_esc_tamponade",
        "Cardiac tamponade is a clinical diagnosis supported by echocardiography; relieve it with urgent pericardiocentesis, support filling with IV fluids in the meantime, and avoid vasodilators or aggressive diuresis that reduce preload.",
        "Kardiyak tamponad ekokardiyografiyle desteklenen klinik bir tanıdır; acil perikardiyosentezle giderin, bu arada dolumu IV sıvıyla destekleyin ve ön yükü azaltan vazodilatör veya agresif diürezden kaçının.",
        country="GLOBAL", council="ESC", topic="cardiac_tamponade_management", domain="cardiology",
        title="2015 ESC Guidelines for the diagnosis and management of pericardial diseases",
        reference="Eur Heart J. 2015;36(42):2921-2964",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Pericardial-Diseases-Guidelines-on-the-Diagnosis-and-Management-of",
        pub_date="2015-08", license_tag="copyrighted-summarized"),

    # ---- Pulmonology / respiratory ----------------------------------------
    _gs("gs_esc_pulmonary_embolism",
        "In suspected pulmonary embolism, use a validated clinical probability score with D-dimer to decide on CT pulmonary angiography; anticoagulate confirmed or high-probability PE, and reserve systemic thrombolysis for high-risk PE with haemodynamic instability.",
        "Şüpheli pulmoner emboli olan hastalarda BT pulmoner anjiyografiye karar vermek için valide klinik olasılık skorunu D-dimer ile kullanın; doğrulanmış veya yüksek olasılıklı PE'yi antikoagüle edin ve sistemik trombolizi hemodinamik instabiliteli yüksek riskli PE için saklayın.",
        country="GLOBAL", council="ESC", topic="pulmonary_embolism_pathway", domain="pulmonology",
        title="2019 ESC Guidelines for the diagnosis and management of acute pulmonary embolism",
        reference="Eur Heart J. 2020;41(4):543-603",
        url="https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Acute-Pulmonary-Embolism-Diagnosis-and-Management-of",
        pub_date="2019-08", license_tag="copyrighted-summarized"),
    _gs("gs_bts_asthma_acute",
        "In an acute asthma attack, give high-dose inhaled short-acting beta-agonist with ipratropium and early systemic corticosteroid, titrate oxygen to a target of 94-98%, and treat a silent chest, exhaustion or a rising CO2 as life-threatening.",
        "Akut astım atağında yüksek doz inhale kısa etkili beta-agonisti ipratropium ile birlikte ve erken sistemik kortikosteroid verin, oksijeni %94-98 hedefe titre edin ve sessiz akciğer, tükenme veya yükselen CO2'yi yaşamı tehdit eden olarak değerlendirin.",
        country="UK", council="BTS/SIGN", topic="acute_asthma_management", domain="pulmonology",
        title="BTS/SIGN British guideline on the management of asthma (SIGN 158)",
        reference="BTS/SIGN 158",
        url="https://www.brit-thoracic.org.uk/quality-improvement/guidelines/asthma/",
        pub_date="2019-07", license_tag="open"),
    _gs("gs_gold_copd_exacerbation",
        "In a COPD exacerbation, titrate controlled oxygen to a target SpO2 of 88-92%, give inhaled bronchodilators and systemic corticosteroid, add an antibiotic when sputum is purulent, and start non-invasive ventilation for hypercapnic respiratory acidosis.",
        "KOAH alevlenmesinde kontrollü oksijeni %88-92 SpO2 hedefine titre edin, inhale bronkodilatör ve sistemik kortikosteroid verin, balgam pürülansa antibiyotik ekleyin ve hiperkapnik solunumsal asidozda non-invaziv ventilasyon başlatın.",
        country="GLOBAL", council="GOLD", topic="copd_exacerbation_management", domain="pulmonology",
        title="Global Strategy for Prevention, Diagnosis and Management of COPD (GOLD report)",
        reference="GOLD 2024 report",
        url="https://goldcopd.org/2024-gold-report/",
        pub_date="2023-11", license_tag="copyrighted-summarized"),
    _gs("gs_nice_cap_severity",
        "For community-acquired pneumonia, use a severity score (CRB-65 in the community, CURB-65 in hospital) to guide the site of care and antibiotic choice, and do not delay antibiotics once the diagnosis is made.",
        "Toplum kökenli pnömonide bakım yerini ve antibiyotik seçimini yönlendirmek için ağırlık skoru (toplumda CRB-65, hastanede CURB-65) kullanın ve tanı konunca antibiyotiği geciktirmeyin.",
        country="UK", council="NICE", topic="pneumonia_severity_assessment", domain="pulmonology",
        title="Pneumonia in adults: diagnosis and management (CG191)",
        reference="NICE CG191",
        url="https://www.nice.org.uk/guidance/cg191",
        pub_date="2014-12", license_tag="open"),
    _gs("gs_bts_pneumothorax",
        "A tension pneumothorax is a clinical diagnosis needing immediate decompression before imaging; a spontaneous pneumothorax is managed by size and symptoms with aspiration or an intercostal drain and high-flow oxygen.",
        "Tansiyon pnömotoraks görüntülemeden önce hemen dekompresyon gerektiren klinik bir tanıdır; spontan pnömotoraks boyut ve semptomlara göre aspirasyon veya interkostal dren ve yüksek akım oksijenle yönetilir.",
        country="UK", council="BTS", topic="pneumothorax_management", domain="pulmonology",
        title="BTS Pleural Disease Guideline — pneumothorax",
        reference="BTS pleural disease guideline",
        url="https://www.brit-thoracic.org.uk/quality-improvement/guidelines/pleural-disease/",
        pub_date="2023-07", license_tag="open"),

    # ---- Neurology --------------------------------------------------------
    _gs("gs_aha_stroke_thrombolysis",
        "For acute ischaemic stroke, exclude haemorrhage on non-contrast CT, then give IV thrombolysis to eligible patients within the licensed time window and refer large-vessel occlusion for mechanical thrombectomy; do not lower blood pressure aggressively before treatment.",
        "Akut iskemik inmede kontrastsız BT'de kanamayı dışlayın, ardından uygun hastalara lisanslı zaman penceresinde IV tromboliz verin ve büyük damar oklüzyonunu mekanik trombektomiye sevk edin; tedaviden önce tansiyonu agresif düşürmeyin.",
        country="GLOBAL", council="AHA/ASA", topic="ischaemic_stroke_reperfusion", domain="neurology",
        title="Guidelines for the Early Management of Patients With Acute Ischemic Stroke",
        reference="Stroke. 2019;50(12):e344-e418",
        url="https://www.ahajournals.org/doi/10.1161/STR.0000000000000211",
        pub_date="2019-10", license_tag="copyrighted-summarized"),
    _gs("gs_aha_ich_bp",
        "In acute intracerebral haemorrhage, reverse any anticoagulation urgently, lower a markedly elevated systolic blood pressure in a controlled fashion, and involve neurosurgery early; antiplatelet and thrombolytic drugs are contraindicated.",
        "Akut intraserebral kanamada antikoagülasyonu acilen geri çevirin, belirgin yüksek sistolik tansiyonu kontrollü şekilde düşürün ve beyin cerrahisini erken dahil edin; antiplatelet ve trombolitik ilaçlar kontrendikedir.",
        country="GLOBAL", council="AHA/ASA", topic="intracerebral_haemorrhage_management", domain="neurology",
        title="Guideline for the Management of Patients With Spontaneous Intracerebral Hemorrhage",
        reference="Stroke. 2022;53(7):e282-e361",
        url="https://www.ahajournals.org/doi/10.1161/STR.0000000000000407",
        pub_date="2022-05", license_tag="copyrighted-summarized"),
    _gs("gs_nice_meningitis_antibiotics",
        "For suspected bacterial meningitis or meningococcal sepsis, give parenteral broad-spectrum antibiotics (a third-generation cephalosporin) at the earliest opportunity and do not delay treatment to obtain a CT scan or lumbar puncture.",
        "Şüpheli bakteriyel menenjit veya meningokok sepsisinde en erken fırsatta parenteral geniş spektrumlu antibiyotik (üçüncü kuşak sefalosporin) verin ve tedaviyi BT veya lomber ponksiyon için geciktirmeyin.",
        country="UK", council="NICE", topic="bacterial_meningitis_antibiotics", domain="neurology",
        title="Meningitis (bacterial) and meningococcal disease: recognition, diagnosis and management (NG240)",
        reference="NICE NG240",
        url="https://www.nice.org.uk/guidance/ng240",
        pub_date="2024-03", license_tag="open"),
    _gs("gs_status_epilepticus",
        "Treat convulsive status epilepticus that lasts beyond 5 minutes with an IV benzodiazepine as first line, escalate to a second-line antiseizure medication if seizures persist, and check and correct glucose and sodium.",
        "5 dakikayı aşan konvülzif status epileptikusu birinci basamakta IV benzodiazepinle tedavi edin, nöbet sürerse ikinci basamak antiepileptiğe geçin ve glukoz ile sodyumu kontrol edip düzeltin.",
        country="UK", council="NICE", topic="status_epilepticus_management", domain="neurology",
        title="Epilepsies in children, young people and adults (NG217)",
        reference="NICE NG217",
        url="https://www.nice.org.uk/guidance/ng217",
        pub_date="2022-04", license_tag="open"),

    # ---- Gastroenterology / acute abdomen ---------------------------------
    _gs("gs_acute_abdomen_nbm",
        "For an acute surgical abdomen, resuscitate, keep the patient nil by mouth, provide analgesia and antiemetics, obtain bloods and appropriate imaging, and involve the surgical team early rather than delaying assessment.",
        "Akut cerrahi karında hastayı resüsite edin, ağızdan almayı kesin, analjezi ve antiemetik verin, kan tetkikleri ve uygun görüntüleme alın ve değerlendirmeyi geciktirmek yerine cerrahi ekibi erken dahil edin.",
        country="TR", council="TEPDAD", topic="acute_abdomen_initial_management", domain="gastroenterology",
        title="Akut karın — mezuniyet öncesi acil yaklaşım özeti",
        reference="TEPDAD ulusal çekirdek eğitim programı ile uyumlu özet",
        url="https://www.tepdad.org.tr",
        pub_date="2023-06", license_tag="open"),
    _gs("gs_pancreatitis_fluids",
        "In acute pancreatitis, give early goal-directed intravenous fluid resuscitation, control pain, and reserve antibiotics for proven infection; assess severity and monitor for organ dysfunction rather than giving routine prophylactic antibiotics.",
        "Akut pankreatitte erken hedefe yönelik intravenöz sıvı resüsitasyonu verin, ağrıyı kontrol edin ve antibiyotiği kanıtlanmış enfeksiyon için saklayın; rutin profilaktik antibiyotik vermek yerine ağırlığı değerlendirip organ disfonksiyonunu izleyin.",
        country="GLOBAL", council="WHO", topic="acute_pancreatitis_management", domain="gastroenterology",
        title="Acute pancreatitis — WHO-aligned emergency care summary",
        reference="WHO Emergency care guidance (aligned summary)",
        url="https://www.who.int/emergencycare",
        pub_date="2021-01", license_tag="open"),
    _gs("gs_nice_upper_gi_bleed",
        "In acute upper gastrointestinal bleeding, resuscitate and use a restrictive red-cell transfusion threshold, offer endoscopy within 24 hours, and for suspected variceal bleeding add a vasoactive drug and prophylactic antibiotics.",
        "Akut üst gastrointestinal kanamada resüsite edin ve kısıtlı eritrosit transfüzyon eşiği kullanın, 24 saat içinde endoskopi yapın ve şüpheli varis kanamasında vazoaktif ilaç ve profilaktik antibiyotik ekleyin.",
        country="UK", council="NICE", topic="upper_gi_bleed_management", domain="gastroenterology",
        title="Acute upper gastrointestinal bleeding in over 16s: management (CG141)",
        reference="NICE CG141",
        url="https://www.nice.org.uk/guidance/cg141",
        pub_date="2012-06", license_tag="open"),
    _gs("gs_tokyo_cholangitis",
        "Acute cholangitis is managed with prompt intravenous antibiotics and fluid resuscitation plus urgent biliary drainage (usually ERCP); in a septic patient with an obstructed duct, decompression should not be delayed.",
        "Akut kolanjit hızlı intravenöz antibiyotik ve sıvı resüsitasyonu artı acil biliyer drenaj (genellikle ERCP) ile yönetilir; tıkalı kanalı olan septik hastada dekompresyon geciktirilmemelidir.",
        country="GLOBAL", council="Tokyo Guidelines", topic="ascending_cholangitis_management", domain="gastroenterology",
        title="Tokyo Guidelines for acute cholangitis (summary of thresholds)",
        reference="J Hepatobiliary Pancreat Sci (TG18) — summarized",
        url="https://www.jshbps.jp/modules/en/index.php?content_id=9",
        pub_date="2018-01", license_tag="copyrighted-summarized"),

    # ---- Endocrine / metabolic --------------------------------------------
    _gs("gs_dka_management",
        "Diabetic ketoacidosis is treated with intravenous fluid resuscitation first, then a fixed-rate insulin infusion, with close potassium monitoring and replacement; do not give an insulin bolus before fluids and potassium are addressed.",
        "Diyabetik ketoasidoz önce intravenöz sıvı resüsitasyonu, ardından sabit hızlı insülin infüzyonu ile tedavi edilir; potasyum yakından izlenip replase edilir; sıvı ve potasyum ele alınmadan insülin bolusu verilmez.",
        country="UK", council="JBDS", topic="dka_management", domain="endocrine",
        title="JBDS-IP: The management of diabetic ketoacidosis in adults",
        reference="Joint British Diabetes Societies for Inpatient Care",
        url="https://abcd.care/joint-british-diabetes-societies-jbds-inpatient-care-group",
        pub_date="2023-06", license_tag="open"),
    _gs("gs_hhs_management",
        "In the hyperosmolar hyperglycaemic state, replace fluid cautiously to lower osmolality gradually, use low-rate or delayed insulin until fluids are running, give venous thromboembolism prophylaxis, and avoid over-rapid correction.",
        "Hiperozmolar hiperglisemik durumda ozmolariteyi kademeli düşürmek için sıvıyı dikkatli replase edin, sıvı akana kadar düşük hızlı veya geciktirilmiş insülin kullanın, venöz tromboemboli profilaksisi verin ve aşırı hızlı düzeltmeden kaçının.",
        country="UK", council="JBDS", topic="hhs_management", domain="endocrine",
        title="JBDS-IP: The management of the hyperosmolar hyperglycaemic state in adults",
        reference="Joint British Diabetes Societies for Inpatient Care",
        url="https://abcd.care/joint-british-diabetes-societies-jbds-inpatient-care-group",
        pub_date="2022-08", license_tag="open"),
    _gs("gs_hyperkalaemia_ecg",
        "Severe hyperkalaemia with ECG changes is a medical emergency: give IV calcium to stabilise the myocardium, shift potassium intracellularly with insulin-dextrose and a nebulised beta-agonist, then remove potassium and treat the cause.",
        "EKG değişiklikleriyle ağır hiperkalemi tıbbi acildir: miyokardı stabilize etmek için IV kalsiyum verin, insülin-dekstroz ve nebülize beta-agonistle potasyumu hücre içine kaydırın, ardından potasyumu uzaklaştırıp nedeni tedavi edin.",
        country="UK", council="UK Renal Association", topic="hyperkalaemia_emergency", domain="endocrine",
        title="Treatment of acute hyperkalaemia in adults (clinical practice guideline)",
        reference="UK Kidney Association (Renal Association)",
        url="https://ukkidney.org/health-professionals/guidelines",
        pub_date="2020-10", license_tag="open"),
    _gs("gs_adrenal_crisis",
        "Adrenal crisis is treated by giving intravenous hydrocortisone immediately together with fluid resuscitation and dextrose for hypoglycaemia; do not delay steroid replacement to wait for confirmatory tests.",
        "Adrenal kriz, hipoglisemi için sıvı resüsitasyonu ve dekstrozla birlikte hemen intravenöz hidrokortizon verilerek tedavi edilir; steroid replasmanını doğrulayıcı testler için geciktirmeyin.",
        country="GLOBAL", council="Endocrine Society", topic="adrenal_crisis_management", domain="endocrine",
        title="Diagnosis and Treatment of Primary Adrenal Insufficiency (summary)",
        reference="J Clin Endocrinol Metab — summarized",
        url="https://www.endocrine.org/clinical-practice-guidelines",
        pub_date="2016-02", license_tag="copyrighted-summarized"),

    # ---- Infectious disease -----------------------------------------------
    _gs("gs_nec_fasciitis",
        "Necrotising fasciitis is a surgical emergency: pain out of proportion, rapid progression or crepitus should prompt urgent surgical debridement and broad-spectrum antibiotics (including a protein-synthesis inhibitor such as clindamycin); imaging must not delay surgery.",
        "Nekrotizan fasiit cerrahi bir acildir: orantısız ağrı, hızlı ilerleme veya krepitasyon acil cerrahi debridman ve geniş spektrumlu antibiyotiği (klindamisin gibi bir protein sentezi inhibitörü dahil) gerektirmelidir; görüntüleme cerrahiyi geciktirmemelidir.",
        country="GLOBAL", council="IDSA", topic="necrotising_fasciitis_management", domain="infectious",
        title="IDSA Practice Guidelines for Skin and Soft Tissue Infections (summary)",
        reference="Clin Infect Dis — summarized",
        url="https://www.idsociety.org/practice-guideline/skin-and-soft-tissue-infections/",
        pub_date="2014-07", license_tag="copyrighted-summarized"),
    _gs("gs_nice_pyelonephritis",
        "Acute pyelonephritis is treated with a suitable systemic antibiotic and adequate fluids; imaging is arranged to exclude an obstructing stone, and an obstructed, infected urinary system requires urgent drainage.",
        "Akut piyelonefrit uygun bir sistemik antibiyotik ve yeterli sıvıyla tedavi edilir; tıkayıcı taşı dışlamak için görüntüleme ayarlanır ve tıkalı, enfekte üriner sistem acil drenaj gerektirir.",
        country="UK", council="NICE", topic="pyelonephritis_management", domain="infectious",
        title="Pyelonephritis (acute): antimicrobial prescribing (NG111)",
        reference="NICE NG111",
        url="https://www.nice.org.uk/guidance/ng111",
        pub_date="2018-10", license_tag="open"),
    _gs("gs_cellulitis_eron",
        "Cellulitis is treated with an antibiotic active against streptococci and staphylococci, the affected limb is elevated, and the erythema margin is marked to track progression; systemic upset or rapid spread warrants admission and review for a deeper infection.",
        "Selülit streptokok ve stafilokoklara etkili bir antibiyotikle tedavi edilir, etkilenen uzuv yükseltilir ve ilerlemeyi izlemek için eritem sınırı işaretlenir; sistemik bozukluk veya hızlı yayılma yatış ve daha derin enfeksiyon açısından değerlendirme gerektirir.",
        country="UK", council="NICE", topic="cellulitis_management", domain="infectious",
        title="Cellulitis and erysipelas: antimicrobial prescribing (NG141)",
        reference="NICE NG141",
        url="https://www.nice.org.uk/guidance/ng141",
        pub_date="2019-09", license_tag="open"),

    # ---- Renal / GU -------------------------------------------------------
    _gs("gs_nice_aki",
        "In acute kidney injury, identify and treat the cause, optimise volume status, stop nephrotoxic drugs, treat hyperkalaemia, and relieve any post-renal obstruction; refer for renal replacement therapy when refractory complications develop.",
        "Akut böbrek hasarında nedeni saptayıp tedavi edin, hacim durumunu optimize edin, nefrotoksik ilaçları kesin, hiperkalemiyi tedavi edin ve postrenal obstrüksiyonu giderin; dirençli komplikasyonlar geliştiğinde renal replasman tedavisine sevk edin.",
        country="UK", council="NICE", topic="acute_kidney_injury_management", domain="renal",
        title="Acute kidney injury: prevention, detection and management (NG148)",
        reference="NICE NG148",
        url="https://www.nice.org.uk/guidance/ng148",
        pub_date="2019-12", license_tag="open"),
    _gs("gs_renal_colic",
        "Renal colic is confirmed with a low-dose non-contrast CT of the urinary tract; give an NSAID as first-line analgesia, consider medical expulsive therapy for a distal ureteric stone, and treat an obstructed, infected system as an emergency.",
        "Renal kolik üriner sistemin düşük doz kontrastsız BT'siyle doğrulanır; birinci basamak analjezi olarak NSAİİ verin, distal üreter taşı için medikal ekspulsif tedaviyi düşünün ve tıkalı, enfekte sistemi acil olarak tedavi edin.",
        country="UK", council="NICE", topic="renal_colic_management", domain="renal",
        title="Renal and ureteric stones: assessment and management (NG118)",
        reference="NICE NG118",
        url="https://www.nice.org.uk/guidance/ng118",
        pub_date="2019-01", license_tag="open"),

    # ---- Toxicology -------------------------------------------------------
    _gs("gs_paracetamol_nac",
        "Paracetamol overdose is managed by the timed plasma paracetamol concentration plotted on the treatment nomogram; give N-acetylcysteine when the level is above the treatment line or presentation is late, rather than waiting for symptoms.",
        "Parasetamol aşırı dozu, tedavi nomogramına işaretlenen zamanlı plazma parasetamol düzeyine göre yönetilir; düzey tedavi çizgisinin üstündeyse veya başvuru geç ise, semptomları beklemek yerine N-asetilsistein verin.",
        country="UK", council="NPIS/TOXBASE", topic="paracetamol_overdose_management", domain="toxicology",
        title="Paracetamol overdose management (NPIS/TOXBASE summary)",
        reference="UK National Poisons Information Service",
        url="https://www.toxbase.org",
        pub_date="2022-01", license_tag="open"),
    _gs("gs_opioid_naloxone",
        "For opioid overdose with respiratory depression, support ventilation and give titrated naloxone to restore adequate breathing; use small repeated doses in a dependent patient to avoid precipitating severe acute withdrawal.",
        "Solunum depresyonuyla opioid aşırı dozunda ventilasyonu destekleyin ve yeterli solunumu geri getirmek için titre edilmiş nalokson verin; bağımlı hastada şiddetli akut yoksunluğu tetiklememek için küçük tekrarlı dozlar kullanın.",
        country="GLOBAL", council="WHO", topic="opioid_overdose_management", domain="toxicology",
        title="WHO guidelines on community management of opioid overdose",
        reference="WHO 2014",
        url="https://www.who.int/publications/i/item/9789241548816",
        pub_date="2014-11", license_tag="open"),

    # ---- Obstetrics / gynaecology -----------------------------------------
    _gs("gs_ectopic_pregnancy",
        "In any woman of reproductive age with abdominal or pelvic pain, perform a pregnancy test; a positive test with pain and an empty uterus on transvaginal ultrasound suggests ectopic pregnancy and needs urgent gynaecological assessment.",
        "Karın veya pelvik ağrısı olan üreme çağındaki her kadında gebelik testi yapın; ağrıyla pozitif test ve transvajinal ultrasonda boş uterus ektopik gebeliği düşündürür ve acil jinekolojik değerlendirme gerektirir.",
        country="UK", council="NICE", topic="ectopic_pregnancy_assessment", domain="obstetrics-gynecology",
        title="Ectopic pregnancy and miscarriage: diagnosis and initial management (NG126)",
        reference="NICE NG126",
        url="https://www.nice.org.uk/guidance/ng126",
        pub_date="2019-04", license_tag="open"),
    _gs("gs_preeclampsia_magnesium",
        "In severe pre-eclampsia or eclampsia, control severe hypertension with an antihypertensive such as labetalol and give intravenous magnesium sulfate to prevent or treat seizures; timely delivery is the definitive treatment.",
        "Ağır preeklampsi veya eklampside labetalol gibi bir antihipertansifle ağır hipertansiyonu kontrol edin ve nöbeti önlemek veya tedavi etmek için intravenöz magnezyum sülfat verin; zamanında doğum kesin tedavidir.",
        country="UK", council="NICE", topic="preeclampsia_eclampsia_management", domain="obstetrics-gynecology",
        title="Hypertension in pregnancy: diagnosis and management (NG133)",
        reference="NICE NG133",
        url="https://www.nice.org.uk/guidance/ng133",
        pub_date="2019-06", license_tag="open"),
    _gs("gs_pph_management",
        "Postpartum haemorrhage is managed with uterine massage and uterotonics (oxytocin first line) for atony, early tranexamic acid, and resuscitation with blood products; escalate promptly and address the underlying cause (the 'four Ts').",
        "Doğum sonu kanama atoni için uterin masaj ve uterotoniklerle (birinci basamak oksitosin), erken traneksamik asit ve kan ürünleriyle resüsitasyonla yönetilir; hızla eskale edin ve altta yatan nedeni ('dört T') giderin.",
        country="UK", council="RCOG", topic="postpartum_haemorrhage_management", domain="obstetrics-gynecology",
        title="Prevention and Management of Postpartum Haemorrhage (Green-top Guideline No. 52)",
        reference="RCOG Green-top Guideline 52",
        url="https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/",
        pub_date="2016-12", license_tag="open"),

    # ---- Psychiatry -------------------------------------------------------
    _gs("gs_suicide_risk",
        "For a patient with suicidal ideation, ensure immediate safety, undertake a structured risk assessment covering plan, intent and access to means, and do not leave a high-risk patient unobserved; arrange urgent mental-health assessment.",
        "İntihar düşüncesi olan hastada hemen güvenliği sağlayın, plan, niyet ve araca erişimi kapsayan yapılandırılmış bir risk değerlendirmesi yapın ve yüksek riskli hastayı gözetimsiz bırakmayın; acil ruh sağlığı değerlendirmesi ayarlayın.",
        country="UK", council="NICE", topic="self_harm_risk_assessment", domain="psychiatry",
        title="Self-harm: assessment, management and preventing recurrence (NG225)",
        reference="NICE NG225",
        url="https://www.nice.org.uk/guidance/ng225",
        pub_date="2022-09", license_tag="open"),
    _gs("gs_alcohol_withdrawal",
        "In alcohol withdrawal, use a symptom-triggered benzodiazepine regimen and give parenteral thiamine before any carbohydrate load to prevent Wernicke's encephalopathy; watch for seizures and delirium tremens.",
        "Alkol yoksunluğunda semptom tetiklemeli benzodiazepin rejimi kullanın ve Wernicke ensefalopatisini önlemek için herhangi bir karbonhidrat yüklemesinden önce parenteral tiamin verin; nöbet ve deliryum tremense dikkat edin.",
        country="UK", council="NICE", topic="alcohol_withdrawal_management", domain="psychiatry",
        title="Alcohol-use disorders: diagnosis and management of physical complications (CG100)",
        reference="NICE CG100",
        url="https://www.nice.org.uk/guidance/cg100",
        pub_date="2010-06", license_tag="open"),

    # ---- Haematology / oncology emergencies -------------------------------
    _gs("gs_nice_neutropenic_sepsis",
        "Treat suspected neutropenic sepsis as an acute medical emergency: start empirical broad-spectrum intravenous antibiotics immediately, within an hour of presentation, without waiting for the blood count or culture results.",
        "Şüpheli nötropenik sepsisi akut tıbbi acil olarak tedavi edin: kan sayımı veya kültür sonuçlarını beklemeden, başvurudan sonraki bir saat içinde hemen ampirik geniş spektrumlu intravenöz antibiyotik başlayın.",
        country="UK", council="NICE", topic="neutropenic_sepsis_management", domain="hematology",
        title="Neutropenic sepsis: prevention and management in people with cancer (CG151)",
        reference="NICE CG151",
        url="https://www.nice.org.uk/guidance/cg151",
        pub_date="2012-09", license_tag="open"),
    _gs("gs_sickle_acute_chest",
        "In a sickle cell crisis, give prompt strong analgesia, oxygen and fluids, and screen for acute chest syndrome (new fever, hypoxia and a chest infiltrate) which may need antibiotics, transfusion or exchange transfusion.",
        "Orak hücre krizinde hızlı güçlü analjezi, oksijen ve sıvı verin ve antibiyotik, transfüzyon veya değişim transfüzyonu gerektirebilecek akut göğüs sendromunu (yeni ateş, hipoksi ve akciğerde infiltrat) tarayın.",
        country="GLOBAL", council="WHO", topic="sickle_cell_crisis_management", domain="hematology",
        title="Sickle cell disease — acute crisis emergency care summary",
        reference="WHO Emergency care guidance (aligned summary)",
        url="https://www.who.int/emergencycare",
        pub_date="2021-01", license_tag="open"),

    # ---- Turkish-locale additions -----------------------------------------
    _gs("gs_moh_tr_anaphylaxis",
        "For anaphylaxis, give intramuscular adrenaline into the anterolateral thigh without delay, position the patient and give oxygen and IV fluids, and observe for a biphasic reaction; adrenaline is the first-line treatment.",
        "Anafilakside gecikmeden anterolateral uyluğa kas içi adrenalin verin, hastayı pozisyonlayın, oksijen ve IV sıvı verin ve bifazik reaksiyon açısından gözlemleyin; adrenalin birinci basamak tedavidir.",
        country="TR", council="T.C. Sağlık Bakanlığı", topic="anaphylaxis_management", domain="emergency",
        title="Anafilaksi — acil yaklaşım özeti",
        reference="T.C. Sağlık Bakanlığı, Acil Sağlık Hizmetleri",
        url="https://www.saglik.gov.tr",
        pub_date="2024-01", license_tag="open"),
    _gs("gs_tepdad_tr_stroke_pathway",
        "Recognise acute stroke early with a face-arm-speech test, protect the airway and check glucose, and activate the stroke pathway urgently so that eligible patients can receive reperfusion within the time window.",
        "Akut inmeyi yüz-kol-konuşma testiyle erken tanıyın, hava yolunu koruyup glukozu kontrol edin ve uygun hastaların zaman penceresinde reperfüzyon alabilmesi için inme yolağını acilen aktive edin.",
        country="TR", council="TEPDAD", topic="acute_stroke_recognition_tr", domain="neurology",
        title="Akut inme — mezuniyet öncesi acil yaklaşım özeti",
        reference="TEPDAD ulusal çekirdek eğitim programı ile uyumlu özet",
        url="https://www.tepdad.org.tr",
        pub_date="2023-06", license_tag="open"),
]

GUIDELINE_SEED.extend(_EXTRA_STATEMENTS)


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

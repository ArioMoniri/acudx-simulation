"""AcuDx Gateway — condition-specific case fixtures + localized content pools.

This module is the *content* half of the deterministic case engine
(``server/case_generator.py``). It exists so the templated fallback (used whenever
the local model is unavailable, and as the gap-fill base for the model path) can
bind objective data to the **specific condition**, not merely to its body system.

Why this matters clinically
---------------------------
The per-system profile in ``case_generator._PROFILES`` is a coarse default: it
would hand every cardiology case the same troponin + ECG, which is *wrong* for an
aortic dissection, a tamponade or a pericarditis. Here we attach condition-keyed
lab / imaging / treatment fixtures so an aortic dissection ≠ NSTEMI ≠ tamponade in
its objective picture. Conditions absent from :data:`CONDITION_FIXTURES` fall back
to the sensible system-level default (the long tail).

Data only — no logic. ``case_generator`` merges a fixture over the system profile
(condition fields win) and jitters numeric labs within plausible ranges using a
*seeded* RNG, so seeded generation stays reproducible.

Tuple shapes (mirroring ``case_generator``'s templated assembly)::

    lab       = (code, en, tr, value, unit, ref_low, ref_high, flag, category[, jitter[, hours_post_ingestion]])
                # a str ``value`` marks a QUALITATIVE result (dipstick / positive)
    imaging   = (code, modality_en, modality_tr, findings_en, findings_tr,
                 image_query_en, image_query_tr)
    treatment = (code, label_en, label_tr, appropriateness,
                 [(effect_key, delta, onset_ms), ...], narrative_en, narrative_tr)
    guide     = (source, citation, statement_en, statement_tr)   # optional per-condition

Facts and thresholds are not copyrightable; the wording here is our own concise,
educational expression for a *synthetic* simulator. No real patient data.
"""

from __future__ import annotations

from typing import Any

# --------------------------------------------------------------------------- #
# Localized, sex-coherent name pools (recombinant given + surname).            #
# name_hint is composed as "<Given> <SurnameInitial>." to match the UI style.  #
# --------------------------------------------------------------------------- #
GIVEN_NAMES: dict[str, dict[str, list[str]]] = {
    "tr": {
        "male": [
            "Ahmet", "Mehmet", "Mustafa", "Emre", "Can", "Burak", "Ali", "Hasan",
            "Hüseyin", "İbrahim", "Yusuf", "Murat", "Ömer", "Kaya", "Kerem", "Serkan",
            "Onur", "Barış", "Volkan", "Tolga", "Cem", "Efe", "Arda", "Berk", "Uğur",
            "Selim", "Tarık", "Fatih", "Okan", "Gökhan", "Levent", "Sinan", "Halil",
            "Kemal", "Oğuz", "Baran", "Ozan", "Yiğit", "Doruk", "Emir",
        ],
        "female": [
            "Elif", "Ayşe", "Zeynep", "Fatma", "Deniz", "Merve", "Selin", "Naz",
            "Ece", "Buse", "Esra", "Gizem", "Cansu", "Damla", "Melis", "Sıla",
            "Yasemin", "Aslı", "Pınar", "Derya", "Nur", "Sena", "İpek", "Ceren",
            "Beste", "Dilara", "Eda", "Gül", "Hande", "Irmak", "Kübra", "Lale",
            "Meltem", "Nilay", "Özge", "Rana", "Sevil", "Tuğçe", "Zehra", "Aleyna",
        ],
    },
    "en": {
        "male": [
            "James", "John", "Michael", "David", "Robert", "William", "Thomas",
            "Daniel", "Matthew", "Andrew", "Joseph", "Christopher", "Ryan", "Ethan",
            "Liam", "Noah", "Oliver", "Benjamin", "Samuel", "Alexander", "Henry",
            "Jack", "George", "Charlie", "Harry", "Oscar", "Leo", "Adam", "Nathan",
            "Aaron", "Peter", "Paul", "Mark", "Simon", "Luke", "Sean", "Dean",
            "Gary", "Neil", "Callum",
        ],
        "female": [
            "Mary", "Sarah", "Emma", "Olivia", "Sophie", "Emily", "Charlotte",
            "Amelia", "Jessica", "Laura", "Hannah", "Grace", "Lucy", "Chloe",
            "Ella", "Alice", "Rebecca", "Rachel", "Megan", "Katie", "Anna", "Ruth",
            "Fiona", "Claire", "Helen", "Karen", "Susan", "Jane", "Nicola", "Rosie",
            "Isla", "Freya", "Poppy", "Daisy", "Molly", "Bethany", "Naomi", "Sian",
            "Gemma", "Tara",
        ],
    },
}

SURNAMES: dict[str, list[str]] = {
    "tr": [
        "Yılmaz", "Demir", "Kaya", "Çelik", "Şahin", "Yıldız", "Yıldırım", "Öztürk",
        "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara",
        "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Korkmaz", "Çakır", "Erdoğan",
        "Yavuz", "Güneş", "Aksoy", "Bulut", "Turan", "Aktaş", "Bozkurt", "Taş",
        "Uçar", "Güler", "Yalçın", "Şen", "Erdem", "Sarı", "Avcı", "Tekin",
    ],
    "en": [
        "Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson",
        "Davies", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White",
        "Roberts", "Green", "Hall", "Wood", "Harris", "Clarke", "Jackson", "Hughes",
        "Edwards", "Turner", "Hill", "Moore", "Clark", "Harrison", "Lewis", "Scott",
        "Cooper", "Ward", "Morris", "King", "Baker", "Bell", "Bennett", "Carter",
        "Murphy", "Price",
    ],
}


def name_pool(locale: str, sex: str) -> tuple[list[str], list[str]]:
    """Return ``(given_names, surnames)`` for a locale + sex, defaulting sensibly.

    Falls back to Turkish (the primary case-content locale) for any unknown
    locale, and to the female given-name pool for a non-male sex."""
    loc = locale if locale in GIVEN_NAMES else "tr"
    key = "male" if str(sex).lower() == "male" else "female"
    return GIVEN_NAMES[loc][key], SURNAMES.get(loc, SURNAMES["tr"])


# --------------------------------------------------------------------------- #
# Varied bilingual onset phrasings (replaces the old fixed set of 3).          #
# --------------------------------------------------------------------------- #
ONSET_PHRASES: list[tuple[str, str]] = [
    ("It came on suddenly earlier today.", "Bugün aniden başladı."),
    ("It has been building gradually over hours.", "Saatler içinde giderek arttı."),
    ("It started this morning and has not settled.", "Bu sabah başladı ve geçmedi."),
    ("It woke me from sleep a few hours ago.", "Birkaç saat önce beni uykudan uyandırdı."),
    ("It began quite abruptly while I was resting.", "İstirahat halindeyken oldukça ani başladı."),
    ("It's been coming and going since yesterday.", "Dünden beri gelip gidiyor."),
    ("It crept up on me over the last couple of days.", "Son birkaç günde yavaş yavaş arttı."),
    ("It started right after some exertion.", "Bir eforun hemen ardından başladı."),
    ("It came on within minutes and peaked fast.", "Dakikalar içinde başladı ve hızla zirveye ulaştı."),
    ("It has slowly worsened through the day.", "Gün boyunca yavaşça kötüleşti."),
    ("It began last night and kept me awake.", "Dün gece başladı ve beni uyutmadı."),
    ("It started suddenly about an hour ago.", "Yaklaşık bir saat önce aniden başladı."),
    ("It's been going on for a few days now.", "Birkaç gündür devam ediyor."),
    ("It flared up out of nowhere this afternoon.", "Bu öğleden sonra birdenbire alevlendi."),
    ("It has been constant since it first started.", "İlk başladığından beri sürekli."),
    ("It came on over the past week and won't ease.", "Geçen hafta boyunca başladı ve geçmiyor."),
]


# --------------------------------------------------------------------------- #
# Condition-specific fixtures, keyed by catalog condition id.                  #
# Each value may set any of: labs / imaging / treatments / guide. Missing keys #
# inherit the system-level default from case_generator._PROFILES.              #
# --------------------------------------------------------------------------- #
CONDITION_FIXTURES: dict[str, dict[str, Any]] = {

    # ===================== CARDIOLOGY (fully covered) ====================== #
    "acs_stemi": {
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 5200, "ng/L", 0, 14, "HH", "cardiac", 500),
            ("2157-6", "Creatine kinase", "Kreatin kinaz", 640, "U/L", 30, 200, "H", "chemistry", 60),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "ST elevation in contiguous leads with reciprocal change.",
                    "Ardışık derivasyonlarda ST yükselmesi ve resiprok değişiklik.",
                    "STEMI ECG ST elevation anterior leads", "STEMI EKG anterior ST yükselmesi"),
        "treatments": [
            # Review 02 finding 15 (major): aspirin is an antiplatelet with no acute
            # analgesic effect; reperfusion pain relief follows balloon inflation
            # (90-120 min door-to-balloon), not PCI activation. ESC 2023 ACS
            # https://doi.org/10.1093/eurheartj/ehad191
            ("asa_p2y12", "Aspirin + P2Y12 loading", "Aspirin + P2Y12 yükleme", "indicated", [], "Dual antiplatelet loading for STEMI (no analgesic effect).", "STEMI'de ikili antiplatelet yükleme (analjezik etkisi yoktur)."),
            ("primary_pci", "Activate primary PCI", "Primer PKG aktivasyonu", "indicated", [("pain", -3.0, 5400000)], "Primary PCI is first-line reperfusion; pain relief follows reperfusion at ~90 min.", "Primer PKG birinci basamak reperfüzyondur; ağrı ~90. dakikadaki reperfüzyonla geçer."),
            ("iv_opioid", "IV opioid titrated for ongoing ischaemic pain", "Süren iskemik ağrı için titre IV opioid", "indicated", [("pain", -3.0, 300000)], "Titrated opioid for refractory ischaemic pain.", "Dirençli iskemik ağrı için titre opioid."),
            ("routine_o2", "Routine high-flow oxygen", "Rutin yüksek akım oksijen", "contraindicated", [], "Oxygen only if SpO2 < 90%.", "Oksijen yalnızca SpO2 < %90 ise."),
        ],
        "guide": ("ESC", "2023 ESC ACS Guidelines (summary)", "In STEMI, deliver primary PCI within 120 minutes of diagnosis; otherwise give fibrinolysis within 10 minutes.", "STEMI'de tanıdan sonra 120 dakika içinde primer PKG uygulayın; aksi halde 10 dakika içinde fibrinolitik verin."),
    },
    "acs_nstemi": {
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 180, "ng/L", 0, 14, "HH", "cardiac", 25),
            ("2160-0", "Creatinine", "Kreatinin", 1.1, "mg/dL", 0.6, 1.3, "N", "chemistry", 0.1),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Dynamic ST depression / T-wave inversion, no ST elevation.",
                    "Dinamik ST çökmesi / T negatifliği, ST yükselmesi yok.",
                    "NSTEMI ECG ST depression", "NSTEMI EKG ST çökmesi"),
        "treatments": [
            ("asa_p2y12", "Aspirin + P2Y12 inhibitor", "Aspirin + P2Y12 inhibitörü", "indicated", [], "Dual antiplatelet therapy for NSTE-ACS (no analgesic effect; review 02 finding 15).", "NSTE-AKS'de ikili antiplatelet tedavi (analjezik etkisi yoktur)."),
            ("gtn_opioid", "Sublingual GTN, then IV opioid if pain persists", "Dilaltı GTN, ağrı sürerse IV opioid", "indicated", [("pain", -2.5, 300000)], "Nitrate and opioid relieve ischaemic pain (SBP >= 90, no PDE-5 inhibitor).", "Nitrat ve opioid iskemik ağrıyı giderir (SKB >= 90, PDE-5 inhibitörü yok)."),
            ("anticoag", "Parenteral anticoagulation", "Parenteral antikoagülasyon", "indicated", [], "Anticoagulate and risk-stratify for early angiography.", "Antikoagüle edip erken anjiyografi için risk sınıflayın."),
            ("thrombolysis", "Empiric thrombolysis", "Ampirik tromboliz", "contraindicated", [], "Thrombolysis is not indicated without STEMI.", "STEMI olmadan tromboliz endike değildir."),
        ],
    },
    "unstable_angina": {
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 11, "ng/L", 0, 14, "N", "cardiac", 2),
            ("2093-3", "Total cholesterol", "Total kolesterol", 240, "mg/dL", 0, 190, "H", "chemistry", 10),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Transient ST/T change during pain, normal troponin.",
                    "Ağrı sırasında geçici ST/T değişimi, normal troponin.",
                    "unstable angina ECG transient ST", "kararsız angina EKG geçici ST"),
        "treatments": [
            ("antiplatelet", "Aspirin + anti-ischaemic therapy (nitrate, beta-blocker)", "Aspirin + anti-iskemik tedavi (nitrat, beta-bloker)", "indicated", [("pain", -2.0, 300000)], "Antiplatelet plus anti-ischaemic treatment; the nitrate, not the aspirin, eases the pain.", "Antiplatelet artı anti-iskemik tedavi; ağrıyı aspirin değil nitrat azaltır."),
            ("serial_trop", "Serial troponin + monitoring", "Seri troponin + monitörizasyon", "indicated", [], "Serial troponin to exclude evolving infarction.", "Gelişen enfarktüsü dışlamak için seri troponin."),
            ("thrombolysis", "Empiric thrombolysis", "Ampirik tromboliz", "contraindicated", [], "No role for thrombolysis in unstable angina.", "Kararsız anginada trombolizin yeri yoktur."),
        ],
    },
    "aortic_dissection": {
        "labs": [
            ("48065-7", "D-dimer", "D-dimer", 3200, "ng/mL", 0, 500, "HH", "coagulation", 300),
            ("718-7", "Haemoglobin", "Hemoglobin", 11.4, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
        ],
        "imaging": ("30746-2", "CT angiography of the aorta", "Aort BT anjiyografisi",
                    "Intimal flap with a true and false lumen.",
                    "Gerçek ve yalancı lümenle intimal flep.",
                    "aortic dissection CT intimal flap", "aort diseksiyonu BT intimal flep"),
        "treatments": [
            ("bp_hr_control", "IV beta-blocker to lower HR/BP", "HR/TA düşürmek için IV beta-bloker", "indicated", [("systolic", -20.0, 300000), ("hr", -15.0, 300000)], "Anti-impulse therapy targets HR and BP first.", "Anti-impuls tedavi önce HR ve TA hedefler."),
            ("surgery_referral", "Urgent cardiothoracic/vascular referral", "Acil kalp-damar cerrahisi konsültasyonu", "indicated", [], "Type A dissection needs emergency surgery.", "Tip A diseksiyon acil cerrahi gerektirir."),
            ("thrombolysis", "Thrombolysis / anticoagulation", "Tromboliz / antikoagülasyon", "contraindicated", [], "These are dangerous and contraindicated in dissection.", "Diseksiyonda bunlar tehlikeli ve kontrendikedir."),
        ],
        "guide": ("ESC", "Aortic disease (summary)", "Suspected acute aortic dissection needs prompt CT angiography and strict heart-rate and blood-pressure control before urgent surgical referral.", "Şüpheli akut aort diseksiyonunda hızlı BT anjiyografi, sıkı nabız ve tansiyon kontrolü ve acil cerrahi konsültasyon gerekir."),
    },
    "heart_failure_acute": {
        "labs": [
            ("33762-6", "NT-proBNP", "NT-proBNP", 4800, "pg/mL", 0, 300, "HH", "cardiac", 400),
            ("2160-0", "Creatinine", "Kreatinin", 1.5, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.1),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Pulmonary congestion with upper-lobe diversion and effusions.",
                    "Üst lob kan akımı yönlenmesi ve efüzyonla pulmoner konjesyon.",
                    "chest x-ray pulmonary oedema", "akciğer grafisi pulmoner ödem"),
        "treatments": [
            ("iv_diuretic", "IV loop diuretic", "IV loop diüretik", "indicated", [("rr", -4.0, 900000), ("spo2", 3.0, 900000)], "Loop diuretic relieves congestion.", "Loop diüretik konjesyonu giderir."),
            ("niv_nitrate", "NIV + IV nitrate if hypertensive", "Hipertansifse NIV + IV nitrat", "indicated", [("spo2", 4.0, 300000)], "NIV and nitrate for acute pulmonary oedema.", "Akut pulmoner ödemde NIV ve nitrat."),
            ("fluid_bolus", "Large IV fluid bolus", "Büyük IV sıvı bolusu", "contraindicated", [], "Fluid loading worsens pulmonary oedema.", "Sıvı yüklemesi pulmoner ödemi kötüleştirir."),
        ],
    },
    "afib_rvr": {
        "labs": [
            ("3016-3", "TSH", "TSH", 0.2, "mIU/L", 0.4, 4.0, "L", "endocrine", 0.05),
            ("2823-3", "Potassium", "Potasyum", 3.6, "mmol/L", 3.5, 5.0, "N", "chemistry", 0.1),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Irregularly irregular rhythm, absent P waves, rapid rate.",
                    "Düzensiz düzensiz ritim, P dalgası yok, hızlı yanıt.",
                    "atrial fibrillation ECG irregular", "atriyal fibrilasyon EKG düzensiz"),
        "treatments": [
            ("rate_control", "Rate control (beta-blocker / diltiazem)", "Hız kontrolü (beta-bloker / diltiazem)", "indicated", [("hr", -25.0, 600000)], "Rate control if haemodynamically stable.", "Hemodinamik stabilse hız kontrolü."),
            ("anticoag_score", "Anticoagulate per stroke risk", "İnme riskine göre antikoagülasyon", "indicated", [], "Assess CHA2DS2-VASc for anticoagulation.", "Antikoagülasyon için CHA2DS2-VASc değerlendirin."),
            ("dc_cardioversion", "DC cardioversion if unstable", "İnstabilse DC kardiyoversiyon", "indicated", [("hr", -40.0, 120000)], "Immediate cardioversion for instability.", "İnstabilitede hemen kardiyoversiyon."),
            # Live finding 2026-10-20 (no distractor, so no model case could pass the
            # safety judge). Elective cardioversion of AF lasting > 48 h without
            # anticoagulation risks stroke; ESC 2020 AF https://doi.org/10.1093/eurheartj/ehaa612
            ("cardiovert_no_anticoag", "Elective cardioversion without anticoagulation (AF > 48 h)", "Antikoagülasyonsuz elektif kardiyoversiyon (AF > 48 sa)", "contraindicated", [], "Stable AF of unknown or > 48 h duration needs anticoagulation (or TOE) before cardioversion.", "Süresi bilinmeyen veya > 48 sa stabil AF'de kardiyoversiyondan önce antikoagülasyon (veya TÖE) gerekir."),
        ],
    },
    "svt": {
        "labs": [
            ("2823-3", "Potassium", "Potasyum", 4.1, "mmol/L", 3.5, 5.0, "N", "chemistry", 0.1),
            ("3016-3", "TSH", "TSH", 1.8, "mIU/L", 0.4, 4.0, "N", "endocrine", 0.3),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Regular narrow-complex tachycardia around 180/min.",
                    "Yaklaşık 180/dk düzenli dar QRS taşikardi.",
                    "SVT ECG narrow complex tachycardia", "SVT EKG dar QRS taşikardi"),
        "treatments": [
            ("vagal", "Vagal manoeuvres", "Vagal manevralar", "indicated", [("hr", -20.0, 120000)], "Try vagal manoeuvres first.", "Önce vagal manevraları deneyin."),
            ("adenosine", "IV adenosine", "IV adenozin", "indicated", [("hr", -60.0, 60000)], "Adenosine for regular narrow-complex SVT.", "Düzenli dar QRS SVT'de adenozin."),
            ("cardioversion", "Synchronised cardioversion if unstable", "İnstabilse senkron kardiyoversiyon", "indicated", [], "Cardiovert if haemodynamically unstable.", "Hemodinamik instabilse kardiyoversiyon."),
            # Verapamil is avoided in hypotension; ESC 2019 SVT https://doi.org/10.1093/eurheartj/ehz467
            ("verapamil_hypotension", "IV verapamil while hypotensive", "Hipotansifken IV verapamil", "contraindicated", [], "A calcium-channel blocker deepens hypotension; cardiovert the unstable patient instead.", "Kalsiyum kanal blokeri hipotansiyonu derinleştirir; instabil hastada kardiyoversiyon yapın."),
        ],
    },
    "vt": {
        "labs": [
            ("2823-3", "Potassium", "Potasyum", 3.1, "mmol/L", 3.5, 5.0, "L", "chemistry", 0.1),
            ("19123-9", "Magnesium", "Magnezyum", 1.4, "mg/dL", 1.7, 2.4, "L", "chemistry", 0.1),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Broad-complex regular tachycardia with AV dissociation.",
                    "AV disosiyasyonla geniş QRS düzenli taşikardi.",
                    "ventricular tachycardia ECG broad complex", "ventriküler taşikardi EKG geniş QRS"),
        "treatments": [
            # Review 02 finding 5 (critical): pulseless VT is a cardiac-arrest rhythm
            # treated with UNSYNCHRONISED defibrillation + CPR; synchronised
            # cardioversion is for VT WITH a pulse that is unstable. AHA 2020 ACLS
            # https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916
            ("defib_pulseless", "Pulseless VT: unsynchronised defibrillation + CPR", "Nabızsız VT: senkronize olmayan defibrilasyon + KPR", "indicated", [("hr", -60.0, 60000)], "Pulseless VT follows the cardiac-arrest algorithm: defibrillate, do not synchronise.", "Nabızsız VT kardiyak arrest algoritmasını izler: defibrile edin, senkronize etmeyin."),
            ("sync_cardioversion", "Unstable VT with a pulse: synchronised cardioversion", "Nabızlı instabil VT: senkron kardiyoversiyon", "indicated", [("hr", -60.0, 60000)], "Synchronised cardioversion for VT with a pulse and instability.", "Nabızlı ve instabil VT'de senkron kardiyoversiyon."),
            ("sync_on_pulseless", "Attempt synchronised shock on pulseless VT", "Nabızsız VT'de senkron şok denemesi", "contraindicated", [], "Synchronising on pulseless VT delays or prevents the shock.", "Nabızsız VT'de senkronizasyon şoku geciktirir veya engeller."),
            ("amiodarone", "IV amiodarone + correct electrolytes", "IV amiodaron + elektrolit düzeltme", "indicated", [], "Amiodarone and electrolyte correction for stable VT.", "Stabil VT'de amiodaron ve elektrolit düzeltme."),
            ("verapamil", "IV verapamil", "IV verapamil", "contraindicated", [], "Verapamil is dangerous in VT.", "Verapamil VT'de tehlikelidir."),
        ],
    },
    "complete_heart_block": {
        "labs": [
            ("2823-3", "Potassium", "Potasyum", 5.1, "mmol/L", 3.5, 5.0, "H", "chemistry", 0.2),
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 45, "ng/L", 0, 14, "H", "cardiac", 8),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "AV dissociation with a slow ventricular escape rhythm.",
                    "Yavaş ventriküler kaçış ritmiyle AV disosiyasyon.",
                    "complete heart block ECG AV dissociation", "tam blok EKG AV disosiyasyon"),
        "treatments": [
            ("pacing", "Transcutaneous pacing", "Transkutan pace", "indicated", [("hr", 30.0, 120000)], "Pace symptomatic high-grade block.", "Semptomatik yüksek dereceli blokta pace."),
            ("pacemaker_referral", "Urgent pacemaker referral", "Acil kalıcı pil konsültasyonu", "indicated", [], "Refer for a permanent pacemaker.", "Kalıcı kalp pili için sevk edin."),
            ("av_blockers", "AV nodal blocking drugs", "AV nod bloke edici ilaçlar", "contraindicated", [], "Avoid beta-blockers / diltiazem in high-grade block.", "Yüksek dereceli blokta beta-bloker / diltiazemden kaçının."),
        ],
    },
    "pericarditis": {
        "labs": [
            ("1988-5", "C-reactive protein", "CRP", 58, "mg/L", 0, 5, "H", "chemistry", 6),
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 22, "ng/L", 0, 14, "H", "cardiac", 4),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Widespread saddle-shaped ST elevation with PR depression.",
                    "Yaygın çukur şekilli ST yükselmesi ve PR çökmesi.",
                    "pericarditis ECG diffuse ST elevation", "perikardit EKG yaygın ST yükselmesi"),
        "treatments": [
            ("nsaid_colchicine", "NSAID + colchicine", "NSAİİ + kolşisin", "indicated", [("pain", -3.0, 900000)], "NSAID plus colchicine is first-line.", "NSAİİ artı kolşisin birinci basamaktır."),
            ("restrict_exertion", "Restrict strenuous exertion", "Ağır efordan kaçın", "indicated", [], "Avoid strenuous activity until resolved.", "Düzelene kadar ağır aktiviteden kaçının."),
            ("anticoagulation", "Therapeutic anticoagulation", "Terapötik antikoagülasyon", "contraindicated", [], "Anticoagulation risks haemorrhagic effusion.", "Antikoagülasyon hemorajik efüzyon riski taşır."),
        ],
    },
    "cardiac_tamponade": {
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 12.6, "g/dL", 12.0, 16.0, "N", "haematology", 0.4),
            ("2524-7", "Lactate", "Laktat", 2.8, "mmol/L", 0.5, 2.0, "H", "blood-gas", 0.3),
        ],
        "imaging": ("34534-8", "Bedside echocardiography", "Yatak başı ekokardiyografi",
                    "Pericardial effusion with diastolic right-heart collapse.",
                    "Diyastolik sağ kalp kollapsıyla perikardiyal efüzyon.",
                    "cardiac tamponade echo pericardial effusion", "tamponad eko perikardiyal efüzyon"),
        "treatments": [
            ("pericardiocentesis", "Urgent pericardiocentesis", "Acil perikardiyosentez", "indicated", [("systolic", 20.0, 300000)], "Drain the effusion to relieve tamponade.", "Tamponadı gidermek için efüzyonu boşaltın."),
            # Review 02 finding 12 (major): fluid loading helps only hypovolaemic
            # tamponade and can worsen filling otherwise. ESC 2015 pericardial
            # diseases https://doi.org/10.1093/eurheartj/ehv318
            ("fluid_support", "Small fluid bolus only if hypovolaemic (bridge to drainage)", "Yalnızca hipovolemikse küçük sıvı bolusu (drenaja köprü)", "neutral", [], "A small bolus may bridge a hypovolaemic patient to drainage; it is not a treatment for tamponade.", "Küçük bolus hipovolemik hastayı drenaja köprüleyebilir; tamponad tedavisi değildir."),
            ("aggressive_diuresis", "Aggressive diuresis / vasodilators", "Agresif diürez / vazodilatör", "contraindicated", [], "Reducing preload worsens tamponade.", "Ön yükü azaltmak tamponadı kötüleştirir."),
        ],
    },
    "hypertensive_emergency": {
        "labs": [
            ("2160-0", "Creatinine", "Kreatinin", 1.7, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.15),
            # Review 02 finding 39: qualitative results carry a string value (LOINC
            # 5804-0 urine protein dipstick, ordinal) instead of a numeric stand-in.
            ("5804-0", "Urine protein (dipstick)", "İdrar proteini (strip)", "2+", "", None, None, "H", "urinalysis"),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Left ventricular hypertrophy with strain pattern.",
                    "Zorlanma paterniyle sol ventrikül hipertrofisi.",
                    "hypertensive emergency ECG LVH strain", "hipertansif acil EKG LVH zorlanma"),
        "treatments": [
            ("controlled_iv_antihtn", "Controlled IV antihypertensive", "Kontrollü IV antihipertansif", "indicated", [("systolic", -25.0, 600000)], "Lower MAP by ~20-25% in the first hour.", "İlk saatte OAB'yi ~%20-25 düşürün."),
            ("treat_organ", "Treat the end-organ target", "Hedef organı tedavi et", "indicated", [], "Tailor therapy to the affected organ.", "Tedaviyi etkilenen organa göre uyarlayın."),
            ("rapid_normalise", "Rapid normalisation of blood pressure", "Tansiyonu hızla normale indirme", "contraindicated", [], "Over-rapid drops cause organ hypoperfusion.", "Aşırı hızlı düşüş organ hipoperfüzyonu yapar."),
        ],
    },
    "infective_endocarditis": {
        "labs": [
            ("1988-5", "C-reactive protein", "CRP", 96, "mg/L", 0, 5, "H", "chemistry", 8),
            ("718-7", "Haemoglobin", "Hemoglobin", 10.2, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
        ],
        "imaging": ("34534-8", "Echocardiography", "Ekokardiyografi",
                    "Valvular vegetation with regurgitation.",
                    "Yetmezlikle birlikte kapak vejetasyonu.",
                    "endocarditis echo vegetation", "endokardit eko vejetasyon"),
        "treatments": [
            ("cultures_x3", "Three sets of blood cultures before antibiotics", "Antibiyotik öncesi üç set kan kültürü", "indicated", [], "Take three culture sets before antibiotics.", "Antibiyotikten önce üç set kültür alın."),
            ("prolonged_abx", "Prolonged IV antibiotics", "Uzun süreli IV antibiyotik", "indicated", [], "Extended targeted IV antibiotic course (no vital-sign change within the session; review 02 finding 14).", "Uzun süreli hedefli IV antibiyotik kürü."),
            ("single_oral_discharge", "Single oral dose then discharge", "Tek oral doz sonrası taburcu", "contraindicated", [], "Endocarditis needs admission, not discharge.", "Endokardit yatış gerektirir, taburcu değil."),
        ],
    },
    "myocarditis": {
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 320, "ng/L", 0, 14, "HH", "cardiac", 30),
            ("1988-5", "C-reactive protein", "CRP", 42, "mg/L", 0, 5, "H", "chemistry", 5),
        ],
        "imaging": ("34534-8", "Echocardiography", "Ekokardiyografi",
                    "Globally reduced systolic function in a young patient.",
                    "Genç hastada global azalmış sistolik fonksiyon.",
                    "myocarditis echo reduced ejection fraction", "miyokardit eko azalmış EF"),
        "treatments": [
            ("supportive_monitor", "Supportive care + rhythm monitoring", "Destek tedavi + ritim izlemi", "indicated", [], "Monitor for arrhythmia and heart failure.", "Aritmi ve kalp yetmezliği için izleyin."),
            ("treat_hf", "Treat heart failure", "Kalp yetmezliğini tedavi et", "indicated", [("rr", -3.0, 900000)], "Standard heart-failure therapy as needed.", "Gerektiğinde standart kalp yetmezliği tedavisi."),
            ("strenuous_exercise", "Advise strenuous exercise", "Ağır egzersiz öner", "contraindicated", [], "Avoid exertion during active myocarditis.", "Aktif miyokarditte efordan kaçının."),
        ],
    },
    "aortic_stenosis": {
        "labs": [
            ("33762-6", "NT-proBNP", "NT-proBNP", 1400, "pg/mL", 0, 300, "H", "cardiac", 120),
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 18, "ng/L", 0, 14, "H", "cardiac", 3),
        ],
        "imaging": ("34534-8", "Echocardiography", "Ekokardiyografi",
                    "Severe aortic stenosis with a high transvalvular gradient.",
                    "Yüksek transvalvüler gradyanla ağır aort darlığı.",
                    "aortic stenosis echo severe gradient", "aort darlığı eko ağır gradyan"),
        "treatments": [
            ("valve_referral", "Refer for valve intervention", "Kapak girişimi için sevk", "indicated", [], "Symptomatic severe AS needs valve intervention.", "Semptomatik ağır AS kapak girişimi gerektirir."),
            ("cautious_fluid", "Cautious fluid + rate control", "Dikkatli sıvı + hız kontrolü", "indicated", [], "Maintain preload and avoid tachycardia.", "Ön yükü koruyun ve taşikardiden kaçının."),
            ("gtn_vasodilator", "Sublingual nitrate / vasodilator", "Dilaltı nitrat / vazodilatör", "contraindicated", [], "Vasodilators can cause collapse in severe AS.", "Vazodilatörler ağır AS'de kollapsa yol açabilir."),
        ],
    },
    "stable_angina": {
        "labs": [
            ("67151-1", "High-sensitivity troponin", "Yüksek duyarlıklı troponin", 6, "ng/L", 0, 14, "N", "cardiac", 1),
            ("18262-6", "LDL cholesterol", "LDL kolesterol", 165, "mg/dL", 0, 100, "H", "chemistry", 8),
        ],
        "imaging": ("11524-6", "Resting 12-lead ECG", "İstirahat 12 derivasyonlu EKG",
                    "Normal at rest; consider functional ischaemia testing.",
                    "İstirahatte normal; fonksiyonel iskemi testi düşünün.",
                    "stable angina resting ECG normal", "kararlı angina istirahat EKG normal"),
        "treatments": [
            ("antianginal", "Anti-anginal + secondary prevention", "Anti-anjinal + ikincil koruma", "indicated", [("pain", -2.0, 600000)], "Beta-blocker plus statin and antiplatelet.", "Beta-bloker artı statin ve antiplatelet."),
            ("gtn_prn", "Sublingual GTN for episodes", "Ataklar için dilaltı GTN", "indicated", [("pain", -2.5, 300000)], "GTN for symptomatic episodes.", "Semptomatik ataklarda GTN."),
            ("routine_urgent_pci", "Routine urgent PCI without ischaemia", "İskemi olmadan rutin acil PKG", "contraindicated", [], "No emergency revascularisation for stable angina.", "Kararlı anginada acil revaskülarizasyon yoktur."),
        ],
    },

    # ===================== PULMONOLOGY ===================================== #
    "pulmonary_embolism": {
        "labs": [
            ("48065-7", "D-dimer", "D-dimer", 2600, "ng/mL", 0, 500, "HH", "coagulation", 250),
            ("2703-7", "Arterial pO2", "Arteriyel pO2", 64, "mmHg", 80, 100, "L", "blood-gas", 4),
        ],
        "imaging": ("36953-5", "CT pulmonary angiogram", "BT pulmoner anjiyografi",
                    "Filling defect in a pulmonary artery branch.",
                    "Pulmoner arter dalında dolum defekti.",
                    "pulmonary embolism CTPA filling defect", "pulmoner emboli BTPA dolum defekti"),
        "treatments": [
            ("anticoag", "Therapeutic anticoagulation", "Terapötik antikoagülasyon", "indicated", [], "Anticoagulate once PE is confirmed or highly likely.", "PE doğrulanınca/çok olası ise antikoagüle edin."),
            # Review 02 finding 13 (major): systemic thrombolysis is class I for
            # high-risk PE (shock / persistent hypotension) and class III for
            # intermediate-risk PE without deterioration. ESC 2019 acute PE
            # https://doi.org/10.1093/eurheartj/ehz405
            ("thrombolysis_high_risk", "Systemic thrombolysis for high-risk PE (shock or persistent hypotension) without contraindication", "Kontrendikasyon yoksa yüksek riskli PE'de (şok veya kalıcı hipotansiyon) sistemik tromboliz", "indicated", [("systolic", 12.0, 1800000)], "Class I: thrombolyse haemodynamically unstable PE.", "Sınıf I: hemodinamik instabil PE'de tromboliz."),
            ("thrombolysis_intermediate", "Thrombolysis in intermediate-risk PE without deterioration", "Kötüleşme olmayan orta riskli PE'de tromboliz", "contraindicated", [], "Class III: routine thrombolysis is not recommended in intermediate-risk PE.", "Sınıf III: orta riskli PE'de rutin tromboliz önerilmez."),
            ("oxygen", "Supplemental oxygen", "Ek oksijen", "indicated", [("spo2", 4.0, 300000)], "Correct hypoxia with oxygen.", "Hipoksiyi oksijenle düzeltin."),
        ],
    },
    "asthma_exacerbation": {
        "labs": [
            ("33452-4", "Peak expiratory flow (% best)", "Zirve akım (%en iyi)", 45, "%", 80, 100, "L", "respiratory", 5),
            ("2019-8", "Arterial pCO2", "Arteriyel pCO2", 34, "mmHg", 35, 45, "L", "blood-gas", 3),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Hyperinflation; excludes pneumothorax / consolidation.",
                    "Havalanma artışı; pnömotoraks / konsolidasyonu dışlar.",
                    "asthma chest x-ray hyperinflation", "astım akciğer grafisi havalanma"),
        "treatments": [
            ("neb_salbutamol", "Nebulised salbutamol + ipratropium", "Nebülize salbutamol + ipratropium", "indicated", [("rr", -6.0, 300000), ("spo2", 3.0, 300000)], "Back-to-back bronchodilators.", "Ardışık bronkodilatörler."),
            ("systemic_steroid", "Systemic corticosteroid", "Sistemik kortikosteroid", "indicated", [], "Early steroids in every acute exacerbation.", "Her akut alevlenmede erken steroid."),
            ("sedation", "Sedation for agitation", "Ajitasyon için sedasyon", "contraindicated", [], "Sedatives risk respiratory arrest in asthma.", "Sedatifler astımda solunum arresti riski taşır."),
        ],
    },
    "copd_exacerbation": {
        "labs": [
            ("2019-8", "Arterial pCO2", "Arteriyel pCO2", 58, "mmHg", 35, 45, "H", "blood-gas", 4),
            ("2744-1", "Arterial pH", "Arteriyel pH", 7.30, "", 7.35, 7.45, "L", "blood-gas", 0.02),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Hyperinflated lungs; screen for consolidation.",
                    "Havalanması artmış akciğerler; konsolidasyon taraması.",
                    "COPD chest x-ray hyperinflation", "KOAH akciğer grafisi havalanma"),
        "treatments": [
            ("controlled_o2", "Controlled oxygen to SpO2 88-92%", "SpO2 %88-92'ye kontrollü oksijen", "indicated", [("spo2", 3.0, 300000)], "Titrate oxygen to avoid CO2 narcosis.", "CO2 narkozundan kaçınmak için oksijeni titre edin."),
            ("neb_steroid_abx", "Nebulisers + steroid ± antibiotics", "Nebül + steroid ± antibiyotik", "indicated", [("rr", -4.0, 600000)], "Bronchodilators, steroids and antibiotics if purulent.", "Bronkodilatör, steroid ve pürülansta antibiyotik."),
            ("niv", "NIV for hypercapnic acidosis", "Hiperkapnik asidozda NIV", "indicated", [], "NIV when pH < 7.35 with hypercapnia.", "Hiperkapniyle pH < 7.35 iken NIV."),
            # BTS 2017: target 88-92% in hypercapnic risk https://doi.org/10.1136/thoraxjnl-2016-209729
            ("untitrated_high_o2", "Untitrated 15 L/min oxygen via reservoir mask", "Titre edilmeden rezervuarlı maskeyle 15 L/dk oksijen", "contraindicated", [], "Uncontrolled oxygen worsens hypercapnia in COPD; titrate to 88-92%.", "Kontrolsüz oksijen KOAH'ta hiperkapniyi kötüleştirir; %88-92'ye titre edin."),
        ],
    },
    # Live finding 2026-10-20: the emergency profile had no contraindicated
    # distractor, so a model-authored sepsis case could never satisfy the safety
    # judge. Delaying antimicrobials is the teachable harm: SSC recommends them
    # within 1 hour of recognising probable sepsis or shock
    # https://www.sccm.org/SurvivingSepsisCampaign/Guidelines
    # sepsis_uncomplicated: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    # pneumonia_cap: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    "tension_pneumothorax": {
        "labs": [
            ("2703-7", "Arterial pO2", "Arteriyel pO2", 58, "mmHg", 80, 100, "L", "blood-gas", 4),
        ],
        "imaging": ("36643-5", "Chest X-ray (after decompression)", "Dekompresyon sonrası akciğer grafisi",
                    "Collapsed lung with mediastinal shift (do not delay treatment for imaging).",
                    "Mediastinal kaymayla kollabe akciğer (tedaviyi görüntüleme için geciktirmeyin).",
                    "tension pneumothorax x-ray mediastinal shift", "tansiyon pnömotoraks grafi mediastinal kayma"),
        "treatments": [
            ("decompression", "Immediate needle/finger thoracostomy", "Hemen iğne/parmak torakostomi", "indicated", [("spo2", 8.0, 120000), ("systolic", 15.0, 120000)], "Decompress before any imaging.", "Görüntülemeden önce dekompresyon."),
            ("chest_drain", "Definitive chest drain", "Kesin göğüs tüpü", "indicated", [], "Insert a chest drain after decompression.", "Dekompresyon sonrası göğüs tüpü takın."),
            ("await_xray", "Wait for CXR before treating", "Tedaviden önce grafi bekle", "contraindicated", [], "Tension pneumothorax is a clinical diagnosis.", "Tansiyon pnömotoraks klinik tanıdır."),
        ],
    },
    "carbon_monoxide": {
        "labs": [
            ("20563-3", "Carboxyhaemoglobin", "Karboksihemoglobin", 24, "%", 0, 3, "HH", "blood-gas", 3),
            ("2524-7", "Lactate", "Laktat", 3.4, "mmol/L", 0.5, 2.0, "H", "blood-gas", 0.4),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Screen for ischaemia from impaired oxygen delivery.",
                    "Bozulmuş oksijen taşınmasına bağlı iskemi taraması.",
                    "carbon monoxide ECG ischaemia", "karbonmonoksit EKG iskemi"),
        "treatments": [
            ("high_flow_o2", "High-flow 100% oxygen", "Yüksek akım %100 oksijen", "indicated", [], "100% oxygen shortens carboxyhaemoglobin half-life.", "%100 oksijen karboksihemoglobin yarı ömrünü kısaltır."),
            ("remove_source", "Remove from the source", "Kaynaktan uzaklaştır", "indicated", [], "Immediate removal from exposure.", "Maruziyetten hemen uzaklaştırma."),
            ("hyperbaric", "Consider hyperbaric oxygen", "Hiperbarik oksijeni değerlendir", "neutral", [], "Consider hyperbaric in severe poisoning.", "Ağır zehirlenmede hiperbariği düşünün."),
            # Pulse oximetry reads carboxyhaemoglobin as oxyhaemoglobin (Hampson,
            # Chest 1998 https://doi.org/10.1378/chest.114.4.1036); co-oximetry is needed.
            ("discharge_normal_spo2", "Discharge because pulse oximetry SpO2 is normal", "Nabız oksimetresi SpO2 normal diye taburcu", "contraindicated", [], "SpO2 is falsely normal in CO poisoning; measure COHb by co-oximetry.", "CO zehirlenmesinde SpO2 yanlış normaldir; COHb'yi ko-oksimetriyle ölçün."),
        ],
    },

    # ===================== NEUROLOGY ======================================= #
    "ischemic_stroke": {
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 6.8, "mmol/L", 4.0, 7.8, "N", "chemistry", 0.4),
            ("6301-6", "INR", "INR", 1.0, "", 0.8, 1.2, "N", "coagulation", 0.05),
        ],
        "imaging": ("30799-1", "Non-contrast CT head", "Kontrastsız beyin BT",
                    "No haemorrhage; early ischaemic change only.",
                    "Kanama yok; yalnızca erken iskemik değişiklik.",
                    "ischaemic stroke CT no haemorrhage", "iskemik inme BT kanama yok"),
        "treatments": [
            ("thrombolysis_window", "IV thrombolysis if within window", "Pencere içindeyse IV tromboliz", "indicated", [], "Thrombolyse eligible patients within the time window.", "Uygun hastalara zaman penceresinde tromboliz."),
            ("thrombectomy", "Thrombectomy referral for LVO", "Büyük damar oklüzyonunda trombektomi sevki", "indicated", [], "Refer large-vessel occlusion for thrombectomy.", "Büyük damar oklüzyonunu trombektomiye sevk edin."),
            ("early_antihtn", "Aggressive BP lowering before imaging", "Görüntüleme öncesi agresif TA düşürme", "contraindicated", [], "Do not lower BP aggressively before imaging.", "Görüntüleme öncesi TA'yı agresif düşürmeyin."),
            # Review 02 finding 37: thrombolysis BP gate <185/110 before and <180/105
            # after alteplase/tenecteplase; glucose exclusion <2.8 or >22 mmol/L.
            # AHA/ASA 2019 https://doi.org/10.1161/STR.0000000000000211
            ("bp_gate_lysis", "Lower BP to below 185/110 before thrombolysis (then keep below 180/105)", "Tromboliz öncesi TA'yı 185/110 altına düşür (sonra 180/105 altında tut)", "indicated", [("systolic", -15.0, 600000)], "Thrombolysis is allowed only with BP below 185/110 and glucose between 2.8 and 22 mmol/L.", "Tromboliz yalnızca TA 185/110 altında ve glukoz 2.8-22 mmol/L arasında iken verilir."),
        ],
    },
    "intracerebral_hemorrhage": {
        "labs": [
            ("6301-6", "INR", "INR", 2.6, "", 0.8, 1.2, "H", "coagulation", 0.2),
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 8.1, "mmol/L", 4.0, 7.8, "H", "chemistry", 0.5),
        ],
        "imaging": ("30799-1", "Non-contrast CT head", "Kontrastsız beyin BT",
                    "Acute intraparenchymal hyperdensity with mass effect.",
                    "Kitle etkisiyle akut intraparankimal hiperdansite.",
                    "intracerebral haemorrhage CT hyperdensity", "intraserebral kanama BT hiperdansite"),
        "treatments": [
            ("reverse_anticoag", "Reverse anticoagulation urgently", "Antikoagülasyonu acilen geri çevir", "indicated", [], "Rapidly reverse any anticoagulant.", "Antikoagülanı hızla geri çevirin."),
            ("bp_control", "Careful blood-pressure control", "Dikkatli tansiyon kontrolü", "indicated", [("systolic", -20.0, 600000)], "Controlled BP lowering per protocol.", "Protokole göre kontrollü TA düşürme."),
            ("thrombolysis", "Thrombolysis / antiplatelet", "Tromboliz / antiplatelet", "contraindicated", [], "These worsen intracranial bleeding.", "Bunlar kafa içi kanamayı kötüleştirir."),
        ],
    },
    "subarachnoid_hemorrhage": {
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 6.9, "mmol/L", 4.0, 7.8, "N", "chemistry", 0.4),
            ("14426-1", "CSF xanthochromia (if CT negative)", "BOS ksantokromi (BT negatifse)", "positive", "", None, None, "H", "csf"),
        ],
        "imaging": ("30799-1", "Non-contrast CT head", "Kontrastsız beyin BT",
                    "Blood in the basal cisterns.",
                    "Bazal sisternalarda kan.",
                    "subarachnoid haemorrhage CT basal cisterns", "subaraknoid kanama BT bazal sisterna"),
        "treatments": [
            ("nimodipine", "Oral nimodipine", "Oral nimodipin", "indicated", [], "Nimodipine reduces vasospasm-related deficits.", "Nimodipin vazospazma bağlı defisitleri azaltır."),
            ("neurosurgery_referral", "Urgent neurosurgical referral", "Acil beyin cerrahisi konsültasyonu", "indicated", [], "Refer for aneurysm securing.", "Anevrizma kapatılması için sevk edin."),
            ("antiplatelet", "Antiplatelet therapy", "Antiplatelet tedavi", "contraindicated", [], "Antiplatelets worsen a bleed.", "Antiplateletler kanamayı kötüleştirir."),
        ],
    },
    # bacterial_meningitis: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    "status_epilepticus": {
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 5.4, "mmol/L", 4.0, 7.8, "N", "chemistry", 0.4),
            ("2947-0", "Sodium", "Sodyum", 132, "mmol/L", 135, 145, "L", "chemistry", 2),
        ],
        "imaging": ("30799-1", "Non-contrast CT head", "Kontrastsız beyin BT",
                    "Seek a structural cause once seizures are controlled.",
                    "Nöbetler kontrol altına alınınca yapısal neden aranır.",
                    "status epilepticus CT structural cause", "status epileptikus BT yapısal neden"),
        "treatments": [
            ("benzodiazepine", "IV benzodiazepine (first line)", "IV benzodiazepin (birinci basamak)", "indicated", [], "Benzodiazepine first for a seizure > 5 min.", "5 dakikadan uzun nöbette önce benzodiazepin."),
            ("second_line_aed", "Second-line AED (levetiracetam/phenytoin)", "İkinci basamak AEİ (levetirasetam/fenitoin)", "indicated", [], "Load a second-line agent if seizures persist.", "Nöbet sürerse ikinci basamak yükleyin."),
            ("delay_benzo", "Withhold benzodiazepine to observe", "Gözlem için benzodiazepini geciktir", "contraindicated", [], "Do not delay first-line treatment.", "Birinci basamağı geciktirmeyin."),
        ],
    },

    # ===================== GASTROENTEROLOGY ================================ #
    "appendicitis": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 15.4, "10^9/L", 4.0, 11.0, "H", "haematology", 1.0),
            ("1988-5", "C-reactive protein", "CRP", 72, "mg/L", 0, 5, "H", "chemistry", 8),
        ],
        "imaging": ("24558-9", "Abdominal ultrasound / CT", "Karın ultrasonu / BT",
                    "Non-compressible, dilated appendix with fat stranding.",
                    "Yağ dokusunda ödemle sıkışmayan, genişlemiş apendiks.",
                    "appendicitis ultrasound dilated appendix", "apandisit ultrason genişlemiş apendiks"),
        "treatments": [
            ("nbm_fluids_analgesia", "NBM + IV fluids + analgesia", "Ağızdan kapalı + IV sıvı + analjezi", "indicated", [("pain", -3.0, 300000)], "Resuscitate and keep nil by mouth.", "Resüsite edin ve ağızdan almayın."),
            ("surgical_referral", "Surgical referral for appendicectomy", "Apendektomi için cerrahi sevk", "indicated", [], "Refer for appendicectomy.", "Apendektomi için sevk edin."),
            ("oral_intake", "Encourage oral intake", "Oral alımı teşvik", "contraindicated", [], "Keep NBM if surgery is likely.", "Cerrahi olasıysa ağızdan almayın."),
        ],
    },
    "pancreatitis": {
        "labs": [
            ("3040-3", "Lipase", "Lipaz", 1250, "U/L", 0, 60, "HH", "chemistry", 120),
            ("17861-6", "Calcium", "Kalsiyum", 7.9, "mg/dL", 8.5, 10.5, "L", "chemistry", 0.3),
        ],
        "imaging": ("24558-9", "Abdominal ultrasound", "Karın ultrasonu",
                    "Assess for gallstones as a cause; CT if severe.",
                    "Neden olarak safra taşı değerlendirilir; ağırsa BT.",
                    "pancreatitis ultrasound gallstones", "pankreatit ultrason safra taşı"),
        "treatments": [
            # Review 02 finding 6 (critical): WATERFALL (de-Madaria et al., NEJM 2022,
            # https://www.nejm.org/doi/full/10.1056/NEJMoa2202884) stopped early because
            # aggressive resuscitation caused fluid overload (20.5% vs 6.3%) with no benefit.
            ("moderate_fluids", "Moderate goal-directed IV fluids (10 mL/kg bolus only if hypovolaemic, then 1.5 mL/kg/h lactated Ringer's, reassess at 3 h)", "Ilımlı hedefe yönelik IV sıvı (yalnızca hipovolemikse 10 mL/kg bolus, sonra 1.5 mL/kg/sa laktatlı Ringer, 3. saatte yeniden değerlendir)", "indicated", [("hr", -8.0, 600000), ("systolic", 6.0, 600000)], "Moderate resuscitation per WATERFALL; reassess volume status at 3 hours.", "WATERFALL'a göre ılımlı resüsitasyon; 3. saatte volüm durumunu yeniden değerlendirin."),
            ("aggressive_fluids", "Aggressive IV fluids (20 mL/kg bolus then 3 mL/kg/h)", "Agresif IV sıvı (20 mL/kg bolus, sonra 3 mL/kg/sa)", "contraindicated", [], "Aggressive resuscitation caused fluid overload without benefit in WATERFALL.", "WATERFALL'da agresif resüsitasyon yarar sağlamadan sıvı yüklenmesine yol açtı."),
            ("analgesia_nbm", "Analgesia + NBM", "Analjezi + ağızdan kapalı", "indicated", [("pain", -3.0, 300000)], "Pain control and bowel rest.", "Ağrı kontrolü ve bağırsak istirahati."),
            ("prophylactic_abx", "Routine prophylactic antibiotics", "Rutin profilaktik antibiyotik", "contraindicated", [], "No prophylactic antibiotics in mild pancreatitis.", "Hafif pankreatitte profilaktik antibiyotik yok."),
        ],
    },
    "upper_gi_bleed": {
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 7.6, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
            ("22664-7", "Urea", "Üre", 12.5, "mmol/L", 2.5, 7.1, "H", "chemistry", 0.6),
        ],
        "imaging": ("29893-5", "Upper GI endoscopy", "Üst GİS endoskopisi",
                    "Identify and treat the bleeding source (ulcer / varix).",
                    "Kanama kaynağını (ülser / varis) bulup tedavi edin.",
                    "upper GI bleed endoscopy ulcer", "üst GİS kanama endoskopi ülser"),
        "treatments": [
            ("resus_transfuse", "Resuscitate + transfuse to threshold", "Resüsitasyon + eşiğe göre transfüzyon", "indicated", [("systolic", 10.0, 600000)], "Restrictive transfusion to a Hb target.", "Hb hedefine kısıtlı transfüzyon."),
            ("ppi_endoscopy", "IV PPI + urgent endoscopy", "IV PPİ + acil endoskopi", "indicated", [], "PPI and endoscopy within 24 h.", "24 saat içinde PPİ ve endoskopi."),
            ("discharge_no_scope", "Discharge without endoscopy", "Endoskopi olmadan taburcu", "contraindicated", [], "Do not discharge active GI bleeding.", "Aktif GİS kanamasını taburcu etmeyin."),
        ],
    },
    "cholecystitis": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 14.0, "10^9/L", 4.0, 11.0, "H", "haematology", 1.0),
            ("1988-5", "C-reactive protein", "CRP", 65, "mg/L", 0, 5, "H", "chemistry", 7),
        ],
        "imaging": ("24558-9", "Abdominal ultrasound", "Karın ultrasonu",
                    "Thick-walled gallbladder with stones and a sonographic Murphy.",
                    "Taşlar ve sonografik Murphy ile kalın duvarlı safra kesesi.",
                    "cholecystitis ultrasound gallbladder wall", "kolesistit ultrason safra kesesi duvarı"),
        "treatments": [
            ("abx_analgesia", "IV antibiotics + analgesia + NBM", "IV antibiyotik + analjezi + ağızdan kapalı", "indicated", [("pain", -3.0, 300000)], "Antibiotics and bowel rest.", "Antibiyotik ve bağırsak istirahati."),
            ("cholecystectomy", "Refer for cholecystectomy", "Kolesistektomi için sevk", "indicated", [], "Early laparoscopic cholecystectomy.", "Erken laparoskopik kolesistektomi."),
            ("fatty_diet", "Advise a normal fatty diet", "Normal yağlı diyet öner", "contraindicated", [], "Keep NBM during the acute phase.", "Akut dönemde ağızdan almayın."),
        ],
    },
    # ascending_cholangitis: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    "bowel_obstruction": {
        "labs": [
            ("2524-7", "Lactate", "Laktat", 2.4, "mmol/L", 0.5, 2.0, "H", "blood-gas", 0.3),
            ("2823-3", "Potassium", "Potasyum", 3.3, "mmol/L", 3.5, 5.0, "L", "chemistry", 0.1),
        ],
        "imaging": ("42272-5", "Abdominal CT", "Karın BT",
                    "Dilated bowel loops with a transition point.",
                    "Geçiş noktasıyla genişlemiş bağırsak ansları.",
                    "bowel obstruction CT dilated loops", "bağırsak tıkanıklığı BT genişlemiş ans"),
        "treatments": [
            ("nbm_ngt", "NBM + nasogastric decompression", "Ağızdan kapalı + nazogastrik dekompresyon", "indicated", [], "'Drip and suck' with NG tube and fluids.", "NG tüp ve sıvı ile dekompresyon."),
            ("iv_fluids", "IV fluid + electrolyte correction", "IV sıvı + elektrolit düzeltme", "indicated", [("hr", -8.0, 600000)], "Correct dehydration and electrolytes.", "Dehidratasyon ve elektroliti düzeltin."),
            ("oral_laxatives", "Oral laxatives / feeding", "Oral laksatif / beslenme", "contraindicated", [], "Avoid oral intake in obstruction.", "Tıkanıklıkta ağızdan almaktan kaçının."),
        ],
    },

    # ===================== ENDOCRINE / METABOLIC =========================== #
    "dka": {
        "labs": [
            ("2345-7", "Plasma glucose", "Plazma glukozu", 24.0, "mmol/L", 4.0, 7.8, "HH", "chemistry", 2.0),
            ("1963-8", "Bicarbonate", "Bikarbonat", 10, "mmol/L", 22, 28, "L", "blood-gas", 1),
            ("2823-3", "Potassium", "Potasyum", 5.3, "mmol/L", 3.5, 5.0, "H", "chemistry", 0.2),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Watch for potassium-related changes during treatment.",
                    "Tedavi sırasında potasyuma bağlı değişikliklere dikkat.",
                    "DKA ECG potassium changes", "DKA EKG potasyum değişiklikleri"),
        "treatments": [
            ("fluids_first", "IV fluids first", "Önce IV sıvı", "indicated", [("hr", -8.0, 600000)], "Fluid resuscitation before insulin.", "İnsülinden önce sıvı resüsitasyonu."),
            ("fixed_insulin", "Fixed-rate insulin infusion + K replacement", "Sabit hızlı insülin infüzyonu + K replasmanı", "indicated", [], "Insulin with potassium monitoring.", "Potasyum izlemiyle insülin."),
            ("insulin_bolus_first", "IV insulin bolus before fluids", "Sıvı öncesi IV insülin bolusu", "contraindicated", [], "Do not bolus insulin before fluids/potassium.", "Sıvı/potasyum öncesi insülin bolusu vermeyin."),
            # Review 02 finding 31: potassium gate. ADA/EASD 2024 hyperglycaemic crises
            # https://doi.org/10.2337/dci24-0032
            ("insulin_low_k", "Start insulin with K below 3.3 mmol/L", "K 3.3 mmol/L altındayken insülin başlama", "contraindicated", [], "Hold insulin until potassium is replaced above 3.3 mmol/L.", "Potasyum 3.3 mmol/L üzerine çıkarılana kadar insülini bekletin."),
        ],
    },
    "hhs": {
        "labs": [
            ("2345-7", "Plasma glucose", "Plazma glukozu", 42.0, "mmol/L", 4.0, 7.8, "HH", "chemistry", 3.0),
            ("2947-0", "Sodium", "Sodyum", 150, "mmol/L", 135, 145, "H", "chemistry", 2),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Baseline ECG; HHS carries a high thrombotic risk.",
                    "Bazal EKG; HHS yüksek trombotik risk taşır.",
                    "HHS ECG baseline", "HHS EKG bazal"),
        "treatments": [
            ("cautious_fluids", "Cautious IV fluid replacement", "Dikkatli IV sıvı replasmanı", "indicated", [("hr", -8.0, 600000)], "Gradual fluid replacement in HHS.", "HHS'de kademeli sıvı replasmanı."),
            ("low_rate_insulin", "Low-rate insulin after fluids", "Sıvı sonrası düşük hızlı insülin", "indicated", [], "Insulin only once fluids are running.", "İnsülin ancak sıvı akarken."),
            ("rapid_osmo_drop", "Rapid osmolality correction", "Hızlı ozmolarite düşürme", "contraindicated", [], "Over-rapid correction risks cerebral oedema.", "Aşırı hızlı düzeltme serebral ödem riski taşır."),
        ],
    },
    "hyperkalemia": {
        "labs": [
            ("2823-3", "Potassium", "Potasyum", 7.0, "mmol/L", 3.5, 5.0, "HH", "chemistry", 0.2),
            ("2160-0", "Creatinine", "Kreatinin", 2.8, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.2),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Peaked T waves, broadening QRS.",
                    "Sivri T dalgaları, genişleyen QRS.",
                    "hyperkalemia ECG peaked T waves", "hiperkalemi EKG sivri T dalgası"),
        "treatments": [
            ("calcium", "IV calcium gluconate", "IV kalsiyum glukonat", "indicated", [], "Calcium stabilises the myocardium.", "Kalsiyum miyokardı stabilize eder."),
            ("insulin_dextrose", "Insulin-dextrose + salbutamol", "İnsülin-dekstroz + salbutamol", "indicated", [], "Shift potassium intracellularly.", "Potasyumu hücre içine kaydırın."),
            # Review 02 finding 43: UK Kidney Association 2023 — definitive removal
            # and a 1 h recheck. https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults
            ("dialysis_referral", "Urgent dialysis / nephrology for ESRD or refractory hyperkalaemia", "SDBH veya dirençli hiperkalemide acil diyaliz / nefroloji", "indicated", [], "Shift therapies buy time; remove potassium definitively.", "Kaydırma tedavileri zaman kazandırır; potasyumu kesin olarak uzaklaştırın."),
            ("recheck_1h", "Repeat ECG and potassium at 1 hour", "1. saatte EKG ve potasyum tekrarı", "indicated", [], "Recheck potassium and ECG after treatment.", "Tedavi sonrası potasyum ve EKG'yi tekrar kontrol edin."),
            ("k_fluids", "Potassium-containing IV fluids", "Potasyum içeren IV sıvı", "contraindicated", [], "Avoid potassium-containing fluids.", "Potasyum içeren sıvılardan kaçının."),
        ],
    },
    "thyroid_storm": {
        "labs": [
            ("3016-3", "TSH", "TSH", 0.01, "mIU/L", 0.4, 4.0, "LL", "endocrine", 0.005),
            ("3024-7", "Free T4", "Serbest T4", 4.8, "ng/dL", 0.9, 1.7, "HH", "endocrine", 0.3),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Sinus tachycardia or atrial fibrillation.",
                    "Sinüs taşikardisi veya atriyal fibrilasyon.",
                    "thyroid storm ECG tachyarrhythmia", "tiroid fırtınası EKG taşiaritmi"),
        "treatments": [
            # Review 02 finding 42: ATA 2016 https://doi.org/10.1089/thy.2016.0229 —
            # propranolol is relatively contraindicated with decompensated heart
            # failure or bronchospasm; esmolol or cautious monitored dosing there.
            ("beta_blocker", "Beta-blocker with cardiac monitoring (propranolol; esmolol if heart failure or bronchospasm)", "Kardiyak monitörle beta-bloker (propranolol; kalp yetmezliği veya bronkospazmda esmolol)", "indicated", [("hr", -25.0, 600000)], "Control adrenergic symptoms; use esmolol or cautious dosing in decompensated heart failure or bronchospasm.", "Adrenerjik semptomları kontrol edin; dekompanse kalp yetmezliği veya bronkospazmda esmolol veya dikkatli doz."),
            ("unmonitored_bb_hf", "Unmonitored full-dose beta-blockade in decompensated heart failure", "Dekompanse kalp yetmezliğinde monitörsüz tam doz beta-blokaj", "contraindicated", [], "Beta-blockade can precipitate cardiovascular collapse in thyrotoxic heart failure.", "Beta-blokaj tirotoksik kalp yetmezliğinde kardiyovasküler kollapsa yol açabilir."),
            ("antithyroid_then_iodine", "Antithyroid drug, then iodine", "Antitiroid ilaç, sonra iyot", "indicated", [], "Give antithyroid drug before iodine.", "İyottan önce antitiroid ilaç verin."),
            ("iodine_first", "Iodine before antithyroid drug", "Antitiroidden önce iyot", "contraindicated", [], "Iodine first can worsen the storm.", "Önce iyot fırtınayı kötüleştirebilir."),
        ],
    },
    "hypoglycemia": {
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 2.1, "mmol/L", 4.0, 7.8, "LL", "chemistry", 0.2),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Rule out an arrhythmic cause of collapse.",
                    "Kollapsın aritmik nedenini dışlayın.",
                    "hypoglycemia ECG arrhythmia screen", "hipoglisemi EKG aritmi taraması"),
        "treatments": [
            ("glucose", "Oral or IV glucose", "Oral veya IV glukoz", "indicated", [], "Correct glucose immediately.", "Glukozu hemen düzeltin."),
            ("recheck", "Recheck glucose + find cause", "Glukozu tekrar ölç + nedeni bul", "indicated", [], "Recheck and treat the cause.", "Tekrar ölçün ve nedeni tedavi edin."),
            ("insulin", "Give insulin", "İnsülin ver", "contraindicated", [], "Never give insulin in hypoglycaemia.", "Hipoglisemide asla insülin vermeyin."),
        ],
    },
    "adrenal_crisis": {
        "labs": [
            ("2947-0", "Sodium", "Sodyum", 128, "mmol/L", 135, 145, "L", "chemistry", 2),
            ("2823-3", "Potassium", "Potasyum", 5.6, "mmol/L", 3.5, 5.0, "H", "chemistry", 0.2),
        ],
        "imaging": ("11524-6", "12-lead ECG", "12 derivasyonlu EKG",
                    "Screen for hyperkalaemic changes.",
                    "Hiperkalemik değişiklikleri tarayın.",
                    "adrenal crisis ECG hyperkalemia", "adrenal kriz EKG hiperkalemi"),
        "treatments": [
            ("hydrocortisone", "IV hydrocortisone", "IV hidrokortizon", "indicated", [("systolic", 10.0, 600000)], "Immediate steroid replacement.", "Hemen steroid replasmanı."),
            ("fluids_dextrose", "IV fluids + dextrose", "IV sıvı + dekstroz", "indicated", [("hr", -8.0, 600000)], "Resuscitate and correct glucose.", "Resüsite edin ve glukozu düzeltin."),
            ("delay_steroid", "Delay steroids pending tests", "Testler için steroidi ertele", "contraindicated", [], "Do not delay steroids for confirmation.", "Doğrulama için steroidi geciktirmeyin."),
        ],
    },

    # ===================== INFECTIOUS ====================================== #
    "nec_fasciitis": {
        "labs": [
            ("1988-5", "C-reactive protein", "CRP", 260, "mg/L", 0, 5, "HH", "chemistry", 20),
            # Review 02 finding 22: 2532-0 is LDH (discouraged); CK is 2157-6 https://loinc.org/2157-6
            ("2157-6", "Creatine kinase", "Kreatin kinaz", 900, "U/L", 30, 200, "H", "chemistry", 80),
        ],
        "imaging": ("36643-5", "Imaging must not delay surgery", "Görüntüleme cerrahiyi geciktirmemeli",
                    "Soft-tissue gas may be seen but must not delay debridement.",
                    "Yumuşak dokuda gaz görülebilir ama debridmanı geciktirmemeli.",
                    "necrotising fasciitis soft tissue gas", "nekrotizan fasiit yumuşak doku gazı"),
        "treatments": [
            ("surgical_debridement", "Urgent surgical debridement", "Acil cerrahi debridman", "indicated", [], "Source control by early debridement.", "Erken debridmanla kaynak kontrolü."),
            ("broad_abx", "Broad-spectrum antibiotics + clindamycin", "Geniş spektrumlu antibiyotik + klindamisin", "indicated", [], "Add clindamycin for toxin suppression.", "Toksin baskılaması için klindamisin ekleyin."),
            ("watchful_waiting", "Watchful waiting", "İzlemle bekleme", "contraindicated", [], "Delay is fatal; operate early.", "Gecikme öldürücüdür; erken opere edin."),
        ],
    },
    # pyelonephritis: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    "meningococcemia": {
        "labs": [
            ("2524-7", "Lactate", "Laktat", 4.2, "mmol/L", 0.5, 2.0, "HH", "blood-gas", 0.4),
            ("777-3", "Platelets", "Trombosit", 80, "10^9/L", 150, 400, "L", "haematology", 8),
        ],
        "imaging": ("36643-5", "No imaging should delay antibiotics", "Görüntüleme antibiyotiği geciktirmemeli",
                    "Clinical diagnosis; do not delay treatment for tests.",
                    "Klinik tanı; tedaviyi testler için geciktirmeyin.",
                    "meningococcaemia purpuric rash", "meningokoksemi purpurik döküntü"),
        "treatments": [
            ("immediate_ceftriaxone", "Immediate IV ceftriaxone", "Hemen IV seftriakson", "indicated", [], "Antibiotics at first suspicion.", "İlk şüphede antibiyotik."),
            ("fluid_resus", "Aggressive fluid resuscitation", "Agresif sıvı resüsitasyonu", "indicated", [("systolic", 12.0, 600000)], "Treat shock aggressively.", "Şoku agresif tedavi edin."),
            ("lp_before_abx", "LP before antibiotics in shock", "Şokta antibiyotik öncesi LP", "contraindicated", [], "Do not delay antibiotics for LP in shock.", "Şokta LP için antibiyotiği geciktirmeyin."),
        ],
    },

    # ===================== RENAL / GU ====================================== #
    "aki": {
        "labs": [
            ("2160-0", "Creatinine", "Kreatinin", 3.4, "mg/dL", 0.6, 1.3, "HH", "chemistry", 0.2),
            ("2823-3", "Potassium", "Potasyum", 5.9, "mmol/L", 3.5, 5.0, "H", "chemistry", 0.2),
        ],
        "imaging": ("24558-9", "Renal tract ultrasound", "Üriner sistem ultrasonu",
                    "Look for obstruction / hydronephrosis.",
                    "Obstrüksiyon / hidronefroz aranır.",
                    "acute kidney injury ultrasound hydronephrosis", "akut böbrek hasarı ultrason hidronefroz"),
        "treatments": [
            ("treat_cause_stop_nephrotoxins", "Treat cause + stop nephrotoxins", "Nedeni tedavi et + nefrotoksikleri kes", "indicated", [], "Address the cause and stop nephrotoxins.", "Nedeni giderin ve nefrotoksikleri kesin."),
            ("fluids_or_relieve", "Fluids if pre-renal / relieve obstruction", "Prerenalse sıvı / obstrüksiyonu gider", "indicated", [("systolic", 6.0, 600000)], "Optimise volume or relieve obstruction.", "Hacmi düzeltin veya obstrüksiyonu giderin."),
            ("continue_nephrotoxins", "Continue nephrotoxic drugs", "Nefrotoksik ilaçlara devam", "contraindicated", [], "Stop nephrotoxins in AKI.", "ABH'de nefrotoksikleri kesin."),
        ],
    },
    "renal_colic": {
        "labs": [
            ("5794-3", "Urine blood", "İdrar kanı", "positive", "", None, None, "H", "urinalysis"),
            ("2160-0", "Creatinine", "Kreatinin", 1.2, "mg/dL", 0.6, 1.3, "N", "chemistry", 0.1),
        ],
        "imaging": ("42274-1", "Non-contrast CT KUB", "Kontrastsız BT KUB",
                    "Ureteric calculus with proximal dilatation.",
                    "Proksimal dilatasyonla üreter taşı.",
                    "renal colic CT KUB ureteric stone", "renal kolik BT KUB üreter taşı"),
        "treatments": [
            ("nsaid", "NSAID analgesia", "NSAİİ analjezi", "indicated", [("pain", -3.0, 300000)], "NSAID is first-line analgesia.", "NSAİİ birinci basamak analjezidir."),
            ("alpha_blocker", "Alpha-blocker for distal stones", "Distal taşlar için alfa-bloker", "indicated", [], "Medical expulsive therapy for distal stones.", "Distal taşlarda medikal ekspulsif tedavi."),
            ("ignore_fever", "Ignore fever with the stone", "Taşla birlikte ateşi görmezden gel", "contraindicated", [], "Fever + obstruction is a urological emergency.", "Ateş + obstrüksiyon ürolojik acildir."),
        ],
    },

    # ===================== PSYCHIATRY / TOX ================================ #
    "alcohol_withdrawal": {
        "labs": [
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 4.6, "mmol/L", 4.0, 7.8, "N", "chemistry", 0.3),
            ("19123-9", "Magnesium", "Magnezyum", 1.5, "mg/dL", 1.7, 2.4, "L", "chemistry", 0.1),
        ],
        "imaging": ("11524-6", "12-lead ECG (baseline)", "12 derivasyonlu EKG (bazal)",
                    "Baseline ECG; screen for electrolyte effects.",
                    "Bazal EKG; elektrolit etkilerini tarayın.",
                    "alcohol withdrawal ECG baseline", "alkol yoksunluğu EKG bazal"),
        "treatments": [
            ("benzodiazepine", "Benzodiazepine (symptom-triggered)", "Benzodiazepin (semptom tetiklemeli)", "indicated", [], "Benzodiazepines control withdrawal.", "Benzodiazepinler yoksunluğu kontrol eder."),
            # Review 02 finding 11 (critical): "glucose before thiamine precipitates
            # Wernicke's" has no controlled evidence; the real hazard is delaying
            # glucose in hypoglycaemia. Schabelman & Kuo, J Emerg Med 2012
            # https://doi.org/10.1016/j.jemermed.2011.05.076
            ("thiamine_early", "High-dose IV thiamine as soon as practical (before or with glucose)", "Mümkün olan en kısa sürede yüksek doz IV tiamin (glukozdan önce veya birlikte)", "indicated", [], "Give thiamine early; never use it as a reason to delay glucose.", "Tiamini erken verin; glukozu geciktirmek için gerekçe yapmayın."),
            ("withhold_glucose_for_thiamine", "Withhold glucose in hypoglycaemia until thiamine is given", "Hipoglisemide tiamin verilene kadar glukozu bekletme", "contraindicated", [], "Treat hypoglycaemia immediately; thiamine sequencing must not delay glucose.", "Hipoglisemiyi hemen tedavi edin; tiamin sıralaması glukozu geciktirmemeli."),
        ],
    },
    "opioid_overdose": {
        "labs": [
            ("2019-8", "Arterial pCO2", "Arteriyel pCO2", 58, "mmHg", 35, 45, "H", "blood-gas", 4),
            ("2345-7", "Capillary glucose", "Kapiller glukoz", 5.0, "mmol/L", 4.0, 7.8, "N", "chemistry", 0.3),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Screen for aspiration after reduced consciousness.",
                    "Bilinç azalması sonrası aspirasyon taraması.",
                    "opioid overdose chest x-ray aspiration", "opioid aşırı doz akciğer grafisi aspirasyon"),
        "treatments": [
            ("naloxone_titrated", "Titrated IV naloxone", "Titre edilmiş IV nalokson", "indicated", [("rr", 6.0, 120000), ("spo2", 6.0, 120000)], "Titrate naloxone to restore breathing.", "Solunumu geri getirmek için naloksonu titre edin."),
            ("airway_support", "Airway + ventilation support", "Hava yolu + ventilasyon desteği", "indicated", [("spo2", 5.0, 120000)], "Support ventilation until reversal.", "Geri dönüşe kadar ventilasyonu destekleyin."),
            ("large_bolus", "Large naloxone bolus in dependence", "Bağımlıda büyük nalokson bolusu", "contraindicated", [], "A large bolus precipitates severe withdrawal.", "Büyük bolus şiddetli yoksunluk yaratır."),
        ],
    },
    "paracetamol_od": {
        "labs": [
            # Review 02 finding 38: the nomogram needs time since ingestion; 11th tuple
            # slot = hours_post_ingestion (4 h: compare with the 150 mg/L US / 100 mg/L
            # UK treatment line). MHRA guidance
            # https://www.gov.uk/government/publications/paracetamol-overdose-new-guidance-on-treatment-with-intravenous-acetylcysteine
            ("3298-4", "Paracetamol level (4 h post-ingestion)", "Parasetamol düzeyi (alımdan 4 saat sonra)", 180, "mg/L", 0, 10, "H", "toxicology", 15, 4.0),
            ("6301-6", "INR", "INR", 1.4, "", 0.8, 1.2, "H", "coagulation", 0.1),
        ],
        "imaging": ("11524-6", "No imaging required (biochemical)", "Görüntüleme gerekmez (biyokimyasal)",
                    "Management is biochemical, guided by the timed level.",
                    "Yönetim biyokimyasaldır, zamanlı düzeyle yönlendirilir.",
                    "paracetamol overdose nomogram treatment line", "parasetamol aşırı doz nomogram"),
        "treatments": [
            ("nac", "N-acetylcysteine per nomogram", "Nomograma göre N-asetilsistein", "indicated", [], "NAC when the timed level is above the line.", "Zamanlı düzey çizginin üstündeyse NAC."),
            ("timed_level", "Take a timed paracetamol level", "Zamanlı parasetamol düzeyi al", "indicated", [], "Level at 4 h or on presentation if late.", "4. saatte veya geç ise başvuruda düzey."),
            ("await_symptoms", "Wait for symptoms before treating", "Tedaviden önce semptom bekle", "contraindicated", [], "Treat by level/timing, not symptoms.", "Semptoma göre değil, düzey/zamana göre tedavi edin."),
        ],
    },

    # ===================== OBGYN =========================================== #
    "ectopic_pregnancy": {
        "labs": [
            ("2118-8", "Serum beta-hCG", "Serum beta-hCG", 1650, "IU/L", 0, 5, "H", "chemistry", 120),
            ("718-7", "Haemoglobin", "Hemoglobin", 10.4, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
        ],
        "imaging": ("24558-9", "Transvaginal ultrasound", "Transvajinal ultrason",
                    "Empty uterus with an adnexal mass.",
                    "Adneksiyal kitleyle boş uterus.",
                    "ectopic pregnancy ultrasound adnexal mass", "ektopik gebelik ultrason adneksiyal kitle"),
        "treatments": [
            ("preg_test", "Urgent pregnancy test", "Acil gebelik testi", "indicated", [], "A positive test with pain flags ectopic.", "Ağrıyla pozitif test ektopik işaretidir."),
            ("iv_group_save", "Large-bore IV + group and save", "Geniş IV + kan grubu/crossmatch", "indicated", [("systolic", 6.0, 600000)], "Prepare for possible haemorrhage.", "Olası kanamaya hazırlanın."),
            ("discharge_no_test", "Discharge without pregnancy test", "Gebelik testi olmadan taburcu", "contraindicated", [], "Never discharge pelvic pain untested.", "Pelvik ağrıyı testsiz taburcu etmeyin."),
        ],
    },
    "preeclampsia": {
        "labs": [
            ("5804-0", "Urine protein (dipstick)", "İdrar proteini (strip)", "3+", "", None, None, "H", "urinalysis"),
            ("777-3", "Platelets", "Trombosit", 90, "10^9/L", 150, 400, "L", "haematology", 8),
        ],
        "imaging": ("11524-6", "Maternal + fetal monitoring", "Maternal + fetal monitörizasyon",
                    "Monitor blood pressure and fetal wellbeing.",
                    "Tansiyon ve fetal iyilik hali izlenir.",
                    "preeclampsia maternal fetal monitoring", "preeklampsi maternal fetal izlem"),
        "treatments": [
            ("antihypertensive", "Antihypertensive (labetalol)", "Antihipertansif (labetalol)", "indicated", [("systolic", -20.0, 600000)], "Control severe hypertension.", "Ağır hipertansiyonu kontrol edin."),
            ("magnesium", "Magnesium sulfate for seizure prophylaxis", "Nöbet profilaksisi için magnezyum sülfat", "indicated", [], "Magnesium prevents/treats eclamptic seizures.", "Magnezyum eklamptik nöbeti önler/tedavi eder."),
            ("ergometrine", "Ergometrine", "Ergometrin", "contraindicated", [], "Ergometrine raises blood pressure.", "Ergometrin tansiyonu yükseltir."),
        ],
    },
    "pph": {
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 7.2, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
            ("3255-7", "Fibrinogen", "Fibrinojen", 140, "mg/dL", 200, 400, "L", "coagulation", 15),  # review 02 finding 22: one unit project-wide (client coag panel is mg/dL)
        ],
        "imaging": ("11524-6", "No imaging — act on the '4 Ts'", "Görüntüleme yok — '4T'ye göre hareket",
                    "Identify tone/trauma/tissue/thrombin as the cause.",
                    "Nedeni tonus/travma/doku/trombin olarak belirleyin.",
                    "postpartum haemorrhage four Ts", "doğum sonu kanama dört T"),
        "treatments": [
            ("uterotonics", "Uterine massage + uterotonics", "Uterin masaj + uterotonikler", "indicated", [], "Oxytocin and massage for atony.", "Atoni için oksitosin ve masaj."),
            ("tranexamic_acid", "Tranexamic acid", "Traneksamik asit", "indicated", [], "Give tranexamic acid early.", "Traneksamik asidi erken verin."),
            ("resus_transfuse", "Resuscitate + transfuse", "Resüsitasyon + transfüzyon", "indicated", [("systolic", 12.0, 600000)], "Major haemorrhage protocol.", "Masif kanama protokolü."),
            # WHO 2023 PPH recommendations (treat on clinical estimate of loss)
            # https://www.who.int/publications/i/item/9789240085398
            ("wait_for_hb", "Wait for the laboratory haemoglobin before resuscitating", "Resüsitasyon için laboratuvar hemoglobinini bekle", "contraindicated", [], "Resuscitate on the clinical estimate of blood loss; a first Hb lags behind the bleed.", "Kan kaybının klinik tahminine göre resüsite edin; ilk Hb kanamanın gerisinde kalır."),
        ],
    },

    # ===================== MSK / HEME ====================================== #
    "cauda_equina": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 8.0, "10^9/L", 4.0, 11.0, "N", "haematology", 0.6),
        ],
        "imaging": ("24725-4", "Urgent MRI whole spine", "Acil tüm omurga MR",
                    "Compression of the cauda equina.",
                    "Kauda ekina basısı.",
                    "cauda equina MRI compression", "kauda ekina MR bası"),
        "treatments": [
            ("urgent_mri", "Emergency MRI", "Acil MR", "indicated", [], "Image immediately when suspected.", "Şüphelenildiğinde hemen görüntüleyin."),
            ("surgical_decompression", "Emergency surgical decompression", "Acil cerrahi dekompresyon", "indicated", [], "Decompress urgently to save function.", "İşlevi korumak için acil dekompresyon."),
            ("safety_net_discharge", "Discharge with safety-net advice", "Güvenlik ağı önerisiyle taburcu", "contraindicated", [], "Do not discharge suspected cauda equina.", "Şüpheli kauda ekinayı taburcu etmeyin."),
        ],
    },
    "compartment_syndrome": {
        "labs": [
            ("2157-6", "Creatine kinase", "Kreatin kinaz", 1500, "U/L", 30, 200, "HH", "chemistry", 150),
        ],
        "imaging": ("43468-8", "Compartment pressure (clinical)", "Kompartman basıncı (klinik)",
                    "Clinical diagnosis; pain on passive stretch is key.",
                    "Klinik tanı; pasif germede ağrı esastır.",
                    "compartment syndrome passive stretch pain", "kompartman sendromu pasif germe ağrısı"),
        "treatments": [
            ("release_dressings", "Remove casts/dressings + elevate to heart level", "Alçı/pansumanı çıkar + kalp seviyesine kaldır", "indicated", [], "Split casts and elevate to heart level only.", "Alçıyı açın ve yalnızca kalp seviyesine kaldırın."),
            ("fasciotomy", "Urgent fasciotomy", "Acil fasyotomi", "indicated", [("pain", -2.0, 600000)], "Fasciotomy is the definitive treatment.", "Fasyotomi kesin tedavidir."),
            ("elevate_above_heart", "Elevate limb above the heart", "Uzvu kalbin üzerine kaldır", "contraindicated", [], "Over-elevation reduces perfusion.", "Aşırı yükseltme perfüzyonu azaltır."),
        ],
    },
    # febrile_neutropenia: superseded by FEBRILE_FIXTURES below (acceptance 2026-10-20, D-18).
    "dvt": {
        "labs": [
            ("48065-7", "D-dimer", "D-dimer", 1400, "ng/mL", 0, 500, "H", "coagulation", 120),
        ],
        "imaging": ("39150-9", "Leg vein Doppler ultrasound", "Bacak ven Doppler ultrasonu",
                    "Non-compressible deep vein with thrombus.",
                    "Trombüsle sıkışmayan derin ven.",
                    "deep vein thrombosis Doppler ultrasound", "derin ven trombozu Doppler ultrason"),
        "treatments": [
            ("anticoag", "Therapeutic anticoagulation", "Terapötik antikoagülasyon", "indicated", [], "Anticoagulate confirmed DVT.", "Doğrulanmış DVT'de antikoagülasyon."),
            ("assess_pe", "Assess for coexisting PE", "Eşlik eden PE değerlendirmesi", "indicated", [], "Screen for pulmonary embolism symptoms.", "Pulmoner emboli belirtilerini tarayın."),
            ("immobilise_ignore", "Immobilise and observe only", "Sadece immobilize et ve izle", "contraindicated", [], "Untreated DVT can embolise.", "Tedavisiz DVT emboliye yol açabilir."),
        ],
    },
    "sickle_crisis": {
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 6.9, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
            ("14804-9", "Lactate dehydrogenase", "Laktat dehidrogenaz", 480, "U/L", 120, 250, "H", "chemistry", 40),  # review 02 finding 22: https://loinc.org/14804-9
        ],
        "imaging": ("36643-5", "Chest X-ray (if chest symptoms)", "Göğüs semptomu varsa akciğer grafisi",
                    "Screen for acute chest syndrome.",
                    "Akut göğüs sendromu taranır.",
                    "sickle cell acute chest syndrome x-ray", "orak hücre akut göğüs sendromu grafi"),
        "treatments": [
            ("analgesia", "Prompt opioid analgesia", "Hızlı opioid analjezi", "indicated", [("pain", -4.0, 300000)], "Treat crisis pain without delay.", "Kriz ağrısını gecikmeden tedavi edin."),
            # Review 02 finding 32: NICE CG143 — oxygen only when SpO2 <= 95%; avoid
            # over-hydration (acute chest syndrome risk).
            # https://www.nice.org.uk/guidance/cg143/chapter/Recommendations
            ("fluids_oxygen", "Oxygen if SpO2 at or below 95%; maintain euvolaemia (avoid over-hydration)", "SpO2 %95 veya altındaysa oksijen; övolemiyi koru (aşırı hidrasyondan kaçın)", "indicated", [("spo2", 2.0, 300000)], "Oxygen only for hypoxia; euvolaemia, not aggressive fluids.", "Yalnızca hipokside oksijen; agresif sıvı değil, övolemi."),
            ("withhold_analgesia", "Withhold opioids for observation", "Gözlem için opioidi geciktir", "contraindicated", [], "Do not withhold analgesia in crisis.", "Krizde analjeziyi geciktirmeyin."),
        ],
    },
}


# --------------------------------------------------------------------------- #
# Per-condition triage-vitals envelopes + trajectory drift.                     #
#                                                                              #
# Review 02 (docs/review/02-clinical-content-review-2026-10.md) finding 1      #
# (critical): vitals were drawn from ESI-only bands, so complete heart block   #
# presented with HR 98-128 and hypertensive emergency with SBP 100-160. Each   #
# entry here gives the direction AND band per vital; keys absent from an entry #
# inherit the ESI band in ``case_generator._ACUITY_BANDS``. ``drift`` is the   #
# signed 30-minute untreated change per vital (finding 30: a tension           #
# pneumothorax, an anaphylaxis and a GI bleed must not deteriorate             #
# identically; a septic patient's temperature must move).                      #
#                                                                              #
# Thresholds: ACC/AHA 2017 hypertension guideline (hypertensive emergency      #
# >180/120 with target-organ damage) https://doi.org/10.1161/HYP.0000000000000065 #
# AHA 2020 ACLS bradycardia algorithm (HR <50 with symptoms)                    #
# https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916 ; ESI handbook  #
# danger-zone vitals https://www.ena.org/enau/education/esi ; AAP bronchiolitis #
# (infant vitals) https://doi.org/10.1542/peds.2014-2742                        #
# --------------------------------------------------------------------------- #
CONDITION_VITALS: dict[str, dict[str, Any]] = {
    # --- bradyarrhythmia / conduction ------------------------------------ #
    "complete_heart_block": {"hr": (28, 44), "systolic": (82, 108), "diastolic": (48, 66), "rr": (16, 22), "spo2": (93, 97), "tempC": (36.2, 37.0), "drift": {"hr": -4, "systolic": -10}},
    "hyperkalemia": {"hr": (44, 62), "systolic": (100, 132), "diastolic": (58, 80), "rr": (16, 24), "spo2": (93, 97), "tempC": (36.2, 37.0), "drift": {"hr": -5, "systolic": -6}},
    "hyperkalemia_esrd": {"hr": (44, 62), "systolic": (102, 138), "diastolic": (60, 84), "rr": (18, 26), "spo2": (91, 96), "tempC": (36.2, 37.0), "drift": {"hr": -5, "spo2": -2}},
    "organophosphate_poisoning": {"hr": (42, 60), "systolic": (84, 108), "diastolic": (48, 66), "rr": (24, 34), "spo2": (84, 92), "tempC": (36.2, 37.0), "drift": {"spo2": -6, "hr": -4}},
    "anorexia_nervosa": {"hr": (36, 50), "systolic": (80, 98), "diastolic": (46, 60), "rr": (12, 16), "spo2": (97, 100), "tempC": (35.0, 36.0), "drift": {}},
    # --- hypertensive ---------------------------------------------------- #
    "hypertensive_emergency": {"hr": (84, 104), "systolic": (196, 236), "diastolic": (122, 140), "rr": (16, 22), "spo2": (94, 98), "tempC": (36.4, 37.2), "drift": {"systolic": 10, "diastolic": 6}},
    "pheochromocytoma": {"hr": (112, 142), "systolic": (192, 240), "diastolic": (110, 134), "rr": (18, 24), "spo2": (95, 99), "tempC": (36.8, 37.6), "drift": {"systolic": 8, "hr": 6}},
    "preeclampsia": {"hr": (80, 100), "systolic": (162, 186), "diastolic": (104, 118), "rr": (16, 22), "spo2": (95, 99), "tempC": (36.5, 37.2), "drift": {"systolic": 8, "diastolic": 4}},
    "eclampsia": {"hr": (96, 120), "systolic": (166, 196), "diastolic": (108, 124), "rr": (18, 26), "spo2": (90, 96), "tempC": (36.6, 37.4), "drift": {"systolic": 6, "spo2": -3}},
    "subarachnoid_hemorrhage": {"hr": (60, 84), "systolic": (158, 196), "diastolic": (90, 110), "rr": (14, 20), "spo2": (95, 99), "tempC": (36.6, 37.4), "drift": {"systolic": 8, "hr": -4}},
    "intracerebral_hemorrhage": {"hr": (58, 82), "systolic": (176, 216), "diastolic": (96, 118), "rr": (12, 20), "spo2": (94, 98), "tempC": (36.6, 37.4), "drift": {"systolic": 8, "hr": -4, "rr": -2}},
    "ischemic_stroke": {"hr": (72, 96), "systolic": (152, 190), "diastolic": (86, 104), "rr": (14, 20), "spo2": (95, 99), "tempC": (36.5, 37.3), "drift": {"systolic": 4}},
    "aortic_dissection": {"hr": (92, 114), "systolic": (164, 204), "diastolic": (92, 114), "rr": (18, 26), "spo2": (94, 98), "tempC": (36.4, 37.2), "drift": {"hr": 6}},
    "heart_failure_acute": {"hr": (100, 124), "systolic": (146, 186), "diastolic": (86, 106), "rr": (26, 34), "spo2": (84, 91), "tempC": (36.4, 37.2), "drift": {"spo2": -3, "rr": 3, "hr": 4}},
    # --- hypothermia / hyperthermia ------------------------------------- #
    "hypothermia": {"hr": (38, 56), "systolic": (84, 108), "diastolic": (50, 68), "rr": (8, 14), "spo2": (90, 96), "tempC": (28.5, 31.8), "drift": {"hr": -4, "tempC": -0.4}},
    "myxedema_coma": {"hr": (40, 56), "systolic": (82, 104), "diastolic": (50, 66), "rr": (8, 12), "spo2": (88, 94), "tempC": (32.5, 34.8), "drift": {"hr": -3, "tempC": -0.2, "rr": -1}},
    "heat_stroke": {"hr": (118, 142), "systolic": (86, 112), "diastolic": (50, 70), "rr": (24, 34), "spo2": (92, 97), "tempC": (40.4, 42.0), "drift": {"hr": 8, "systolic": -8, "tempC": 0.3}},
    "thyroid_storm": {"hr": (136, 164), "systolic": (128, 160), "diastolic": (60, 80), "rr": (22, 30), "spo2": (94, 98), "tempC": (39.2, 40.8), "drift": {"hr": 6, "tempC": 0.3}},
    "serotonin_syndrome": {"hr": (116, 140), "systolic": (140, 170), "diastolic": (84, 100), "rr": (20, 28), "spo2": (95, 99), "tempC": (38.8, 40.6), "drift": {"tempC": 0.4, "hr": 6}},
    "nms": {"hr": (110, 134), "systolic": (136, 170), "diastolic": (80, 98), "rr": (20, 26), "spo2": (94, 98), "tempC": (39.0, 40.8), "drift": {"tempC": 0.3, "hr": 4}},
    "anticholinergic_tox": {"hr": (118, 142), "systolic": (130, 158), "diastolic": (76, 92), "rr": (18, 24), "spo2": (95, 99), "tempC": (38.2, 39.6), "drift": {"tempC": 0.2, "hr": 4}},
    "acute_agitation": {"hr": (104, 128), "systolic": (134, 164), "diastolic": (78, 96), "rr": (18, 26), "spo2": (96, 99), "tempC": (37.4, 38.6), "drift": {"tempC": 0.2}},
    # --- respiratory depression / hypoxia -------------------------------- #
    "opioid_overdose": {"hr": (52, 72), "systolic": (92, 118), "diastolic": (56, 76), "rr": (4, 10), "spo2": (74, 88), "tempC": (35.6, 36.6), "drift": {"rr": -2, "spo2": -6}},
    "poisoning_unknown": {"hr": (56, 80), "systolic": (90, 118), "diastolic": (54, 74), "rr": (8, 13), "spo2": (86, 93), "tempC": (35.8, 36.8), "drift": {"rr": -2, "spo2": -4}},
    "tca_overdose": {"hr": (118, 146), "systolic": (74, 96), "diastolic": (42, 60), "rr": (10, 16), "spo2": (90, 95), "tempC": (36.6, 37.6), "drift": {"systolic": -12, "hr": 6}},
    "tension_pneumothorax": {"hr": (118, 140), "systolic": (76, 96), "diastolic": (44, 60), "rr": (30, 40), "spo2": (78, 88), "tempC": (36.4, 37.2), "drift": {"systolic": -12, "spo2": -6, "hr": 8}},
    "asthma_exacerbation": {"hr": (108, 128), "systolic": (118, 142), "diastolic": (70, 88), "rr": (26, 34), "spo2": (89, 93), "tempC": (36.6, 37.4), "drift": {"spo2": -3, "rr": 3}},
    "copd_exacerbation": {"hr": (98, 118), "systolic": (122, 150), "diastolic": (70, 90), "rr": (24, 30), "spo2": (84, 90), "tempC": (36.8, 38.0), "drift": {"spo2": -2, "rr": 2}},
    "pneumonia_cap": {"hr": (96, 118), "systolic": (104, 132), "diastolic": (60, 80), "rr": (22, 28), "spo2": (90, 94), "tempC": (38.4, 39.6), "drift": {"tempC": 0.2, "hr": 4}},
    "pulmonary_embolism": {"hr": (104, 126), "systolic": (104, 130), "diastolic": (64, 82), "rr": (22, 30), "spo2": (88, 93), "tempC": (36.6, 37.4), "drift": {"spo2": -3, "hr": 6, "systolic": -6}},
    "bronchiolitis": {"hr": (150, 176), "systolic": (82, 98), "diastolic": (46, 60), "rr": (54, 70), "spo2": (89, 94), "tempC": (37.8, 38.9), "drift": {"spo2": -3, "rr": 4}},
    "status_epilepticus": {"hr": (116, 140), "systolic": (134, 168), "diastolic": (80, 98), "rr": (22, 30), "spo2": (86, 93), "tempC": (37.4, 38.4), "drift": {"spo2": -4, "tempC": 0.3}},
    # --- shock states ---------------------------------------------------- #
    "anaphylaxis": {"hr": (112, 138), "systolic": (72, 92), "diastolic": (40, 58), "rr": (26, 34), "spo2": (86, 93), "tempC": (36.5, 37.3), "drift": {"systolic": -14, "spo2": -5, "hr": 8}},
    "septic_shock": {"hr": (112, 136), "systolic": (72, 88), "diastolic": (40, 56), "rr": (24, 32), "spo2": (90, 95), "tempC": (38.6, 40.2), "drift": {"systolic": -8, "hr": 6, "tempC": 0.3}},
    "sepsis_uncomplicated": {"hr": (100, 120), "systolic": (100, 124), "diastolic": (58, 76), "rr": (20, 26), "spo2": (93, 97), "tempC": (38.3, 39.6), "drift": {"tempC": 0.3, "hr": 5, "systolic": -6}},
    "meningococcemia": {"hr": (118, 142), "systolic": (76, 94), "diastolic": (42, 58), "rr": (24, 32), "spo2": (91, 96), "tempC": (38.9, 40.3), "drift": {"systolic": -10, "hr": 6, "tempC": 0.2}},
    "cardiac_tamponade": {"hr": (112, 134), "systolic": (78, 94), "diastolic": (58, 72), "rr": (22, 30), "spo2": (91, 96), "tempC": (36.4, 37.2), "drift": {"systolic": -10, "hr": 6}},
    "upper_gi_bleed": {"hr": (108, 130), "systolic": (82, 102), "diastolic": (48, 64), "rr": (20, 26), "spo2": (94, 98), "tempC": (36.2, 37.0), "drift": {"systolic": -14, "hr": 10}},
    "pph": {"hr": (116, 140), "systolic": (76, 96), "diastolic": (42, 60), "rr": (22, 30), "spo2": (94, 98), "tempC": (36.2, 37.0), "drift": {"systolic": -14, "hr": 10}},
    "ectopic_pregnancy": {"hr": (104, 126), "systolic": (86, 108), "diastolic": (50, 68), "rr": (18, 24), "spo2": (96, 99), "tempC": (36.4, 37.2), "drift": {"systolic": -10, "hr": 8}},
    "adrenal_crisis": {"hr": (104, 126), "systolic": (74, 92), "diastolic": (42, 58), "rr": (18, 26), "spo2": (94, 98), "tempC": (36.6, 38.0), "drift": {"systolic": -8, "hr": 4}},
    "major_trauma": {"hr": (112, 140), "systolic": (78, 100), "diastolic": (44, 62), "rr": (22, 32), "spo2": (90, 96), "tempC": (35.8, 36.8), "drift": {"systolic": -12, "hr": 8, "tempC": -0.3}},
    # --- tachyarrhythmia ------------------------------------------------- #
    "afib_rvr": {"hr": (132, 164), "systolic": (96, 128), "diastolic": (58, 80), "rr": (18, 24), "spo2": (93, 97), "tempC": (36.4, 37.2), "drift": {"systolic": -8}},
    "svt": {"hr": (160, 200), "systolic": (98, 126), "diastolic": (60, 80), "rr": (18, 24), "spo2": (95, 99), "tempC": (36.4, 37.2), "drift": {}},
    "vt": {"hr": (150, 190), "systolic": (76, 100), "diastolic": (44, 62), "rr": (22, 30), "spo2": (88, 94), "tempC": (36.4, 37.2), "drift": {"systolic": -12, "spo2": -3}},
    # --- metabolic ------------------------------------------------------- #
    "dka": {"hr": (104, 126), "systolic": (94, 116), "diastolic": (56, 74), "rr": (24, 32), "spo2": (96, 99), "tempC": (36.4, 37.4), "drift": {"hr": 6, "systolic": -6}},
    "hhs": {"hr": (100, 122), "systolic": (90, 112), "diastolic": (54, 72), "rr": (18, 24), "spo2": (95, 98), "tempC": (36.4, 37.6), "drift": {"systolic": -6, "hr": 4}},
    "hypoglycemia": {"hr": (98, 120), "systolic": (118, 148), "diastolic": (70, 90), "rr": (16, 22), "spo2": (96, 99), "tempC": (36.0, 36.8), "drift": {"hr": 4}},
    # --- ischaemic chest pain ------------------------------------------- #
    "acs_stemi": {"hr": (88, 112), "systolic": (118, 160), "diastolic": (70, 96), "rr": (18, 24), "spo2": (93, 97), "tempC": (36.4, 37.2), "drift": {"hr": 6, "systolic": -8}},
    "acs_nstemi": {"hr": (84, 108), "systolic": (124, 164), "diastolic": (74, 98), "rr": (16, 22), "spo2": (94, 98), "tempC": (36.4, 37.2), "drift": {"hr": 4}},
    # --- abdominal / other ----------------------------------------------- #
    "pancreatitis": {"hr": (102, 124), "systolic": (100, 126), "diastolic": (58, 78), "rr": (20, 26), "spo2": (93, 97), "tempC": (37.6, 38.6), "drift": {"hr": 5, "systolic": -6}},
    "appendicitis": {"hr": (86, 104), "systolic": (112, 138), "diastolic": (68, 86), "rr": (16, 20), "spo2": (96, 99), "tempC": (37.6, 38.4), "drift": {"tempC": 0.2}},
    "ascending_cholangitis": {"hr": (104, 124), "systolic": (92, 116), "diastolic": (54, 72), "rr": (20, 26), "spo2": (93, 97), "tempC": (38.6, 39.8), "drift": {"systolic": -8, "tempC": 0.2}},
    "sickle_crisis": {"hr": (96, 116), "systolic": (112, 138), "diastolic": (66, 84), "rr": (18, 24), "spo2": (93, 97), "tempC": (37.2, 38.2), "drift": {}},
    "hip_fracture": {"hr": (84, 102), "systolic": (118, 160), "diastolic": (70, 92), "rr": (16, 20), "spo2": (94, 98), "tempC": (36.3, 37.0), "drift": {}},
    "panic_disorder": {"hr": (100, 122), "systolic": (122, 146), "diastolic": (74, 90), "rr": (20, 26), "spo2": (98, 100), "tempC": (36.5, 37.0), "drift": {"hr": -12, "rr": -4}},
}


# --------------------------------------------------------------------------- #
# Febrile presentations without a full vitals envelope.                        #
#                                                                              #
# Acceptance test 2026-10-20 (docs/review/05): conditions whose typical        #
# complaint is fever but which have no CONDITION_VITALS row drew temperature   #
# from the ESI band (36.3-38.3 C at ESI 3), so osteomyelitis, septic arthritis #
# and diverticulitis cases arrived at 36.6 C, identical to an afebrile case    #
# with the same seed. Fever is a temperature of 38.0 C or more (NICE NG143,    #
# NICE NG51 sepsis risk stratification uses 38 C as the threshold); the bands  #
# below put every one of these presentations at or above 37.8 C. Only tempC    #
# is set, so the other vitals keep their ESI band and the generic drift.       #
# --------------------------------------------------------------------------- #
FEBRILE_TEMP: dict[str, tuple[float, float]] = {
    "undiff_fever": (38.2, 39.4),
    "infective_endocarditis": (37.9, 39.0),
    "diverticulitis": (37.8, 38.8),
    "cholecystitis": (37.8, 38.8),
    "bacterial_meningitis": (38.5, 40.0),
    "encephalitis": (38.2, 39.6),
    "influenza": (38.2, 39.6),
    "covid19": (37.8, 39.2),
    "cellulitis": (37.8, 38.9),
    "nec_fasciitis": (38.3, 39.8),
    "pyelonephritis": (38.4, 39.8),
    "malaria": (38.5, 40.2),
    "hiv_seroconversion": (38.0, 39.2),
    "septic_arthritis": (38.0, 39.4),
    "osteomyelitis": (37.9, 39.0),
    "infectious_mononucleosis": (38.0, 39.2),
    "epididymo_orchitis": (37.8, 38.9),
    "acute_prostatitis": (38.3, 39.8),
    "febrile_neutropenia": (38.3, 39.6),
    "pid": (38.0, 39.0),
}


# --------------------------------------------------------------------------- #
# Condition-coherent background: PMH / medications / allergies pools.          #
#                                                                              #
# Review 02 finding 2 (critical): every templated case said "Otherwise I am     #
# generally well / I do not take any regular medicines / No known drug          #
# allergies" even for ESRD with missed dialysis, COPD, sickle crisis, febrile   #
# neutropenia or an anticoagulated ICH with INR 2.6. Each pool is sampled with  #
# the seeded RNG; at least one allergy option in most pools names an agent in   #
# the client treatment catalogue (penicillin -> ceftriaxone cross-check,        #
# aspirin, morphine, ondansetron, salbutamol) so the five-rights / allergy      #
# check can actually fail. Medication reconciliation is a National Patient      #
# Safety Goal: Joint Commission NPSG.03.06.01                                   #
# https://www.jointcommission.org/-/media/tjc/documents/standards/national-patient-safety-goals/2023/npsg_chapter_ahc_jul2023.pdf #
#                                                                              #
# Shape: {"pmh": [(en, tr), ...], "meds": [(en, tr), ...], "allergies": [(en, tr), ...]} #
# Each list is sampled independently; the generator writes BOTH the free-text   #
# spec fields (pmh_en …) and the matching patient-voiced HPI answers.           #
# --------------------------------------------------------------------------- #
NKDA: tuple[str, str] = ("No known drug allergies.", "Bilinen ilaç alerjim yok.")
ALLERGY_PENICILLIN: tuple[str, str] = ("Penicillin — anaphylaxis as a child (carries a card).", "Penisilin — çocukken anafilaksi (kart taşıyor).")
ALLERGY_ASPIRIN: tuple[str, str] = ("Aspirin and ibuprofen — wheeze and facial swelling.", "Aspirin ve ibuprofen — hırıltı ve yüzde şişlik.")
ALLERGY_MORPHINE: tuple[str, str] = ("Morphine — severe itching and vomiting.", "Morfin — şiddetli kaşıntı ve kusma.")
ALLERGY_CODEINE: tuple[str, str] = ("Codeine — rash and hallucinations.", "Kodein — döküntü ve halüsinasyon.")
ALLERGY_CONTRAST: tuple[str, str] = ("Iodinated contrast — hives during a previous CT.", "İyotlu kontrast — önceki BT sırasında kurdeşen.")
ALLERGY_SULFA: tuple[str, str] = ("Sulfonamide antibiotics — widespread rash.", "Sülfonamid antibiyotikler — yaygın döküntü.")
ALLERGY_METOCLOPRAMIDE: tuple[str, str] = ("Metoclopramide — oculogyric reaction.", "Metoklopramid — okülojirik reaksiyon.")

CONDITION_BACKGROUND: dict[str, dict[str, list[tuple[str, str]]]] = {
    "acs_stemi": {
        "pmh": [("High blood pressure and high cholesterol; I smoke twenty a day.", "Yüksek tansiyon ve yüksek kolesterol; günde yirmi sigara içiyorum."), ("Type 2 diabetes for ten years and I am overweight.", "On yıldır tip 2 diyabet, kiloluyum.")],
        "meds": [("Amlodipine 5 mg and atorvastatin 20 mg at night.", "Amlodipin 5 mg ve gece atorvastatin 20 mg."), ("Metformin 1 g twice a day; nothing else.", "Günde iki kez metformin 1 g; başka ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN, ALLERGY_CONTRAST],
    },
    "acs_nstemi": {
        "pmh": [("Angina for two years, a stent in 2021.", "İki yıldır angina, 2021'de stent."), ("High blood pressure and kidney trouble, my GP watches my creatinine.", "Yüksek tansiyon ve böbrek sorunu, aile hekimim kreatininimi izliyor.")],
        "meds": [("Aspirin 75 mg, bisoprolol 2.5 mg, atorvastatin 80 mg.", "Aspirin 75 mg, bisoprolol 2.5 mg, atorvastatin 80 mg."), ("Ramipril 5 mg and a water tablet in the morning.", "Ramipril 5 mg ve sabah idrar söktürücü.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN, ALLERGY_MORPHINE],
    },
    "unstable_angina": {
        "pmh": [("Stable angina for a year, uses a spray when walking uphill.", "Bir yıldır kararlı angina, yokuş çıkarken sprey kullanıyor.")],
        "meds": [("Aspirin 75 mg, GTN spray as needed, atorvastatin 40 mg.", "Aspirin 75 mg, gerektiğinde GTN sprey, atorvastatin 40 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "aortic_dissection": {
        "pmh": [("Long-standing high blood pressure that I do not always treat.", "Uzun süreli yüksek tansiyon, her zaman tedavi etmiyorum."), ("Marfan syndrome diagnosed as a teenager.", "Gençken tanı konan Marfan sendromu.")],
        "meds": [("Amlodipine 10 mg, but I often forget it.", "Amlodipin 10 mg, ama sık sık unutuyorum."), ("No regular medicines; I stopped my blood-pressure tablet last year.", "Düzenli ilaç yok; geçen yıl tansiyon ilacımı bıraktım.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "heart_failure_acute": {
        "pmh": [("Heart failure after a heart attack three years ago; two admissions with fluid.", "Üç yıl önce kalp krizi sonrası kalp yetmezliği; sıvıyla iki yatış."), ("Weak heart on the scan, high blood pressure and atrial fibrillation.", "Ekoda zayıf kalp, yüksek tansiyon ve atriyal fibrilasyon.")],
        "meds": [("Furosemide 40 mg, bisoprolol 5 mg, ramipril 5 mg, spironolactone 25 mg.", "Furosemid 40 mg, bisoprolol 5 mg, ramipril 5 mg, spironolakton 25 mg."), ("Furosemide, apixaban and a heart tablet whose name I forget.", "Furosemid, apiksaban ve adını unuttuğum bir kalp ilacı.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "afib_rvr": {
        "pmh": [("Atrial fibrillation that comes and goes; thyroid checked last year.", "Gelip giden atriyal fibrilasyon; geçen yıl tiroid bakıldı."), ("High blood pressure; I drank heavily at a wedding yesterday.", "Yüksek tansiyon; dün bir düğünde çok içtim.")],
        "meds": [("Apixaban 5 mg twice a day and bisoprolol 2.5 mg.", "Günde iki kez apiksaban 5 mg ve bisoprolol 2.5 mg."), ("Only amlodipine 5 mg.", "Yalnızca amlodipin 5 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_CODEINE],
    },
    "svt": {
        "pmh": [("I have had racing episodes before that stopped on their own.", "Daha önce kendiliğinden geçen çarpıntı atakları oldu."), ("Fit and well; a lot of energy drinks this week.", "Sağlıklı; bu hafta çok enerji içeceği içtim.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok."), ("The contraceptive pill only.", "Yalnızca doğum kontrol hapı.")],
        "allergies": [NKDA, NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "vt": {
        "pmh": [("A big heart attack five years ago with a weak heart since.", "Beş yıl önce büyük bir kalp krizi, o zamandan beri zayıf kalp."), ("Cardiomyopathy; I was meant to see the device clinic.", "Kardiyomiyopati; cihaz polikliniğine gitmem gerekiyordu.")],
        "meds": [("Bisoprolol 5 mg, ramipril 2.5 mg, furosemide 40 mg, atorvastatin 80 mg.", "Bisoprolol 5 mg, ramipril 2.5 mg, furosemid 40 mg, atorvastatin 80 mg."), ("Amiodarone 200 mg and aspirin 75 mg.", "Amiodaron 200 mg ve aspirin 75 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "complete_heart_block": {
        "pmh": [("High blood pressure; the GP added a new heart tablet last month.", "Yüksek tansiyon; aile hekimi geçen ay yeni bir kalp ilacı ekledi."), ("Ischaemic heart disease and type 2 diabetes.", "İskemik kalp hastalığı ve tip 2 diyabet.")],
        "meds": [("Bisoprolol 10 mg and diltiazem 240 mg — both started recently.", "Bisoprolol 10 mg ve diltiazem 240 mg — ikisi de yeni başlandı."), ("Metformin, ramipril and digoxin 125 micrograms.", "Metformin, ramipril ve digoksin 125 mikrogram.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "pericarditis": {
        "pmh": [("A cold with fever two weeks ago; otherwise well.", "İki hafta önce ateşli bir soğuk algınlığı; aksi halde iyi.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN],
    },
    "cardiac_tamponade": {
        "pmh": [("Kidney failure on dialysis; a pericardial effusion was seen last month.", "Diyalizde böbrek yetmezliği; geçen ay perikardiyal efüzyon görüldü."), ("Lung cancer under treatment; a chest scan showed fluid round the heart.", "Tedavi altında akciğer kanseri; göğüs tomografisinde kalp çevresinde sıvı.")],
        "meds": [("Amlodipine 10 mg, sevelamer, erythropoietin at dialysis.", "Amlodipin 10 mg, sevelamer, diyalizde eritropoietin."), ("Paracetamol and morphine liquid for pain; chemotherapy fortnightly.", "Ağrı için parasetamol ve morfin şurubu; iki haftada bir kemoterapi.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, ALLERGY_MORPHINE],
    },
    "hypertensive_emergency": {
        "pmh": [("High blood pressure for fifteen years; I stopped my tablets two weeks ago.", "On beş yıldır yüksek tansiyon; iki hafta önce ilaçlarımı bıraktım."), ("Chronic kidney disease and high blood pressure.", "Kronik böbrek hastalığı ve yüksek tansiyon.")],
        "meds": [("Amlodipine 10 mg, ramipril 10 mg and indapamide — not taken for two weeks.", "Amlodipin 10 mg, ramipril 10 mg ve indapamid — iki haftadır alınmadı."), ("Losartan 100 mg, doxazosin 4 mg.", "Losartan 100 mg, doksazosin 4 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_SULFA],
    },
    "infective_endocarditis": {
        "pmh": [("I inject heroin; a heart murmur was mentioned years ago.", "Eroin enjekte ediyorum; yıllar önce kalp üfürümünden bahsedildi."), ("A mechanical aortic valve replaced in 2019; dental work last month.", "2019'da takılan mekanik aort kapağı; geçen ay diş tedavisi.")],
        "meds": [("Methadone 60 mg daily.", "Günde metadon 60 mg."), ("Warfarin, target INR 2.5 to 3.5, and bisoprolol.", "Warfarin, hedef INR 2.5-3.5, ve bisoprolol.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, ALLERGY_PENICILLIN],
    },
    "myocarditis": {
        "pmh": [("Fit and well; a flu-like illness ten days ago.", "Sağlıklı; on gün önce grip benzeri bir hastalık.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN],
    },
    "aortic_stenosis": {
        "pmh": [("A murmur known for years; high blood pressure.", "Yıllardır bilinen üfürüm; yüksek tansiyon.")],
        "meds": [("Amlodipine 5 mg and atorvastatin 20 mg.", "Amlodipin 5 mg ve atorvastatin 20 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "stable_angina": {
        "pmh": [("High cholesterol and type 2 diabetes; my father had angina.", "Yüksek kolesterol ve tip 2 diyabet; babamda angina vardı.")],
        "meds": [("Metformin, atorvastatin 40 mg and aspirin 75 mg.", "Metformin, atorvastatin 40 mg ve aspirin 75 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_SULFA],
    },
    "pulmonary_embolism": {
        "pmh": [("Breast cancer treated two years ago; a long flight last week.", "İki yıl önce tedavi edilen meme kanseri; geçen hafta uzun bir uçuş."), ("A knee replacement three weeks ago; I stopped the injections early.", "Üç hafta önce diz protezi; iğneleri erken bıraktım.")],
        "meds": [("Letrozole 2.5 mg daily.", "Günde letrozol 2.5 mg."), ("Paracetamol for the knee; no blood thinner now.", "Diz için parasetamol; şimdi kan sulandırıcı yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST, ALLERGY_MORPHINE],
    },
    "asthma_exacerbation": {
        "pmh": [("Asthma since childhood; one ICU admission as a teenager.", "Çocukluktan beri astım; gençken bir yoğun bakım yatışı."), ("Asthma and hay fever; I ran out of my preventer inhaler.", "Astım ve saman nezlesi; koruyucu inhalerim bitti.")],
        "meds": [("Salbutamol inhaler, used ten times today; beclometasone inhaler.", "Salbutamol inhaler, bugün on kez kullandım; beklometazon inhaler."), ("Symbicort twice a day and a salbutamol inhaler.", "Günde iki kez Symbicort ve salbutamol inhaler.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN, ALLERGY_PENICILLIN],
    },
    "copd_exacerbation": {
        "pmh": [("COPD, forty pack-years; home oxygen was mentioned at my last clinic.", "KOAH, kırk paket-yıl; son poliklinikte ev oksijeninden bahsedildi."), ("COPD with two admissions last winter; I still smoke.", "Geçen kış iki yatışla KOAH; hâlâ sigara içiyorum.")],
        "meds": [("Tiotropium, Fostair inhaler, salbutamol as needed.", "Tiotropium, Fostair inhaler, gerektiğinde salbutamol."), ("Inhalers and prednisolone 30 mg from a course last month.", "İnhalerler ve geçen ayki kürden prednizolon 30 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "pneumonia_cap": {
        "pmh": [("Type 2 diabetes; otherwise well.", "Tip 2 diyabet; aksi halde iyi."), ("COPD, mild; I had my flu jab.", "Hafif KOAH; grip aşımı yaptırdım.")],
        "meds": [("Metformin 500 mg twice a day.", "Günde iki kez metformin 500 mg."), ("A tiotropium inhaler.", "Tiotropium inhaler.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, ALLERGY_PENICILLIN, ALLERGY_SULFA],
    },
    "tension_pneumothorax": {
        "pmh": [("Tall and thin; a collapsed lung on the other side two years ago.", "Uzun ve ince; iki yıl önce diğer tarafta akciğer sönmesi."), ("COPD with emphysema.", "Amfizemli KOAH.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok."), ("Tiotropium and salbutamol inhalers.", "Tiotropium ve salbutamol inhalerleri.")],
        "allergies": [NKDA, NKDA, ALLERGY_MORPHINE],
    },
    "carbon_monoxide": {
        "pmh": [("Well; the whole household has had headaches this week.", "Sağlıklı; bu hafta evdeki herkesin başı ağrıdı.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "ischemic_stroke": {
        "pmh": [("Atrial fibrillation; I stopped the blood thinner because of nosebleeds.", "Atriyal fibrilasyon; burun kanamaları nedeniyle kan sulandırıcıyı bıraktım."), ("High blood pressure, high cholesterol and a mini-stroke last year.", "Yüksek tansiyon, yüksek kolesterol ve geçen yıl geçici inme.")],
        "meds": [("Bisoprolol 5 mg; no anticoagulant for six months.", "Bisoprolol 5 mg; altı aydır antikoagülan yok."), ("Clopidogrel 75 mg, atorvastatin 80 mg, amlodipine 10 mg.", "Klopidogrel 75 mg, atorvastatin 80 mg, amlodipin 10 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "intracerebral_hemorrhage": {
        "pmh": [("Atrial fibrillation and high blood pressure; on a blood thinner for years.", "Atriyal fibrilasyon ve yüksek tansiyon; yıllardır kan sulandırıcı kullanıyor."), ("A heart valve replacement; the INR clinic said it was high last week.", "Kalp kapağı replasmanı; INR kliniği geçen hafta yüksek dedi.")],
        "meds": [("Warfarin 5 mg, amlodipine 10 mg.", "Warfarin 5 mg, amlodipin 10 mg."), ("Warfarin and bisoprolol.", "Warfarin ve bisoprolol.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "subarachnoid_hemorrhage": {
        "pmh": [("High blood pressure; I smoke; my mother had a brain aneurysm.", "Yüksek tansiyon; sigara içiyorum; annemde beyin anevrizması vardı."), ("Polycystic kidney disease.", "Polikistik böbrek hastalığı.")],
        "meds": [("Ramipril 5 mg.", "Ramipril 5 mg."), ("Amlodipine 5 mg and the contraceptive pill.", "Amlodipin 5 mg ve doğum kontrol hapı.")],
        "allergies": [NKDA, NKDA, ALLERGY_CODEINE],
    },
    "bacterial_meningitis": {
        "pmh": [("A university student; sinus infection last week.", "Üniversite öğrencisi; geçen hafta sinüs enfeksiyonu."), ("My spleen was removed after a car crash.", "Trafik kazasından sonra dalağım alındı.")],
        "meds": [("The contraceptive pill.", "Doğum kontrol hapı."), ("Penicillin V 250 mg twice a day, which I rarely take.", "Günde iki kez penisilin V 250 mg, nadiren alıyorum.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "status_epilepticus": {
        "pmh": [("Epilepsy since a head injury; I missed my tablets for three days.", "Kafa travmasından beri epilepsi; üç gün ilaçlarımı kaçırdım."), ("Epilepsy and heavy drinking; I stopped alcohol two days ago.", "Epilepsi ve ağır içicilik; iki gün önce alkolü bıraktım.")],
        "meds": [("Levetiracetam 1 g twice a day.", "Günde iki kez levetirasetam 1 g."), ("Sodium valproate 800 mg twice a day.", "Günde iki kez sodyum valproat 800 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "appendicitis": {
        "pmh": [("Fit and well.", "Sağlıklı."), ("Mild asthma as a child.", "Çocukken hafif astım.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok."), ("The contraceptive pill.", "Doğum kontrol hapı.")],
        "allergies": [NKDA, NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "pancreatitis": {
        "pmh": [("Gallstones seen on a scan last year; I drink most evenings.", "Geçen yıl ultrasonda safra taşı; çoğu akşam içki içiyorum."), ("High triglycerides and type 2 diabetes.", "Yüksek trigliserid ve tip 2 diyabet.")],
        "meds": [("Omeprazole 20 mg.", "Omeprazol 20 mg."), ("Metformin and fenofibrate.", "Metformin ve fenofibrat.")],
        "allergies": [NKDA, NKDA, ALLERGY_MORPHINE],
    },
    "upper_gi_bleed": {
        "pmh": [("Arthritis — I take ibuprofen most days; a duodenal ulcer years ago.", "Artrit — çoğu gün ibuprofen alıyorum; yıllar önce duodenum ülseri."), ("Alcohol-related liver disease with varices banded last year.", "Geçen yıl varis bantlanan alkole bağlı karaciğer hastalığı.")],
        "meds": [("Ibuprofen 400 mg three times a day and aspirin 75 mg.", "Günde üç kez ibuprofen 400 mg ve aspirin 75 mg."), ("Propranolol 40 mg, spironolactone, lactulose.", "Propranolol 40 mg, spironolakton, laktuloz.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "cholecystitis": {
        "pmh": [("Gallstones found two years ago; overweight; type 2 diabetes.", "İki yıl önce bulunan safra taşı; kilolu; tip 2 diyabet.")],
        "meds": [("Metformin 1 g twice a day.", "Günde iki kez metformin 1 g.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN, ALLERGY_MORPHINE],
    },
    "ascending_cholangitis": {
        "pmh": [("Gallstones; a biliary stent placed last year.", "Safra taşı; geçen yıl safra yoluna stent."), ("Gallbladder removed, bile duct stones found at that time.", "Safra kesesi alındı, o sırada safra kanalında taş bulundu.")],
        "meds": [("Ursodeoxycholic acid.", "Ursodeoksikolik asit."), ("Omeprazole 20 mg.", "Omeprazol 20 mg.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA],
    },
    "bowel_obstruction": {
        "pmh": [("Two abdominal operations for bowel cancer.", "Bağırsak kanseri için iki karın ameliyatı."), ("A hernia in the groin that gets bigger when I cough.", "Öksürünce büyüyen kasık fıtığı.")],
        "meds": [("Codeine for pain and lansoprazole.", "Ağrı için kodein ve lansoprazol."), ("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_METOCLOPRAMIDE],
    },
    "dka": {
        "pmh": [("Type 1 diabetes since age twelve; my pump failed yesterday.", "On iki yaşından beri tip 1 diyabet; pompam dün bozuldu."), ("Type 1 diabetes; I have been vomiting with a stomach bug and skipped insulin.", "Tip 1 diyabet; mide enfeksiyonuyla kusuyorum ve insülini atladım.")],
        "meds": [("Insulin pump (aspart), none for 18 hours.", "İnsülin pompası (aspart), 18 saattir yok."), ("Insulin glargine 24 units at night and aspart with meals.", "Gece insülin glarjin 24 ünite ve yemeklerle aspart.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "hhs": {
        "pmh": [("Type 2 diabetes, poorly controlled; a chest infection this week.", "Kötü kontrollü tip 2 diyabet; bu hafta akciğer enfeksiyonu."), ("Diabetes and dementia; lives in a care home.", "Diyabet ve demans; bakım evinde yaşıyor.")],
        "meds": [("Metformin 1 g twice a day, gliclazide 80 mg.", "Günde iki kez metformin 1 g, gliklazid 80 mg."), ("Metformin, amlodipine, donepezil.", "Metformin, amlodipin, donepezil.")],
        "allergies": [NKDA, NKDA, ALLERGY_SULFA],
    },
    "hyperkalemia": {
        "pmh": [("Chronic kidney disease stage 4 and heart failure.", "Evre 4 kronik böbrek hastalığı ve kalp yetmezliği."), ("Diabetes with kidney damage; a new blood-pressure tablet last week.", "Böbrek hasarı yapan diyabet; geçen hafta yeni tansiyon ilacı.")],
        "meds": [("Spironolactone 25 mg, ramipril 10 mg, furosemide 80 mg.", "Spironolakton 25 mg, ramipril 10 mg, furosemid 80 mg."), ("Ramipril 10 mg started last week, metformin, a potassium supplement.", "Geçen hafta başlanan ramipril 10 mg, metformin, potasyum takviyesi.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "hyperkalemia_esrd": {
        "pmh": [("Kidney failure on dialysis three times a week; I missed the last two sessions.", "Haftada üç gün diyalizde böbrek yetmezliği; son iki seansı kaçırdım.")],
        "meds": [("Amlodipine 10 mg, sevelamer, alfacalcidol, erythropoietin at dialysis.", "Amlodipin 10 mg, sevelamer, alfakalsidol, diyalizde eritropoietin.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, ALLERGY_CONTRAST],
    },
    "thyroid_storm": {
        "pmh": [("Graves disease; I stopped carbimazole two months ago.", "Graves hastalığı; iki ay önce karbimazolü bıraktım."), ("An overactive thyroid diagnosed recently; a chest infection this week.", "Yakın zamanda tanı konan hipertiroidi; bu hafta akciğer enfeksiyonu.")],
        "meds": [("None now; carbimazole was 20 mg.", "Şimdi yok; karbimazol 20 mg idi."), ("Propranolol 40 mg when I remember.", "Hatırladığımda propranolol 40 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN],
    },
    "hypoglycemia": {
        "pmh": [("Type 1 diabetes; I took my insulin and then skipped lunch.", "Tip 1 diyabet; insülinimi aldım sonra öğle yemeğini atladım."), ("Type 2 diabetes on a sulfonylurea; poor appetite this week.", "Sülfonilüre kullanan tip 2 diyabet; bu hafta iştah az.")],
        "meds": [("Insulin glargine and aspart.", "İnsülin glarjin ve aspart."), ("Gliclazide 160 mg twice a day and metformin.", "Günde iki kez gliklazid 160 mg ve metformin.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "adrenal_crisis": {
        "pmh": [("Addison disease; I have had vomiting and could not keep my tablets down.", "Addison hastalığı; kusuyorum ve ilaçlarımı tutamadım."), ("Long-term prednisolone for rheumatoid arthritis, stopped abruptly a week ago.", "Romatoid artrit için uzun süreli prednizolon, bir hafta önce aniden kesildi.")],
        "meds": [("Hydrocortisone 10/5/5 mg and fludrocortisone 100 micrograms.", "Hidrokortizon 10/5/5 mg ve fludrokortizon 100 mikrogram."), ("Methotrexate weekly; prednisolone until last week.", "Haftalık metotreksat; geçen haftaya kadar prednizolon.")],
        "allergies": [NKDA, NKDA, ALLERGY_SULFA],
    },
    "nec_fasciitis": {
        "pmh": [("Type 2 diabetes and I inject drugs into my leg.", "Tip 2 diyabet ve bacağımdan madde enjekte ediyorum."), ("Diabetes; a small graze on the shin last week.", "Diyabet; geçen hafta bacakta küçük bir sıyrık.")],
        "meds": [("Metformin.", "Metformin."), ("Insulin twice a day.", "Günde iki kez insülin.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA],
    },
    "pyelonephritis": {
        "pmh": [("Recurrent urine infections; a kidney stone two years ago.", "Tekrarlayan idrar enfeksiyonu; iki yıl önce böbrek taşı."), ("Type 2 diabetes; twenty weeks pregnant.", "Tip 2 diyabet; yirmi haftalık gebe.")],
        "meds": [("Trimethoprim prophylaxis, which I stopped.", "Bıraktığım trimetoprim profilaksisi."), ("Metformin and folic acid.", "Metformin ve folik asit.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, ALLERGY_SULFA],
    },
    "meningococcemia": {
        "pmh": [("A student in halls; a friend was unwell last week.", "Yurtta öğrenci; geçen hafta bir arkadaşı hastaydı.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "aki": {
        "pmh": [("Vomiting and diarrhoea for three days; high blood pressure.", "Üç gündür kusma ve ishal; yüksek tansiyon."), ("Prostate trouble; I have passed almost no urine for two days.", "Prostat sorunu; iki gündür neredeyse hiç idrar yapmadım.")],
        "meds": [("Ramipril 10 mg, ibuprofen for a bad back, bendroflumethiazide.", "Ramipril 10 mg, bel ağrısı için ibuprofen, bendroflumetiyazid."), ("Tamsulosin 400 micrograms.", "Tamsulosin 400 mikrogram.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "renal_colic": {
        "pmh": [("A kidney stone passed five years ago.", "Beş yıl önce düşürülen böbrek taşı."), ("Gout; otherwise well.", "Gut; aksi halde iyi.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok."), ("Allopurinol 300 mg.", "Allopurinol 300 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN, ALLERGY_CONTRAST],
    },
    "alcohol_withdrawal": {
        "pmh": [("I drink a bottle of spirits a day; a withdrawal seizure two years ago.", "Günde bir şişe sert içki; iki yıl önce yoksunluk nöbeti."), ("Heavy drinking for ten years; liver tests were abnormal.", "On yıldır ağır içicilik; karaciğer testleri bozuktu.")],
        "meds": [("Thiamine tablets that I do not take.", "Almadığım tiamin tabletleri."), ("None.", "Yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "opioid_overdose": {
        "pmh": [("Heroin use; I was in prison until last week so my tolerance is down.", "Eroin kullanımı; geçen haftaya kadar cezaevindeydim, toleransım düşük."), ("Chronic back pain on strong painkillers; I took extra tonight.", "Güçlü ağrı kesicilerle kronik bel ağrısı; bu gece fazladan aldım.")],
        "meds": [("Methadone 40 mg daily.", "Günde metadon 40 mg."), ("Oxycodone modified-release 40 mg twice a day, pregabalin 300 mg.", "Günde iki kez oksikodon MR 40 mg, pregabalin 300 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "paracetamol_od": {
        "pmh": [("Depression; a previous overdose two years ago.", "Depresyon; iki yıl önce bir aşırı doz."), ("No medical problems; an argument tonight.", "Tıbbi sorun yok; bu gece bir tartışma.")],
        "meds": [("Sertraline 100 mg.", "Sertralin 100 mg."), ("None.", "Yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "ectopic_pregnancy": {
        "pmh": [("A previous ectopic treated with methotrexate; I have a coil.", "Metotreksatla tedavi edilen önceki ektopik; spiralim var."), ("Pelvic infection three years ago; six weeks since my last period.", "Üç yıl önce pelvik enfeksiyon; son adetimden altı hafta geçti.")],
        "meds": [("Folic acid.", "Folik asit."), ("None.", "Yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "preeclampsia": {
        "pmh": [("First pregnancy, 34 weeks; blood pressure was high at the last visit.", "İlk gebelik, 34 hafta; son kontrolde tansiyon yüksekti."), ("Second pregnancy, 36 weeks; pre-eclampsia in the first.", "İkinci gebelik, 36 hafta; ilkinde preeklampsi.")],
        "meds": [("Pregnancy vitamins and aspirin 150 mg at night.", "Gebelik vitaminleri ve gece aspirin 150 mg."), ("Labetalol 200 mg twice a day.", "Günde iki kez labetalol 200 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "pph": {
        "pmh": [("Delivered twins forty minutes ago after a long labour.", "Kırk dakika önce uzun bir doğumdan sonra ikiz doğurdu."), ("A vaginal delivery an hour ago; the placenta came out in pieces.", "Bir saat önce vajinal doğum; plasenta parçalı çıktı.")],
        "meds": [("Iron tablets; oxytocin was given at delivery.", "Demir tabletleri; doğumda oksitosin verildi.")],
        "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN],
    },
    "cauda_equina": {
        "pmh": [("Years of low back pain; a disc problem on an old scan.", "Yıllardır bel ağrısı; eski bir MR'da disk sorunu.")],
        "meds": [("Naproxen 500 mg and codeine 30 mg.", "Naproksen 500 mg ve kodein 30 mg.")],
        "allergies": [NKDA, NKDA, ALLERGY_MORPHINE],
    },
    "compartment_syndrome": {
        "pmh": [("A tibial fracture plastered this morning after a motorbike crash.", "Bu sabah motosiklet kazasından sonra alçılanan tibia kırığı.")],
        "meds": [("No regular medicines.", "Düzenli ilaç yok.")],
        "allergies": [NKDA, NKDA, ALLERGY_MORPHINE],
    },
    "febrile_neutropenia": {
        "pmh": [("Breast cancer; chemotherapy eight days ago.", "Meme kanseri; sekiz gün önce kemoterapi."), ("Lymphoma; the last cycle of chemotherapy was ten days ago; I have a PICC line.", "Lenfoma; son kemoterapi kürü on gün önce; PICC kateterim var.")],
        "meds": [("Ondansetron and dexamethasone from the chemo pack.", "Kemoterapi paketinden ondansetron ve deksametazon."), ("Co-trimoxazole prophylaxis, aciclovir.", "Ko-trimoksazol profilaksisi, asiklovir.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA],
    },
    "dvt": {
        "pmh": [("A long-haul flight last week; I take the contraceptive pill.", "Geçen hafta uzun uçuş; doğum kontrol hapı alıyorum."), ("Hip surgery a month ago.", "Bir ay önce kalça ameliyatı.")],
        "meds": [("Combined oral contraceptive.", "Kombine oral kontraseptif."), ("Paracetamol; I finished the injections after surgery.", "Parasetamol; ameliyat sonrası iğneleri bitirdim.")],
        "allergies": [NKDA, NKDA, ALLERGY_CONTRAST],
    },
    "sickle_crisis": {
        "pmh": [("Sickle cell disease since birth; about four crises a year.", "Doğumdan beri orak hücre hastalığı; yılda yaklaşık dört kriz.")],
        "meds": [("Hydroxycarbamide 1 g, folic acid, penicillin V.", "Hidroksikarbamid 1 g, folik asit, penisilin V."), ("Folic acid and morphine liquid at home, which has not worked today.", "Folik asit ve evde morfin şurubu, bugün işe yaramadı.")],
        "allergies": [NKDA, NKDA, ALLERGY_CODEINE],
    },
    "bronchiolitis": {
        "pmh": [("Born at 35 weeks; otherwise a well baby.", "35 haftalık doğdu; aksi halde sağlıklı bebek.")],
        "meds": [("Vitamin D drops only.", "Yalnızca D vitamini damlası.")],
        "allergies": [NKDA],
    },
    "anaphylaxis": {
        "pmh": [("Peanut allergy since childhood; I carry an adrenaline pen but did not bring it.", "Çocukluktan beri fıstık alerjisi; adrenalin kalemi taşıyorum ama yanımda değil."), ("Asthma; stung by a wasp twenty minutes ago.", "Astım; yirmi dakika önce eşek arısı soktu.")],
        "meds": [("Cetirizine as needed.", "Gerektiğinde setirizin."), ("Salbutamol and beclometasone inhalers.", "Salbutamol ve beklometazon inhalerleri.")],
        "allergies": [("Peanuts — anaphylaxis; also penicillin rash.", "Fıstık — anafilaksi; ayrıca penisilin döküntüsü."), ("Wasp venom (today's trigger).", "Eşek arısı zehri (bugünkü tetikleyici).")],
    },
    "septic_shock": {
        "pmh": [("Type 2 diabetes; a urine infection treated last week.", "Tip 2 diyabet; geçen hafta tedavi edilen idrar enfeksiyonu."), ("Chemotherapy for bowel cancer; a central line.", "Bağırsak kanseri için kemoterapi; santral kateter.")],
        "meds": [("Metformin, atorvastatin, trimethoprim from last week.", "Metformin, atorvastatin, geçen haftadan trimetoprim."), ("Capecitabine; omeprazole.", "Kapesitabin; omeprazol.")],
        "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA],
    },
}

# System-level fallback pools for the long tail (conditions without a specific entry).
SYSTEM_BACKGROUND: dict[str, dict[str, list[tuple[str, str]]]] = {
    "cardiology": {"pmh": [("High blood pressure and high cholesterol.", "Yüksek tansiyon ve yüksek kolesterol."), ("Type 2 diabetes; I smoke.", "Tip 2 diyabet; sigara içiyorum.")], "meds": [("Amlodipine 5 mg and atorvastatin 20 mg.", "Amlodipin 5 mg ve atorvastatin 20 mg."), ("Metformin 500 mg twice a day.", "Günde iki kez metformin 500 mg.")], "allergies": [NKDA, NKDA, ALLERGY_ASPIRIN]},
    "pulmonology": {"pmh": [("Asthma as a child; I smoke ten a day.", "Çocukken astım; günde on sigara içiyorum."), ("No lung problems before this.", "Bundan önce akciğer sorunu yok.")], "meds": [("A salbutamol inhaler, rarely used.", "Nadiren kullanılan salbutamol inhaler."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN]},
    "gastroenterology": {"pmh": [("Reflux; otherwise well.", "Reflü; aksi halde iyi."), ("Gallstones mentioned on a scan.", "Ultrasonda safra taşından bahsedildi.")], "meds": [("Omeprazole 20 mg.", "Omeprazol 20 mg."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN, ALLERGY_MORPHINE]},
    "neurology": {"pmh": [("High blood pressure.", "Yüksek tansiyon."), ("Migraines since my twenties.", "Yirmili yaşlardan beri migren.")], "meds": [("Ramipril 5 mg.", "Ramipril 5 mg."), ("Sumatriptan when needed.", "Gerektiğinde sumatriptan.")], "allergies": [NKDA, NKDA, ALLERGY_CODEINE]},
    "infectious": {"pmh": [("Type 2 diabetes.", "Tip 2 diyabet."), ("Nothing of note.", "Kayda değer bir şey yok.")], "meds": [("Metformin.", "Metformin."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA]},
    "endocrine": {"pmh": [("Type 2 diabetes for eight years.", "Sekiz yıldır tip 2 diyabet."), ("An underactive thyroid.", "Hipotiroidi.")], "meds": [("Metformin and gliclazide.", "Metformin ve gliklazid."), ("Levothyroxine 100 micrograms.", "Levotiroksin 100 mikrogram.")], "allergies": [NKDA, NKDA, ALLERGY_SULFA]},
    "renal": {"pmh": [("Chronic kidney disease stage 3 and high blood pressure.", "Evre 3 kronik böbrek hastalığı ve yüksek tansiyon."), ("Prostate trouble.", "Prostat sorunu.")], "meds": [("Ramipril 10 mg, amlodipine 5 mg.", "Ramipril 10 mg, amlodipin 5 mg."), ("Tamsulosin.", "Tamsulosin.")], "allergies": [NKDA, NKDA, ALLERGY_CONTRAST]},
    "psychiatry": {"pmh": [("Depression and anxiety for years.", "Yıllardır depresyon ve anksiyete."), ("No medical problems.", "Tıbbi sorun yok.")], "meds": [("Sertraline 100 mg.", "Sertralin 100 mg."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN]},
    "hematology": {"pmh": [("Cancer under treatment with chemotherapy.", "Kemoterapiyle tedavi altında kanser."), ("Anaemia for months.", "Aylardır anemi.")], "meds": [("Ondansetron and dexamethasone with chemotherapy.", "Kemoterapiyle ondansetron ve deksametazon."), ("Ferrous sulfate.", "Demir sülfat.")], "allergies": [NKDA, ALLERGY_PENICILLIN, NKDA]},
    "obstetrics-gynecology": {"pmh": [("One normal delivery; otherwise well.", "Bir normal doğum; aksi halde iyi."), ("Endometriosis.", "Endometriozis.")], "meds": [("Folic acid.", "Folik asit."), ("The contraceptive pill.", "Doğum kontrol hapı.")], "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN]},
    "musculoskeletal": {"pmh": [("Arthritis in the knees.", "Dizlerde artrit."), ("Fit and well.", "Sağlıklı.")], "meds": [("Naproxen and omeprazole.", "Naproksen ve omeprazol."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, NKDA, ALLERGY_MORPHINE]},
    "emergency": {"pmh": [("High blood pressure.", "Yüksek tansiyon."), ("Nothing of note.", "Kayda değer bir şey yok.")], "meds": [("Amlodipine 5 mg.", "Amlodipin 5 mg."), ("No regular medicines.", "Düzenli ilaç yok.")], "allergies": [NKDA, NKDA, ALLERGY_PENICILLIN]},
}


def background_pool(cond_id: str, system: str) -> dict[str, list[tuple[str, str]]]:
    """The PMH / meds / allergies pool for a condition (condition-specific first,
    then the system default, then the emergency default)."""
    return (CONDITION_BACKGROUND.get(cond_id)
            or SYSTEM_BACKGROUND.get(system)
            or SYSTEM_BACKGROUND["emergency"])


# --------------------------------------------------------------------------- #
# Patient-voiced red flags (lay language, only what the patient could know).  #
#                                                                              #
# Review 02 finding 3 (critical): catalog red flags ("ST elevation on ECG",     #
# "lactate above 2 mmol/L") were pasted into patient speech. The catalog's red  #
# flags are clinician-observed signs or results and now travel as structured    #
# ``red_flags`` data (channel "clinician"); the patient's own red-flag answer   #
# comes from this table, in the patient's voice. ASPE Standards of Best         #
# Practice, Domain 3: https://doi.org/10.1186/s41077-017-0043-4                 #
# --------------------------------------------------------------------------- #
PATIENT_RED_FLAG_SPEECH: dict[str, tuple[str, str]] = {
    "acs_stemi": ("The pain is crushing, I am sweating and it has not eased at all.", "Ağrı ezici, terliyorum ve hiç hafiflemedi."),
    "acs_nstemi": ("It keeps coming back at rest and goes into my left arm.", "İstirahatte tekrar geliyor ve sol koluma yayılıyor."),
    "unstable_angina": ("It used to come only on walking; now it comes when I sit still.", "Eskiden sadece yürürken gelirdi; şimdi otururken de geliyor."),
    "aortic_dissection": ("It tore through to my back, worst pain of my life, and my left arm feels odd.", "Sırtıma yırtılır gibi vurdu, hayatımın en kötü ağrısı, sol kolum tuhaf."),
    "heart_failure_acute": ("I cannot lie flat, I wake up gasping and my ankles are huge.", "Düz yatamıyorum, nefes nefese uyanıyorum ve ayak bileklerim çok şiş."),
    "afib_rvr": ("My heart is racing and fluttering and I feel faint when I stand.", "Kalbim çok hızlı ve çırpınıyor, ayağa kalkınca bayılacak gibi oluyorum."),
    "svt": ("It started like a switch, very fast, and I feel light-headed.", "Düğme gibi aniden başladı, çok hızlı ve başım dönüyor."),
    "vt": ("I nearly blacked out and my chest hurts with the pounding.", "Neredeyse bayıldım ve çarpıntıyla göğsüm ağrıyor."),
    "complete_heart_block": ("I have fainted twice today and feel my pulse is very slow.", "Bugün iki kez bayıldım ve nabzımın çok yavaş olduğunu hissediyorum."),
    "pericarditis": ("Sitting forward helps; lying back makes it stab.", "Öne eğilmek rahatlatıyor; arkaya yaslanınca bıçak gibi batıyor."),
    "cardiac_tamponade": ("I feel faint and breathless even sitting still, and it is getting worse.", "Otururken bile baygın ve nefessizim, giderek kötüleşiyor."),
    "hypertensive_emergency": ("My vision is blurred and the headache is pounding behind my eyes.", "Görmem bulanık ve baş ağrısı gözlerimin arkasında zonkluyor."),
    "infective_endocarditis": ("Night sweats for weeks and a painful spot on my finger.", "Haftalardır gece terlemesi ve parmağımda ağrılı bir leke."),
    "myocarditis": ("I am breathless climbing stairs and my heart skips.", "Merdiven çıkarken nefesim kesiliyor ve kalbim tekliyor."),
    "aortic_stenosis": ("I blacked out while carrying shopping upstairs.", "Alışveriş torbalarını üst kata taşırken bayıldım."),
    "stable_angina": ("No, it always eases within minutes when I stop and rest.", "Hayır, durup dinlenince her zaman birkaç dakikada geçiyor."),
    "pulmonary_embolism": ("My right calf has been swollen and I flew long-haul last week.", "Sağ baldırım şiş ve geçen hafta uzun bir uçuş yaptım."),
    "asthma_exacerbation": ("I cannot finish a sentence and my inhaler is not working.", "Bir cümleyi bitiremiyorum ve inhalerim işe yaramıyor."),
    "copd_exacerbation": ("I feel drowsy and my sputum has turned green.", "Uykulu hissediyorum ve balgamım yeşile döndü."),
    "pneumonia_cap": ("Shaking chills and I have been confused, my wife says.", "Titremeyle üşüme ve eşim konfüze olduğumu söylüyor."),
    "tension_pneumothorax": ("I suddenly cannot get any air in and I feel I am going to pass out.", "Aniden hiç nefes alamıyorum ve bayılacak gibiyim."),
    "carbon_monoxide": ("Everyone at home has a headache and the dog has been sick.", "Evdeki herkesin başı ağrıyor ve köpek kustu."),
    "ischemic_stroke": ("My face dropped and my arm went weak less than two hours ago.", "Yüzüm düştü ve kolum iki saatten kısa süre önce güçsüzleşti."),
    "intracerebral_hemorrhage": ("A sudden terrible headache, then vomiting and my arm went weak.", "Aniden korkunç baş ağrısı, sonra kusma ve kolum güçsüzleşti."),
    "subarachnoid_hemorrhage": ("It hit like a hammer in a second, worst headache of my life.", "Bir saniyede balyoz gibi vurdu, hayatımın en kötü baş ağrısı."),
    "bacterial_meningitis": ("The light hurts my eyes and I cannot bend my neck; I noticed spots on my legs.", "Işık gözlerimi acıtıyor, boynumu bükemiyorum; bacaklarımda lekeler fark ettim."),
    "status_epilepticus": ("(Relative) He has been fitting continuously for more than five minutes.", "(Yakını) Beş dakikadan uzun süredir aralıksız kasılıyor."),
    "appendicitis": ("It started round my belly button and moved to the right; coughing makes it worse.", "Göbeğimin etrafında başladı ve sağa kaydı; öksürünce kötüleşiyor."),
    "pancreatitis": ("It bores through to my back and I cannot stop vomiting.", "Sırtıma doğru oyar gibi ve kusmam durmuyor."),
    "upper_gi_bleed": ("I vomited something like coffee grounds and my stools are black and tarry.", "Kahve telvesi gibi kustum ve dışkım siyah ve katran gibi."),
    "cholecystitis": ("Fever and it hurts under my right ribs when I breathe in.", "Ateş var ve nefes alırken sağ kaburgalarımın altı ağrıyor."),
    "ascending_cholangitis": ("I am yellow, shivering and my urine is dark.", "Sarıyım, titriyorum ve idrarım koyu."),
    "bowel_obstruction": ("I have not passed wind or stool for two days and the vomit smells awful.", "İki gündür gaz ya da dışkı çıkaramadım ve kusmuk çok kötü kokuyor."),
    "dka": ("I am very thirsty, vomiting and breathing deeply; my sugar meter just says HI.", "Çok susuyorum, kusuyorum ve derin nefes alıyorum; şeker ölçerim sadece HI diyor."),
    "hhs": ("(Relative) She has been drinking litres and is now barely making sense.", "(Yakını) Litrelerce içiyordu ve şimdi neredeyse anlamsız konuşuyor."),
    "hyperkalemia": ("My legs feel heavy and weak and my heart is doing odd things.", "Bacaklarım ağır ve güçsüz, kalbim tuhaf şeyler yapıyor."),
    "hyperkalemia_esrd": ("I missed dialysis twice and now I am weak and breathless.", "Diyalizi iki kez kaçırdım, şimdi güçsüz ve nefessizim."),
    "thyroid_storm": ("I am burning up, my heart is racing and I cannot sit still.", "Yanıyorum, kalbim deli gibi atıyor ve yerimde duramıyorum."),
    "hypoglycemia": ("Sweaty, shaky and I cannot think straight.", "Terli, titrek ve düşünemiyorum."),
    "adrenal_crisis": ("Vomiting all day, dizzy standing up and I could not take my steroids.", "Bütün gün kusma, ayakta baş dönmesi ve steroidlerimi alamadım."),
    "nec_fasciitis": ("The pain is far worse than the leg looks and it is spreading by the hour.", "Ağrı bacağın görünüşünden çok daha kötü ve saatler içinde yayılıyor."),
    "pyelonephritis": ("Shivering, fever and pain in my side that is getting worse.", "Titreme, ateş ve giderek artan yan ağrısı."),
    "meningococcemia": ("A rash that does not fade when I press a glass on it and I feel terrible.", "Üzerine bardak bastırınca solmayan bir döküntü ve çok kötüyüm."),
    "aki": ("I have hardly passed urine in two days and my legs are swelling.", "İki gündür neredeyse hiç idrar yapmadım ve bacaklarım şişiyor."),
    "renal_colic": ("No fever, but the pain comes in waves to my groin and I cannot keep still.", "Ateş yok ama ağrı dalga dalga kasığıma geliyor ve yerimde duramıyorum."),
    "alcohol_withdrawal": ("I am shaking, sweating and seeing things that are not there.", "Titriyorum, terliyorum ve olmayan şeyler görüyorum."),
    "opioid_overdose": ("(Friend) He used after a break and now he is barely breathing.", "(Arkadaşı) Aradan sonra kullandı ve şimdi zar zor nefes alıyor."),
    "paracetamol_od": ("I took the whole pack about four hours ago.", "Yaklaşık dört saat önce bütün kutuyu aldım."),
    "ectopic_pregnancy": ("My period is late, I have spotting and the pain is on one side; I felt faint.", "Adetim gecikti, lekelenme var ve ağrı tek tarafta; bayılacak gibi oldum."),
    "preeclampsia": ("Headache, flashing lights and my hands and face are puffy.", "Baş ağrısı, ışık çakmaları ve ellerim ve yüzüm şiş."),
    "pph": ("The bleeding has soaked through two pads in twenty minutes and I feel faint.", "Kanama yirmi dakikada iki pedi ıslattı ve bayılacak gibiyim."),
    "cauda_equina": ("I cannot feel when I need to pass urine and my saddle area is numb.", "İdrarımın geldiğini hissedemiyorum ve eyer bölgem uyuşuk."),
    "compartment_syndrome": ("The pain is unbearable under the cast, and stretching my toes is agony.", "Alçının altında ağrı dayanılmaz, parmaklarımı germek işkence."),
    "febrile_neutropenia": ("I had chemotherapy eight days ago and now I have a fever and chills.", "Sekiz gün önce kemoterapi aldım ve şimdi ateş ve titreme var."),
    "dvt": ("Only the one calf is swollen and hot, and I get a twinge in my chest when I breathe in.", "Yalnızca bir baldır şiş ve sıcak, nefes alırken göğsümde batma oluyor."),
    "sickle_crisis": ("This feels like my usual crisis but worse, and I am a bit breathless.", "Her zamanki krizim gibi ama daha kötü, biraz da nefesim daralıyor."),
    "bronchiolitis": ("(Parent) She is feeding half what she usually does and paused breathing once.", "(Ebeveyn) Her zamankinin yarısı kadar emiyor ve bir kez nefesi durdu."),
    "anaphylaxis": ("My throat feels tight, my lips are swelling and I feel faint.", "Boğazım sıkışıyor, dudaklarım şişiyor ve bayılacak gibiyim."),
    "septic_shock": ("(Relative) He is confused, burning hot and his hands are cold and mottled.", "(Yakını) Konfüze, ateşi çok yüksek ve elleri soğuk ve alacalı."),
    "heat_stroke": ("(Bystander) He collapsed at the marathon and is confused and not sweating.", "(Tanık) Maratonda yere yığıldı, konfüze ve terlemiyor."),
    "hypothermia": ("(Rescuer) Found outdoors overnight, very drowsy and no longer shivering.", "(Kurtarıcı) Gece dışarıda bulundu, çok uykulu ve artık titremiyor."),
    "testicular_torsion": ("It came on suddenly two hours ago and I have been sick with the pain.", "İki saat önce aniden başladı ve ağrıdan kustum."),
    "panic_disorder": ("No, it does not go into my arm or jaw, and it is not worse when I walk.", "Hayır, koluma veya çeneme yayılmıyor ve yürürken kötüleşmiyor."),
}
GENERIC_RED_FLAG_SPEECH: tuple[str, str] = (
    "I cannot think of anything else, but I have never felt this unwell.",
    "Başka bir şey aklıma gelmiyor ama hiç bu kadar kötü hissetmemiştim.",
)


# --------------------------------------------------------------------------- #
# Condition-specific physical examination findings.                            #
#                                                                              #
# Review 02 finding 4 (critical): every templated case examined as "Findings    #
# consistent with <diagnosis label>", handing the learner the answer. Findings  #
# here are real signs that require interpretation (ASPE Domain 3 principle 3.2  #
# https://doi.org/10.1186/s41077-017-0043-4). Conditions absent from this table #
# receive the system-level non-revealing findings in ``case_generator._PROFILES``. #
#                                                                              #
# Shape: (maneuver, system_en, system_tr, finding_en, finding_tr, abnormal)     #
# --------------------------------------------------------------------------- #
_CV = ("Cardiovascular", "Kardiyovasküler")
_RESP = ("Respiratory", "Solunum")
_ABD = ("Abdominal", "Karın")
_NEURO = ("Neurological", "Nörolojik")
_GEN = ("General", "Genel")
_SKIN = ("Skin", "Cilt")
_MSK = ("Musculoskeletal", "Kas-iskelet")


def _ex(maneuver: str, sys_: tuple[str, str], en: str, tr: str, abnormal: bool = True) -> tuple:
    return (maneuver, sys_[0], sys_[1], en, tr, abnormal)


CONDITION_EXAM: dict[str, list[tuple]] = {
    "acs_stemi": [_ex("cardiovascular", _CV, "Pale, clammy and diaphoretic; regular pulse, no murmur, JVP not raised.", "Soluk, nemli ve terli; düzenli nabız, üfürüm yok, JVP yüksek değil."), _ex("respiratory", _RESP, "Fine bibasal crackles.", "Bibazal ince raller.")],
    "acs_nstemi": [_ex("cardiovascular", _CV, "Regular pulse, normal heart sounds, no murmur; chest wall non-tender.", "Düzenli nabız, normal kalp sesleri, üfürüm yok; göğüs duvarı hassas değil."), _ex("respiratory", _RESP, "Clear chest.", "Akciğerler temiz.", False)],
    "unstable_angina": [_ex("cardiovascular", _CV, "Regular pulse, soft fourth heart sound during pain, no murmur.", "Düzenli nabız, ağrı sırasında yumuşak dördüncü kalp sesi, üfürüm yok."), _ex("general-inspection", _GEN, "Anxious, hand pressed to the sternum.", "Anksiyöz, elini sternuma bastırıyor.")],
    "aortic_dissection": [_ex("cardiovascular", _CV, "Pulse deficit at the left radial; early diastolic murmur at the left sternal edge; BP 168/92 right arm, 128/70 left arm.", "Sol radialde nabız defisiti; sol sternal kenarda erken diyastolik üfürüm; TA sağ kol 168/92, sol kol 128/70."), _ex("neurological", _NEURO, "Mild left-arm weakness, no facial droop.", "Hafif sol kol güçsüzlüğü, yüz düşüklüğü yok.")],
    "heart_failure_acute": [_ex("cardiovascular", _CV, "Raised JVP, displaced apex, third heart sound; pitting oedema to the knees.", "Yüksek JVP, yer değiştirmiş apeks, üçüncü kalp sesi; dizlere kadar gode bırakan ödem."), _ex("respiratory", _RESP, "Bilateral coarse crackles to the mid-zones, sitting bolt upright.", "Orta zonlara kadar bilateral kaba raller, dik oturuyor.")],
    "afib_rvr": [_ex("cardiovascular", _CV, "Irregularly irregular pulse with a variable first heart sound; apical rate higher than the radial.", "Düzensiz düzensiz nabız, değişken birinci kalp sesi; apikal hız radialden yüksek."), _ex("general-inspection", _GEN, "Alert, mildly anxious, no thyroid eye signs.", "Uyanık, hafif anksiyöz, tiroid göz bulgusu yok.", False)],
    "svt": [_ex("cardiovascular", _CV, "Regular, very rapid pulse too fast to count; prominent neck pulsation ('frog sign').", "Düzenli, sayılamayacak kadar hızlı nabız; boyunda belirgin pulsasyon ('kurbağa bulgusu')."), _ex("respiratory", _RESP, "Clear chest.", "Akciğerler temiz.", False)],
    "vt": [_ex("cardiovascular", _CV, "Rapid regular pulse of poor volume; cannon A waves in the neck; cool peripheries.", "Zayıf dolgunlukta hızlı düzenli nabız; boyunda cannon A dalgaları; soğuk ekstremiteler."), _ex("general-inspection", _GEN, "Grey, sweaty, anxious.", "Gri, terli, anksiyöz.")],
    "complete_heart_block": [_ex("cardiovascular", _CV, "Slow regular pulse around 36/min, large-volume; intermittent cannon waves at the neck; variable first heart sound.", "Yaklaşık 36/dk yavaş düzenli nabız, geniş dolgunluk; boyunda aralıklı cannon dalgaları; değişken birinci kalp sesi."), _ex("neurological", _NEURO, "Alert between episodes; no focal deficit.", "Ataklar arasında uyanık; fokal defisit yok.", False)],
    "pericarditis": [_ex("cardiovascular", _CV, "Scratchy triphasic rub at the left sternal edge, loudest leaning forward.", "Sol sternal kenarda öne eğilince en belirgin, sürtünme sesi (frotman)."), _ex("respiratory", _RESP, "Clear chest, pain on deep inspiration.", "Akciğerler temiz, derin inspiryumda ağrı.")],
    "cardiac_tamponade": [_ex("cardiovascular", _CV, "Raised JVP that rises on inspiration, muffled heart sounds, narrow pulse pressure, pulsus paradoxus.", "İnspiryumda yükselen yüksek JVP, boğuk kalp sesleri, dar nabız basıncı, pulsus paradoksus."), _ex("respiratory", _RESP, "Clear lung fields despite breathlessness.", "Nefes darlığına rağmen temiz akciğer alanları.")],
    "hypertensive_emergency": [_ex("neurological", _NEURO, "Fundoscopy: flame haemorrhages, cotton-wool spots and disc swelling.", "Fundoskopi: alev şeklinde hemorajiler, pamuk-yün lekeleri ve disk şişliği."), _ex("cardiovascular", _CV, "Heaving apex, loud second heart sound; no radio-femoral delay.", "Kuvvetli apeks, gür ikinci kalp sesi; radyo-femoral gecikme yok.")],
    "infective_endocarditis": [_ex("cardiovascular", _CV, "New pansystolic murmur at the apex; splinter haemorrhages and a tender nodule on a finger pulp.", "Apekste yeni pansistolik üfürüm; splinter hemorajiler ve parmak ucunda hassas nodül."), _ex("skin", _SKIN, "Needle track marks in the antecubital fossae.", "Antekübital çukurlarda iğne izleri.")],
    "myocarditis": [_ex("cardiovascular", _CV, "Tachycardia out of proportion to fever; soft third heart sound; JVP mildly raised.", "Ateşle orantısız taşikardi; yumuşak üçüncü kalp sesi; JVP hafif yüksek."), _ex("respiratory", _RESP, "Few basal crackles.", "Birkaç bazal ral.")],
    "aortic_stenosis": [_ex("cardiovascular", _CV, "Slow-rising, low-volume pulse; harsh crescendo-decrescendo systolic murmur radiating to the carotids; quiet second sound.", "Yavaş yükselen düşük dolgunlukta nabız; karotislere yayılan sert kreşendo-dekreşendo sistolik üfürüm; hafif ikinci ses."), _ex("respiratory", _RESP, "Clear chest.", "Akciğerler temiz.", False)],
    "stable_angina": [_ex("cardiovascular", _CV, "Pain-free at rest; regular pulse, no murmur, no oedema.", "İstirahatte ağrısız; düzenli nabız, üfürüm yok, ödem yok.", False), _ex("general-inspection", _GEN, "Corneal arcus and xanthelasma.", "Korneal arkus ve ksantelazma.")],
    "pulmonary_embolism": [_ex("respiratory", _RESP, "Tachypnoeic with clear lung fields; no wheeze or crackles.", "Takipneik, akciğer alanları temiz; hırıltı veya ral yok."), _ex("musculoskeletal", _MSK, "Right calf 3 cm larger than the left, warm and tender along the deep veins.", "Sağ baldır soldan 3 cm geniş, derin venler boyunca sıcak ve hassas.")],
    "asthma_exacerbation": [_ex("respiratory", _RESP, "Speaking in single words, accessory muscle use, widespread polyphonic wheeze with prolonged expiration.", "Tek kelimelerle konuşuyor, yardımcı solunum kasları kullanımı, yaygın polifonik hırıltı ve uzamış ekspiryum."), _ex("general-inspection", _GEN, "Sitting forward, tripod position, unable to lie flat.", "Öne eğilmiş, tripod pozisyonu, düz yatamıyor.")],
    "copd_exacerbation": [_ex("respiratory", _RESP, "Barrel chest, pursed-lip breathing, hyperresonant percussion, scattered wheeze and reduced air entry.", "Fıçı göğüs, büzük dudak solunumu, hipersonor perküsyon, dağınık hırıltı ve azalmış hava girişi."), _ex("neurological", _NEURO, "Drowsy but rousable; fine flapping tremor of the outstretched hands.", "Uykulu ama uyandırılabilir; ellerde ince çırpıntı tremoru.")],
    "pneumonia_cap": [_ex("respiratory", _RESP, "Dull percussion, bronchial breathing and coarse crackles at the right base with increased vocal resonance.", "Sağ bazalde mat perküsyon, bronşiyal solunum ve kaba raller, artmış vokal rezonans."), _ex("general-inspection", _GEN, "Flushed, rigors, new confusion (AMT 6/10).", "Kızarık, titreme, yeni konfüzyon (AMT 6/10).")],
    "tension_pneumothorax": [_ex("respiratory", _RESP, "Absent breath sounds and hyperresonance on the left with reduced expansion; trachea deviated to the right.", "Solda solunum sesi yok ve hipersonor, ekspansiyon azalmış; trakea sağa kaymış."), _ex("cardiovascular", _CV, "Distended neck veins, thready tachycardia, hypotension.", "Dolgun boyun venleri, filiform taşikardi, hipotansiyon.")],
    "carbon_monoxide": [_ex("neurological", _NEURO, "Confused, ataxic gait, no focal deficit.", "Konfüze, ataksik yürüyüş, fokal defisit yok."), _ex("general-inspection", _GEN, "Pulse oximetry reads 99% despite symptoms; no cyanosis.", "Semptomlara rağmen pulse oksimetre %99; siyanoz yok.")],
    "ischemic_stroke": [_ex("neurological", _NEURO, "Right facial droop, right arm drift with 2/5 power, expressive dysphasia; NIHSS 11.", "Sağ yüz düşüklüğü, sağ kolda 2/5 güçle düşme, ekspresif disfazi; NIHSS 11."), _ex("cardiovascular", _CV, "Irregularly irregular pulse; no carotid bruit.", "Düzensiz düzensiz nabız; karotis üfürümü yok.")],
    "intracerebral_hemorrhage": [_ex("neurological", _NEURO, "GCS 12 (E3 V4 M5), left hemiparesis, left-sided neglect, right gaze preference.", "GKS 12 (E3 V4 M5), sol hemiparezi, sol taraf ihmali, sağa bakış tercihi."), _ex("general-inspection", _GEN, "Vomited twice; bruising on the forearms.", "İki kez kustu; ön kollarda morluklar.")],
    "subarachnoid_hemorrhage": [_ex("neurological", _NEURO, "Neck stiffness with positive Kernig sign, photophobia; no focal limb deficit; GCS 15.", "Pozitif Kernig bulgusuyla ense sertliği, fotofobi; fokal ekstremite defisiti yok; GKS 15."), _ex("general-inspection", _GEN, "Lying still with eyes shut, vomiting.", "Gözleri kapalı hareketsiz yatıyor, kusuyor.")],
    "bacterial_meningitis": [_ex("neurological", _NEURO, "Marked neck stiffness, positive Kernig and Brudzinski signs, photophobia, GCS 14.", "Belirgin ense sertliği, pozitif Kernig ve Brudzinski, fotofobi, GKS 14."), _ex("skin", _SKIN, "Scattered non-blanching petechiae on the shins and trunk.", "Bacak ön yüzlerinde ve gövdede dağınık basmakla solmayan peteşiler.")],
    "status_epilepticus": [_ex("neurological", _NEURO, "Ongoing generalised tonic-clonic activity, eyes deviated upward, tongue bitten; pupils equal.", "Devam eden jeneralize tonik-klonik aktivite, gözler yukarı deviye, dil ısırılmış; pupiller eşit."), _ex("general-inspection", _GEN, "Cyanosed lips, frothy saliva, incontinent.", "Siyanoze dudaklar, köpüklü salya, inkontinans.")],
    "appendicitis": [_ex("abdominal", _ABD, "Tenderness and guarding at McBurney point, positive Rovsing sign, rebound present; bowel sounds reduced.", "McBurney noktasında hassasiyet ve defans, pozitif Rovsing, rebound var; bağırsak sesleri azalmış."), _ex("general-inspection", _GEN, "Lying still, flushed, prefers the right hip flexed.", "Hareketsiz yatıyor, kızarık, sağ kalçayı fleksiyonda tutmayı tercih ediyor.")],
    "pancreatitis": [_ex("abdominal", _ABD, "Epigastric tenderness with voluntary guarding, no peritonism; bowel sounds sparse; no Cullen or Grey Turner sign.", "Epigastrik hassasiyet ve istemli defans, peritonizm yok; bağırsak sesleri seyrek; Cullen veya Grey Turner yok."), _ex("general-inspection", _GEN, "Restless, dehydrated mucosae, mild scleral icterus.", "Huzursuz, kuru mukozalar, hafif skleral ikter.")],
    "upper_gi_bleed": [_ex("abdominal", _ABD, "Mild epigastric tenderness, no peritonism; melaena on rectal examination.", "Hafif epigastrik hassasiyet, peritonizm yok; rektal muayenede melena."), _ex("general-inspection", _GEN, "Pale conjunctivae, cool peripheries, capillary refill 4 s; postural dizziness.", "Soluk konjonktivalar, soğuk ekstremiteler, kapiller dolum 4 s; postural baş dönmesi.")],
    "cholecystitis": [_ex("abdominal", _ABD, "Right upper quadrant tenderness with inspiratory arrest on palpation (Murphy positive); no jaundice.", "Palpasyonda inspiratuar duraklamayla sağ üst kadran hassasiyeti (Murphy pozitif); sarılık yok."), _ex("general-inspection", _GEN, "Febrile, flushed, obese.", "Ateşli, kızarık, obez.")],
    "ascending_cholangitis": [_ex("abdominal", _ABD, "Right upper quadrant tenderness, no mass; liver edge not palpable.", "Sağ üst kadran hassasiyeti, kitle yok; karaciğer kenarı ele gelmiyor."), _ex("general-inspection", _GEN, "Jaundiced sclerae, rigors, confused.", "İkterik skleralar, titreme, konfüze.")],
    "bowel_obstruction": [_ex("abdominal", _ABD, "Distended tympanic abdomen with visible peristalsis, high-pitched tinkling bowel sounds; old midline scar; empty rectum.", "Görünür peristaltizmle distandü timpanik karın, tiz çınlayan bağırsak sesleri; eski orta hat skarı; rektum boş."), _ex("general-inspection", _GEN, "Dry mucous membranes, faeculent vomitus at the bedside.", "Kuru mukozalar, yatak başında fekaloid kusmuk.")],
    "dka": [_ex("general-inspection", _GEN, "Deep sighing (Kussmaul) respirations, ketotic breath, dry mucosae, reduced skin turgor.", "Derin iç çekme (Kussmaul) solunumu, ketotik nefes kokusu, kuru mukozalar, azalmış turgor."), _ex("abdominal", _ABD, "Diffuse mild tenderness without guarding.", "Defans olmadan yaygın hafif hassasiyet.")],
    "hhs": [_ex("neurological", _NEURO, "Drowsy, GCS 13, slow to respond; no focal deficit.", "Uykulu, GKS 13, yanıtı yavaş; fokal defisit yok."), _ex("general-inspection", _GEN, "Profoundly dry mucosae, sunken eyes, capillary refill 4 s.", "Çok kuru mukozalar, çökük gözler, kapiller dolum 4 s.")],
    "hyperkalemia": [_ex("neurological", _NEURO, "Symmetrical proximal weakness 4/5, reduced reflexes.", "Simetrik proksimal güçsüzlük 4/5, azalmış refleksler."), _ex("cardiovascular", _CV, "Slow irregular pulse around 50/min.", "Yaklaşık 50/dk yavaş düzensiz nabız.")],
    "hyperkalemia_esrd": [_ex("cardiovascular", _CV, "Slow pulse, raised JVP, bibasal crackles; working arteriovenous fistula at the left forearm.", "Yavaş nabız, yüksek JVP, bibazal raller; sol ön kolda çalışan arteriyovenöz fistül."), _ex("neurological", _NEURO, "Generalised weakness, reflexes reduced.", "Yaygın güçsüzlük, refleksler azalmış.")],
    "thyroid_storm": [_ex("general-inspection", _GEN, "Agitated, sweating, warm peripheries, fine tremor; diffuse goitre with bruit; lid lag.", "Ajite, terli, sıcak ekstremiteler, ince tremor; üfürümlü diffüz guatr; göz kapağı gecikmesi."), _ex("cardiovascular", _CV, "Irregular rapid pulse, bounding; bibasal crackles.", "Düzensiz hızlı dolgun nabız; bibazal raller.")],
    "hypoglycemia": [_ex("neurological", _NEURO, "Confused and tremulous, slurred speech, no focal deficit.", "Konfüze ve titrek, peltek konuşma, fokal defisit yok."), _ex("general-inspection", _GEN, "Cold and clammy, pale.", "Soğuk ve nemli, soluk.")],
    "adrenal_crisis": [_ex("general-inspection", _GEN, "Hyperpigmented palmar creases and buccal mucosa; dry mucosae; postural drop of 30 mmHg.", "Hiperpigmente avuç içi çizgileri ve bukkal mukoza; kuru mukozalar; 30 mmHg postural düşüş."), _ex("abdominal", _ABD, "Diffuse tenderness, no guarding.", "Yaygın hassasiyet, defans yok.")],
    "nec_fasciitis": [_ex("skin", _SKIN, "Tense, woody induration of the thigh with pain far beyond the erythema; dusky patches, crepitus and a haemorrhagic bulla.", "Uylukta gergin, odunsu endürasyon, eritemin çok ötesinde ağrı; koyu alanlar, krepitasyon ve hemorajik bül."), _ex("general-inspection", _GEN, "Toxic, tachycardic, confused.", "Toksik görünüm, taşikardik, konfüze.")],
    "pyelonephritis": [_ex("abdominal", _ABD, "Right renal angle tenderness; suprapubic tenderness; no peritonism.", "Sağ renal açı hassasiyeti; suprapubik hassasiyet; peritonizm yok."), _ex("general-inspection", _GEN, "Rigors, flushed, febrile.", "Titreme, kızarık, ateşli.")],
    "meningococcemia": [_ex("skin", _SKIN, "Rapidly spreading purpuric rash on the trunk and limbs that does not blanch under a glass.", "Gövde ve ekstremitelerde hızla yayılan, bardak altında solmayan purpurik döküntü."), _ex("general-inspection", _GEN, "Cold mottled extremities, capillary refill 5 s, drowsy.", "Soğuk alacalı ekstremiteler, kapiller dolum 5 s, uykulu.")],
    "aki": [_ex("abdominal", _ABD, "Palpable, tender bladder to the umbilicus; enlarged smooth prostate on rectal examination.", "Göbeğe kadar ele gelen hassas mesane; rektal muayenede büyük düzgün prostat."), _ex("general-inspection", _GEN, "Mild bilateral ankle oedema; dry mucosae.", "Hafif bilateral ayak bileği ödemi; kuru mukozalar.")],
    "renal_colic": [_ex("abdominal", _ABD, "Left loin tenderness, soft abdomen, no peritonism; writhing, unable to lie still.", "Sol lomber hassasiyet, yumuşak karın, peritonizm yok; kıvranıyor, hareketsiz yatamıyor."), _ex("general-inspection", _GEN, "Pale, sweaty, afebrile.", "Soluk, terli, ateşsiz.")],
    "alcohol_withdrawal": [_ex("neurological", _NEURO, "Coarse tremor, sweating, agitated, visual hallucinations; no focal deficit.", "Kaba tremor, terleme, ajite, görsel halüsinasyonlar; fokal defisit yok."), _ex("abdominal", _ABD, "Hepatomegaly 3 cm, spider naevi on the chest.", "3 cm hepatomegali, göğüste spider nevüsler.")],
    "opioid_overdose": [_ex("neurological", _NEURO, "GCS 7 (E1 V2 M4), pinpoint pupils, hyporeflexic.", "GKS 7 (E1 V2 M4), iğne başı pupiller, hiporefleksik."), _ex("respiratory", _RESP, "Slow shallow breaths 6/min, cyanosed, snoring respiration.", "Dakikada 6 yavaş yüzeysel solunum, siyanoze, horultulu solunum.")],
    "paracetamol_od": [_ex("abdominal", _ABD, "Mild right upper quadrant tenderness, no jaundice yet.", "Hafif sağ üst kadran hassasiyeti, henüz sarılık yok."), _ex("general-inspection", _GEN, "Tearful but alert, GCS 15; no signs of other ingestion.", "Ağlamaklı ama uyanık, GKS 15; başka alım bulgusu yok.")],
    "ectopic_pregnancy": [_ex("abdominal", _ABD, "Left iliac fossa tenderness with guarding; cervical motion tenderness; closed os, dark spotting.", "Sol iliyak fossa hassasiyeti ve defans; servikal hareket hassasiyeti; kapalı os, koyu lekelenme."), _ex("general-inspection", _GEN, "Pale, tachycardic, postural dizziness.", "Soluk, taşikardik, postural baş dönmesi.")],
    "preeclampsia": [_ex("neurological", _NEURO, "Brisk reflexes with three beats of ankle clonus; visual fields full.", "Üç vuru ayak bileği klonusuyla canlı refleksler; görme alanları tam."), _ex("abdominal", _ABD, "Right upper quadrant tenderness; fundus appropriate for dates; non-dependent oedema of hands and face.", "Sağ üst kadran hassasiyeti; fundus gebelik haftasına uygun; el ve yüzde ödem.")],
    "pph": [_ex("abdominal", _ABD, "Uterus soft and boggy above the umbilicus, not contracting with massage; ongoing bright red loss.", "Göbek üstünde yumuşak, gevşek uterus, masajla kasılmıyor; devam eden parlak kırmızı kanama."), _ex("general-inspection", _GEN, "Pale, clammy, anxious, capillary refill 4 s.", "Soluk, nemli, anksiyöz, kapiller dolum 4 s.")],
    "cauda_equina": [_ex("neurological", _NEURO, "Reduced perianal sensation, lax anal tone, absent ankle reflexes, bilateral leg weakness 3/5; palpable bladder.", "Azalmış perianal duyu, gevşek anal tonus, ayak bileği refleksleri yok, bilateral bacak güçsüzlüğü 3/5; ele gelen mesane."), _ex("musculoskeletal", _MSK, "Lumbar paraspinal tenderness, straight-leg raise positive bilaterally.", "Lomber paraspinal hassasiyet, bilateral pozitif düz bacak kaldırma.")],
    "compartment_syndrome": [_ex("musculoskeletal", _MSK, "Tense, swollen anterior compartment under the split cast; severe pain on passive toe extension; paraesthesia in the first web space; pulses present.", "Açılmış alçı altında gergin, şiş anterior kompartman; pasif parmak ekstansiyonunda şiddetli ağrı; birinci web aralığında parestezi; nabızlar var."), _ex("general-inspection", _GEN, "Distressed, pain unrelieved by opioid.", "Sıkıntılı, opioidle geçmeyen ağrı.")],
    "febrile_neutropenia": [_ex("general-inspection", _GEN, "Febrile 38.9C, rigors, PICC line site clean; no mucositis; no localising source.", "Ateş 38.9C, titreme, PICC giriş yeri temiz; mukozit yok; lokalize kaynak yok."), _ex("respiratory", _RESP, "Clear chest.", "Akciğerler temiz.", False)],
    "dvt": [_ex("musculoskeletal", _MSK, "Left calf swollen 4 cm more than the right, warm, tender along the popliteal vein; pitting oedema to the knee.", "Sol baldır sağdan 4 cm geniş, sıcak, popliteal ven boyunca hassas; dize kadar gode bırakan ödem."), _ex("respiratory", _RESP, "Clear chest, not tachypnoeic.", "Akciğerler temiz, takipne yok.", False)],
    "sickle_crisis": [_ex("musculoskeletal", _MSK, "Tenderness over both femurs and the lumbar spine without swelling or erythema.", "Her iki femur ve lomber omurgada şişlik veya eritem olmadan hassasiyet."), _ex("respiratory", _RESP, "Clear chest, no crackles; SpO2 96% on air.", "Akciğerler temiz, ral yok; oda havasında SpO2 %96.", False)],
    "bronchiolitis": [_ex("respiratory", _RESP, "Subcostal and intercostal recession, nasal flaring, widespread fine crackles and wheeze; RR 62.", "Subkostal ve interkostal çekilmeler, burun kanadı solunumu, yaygın ince raller ve hırıltı; SS 62."), _ex("general-inspection", _GEN, "Coryzal, feeding poorly, capillary refill 2 s, fontanelle normal.", "Nezleli, kötü besleniyor, kapiller dolum 2 s, fontanel normal.")],
    "anaphylaxis": [_ex("skin", _SKIN, "Generalised urticaria, swelling of the lips and periorbital tissues.", "Yaygın ürtiker, dudaklarda ve periorbital dokuda şişlik."), _ex("respiratory", _RESP, "Audible stridor, hoarse voice, widespread wheeze.", "İşitilebilir stridor, boğuk ses, yaygın hırıltı.")],
    "septic_shock": [_ex("general-inspection", _GEN, "Mottled cool peripheries, capillary refill 5 s, confused (GCS 13), rigors.", "Alacalı soğuk ekstremiteler, kapiller dolum 5 s, konfüze (GKS 13), titreme."), _ex("abdominal", _ABD, "Suprapubic tenderness and left renal angle tenderness.", "Suprapubik hassasiyet ve sol renal açı hassasiyeti.")],
    "heat_stroke": [_ex("neurological", _NEURO, "Confused, ataxic, GCS 13; no focal deficit.", "Konfüze, ataksik, GKS 13; fokal defisit yok."), _ex("skin", _SKIN, "Hot flushed skin, dry despite exertion.", "Sıcak kızarık cilt, efora rağmen kuru.")],
    "hypothermia": [_ex("general-inspection", _GEN, "Cold to the core, no shivering, slow speech; GCS 12.", "Merkezi soğuk, titreme yok, yavaş konuşma; GKS 12."), _ex("cardiovascular", _CV, "Slow, barely palpable pulse; cold peripheries.", "Yavaş, zar zor hissedilen nabız; soğuk ekstremiteler.")],
    "testicular_torsion": [_ex("focused-special", ("Genitourinary", "Genitoüriner"), "High-riding, horizontally lying tender left testis; absent cremasteric reflex; no relief on elevation.", "Yüksek yerleşimli, yatay duran hassas sol testis; kremaster refleksi yok; elevasyonla rahatlama yok."), _ex("abdominal", _ABD, "Soft abdomen, no hernia.", "Yumuşak karın, fıtık yok.", False)],
    "panic_disorder": [_ex("cardiovascular", _CV, "Regular tachycardia, no murmur, chest wall non-tender.", "Düzenli taşikardi, üfürüm yok, göğüs duvarı hassas değil.", False), _ex("general-inspection", _GEN, "Hyperventilating, tremulous, carpopedal spasm.", "Hiperventile, titrek, karpopedal spazm.")],
}



# =========================================================================== #
# Febrile families: acceptance test 2026-10-20 (docs/review/05), D-18 / D-12  #
#                                                                              #
# D-18 (critical): the sepsis template treated "A-to-E assessment" and          #
# "analgesia" as the indicated actions, septic shock inherited the emergency    #
# default, influenza and COVID-19 rewarded antibiotics, and acute prostatitis   #
# inherited the renal hyperkalaemia profile (K 6.1). Each febrile condition    #
# below gets its own labs, imaging and treatment table: cultures before        #
# antibiotics, crystalloid (30 mL/kg where there is hypotension or lactate 4   #
# or more), the guideline antibiotic with its allergy alternative named, an    #
# antipyretic, source control, and one contraindicated distractor. Effect      #
# onsets follow normalize.TREATMENT_CLASSES (fluids 5-30 min, paracetamol      #
# 30 min-2 h, antibiotics move no vital inside a session).                     #
#                                                                              #
# Sources (adult):                                                             #
#  SSC 2021 (Evans et al., Crit Care Med 2021;49:e1063,                        #
#    doi 10.1097/CCM.0000000000005337): blood cultures before antimicrobials,   #
#    antimicrobials within 1 h, at least 30 mL/kg crystalloid in 3 h for       #
#    hypoperfusion, source control within 6 h, no starches.                    #
#  NICE NG253 sepsis (https://www.nice.org.uk/guidance/ng253), NICE NG250 CAP, #
#    NG111 pyelonephritis, NG110 prostatitis, NG141 cellulitis, NG240          #
#    meningitis, NG191 COVID-19, CG151 neutropenic sepsis.                     #
#  IDSA: Stevens et al. 2014 SSTI (doi 10.1093/cid/ciu296); ATS/IDSA 2019 CAP  #
#    (Metlay et al., doi 10.1164/rccm.201908-1581ST).                          #
#  Tokyo Guidelines 2018 cholangitis antimicrobials (Gomi et al.,              #
#    doi 10.1002/jhbp.518) and drainage (Miura et al., doi 10.1002/jhbp.509).  #
#  BSR/BOA hot swollen joint (Coakley et al., Rheumatology 2006;45:1039,       #
#    doi 10.1093/rheumatology/kel163): aspirate before antibiotics,            #
#    flucloxacillin, clindamycin if penicillin allergic, no intra-articular    #
#    steroid.                                                                  #
#  WHO Guidelines for malaria                                                  #
#    (https://www.who.int/publications/i/item/guidelines-for-malaria) and the  #
#    CDC malaria algorithm: IV artesunate 2.4 mg/kg at 0, 12, 24 h for severe  #
#    malaria, repeat films every 12-24 h.                                      #
#  CDC influenza antivirals summary: oseltamivir 75 mg twice daily as soon as  #
#    possible in hospitalised patients.                                        #
#  CDC STI 2021 PID: ceftriaxone + doxycycline + metronidazole; clindamycin +  #
#    gentamicin as the alternative.                                            #
#  EAU Urological Infections 2024                                              #
#    (https://uroweb.org/guidelines/urological-infections): prostatic massage  #
#    is contraindicated in acute bacterial prostatitis.                        #
#  BHIVA/BASHH/BIA UK HIV testing 2020 (https://www.bhiva.org/HIV-testing-guidelines). #
# =========================================================================== #
_CULT = ("cultures", "Blood cultures (2 sets) before antibiotics", "Antibiyotik öncesi kan kültürü (2 set)", "indicated", [],
         "Culture first when it does not delay the antibiotic (SSC 2021).", "Antibiyotiği geciktirmiyorsa önce kültür alın (SSC 2021).")
_PCM = ("antipyretic", "Paracetamol 1 g for fever and discomfort", "Ateş ve rahatsızlık için parasetamol 1 g", "indicated",
        [("tempC", -0.8, 2700000)], "Antipyresis for comfort; it treats no infection and does not replace antibiotics.",
        "Rahatlık için ateş düşürme; enfeksiyonu tedavi etmez ve antibiyotiğin yerini tutmaz.")


def _fluids(label_en: str, label_tr: str, sbp: float, hr: float) -> tuple:
    return ("iv_fluids", label_en, label_tr, "indicated", [("systolic", sbp, 900000), ("hr", -hr, 900000)],
            "Crystalloid restores perfusion; reassess after each bolus.", "Kristaloid perfüzyonu düzeltir; her bolustan sonra yeniden değerlendirin.")


FEBRILE_FIXTURES: dict[str, dict[str, Any]] = {
    "sepsis_uncomplicated": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 15.2, "10^9/L", 4.0, 11.0, "H", "haematology", 1.5),
            ("1988-5", "C-reactive protein", "CRP", 160, "mg/L", 0, 5, "H", "chemistry", 20),
            ("2524-7", "Lactate", "Laktat", 2.8, "mmol/L", 0.5, 2.0, "H", "blood-gas", 0.3),
            ("2160-0", "Creatinine", "Kreatinin", 1.4, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.1),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "No focal consolidation, effusion or free air; the chest is not the source.",
                    "Fokal konsolidasyon, efüzyon veya serbest hava yok; kaynak akciğer değil.",
                    "chest x-ray normal lungs", "akciğer grafisi normal"),
        "treatments": [
            _CULT,
            ("abx", "Broad-spectrum IV antibiotics within 1 hour (local sepsis policy, e.g. piperacillin-tazobactam; meropenem or vancomycin + gentamicin if penicillin anaphylaxis)",
             "1 saat içinde geniş spektrumlu IV antibiyotik (yerel sepsis protokolü, örn. piperasilin-tazobaktam; penisilin anafilaksisinde meropenem veya vankomisin + gentamisin)",
             "indicated", [], "Antimicrobials within the hour; they do not move the vitals within the session.", "İlk saatte antimikrobiyal; vitalleri seans içinde değiştirmez."),
            _fluids("IV crystalloid 500 mL bolus, reassess (30 mL/kg if hypotensive or lactate 4 or more)",
                    "500 mL IV kristaloid bolus, yeniden değerlendir (hipotansif veya laktat 4 ve üzeriyse 30 mL/kg)", 6.0, 6.0),
            _PCM,
            ("source_search", "Look for a source needing control (urine, chest, abdomen, skin, lines)", "Kontrol gerektiren kaynağı ara (idrar, akciğer, karın, cilt, kateterler)", "indicated", [],
             "Identify a drainable source early (SSC 2021: source control within 6 h).", "Drene edilebilir kaynağı erken saptayın (SSC 2021: 6 saat içinde kaynak kontrolü)."),
            ("delay_abx", "Delay antibiotics until all results are back", "Tüm sonuçlar çıkana kadar antibiyotiği ertele", "contraindicated", [],
             "Do not delay antimicrobials in probable sepsis (target within 1 hour).", "Olası sepsiste antimikrobiyali geciktirmeyin (hedef 1 saat içinde)."),
        ],
        "guide": ("SSC", "Surviving Sepsis Campaign 2021", "Take blood cultures, then give antimicrobials within 1 hour of recognising probable sepsis, and give at least 30 mL/kg crystalloid for hypotension or a lactate of 4 mmol/L or more.",
                  "Kan kültürünü alın, olası sepsis tanındıktan sonra 1 saat içinde antimikrobiyal verin ve hipotansiyon veya 4 mmol/L ve üzeri laktatta en az 30 mL/kg kristaloid verin."),
    },
    "septic_shock": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 18.6, "10^9/L", 4.0, 11.0, "H", "haematology", 1.5),
            ("2524-7", "Lactate", "Laktat", 5.4, "mmol/L", 0.5, 2.0, "HH", "blood-gas", 0.5),
            ("2160-0", "Creatinine", "Kreatinin", 2.1, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.2),
            ("777-3", "Platelets", "Trombosit", 104, "10^9/L", 150, 400, "L", "haematology", 10),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Clear lung fields; no consolidation.",
                    "Akciğer alanları temiz; konsolidasyon yok.",
                    "chest x-ray normal lungs", "akciğer grafisi normal"),
        "treatments": [
            _CULT,
            ("abx", "Broad-spectrum IV antibiotics immediately (within 1 hour; meropenem or vancomycin + gentamicin if penicillin anaphylaxis)",
             "Hemen geniş spektrumlu IV antibiyotik (1 saat içinde; penisilin anafilaksisinde meropenem veya vankomisin + gentamisin)",
             "indicated", [], "Every hour of delay in shock raises mortality; no vital change within the session.", "Şokta her saatlik gecikme mortaliteyi artırır; seans içinde vital değişmez."),
            _fluids("IV crystalloid 30 mL/kg within 3 hours, given as boluses with reassessment", "3 saat içinde bolus halinde 30 mL/kg IV kristaloid, aralarda yeniden değerlendirme", 14.0, 10.0),
            ("vasopressor", "Noradrenaline to a MAP of 65 mmHg if hypotension persists after fluids", "Sıvıya rağmen hipotansiyon sürerse OAB 65 mmHg hedefiyle noradrenalin", "indicated",
             [("systolic", 18.0, 600000), ("diastolic", 10.0, 600000)], "First-line vasopressor; peripheral start is acceptable while access is secured.", "Birinci basamak vazopresör; damar yolu sağlanırken periferden başlanabilir."),
            ("source_control", "Source control within 6 hours (urinary obstruction, collection, infected line)", "6 saat içinde kaynak kontrolü (üriner obstrüksiyon, koleksiyon, enfekte kateter)", "indicated", [],
             "Drain or remove the source early (SSC 2021).", "Kaynağı erken drene edin veya çıkarın (SSC 2021)."),
            _PCM,
            ("starch", "Hydroxyethyl starch for volume resuscitation", "Volüm resüsitasyonu için hidroksietil nişasta", "contraindicated", [],
             "SSC 2021 recommends against starches (kidney injury, mortality).", "SSC 2021 nişastaları önermez (böbrek hasarı, mortalite)."),
        ],
        "guide": ("SSC", "Surviving Sepsis Campaign 2021", "In septic shock give antimicrobials immediately, at least 30 mL/kg crystalloid in 3 hours and noradrenaline to a MAP of 65 mmHg.",
                  "Septik şokta hemen antimikrobiyal, 3 saatte en az 30 mL/kg kristaloid ve OAB 65 mmHg hedefiyle noradrenalin verin."),
    },
    "pneumonia_cap": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 15.8, "10^9/L", 4.0, 11.0, "H", "haematology", 1.5),
            ("1988-5", "C-reactive protein", "CRP", 180, "mg/L", 0, 5, "H", "chemistry", 15),
            ("22664-7", "Urea", "Üre", 9.2, "mmol/L", 2.5, 7.1, "H", "chemistry", 0.5),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Right lower lobe consolidation with an air bronchogram; no effusion.",
                    "Sağ alt lobda hava bronkogramlı konsolidasyon; efüzyon yok.",
                    "pneumonia chest x-ray consolidation", "pnömoni akciğer grafisi konsolidasyon"),
        "treatments": [
            _CULT,
            ("severity_abx", "Antibiotics within 4 hours guided by CURB-65 (high severity: co-amoxiclav + clarithromycin; levofloxacin if penicillin allergy)",
             "CURB-65'e göre 4 saat içinde antibiyotik (yüksek ağırlık: ko-amoksiklav + klaritromisin; penisilin alerjisinde levofloksasin)",
             "indicated", [], "Choose by severity (NICE NG250); defervescence takes days, not minutes.", "Ağırlığa göre seçin (NICE NG250); ateş dakikalar değil günler içinde düşer."),
            ("oxygen", "Controlled oxygen to SpO2 94-98% (88-92% if at risk of hypercapnia)", "SpO2 %94-98 hedefli kontrollü oksijen (hiperkapni riskinde %88-92)", "indicated",
             [("spo2", 3.0, 300000)], "Titrated oxygen for hypoxaemia (BTS 2017).", "Hipoksemide titre edilen oksijen (BTS 2017)."),
            _fluids("IV crystalloid bolus if hypotensive or dry", "Hipotansif veya dehidrateyse IV kristaloid bolus", 6.0, 5.0),
            _PCM,
            ("delay_abx", "Delay antibiotics pending sputum culture", "Balgam kültürü için antibiyotiği ertele", "contraindicated", [],
             "Do not delay antibiotics in pneumonia (NICE NG250: within 4 hours).", "Pnömonide antibiyotiği geciktirmeyin (NICE NG250: 4 saat içinde)."),
        ],
        "guide": ("NICE", "NICE NG250 Pneumonia (2025)", "Assess severity with CURB-65 and give antibiotics within 4 hours of diagnosis, within 1 hour if sepsis is suspected.",
                  "Ağırlığı CURB-65 ile değerlendirin; antibiyotiği tanıdan sonra 4 saat içinde, sepsis şüphesinde 1 saat içinde verin."),
    },
    "pyelonephritis": {
        "labs": [
            ("5799-2", "Urinalysis (leucocytes/nitrites)", "İdrar (lökosit/nitrit)", "positive", "", None, None, "H", "urinalysis"),
            ("6690-2", "White cell count", "Lökosit", 15.0, "10^9/L", 4.0, 11.0, "H", "haematology", 1.2),
            ("1988-5", "C-reactive protein", "CRP", 110, "mg/L", 0, 5, "H", "chemistry", 10),
            ("2160-0", "Creatinine", "Kreatinin", 1.2, "mg/dL", 0.6, 1.3, "N", "chemistry", 0.1),
        ],
        "imaging": ("24558-9", "Renal ultrasound", "Renal ultrason",
                    "No hydronephrosis or collection; kidneys normal in size.",
                    "Hidronefroz veya koleksiyon yok; böbrek boyutları normal.",
                    "pyelonephritis ultrasound obstruction", "piyelonefrit ultrason obstrüksiyon"),
        "treatments": [
            ("cultures", "Midstream urine and blood cultures before antibiotics", "Antibiyotik öncesi orta akım idrar ve kan kültürü", "indicated", [],
             "Culture before the first dose (NICE NG111).", "İlk dozdan önce kültür (NICE NG111)."),
            ("iv_abx_fluids", "IV antibiotics + fluids (ceftriaxone or cefuroxime; gentamicin if beta-lactam allergy)",
             "IV antibiyotik + sıvı (seftriakson veya sefuroksim; beta-laktam alerjisinde gentamisin)", "indicated", [("hr", -6.0, 900000)],
             "Empirical antibiotics (NICE NG111) and rehydration.", "Ampirik antibiyotik (NICE NG111) ve rehidrasyon."),
            _PCM,
            ("drain_obstruction", "Urgent decompression if obstructed and infected", "Tıkalı ve enfekteyse acil dekompresyon", "indicated", [],
             "An obstructed infected kidney needs drainage (source control).", "Tıkalı enfekte böbrek drenaj gerektirir (kaynak kontrolü)."),
            ("delay_obstructed", "Delay drainage of an obstructed infected kidney", "Tıkalı enfekte böbreğin drenajını ertele", "contraindicated", [],
             "Obstructed infection needs urgent drainage.", "Tıkalı enfeksiyon acil drenaj gerektirir."),
        ],
        "guide": ("NICE", "NICE NG111 Pyelonephritis (acute)", "Send a midstream urine for culture before antibiotics and choose the agent on severity; review when culture results are available.",
                  "Antibiyotikten önce orta akım idrarı kültüre gönderin ve ajanı ağırlığa göre seçin; kültür sonucu çıkınca gözden geçirin."),
    },
    "bacterial_meningitis": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 19.4, "10^9/L", 4.0, 11.0, "H", "haematology", 1.5),
            ("1988-5", "C-reactive protein", "CRP", 210, "mg/L", 0, 5, "H", "chemistry", 20),
            ("30405-5", "CSF white cells (neutrophilic)", "BOS lökosit (nötrofilik)", 2200, "10^6/L", 0, 5, "HH", "csf", 200),
            ("2342-4", "CSF glucose (low)", "BOS glukozu (düşük)", 1.6, "mmol/L", 2.8, 4.2, "L", "csf", 0.2),
        ],
        "imaging": ("30799-1", "CT head (if indicated before LP)", "LP öncesi endike ise beyin BT",
                    "No mass lesion, no effacement of the basal cisterns.", "Kitle lezyonu yok, bazal sisternlerde silinme yok.",
                    "meningitis CT before lumbar puncture", "menenjit LP öncesi BT"),
        "treatments": [
            ("blood_cultures", "Blood cultures (and LP only if safe without delaying antibiotics)", "Kan kültürü (LP yalnızca antibiyotiği geciktirmeyecekse ve güvenliyse)", "indicated", [],
             "Cultures without delaying antibiotics (NICE NG240).", "Antibiyotiği geciktirmeden kültür (NICE NG240)."),
            ("immediate_ceftriaxone", "Immediate IV antibiotics: ceftriaxone 2 g + dexamethasone (chloramphenicol if severe beta-lactam allergy)",
             "Hemen IV antibiyotik: seftriakson 2 g + deksametazon (ağır beta-laktam alerjisinde kloramfenikol)", "indicated", [],
             "Antibiotics within 1 hour of arrival; do not wait for CT or LP.", "Varıştan sonraki 1 saat içinde antibiyotik; BT veya LP beklemeyin."),
            _PCM,
            ("delay_abx_imaging", "Delay antibiotics for imaging", "Görüntüleme için antibiyotiği ertele", "contraindicated", [],
             "Never delay antibiotics for imaging.", "Antibiyotiği görüntüleme için asla geciktirmeyin."),
        ],
        "guide": ("NICE", "NICE NG240 Meningitis (bacterial) and meningococcal disease", "Start antibiotics within 1 hour of arrival with suspected bacterial meningitis, with dexamethasone; do blood tests and LP first only if safe and without delay.",
                  "Şüpheli bakteriyel menenjitte varıştan sonraki 1 saat içinde deksametazonla antibiyotik başlayın; kan ve LP'yi yalnızca güvenli ve gecikmesizse önce yapın."),
    },
    "cellulitis": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 12.8, "10^9/L", 4.0, 11.0, "H", "haematology", 1.0),
            ("1988-5", "C-reactive protein", "CRP", 85, "mg/L", 0, 5, "H", "chemistry", 10),
            ("2160-0", "Creatinine", "Kreatinin", 0.9, "mg/dL", 0.6, 1.3, "N", "chemistry", 0.1),
        ],
        "imaging": ("us-dvt", "Lower-limb venous Doppler (if DVT is a concern)", "Alt ekstremite venöz Doppler (DVT şüphesinde)",
                    "Veins compressible, no DVT; subcutaneous oedema only.", "Venler basıyla kapanıyor, DVT yok; yalnızca cilt altı ödem.",
                    "leg ultrasound subcutaneous oedema", "bacak ultrasonu cilt altı ödem"),
        "treatments": [
            ("mark_margin", "Mark the edge of the erythema before the first dose", "İlk dozdan önce eritem sınırını işaretle", "indicated", [],
             "Lets the next clinician see spread or response (NICE NG141).", "Sonraki hekimin yayılımı veya yanıtı görmesini sağlar (NICE NG141)."),
            ("abx_cellulitis", "Flucloxacillin (clarithromycin or doxycycline if penicillin allergy); IV if severe or systemically unwell",
             "Flukloksasilin (penisilin alerjisinde klaritromisin veya doksisiklin); ağır veya sistemik hastaysa IV", "indicated", [],
             "NICE NG141 first choice; redness settles over days.", "NICE NG141 ilk tercih; kızarıklık günler içinde geriler."),
            _PCM,
            ("swab_delay", "Withhold antibiotics until a skin swab result is back", "Cilt sürüntüsü sonucu gelene kadar antibiyotiği beklet", "contraindicated", [],
             "Intact-skin cellulitis is a clinical diagnosis; swabs do not guide the first dose.", "Sağlam cilt enfeksiyonu klinik tanıdır; sürüntü ilk dozu yönlendirmez."),
        ],
        "guide": ("NICE", "NICE NG141 Cellulitis and erysipelas", "Mark the extent of infection, then offer flucloxacillin; clarithromycin or doxycycline if penicillin allergic.",
                  "Enfeksiyonun sınırını işaretleyin, ardından flukloksasilin önerin; penisilin alerjisinde klaritromisin veya doksisiklin."),
    },
    "ascending_cholangitis": {
        "labs": [
            ("1975-2", "Total bilirubin", "Total bilirubin", 5.8, "mg/dL", 0.2, 1.2, "H", "chemistry", 0.5),
            ("6768-6", "Alkaline phosphatase", "ALP", 420, "U/L", 40, 130, "H", "chemistry", 30),
            ("6690-2", "White cell count", "Lökosit", 17.0, "10^9/L", 4.0, 11.0, "H", "haematology", 1.5),
            ("1988-5", "C-reactive protein", "CRP", 190, "mg/L", 0, 5, "H", "chemistry", 15),
        ],
        "imaging": ("24558-9", "US / MRCP of the biliary tree", "Safra yolu US / MRCP",
                    "Common bile duct dilated to 11 mm with an obstructing stone; gallstones.",
                    "Tıkayıcı taşla 11 mm genişlemiş koledok; safra taşları.",
                    "cholangitis MRCP dilated ducts", "kolanjit MRCP genişlemiş kanal"),
        "treatments": [
            _CULT,
            ("abx_fluids", "IV antibiotics + fluids (piperacillin-tazobactam; levofloxacin + metronidazole if penicillin anaphylaxis)",
             "IV antibiyotik + sıvı (piperasilin-tazobaktam; penisilin anafilaksisinde levofloksasin + metronidazol)", "indicated", [("systolic", 8.0, 900000)],
             "Tokyo 2018 antimicrobials and resuscitation; fluids, not antibiotics, move the vitals this hour.", "Tokyo 2018 antimikrobiyalleri ve resüsitasyon; bu saatte vitalleri antibiyotik değil sıvı değiştirir."),
            ("biliary_drainage", "Urgent biliary drainage (ERCP)", "Acil biliyer drenaj (ERCP)", "indicated", [],
             "Decompress the obstructed duct (source control).", "Tıkalı kanalı dekomprese edin (kaynak kontrolü)."),
            _PCM,
            ("delay_drainage", "Delay drainage in septic patient", "Septik hastada drenajı ertele", "contraindicated", [],
             "Do not delay drainage in biliary sepsis.", "Biliyer sepsiste drenajı geciktirmeyin."),
        ],
        "guide": ("Tokyo Guidelines", "Tokyo Guidelines 2018 (TG18) acute cholangitis", "Give antimicrobials and fluids, and arrange biliary drainage urgently for moderate or severe disease.",
                  "Antimikrobiyal ve sıvı verin; orta veya ağır hastalıkta acil biliyer drenaj planlayın."),
    },
    "septic_arthritis": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 13.6, "10^9/L", 4.0, 11.0, "H", "haematology", 1.0),
            ("1988-5", "C-reactive protein", "CRP", 140, "mg/L", 0, 5, "H", "chemistry", 15),
            ("3084-1", "Uric acid", "Ürik asit", 5.2, "mg/dL", 3.4, 7.0, "N", "chemistry", 0.4),
        ],
        "imaging": ("43468-8", "Plain radiograph of the knee", "Diz düz grafisi",
                    "Large effusion; no fracture, no chondrocalcinosis, joint space preserved.",
                    "Büyük efüzyon; kırık yok, kondrokalsinoz yok, eklem aralığı korunmuş.",
                    "knee x-ray effusion", "diz grafisi efüzyon"),
        "treatments": [
            ("joint_aspiration", "Aspirate the joint for Gram stain, culture and crystals before antibiotics", "Antibiyotik öncesi Gram boyama, kültür ve kristal için eklem aspirasyonu", "indicated", [],
             "Aspiration before antibiotics, unless it would delay them in sepsis (BSR 2006).", "Sepsiste geciktirmeyecekse antibiyotik öncesi aspirasyon (BSR 2006)."),
            _CULT,
            ("abx_joint", "IV flucloxacillin (clindamycin if penicillin allergy; vancomycin if MRSA risk)", "IV flukloksasilin (penisilin alerjisinde klindamisin; MRSA riskinde vankomisin)", "indicated", [],
             "Empirical anti-staphylococcal cover after aspiration.", "Aspirasyon sonrası ampirik anti-stafilokok tedavi."),
            ("washout", "Urgent orthopaedic washout", "Acil ortopedik yıkama", "indicated", [],
             "Source control: joint washout limits cartilage destruction.", "Kaynak kontrolü: eklem yıkaması kıkırdak hasarını sınırlar."),
            _PCM,
            ("ia_steroid", "Intra-articular corticosteroid injection", "Eklem içi kortikosteroid enjeksiyonu", "contraindicated", [],
             "Never inject steroid into a possibly infected joint.", "Enfekte olabilecek ekleme asla steroid enjekte etmeyin."),
        ],
        "guide": ("BSR", "BSR/BOA hot swollen joint guideline (2006)", "Aspirate a hot swollen joint before antibiotics, send for Gram stain, culture and crystals, then start empirical anti-staphylococcal antibiotics.",
                  "Sıcak şiş eklemi antibiyotik öncesi aspire edin, Gram boyama, kültür ve kristale gönderin, ardından ampirik anti-stafilokok antibiyotik başlayın."),
    },
    "malaria": {
        "labs": [
            ("32700-7", "Malaria thick and thin blood films", "Sıtma kalın ve ince yayma", "Plasmodium falciparum seen, parasitaemia 2%", "", None, None, "H", "haematology"),
            ("6690-2", "White cell count", "Lökosit", 5.6, "10^9/L", 4.0, 11.0, "N", "haematology", 0.8),
            ("777-3", "Platelets", "Trombosit", 64, "10^9/L", 150, 400, "L", "haematology", 8),
            ("718-7", "Haemoglobin", "Hemoglobin", 11.2, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
            ("1975-2", "Total bilirubin", "Total bilirubin", 2.4, "mg/dL", 0.2, 1.2, "H", "chemistry", 0.3),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Clear lung fields; no pulmonary oedema.", "Akciğer alanları temiz; pulmoner ödem yok.",
                    "chest x-ray normal lungs", "akciğer grafisi normal"),
        "treatments": [
            ("films", "Thick and thin films with a rapid diagnostic test now; repeat every 12-24 h if negative", "Hemen kalın ve ince yayma ile hızlı tanı testi; negatifse 12-24 saatte bir tekrar", "indicated", [],
             "Three negative film sets are needed to exclude the diagnosis (CDC).", "Tanıyı dışlamak için üç negatif yayma seti gerekir (CDC)."),
            ("artesunate", "IV artesunate 2.4 mg/kg at 0, 12 and 24 h for any severe feature (oral artemether-lumefantrine if uncomplicated)",
             "Herhangi bir ağır bulguda 0, 12 ve 24. saatte IV artesunat 2,4 mg/kg (komplike değilse oral artemeter-lumefantrin)", "indicated", [],
             "WHO first line for severe disease; parasite clearance takes hours to days.", "Ağır hastalıkta DSÖ birinci basamağı; parazit temizlenmesi saatler-günler sürer."),
            _PCM,
            ("discharge_one_film", "Discharge after a single negative film", "Tek negatif yaymadan sonra taburcu et", "contraindicated", [],
             "One negative film does not exclude the diagnosis.", "Tek negatif yayma tanıyı dışlamaz."),
        ],
        "guide": ("WHO", "WHO Guidelines for malaria", "Confirm with thick and thin films or an RDT; treat severe disease with IV artesunate, then complete an oral artemisinin-based course.",
                  "Kalın ve ince yayma veya hızlı testle doğrulayın; ağır hastalığı IV artesunatla tedavi edin, ardından oral artemisinin temelli kürü tamamlayın."),
    },
    "influenza": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 6.2, "10^9/L", 4.0, 11.0, "N", "haematology", 0.8),
            ("731-0", "Lymphocytes", "Lenfosit", 0.8, "10^9/L", 1.0, 4.0, "L", "haematology", 0.1),
            ("1988-5", "C-reactive protein", "CRP", 32, "mg/L", 0, 5, "H", "chemistry", 6),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "No consolidation; mild peribronchial thickening.", "Konsolidasyon yok; hafif peribronşiyal kalınlaşma.",
                    "chest x-ray normal lungs", "akciğer grafisi normal"),
        "treatments": [
            ("oseltamivir", "Oseltamivir 75 mg twice daily as soon as possible (admitted or high risk)", "Mümkün olan en kısa sürede günde iki kez oseltamivir 75 mg (yatan veya yüksek riskli)", "indicated", [],
             "CDC: start in hospitalised or high-risk patients as soon as possible.", "CDC: yatan veya yüksek riskli hastada mümkün olan en kısa sürede başlayın."),
            ("oxygen", "Controlled oxygen to SpO2 94-98% if hypoxic", "Hipoksikse SpO2 %94-98 hedefli kontrollü oksijen", "indicated",
             [("spo2", 3.0, 300000)], "Titrated oxygen (BTS 2017).", "Titre edilen oksijen (BTS 2017)."),
            _PCM,
            ("abx_viral", "Broad-spectrum antibiotics for an uncomplicated viral illness", "Komplike olmayan viral hastalıkta geniş spektrumlu antibiyotik", "contraindicated", [],
             "Antibiotics do not treat a virus; give them only for suspected bacterial co-infection (NICE NG191).", "Antibiyotik virüsü tedavi etmez; yalnızca bakteriyel ko-enfeksiyon şüphesinde verin (NICE NG191)."),
        ],
        "guide": ("CDC", "CDC Influenza antiviral medications: summary for clinicians", "Start oseltamivir as soon as possible in patients who are hospitalised, severely ill or at higher risk of complications.",
                  "Yatan, ağır hasta veya komplikasyon riski yüksek hastalarda oseltamiviri mümkün olan en kısa sürede başlayın."),
    },
    "covid19": {
        "labs": [
            ("6690-2", "White cell count", "Lökosit", 6.0, "10^9/L", 4.0, 11.0, "N", "haematology", 0.8),
            ("731-0", "Lymphocytes", "Lenfosit", 0.6, "10^9/L", 1.0, 4.0, "L", "haematology", 0.1),
            ("1988-5", "C-reactive protein", "CRP", 95, "mg/L", 0, 5, "H", "chemistry", 10),
            ("48065-7", "D-dimer", "D-dimer", 900, "ng/mL", 0, 500, "H", "coagulation", 80),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Bilateral peripheral ground-glass opacities, lower zones.", "Alt zonlarda bilateral periferik buzlu cam opasiteleri.",
                    "viral pneumonia chest x-ray bilateral opacities", "viral pnömoni akciğer grafisi bilateral opasite"),
        "treatments": [
            ("oxygen", "Controlled oxygen to SpO2 92-96%", "SpO2 %92-96 hedefli kontrollü oksijen", "indicated",
             [("spo2", 3.0, 300000)], "Titrated oxygen for hypoxaemia.", "Hipoksemide titre edilen oksijen."),
            ("dexamethasone", "Dexamethasone 6 mg once daily if supplemental oxygen is needed", "Ek oksijen gerekiyorsa günde bir kez deksametazon 6 mg", "indicated", [],
             "NICE NG191: steroids for patients needing oxygen.", "NICE NG191: oksijen gereken hastalara steroid."),
            _PCM,
            ("abx_viral", "Empirical antibiotics for viral pneumonia", "Viral pnömoni için ampirik antibiyotik", "contraindicated", [],
             "NICE NG191: do not offer antibiotics when a virus is the likely cause.", "NICE NG191: olası neden virüs ise antibiyotik önermeyin."),
        ],
        "guide": ("NICE", "NICE NG191 COVID-19 rapid guideline", "Offer dexamethasone to people who need supplemental oxygen; do not offer antibiotics when a virus is the likely cause of pneumonia.",
                  "Ek oksijen gereken hastalara deksametazon önerin; pnömoninin olası nedeni virüs ise antibiyotik önermeyin."),
    },
    "pid": {
        "labs": [
            ("2110-5", "Urine beta-hCG", "İdrar beta-hCG", "negative", "", None, None, "N", "urinalysis"),
            ("6690-2", "White cell count", "Lökosit", 13.0, "10^9/L", 4.0, 11.0, "H", "haematology", 1.0),
            ("1988-5", "C-reactive protein", "CRP", 75, "mg/L", 0, 5, "H", "chemistry", 10),
        ],
        "imaging": ("us-pelvis", "Transvaginal ultrasound", "Transvajinal ultrason",
                    "Mildly thickened tubes with free fluid; no tubo-ovarian abscess; no intrauterine or adnexal pregnancy.",
                    "Hafif kalınlaşmış tüpler ve serbest sıvı; tubo-ovaryan apse yok; intrauterin veya adneksiyal gebelik yok.",
                    "pelvic ultrasound tubal thickening", "pelvik ultrason tüp kalınlaşması"),
        "treatments": [
            ("pregnancy_test", "Pregnancy test before treatment", "Tedavi öncesi gebelik testi", "indicated", [],
             "Exclude an ectopic pregnancy first.", "Önce ektopik gebeliği dışlayın."),
            ("abx_pid", "IV ceftriaxone + doxycycline + metronidazole (clindamycin + gentamicin if allergy)", "IV seftriakson + doksisiklin + metronidazol (alerjide klindamisin + gentamisin)", "indicated", [],
             "CDC 2021 parenteral regimen; swabs do not delay treatment.", "CDC 2021 parenteral rejimi; sürüntüler tedaviyi geciktirmez."),
            _PCM,
            ("await_swabs", "Withhold antibiotics until swab results", "Sürüntü sonuçlarına kadar antibiyotiği beklet", "contraindicated", [],
             "Treat presumptively on clinical criteria (CDC 2021).", "Klinik ölçütlere göre varsayımsal tedavi edin (CDC 2021)."),
        ],
        "guide": ("CDC", "CDC STI Treatment Guidelines 2021", "Treat presumptively when pelvic pain comes with cervical motion, uterine or adnexal tenderness; parenteral ceftriaxone with doxycycline and metronidazole.",
                  "Pelvik ağrıya servikal hareket, uterus veya adneksiyal hassasiyet eşlik ediyorsa varsayımsal tedavi edin; parenteral seftriakson, doksisiklin ve metronidazol."),
    },
    "acute_prostatitis": {
        "labs": [
            ("5799-2", "Urinalysis (leucocytes/nitrites)", "İdrar (lökosit/nitrit)", "positive", "", None, None, "H", "urinalysis"),
            ("6690-2", "White cell count", "Lökosit", 15.4, "10^9/L", 4.0, 11.0, "H", "haematology", 1.2),
            ("1988-5", "C-reactive protein", "CRP", 120, "mg/L", 0, 5, "H", "chemistry", 12),
            ("2160-0", "Creatinine", "Kreatinin", 1.0, "mg/dL", 0.6, 1.3, "N", "chemistry", 0.1),
        ],
        "imaging": ("us-renal", "Bladder ultrasound (post-void residual)", "Mesane ultrasonu (işeme sonrası rezidü)",
                    "Post-void residual 90 mL; no hydronephrosis.", "İşeme sonrası rezidü 90 mL; hidronefroz yok.",
                    "bladder ultrasound residual", "mesane ultrasonu rezidü"),
        "treatments": [
            ("cultures", "Midstream urine (and blood cultures if febrile) before antibiotics", "Antibiyotik öncesi orta akım idrar (ateşliyse kan kültürü)", "indicated", [],
             "NICE NG110: culture before antibiotics.", "NICE NG110: antibiyotik öncesi kültür."),
            ("abx_prostatitis", "Antibiotic per NICE NG110 (oral ciprofloxacin or levofloxacin; IV ceftriaxone or gentamicin if septic)", "NICE NG110'a göre antibiyotik (oral siprofloksasin veya levofloksasin; septikse IV seftriakson veya gentamisin)", "indicated", [],
             "A 14-day course; improvement over 48 h.", "14 günlük kür; 48 saat içinde düzelme."),
            _fluids("IV crystalloid bolus if hypotensive", "Hipotansifse IV kristaloid bolus", 6.0, 5.0),
            _PCM,
            ("prostatic_massage", "Prostatic massage to obtain a specimen", "Örnek almak için prostat masajı", "contraindicated", [],
             "Contraindicated in acute bacterial infection of the prostate (EAU).", "Prostatın akut bakteriyel enfeksiyonunda kontrendikedir (EAU)."),
        ],
        "guide": ("NICE", "NICE NG110 (acute, antimicrobial prescribing)", "Send a midstream urine before antibiotics, offer an antibiotic, and refer to hospital if there are signs of sepsis, retention or abscess.",
                  "Antibiyotikten önce orta akım idrar gönderin, antibiyotik önerin; sepsis, retansiyon veya apse bulgusunda hastaneye yönlendirin."),
    },
    "febrile_neutropenia": {
        "labs": [
            ("751-8", "Absolute neutrophil count", "Mutlak nötrofil sayısı", 0.3, "10^9/L", 2.0, 7.5, "LL", "haematology", 0.05),
            ("6690-2", "White cell count", "Lökosit", 0.9, "10^9/L", 4.0, 11.0, "LL", "haematology", 0.1),
            ("1988-5", "C-reactive protein", "CRP", 140, "mg/L", 0, 5, "H", "chemistry", 12),
            ("2524-7", "Lactate", "Laktat", 2.3, "mmol/L", 0.5, 2.0, "H", "blood-gas", 0.2),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "No consolidation; PICC tip at the cavo-atrial junction.", "Konsolidasyon yok; PICC ucu kavo-atriyal bileşkede.",
                    "chest x-ray infection source", "akciğer grafisi enfeksiyon kaynağı"),
        "treatments": [
            ("cultures", "Blood cultures (peripheral and from the line)", "Kan kültürü (periferik ve kateterden)", "indicated", [],
             "Culture without delaying antibiotics.", "Antibiyotiği geciktirmeden kültür."),
            ("immediate_abx", "Empirical antibiotics within 1 hour: piperacillin-tazobactam (meropenem with caution, or vancomycin + gentamicin, if penicillin anaphylaxis)",
             "1 saat içinde ampirik antibiyotik: piperasilin-tazobaktam (penisilin anafilaksisinde dikkatle meropenem veya vankomisin + gentamisin)", "indicated", [],
             "NICE CG151: empiric antibiotics immediately, before the count returns.", "NICE CG151: sayım sonucu beklenmeden hemen ampirik antibiyotik."),
            _fluids("IV crystalloid 500 mL bolus, reassess", "500 mL IV kristaloid bolus, yeniden değerlendir", 6.0, 6.0),
            _PCM,
            ("delay_abx", "Delay antibiotics for investigations", "Tetkik için antibiyotiği ertele", "contraindicated", [],
             "Never delay antibiotics in neutropenic fever.", "Nötropenik ateşte antibiyotiği geciktirmeyin."),
        ],
        "guide": ("NICE", "NICE CG151 Neutropenic sepsis", "Treat suspected neutropenic sepsis as an emergency: piperacillin-tazobactam immediately, with FBC, renal and liver function, CRP, lactate and blood cultures.",
                  "Şüpheli nötropenik sepsisi acil olarak ele alın: hemen piperasilin-tazobaktam; tam kan sayımı, böbrek ve karaciğer fonksiyonu, CRP, laktat ve kan kültürü."),
    },
    "hiv_seroconversion": {
        "labs": [
            ("56888-1", "HIV-1/2 antigen/antibody (4th generation)", "HIV-1/2 antijen/antikor (4. jenerasyon)", "reactive", "", None, None, "H", "serology"),
            ("6690-2", "White cell count", "Lökosit", 3.6, "10^9/L", 4.0, 11.0, "L", "haematology", 0.3),
            ("777-3", "Platelets", "Trombosit", 128, "10^9/L", 150, 400, "L", "haematology", 10),
            ("1742-6", "Alanine aminotransferase", "ALT", 68, "U/L", 7, 56, "H", "chemistry", 6),
            ("1988-5", "C-reactive protein", "CRP", 18, "mg/L", 0, 5, "H", "chemistry", 4),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Clear lung fields.", "Akciğer alanları temiz.",
                    "chest x-ray normal lungs", "akciğer grafisi normal"),
        "treatments": [
            ("hiv_test", "Antigen/antibody test after an informed discussion", "Bilgilendirilmiş görüşme sonrası antijen/antikor testi", "indicated", [],
             "A 4th-generation test detects seroconversion from about 4 weeks (BHIVA/BASHH 2020).", "4. jenerasyon test serokonversiyonu yaklaşık 4. haftadan itibaren saptar (BHIVA/BASHH 2020)."),
            ("hiv_referral", "Same-day referral to specialist services to start antiretroviral therapy", "Antiretroviral tedavi başlamak için aynı gün uzman servisine yönlendirme", "indicated", [],
             "Early treatment and partner notification.", "Erken tedavi ve partner bildirimi."),
            _PCM,
            ("abx_viral", "Broad-spectrum antibiotics for the febrile illness", "Ateşli tablo için geniş spektrumlu antibiyotik", "contraindicated", [],
             "A viral syndrome; antibiotics do not help.", "Viral sendrom; antibiyotik yarar sağlamaz."),
        ],
        "guide": ("BHIVA", "BHIVA/BASHH/BIA UK guidelines for HIV testing 2020", "Offer a test to anyone with symptoms that could be primary infection, such as fever, rash and sore throat after a recent exposure.",
                  "Yakın zamanda maruziyet sonrası ateş, döküntü ve boğaz ağrısı gibi primer enfeksiyon olabilecek belirtileri olan herkese test önerin."),
    },
}
CONDITION_FIXTURES.update(FEBRILE_FIXTURES)


# --------------------------------------------------------------------------- #
# D-12: febrile history topics and exam findings.                              #
#                                                                              #
# The template authored no answer for rigors, urinary symptoms, cough, neck    #
# stiffness, travel, sick contacts, vaccination or immunosuppression, so the   #
# patient said "Could you be a little more specific", which tells the learner  #
# the phrasing was wrong. Every febrile condition below answers all eight      #
# topics (a pertinent negative where the condition gives no positive). Each    #
# item carries a ``topic`` so the client reveals the answer to the question    #
# that was asked, not every associated symptom at once.                        #
# --------------------------------------------------------------------------- #
FEVER_TOPICS: dict[str, str] = {
    # topic -> question intent it belongs to
    "rigors": "associated-symptoms",
    "urinary": "associated-symptoms",
    "cough": "associated-symptoms",
    "neck": "associated-symptoms",
    "travel": "social-history",
    "contacts": "social-history",
    "vaccination": "past-medical-history",
    "immunosuppression": "risk-factors",
}

FEVER_NEGATIVES: dict[str, tuple[str, str]] = {
    "rigors": ("I've felt hot and cold, but no uncontrollable shaking.", "Sıcak soğuk oldum ama kontrol edemediğim bir titreme olmadı."),
    "urinary": ("No burning or pain when I pass urine, and I'm not going more often.", "İdrar yaparken yanma ya da ağrı yok, sık idrara da çıkmıyorum."),
    "cough": ("No cough and no phlegm.", "Öksürük de balgam da yok."),
    "neck": ("My neck moves fine and the light doesn't bother my eyes.", "Boynum rahat hareket ediyor, ışık da gözümü rahatsız etmiyor."),
    "travel": ("I haven't travelled anywhere recently.", "Son zamanlarda hiçbir yere seyahat etmedim."),
    "contacts": ("Nobody around me has been ill, as far as I know.", "Bildiğim kadarıyla çevremde hasta olan kimse yok."),
    "vaccination": ("I think my vaccinations are up to date; I had all the routine ones.", "Aşılarımın tam olduğunu düşünüyorum; rutin aşıların hepsini oldum."),
    "immunosuppression": ("I don't take steroids or anything that lowers my immunity, and I've never had chemotherapy.", "Steroid ya da bağışıklığımı düşüren bir ilaç kullanmıyorum, hiç kemoterapi almadım."),
}

_RIGORS_YES = ("Yes, proper shaking chills; my teeth were chattering.", "Evet, gerçek titreme nöbetleri; dişlerim birbirine vuruyordu.")

FEVER_POSITIVES: dict[str, dict[str, tuple[str, str]]] = {
    "sepsis_uncomplicated": {"rigors": _RIGORS_YES},
    "septic_shock": {"rigors": _RIGORS_YES,
                     "urinary": ("(Relative) He has been going to the toilet a lot and said it burned for three days.", "(Yakını) Üç gündür sık tuvalete gidiyordu ve yandığını söyledi.")},
    "pneumonia_cap": {"rigors": _RIGORS_YES,
                      "cough": ("Yes, for three days, bringing up rusty green phlegm, and it hurts on the right when I breathe in.", "Evet, üç gündür pas renkli yeşil balgam çıkarıyorum ve nefes alınca sağ tarafım ağrıyor."),
                      "contacts": ("My grandson had a bad cold last week.", "Torunum geçen hafta kötü bir soğuk algınlığı geçirdi."),
                      "vaccination": ("I never had the pneumonia jab and I missed this year's flu jab.", "Zatürre aşısı hiç olmadım, bu yılın grip aşısını da kaçırdım.")},
    "pyelonephritis": {"rigors": _RIGORS_YES,
                       "urinary": ("Yes, it burns, I'm going every hour, and now the pain is in my right side and back.", "Evet, yanıyor, saatte bir tuvalete gidiyorum ve şimdi ağrı sağ yanımda ve sırtımda.")},
    "bacterial_meningitis": {"neck": ("Yes, my neck is so stiff I can't put my chin down, and the light hurts my eyes.", "Evet, boynum o kadar sert ki çenemi göğsüme değdiremiyorum, ışık da gözlerimi acıtıyor."),
                             "contacts": ("I share a flat with other students; one had a fever last week.", "Diğer öğrencilerle aynı evde kalıyorum; biri geçen hafta ateşlendi."),
                             "vaccination": ("I'm not sure I ever had the meningitis vaccine.", "Menenjit aşısı olup olmadığımdan emin değilim.")},
    "cellulitis": {"rigors": ("I had one shivery spell last night.", "Dün gece bir kez titreme oldu.")},
    "ascending_cholangitis": {"rigors": ("Yes, violent shaking chills twice today.", "Evet, bugün iki kez şiddetli titreme nöbeti geçirdim.")},
    "septic_arthritis": {"rigors": ("I've had a couple of shivery spells.", "Birkaç kez titreme oldu."),
                         "immunosuppression": ("No immune problems, but I had a steroid injection into that knee three weeks ago.", "Bağışıklık sorunum yok ama üç hafta önce o dizime steroid iğnesi yapıldı.")},
    "malaria": {"rigors": ("Yes, shaking chills that come in waves, then I sweat buckets.", "Evet, dalgalar halinde gelen titreme, ardından sırılsıklam terliyorum."),
                "travel": ("I came back from Nigeria ten days ago after visiting family; I didn't take any preventive tablets.", "On gün önce aile ziyaretinden, Nijerya'dan döndüm; koruyucu ilaç kullanmadım."),
                "vaccination": ("I had a yellow fever jab before the trip, but no preventive tablets.", "Yolculuktan önce sarıhumma aşısı oldum ama koruyucu ilaç almadım.")},
    "influenza": {"rigors": ("Yes, shivery and aching all over.", "Evet, titriyorum ve her yerim ağrıyor."),
                  "cough": ("A dry cough and a sore throat.", "Kuru öksürük ve boğaz ağrısı var."),
                  "contacts": ("Half my office has been off sick with the same thing this week.", "Bu hafta ofisin yarısı aynı şeyle hasta izinliydi."),
                  "vaccination": ("I didn't get the seasonal jab this year.", "Bu yıl mevsimsel aşıyı olmadım.")},
    "covid19": {"cough": ("A dry cough, and I can't smell anything.", "Kuru öksürük var ve hiçbir koku alamıyorum."),
                "contacts": ("My partner tested positive for the virus last week.", "Eşimin geçen hafta virüs testi pozitif çıktı."),
                "vaccination": ("I had two doses of the vaccine, but no booster for a few years.", "İki doz aşı oldum ama birkaç yıldır hatırlatma dozu olmadım.")},
    "pid": {"urinary": ("A little stinging, but mostly the pain is low in my pelvis and there is a new discharge.", "Biraz yanma var ama ağrı çoğunlukla kasığımda ve yeni bir akıntı var."),
            "contacts": ("I have had a new partner since last month.", "Geçen aydan beri yeni bir partnerim var.")},
    "acute_prostatitis": {"rigors": _RIGORS_YES,
                          "urinary": ("It burns, I have to strain, the stream is slow, and it aches between my legs.", "Yanıyor, ıkınmam gerekiyor, akım yavaş ve bacak aramda ağrı var.")},
    "febrile_neutropenia": {"rigors": ("Yes, I started shaking after the nurse flushed my line.", "Evet, hemşire kateterimi yıkadıktan sonra titremeye başladım."),
                            "immunosuppression": ("I had chemotherapy for breast cancer eight days ago.", "Sekiz gün önce meme kanseri için kemoterapi aldım.")},
    "hiv_seroconversion": {"rigors": ("Night sweats and shivers for a week.", "Bir haftadır gece terlemesi ve titreme var."),
                           "contacts": ("I had unprotected sex with a new partner about three weeks ago.", "Yaklaşık üç hafta önce yeni bir partnerle korunmasız ilişkim oldu."),
                           "immunosuppression": ("Not that I know of; I've never had a test.", "Bildiğim kadarıyla yok; hiç test yaptırmadım.")},
}

FEVER_HPI_CONDITIONS: frozenset[str] = frozenset(FEVER_POSITIVES) | frozenset(FEBRILE_TEMP)


def fever_hpi(cond_id: str) -> list[dict[str, Any]]:
    """The eight febrile history topics for a febrile condition."""
    if cond_id not in FEVER_HPI_CONDITIONS:
        return []
    pos = FEVER_POSITIVES.get(cond_id, {})
    out = []
    for topic, intent in FEVER_TOPICS.items():
        en, tr = pos.get(topic) or FEVER_NEGATIVES[topic]
        out.append({"intent": intent, "topic": topic, "answer_en": en, "answer_tr": tr})
    return out


# Febrile exam findings for every maneuver a fever work-up examines (neck
# stiffness, Kernig / Brudzinski, chest auscultation, renal angle, skin and
# joints). Condition-specific findings win; these fill the maneuvers a
# condition does not author.
FEVER_EXAM_NORMALS: dict[str, tuple] = {
    "cardiovascular": _ex("cardiovascular", _CV, "Regular tachycardia; normal heart sounds, no murmur; capillary refill 2 s.", "Düzenli taşikardi; kalp sesleri normal, üfürüm yok; kapiller dolum 2 s.", False),
    "respiratory": _ex("respiratory", _RESP, "Chest clear on auscultation with good air entry on both sides.", "Oskültasyonda akciğerler temiz, her iki tarafta hava girişi iyi.", False),
    "abdominal": _ex("abdominal", _ABD, "Abdomen soft and non-tender; no renal angle (CVA) tenderness; no organomegaly.", "Karın yumuşak, hassasiyet yok; kostovertebral açı hassasiyeti yok; organomegali yok.", False),
    "neurological": _ex("neurological", _NEURO, "Alert and orientated; no neck stiffness, Kernig and Brudzinski negative; no focal deficit.", "Uyanık ve oryante; ense sertliği yok, Kernig ve Brudzinski negatif; fokal defisit yok.", False),
    "skin": _ex("skin", _SKIN, "No rash or petechiae; skin intact; cannula sites clean.", "Döküntü veya peteşi yok; cilt sağlam; kanül yerleri temiz.", False),
    "musculoskeletal": _ex("musculoskeletal", _MSK, "No hot or swollen joints; full painless range of movement.", "Sıcak veya şiş eklem yok; ağrısız tam hareket açıklığı.", False),
}

FEVER_EXAM_SPECIFIC: dict[str, list[tuple]] = {
    "sepsis_uncomplicated": [_ex("general-inspection", _GEN, "Flushed, sweaty and shivering; warm peripheries; alert.", "Kızarık, terli ve titriyor; ekstremiteler sıcak; uyanık.")],
    "cellulitis": [_ex("skin", _SKIN, "Spreading erythema, warmth and tenderness over the left shin with an indistinct margin; a crack between the toes; no crepitus or bullae.", "Sol kaval kemiği üzerinde sınırı belirsiz, yayılan kızarıklık, sıcaklık ve hassasiyet; parmak arasında çatlak; krepitasyon veya bül yok."),
                   _ex("musculoskeletal", _MSK, "Tender left inguinal nodes; ankle and knee move freely.", "Solda hassas inguinal lenf nodları; ayak bileği ve diz serbest hareketli.")],
    "ascending_cholangitis": [_ex("skin", _SKIN, "Jaundiced skin with scratch marks; no rash.", "Kaşıntı izleriyle sarı cilt; döküntü yok.")],
    "septic_arthritis": [_ex("musculoskeletal", _MSK, "Right knee hot, red and swollen with a large effusion, held flexed; any passive movement is exquisitely painful.", "Sağ diz sıcak, kırmızı ve büyük efüzyonla şiş, fleksiyonda tutuluyor; her pasif hareket çok ağrılı."),
                         _ex("general-inspection", _GEN, "Febrile, unwilling to bear weight on the right leg.", "Ateşli, sağ bacağına yük vermek istemiyor.")],
    "malaria": [_ex("abdominal", _ABD, "Spleen tip palpable; liver edge 2 cm below the costal margin; mildly tender.", "Dalak ucu ele geliyor; karaciğer kenarı kosta kenarının 2 cm altında; hafif hassas."),
                _ex("general-inspection", _GEN, "Pale, mild scleral icterus, sweating after a rigor; alert, GCS 15.", "Soluk, hafif skleral ikter, titreme sonrası terli; uyanık, GKS 15.")],
    "influenza": [_ex("respiratory", _RESP, "Scattered wheeze, no focal crackles.", "Dağınık hırıltı, fokal ral yok."),
                  _ex("ent", ("ENT", "KBB"), "Injected pharynx, no exudate; clear nasal discharge.", "Hiperemik farenks, eksüda yok; berrak burun akıntısı."),
                  _ex("general-inspection", _GEN, "Flushed, aching, looks unwell but alert.", "Kızarık, ağrılı, hasta görünümlü ama uyanık.")],
    "covid19": [_ex("respiratory", _RESP, "Fine crackles at both bases; RR raised; no wheeze.", "Her iki bazalde ince raller; solunum sayısı artmış; hırıltı yok."),
                _ex("general-inspection", _GEN, "Breathless on talking, comfortable at rest.", "Konuşurken nefes darlığı, istirahatte rahat.")],
    "pid": [_ex("abdominal", _ABD, "Bilateral lower abdominal tenderness, no peritonism.", "Bilateral alt karın hassasiyeti, peritonizm yok."),
            _ex("focused-special", ("Pelvic", "Pelvik"), "Speculum: mucopurulent cervical discharge; bimanual: cervical motion and bilateral adnexal tenderness.", "Spekulum: mukopürülan servikal akıntı; bimanuel: servikal hareket hassasiyeti ve bilateral adneksiyal hassasiyet.")],
    "acute_prostatitis": [_ex("abdominal", _ABD, "Suprapubic tenderness; bladder not palpable; no renal angle tenderness.", "Suprapubik hassasiyet; mesane ele gelmiyor; kostovertebral açı hassasiyeti yok."),
                          _ex("focused-special", ("Genitourinary", "Genitoüriner"), "Gentle rectal examination: exquisitely tender, warm, boggy prostate (no massage).", "Nazik rektal muayene: çok hassas, sıcak, yumuşak prostat (masaj yapılmadı).")],
    "febrile_neutropenia": [_ex("general-inspection", _GEN, "Flushed and shivering, PICC line site clean; no mucositis; no obvious source.", "Kızarık ve titriyor, PICC giriş yeri temiz; mukozit yok; belirgin kaynak yok."),
                            _ex("respiratory", _RESP, "Chest clear.", "Akciğerler temiz.", False)],
    "hiv_seroconversion": [_ex("skin", _SKIN, "Faint maculopapular rash over the trunk.", "Gövdede silik makülopapüler döküntü."),
                           _ex("ent", ("ENT", "KBB"), "Pharyngitis without exudate; shallow oral ulcers; tender cervical lymph nodes.", "Eksüdasız farenjit; yüzeysel ağız ülserleri; hassas servikal lenf nodları.")],
}


def fever_exam(cond_id: str) -> list[tuple]:
    """Condition-specific findings first, then the febrile normals for any
    maneuver the condition does not author."""
    if cond_id not in FEVER_HPI_CONDITIONS:
        return list(CONDITION_EXAM.get(cond_id, []))
    specific = list(FEVER_EXAM_SPECIFIC.get(cond_id, []))
    base = [e for e in CONDITION_EXAM.get(cond_id, []) if not any(e[0] == s[0] for s in specific)]
    found = specific + base
    have = {e[0] for e in found}
    return found + [row for m, row in FEVER_EXAM_NORMALS.items() if m not in have]



# --------------------------------------------------------------------------- #
# D-11: verified statements behind each febrile case's work-up and management. #
#                                                                              #
# Every id below is ``verified`` in server/guidelines/statements.verified.json #
# (server/tests/test_acceptance_fever.py checks it). The order codes say which #
# expected orders a statement supports, so the client cites the cultures      #
# statement for blood cultures, not the antibiotic-timing one.                 #
# --------------------------------------------------------------------------- #
_SSC_CULT = ("gs_ssc21_lactate_cultures", ("2524-7", "600-7", "blood-culture", "lactate"))
_SSC_ABX = ("gs_ssc21_antimicrobials_1h", ())
_SSC_FLUIDS = ("gs_ssc21_fluids_30mlkg", ())
_SSC_SOURCE = ("gs_ssc21_source_control", ())

CONDITION_STATEMENTS: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "sepsis_uncomplicated": [_SSC_CULT, _SSC_ABX, _SSC_FLUIDS, ("gs_nice_ng253_high_risk_criteria", ()), _SSC_SOURCE],
    "septic_shock": [_SSC_CULT, _SSC_ABX, _SSC_FLUIDS, ("gs_ssc21_norepinephrine_map65", ()), _SSC_SOURCE],
    "pneumonia_cap": [("gs_nice_ng250_curb65", ("22664-7",)), ("gs_nice_ng250_cap_4h", ("36643-5", "cxr")),
                      ("gs_nice_ng250_cap_micro", ("600-7", "blood-culture", "sputum-culture")),
                      ("gs_nice_ng250_penicillin_allergy", ())],
    "pyelonephritis": [("gs_nice_ng111_msu", ("5799-2", "ua", "urine-culture")), ("gs_nice_ng111_iv_choice", ()), _SSC_SOURCE],
    "bacterial_meningitis": [("gs_nice_ng240_abx_1h", ("6690-2", "1988-5", "600-7", "blood-culture")),
                             ("gs_nice_ng240_lp_imaging", ("30799-1", "ct-head-noncon", "30405-5", "2342-4", "csf-studies")),
                             ("gs_nice_ng240_dexamethasone", ()), ("gs_nice_ng240_antibiotic_allergy", ())],
    "cellulitis": [("gs_nice_ng141_marker", ()), ("gs_nice_ng141_penicillin_allergy", ())],
    "ascending_cholangitis": [("gs_wses2020_acc_lfts", ("1975-2", "6768-6")), ("gs_wses2020_acc_ultrasound", ("24558-9", "us-ruq")),
                              _SSC_SOURCE, _SSC_ABX, _SSC_CULT],
    "septic_arthritis": [_SSC_SOURCE, _SSC_CULT, _SSC_ABX],
    "malaria": [("gs_cdc_malaria_smears", ("32700-7", "malaria-film", "malaria-rdt", "777-3", "718-7")),
                ("gs_cdc_malaria_severe_artesunate", ())],
    "influenza": [("gs_cdc_flu_oseltamivir", ()), ("gs_nice_ng191_no_antibiotics", ())],
    "covid19": [("gs_nice_ng191_dexamethasone", ()), ("gs_nice_ng191_no_antibiotics", ())],
    "pid": [("gs_cdc_pid_minimum_criteria", ("2110-5", "urine-hcg", "us-pelvis")), ("gs_cdc_pid_parenteral", ()),
            ("gs_cdc_pid_alternative", ())],
    "acute_prostatitis": [("gs_nice_ng110_abx_msu", ("5799-2", "ua", "urine-culture")), ("gs_nice_ng110_refer", ("us-renal",))],
    "febrile_neutropenia": [("gs_nice_cg151_neutropenic", ("751-8", "6690-2", "1988-5", "2524-7", "600-7", "blood-culture"))],
}


# --------------------------------------------------------------------------- #
# D-17: prevalence-weighted allergy draw.                                      #
#                                                                              #
# Both acceptance patients drew "Penicillin, anaphylaxis as a child", so every #
# febrile case blocked the only antibiotic. Documented drug allergy is common #
# but not universal: in 1.77 million EHR records 35.5% of patients had at      #
# least one, most often penicillins (12.8%), sulfonamide antibiotics (7.4%),   #
# opiates (6.8%) and NSAIDs (3.5%) (Zhou L et al., Allergy 2016;71:1305,       #
# doi 10.1111/all.12881). Most penicillin labels are low-risk rashes; true     #
# IgE-mediated allergy is under 1% of the population and anaphylaxis is rarer  #
# still (Shenoy ES et al., JAMA 2019;321:188, doi 10.1001/jama.2018.19283).    #
# The weights below follow those proportions (per 100 patients); a condition  #
# pool's own teaching allergies (aspirin in ACS, contrast before a CT) keep a  #
# small extra weight so the allergy check can still fail where it teaches.    #
# --------------------------------------------------------------------------- #
ALLERGY_PENICILLIN_RASH: tuple[str, str] = ("Penicillin: a rash with amoxicillin years ago, no breathing problems.", "Penisilin: yıllar önce amoksisiline döküntü, solunum sorunu olmadı.")

ALLERGY_PREVALENCE: list[tuple[float, tuple[str, str]]] = [
    (64.5, NKDA),
    (11.8, ALLERGY_PENICILLIN_RASH),
    (1.0, ALLERGY_PENICILLIN),
    (7.4, ALLERGY_SULFA),
    (3.4, ALLERGY_CODEINE),
    (3.4, ALLERGY_MORPHINE),
    (3.5, ALLERGY_ASPIRIN),
]
CONDITION_ALLERGY_BONUS = 3.0


def draw_allergy(rng: Any, pool: list[tuple[str, str]]) -> tuple[str, str]:
    """Seeded, prevalence-weighted allergy draw; NKDA is the majority."""
    weights: dict[tuple[str, str], float] = {a: w for w, a in ALLERGY_PREVALENCE}
    for a in pool:
        if a != NKDA:
            weights[a] = weights.get(a, 0.0) + CONDITION_ALLERGY_BONUS
    items = sorted(weights.items(), key=lambda kv: kv[0][0])
    total = sum(w for _, w in items)
    x = rng.random() * total
    for a, w in items:
        x -= w
        if x <= 0:
            return a
    return items[-1][0]

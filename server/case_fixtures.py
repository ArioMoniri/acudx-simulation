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
            ("bp_gate_lysis", "Lower BP to below 185/110 before lysis (then keep below 180/105)", "Litik tedavi öncesi TA'yı 185/110 altına düşür (sonra 180/105 altında tut)", "indicated", [("systolic", -15.0, 600000)], "Thrombolysis is allowed only with BP below 185/110 and glucose between 2.8 and 22 mmol/L.", "Tromboliz yalnızca TA 185/110 altında ve glukoz 2.8-22 mmol/L arasında iken verilir."),
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
            ("hydrocortisone", "IV hydrocortisone", "IV hidrokortizon", "indicated", [], "Immediate steroid replacement; pressure recovers over the next hour (Endocrine Society 2016).", "Hemen steroid replasmanı."),
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
    # Acceptance 2026-10-20 D-01: the Fever tile serves every condition in the
    # "fever" complaint index, so these three must be febrile too.
    "tb_pulmonary": (37.8, 38.6),
    "transfusion_reaction": (38.0, 39.2),
    "infectious_diarrhea": (37.8, 38.9),
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
            # LOINC 2342-4 is CSF glucose [Mass/volume]: mg/dL (1.6 mmol/L = 29 mg/dL; MedlinePlus 003633 range 50 to 80).
            ("2342-4", "CSF glucose (low)", "BOS glukozu (düşük)", 29, "mg/dL", 50, 80, "L", "csf", 4),
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

# Only conditions whose positives were authored (plus undifferentiated fever):
# a default negative would contradict, for example, the cough of tuberculosis
# or the tender abdomen of diverticulitis.
FEVER_HPI_CONDITIONS: frozenset[str] = frozenset(FEVER_POSITIVES) | {"undiff_fever"}


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


# =========================================================================== #
# Review 06b F03: treatment fixtures for the 47 ESI 1 to 2 conditions that     #
# had none and so inherited generic system rows ("A-to-E assessment",          #
# "analgesia"). Each fixture names the definitive therapy the course rule      #
# (CONDITION_COURSE below) requires, a supportive row and one specific         #
# contraindicated distractor. Sources are cited in the narrative and guide.    #
# =========================================================================== #
def _t(code: str, en: str, tr: str, appr: str, nen: str, ntr: str, effects: list | None = None) -> tuple:
    return (code, en, tr, appr, effects or [], nen, ntr)


ESI12_FIXTURES: dict[str, dict[str, Any]] = {
    "anaphylaxis": {"treatments": [
        _t("im_adrenaline", "IM adrenaline 0.5 mg anterolateral thigh, repeat after 5 min if no improvement",
           "İ.M. adrenalin 0.5 mg uyluk anterolateral, düzelme yoksa 5 dk sonra tekrar", "indicated",
           "First-line treatment; acts within minutes (RCUK 2021).", "Birinci basamak tedavi; dakikalar içinde etki eder (RCUK 2021)."),
        _t("high_flow_o2", "High-flow oxygen 15 L/min via reservoir mask", "Rezervuarlı maske ile 15 L/dk yüksek akım oksijen", "indicated",
           "Supportive; does not treat the reaction.", "Destekleyici; reaksiyonu tedavi etmez."),
        _t("iv_fluid_bolus", "IV crystalloid 500 mL bolus for hypotension", "Hipotansiyon için İ.V. 500 mL kristaloid bolus", "indicated",
           "Supportive volume; no improvement without adrenaline (RCUK 2021).", "Destekleyici sıvı; adrenalin olmadan düzelme olmaz (RCUK 2021)."),
        _t("antihistamine_instead", "Antihistamine and steroid instead of adrenaline", "Adrenalin yerine antihistaminik ve steroid", "contraindicated",
           "Antihistamines and steroids are not first-line and never replace adrenaline (RCUK 2021).",
           "Antihistaminik ve steroid birinci basamak değildir, adrenalinin yerini tutmaz (RCUK 2021)."),
    ], "guide": ("RCUK", "Resuscitation Council UK 2021 Emergency treatment of anaphylaxis",
                 "Give IM adrenaline 500 micrograms immediately and repeat after 5 minutes if there is no improvement.",
                 "Hemen İ.M. 500 mikrogram adrenalin verin ve 5 dakika sonra düzelme yoksa tekrarlayın.")},
    "cardiac_arrest": {"treatments": [
        _t("cpr_defib", "High-quality CPR 30:2, rhythm check and immediate defibrillation if VF/pVT",
           "Yüksek kaliteli KPR 30:2, ritim kontrolü, VF/nVT ise hemen defibrilasyon", "indicated",
           "Early defibrillation is the key intervention in shockable arrest (ERC 2021).", "Şoklanabilir arrestte erken defibrilasyon temel girişimdir (ERC 2021)."),
        _t("adrenaline_1mg", "Adrenaline 1 mg IV every 3 to 5 min", "Her 3-5 dakikada İ.V. 1 mg adrenalin", "indicated",
           "Non-shockable: as soon as possible; shockable: after the third shock (ERC 2021).", "Şoklanamayan ritimde hemen; şoklanabilirde 3. şoktan sonra (ERC 2021)."),
        _t("amiodarone_300", "Amiodarone 300 mg IV after three shocks", "Üç şoktan sonra İ.V. 300 mg amiodaron", "indicated",
           "Refractory VF/pVT (ERC 2021).", "Dirençli VF/nVT (ERC 2021)."),
        _t("long_pauses", "Prolonged pauses in compressions for intubation", "Entübasyon için göğüs basısına uzun ara", "contraindicated",
           "Pauses over 5 seconds reduce survival (ERC 2021).", "5 saniyeden uzun aralar sağkalımı azaltır (ERC 2021)."),
    ], "guide": ("ERC", "European Resuscitation Council Guidelines 2021: Adult advanced life support",
                 "Minimise interruptions in chest compressions and defibrillate shockable rhythms immediately.",
                 "Göğüs basısı kesintilerini en aza indirin ve şoklanabilir ritimleri hemen defibrile edin.")},
    "major_trauma": {"treatments": [
        _t("haemorrhage_control", "Control catastrophic haemorrhage first (tourniquet, packing, pelvic binder)", "Önce masif kanamayı kontrol edin (turnike, tampon, pelvik kuşak)", "indicated",
           "<C>ABCDE: catastrophic haemorrhage first (NICE NG39).", "<C>ABCDE: önce masif kanama (NICE NG39)."),
        _t("txa", "Tranexamic acid 1 g IV within 3 h of injury", "Yaralanmadan sonraki 3 saat içinde İ.V. 1 g traneksamik asit", "indicated",
           "Reduces bleeding death when given within 3 h (CRASH-2).", "3 saat içinde verildiğinde kanama ölümünü azaltır (CRASH-2)."),
        _t("blood_products", "Major haemorrhage protocol: red cells and plasma 1:1", "Masif kanama protokolü: eritrosit ve plazma 1:1", "indicated",
           "Blood products, not crystalloid, for haemorrhagic shock (NICE NG39).", "Hemorajik şokta kristaloid değil kan ürünü (NICE NG39)."),
        _t("crystalloid_large", "Large-volume crystalloid resuscitation (2 L or more)", "Büyük hacimli kristaloid resüsitasyonu (2 L veya fazla)", "contraindicated",
           "Excess crystalloid dilutes clotting factors; use blood products (NICE NG39).", "Fazla kristaloid pıhtılaşma faktörlerini seyreltir; kan ürünü kullanın (NICE NG39)."),
    ], "guide": ("NICE", "NICE NG39 Major trauma: assessment and initial management",
                 "Use tranexamic acid as soon as possible in major trauma with suspected active bleeding.",
                 "Aktif kanama düşünülen majör travmada traneksamik asidi mümkün olan en kısa sürede kullanın.")},
    "heat_stroke": {"treatments": [
        _t("active_cooling", "Rapid active cooling (cold-water immersion or evaporative) to 38.5 to 39 C", "38.5-39 C'ye hızlı aktif soğutma (soğuk su veya evaporatif)", "indicated",
           "Cool first; outcome worsens with time above 40.5 C (ACSM 2023).", "Önce soğutun; 40.5 C üzerinde geçen süreyle sonuç kötüleşir (ACSM 2023)."),
        _t("iv_fluids", "IV crystalloid for hypotension", "Hipotansiyon için İ.V. kristaloid", "indicated",
           "Supportive volume.", "Destekleyici sıvı."),
        _t("antipyretic_cooling", "Paracetamol as the cooling strategy", "Soğutma yöntemi olarak parasetamol", "contraindicated",
           "Antipyretics do not lower a non-pyrogenic temperature (ACSM 2023).", "Antipiretikler pirojenik olmayan ateşi düşürmez (ACSM 2023)."),
    ], "guide": ("ACSM", "ACSM Expert Consensus Statement on Exertional Heat Illness 2023",
                 "Begin whole-body cooling immediately; cool first, transport second.",
                 "Hemen tüm vücut soğutmasına başlayın; önce soğutun, sonra nakledin.")},
    "hypothermia": {"treatments": [
        _t("active_rewarming", "Active external and minimally invasive rewarming (forced air, warmed IV fluids)", "Aktif dış ve minimal invaziv ısıtma (sıcak hava, ısıtılmış İ.V. sıvı)", "indicated",
           "Rewarm while monitoring for arrhythmia (ERC 2021).", "Aritmi izlemi altında ısıtın (ERC 2021)."),
        _t("gentle_handling", "Gentle horizontal handling and cardiac monitoring", "Nazik, yatay pozisyonda taşıma ve kardiyak monitörizasyon", "indicated",
           "Rough handling can trigger VF in severe hypothermia (ERC 2021).", "Ağır hipotermide kaba hareket VF tetikleyebilir (ERC 2021)."),
        _t("rough_handling", "Rapid upright transfer and vigorous handling", "Hızlı dik pozisyona alma ve kaba taşıma", "contraindicated",
           "Risk of VF in a cold myocardium (ERC 2021).", "Soğuk miyokardda VF riski (ERC 2021)."),
    ], "guide": ("ERC", "ERC Guidelines 2021: Cardiac arrest in special circumstances (hypothermia)",
                 "Handle severely hypothermic patients gently and rewarm actively.",
                 "Ağır hipotermik hastaları nazik taşıyın ve aktif olarak ısıtın.")},
    "drowning": {"treatments": [
        _t("ventilate_o2", "Airway and high-flow oxygen; ventilate if breathing is inadequate", "Hava yolu ve yüksek akım oksijen; solunum yetersizse ventile edin", "indicated",
           "Hypoxia causes drowning arrest; oxygenate first (ERC 2021).", "Boğulmada arrestin nedeni hipoksidir; önce oksijenlendirin (ERC 2021)."),
        _t("cpap_niv", "CPAP or NIV for persistent hypoxaemia", "Süren hipoksemide CPAP veya NIV", "indicated",
           "Recruits flooded alveoli.", "Sıvıyla dolu alveolleri açar."),
        _t("abdominal_thrusts", "Abdominal thrusts to drain water", "Suyu boşaltmak için abdominal bası", "contraindicated",
           "Delays ventilation and risks aspiration (ERC 2021).", "Ventilasyonu geciktirir ve aspirasyon riski taşır (ERC 2021)."),
    ], "guide": ("ERC", "ERC Guidelines 2021: Drowning",
                 "Oxygenation and ventilation are the priority after drowning.",
                 "Boğulma sonrası öncelik oksijenlenme ve ventilasyondur.")},
    "electrical_injury": {"treatments": [
        _t("ecg_monitor", "12-lead ECG and cardiac monitoring", "12 derivasyonlu EKG ve kardiyak monitörizasyon", "indicated",
           "Arrhythmia is the early risk (ERC 2021).", "Erken risk aritmidir (ERC 2021)."),
        _t("fluids_rhabdo", "IV fluids for deep tissue injury with a urine output target", "Derin doku hasarı için idrar hedefli İ.V. sıvı", "indicated",
           "Protects against myoglobinuric AKI.", "Miyoglobinürik ABH'ye karşı korur."),
        _t("discharge_no_ecg", "Discharge without an ECG", "EKG çekmeden taburcu", "contraindicated",
           "High-voltage injury needs an ECG and monitoring.", "Yüksek voltaj yaralanmasında EKG ve izlem gerekir."),
    ], "guide": ("ERC", "ERC Guidelines 2021: Cardiac arrest in special circumstances (electrocution)",
                 "Monitor rhythm after high-voltage or lightning injury.",
                 "Yüksek voltaj veya yıldırım yaralanmasından sonra ritmi izleyin.")},
    "undiff_chest_pain": {"treatments": [
        _t("ecg_10min", "12-lead ECG within 10 minutes of arrival", "Gelişten sonraki 10 dakika içinde 12 derivasyonlu EKG", "indicated",
           "ESC 2023: ECG within 10 min of first medical contact.", "ESC 2023: ilk tıbbi temastan sonra 10 dk içinde EKG."),
        _t("aspirin_if_acs", "Aspirin 300 mg if ACS is suspected and there is no contraindication", "AKS düşünülüyor ve kontrendikasyon yoksa 300 mg aspirin", "indicated",
           "Antiplatelet loading as soon as ACS is suspected (ESC 2023).", "AKS düşünüldüğü anda antiplatelet yükleme (ESC 2023)."),
        _t("serial_trop", "High-sensitivity troponin 0 h / 1 h", "Yüksek duyarlıklı troponin 0/1. saat", "indicated",
           "Rule-in / rule-out algorithm (ESC 2023).", "Dahil etme / dışlama algoritması (ESC 2023)."),
        _t("discharge_before_trop", "Discharge before ECG and troponin", "EKG ve troponin öncesi taburcu", "contraindicated",
           "Misses ACS, PE and dissection.", "AKS, PE ve diseksiyonu atlar."),
    ], "guide": ("ESC", "2023 ESC Guidelines for the management of acute coronary syndromes",
                 "Record and interpret a 12-lead ECG within 10 minutes of first medical contact.",
                 "İlk tıbbi temastan sonra 10 dakika içinde 12 derivasyonlu EKG çekip yorumlayın.")},
    "undiff_dyspnea": {"treatments": [
        _t("o2_titrated", "Oxygen titrated to SpO2 94 to 98 % (88 to 92 % if hypercapnic risk)", "SpO2 %94-98'e titre oksijen (hiperkapni riskinde %88-92)", "indicated",
           "Target-range oxygen (BTS 2017).", "Hedef aralıklı oksijen (BTS 2017)."),
        _t("abg_cxr_ecg", "Blood gas, chest X-ray and ECG", "Kan gazı, akciğer grafisi ve EKG", "indicated",
           "Find the cause before specific therapy.", "Özgül tedaviden önce nedeni bulun."),
        _t("sedation_dyspnoea", "Sedation for distress before a diagnosis", "Tanı konmadan sıkıntı için sedasyon", "contraindicated",
           "Suppresses respiratory drive.", "Solunum dürtüsünü baskılar."),
    ], "guide": ("BTS", "BTS guideline for oxygen use in adults in healthcare and emergency settings 2017",
                 "Prescribe oxygen to a target saturation of 94 to 98 %, or 88 to 92 % if at risk of hypercapnia.",
                 "Oksijeni %94-98 hedef satürasyonla, hiperkapni riski varsa %88-92 ile reçeteleyin.")},
    "poisoning_unknown": {"treatments": [
        _t("abcde_glucose_ecg", "ABCDE, capillary glucose, ECG and toxidrome screen", "ABCDE, kapiller glukoz, EKG ve toksidrom taraması", "indicated",
           "Treat what threatens life first (AHA 2023 toxicology).", "Önce yaşamı tehdit edeni tedavi edin (AHA 2023 toksikoloji)."),
        _t("airway_support", "Airway support and close observation", "Hava yolu desteği ve yakın izlem", "indicated",
           "Supportive care is the mainstay.", "Destek tedavisi temeldir."),
        _t("empirical_flumazenil", "Empirical flumazenil", "Ampirik flumazenil", "contraindicated",
           "Can precipitate seizures, especially with co-ingested tricyclics (AHA 2023).", "Özellikle trisiklik birlikte alındıysa nöbet tetikleyebilir (AHA 2023)."),
    ], "guide": ("AHA", "2023 AHA Focused Update on the Management of Patients With Cardiac Arrest or Life-Threatening Toxicity Due to Poisoning",
                 "Do not routinely give flumazenil to patients with undifferentiated coma.",
                 "Ayırıcı tanısı yapılmamış komada rutin flumazenil vermeyin.")},
    "acute_agitation": {"treatments": [
        _t("verbal_deesc", "Verbal de-escalation in a safe environment", "Güvenli ortamda sözel yatıştırma", "indicated",
           "First step (NICE NG10).", "İlk adım (NICE NG10)."),
        _t("exclude_organic", "Exclude hypoglycaemia, hypoxia and intoxication", "Hipoglisemi, hipoksi ve zehirlenmeyi dışlayın", "indicated",
           "Agitation may be organic.", "Ajitasyon organik olabilir."),
        _t("rapid_tranq", "Offer oral, then IM rapid tranquillisation per protocol", "Protokole göre önce oral, sonra İ.M. hızlı sakinleştirme", "indicated",
           "Only after de-escalation fails (NICE NG10).", "Yalnızca yatıştırma başarısız olursa (NICE NG10)."),
        _t("prone_restraint", "Prolonged prone restraint", "Uzun süreli yüzüstü fiziksel tespit", "contraindicated",
           "Positional asphyxia risk (NICE NG10).", "Pozisyonel asfiksi riski (NICE NG10)."),
    ], "guide": ("NICE", "NICE NG10 Violence and aggression: short-term management",
                 "Use de-escalation first; avoid prolonged prone restraint.",
                 "Önce yatıştırma kullanın; uzun yüzüstü tespitten kaçının.")},
    "hemoptysis": {"treatments": [
        _t("bleeding_side_down", "Lie bleeding side down, secure the airway, oxygen", "Kanayan taraf altta yatırın, hava yolunu güvenceye alın, oksijen", "indicated",
           "Protects the non-bleeding lung.", "Kanamayan akciğeri korur."),
        _t("txa_hemoptysis", "Tranexamic acid", "Traneksamik asit", "indicated",
           "Reduces bleeding volume.", "Kanama miktarını azaltır."),
        _t("bae", "Urgent CT angiography and bronchial artery embolisation", "Acil BT anjiyografi ve bronşiyal arter embolizasyonu", "indicated",
           "Definitive control of massive haemoptysis (Kathuria 2020).", "Masif hemoptizinin kesin kontrolü (Kathuria 2020)."),
        _t("anticoag_hemoptysis", "Start anticoagulation", "Antikoagülasyon başlatma", "contraindicated",
           "Worsens haemorrhage.", "Kanamayı artırır."),
    ], "guide": ("J Intensive Care", "Kathuria H et al. Management of life-threatening hemoptysis. J Intensive Care 2020",
                 "Protect the airway, position bleeding side down and arrange bronchial artery embolisation.",
                 "Hava yolunu koruyun, kanayan tarafı alta alın ve bronşiyal arter embolizasyonu planlayın.")},
    "aspiration_pneumonitis": {"treatments": [
        _t("o2_suction", "Oxygen, suction and supportive care", "Oksijen, aspirasyon ve destek tedavisi", "indicated",
           "Chemical pneumonitis is treated supportively (Mandell 2019).", "Kimyasal pnömonit destekle tedavi edilir (Mandell 2019)."),
        _t("withhold_abx_48h", "Withhold antibiotics unless pneumonia develops", "Pnömoni gelişmedikçe antibiyotik vermeyin", "indicated",
           "Early antibiotics do not help pneumonitis (Mandell 2019).", "Erken antibiyotik pnömonite yarar sağlamaz (Mandell 2019)."),
        _t("routine_steroid", "Routine corticosteroids", "Rutin kortikosteroid", "contraindicated",
           "No benefit (Mandell 2019).", "Yarar yoktur (Mandell 2019)."),
    ], "guide": ("NEJM", "Mandell LA, Niederman MS. Aspiration pneumonia. NEJM 2019",
                 "Treat aspiration pneumonitis supportively; antibiotics only if pneumonia develops.",
                 "Aspirasyon pnömonitini destekle tedavi edin; antibiyotik yalnızca pnömoni gelişirse.")},
    "ards": {"treatments": [
        _t("lung_protective", "Intubation and lung-protective ventilation (6 mL/kg PBW, plateau below 30 cmH2O)", "Entübasyon ve akciğer koruyucu ventilasyon (6 mL/kg İVA, plato 30 cmH2O altı)", "indicated",
           "Lowers mortality (ESICM 2023).", "Mortaliteyi azaltır (ESICM 2023)."),
        _t("prone", "Prone positioning 12 h or more if PaO2/FiO2 below 150", "PaO2/FiO2 150 altıysa 12 saat veya fazla prone pozisyon", "indicated",
           "ESICM 2023 strong recommendation.", "ESICM 2023 güçlü öneri."),
        _t("conservative_fluid", "Conservative fluid strategy", "Kısıtlı sıvı stratejisi", "indicated",
           "More ventilator-free days.", "Daha fazla ventilatörsüz gün."),
        _t("high_tidal", "High tidal volume ventilation (10 to 12 mL/kg)", "Yüksek tidal hacimli ventilasyon (10-12 mL/kg)", "contraindicated",
           "Ventilator-induced lung injury (ESICM 2023).", "Ventilatöre bağlı akciğer hasarı (ESICM 2023)."),
    ], "guide": ("ESICM", "ESICM guidelines on acute respiratory distress syndrome 2023",
                 "Use low tidal volume ventilation and prone positioning in moderate to severe ARDS.",
                 "Orta-ağır ARDS'de düşük tidal hacim ve prone pozisyon kullanın.")},
    "perforated_ulcer": {"treatments": [
        _t("ppi_abx", "NBM, IV PPI and IV broad-spectrum antibiotics", "Ağızdan bir şey vermeyin, İ.V. PPI ve İ.V. geniş spektrumlu antibiyotik", "indicated",
           "Peritonitis needs Gram-negative and anaerobic cover (WSES 2020).", "Peritonit Gram-negatif ve anaerop kapsam gerektirir (WSES 2020)."),
        _t("iv_fluids", "IV fluid resuscitation", "İ.V. sıvı resüsitasyonu", "indicated",
           "Restores perfusion.", "Perfüzyonu düzeltir."),
        _t("emergency_surgery", "Emergency laparoscopic or open repair", "Acil laparoskopik veya açık onarım", "indicated",
           "Source control; delay raises mortality (WSES 2020).", "Kaynak kontrolü; gecikme mortaliteyi artırır (WSES 2020)."),
        _t("discharge_analgesia", "Discharge with analgesia", "Analjeziyle taburcu", "contraindicated",
           "Free air with peritonism is a surgical emergency.", "Peritonizmle serbest hava cerrahi acildir."),
    ], "guide": ("WSES", "Tarasconi A et al. Perforated and bleeding peptic ulcer: WSES guidelines 2020",
                 "Operate on a perforated peptic ulcer as soon as possible, with antibiotics and resuscitation.",
                 "Perfore peptik ülseri antibiyotik ve resüsitasyonla birlikte mümkün olan en kısa sürede ameliyat edin.")},
    "mesenteric_ischemia": {"treatments": [
        _t("ct_angio", "Urgent CT angiography", "Acil BT anjiyografi", "indicated",
           "Diagnosis without delay (WSES 2022).", "Gecikmeden tanı (WSES 2022)."),
        _t("heparin_fluids_abx", "IV heparin, fluids and broad-spectrum antibiotics", "İ.V. heparin, sıvı ve geniş spektrumlu antibiyotik", "indicated",
           "Limits propagation and translocation (WSES 2022).", "Yayılmayı ve translokasyonu sınırlar (WSES 2022)."),
        _t("revascularisation", "Emergency revascularisation and/or laparotomy", "Acil revaskülarizasyon ve/veya laparotomi", "indicated",
           "Bowel viability depends on time.", "Bağırsak canlılığı zamana bağlıdır."),
        _t("delay_ct_lactate", "Delay imaging because the lactate is normal", "Laktat normal diye görüntülemeyi geciktirme", "contraindicated",
           "A normal lactate does not exclude ischaemia (WSES 2022).", "Normal laktat iskemiyi dışlamaz (WSES 2022)."),
    ], "guide": ("WSES", "Bala M et al. Acute mesenteric ischemia: updated WSES guidelines 2022",
                 "Perform CT angiography without delay when acute mesenteric ischaemia is suspected.",
                 "Akut mezenter iskemi düşünüldüğünde gecikmeden BT anjiyografi yapın.")},
    "tia": {"treatments": [
        _t("aspirin_300", "Aspirin 300 mg immediately", "Hemen 300 mg aspirin", "indicated",
           "NICE NG128: aspirin 300 mg unless contraindicated.", "NICE NG128: kontrendike değilse 300 mg aspirin."),
        _t("specialist_24h", "Specialist assessment within 24 h", "24 saat içinde uzman değerlendirmesi", "indicated",
           "NICE NG128.", "NICE NG128."),
        _t("discharge_no_plan", "Discharge without antiplatelet or follow-up", "Antiplatelet veya kontrol olmadan taburcu", "contraindicated",
           "Early stroke risk is highest in the first days.", "Erken inme riski ilk günlerde en yüksektir."),
    ], "guide": ("NICE", "NICE NG128 Stroke and transient ischaemic attack in over 16s",
                 "Offer aspirin 300 mg immediately to people with suspected TIA and refer for specialist assessment within 24 hours.",
                 "TİA şüphesinde hemen 300 mg aspirin verin ve 24 saat içinde uzmana yönlendirin.")},
    "gbs": {"treatments": [
        _t("fvc_monitor", "Serial FVC; ICU review if FVC below 20 mL/kg", "Seri FVC; FVC 20 mL/kg altındaysa YBÜ değerlendirmesi", "indicated",
           "Respiratory failure develops in about a quarter (EAN/PNS 2023).", "Hastaların yaklaşık dörtte birinde solunum yetmezliği gelişir (EAN/PNS 2023)."),
        _t("ivig", "IVIg 0.4 g/kg/day for 5 days (or plasma exchange)", "5 gün 0.4 g/kg/gün İVİG (veya plazmaferez)", "indicated",
           "Hastens recovery (EAN/PNS 2023).", "İyileşmeyi hızlandırır (EAN/PNS 2023)."),
        _t("steroid_gbs", "Corticosteroids", "Kortikosteroid", "contraindicated",
           "No benefit in GBS (EAN/PNS 2023).", "GBS'de yararı yoktur (EAN/PNS 2023)."),
    ], "guide": ("EAN/PNS", "van Doorn PA et al. EAN/PNS Guillain-Barre syndrome guideline 2023",
                 "Treat with IVIg or plasma exchange and monitor respiratory function closely.",
                 "İVİG veya plazmaferezle tedavi edin ve solunum fonksiyonunu yakından izleyin.")},
    "myasthenic_crisis": {"treatments": [
        _t("airway_niv", "NIV or intubation for respiratory failure", "Solunum yetmezliği için NIV veya entübasyon", "indicated",
           "Ventilatory failure is the threat.", "Asıl tehdit ventilatuvar yetmezliktir."),
        _t("ivig_plex", "IVIg or plasma exchange", "İVİG veya plazmaferez", "indicated",
           "International consensus 2016.", "Uluslararası uzlaşı 2016."),
        _t("aminoglycoside_mg", "Aminoglycoside, fluoroquinolone or magnesium", "Aminoglikozit, florokinolon veya magnezyum", "contraindicated",
           "Worsen neuromuscular transmission (Sanders 2016).", "Nöromüsküler iletimi bozar (Sanders 2016)."),
    ], "guide": ("Neurology", "Sanders DB et al. International consensus guidance for management of myasthenia gravis 2016",
                 "Treat myasthenic crisis with IVIg or plasma exchange and ventilatory support.",
                 "Miyastenik krizi İVİG veya plazmaferez ve solunum desteğiyle tedavi edin.")},
    "spinal_cord_compression": {"treatments": [
        _t("dexamethasone_16", "Dexamethasone 16 mg", "16 mg deksametazon", "indicated",
           "NICE NG234 for MSCC with neurological deficit.", "Nörolojik defisitli MSKB için NICE NG234."),
        _t("mri_24h", "Whole-spine MRI within 24 h", "24 saat içinde tüm omurga MR", "indicated",
           "Within 24 h if neurological symptoms (NICE NG234).", "Nörolojik belirti varsa 24 saat içinde (NICE NG234)."),
        _t("spinal_referral", "Urgent spinal surgery or radiotherapy referral", "Acil omurga cerrahisi veya radyoterapi konsültasyonu", "indicated",
           "Definitive decompression.", "Kesin dekompresyon."),
        _t("mobilise_unstable", "Mobilise before spinal stability is assessed", "Omurga stabilitesi değerlendirilmeden mobilize etme", "contraindicated",
           "Risk of further cord injury.", "Ek omurilik hasarı riski."),
    ], "guide": ("NICE", "NICE NG234 Spinal metastases and metastatic spinal cord compression 2023",
                 "Arrange MRI within 24 hours for suspected MSCC with neurological symptoms.",
                 "Nörolojik belirtili MSKB şüphesinde 24 saat içinde MR planlayın.")},
    "encephalitis": {"treatments": [
        _t("aciclovir", "IV aciclovir 10 mg/kg 8-hourly immediately", "Hemen 8 saatte bir İ.V. 10 mg/kg asiklovir", "indicated",
           "Start within 6 h of admission (ABN/BIA 2012).", "Yatıştan sonraki 6 saat içinde başlayın (ABN/BIA 2012)."),
        _t("ct_then_lp", "CT head then lumbar puncture when safe", "BT sonrası güvenliyse lomber ponksiyon", "indicated",
           "CSF confirms the diagnosis.", "BOS tanıyı doğrular."),
        _t("delay_aciclovir", "Delay aciclovir until the LP result", "LP sonucuna kadar asikloviri geciktirme", "contraindicated",
           "Delay worsens outcome (ABN/BIA 2012).", "Gecikme sonucu kötüleştirir (ABN/BIA 2012)."),
    ], "guide": ("ABN/BIA", "Solomon T et al. Management of suspected viral encephalitis in adults (ABN/BIA) 2012",
                 "Start IV aciclovir within 6 hours of admission in suspected encephalitis.",
                 "Ensefalit şüphesinde yatıştan sonraki 6 saat içinde İ.V. asiklovir başlayın.")},
    "tetanus": {"treatments": [
        _t("htig", "Human tetanus immunoglobulin", "İnsan tetanoz immünoglobulini", "indicated",
           "Neutralises unbound toxin (Yen 2019).", "Bağlanmamış toksini nötralize eder (Yen 2019)."),
        _t("metronidazole_debride", "Metronidazole and wound debridement", "Metronidazol ve yara debridmanı", "indicated",
           "Removes the toxin source.", "Toksin kaynağını uzaklaştırır."),
        _t("benzo_mag_quiet", "Benzodiazepine or magnesium for spasms in a quiet dark room", "Sessiz karanlık odada spazmlar için benzodiazepin veya magnezyum", "indicated",
           "Spasm and airway control.", "Spazm ve hava yolu kontrolü."),
        _t("stimulation", "Repeated stimulation in a noisy bay", "Gürültülü alanda tekrarlayan uyarım", "contraindicated",
           "Triggers spasms and laryngospasm.", "Spazm ve laringospazm tetikler."),
    ], "guide": ("Lancet", "Yen LM, Thwaites CL. Tetanus. Lancet 2019",
                 "Give antitoxin, debride the wound and control spasms.",
                 "Antitoksin verin, yarayı debride edin ve spazmları kontrol edin.")},
    "myxedema_coma": {"treatments": [
        _t("iv_levothyroxine_hc", "IV levothyroxine plus hydrocortisone after a cortisol sample", "Kortizol örneği sonrası İ.V. levotiroksin ve hidrokortizon", "indicated",
           "ATA 2014.", "ATA 2014."),
        _t("supportive_passive", "Passive rewarming, ventilatory support and glucose", "Pasif ısıtma, solunum desteği ve glukoz", "indicated",
           "Supportive care.", "Destek tedavisi."),
        _t("aggressive_rewarm", "Aggressive active external rewarming", "Agresif aktif dış ısıtma", "contraindicated",
           "Vasodilatation and hypotension (ATA 2014).", "Vazodilatasyon ve hipotansiyon (ATA 2014)."),
    ], "guide": ("ATA", "Jonklaas J et al. ATA guidelines for the treatment of hypothyroidism 2014",
                 "Treat myxoedema coma with IV thyroid hormone and glucocorticoid until adrenal insufficiency is excluded.",
                 "Miksödem komasını adrenal yetmezlik dışlanana kadar İ.V. tiroid hormonu ve glukokortikoidle tedavi edin.")},
    "hyponatremia": {"treatments": [
        _t("hypertonic_bolus", "150 mL 3 % hypertonic saline over 20 min, repeat up to twice", "20 dakikada 150 mL %3 hipertonik salin, iki kez tekrar", "indicated",
           "Aim for a 5 mmol/L rise in the first hour (European guideline 2014).", "İlk saatte 5 mmol/L artış hedefleyin (Avrupa kılavuzu 2014)."),
        _t("limit_correction", "Limit correction to 10 mmol/L in 24 h", "24 saatte düzeltmeyi 10 mmol/L ile sınırlayın", "indicated",
           "Prevents osmotic demyelination.", "Osmotik demiyelinizasyonu önler."),
        _t("rapid_correction", "Correct by more than 10 to 12 mmol/L in 24 h", "24 saatte 10-12 mmol/L'den fazla düzeltme", "contraindicated",
           "Osmotic demyelination risk (Spasovski 2014).", "Osmotik demiyelinizasyon riski (Spasovski 2014)."),
    ], "guide": ("ESE/ESICM/ERBP", "Spasovski G et al. Clinical practice guideline on hyponatraemia 2014",
                 "Give 150 mL 3 % hypertonic saline over 20 minutes for severe symptomatic hyponatraemia.",
                 "Ağır semptomatik hiponatremide 20 dakikada 150 mL %3 hipertonik salin verin.")},
    "pheochromocytoma": {"treatments": [
        _t("alpha_blockade", "IV alpha-blockade (phentolamine) first", "Önce İ.V. alfa blokaj (fentolamin)", "indicated",
           "Endocrine Society 2014.", "Endokrin Derneği 2014."),
        _t("hdu_art_line", "Arterial line and HDU monitoring", "Arter hattı ve yoğun izlem", "indicated",
           "Labile pressures.", "Değişken basınçlar."),
        _t("beta_first", "Beta-blocker before alpha-blockade", "Alfa blokajdan önce beta bloker", "contraindicated",
           "Unopposed alpha stimulation worsens hypertension (Endocrine Society 2014).", "Karşılanmamış alfa uyarımı hipertansiyonu kötüleştirir (Endokrin Derneği 2014)."),
    ], "guide": ("Endocrine Society", "Lenders JWM et al. Pheochromocytoma and paraganglioma guideline 2014",
                 "Block alpha receptors before beta receptors.",
                 "Beta reseptörlerden önce alfa reseptörleri bloke edin.")},
    "hyperkalemia_esrd": {"treatments": [
        _t("calcium", "IV calcium gluconate 10 % 30 mL for ECG changes", "EKG değişikliği için İ.V. %10 kalsiyum glukonat 30 mL", "indicated",
           "Stabilises the myocardium within minutes (UKKA 2023).", "Miyokardı dakikalar içinde stabilize eder (UKKA 2023)."),
        _t("insulin_dextrose", "Insulin 10 units with 25 g glucose IV", "İ.V. 10 ünite insülin ve 25 g glukoz", "indicated",
           "Shifts potassium into cells (UKKA 2023).", "Potasyumu hücre içine kaydırır (UKKA 2023)."),
        _t("urgent_dialysis", "Urgent haemodialysis", "Acil hemodiyaliz", "indicated",
           "Definitive removal in end-stage renal disease.", "Son dönem böbrek hastalığında kesin uzaklaştırma."),
        _t("k_fluids", "Potassium-containing IV fluids", "Potasyum içeren İ.V. sıvılar", "contraindicated",
           "Raises potassium further.", "Potasyumu daha da artırır."),
    ], "guide": ("UKKA", "UK Kidney Association: Treatment of Acute Hyperkalaemia in Adults 2023",
                 "Give IV calcium for hyperkalaemia with ECG changes, then insulin-glucose.",
                 "EKG değişikliği olan hiperkalemide İ.V. kalsiyum, ardından insülin-glukoz verin.")},
    "testicular_torsion": {"treatments": [
        _t("urology_exploration", "Immediate urology review and scrotal exploration", "Hemen üroloji değerlendirmesi ve skrotal eksplorasyon", "indicated",
           "Salvage falls after 6 h of symptoms (EAU 2023).", "Semptomların 6. saatinden sonra kurtarma oranı düşer (EAU 2023)."),
        _t("analgesia", "IV analgesia", "İ.V. analjezi", "indicated",
           "Comfort while theatre is arranged.", "Ameliyathane ayarlanırken rahatlık."),
        _t("await_ultrasound", "Delay surgery for a Doppler ultrasound", "Doppler USG için cerrahiyi geciktirme", "contraindicated",
           "Do not delay exploration for imaging (EAU 2023).", "Görüntüleme için eksplorasyonu geciktirmeyin (EAU 2023)."),
    ], "guide": ("EAU", "EAU Guidelines on Paediatric Urology 2023 (testicular torsion)",
                 "Testicular torsion is an emergency requiring immediate surgical exploration.",
                 "Testis torsiyonu acil cerrahi eksplorasyon gerektirir.")},
    "priapism": {"treatments": [
        _t("aspiration_phenylephrine", "Corporal aspiration then intracavernosal phenylephrine", "Korporal aspirasyon ardından intrakavernöz fenilefrin", "indicated",
           "First-line for ischaemic priapism (AUA/SMSNA 2022).", "İskemik priapizmde birinci basamak (AUA/SMSNA 2022)."),
        _t("penile_block", "Analgesia and penile block", "Analjezi ve penil blok", "indicated",
           "Comfort for the procedure.", "İşlem için rahatlık."),
        _t("wait_resolution", "Wait for spontaneous resolution beyond 4 h", "4 saati aşan kendiliğinden düzelme beklentisi", "contraindicated",
           "Ischaemia beyond 4 h causes fibrosis (AUA/SMSNA 2022).", "4 saati aşan iskemi fibroza yol açar (AUA/SMSNA 2022)."),
    ], "guide": ("AUA/SMSNA", "Bivalacqua TJ et al. AUA/SMSNA guideline on priapism 2022",
                 "Treat ischaemic priapism lasting more than 4 hours as an emergency.",
                 "4 saati aşan iskemik priapizmi acil olarak tedavi edin.")},
    "suicidal_ideation": {"treatments": [
        _t("safe_observation", "Safe environment and continuous observation", "Güvenli ortam ve sürekli gözlem", "indicated",
           "NICE NG225.", "NICE NG225."),
        _t("psychosocial_assessment", "Psychosocial assessment and safety plan with mental health liaison", "Ruh sağlığı ekibiyle psikososyal değerlendirme ve güvenlik planı", "indicated",
           "NICE NG225.", "NICE NG225."),
        _t("discharge_unassessed", "Discharge before psychosocial assessment", "Psikososyal değerlendirme öncesi taburcu", "contraindicated",
           "NICE NG225.", "NICE NG225."),
    ], "guide": ("NICE", "NICE NG225 Self-harm: assessment, management and preventing recurrence 2022",
                 "Offer a psychosocial assessment before discharge.",
                 "Taburculuktan önce psikososyal değerlendirme önerin.")},
    "acute_psychosis": {"treatments": [
        _t("organic_screen", "Exclude an organic cause (glucose, infection, intoxication, delirium)", "Organik nedeni dışlayın (glukoz, enfeksiyon, zehirlenme, deliryum)", "indicated",
           "NICE CG178.", "NICE CG178."),
        _t("deesc_oral", "De-escalation and oral antipsychotic if needed", "Yatıştırma ve gerekirse oral antipsikotik", "indicated",
           "NICE NG10.", "NICE NG10."),
        _t("high_dose_im_combo", "High-dose IM antipsychotic combination as the first step", "İlk adım olarak yüksek doz İ.M. antipsikotik kombinasyonu", "contraindicated",
           "Arrhythmia and dystonia risk (NICE NG10).", "Aritmi ve distoni riski (NICE NG10)."),
    ], "guide": ("NICE", "NICE CG178 Psychosis and schizophrenia in adults",
                 "Assess for physical causes of a first presentation of psychosis.",
                 "İlk psikoz başvurusunda fiziksel nedenleri değerlendirin.")},
    "serotonin_syndrome": {"treatments": [
        _t("stop_agent_cool", "Stop serotonergic drugs, supportive care and active cooling", "Serotonerjik ilaçları kesin, destek tedavisi ve aktif soğutma", "indicated",
           "Boyer 2005.", "Boyer 2005."),
        _t("benzo", "Benzodiazepines for agitation and clonus", "Ajitasyon ve klonus için benzodiazepin", "indicated",
           "Reduce muscle activity and heat.", "Kas aktivitesini ve ısıyı azaltır."),
        _t("restraint_antipsychotic", "Physical restraint or haloperidol", "Fiziksel tespit veya haloperidol", "contraindicated",
           "Isometric contraction raises temperature (Boyer 2005).", "İzometrik kasılma ateşi artırır (Boyer 2005)."),
    ], "guide": ("NEJM", "Boyer EW, Shannon M. The serotonin syndrome. NEJM 2005",
                 "Stop serotonergic agents, give benzodiazepines and cool; avoid physical restraint.",
                 "Serotonerjik ajanları kesin, benzodiazepin verin ve soğutun; fiziksel tespitten kaçının.")},
    "nms": {"treatments": [
        _t("stop_antipsychotic", "Stop the antipsychotic, cool and give IV fluids", "Antipsikotiği kesin, soğutun ve İ.V. sıvı verin", "indicated",
           "Berman 2011.", "Berman 2011."),
        _t("benzo_dantrolene", "Benzodiazepine; consider bromocriptine or dantrolene", "Benzodiazepin; bromokriptin veya dantrolen düşünün", "indicated",
           "Berman 2011.", "Berman 2011."),
        _t("more_antipsychotic", "Further antipsychotic for agitation", "Ajitasyon için ek antipsikotik", "contraindicated",
           "Worsens NMS.", "NMS'yi kötüleştirir."),
    ], "guide": ("Neurohospitalist", "Berman BD. Neuroleptic malignant syndrome: a review. Neurohospitalist 2011",
                 "Discontinue the causative agent and give supportive care.",
                 "Neden olan ajanı kesin ve destek tedavisi verin.")},
    "delirium_tremens": {"treatments": [
        _t("benzo_titrated", "IV benzodiazepine titrated to light sedation", "Hafif sedasyona titre İ.V. benzodiazepin", "indicated",
           "NICE CG100.", "NICE CG100."),
        _t("thiamine_iv", "IV thiamine (Pabrinex) before glucose", "Glukozdan önce İ.V. tiamin (Pabrinex)", "indicated",
           "Prevents Wernicke encephalopathy (NICE CG100).", "Wernicke ensefalopatisini önler (NICE CG100)."),
        _t("fluids_electrolytes", "IV fluids, magnesium and potassium", "İ.V. sıvı, magnezyum ve potasyum", "indicated",
           "Correct losses.", "Kayıpları düzeltir."),
        _t("antipsychotic_alone", "Antipsychotic as monotherapy", "Tek başına antipsikotik", "contraindicated",
           "Lowers the seizure threshold; benzodiazepines are first-line (NICE CG100).", "Nöbet eşiğini düşürür; benzodiazepin birinci basamaktır (NICE CG100)."),
    ], "guide": ("NICE", "NICE CG100 Alcohol-use disorders: diagnosis and management of physical complications",
                 "Offer a benzodiazepine for delirium tremens.",
                 "Deliryum tremenste benzodiazepin önerin.")},
    "tumor_lysis": {"treatments": [
        _t("hydration_tls", "IV hydration (3 L/m2/day) with a urine output target", "İdrar çıkışı hedefli İ.V. hidrasyon (3 L/m2/gün)", "indicated",
           "Howard 2011.", "Howard 2011."),
        _t("rasburicase", "Rasburicase (no G6PD deficiency)", "Rasburikaz (G6PD eksikliği yoksa)", "indicated",
           "Lowers uric acid within hours.", "Ürik asidi saatler içinde düşürür."),
        _t("treat_hyperk_renal", "Treat hyperkalaemia and refer to renal", "Hiperkalemiyi tedavi edin ve nefrolojiye danışın", "indicated",
           "Arrhythmia risk.", "Aritmi riski."),
        _t("potassium_fluids", "Potassium-containing fluids", "Potasyum içeren sıvılar", "contraindicated",
           "Hyperkalaemia.", "Hiperkalemi."),
    ], "guide": ("NEJM", "Howard SC et al. The tumor lysis syndrome. NEJM 2011",
                 "Hydrate aggressively and lower uric acid; monitor potassium.",
                 "Agresif hidrasyon yapın ve ürik asidi düşürün; potasyumu izleyin.")},
    "dic": {"treatments": [
        _t("treat_cause", "Treat the underlying cause (sepsis, obstetric, malignancy)", "Altta yatan nedeni tedavi edin (sepsis, obstetrik, malignite)", "indicated",
           "BCSH 2009: the cornerstone.", "BCSH 2009: temel taş."),
        _t("blood_products_dic", "Platelets, FFP and cryoprecipitate if bleeding", "Kanama varsa trombosit, TDP ve kriyopresipitat", "indicated",
           "Product support for bleeding (BCSH 2009).", "Kanamada ürün desteği (BCSH 2009)."),
        _t("txa_dic", "Tranexamic acid in sepsis-associated DIC", "Sepsise bağlı YDP'de traneksamik asit", "contraindicated",
           "Generally not recommended (BCSH 2009).", "Genellikle önerilmez (BCSH 2009)."),
    ], "guide": ("BCSH", "Levi M et al. Guidelines for the diagnosis and management of DIC. Br J Haematol 2009",
                 "Treat the underlying condition; give blood products to bleeding patients.",
                 "Altta yatan durumu tedavi edin; kanayan hastalara kan ürünü verin.")},
    "acute_leukemia": {"treatments": [
        _t("haematology_urgent", "Urgent haematology referral and blood film", "Acil hematoloji konsültasyonu ve periferik yayma", "indicated",
           "ELN 2022.", "ELN 2022."),
        _t("tls_prophylaxis", "Hydration and tumour lysis prophylaxis", "Hidrasyon ve tümör lizis profilaksisi", "indicated",
           "Prevents TLS.", "TLS'yi önler."),
        _t("transfuse_hyperleuk", "Red cell transfusion in hyperleukocytosis", "Hiperlökositozda eritrosit transfüzyonu", "contraindicated",
           "Worsens hyperviscosity.", "Hiperviskoziteyi kötüleştirir."),
    ], "guide": ("ELN", "Dohner H et al. ELN 2022 recommendations for AML. Blood 2022",
                 "Refer new acute leukaemia urgently and prevent tumour lysis.",
                 "Yeni akut lösemiyi acilen yönlendirin ve tümör lizisini önleyin.")},
    "hemophilia_bleed": {"treatments": [
        _t("factor_now", "Factor concentrate immediately, before imaging", "Görüntülemeden önce hemen faktör konsantresi", "indicated",
           "WFH 2020: treat suspected bleeds without delay.", "WFH 2020: şüpheli kanamayı gecikmeden tedavi edin."),
        _t("haemophilia_centre", "Contact the haemophilia centre", "Hemofili merkezine danışın", "indicated",
           "Dose and monitoring.", "Doz ve izlem."),
        _t("im_nsaid", "IM injections or NSAIDs", "İ.M. enjeksiyon veya NSAİİ", "contraindicated",
           "Haematoma and platelet dysfunction (WFH 2020).", "Hematom ve trombosit disfonksiyonu (WFH 2020)."),
    ], "guide": ("WFH", "Srivastava A et al. WFH Guidelines for the Management of Hemophilia 2020",
                 "Give factor replacement as soon as a serious bleed is suspected.",
                 "Ciddi kanama düşünüldüğünde hemen faktör replasmanı yapın.")},
    "transfusion_reaction": {"treatments": [
        _t("stop_transfusion", "Stop the transfusion and keep the line open with saline", "Transfüzyonu durdurun, hattı salinle açık tutun", "indicated",
           "BSH 2012 acute transfusion reactions.", "BSH 2012 akut transfüzyon reaksiyonları."),
        _t("im_adrenaline", "IM adrenaline 0.5 mg if anaphylaxis features", "Anafilaksi bulgusu varsa İ.M. 0.5 mg adrenalin", "indicated",
           "RCUK 2021.", "RCUK 2021."),
        _t("report_unit", "Return the unit and report to the blood bank and SHOT", "Üniteyi iade edin, kan bankasına ve SHOT'a bildirin", "indicated",
           "Haemovigilance.", "Hemovijilans."),
        _t("continue_slower", "Continue the transfusion at a slower rate", "Transfüzyona daha yavaş hızda devam", "contraindicated",
           "Continued exposure worsens the reaction (BSH 2012).", "Maruziyetin sürmesi reaksiyonu kötüleştirir (BSH 2012)."),
    ], "guide": ("BSH", "Tinegate H et al. Guideline on the investigation and management of acute transfusion reactions. Br J Haematol 2012",
                 "Stop the transfusion immediately when a severe reaction is suspected.",
                 "Ağır reaksiyon düşünüldüğünde transfüzyonu hemen durdurun.")},
    "ovarian_torsion": {"treatments": [
        _t("gyn_laparoscopy", "Urgent gynaecology laparoscopy and detorsion", "Acil jinekoloji laparoskopisi ve detorsiyon", "indicated",
           "ACOG CO 783.", "ACOG CO 783."),
        _t("analgesia_antiemetic", "IV analgesia and antiemetic", "İ.V. analjezi ve antiemetik", "indicated",
           "Comfort.", "Rahatlık."),
        _t("discharge_doppler", "Discharge because Doppler flow is present", "Doppler akım var diye taburcu", "contraindicated",
           "Flow does not exclude torsion (ACOG CO 783).", "Akım torsiyonu dışlamaz (ACOG CO 783)."),
    ], "guide": ("ACOG", "ACOG Committee Opinion 783 Adnexal torsion in adolescents 2019",
                 "Proceed to surgery when torsion is suspected; Doppler flow does not exclude it.",
                 "Torsiyon düşünülüyorsa cerrahiye gidin; Doppler akımı torsiyonu dışlamaz.")},
    "eclampsia": {"treatments": [
        _t("magnesium_load", "Magnesium sulfate 4 g IV over 5 to 15 min, then 1 g/h", "5-15 dakikada İ.V. 4 g magnezyum sülfat, ardından 1 g/saat", "indicated",
           "Prevents recurrent fits better than diazepam (Eclampsia Trial 1995).", "Tekrarlayan nöbeti diazepamdan iyi önler (Eklampsi Çalışması 1995)."),
        _t("antihypertensive", "IV labetalol or hydralazine for SBP 160 or more", "SKB 160 ve üzerinde İ.V. labetalol veya hidralazin", "indicated",
           "NICE NG133.", "NICE NG133."),
        _t("left_lateral_airway", "Left lateral position, airway and oxygen", "Sol lateral pozisyon, hava yolu ve oksijen", "indicated",
           "Protects the airway and uterine flow.", "Hava yolunu ve uterin akımı korur."),
        _t("diazepam_first", "Diazepam or phenytoin instead of magnesium", "Magnezyum yerine diazepam veya fenitoin", "contraindicated",
           "Inferior to magnesium (Eclampsia Trial 1995).", "Magnezyumdan daha az etkili (Eklampsi Çalışması 1995)."),
    ], "guide": ("NICE", "NICE NG133 Hypertension in pregnancy",
                 "Give magnesium sulfate to women with eclampsia.",
                 "Eklampside magnezyum sülfat verin.")},
    "placental_abruption": {"treatments": [
        _t("resus_mhp", "Major obstetric haemorrhage protocol with left lateral tilt", "Sol lateral tilt ile majör obstetrik kanama protokolü", "indicated",
           "RCOG GTG 63.", "RCOG GTG 63."),
        _t("ctg_delivery", "Continuous CTG and urgent delivery decision", "Sürekli NST ve acil doğum kararı", "indicated",
           "Delivery is definitive (RCOG GTG 63).", "Doğum kesin tedavidir (RCOG GTG 63)."),
        _t("tocolysis", "Tocolysis", "Tokoliz", "contraindicated",
           "Contraindicated in abruption (RCOG GTG 63).", "Dekolmanda kontrendikedir (RCOG GTG 63)."),
    ], "guide": ("RCOG", "RCOG Green-top Guideline 63 Antepartum haemorrhage",
                 "Resuscitate and expedite delivery when abruption compromises mother or fetus.",
                 "Dekolman anne veya fetüsü tehdit ediyorsa resüsite edin ve doğumu hızlandırın.")},
    "open_fracture": {"treatments": [
        _t("iv_abx_1h", "IV antibiotics within 1 h of injury (co-amoxiclav or cefuroxime)", "Yaralanmadan sonra 1 saat içinde İ.V. antibiyotik (ko-amoksiklav veya sefuroksim)", "indicated",
           "BOAST 4: within 1 h.", "BOAST 4: 1 saat içinde."),
        _t("photo_dressing_splint", "Photograph, saline-soaked dressing, splint and tetanus status", "Fotoğraf, salinli pansuman, atel ve tetanoz durumu", "indicated",
           "BOAST 4.", "BOAST 4."),
        _t("ed_washout", "Formal washout in the ED", "Acil serviste formal yıkama", "contraindicated",
           "Debridement belongs in theatre (BOAST 4).", "Debridman ameliyathanede yapılır (BOAST 4)."),
    ], "guide": ("BOA", "BOAST 4 The management of severe open lower limb fractures",
                 "Give IV antibiotics within 1 hour of injury.",
                 "Yaralanmadan sonraki 1 saat içinde İ.V. antibiyotik verin.")},
    "tca_overdose": {"treatments": [
        _t("sodium_bicarb", "IV sodium bicarbonate 8.4 % 50 to 100 mL for QRS above 100 ms or arrhythmia", "QRS 100 ms üzerinde veya aritmide İ.V. %8.4 sodyum bikarbonat 50-100 mL", "indicated",
           "AHA 2023 toxicology.", "AHA 2023 toksikoloji."),
        _t("airway_benzo", "Airway protection; benzodiazepine for seizures", "Hava yolu koruması; nöbet için benzodiazepin", "indicated",
           "Seizures worsen acidosis.", "Nöbet asidozu kötüleştirir."),
        _t("physostigmine_flumazenil", "Physostigmine or flumazenil", "Fizostigmin veya flumazenil", "contraindicated",
           "Asystole and seizures in TCA poisoning (AHA 2023).", "TSA zehirlenmesinde asistoli ve nöbet (AHA 2023)."),
    ], "guide": ("AHA", "2023 AHA Focused Update on Poisoning (sodium channel blockers)",
                 "Give sodium bicarbonate for QRS widening or ventricular arrhythmia from tricyclic poisoning.",
                 "Trisiklik zehirlenmesine bağlı QRS genişlemesi veya ventriküler aritmide sodyum bikarbonat verin.")},
    "anticholinergic_tox": {"treatments": [
        _t("benzo_cooling", "Benzodiazepine, cooling and supportive care", "Benzodiazepin, soğutma ve destek tedavisi", "indicated",
           "Dawson 2016.", "Dawson 2016."),
        _t("physostigmine_expert", "Physostigmine with toxicology advice (normal QRS)", "Toksikoloji danışmanlığıyla fizostigmin (QRS normal)", "indicated",
           "Reverses delirium (Dawson 2016).", "Deliryumu geri çevirir (Dawson 2016)."),
        _t("haloperidol", "Haloperidol for agitation", "Ajitasyon için haloperidol", "contraindicated",
           "Anticholinergic and lowers the seizure threshold.", "Antikolinerjik etkili ve nöbet eşiğini düşürür."),
    ], "guide": ("BJCP", "Dawson AH, Buckley NA. Pharmacological management of anticholinergic delirium. Br J Clin Pharmacol 2016",
                 "Use benzodiazepines first; physostigmine with expert advice.",
                 "Önce benzodiazepin; uzman önerisiyle fizostigmin.")},
    "rhabdomyolysis": {"treatments": [
        _t("fluids_uo", "IV crystalloid targeting urine output 200 to 300 mL/h", "200-300 mL/saat idrar hedefli İ.V. kristaloid", "indicated",
           "Bosch 2009.", "Bosch 2009."),
        _t("ck_k_monitor", "Monitor CK, potassium and creatinine; treat hyperkalaemia", "CK, potasyum ve kreatinini izleyin; hiperkalemiyi tedavi edin", "indicated",
           "Arrhythmia and AKI risk.", "Aritmi ve ABH riski."),
        _t("nephrotoxins", "NSAIDs or other nephrotoxins", "NSAİİ veya diğer nefrotoksinler", "contraindicated",
           "Worsen AKI.", "ABH'yi kötüleştirir."),
    ], "guide": ("NEJM", "Bosch X et al. Rhabdomyolysis and acute kidney injury. NEJM 2009",
                 "Start early aggressive fluid resuscitation.",
                 "Erken agresif sıvı resüsitasyonu başlatın.")},
    "salicylate_od": {"treatments": [
        _t("bicarb_alkalinise", "IV sodium bicarbonate to a urine pH of 7.5 to 8.5", "İdrar pH 7.5-8.5 hedefli İ.V. sodyum bikarbonat", "indicated",
           "Enhances elimination (EXTRIP 2015).", "Atılımı artırır (EXTRIP 2015)."),
        _t("charcoal_levels", "Activated charcoal if within 1 h; serial salicylate levels", "1 saat içindeyse aktif kömür; seri salisilat düzeyi", "indicated",
           "Absorption continues for hours.", "Emilim saatlerce sürer."),
        _t("haemodialysis_referral", "Haemodialysis referral if severe", "Ağırsa hemodiyaliz konsültasyonu", "indicated",
           "EXTRIP 2015 criteria.", "EXTRIP 2015 ölçütleri."),
        _t("intubate_no_hypervent", "Intubate without matching the patient's minute ventilation", "Hastanın dakika ventilasyonunu karşılamadan entübasyon", "contraindicated",
           "Acidaemia worsens and can cause arrest (EXTRIP 2015).", "Asidemi kötüleşir ve arreste yol açabilir (EXTRIP 2015)."),
    ], "guide": ("EXTRIP", "Juurlink DN et al. EXTRIP recommendations for salicylate poisoning 2015",
                 "Use extracorporeal treatment in severe salicylate poisoning.",
                 "Ağır salisilat zehirlenmesinde ekstrakorporeal tedavi kullanın.")},
    "organophosphate_poisoning": {"treatments": [
        _t("atropine_double", "Atropine 1 to 2 mg IV, doubling every 5 min until the chest is clear", "Göğüs temizlenene kadar 5 dakikada bir ikiye katlanan İ.V. 1-2 mg atropin", "indicated",
           "Targets: clear chest, HR above 80, SBP above 80 (Eddleston 2008).", "Hedefler: temiz göğüs, KH 80 üzeri, SKB 80 üzeri (Eddleston 2008)."),
        _t("decontaminate_ppe", "Decontaminate with PPE and remove clothing", "KKD ile dekontaminasyon ve kıyafetleri çıkarma", "indicated",
           "Stops ongoing absorption.", "Süren emilimi durdurur."),
        _t("suxamethonium", "Suxamethonium for intubation", "Entübasyon için süksinilkolin", "contraindicated",
           "Prolonged paralysis (Eddleston 2008).", "Uzamış paralizi (Eddleston 2008)."),
    ], "guide": ("Lancet", "Eddleston M et al. Management of acute organophosphorus pesticide poisoning. Lancet 2008",
                 "Give atropine rapidly, doubling the dose until atropinisation.",
                 "Atropinizasyona kadar dozu ikiye katlayarak hızla atropin verin.")},
}
CONDITION_FIXTURES.update(ESI12_FIXTURES)

# Existing fixtures gain the definitive row the 06b course rule needs.
CONDITION_FIXTURES["ectopic_pregnancy"]["treatments"].append(_t(
    "emergency_surgery", "Emergency laparoscopy or laparotomy (gynaecology)", "Acil laparoskopi veya laparotomi (jinekoloji)", "indicated",
    "Ruptured ectopic pregnancy with haemodynamic instability needs surgery (NICE NG126).",
    "Hemodinamik instabiliteli rüptüre ektopik gebelik cerrahi gerektirir (NICE NG126)."))


# =========================================================================== #
# Review 06b: the dynamic course rule library.                                 #
#                                                                              #
# A rule says how a disease behaves, not what a case contains: the case is     #
# still generated on request, and the Director (server/orchestration/course.py)#
# runs the rule against what the learner does. Each rule has                   #
#                                                                              #
# * a severity process: s0 at arrival, rise per hour while untreated           #
#   (``rate_h``), fall per hour once every disease-modifying group is met      #
#   (``recover_h``) after ``lag_min``; vitals move from the patient's own      #
#   arrival values toward ``peri`` (severity 1, peri-arrest) or ``well``;      #
# * treatment groups (``groups``): all-of requirements, each group met by a   #
#   case row code or a treatment class, antimicrobials only with adequate     #
#   spectrum (``needs``);                                                      #
# * guideline targets (``targets``) scored against the group, separate from   #
#   the physiological consequence;                                             #
# * branches (new diagnoses), seeded hazards, row-specific harms and exam     #
#   findings that appear over time.                                            #
#                                                                              #
# Rates, anchors and seeded probabilities that no guideline states as a       #
# number are simulation design choices (06b section 5 conventions) and are    #
# marked ``"basis": "design"`` on the target or noted in COURSE_SOURCES.       #
# web/src/domain/courseTables.generated.ts is generated from these tables     #
# (scripts/gen_course_tables.py) and a test diffs the two.                    #
# =========================================================================== #

SSC21 = "SSC 2021 https://doi.org/10.1097/CCM.0000000000005337"
NG253 = "NICE NG253 https://www.nice.org.uk/guidance/ng253"
NG240 = "NICE NG240 https://www.nice.org.uk/guidance/ng240"
NG250 = "NICE NG250 https://www.nice.org.uk/guidance/ng250"
NG111 = "NICE NG111 https://www.nice.org.uk/guidance/ng111"
JBDS23 = ("JBDS-IP DKA 2023 https://abcd.care/sites/default/files/site_uploads/JBDS_Guidelines_Current/"
          "JBDS_02_DKA_Guideline_with_QR_code_March_2023.pdf")
ADA24 = "ADA/EASD hyperglycaemic crises 2024 https://doi.org/10.2337/dci24-0032"
ESC23 = "ESC 2023 ACS https://doi.org/10.1093/eurheartj/ehad191"
ESC19PE = "ESC 2019 PE https://doi.org/10.1093/eurheartj/ehz405"
ESC21HF = "ESC 2021 HF https://doi.org/10.1093/eurheartj/ehab368"
RCUK21 = "RCUK 2021 https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment"
ERC21 = "ERC 2021 ALS https://doi.org/10.1016/j.resuscitation.2021.02.009"
ERC21SC = "ERC 2021 special circumstances https://doi.org/10.1016/j.resuscitation.2021.02.011"
BTS17 = "BTS 2017 oxygen https://doi.org/10.1136/thoraxjnl-2016-209729"
ESI_HB = "ESI v4 handbook https://www.ena.org/enau/education/esi"

_MIN_LABEL = {"en": "", "tr": ""}


def _c(k: str, op: str, v: Any) -> dict[str, Any]:
    """One condition: state key, comparison, value (all conditions in a list are ANDed)."""
    return {"k": k, "op": op, "v": v}


def _grp(gid: str, codes: tuple = (), classes: tuple = (), *, needs: tuple = (), modifies: bool = True,
         active_min: int | None = None, recover_h: float | None = None, lag_min: int | None = None,
         en: str = "", tr: str = "") -> dict[str, Any]:
    return {"id": gid, "codes": list(codes), "classes": list(classes), "needs": list(needs), "modifies": modifies,
            "active_min": active_min, "recover_h": recover_h, "lag_min": lag_min, "label_en": en, "label_tr": tr}


def _tgt(tid: str, group: str, by_min: int, source: str, *, basis: str = "guideline") -> dict[str, Any]:
    return {"id": tid, "group": group, "by_min": by_min, "source": source, "basis": basis}


def _br(bid: str, to: str, when: list, *, p: float = 1.0, window: tuple | None = None, supersede: bool = True,
        s_start: float | None = None, lactate_min: float | None = None, arrest: str | None = None,
        rate_h: float | None = None, why_en: str, why_tr: str, say_en: str = "", say_tr: str = "") -> dict[str, Any]:
    return {"id": bid, "to": to, "when": when, "p": p, "window": list(window) if window else None,
            "supersede": supersede, "s_start": s_start, "lactate_min": lactate_min, "arrest": arrest, "rate_h": rate_h,
            "why_en": why_en, "why_tr": why_tr, "say_en": say_en, "say_tr": say_tr}


def _fd(fid: str, exam: str, when: list, en: str, tr: str) -> dict[str, Any]:
    return {"id": fid, "exam": exam, "when": when, "en": en, "tr": tr}


def _harm(effects: dict | None = None, *, onset_min: int = 5, rate_mult: float = 1.0, arrest: str | None = None,
          p: float = 1.0, branch: str | None = None, en: str, tr: str) -> dict[str, Any]:
    """Specific harm of a contraindicated row (replaces the old generic HR +12, SBP -10)."""
    return {"effects": effects or {}, "onset_min": onset_min, "rate_mult": rate_mult, "arrest": arrest, "p": p,
            "branch": branch, "en": en, "tr": tr}


# Vitals at severity 1 (``peri``) and at full recovery (``well``) per pattern.
# Absolute adult values; keys left out are not moved by the disease (DKA and
# meningitis do not desaturate, review 06b F14).
COURSE_PATTERNS: dict[str, dict[str, Any]] = {
    "distributive_shock": {
        "s0": 0.5, "rate_h": 0.26, "recover_h": 0.15, "floor": 0.3, "lag_min": 60, "arrest_rhythm": "PEA",
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 145, "systolic": 58, "diastolic": 30, "rr": 34, "spo2": 89, "gcs": 9, "crt": 6, "mottle": 4, "urine": 5},
        "well": {"hr": 92, "systolic": 112, "diastolic": 66, "rr": 18, "spo2": 96, "gcs": 15, "crt": 2, "mottle": 0, "urine": 50},
        "bedside0": {"gcs": 14, "crt": 5, "mottle": 2, "urine": 15, "lactate": 5.0},
    },
    "sepsis": {
        "s0": 0.3, "rate_h": 0.3, "recover_h": 0.1, "floor": 0.15, "lag_min": 60, "arrest_rhythm": "PEA",
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 135, "systolic": 80, "diastolic": 45, "rr": 30, "spo2": 92, "gcs": 13, "crt": 4, "mottle": 2, "urine": 15},
        "well": {"hr": 88, "systolic": 118, "diastolic": 70, "rr": 16, "spo2": 97, "gcs": 15, "crt": 2, "mottle": 0, "urine": 50},
        "bedside0": {"gcs": 15, "crt": 3, "mottle": 0, "urine": 40, "lactate": 2.8},
    },
    "infection_local": {
        "s0": 0.3, "rate_h": 0.1, "recover_h": 0.05, "floor": 0.2, "lag_min": 60, "arrest_rhythm": None,
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 132, "systolic": 100, "diastolic": 58, "rr": 26, "tempC": 39.8, "gcs": 14},
        "well": {"hr": 85, "systolic": 124, "diastolic": 76, "rr": 16, "tempC": 37.2, "gcs": 15},
        "bedside0": {"lactate": 1.6},
    },
    "pneumonia": {
        "s0": 0.3, "rate_h": 0.1, "recover_h": 0.05, "floor": 0.2, "lag_min": 60, "arrest_rhythm": "PEA",
        "fluid": "responsive", "o2_response": 0.5,
        "peri": {"hr": 136, "systolic": 92, "diastolic": 52, "rr": 40, "spo2": 80, "gcs": 12},
        "well": {"hr": 88, "systolic": 120, "diastolic": 72, "rr": 18, "spo2": 95, "gcs": 15},
        "bedside0": {"lactate": 1.8},
    },
    "haemorrhagic_shock": {
        "s0": 0.45, "rate_h": 0.3, "recover_h": 0.3, "floor": 0.25, "lag_min": 15, "arrest_rhythm": "PEA",
        "fluid": "haemorrhage", "fluid_limit_ml": 1000, "o2_response": 0.4,
        "peri": {"hr": 150, "systolic": 55, "diastolic": 30, "rr": 32, "spo2": 92, "gcs": 9, "crt": 6, "mottle": 4, "urine": 5},
        "well": {"hr": 90, "systolic": 115, "diastolic": 70, "rr": 16, "spo2": 97, "gcs": 15, "crt": 2, "mottle": 0, "urine": 50},
        "bedside0": {"gcs": 14, "crt": 4, "mottle": 1, "urine": 20, "lactate": 4.0},
    },
    "obstructive_shock": {
        "s0": 0.55, "rate_h": 0.6, "recover_h": 3.0, "floor": 0.2, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.3,
        "peri": {"hr": 150, "systolic": 50, "diastolic": 30, "rr": 38, "spo2": 78, "gcs": 8, "crt": 6, "mottle": 3},
        "well": {"hr": 95, "systolic": 115, "diastolic": 70, "rr": 18, "spo2": 95, "gcs": 15, "crt": 2, "mottle": 0},
        "bedside0": {"crt": 4, "mottle": 1, "lactate": 3.5},
    },
    "cardiogenic": {
        "s0": 0.5, "rate_h": 0.2, "recover_h": 0.2, "floor": 0.3, "lag_min": 30, "arrest_rhythm": "VF",
        "fluid": "pulmonary_oedema", "o2_response": 0.35,
        "peri": {"hr": 125, "systolic": 62, "diastolic": 40, "rr": 34, "spo2": 84, "gcs": 10, "crt": 5, "mottle": 3, "urine": 5},
        "well": {"hr": 85, "systolic": 115, "diastolic": 70, "rr": 18, "spo2": 95, "gcs": 15, "crt": 2, "mottle": 0, "urine": 50},
        "bedside0": {"crt": 4, "mottle": 1, "urine": 20, "lactate": 3.0},
    },
    "acute_coronary": {
        "s0": 0.4, "rate_h": 0.06, "recover_h": 3.0, "floor": 0.1, "lag_min": 0, "arrest_rhythm": "VF",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"hr": 118, "systolic": 88, "diastolic": 55, "rr": 26, "spo2": 92, "pain": 9},
        "well": {"hr": 78, "systolic": 125, "diastolic": 76, "rr": 16, "spo2": 97, "pain": 1},
        "bedside0": {"pain": 8},
    },
    "pulmonary_oedema": {
        "s0": 0.4, "rate_h": 0.3, "recover_h": 0.4, "floor": 0.15, "lag_min": 10, "arrest_rhythm": "PEA",
        "fluid": "pulmonary_oedema", "o2_response": 0.35,
        "peri": {"hr": 135, "systolic": 175, "diastolic": 100, "rr": 36, "spo2": 71, "gcs": 9},
        "well": {"hr": 92, "systolic": 135, "diastolic": 80, "rr": 18, "spo2": 95, "gcs": 15},
    },
    "pe_intermediate": {
        "s0": 0.4, "rate_h": 0.05, "recover_h": 0.0, "floor": 0.4, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "rv", "o2_response": 0.5,
        "peri": {"hr": 146, "systolic": 92, "diastolic": 58, "rr": 34, "spo2": 80},
        "well": {"hr": 95, "systolic": 118, "diastolic": 72, "rr": 18, "spo2": 95},
    },
    "hypoxic_resp": {
        "s0": 0.4, "rate_h": 0.15, "recover_h": 0.2, "floor": 0.2, "lag_min": 30, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.5,
        "peri": {"hr": 140, "systolic": 100, "diastolic": 58, "rr": 40, "spo2": 70, "gcs": 8},
        "well": {"hr": 90, "systolic": 120, "diastolic": 72, "rr": 18, "spo2": 95, "gcs": 15},
    },
    "hypercapnic_resp": {
        "s0": 0.4, "rate_h": 0.15, "recover_h": 0.3, "floor": 0.2, "lag_min": 30, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.5, "hypercapnic": True,
        "peri": {"hr": 125, "systolic": 150, "diastolic": 85, "rr": 10, "spo2": 80, "gcs": 7},
        "well": {"hr": 90, "systolic": 130, "diastolic": 78, "rr": 18, "spo2": 92, "gcs": 15},
    },
    "bronchospasm": {
        "s0": 0.4, "rate_h": 0.25, "recover_h": 0.6, "floor": 0.15, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.5,
        "peri": {"hr": 140, "systolic": 100, "diastolic": 60, "rr": 36, "spo2": 82, "gcs": 10},
        "well": {"hr": 90, "systolic": 120, "diastolic": 75, "rr": 16, "spo2": 97, "gcs": 15},
    },
    "upper_airway": {
        "s0": 0.5, "rate_h": 1.11, "recover_h": 1.5, "floor": 0.05, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "responsive", "o2_response": 0.4, "resolve_below": 0.2,
        "peri": {"hr": 150, "systolic": 45, "diastolic": 25, "rr": 36, "spo2": 72, "gcs": 7, "crt": 6, "mottle": 3},
        "well": {"hr": 90, "systolic": 118, "diastolic": 72, "rr": 16, "spo2": 97, "gcs": 15, "crt": 2, "mottle": 0},
        "bedside0": {"crt": 4, "lactate": 3.0},
    },
    "neuro_infective": {
        "s0": 0.3, "rate_h": 0.3, "recover_h": 0.05, "floor": 0.25, "lag_min": 60, "arrest_rhythm": None,
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 125, "systolic": 105, "diastolic": 62, "gcs": 8, "tempC": 40.0},
        "well": {"hr": 90, "systolic": 120, "diastolic": 72, "gcs": 15, "tempC": 37.5},
        "bedside0": {"gcs": 14},
    },
    "neuro_bleed": {
        "s0": 0.35, "rate_h": 0.12, "recover_h": 0.0, "floor": 0.35, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"gcs": 5, "hr": 55, "systolic": 200, "diastolic": 110, "rr": 10},
        "well": {"gcs": 15, "hr": 80, "systolic": 150, "diastolic": 85, "rr": 16},
        "bedside0": {"gcs": 13},
    },
    "neuro_ischaemic": {
        "s0": 0.4, "rate_h": 0.2, "recover_h": 0.1, "floor": 0.2, "lag_min": 30, "arrest_rhythm": None,
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"gcs": 11}, "well": {"gcs": 15},
    },
    "seizure": {
        "s0": 0.6, "rate_h": 0.3, "recover_h": 3.0, "floor": 0.05, "lag_min": 2, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.4, "resolve_below": 0.2,
        "peri": {"gcs": 3, "hr": 145, "systolic": 165, "diastolic": 95, "rr": 10, "spo2": 78, "tempC": 38.6},
        "well": {"gcs": 14, "hr": 90, "systolic": 130, "diastolic": 80, "rr": 16, "spo2": 96, "tempC": 37.2},
        "bedside0": {"gcs": 3},
    },
    "metabolic_coma": {
        "s0": 0.4, "rate_h": 0.1, "recover_h": 0.6, "floor": 0.05, "lag_min": 10, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"gcs": 5, "hr": 110, "rr": 10, "spo2": 88},
        "well": {"gcs": 15, "hr": 85, "rr": 16, "spo2": 97},
        "bedside0": {"gcs": 12},
    },
    "dka": {
        "s0": 0.4, "rate_h": 0.15, "recover_h": 0.15, "floor": 0.15, "lag_min": 60, "arrest_rhythm": "PEA",
        "fluid": "responsive", "fluid_persistent": True, "o2_response": 0.4, "metabolic": "dka",
        "peri": {"hr": 138, "rr": 36, "systolic": 82, "diastolic": 48, "gcs": 11},
        "well": {"hr": 90, "rr": 16, "systolic": 120, "diastolic": 72, "gcs": 15},
        "bedside0": {"cbg": 28.0, "k": 5.3, "lactate": 2.0},
    },
    "metabolic_slow": {
        "s0": 0.3, "rate_h": 0.06, "recover_h": 0.1, "floor": 0.15, "lag_min": 60, "arrest_rhythm": None,
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 125, "systolic": 85, "diastolic": 50, "gcs": 10, "urine": 5},
        "well": {"hr": 85, "systolic": 120, "diastolic": 72, "gcs": 15, "urine": 50},
    },
    "brady": {
        "s0": 0.5, "rate_h": 0.25, "recover_h": 4.0, "floor": 0.1, "lag_min": 0, "arrest_rhythm": "asystole",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"hr": 24, "systolic": 55, "diastolic": 32, "gcs": 8, "crt": 5},
        "well": {"hr": 72, "systolic": 118, "diastolic": 72, "gcs": 15, "crt": 2},
    },
    "tachy_arrhythmia": {
        "s0": 0.45, "rate_h": 0.2, "recover_h": 6.0, "floor": 0.05, "lag_min": 0, "arrest_rhythm": "VF",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"hr": 210, "systolic": 65, "diastolic": 40, "gcs": 10, "crt": 5},
        "well": {"hr": 88, "systolic": 120, "diastolic": 75, "gcs": 15, "crt": 2},
    },
    "hyperthermia": {
        "s0": 0.5, "rate_h": 0.2, "recover_h": 1.0, "floor": 0.1, "lag_min": 0, "arrest_rhythm": "VF",
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"tempC": 42.5, "hr": 165, "systolic": 70, "diastolic": 40, "rr": 36, "gcs": 6},
        "well": {"tempC": 37.8, "hr": 95, "systolic": 120, "diastolic": 72, "rr": 18, "gcs": 15},
    },
    "hypothermic": {
        "s0": 0.6, "rate_h": 0.05, "recover_h": 0.18, "floor": 0.05, "lag_min": 0, "arrest_rhythm": "VF",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"tempC": 26.0, "hr": 25, "systolic": 55, "diastolic": 30, "rr": 5, "gcs": 5},
        "well": {"tempC": 36.0, "hr": 70, "systolic": 118, "diastolic": 70, "rr": 14, "gcs": 15},
    },
    "tox_cardiac": {
        "s0": 0.5, "rate_h": 0.3, "recover_h": 0.6, "floor": 0.15, "lag_min": 5, "arrest_rhythm": "VF",
        "fluid": "responsive", "o2_response": 0.4,
        "peri": {"hr": 150, "systolic": 60, "diastolic": 35, "rr": 8, "gcs": 4},
        "well": {"hr": 90, "systolic": 118, "diastolic": 72, "rr": 16, "gcs": 15},
    },
    "tox_resp_depression": {
        "s0": 0.6, "rate_h": 0.4, "recover_h": 3.0, "floor": 0.05, "lag_min": 0, "arrest_rhythm": "PEA",
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"rr": 3, "spo2": 60, "gcs": 3, "hr": 50, "systolic": 80, "diastolic": 45},
        "well": {"rr": 16, "spo2": 97, "gcs": 15, "hr": 80, "systolic": 120, "diastolic": 75},
    },
    "hypertensive_crisis": {
        "s0": 0.4, "rate_h": 0.15, "recover_h": 0.3, "floor": 0.15, "lag_min": 10, "arrest_rhythm": None,
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"systolic": 235, "diastolic": 135, "hr": 120, "gcs": 9},
        "well": {"systolic": 150, "diastolic": 90, "hr": 85, "gcs": 15},
    },
    "electrolyte_arrhythmia": {
        "s0": 0.5, "rate_h": 0.15, "recover_h": 0.6, "floor": 0.1, "lag_min": 0, "arrest_rhythm": "asystole",
        "fluid": "renal", "o2_response": 0.4, "metabolic": "hyperk",
        "peri": {"hr": 30, "systolic": 70, "diastolic": 40, "gcs": 9},
        "well": {"hr": 78, "systolic": 125, "diastolic": 76, "gcs": 15},
        "bedside0": {"k": 7.2},
    },
    "local_time_critical": {
        "s0": 0.3, "rate_h": 0.12, "recover_h": 0.5, "floor": 0.1, "lag_min": 0, "arrest_rhythm": None,
        "fluid": "neutral", "o2_response": 0.4,
        "peri": {"pain": 10, "hr": 110}, "well": {"pain": 2, "hr": 80},
        "bedside0": {"pain": 8},
    },
    "psych_risk": {
        "s0": 0.3, "rate_h": 0.0, "recover_h": 0.2, "floor": 0.1, "lag_min": 0, "arrest_rhythm": None,
        "fluid": "neutral", "o2_response": 0.4, "peri": {}, "well": {},
    },
    "arrest": {
        "s0": 0.8, "rate_h": 0.02, "recover_h": 0.1, "floor": 0.5, "lag_min": 0, "arrest_rhythm": "VF",
        "start_arrest": "VF", "fluid": "neutral", "o2_response": 0.4,
        "peri": {"hr": 120, "systolic": 80, "diastolic": 45, "rr": 24, "spo2": 90, "gcs": 3},
        "well": {"hr": 90, "systolic": 115, "diastolic": 70, "rr": 16, "spo2": 96, "gcs": 10},
    },
    "stable": {
        "s0": 0.3, "rate_h": 0.0, "recover_h": 0.0, "floor": 0.3, "lag_min": 0, "arrest_rhythm": None,
        "fluid": "neutral", "o2_response": 0.4, "peri": {}, "well": {},
    },
}

_GP_GN = ("gram_pos", "gram_neg")
_SAY_SHOCK = ("I feel so cold and dizzy... where am I?", "Çok üşüyorum, başım dönüyor... neredeyim?")
_WHY_SHOCK = ("MAP below 65 mmHg or lactate 4 mmol/L or more: sepsis has progressed to septic shock (Sepsis-3; SSC 2021)",
              "OAB 65 mmHg altında veya laktat 4 mmol/L ve üzeri: sepsis septik şoka ilerledi (Sepsis-3; SSC 2021)")


def _to_shock(bid: str = "septic_shock", to: str = "septic_shock", extra: list | None = None) -> list[dict[str, Any]]:
    return [
        _br(bid, to, [_c("map", "<", 65)] + (extra or []), s_start=0.5, lactate_min=4.5, rate_h=0.4,
            why_en=_WHY_SHOCK[0], why_tr=_WHY_SHOCK[1], say_en=_SAY_SHOCK[0], say_tr=_SAY_SHOCK[1]),
        _br(bid + "_lactate", to, [_c("lactate", ">=", 4.0)] + (extra or []), s_start=0.5, lactate_min=4.5, rate_h=0.4,
            why_en=_WHY_SHOCK[0], why_tr=_WHY_SHOCK[1], say_en=_SAY_SHOCK[0], say_tr=_SAY_SHOCK[1]),
    ]


_SEIZURE = _br("seizure", "status_epilepticus", [], p=0.15, window=(30, 100), supersede=False, s_start=0.6,
               why_en="Seeded seizure (seizures occur in about 17 % of adult bacterial meningitis; Zoons 2008)",
               why_tr="Tohumlanmış nöbet (erişkin bakteriyel menenjitte yaklaşık %17; Zoons 2008)",
               say_en="(the relative shouts) He's shaking all over!", say_tr="(yakını bağırır) Her yeri titriyor!")
_MOTTLING = _fd("mottling", "general-inspection", [_c("mottle", ">=", 2)],
                "Mottling over both knees (mottling score 2); cold peripheries, capillary refill 4 to 5 s.",
                "Her iki dizde alacalanma (skor 2); soğuk ekstremiteler, kapiller dolum 4-5 sn.")
_MOTTLING_HIGH = _fd("mottling_thighs", "general-inspection", [_c("mottle", ">=", 4)],
                     "Mottling now extends over the thighs (score 4); capillary refill 6 s at the sternum.",
                     "Alacalanma artık uyluklara yayıldı (skor 4); sternumda kapiller dolum 6 sn.")
_CONFUSED = _fd("confusion", "neurological", [_c("gcs", "<=", 12)],
                "Confused and mumbling; the family now gives the history.",
                "Konfüze ve mırıldanıyor; öyküyü artık ailesi veriyor.")

CONDITION_COURSE: dict[str, dict[str, Any]] = {
    # ---- 06b section 5.2 ------------------------------------------------- #
    "septic_shock": {
        "pattern": "distributive_shock",
        "groups": [_grp("antimicrobial", ("abx",), ("antibiotic",), needs=_GP_GN, en="Appropriate antimicrobial", tr="Uygun antimikrobiyal"),
                   _grp("circulation", ("iv_fluids", "vasopressor"), ("fluids", "vasopressor"), modifies=False,
                        en="Fluids or vasopressor", tr="Sıvı veya vazopresör")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, SSC21), _tgt("circulation_3h", "circulation", 180, SSC21)],
        "branches": [
            _br("refractory_shock", "refractory_shock", [_c("s", ">=", 0.85), _c("pressor_on", "==", 1)], supersede=False,
                why_en="MAP below 65 on noradrenaline: refractory shock; add vasopressin (SSC 2021)",
                why_tr="Noradrenaline rağmen OAB 65 altı: dirençli şok; vazopressin ekleyin (SSC 2021)"),
            _br("ards", "ards", [_c("t_min", ">=", 360), _c("s", ">=", 0.6)], supersede=False,
                why_en="Time-skip: bilateral infiltrates with P/F below 300 on PEEP 5 (Berlin 2012)",
                why_tr="Zaman atlaması: PEEP 5'te P/F 300 altı bilateral infiltrat (Berlin 2012)")],
        "findings": [_MOTTLING, _MOTTLING_HIGH, _CONFUSED],
        "harm_rules": ["starch"],
    },
    # ---- 06b section 5.1 ------------------------------------------------- #
    "sepsis_uncomplicated": {
        "pattern": "sepsis",
        "groups": [_grp("antimicrobial", ("abx",), ("antibiotic",), needs=_GP_GN, en="Appropriate antimicrobial", tr="Uygun antimikrobiyal"),
                   _grp("circulation", ("iv_fluids",), ("fluids",), modifies=False, en="Fluids", tr="Sıvı")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, NG253)],
        "branches": _to_shock(),
        "findings": [_CONFUSED],
    },
    # ---- 06b section 5.3 ------------------------------------------------- #
    "pneumonia_cap": {
        "pattern": "pneumonia",
        "groups": [_grp("antimicrobial", ("severity_abx",), ("antibiotic",), needs=("gram_pos",), en="Antibiotic by CURB-65", tr="CURB-65'e göre antibiyotik")],
        "targets": [_tgt("abx_4h", "antimicrobial", 240, NG250)],
        "branches": [
            _br("septic_shock", "septic_shock", [_c("curb65", ">=", 3), _c("unmet:antimicrobial", "==", 1)], p=0.3, window=(60, 120),
                s_start=0.5, lactate_min=4.5, rate_h=0.6,
                why_en="CURB-65 3 or more and no antibiotic by 60 min: pulmonary sepsis progressed to septic shock (NICE NG250; SSC 2021)",
                why_tr="CURB-65 3 ve üzeri, 60. dakikada antibiyotik yok: pulmoner sepsis septik şoka ilerledi (NICE NG250; SSC 2021)",
                say_en="I can't get my breath and I'm freezing.", say_tr="Nefes alamıyorum ve donuyorum."),
            _br("ards", "ards", [_c("t_min", ">=", 360), _c("s", ">=", 0.6)], supersede=False,
                why_en="Time-skip: bilateral infiltrates with P/F below 300 on PEEP 5 (Berlin 2012)",
                why_tr="Zaman atlaması: PEEP 5'te P/F 300 altı bilateral infiltrat (Berlin 2012)")],
        "findings": [_fd("crackles", "respiratory", [_c("spo2", "<", 88)], "Crackles now extend to the mid-zone; speaking in phrases.",
                         "Raller artık orta zona uzanıyor; cümle yerine kelime gruplarıyla konuşuyor.")],
    },
    # ---- 06b section 5.4 ------------------------------------------------- #
    "bacterial_meningitis": {
        "pattern": "neuro_infective",
        "groups": [_grp("antimicrobial", ("immediate_ceftriaxone",), ("antibiotic",), needs=("cns",), en="CNS-penetrant antimicrobial", tr="SSS'ye geçen antimikrobiyal"),
                   _grp("dexamethasone", ("3264", "immediate_ceftriaxone"), ("corticosteroid",), modifies=False, en="Dexamethasone", tr="Deksametazon")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, NG240),
                    _tgt("dexamethasone", "dexamethasone", 60, "de Gans 2002 https://doi.org/10.1056/NEJMoa021334 ; " + NG240)],
        "branches": [_SEIZURE],
        "findings": [_fd("neck", "neurological", [_c("gcs", "<=", 12)], "Confused and repetitive; neck stiffness and photophobia persist.",
                         "Konfüze ve tekrarlayıcı; ense sertliği ve fotofobi sürüyor."),
                     _fd("groans", "neurological", [_c("gcs", "<=", 9)], "Only groans to pain; airway at risk.",
                         "Yalnızca ağrıya inliyor; hava yolu risk altında.")],
        "harm_rules": ["lp_before_ct"],
    },
    "meningococcemia": {
        "pattern": "distributive_shock", "rate_h": 0.4,
        "groups": [_grp("antimicrobial", ("immediate_ceftriaxone",), ("antibiotic",), needs=("cns",), en="CNS-penetrant antimicrobial", tr="SSS'ye geçen antimikrobiyal"),
                   _grp("circulation", ("fluid_resus",), ("fluids", "vasopressor"), modifies=False, en="Fluids", tr="Sıvı")],
        "targets": [_tgt("abx_immediate", "antimicrobial", 30, NG240 + " (immediately; 30 min teaching target)", basis="design")],
        "findings": [_fd("purpura", "skin", [_c("pt_min", ">=", 30), _c("unmet:antimicrobial", "==", 1)],
                         "The purpura has spread over the trunk and legs and does not blanch under a glass.",
                         "Purpura gövde ve bacaklara yayıldı, bardak testinde solmuyor."), _MOTTLING],
    },
    # ---- 06b section 5.5 ------------------------------------------------- #
    "pyelonephritis": {
        "pattern": "infection_local",
        "groups": [_grp("antimicrobial", ("iv_abx_fluids",), ("antibiotic",), needs=("gram_neg",), en="Gram-negative cover", tr="Gram-negatif kapsam")],
        "targets": [_tgt("abx", "antimicrobial", 60, NG111 + " (without delay; 60 min teaching target)", basis="design")],
        "branches": [
            _br("urosepsis_obstructed", "urosepsis", [], p=0.2, window=(60, 120), s_start=0.45, lactate_min=4.0,
                why_en="Obstructed infected kidney (seeded): severity rises despite antibiotics; needs decompression (EAU)",
                why_tr="Obstrüktif enfekte böbrek (tohumlanmış): antibiyotiğe rağmen ağırlaşıyor; dekompresyon gerekir (EAU)",
                say_en="The shaking won't stop and I feel faint.", say_tr="Titreme durmuyor ve bayılacak gibiyim."),
            _br("urosepsis", "urosepsis", [_c("s", ">=", 0.55), _c("unmet:antimicrobial", "==", 1)], s_start=0.45, lactate_min=4.0,
                why_en="Untreated pyelonephritis progressed to urosepsis (NICE NG111; SSC 2021)",
                why_tr="Tedavisiz piyelonefrit ürosepsise ilerledi (NICE NG111; SSC 2021)",
                say_en="The shaking won't stop and I feel faint.", say_tr="Titreme durmuyor ve bayılacak gibiyim.")],
    },
    "urosepsis": {
        "pattern": "distributive_shock", "s0": 0.45,
        "groups": [_grp("antimicrobial", ("iv_abx_fluids",), ("antibiotic",), needs=("gram_neg",), en="Gram-negative cover", tr="Gram-negatif kapsam"),
                   _grp("decompression", ("drain_obstruction",), ("procedure",), en="Decompression (nephrostomy or stent)", tr="Dekompresyon (nefrostomi veya stent)"),
                   _grp("circulation", (), ("fluids", "vasopressor"), modifies=False, en="Fluids or vasopressor", tr="Sıvı veya vazopresör")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, SSC21),
                    _tgt("decompression", "decompression", 120, "EAU urological infections https://uroweb.org/guidelines/urological-infections (urgent)", basis="design")],
        "findings": [_MOTTLING],
    },
    # ---- 06b section 5.6 ------------------------------------------------- #
    "dka": {
        "pattern": "dka",
        "groups": [_grp("fluids", ("fluids_first",), ("fluids",), en="IV fluids", tr="İ.V. sıvı"),
                   _grp("insulin", ("fixed_insulin",), ("insulin_frii",), en="Fixed-rate insulin", tr="Sabit hızlı insülin")],
        "targets": [_tgt("fluids_1h", "fluids", 60, JBDS23), _tgt("insulin_1h", "insulin", 60, JBDS23)],
        "row_classes": {"fixed_insulin": ["insulin_frii", "potassium"], "fluids_first": ["fluids"], "insulin_bolus_first": ["insulin_bolus"],
                        "insulin_low_k": ["insulin_frii"]},
        "row_harms": {"insulin_bolus_first": _harm({}, en="IV insulin bolus before fluids: potassium falls and the circulation is not restored (JBDS 2023)",
                                                   tr="Sıvıdan önce İ.V. insülin bolusu: potasyum düşer, dolaşım düzelmez (JBDS 2023)")},
        "branches": [_br("cerebral_oedema", "cerebral_oedema_dka", [_c("age", "<=", 25), _c("fluid_ml_60", ">=", 2000)], window=(60, 180),
                         supersede=False, s_start=0.35,
                         why_en="Over-rapid fluid (2 L or more in the first hour) in a patient aged 25 or under: cerebral oedema (JBDS 2023; ISPAD 2022)",
                         why_tr="25 yaş ve altında ilk saatte 2 L veya fazla sıvı: serebral ödem (JBDS 2023; ISPAD 2022)",
                         say_en="My head is pounding... I feel so sleepy.", say_tr="Başım zonkluyor... çok uykum var.")],
        "findings": [_fd("kussmaul", "respiratory", [], "Deep sighing (Kussmaul) breathing; acetone on the breath.",
                         "Derin iç çeker gibi (Kussmaul) solunum; nefeste aseton kokusu.")],
        "harm_rules": ["insulin_low_k"],
    },
    "hhs": {
        "pattern": "dka", "rate_h": 0.08, "bedside0": {"cbg": 40.0, "k": 4.5, "lactate": 2.0},
        "groups": [_grp("fluids", ("cautious_fluids",), ("fluids",), en="Cautious IV fluids", tr="Dikkatli İ.V. sıvı")],
        "targets": [_tgt("fluids_1h", "fluids", 60, "JBDS HHS 2022 https://abcd.care/resource/current-guidelines", basis="design")],
        "row_classes": {"low_rate_insulin": ["insulin_frii"]},
    },
    "hypoglycemia": {
        "pattern": "metabolic_coma", "rate_h": 0.0, "metabolic": "hypo", "bedside0": {"cbg": 2.0, "gcs": 15},
        "groups": [_grp("glucose", ("glucose",), ("dextrose", "glucagon"), en="Glucose", tr="Glukoz")],
        "targets": [_tgt("glucose", "glucose", 15, "JBDS hypoglycaemia 2022 https://abcd.care/resource/current-guidelines (treat immediately)", basis="design")],
        "row_classes": {"glucose": ["dextrose"], "insulin": ["insulin_bolus"]},
    },
    "herniation": {
        "pattern": "neuro_bleed", "rate_h": 0.4, "s0": 0.5,
        "groups": [_grp("osmotherapy", ("mannitol", "hypertonic_saline"), (), en="Osmotherapy and neurosurgery", tr="Ozmoterapi ve nöroşirürji")],
        "targets": [_tgt("osmotherapy", "osmotherapy", 30, "IDSA 2004 meningitis https://doi.org/10.1086/425368", basis="design")],
    },
    "cerebral_oedema_dka": {
        "pattern": "neuro_bleed", "rate_h": 0.4, "s0": 0.35,
        "groups": [_grp("osmotherapy", ("mannitol", "hypertonic_saline"), (), en="Mannitol or hypertonic saline", tr="Mannitol veya hipertonik salin")],
        "targets": [_tgt("osmotherapy", "osmotherapy", 30, "ISPAD 2022 https://doi.org/10.1111/pedi.13406", basis="design")],
    },
    # ---- 06b section 5.7 ------------------------------------------------- #
    "acs_stemi": {
        "pattern": "acute_coronary",
        "groups": [_grp("antiplatelet", ("asa_p2y12",), ("antiplatelet",), modifies=False, en="Antiplatelet loading", tr="Antiplatelet yükleme"),
                   _grp("reperfusion", ("primary_pci",), ("thrombolytic", "reperfusion"), lag_min=45, en="Reperfusion (PCI or fibrinolysis)", tr="Reperfüzyon (PKG veya fibrinoliz)")],
        "targets": [_tgt("antiplatelet", "antiplatelet", 30, ESC23 + " (as soon as possible; 30 min teaching target)", basis="design"),
                    _tgt("reperfusion", "reperfusion", 30, ESC23 + " (diagnosis-to-wire 60 min or less; activation by 30 min)", basis="design")],
        "branches": [
            _br("vf", "", [_c("unmet:reperfusion", "==", 1)], p=0.06, window=(5, 90), arrest="VF",
                why_en="Ventricular fibrillation before reperfusion (5.7 % in primary PCI cohorts; Mehta 2009)",
                why_tr="Reperfüzyon öncesi ventriküler fibrilasyon (primer PKG kohortlarında %5.7; Mehta 2009)"),
            _br("cardiogenic_shock", "cardiogenic_shock", [_c("unmet:reperfusion", "==", 1)], p=0.1, window=(60, 120),
                why_en="Large anterior infarct without reperfusion by 60 min: cardiogenic shock (ESC 2023: 6 to 10 % of STEMI)",
                why_tr="60. dakikada reperfüzyonsuz geniş anterior infarkt: kardiyojenik şok (ESC 2023: STEMI'nin %6-10'u)",
                say_en="I can't breathe lying flat.", say_tr="Düz yatınca nefes alamıyorum.")],
        "harm_rules": ["beta_blocker_killip", "gtn_hypotension"],
    },
    "cardiogenic_shock": {
        "pattern": "cardiogenic",
        "groups": [_grp("reperfusion", ("primary_pci",), ("thrombolytic", "reperfusion"), lag_min=45, en="Reperfusion", tr="Reperfüzyon"),
                   _grp("support", (), ("vasopressor",), modifies=False, en="Vasopressor or inotrope", tr="Vazopresör veya inotrop")],
        "targets": [_tgt("reperfusion", "reperfusion", 30, ESC23, basis="design")],
        "findings": [_fd("crackles", "respiratory", [], "Bibasal crackles; cold, clammy peripheries.", "Bibaziler raller; soğuk, nemli ekstremiteler.")],
    },
    "acs_nstemi": {
        "pattern": "acute_coronary", "rate_h": 0.03, "s0": 0.3, "bedside0": {"pain": 6},
        "groups": [_grp("antiplatelet", ("asa_p2y12",), ("antiplatelet",), en="Antiplatelet", tr="Antiplatelet"),
                   _grp("anticoagulant", ("anticoag",), ("anticoagulant",), modifies=False, en="Anticoagulation", tr="Antikoagülasyon")],
        "targets": [_tgt("antiplatelet", "antiplatelet", 60, ESC23, basis="design")],
        "row_harms": {"thrombolysis": _harm({}, en="Thrombolysis without ST elevation: bleeding risk, no benefit (ESC 2023)",
                                            tr="ST yükselmesi olmadan tromboliz: kanama riski, yarar yok (ESC 2023)")},
    },
    "unstable_angina": {
        "pattern": "acute_coronary", "rate_h": 0.02, "s0": 0.25, "bedside0": {"pain": 5},
        "groups": [_grp("antiplatelet", ("antiplatelet",), ("antiplatelet",), en="Antiplatelet", tr="Antiplatelet")],
        "targets": [_tgt("antiplatelet", "antiplatelet", 60, ESC23, basis="design")],
    },
    # ---- 06b section 5.8 ------------------------------------------------- #
    "pulmonary_embolism": {
        "pattern": "pe_intermediate",
        "groups": [_grp("anticoagulant", ("anticoag",), ("anticoagulant",), en="Anticoagulation", tr="Antikoagülasyon")],
        "targets": [_tgt("anticoag", "anticoagulant", 60, ESC19PE + " (without delay; 60 min teaching target)", basis="design")],
        "branches": [
            _br("obstructive_shock", "pe_high_risk", [_c("sbp", "<", 90)], s_start=0.55,
                why_en="SBP below 90 mmHg: high-risk PE with obstructive shock (ESC 2019)",
                why_tr="SKB 90 mmHg altı: obstrüktif şoklu yüksek riskli PE (ESC 2019)",
                say_en="I'm going to faint.", say_tr="Bayılacağım."),
            _br("decompensation", "pe_high_risk", [_c("difficulty", ">=", 4)], p=0.05, window=(30, 120), s_start=0.55,
                why_en="Seeded haemodynamic decompensation (about 5 % at 7 days in PEITHO)",
                why_tr="Tohumlanmış hemodinamik bozulma (PEITHO'da 7 günde yaklaşık %5)",
                say_en="I'm going to faint.", say_tr="Bayılacağım.")],
        "harm_rules": ["thrombolysis_intermediate_pe"],
        "findings": [_fd("jvp", "cardiovascular", [_c("sbp", "<", 95)], "Raised JVP; cold peripheries.", "Yükselmiş JVB; soğuk ekstremiteler.")],
    },
    "pe_high_risk": {
        "pattern": "obstructive_shock", "rate_h": 0.4, "recover_h": 1.0, "lag_min": 30,
        "groups": [_grp("thrombolysis", ("thrombolysis_high_risk",), ("thrombolytic",), en="Systemic thrombolysis", tr="Sistemik tromboliz"),
                   _grp("anticoagulant", ("anticoag",), ("anticoagulant",), modifies=False, en="Anticoagulation", tr="Antikoagülasyon")],
        "targets": [_tgt("thrombolysis", "thrombolysis", 60, ESC19PE, basis="design")],
        "fluid": "rv",
    },
    # ---- 06b section 5.9 ------------------------------------------------- #
    "anaphylaxis": {
        "pattern": "upper_airway",
        "groups": [_grp("adrenaline", ("im_adrenaline",), ("adrenaline_im",), active_min=25, recover_h=1.5, en="IM adrenaline", tr="İ.M. adrenalin")],
        "targets": [_tgt("adrenaline_5min", "adrenaline", 5, RCUK21),
                    {"id": "adrenaline_repeat", "type": "repeat", "group": "adrenaline", "after_min": 5, "grace_min": 5,
                     "when": [_c("sbp", "<", 90)], "source": RCUK21, "basis": "guideline", "by_min": 0}],
        "findings": [_fd("stridor", "respiratory", [_c("s", ">=", 0.7)], "Audible inspiratory stridor; hoarse whisper.", "Duyulabilir inspiratuvar stridor; kısık fısıltı."),
                     _fd("silent", "respiratory", [_c("s", ">=", 0.9)], "Silent chest with minimal air entry.", "Sessiz göğüs, minimal hava girişi."),
                     _fd("hives", "skin", [], "Generalised urticaria and lip swelling.", "Yaygın ürtiker ve dudak şişliği.")],
        "harm_rules": ["iv_adrenaline_bolus", "posture"],
    },
    "anaphylaxis_iatrogenic": {
        "pattern": "upper_airway", "s0": 0.45, "rate_h": 2.2,
        "groups": [_grp("adrenaline", ("im_adrenaline",), ("adrenaline_im",), active_min=25, recover_h=1.5, en="IM adrenaline", tr="İ.M. adrenalin")],
        "targets": [_tgt("adrenaline_5min", "adrenaline", 5, RCUK21)],
        "findings": [_fd("hives", "skin", [], "New generalised urticaria and lip swelling after the drug.", "İlaçtan sonra yeni yaygın ürtiker ve dudak şişliği."),
                     _fd("stridor", "respiratory", [_c("s", ">=", 0.7)], "Audible stridor and wheeze.", "Duyulabilir stridor ve hışıltı.")],
        "harm_rules": ["iv_adrenaline_bolus", "posture"],
    },
    # ---- 06b section 5.10 ------------------------------------------------ #
    "heart_failure_acute": {
        "pattern": "pulmonary_oedema",
        "groups": [_grp("decongestion", ("iv_diuretic", "niv_nitrate"), ("loop_diuretic", "nitrate", "niv"), en="Decongestion (NIV, nitrate, diuretic)", tr="Dekonjesyon (NIV, nitrat, diüretik)")],
        "targets": [_tgt("decongestion", "decongestion", 60, ESC21HF + " (early; 60 min teaching target)", basis="design")],
        "row_classes": {"niv_nitrate": ["niv", "nitrate"], "iv_diuretic": ["loop_diuretic"], "fluid_bolus": ["fluids"]},
        "findings": [_fd("frothy", "respiratory", [_c("spo2", "<", 80)], "Pink frothy sputum; crackles to the apices.", "Pembe köpüklü balgam; apekslere kadar raller.")],
        "harm_rules": ["gtn_hypotension"],
    },
    # ---- the other ESI 1 to 2 conditions -------------------------------- #
    "aortic_dissection": {
        "pattern": "haemorrhagic_shock", "s0": 0.35, "rate_h": 0.1, "fluid": "neutral",
        "peri": {"hr": 130, "systolic": 70, "diastolic": 40, "gcs": 10, "pain": 10},
        "groups": [_grp("impulse_control", ("bp_hr_control",), ("beta_blocker_iv",), recover_h=0.0, en="HR and BP control", tr="KH ve KB kontrolü"),
                   _grp("surgery", ("surgery_referral",), (), modifies=False, en="Cardiothoracic surgery", tr="Kalp-damar cerrahisi")],
        "targets": [_tgt("impulse_control", "impulse_control", 30, "ESC 2014 aortic diseases https://doi.org/10.1093/eurheartj/ehu281", basis="design"),
                    _tgt("surgery", "surgery", 60, "ESC 2014 aortic diseases https://doi.org/10.1093/eurheartj/ehu281", basis="design")],
        "row_harms": {"thrombolysis": _harm({}, rate_mult=3.0, en="Thrombolysis in dissection: haemorrhage and rupture (ESC 2014)",
                                            tr="Diseksiyonda tromboliz: kanama ve rüptür (ESC 2014)")},
    },
    "afib_rvr": {
        "pattern": "tachy_arrhythmia", "s0": 0.3, "rate_h": 0.05, "recover_h": 0.5, "peri": {"hr": 175, "systolic": 85, "diastolic": 50, "gcs": 13},
        "groups": [_grp("rate_control", ("rate_control", "dc_cardioversion"), ("beta_blocker_iv", "rhythm"), en="Rate or rhythm control", tr="Hız veya ritim kontrolü")],
        "targets": [_tgt("rate_control", "rate_control", 60, "ESC 2020 AF https://doi.org/10.1093/eurheartj/ehaa612", basis="design")],
    },
    "svt": {
        "pattern": "tachy_arrhythmia", "s0": 0.35, "rate_h": 0.05, "peri": {"hr": 220, "systolic": 80, "diastolic": 50, "gcs": 13},
        "groups": [_grp("termination", ("vagal", "adenosine", "cardioversion"), ("rhythm",), en="Vagal manoeuvre, adenosine or cardioversion", tr="Vagal manevra, adenozin veya kardiyoversiyon")],
        "targets": [_tgt("termination", "termination", 30, ERC21, basis="design")],
        "row_harms": {"verapamil_hypotension": _harm({"systolic": -25, "diastolic": -12}, onset_min=5,
                                                     en="Verapamil in a hypotensive patient: further hypotension (ERC 2021)",
                                                     tr="Hipotansif hastada verapamil: hipotansiyon derinleşir (ERC 2021)")},
    },
    "vt": {
        "pattern": "tachy_arrhythmia",
        "groups": [_grp("cardioversion", ("sync_cardioversion", "defib_pulseless", "amiodarone"), ("rhythm",), en="Synchronised DC cardioversion", tr="Senkronize DC kardiyoversiyon")],
        "targets": [_tgt("cardioversion", "cardioversion", 10, ERC21 + " (unstable: shock without delay)", basis="design")],
        "row_harms": {"verapamil": _harm({"systolic": -30, "diastolic": -15}, onset_min=3, arrest="VF", p=0.5,
                                         en="Verapamil in VT: collapse and VF (ERC 2021)", tr="VT'de verapamil: kollaps ve VF (ERC 2021)"),
                      "sync_on_pulseless": _harm({}, en="Synchronised shock in pulseless VT delays defibrillation (ERC 2021)",
                                                 tr="Nabızsız VT'de senkronize şok defibrilasyonu geciktirir (ERC 2021)")},
    },
    "complete_heart_block": {
        "pattern": "brady",
        "groups": [_grp("pacing", ("pacing",), ("rhythm",), en="Pacing", tr="Pacing")],
        "targets": [_tgt("pacing", "pacing", 15, ERC21 + " (bradycardia algorithm)", basis="design")],
        "row_harms": {"av_blockers": _harm({"hr": -10, "systolic": -15, "diastolic": -8}, onset_min=10,
                                           en="AV-nodal blocker in complete heart block: slower rate, lower pressure",
                                           tr="Tam blokta AV düğüm blokeri: daha yavaş hız, daha düşük basınç")},
    },
    "cardiac_tamponade": {
        "pattern": "obstructive_shock", "fluid": "responsive",
        "groups": [_grp("pericardiocentesis", ("pericardiocentesis",), ("procedure",), en="Pericardiocentesis", tr="Perikardiyosentez")],
        "targets": [_tgt("pericardiocentesis", "pericardiocentesis", 30, "ESC 2015 pericardial diseases https://doi.org/10.1093/eurheartj/ehv318", basis="design")],
        "row_harms": {"aggressive_diuresis": _harm({"systolic": -15, "diastolic": -8}, onset_min=20, rate_mult=1.5,
                                                   en="Diuresis in tamponade lowers preload and pressure (ESC 2015)",
                                                   tr="Tamponadda diürez ön yükü ve basıncı düşürür (ESC 2015)")},
    },
    "hypertensive_emergency": {
        "pattern": "hypertensive_crisis",
        "groups": [_grp("iv_antihypertensive", ("controlled_iv_antihtn",), (), en="Controlled IV antihypertensive", tr="Kontrollü İ.V. antihipertansif")],
        "targets": [_tgt("iv_antihypertensive", "iv_antihypertensive", 60, "ESC/ESH 2018 hypertension https://doi.org/10.1093/eurheartj/ehy339", basis="design")],
        "row_harms": {"rapid_normalise": _harm({"systolic": -45, "diastolic": -25, "gcs": -3}, onset_min=10,
                                               en="Rapid normalisation of BP: cerebral and renal hypoperfusion (ESC/ESH 2018: lower MAP by 25 % or less in the first hours)",
                                               tr="KB'nin hızla normale çekilmesi: serebral ve renal hipoperfüzyon (ESC/ESH 2018)")},
    },
    "infective_endocarditis": {
        "pattern": "sepsis", "rate_h": 0.08,
        "groups": [_grp("antimicrobial", ("prolonged_abx",), ("antibiotic",), needs=("gram_pos",), en="Empirical antibiotics after cultures", tr="Kültür sonrası ampirik antibiyotik")],
        "targets": [_tgt("abx", "antimicrobial", 180, "ESC 2023 endocarditis https://doi.org/10.1093/eurheartj/ehad193", basis="design")],
        "branches": _to_shock(),
    },
    "myocarditis": {
        "pattern": "cardiogenic", "rate_h": 0.04, "s0": 0.3,
        "groups": [_grp("supportive", ("supportive_monitor", "treat_hf"), ("loop_diuretic",), en="Monitoring and heart-failure therapy", tr="İzlem ve kalp yetmezliği tedavisi")],
        "targets": [],
    },
    "asthma_exacerbation": {
        "pattern": "bronchospasm",
        "groups": [_grp("bronchodilator", ("neb_salbutamol",), ("bronchodilator", "adrenaline_im"), active_min=60, recover_h=0.6, en="Nebulised bronchodilator", tr="Nebül bronkodilatör"),
                   _grp("steroid", ("systemic_steroid",), ("corticosteroid",), lag_min=240, en="Systemic corticosteroid", tr="Sistemik kortikosteroid")],
        "targets": [_tgt("bronchodilator", "bronchodilator", 10, "BTS/SIGN 2019 asthma (immediately)", basis="design"),
                    _tgt("steroid_1h", "steroid", 60, "BTS/SIGN 2019 asthma (steroids in all acute asthma)", basis="design")],
        "row_harms": {"sedation": _harm({"rr": -6, "spo2": -6, "gcs": -2}, onset_min=5,
                                        en="Sedation in acute asthma suppresses respiratory drive (BTS/SIGN 2019)",
                                        tr="Akut astımda sedasyon solunum dürtüsünü baskılar (BTS/SIGN 2019)")},
        "findings": [_fd("silent_chest", "respiratory", [_c("s", ">=", 0.8)], "Silent chest; exhausted, cannot complete words.", "Sessiz göğüs; bitkin, kelimeleri tamamlayamıyor.")],
    },
    "copd_exacerbation": {
        "pattern": "hypercapnic_resp",
        "groups": [_grp("niv", ("niv",), ("niv",), lag_min=30, en="NIV", tr="NIV"),
                   _grp("bronchodilator", ("neb_steroid_abx",), ("bronchodilator",), active_min=60, recover_h=0.2, en="Bronchodilator", tr="Bronkodilatör")],
        "targets": [_tgt("niv_1h", "niv", 60, "BTS/ICS 2016 NIV https://doi.org/10.1136/thoraxjnl-2015-208209 (start within 60 min of the gas)")],
        "row_harms": {"untitrated_high_o2": _harm({}, branch="type2_respiratory_failure",
                                                  en="Untitrated high-flow oxygen in COPD: rising PaCO2 (BTS 2017; Austin 2010)",
                                                  tr="KOAH'ta titre edilmemiş yüksek akım oksijen: PaCO2 yükselir (BTS 2017; Austin 2010)")},
    },
    "type2_respiratory_failure": {
        "pattern": "hypercapnic_resp", "s0": 0.3, "rate_h": 0.4,
        "groups": [_grp("niv", ("niv",), ("niv",), lag_min=30, en="NIV", tr="NIV")],
        "targets": [_tgt("niv_1h", "niv", 60, "BTS/ICS 2016 NIV https://doi.org/10.1136/thoraxjnl-2015-208209")],
        "findings": [_fd("asterixis", "neurological", [_c("gcs", "<=", 13)], "Drowsy with a flapping tremor; slurred speech.", "Uykulu, flapping tremor; peltek konuşma.")],
    },
    "tension_pneumothorax": {
        "pattern": "obstructive_shock", "s0": 0.6, "rate_h": 1.2, "recover_h": 4.0,
        "groups": [_grp("decompression", ("decompression", "chest_drain"), ("procedure",), en="Needle or finger decompression", tr="İğne veya parmak dekompresyonu")],
        "targets": [_tgt("decompression", "decompression", 5, "ATLS 10th edition; BTS 2023 pleural https://doi.org/10.1136/thorax-2022-219784 (immediate)", basis="design")],
    },
    "carbon_monoxide": {
        "pattern": "metabolic_coma", "rate_h": 0.05, "recover_h": 0.6,
        "groups": [_grp("oxygen", ("high_flow_o2", "remove_source"), ("oxygen", "niv"), en="High-flow oxygen", tr="Yüksek akım oksijen")],
        "targets": [_tgt("oxygen", "oxygen", 10, "Weaver LK, NEJM 2009 https://doi.org/10.1056/NEJMcp0808928 (COHb half-life about 74 min on 100 % oxygen)", basis="design")],
    },
    "pancreatitis": {
        "pattern": "distributive_shock", "s0": 0.3, "rate_h": 0.06, "fluid_limit_ml": 2000, "bedside0": {"gcs": 15, "crt": 3, "mottle": 0, "urine": 30, "lactate": 2.0},
        "groups": [_grp("fluids", ("moderate_fluids",), ("fluids",), modifies=False, en="Moderate fluids", tr="Ilımlı sıvı")],
        "targets": [_tgt("fluids", "fluids", 60, "WATERFALL, NEJM 2022 https://doi.org/10.1056/NEJMoa2202884", basis="design")],
        "row_harms": {"aggressive_fluids": _harm({"spo2": -3, "rr": 3}, onset_min=30,
                                                 en="Aggressive fluid in pancreatitis: more fluid overload, no benefit (WATERFALL 2022)",
                                                 tr="Pankreatitte agresif sıvı: daha fazla sıvı yüklenmesi, yarar yok (WATERFALL 2022)")},
    },
    "upper_gi_bleed": {
        "pattern": "haemorrhagic_shock", "rate_h": 0.2,
        "groups": [_grp("resuscitation", ("resus_transfuse",), ("fluids",), modifies=False, en="Resuscitation and transfusion", tr="Resüsitasyon ve transfüzyon"),
                   _grp("endoscopy", ("ppi_endoscopy",), (), lag_min=30, en="Endoscopy", tr="Endoskopi")],
        "targets": [_tgt("resuscitation", "resuscitation", 30, "NICE CG141 https://www.nice.org.uk/guidance/cg141", basis="design"),
                    _tgt("endoscopy_24h", "endoscopy", 1440, "NICE CG141 https://www.nice.org.uk/guidance/cg141")],
    },
    "bowel_obstruction": {
        "pattern": "distributive_shock", "s0": 0.3, "rate_h": 0.05, "bedside0": {"gcs": 15, "crt": 3, "mottle": 0, "urine": 25, "lactate": 2.0},
        "groups": [_grp("decompression", ("nbm_ngt",), (), en="NBM and NG decompression", tr="Ağızdan bir şey vermeme ve NG dekompresyon"),
                   _grp("fluids", ("iv_fluids",), ("fluids",), modifies=False, en="IV fluids", tr="İ.V. sıvı")],
        "targets": [_tgt("fluids", "fluids", 60, "WSES ASBO 2017 https://doi.org/10.1186/s13017-018-0185-2", basis="design")],
    },
    "ascending_cholangitis": {
        "pattern": "sepsis",
        "groups": [_grp("antimicrobial", ("abx_fluids",), ("antibiotic",), needs=("gram_neg", "anaerobe"), en="Gram-negative and anaerobic cover", tr="Gram-negatif ve anaerop kapsam"),
                   _grp("drainage", ("biliary_drainage",), ("procedure",), en="Biliary drainage", tr="Biliyer drenaj")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, "Tokyo Guidelines 2018 https://doi.org/10.1002/jhbp.509 ; " + SSC21),
                    _tgt("drainage_24h", "drainage", 1440, "Tokyo Guidelines 2018 https://doi.org/10.1002/jhbp.509")],
        "branches": _to_shock(),
    },
    "ischemic_stroke": {
        "pattern": "neuro_ischaemic",
        "groups": [_grp("reperfusion", ("thrombolysis_window", "thrombectomy"), ("thrombolytic",), en="Thrombolysis or thrombectomy", tr="Tromboliz veya trombektomi")],
        "targets": [_tgt("door_to_needle", "reperfusion", 60, "AHA/ASA 2019 https://doi.org/10.1161/STR.0000000000000211")],
        "harm_rules": ["lysis_bp_gate"],
        "row_harms": {"early_antihtn": _harm({"systolic": -30, "diastolic": -15}, onset_min=15, rate_mult=1.5,
                                             en="Aggressive early BP lowering in ischaemic stroke extends the infarct (AHA/ASA 2019)",
                                             tr="İskemik inmede erken agresif KB düşürme infarktı genişletir (AHA/ASA 2019)")},
    },
    "intracerebral_hemorrhage": {
        "pattern": "neuro_bleed",
        "groups": [_grp("bp_control", ("bp_control",), (), en="SBP control", tr="SKB kontrolü"),
                   _grp("reversal", ("reverse_anticoag",), (), en="Anticoagulant reversal", tr="Antikoagülan geri çevirme")],
        "targets": [_tgt("bp_1h", "bp_control", 60, "AHA/ASA 2022 ICH https://doi.org/10.1161/STR.0000000000000407"),
                    _tgt("reversal", "reversal", 60, "AHA/ASA 2022 ICH https://doi.org/10.1161/STR.0000000000000407", basis="design")],
        "row_harms": {"thrombolysis": _harm({}, rate_mult=3.0, en="Thrombolysis in ICH: haematoma expansion (AHA/ASA 2022)",
                                            tr="İSK'da tromboliz: hematom genişlemesi (AHA/ASA 2022)")},
    },
    "subarachnoid_hemorrhage": {
        "pattern": "neuro_bleed", "rate_h": 0.05,
        "groups": [_grp("neurosurgery", ("neurosurgery_referral",), (), en="Neurosurgical referral", tr="Nöroşirürji konsültasyonu"),
                   _grp("nimodipine", ("nimodipine",), (), modifies=False, en="Nimodipine", tr="Nimodipin")],
        "targets": [_tgt("neurosurgery", "neurosurgery", 60, "AHA/ASA 2023 aSAH https://doi.org/10.1161/STR.0000000000000436", basis="design")],
        "branches": [_br("rebleed", "sah_rebleed", [_c("unmet:neurosurgery", "==", 1)], p=0.05, window=(30, 120),
                         why_en="Seeded aneurysmal rebleed (4 to 14 % in the first 24 h; AHA/ASA 2023)",
                         why_tr="Tohumlanmış anevrizmal yeniden kanama (ilk 24 saatte %4-14; AHA/ASA 2023)")],
        "row_harms": {"antiplatelet": _harm({}, rate_mult=2.0, en="Antiplatelet in SAH raises the rebleed risk (AHA/ASA 2023)",
                                            tr="SAK'ta antiplatelet yeniden kanama riskini artırır (AHA/ASA 2023)")},
    },
    "sah_rebleed": {
        "pattern": "neuro_bleed", "rate_h": 0.6, "s0": 0.5,
        "groups": [_grp("neurosurgery", ("neurosurgery_referral",), (), en="Neurosurgical referral", tr="Nöroşirürji konsültasyonu")],
        "targets": [],
    },
    "status_epilepticus": {
        "pattern": "seizure",
        "groups": [_grp("benzodiazepine", ("benzodiazepine",), ("benzodiazepine",), en="Benzodiazepine", tr="Benzodiazepin")],
        "targets": [_tgt("benzo_5min", "benzodiazepine", 5, "NICE NG217 https://www.nice.org.uk/guidance/ng217", basis="design")],
        "row_classes": {"second_line_aed": ["benzodiazepine"]},
    },
    "nec_fasciitis": {
        "pattern": "distributive_shock", "s0": 0.45,
        "groups": [_grp("antimicrobial", ("broad_abx",), ("antibiotic",), needs=("gram_pos", "gram_neg", "anaerobe"), en="Broad cover including anaerobes", tr="Anaeropları da kapsayan geniş spektrum"),
                   _grp("debridement", ("surgical_debridement",), ("procedure",), en="Surgical debridement", tr="Cerrahi debridman")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, SSC21),
                    _tgt("debridement", "debridement", 120, "IDSA 2014 SSTI https://doi.org/10.1093/cid/ciu296", basis="design")],
        "findings": [_fd("spread", "skin", [_c("pt_min", ">=", 30), _c("unmet:debridement", "==", 1)], "Dusky skin and crepitus now spread beyond the marked margin.",
                         "Morumsu cilt ve krepitasyon işaretlenen sınırın ötesine yayıldı.")],
    },
    "malaria": {
        "pattern": "sepsis", "rate_h": 0.2,
        "groups": [_grp("antimalarial", ("artesunate",), ("antimalarial",), lag_min=120, en="IV artesunate", tr="İ.V. artesunat")],
        "targets": [_tgt("artesunate", "antimalarial", 60, "WHO malaria guidelines 2023 https://www.who.int/publications/i/item/guidelines-for-malaria", basis="design")],
        "branches": _to_shock(),
    },
    "septic_arthritis": {
        "pattern": "infection_local", "rate_h": 0.05,
        "groups": [_grp("antimicrobial", ("abx_joint",), ("antibiotic",), needs=("gram_pos",), en="Anti-staphylococcal antibiotic", tr="Anti-stafilokokal antibiyotik")],
        "targets": [_tgt("abx", "antimicrobial", 60, "BSR 2006 septic arthritis https://doi.org/10.1093/rheumatology/kel163", basis="design")],
    },
    "thyroid_storm": {
        "pattern": "hyperthermia", "rate_h": 0.1,
        "groups": [_grp("antithyroid", ("antithyroid_then_iodine",), (), lag_min=60, en="Antithyroid drug then iodine", tr="Antitiroid ilaç ardından iyot"),
                   _grp("beta_blocker", ("beta_blocker",), ("beta_blocker_iv",), modifies=False, en="Beta-blocker", tr="Beta bloker")],
        "targets": [_tgt("antithyroid", "antithyroid", 60, "ATA 2016 https://doi.org/10.1089/thy.2016.0229", basis="design")],
        "row_harms": {"iodine_first": _harm({}, rate_mult=1.5, en="Iodine before a thionamide fuels hormone synthesis (ATA 2016)",
                                            tr="Tiyonamidden önce iyot hormon sentezini artırır (ATA 2016)"),
                      "unmonitored_bb_hf": _harm({"systolic": -25, "diastolic": -12}, onset_min=10,
                                                 en="Unmonitored beta-blockade with heart failure: hypotension",
                                                 tr="Kalp yetmezliğinde izlemsiz beta blokaj: hipotansiyon")},
    },
    "adrenal_crisis": {
        "pattern": "distributive_shock", "s0": 0.45, "lag_min": 30, "recover_h": 0.4,
        "groups": [_grp("hydrocortisone", ("hydrocortisone",), ("corticosteroid",), en="Hydrocortisone 100 mg IV", tr="İ.V. 100 mg hidrokortizon"),
                   _grp("circulation", ("fluids_dextrose",), ("fluids",), modifies=False, en="Fluids and dextrose", tr="Sıvı ve dekstroz")],
        "targets": [_tgt("hydrocortisone", "hydrocortisone", 30, "Endocrine Society 2016 adrenal insufficiency https://doi.org/10.1210/jc.2015-1710 (immediately)", basis="design")],
    },
    "hyperkalemia": {
        "pattern": "electrolyte_arrhythmia",
        "groups": [_grp("calcium", ("calcium",), (), active_min=45, en="IV calcium", tr="İ.V. kalsiyum"),
                   _grp("shift", ("insulin_dextrose",), ("insulin_dextrose",), active_min=120, en="Insulin-glucose", tr="İnsülin-glukoz"),
                   _grp("removal", ("dialysis_referral",), (), lag_min=60, en="Potassium removal", tr="Potasyum uzaklaştırma")],
        "targets": [_tgt("calcium", "calcium", 10, "UKKA 2023 https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults", basis="design"),
                    _tgt("shift", "shift", 30, "UKKA 2023 https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults", basis="design")],
        "row_classes": {"insulin_dextrose": ["insulin_dextrose"]},
        "row_harms": {"k_fluids": _harm({}, rate_mult=1.5, en="Potassium-containing fluid raises potassium further",
                                        tr="Potasyum içeren sıvı potasyumu daha da artırır")},
    },
    "aki": {
        "pattern": "metabolic_slow", "rate_h": 0.03, "fluid": "renal",
        "groups": [_grp("cause", ("treat_cause_stop_nephrotoxins", "fluids_or_relieve"), (), en="Treat the cause", tr="Nedeni tedavi edin")],
        "targets": [],
    },
    "alcohol_withdrawal": {
        "pattern": "hyperthermia", "s0": 0.3, "rate_h": 0.1, "recover_h": 0.4, "arrest_rhythm": None,
        "peri": {"hr": 140, "systolic": 175, "diastolic": 100, "tempC": 38.8, "gcs": 12},
        "groups": [_grp("benzodiazepine", ("benzodiazepine",), ("benzodiazepine",), en="Benzodiazepine", tr="Benzodiazepin"),
                   _grp("thiamine", ("thiamine_early",), (), modifies=False, en="Thiamine", tr="Tiamin")],
        "targets": [_tgt("benzo", "benzodiazepine", 60, "NICE CG100 https://www.nice.org.uk/guidance/cg100", basis="design"),
                    _tgt("thiamine", "thiamine", 60, "NICE CG100 https://www.nice.org.uk/guidance/cg100", basis="design")],
        "branches": [_br("withdrawal_seizure", "status_epilepticus", [_c("unmet:benzodiazepine", "==", 1)], p=0.1, window=(30, 120), supersede=False,
                         why_en="Seeded withdrawal seizure without benzodiazepine cover (NICE CG100)",
                         why_tr="Benzodiazepin koruması olmadan tohumlanmış yoksunluk nöbeti (NICE CG100)")],
    },
    "opioid_overdose": {
        "pattern": "tox_resp_depression",
        "groups": [_grp("naloxone", ("naloxone_titrated",), ("naloxone",), active_min=45, en="Titrated naloxone", tr="Titre nalokson"),
                   _grp("airway", ("airway_support",), ("oxygen",), modifies=False, en="Airway and ventilation", tr="Hava yolu ve ventilasyon")],
        "targets": [_tgt("naloxone", "naloxone", 5, "AHA 2020 opioid emergency https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916", basis="design")],
        "row_harms": {"large_bolus": _harm({"hr": 25, "systolic": 30, "diastolic": 15}, onset_min=2,
                                           en="Large naloxone bolus: precipitated withdrawal, agitation and vomiting (Clarke 2005)",
                                           tr="Büyük nalokson bolusu: ani yoksunluk, ajitasyon ve kusma (Clarke 2005)")},
    },
    "febrile_neutropenia": {
        "pattern": "sepsis",
        "groups": [_grp("antimicrobial", ("immediate_abx",), ("antibiotic",), needs=("gram_neg", "pseudomonas"), en="Antipseudomonal cover", tr="Antipsödomonal kapsam")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, "NICE CG151 https://www.nice.org.uk/guidance/cg151")],
        "branches": _to_shock(),
    },
    "sickle_crisis": {
        "pattern": "local_time_critical", "rate_h": 0.05,
        "groups": [_grp("analgesia", ("analgesia",), ("opioid", "analgesia"), en="Analgesia", tr="Analjezi")],
        "targets": [_tgt("analgesia_30", "analgesia", 30, "NICE CG143 https://www.nice.org.uk/guidance/cg143")],
    },
    "ectopic_pregnancy": {
        "pattern": "haemorrhagic_shock",
        "groups": [_grp("surgery", ("emergency_surgery",), ("procedure",), lag_min=30, recover_h=0.5, en="Emergency surgery", tr="Acil cerrahi"),
                   _grp("resuscitation", ("iv_group_save",), ("fluids",), modifies=False, en="IV access and resuscitation", tr="Damar yolu ve resüsitasyon")],
        "targets": [_tgt("surgery", "surgery", 60, "NICE NG126 https://www.nice.org.uk/guidance/ng126 (immediately if unstable)", basis="design")],
    },
    "preeclampsia": {
        "pattern": "hypertensive_crisis", "rate_h": 0.1,
        "groups": [_grp("antihypertensive", ("antihypertensive",), (), en="Antihypertensive", tr="Antihipertansif"),
                   _grp("magnesium", ("magnesium",), (), modifies=False, en="Magnesium sulfate", tr="Magnezyum sülfat")],
        "targets": [_tgt("antihypertensive", "antihypertensive", 60, "ACOG CO 767 https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/02/emergent-therapy-for-acute-onset-severe-hypertension-during-pregnancy-and-the-postpartum-period"),
                    _tgt("magnesium", "magnesium", 60, "NICE NG133 https://www.nice.org.uk/guidance/ng133", basis="design")],
        "branches": [_br("eclampsia", "eclampsia", [_c("unmet:magnesium", "==", 1)], p=0.1, window=(30, 120),
                         why_en="Seeded eclamptic seizure without magnesium (Eclampsia Trial 1995)",
                         why_tr="Magnezyum olmadan tohumlanmış eklamptik nöbet (Eklampsi Çalışması 1995)")],
    },
    "pph": {
        "pattern": "haemorrhagic_shock", "rate_h": 0.45,
        "groups": [_grp("uterotonic", ("uterotonics",), (), lag_min=10, recover_h=0.5, en="Uterotonics", tr="Uterotonik"),
                   _grp("txa", ("tranexamic_acid",), (), modifies=False, en="Tranexamic acid", tr="Traneksamik asit"),
                   _grp("resuscitation", ("resus_transfuse",), ("fluids",), modifies=False, en="Resuscitation and transfusion", tr="Resüsitasyon ve transfüzyon")],
        "targets": [_tgt("uterotonic", "uterotonic", 15, "WHO 2012 PPH https://www.who.int/publications/i/item/9789241548502", basis="design"),
                    _tgt("txa_3h", "txa", 180, "WHO 2017 TXA in PPH https://www.who.int/publications/i/item/WHO-RHR-17.21")],
    },
    "cauda_equina": {
        "pattern": "local_time_critical", "rate_h": 0.05,
        "groups": [_grp("mri", ("urgent_mri",), (), modifies=False, en="Emergency MRI", tr="Acil MR"),
                   _grp("decompression", ("surgical_decompression",), (), en="Surgical decompression", tr="Cerrahi dekompresyon")],
        "targets": [_tgt("mri_4h", "mri", 240, "GIRFT National Suspected Cauda Equina Syndrome Pathway 2023 https://gettingitrightfirsttime.co.uk")],
    },
    "compartment_syndrome": {
        "pattern": "local_time_critical", "rate_h": 0.2,
        "groups": [_grp("fasciotomy", ("fasciotomy",), ("procedure",), en="Fasciotomy", tr="Fasyotomi"),
                   _grp("release", ("release_dressings",), (), modifies=False, en="Release dressings", tr="Sargıları gevşetme")],
        "targets": [_tgt("fasciotomy_1h", "fasciotomy", 60, "BOAST 10 compartment syndrome https://www.boa.ac.uk/resource/boast-10-pdf.html")],
        "row_harms": {"elevate_above_heart": _harm({}, rate_mult=1.5, en="Elevation above the heart lowers perfusion pressure (BOAST 10)",
                                                   tr="Kalp seviyesinin üzerine kaldırma perfüzyon basıncını düşürür (BOAST 10)")},
    },
    "paracetamol_od": {
        "pattern": "stable",
        "groups": [_grp("nac", ("nac",), (), en="Acetylcysteine", tr="Asetilsistein")],
        "targets": [_tgt("nac_8h", "nac", 240, "MHRA 2012 / TOXBASE: NAC within 8 h of ingestion (arrival assumed 4 h after ingestion) https://www.toxbase.org", basis="design")],
    },
    # ---- the 47 conditions that had no fixture (06b F03) ---------------- #
    "cardiac_arrest": {
        "pattern": "arrest",
        "groups": [_grp("defibrillation", ("cpr_defib",), ("rhythm",), en="Defibrillation", tr="Defibrilasyon"),
                   _grp("adrenaline", ("adrenaline_1mg",), ("adrenaline_iv",), modifies=False, en="Adrenaline 1 mg IV", tr="İ.V. 1 mg adrenalin")],
        "targets": [_tgt("defibrillation", "defibrillation", 2, ERC21 + " (shock without delay)", basis="design")],
    },
    "major_trauma": {
        "pattern": "haemorrhagic_shock", "s0": 0.5, "rate_h": 0.35,
        "groups": [_grp("haemorrhage_control", ("haemorrhage_control",), ("procedure",), lag_min=5, recover_h=0.4, en="Haemorrhage control", tr="Kanama kontrolü"),
                   _grp("txa", ("txa",), (), modifies=False, en="Tranexamic acid", tr="Traneksamik asit"),
                   _grp("blood", ("blood_products",), (), modifies=False, en="Blood products", tr="Kan ürünleri")],
        "targets": [_tgt("haemorrhage_control", "haemorrhage_control", 10, "NICE NG39 https://www.nice.org.uk/guidance/ng39", basis="design"),
                    _tgt("txa_3h", "txa", 180, "CRASH-2, Lancet 2010 https://doi.org/10.1016/S0140-6736(10)60835-5 ; NICE NG39")],
        "row_classes": {"crystalloid_large": ["fluids"], "blood_products": ["blood"]},
    },
    "heat_stroke": {
        "pattern": "hyperthermia", "s0": 0.55, "rate_h": 0.25, "recover_h": 1.2,
        "groups": [_grp("cooling", ("active_cooling",), (), en="Active cooling", tr="Aktif soğutma")],
        "targets": [_tgt("cooling", "cooling", 30, "ACSM 2023 exertional heat illness https://doi.org/10.1249/JSR.0000000000001058 (cool first)", basis="design")],
    },
    "hypothermia": {
        "pattern": "hypothermic",
        "groups": [_grp("rewarming", ("active_rewarming", "gentle_handling"), (), en="Active rewarming", tr="Aktif ısıtma")],
        "targets": [_tgt("rewarming", "rewarming", 30, ERC21SC, basis="design")],
        "row_harms": {"rough_handling": _harm({}, arrest="VF", p=0.5, en="Rough handling of a cold heart can trigger VF (ERC 2021)",
                                              tr="Soğuk kalbin kaba hareketi VF tetikleyebilir (ERC 2021)")},
    },
    "drowning": {
        "pattern": "hypoxic_resp", "s0": 0.5, "rate_h": 0.3,
        "groups": [_grp("oxygenation", ("ventilate_o2", "cpap_niv"), ("oxygen", "niv"), lag_min=5, recover_h=0.3, en="Oxygenation and ventilation", tr="Oksijenlenme ve ventilasyon")],
        "targets": [_tgt("oxygenation", "oxygenation", 5, "ERC 2021 drowning https://doi.org/10.1016/j.resuscitation.2021.02.011", basis="design")],
    },
    "electrical_injury": {
        "pattern": "stable",
        "groups": [_grp("ecg", ("ecg_monitor", "11524-6"), (), modifies=False, en="ECG and monitoring", tr="EKG ve monitörizasyon")],
        "targets": [_tgt("ecg", "ecg", 10, ERC21SC, basis="design")],
        "branches": [_br("vf", "", [_c("unmet:ecg", "==", 1)], p=0.02, window=(0, 60), arrest="VF",
                         why_en="Seeded delayed ventricular arrhythmia after high-voltage injury (ERC 2021)",
                         why_tr="Yüksek voltaj sonrası tohumlanmış gecikmiş ventriküler aritmi (ERC 2021)")],
    },
    "undiff_chest_pain": {
        "pattern": "stable",
        "groups": [_grp("ecg", ("ecg_10min", "11524-6"), (), modifies=False, en="12-lead ECG", tr="12 derivasyonlu EKG")],
        "targets": [_tgt("ecg_10min", "ecg", 10, ESC23)],
    },
    "undiff_dyspnea": {
        "pattern": "hypoxic_resp", "rate_h": 0.08, "s0": 0.3,
        "groups": [_grp("oxygen", ("o2_titrated",), ("oxygen", "niv"), modifies=False, en="Titrated oxygen", tr="Titre oksijen")],
        "targets": [_tgt("oxygen", "oxygen", 15, BTS17, basis="design")],
        "row_harms": {"sedation_dyspnoea": _harm({"rr": -6, "spo2": -6, "gcs": -2}, onset_min=5, en="Sedation suppresses respiratory drive",
                                                 tr="Sedasyon solunum dürtüsünü baskılar")},
    },
    "poisoning_unknown": {
        "pattern": "tox_resp_depression", "s0": 0.4, "rate_h": 0.1,
        "groups": [_grp("assessment", ("abcde_glucose_ecg", "airway_support"), (), modifies=False, en="ABCDE, glucose and ECG", tr="ABCDE, glukoz ve EKG")],
        "targets": [_tgt("abcde", "assessment", 10, "AHA 2023 poisoning https://doi.org/10.1161/CIR.0000000000001161", basis="design")],
        "row_harms": {"empirical_flumazenil": _harm({}, branch="status_epilepticus", p=0.3, en="Flumazenil can precipitate seizures (AHA 2023)",
                                                    tr="Flumazenil nöbet tetikleyebilir (AHA 2023)")},
    },
    "acute_agitation": {
        "pattern": "psych_risk",
        "groups": [_grp("organic", ("exclude_organic",), (), modifies=False, en="Exclude organic causes", tr="Organik nedenleri dışlayın")],
        "targets": [_tgt("organic", "organic", 30, "NICE NG10 https://www.nice.org.uk/guidance/ng10", basis="design")],
        "row_harms": {"prone_restraint": _harm({"spo2": -10, "hr": 20}, onset_min=5, arrest="PEA", p=0.1,
                                               en="Prolonged prone restraint: positional asphyxia (NICE NG10)",
                                               tr="Uzun yüzüstü tespit: pozisyonel asfiksi (NICE NG10)")},
    },
    "hemoptysis": {
        "pattern": "hypoxic_resp", "s0": 0.45, "rate_h": 0.25,
        "groups": [_grp("embolisation", ("bae",), ("procedure",), lag_min=30, en="Bronchial artery embolisation", tr="Bronşiyal arter embolizasyonu"),
                   _grp("position", ("bleeding_side_down",), (), modifies=False, en="Position and airway", tr="Pozisyon ve hava yolu")],
        "targets": [_tgt("embolisation", "embolisation", 120, "Kathuria 2020 https://doi.org/10.1186/s40560-020-00441-8", basis="design")],
        "row_harms": {"anticoag_hemoptysis": _harm({}, rate_mult=2.0, en="Anticoagulation worsens haemoptysis", tr="Antikoagülasyon hemoptiziyi kötüleştirir")},
    },
    "aspiration_pneumonitis": {
        "pattern": "hypoxic_resp", "s0": 0.35, "rate_h": 0.08, "recover_h": 0.1,
        "groups": [_grp("supportive", ("o2_suction",), ("oxygen", "niv"), en="Oxygen and supportive care", tr="Oksijen ve destek")],
        "targets": [_tgt("oxygen", "supportive", 15, "Mandell 2019 https://doi.org/10.1056/NEJMra1714562", basis="design")],
    },
    "ards": {
        "pattern": "hypoxic_resp", "s0": 0.6, "rate_h": 0.15, "recover_h": 0.1, "o2_response": 0.15,
        "groups": [_grp("ventilation", ("lung_protective", "prone"), (), lag_min=30, en="Lung-protective ventilation", tr="Akciğer koruyucu ventilasyon")],
        "targets": [_tgt("ventilation", "ventilation", 60, "ESICM 2023 https://doi.org/10.1007/s00134-023-07050-7", basis="design")],
        "row_harms": {"high_tidal": _harm({}, rate_mult=1.5, en="High tidal volumes injure the lung (ESICM 2023)", tr="Yüksek tidal hacim akciğeri hasarlar (ESICM 2023)")},
    },
    "perforated_ulcer": {
        "pattern": "sepsis", "rate_h": 0.25,
        "groups": [_grp("antimicrobial", ("ppi_abx",), ("antibiotic",), needs=("gram_neg", "anaerobe"), en="Gram-negative and anaerobic cover", tr="Gram-negatif ve anaerop kapsam"),
                   _grp("surgery", ("emergency_surgery",), ("procedure",), en="Emergency repair", tr="Acil onarım")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, SSC21),
                    _tgt("surgery", "surgery", 180, "WSES 2020 https://doi.org/10.1186/s13017-019-0283-9 (as soon as possible)", basis="design")],
        "branches": _to_shock(),
        "findings": [_fd("peritonism", "abdominal", [], "Board-like rigidity with rebound tenderness: generalised peritonism.",
                         "Tahta gibi sertlik ve rebound hassasiyet: yaygın peritonizm.")],
    },
    "mesenteric_ischemia": {
        "pattern": "sepsis", "s0": 0.35, "rate_h": 0.2,
        "groups": [_grp("revascularisation", ("revascularisation",), ("procedure",), en="Revascularisation or laparotomy", tr="Revaskülarizasyon veya laparotomi"),
                   _grp("ct", ("ct_angio",), (), modifies=False, en="CT angiography", tr="BT anjiyografi")],
        "targets": [_tgt("ct", "ct", 60, "WSES 2022 https://doi.org/10.1186/s13017-022-00443-x", basis="design"),
                    _tgt("revascularisation", "revascularisation", 360, "WSES 2022 https://doi.org/10.1186/s13017-022-00443-x", basis="design")],
        "branches": _to_shock(),
        "findings": [_fd("peritonism", "abdominal", [_c("s", ">=", 0.6)], "New guarding and rebound: the pain-out-of-proportion phase has become peritonism.",
                         "Yeni defans ve rebound: orantısız ağrı evresi peritonizme döndü.")],
    },
    "tia": {
        "pattern": "stable",
        "groups": [_grp("aspirin", ("aspirin_300",), ("antiplatelet",), modifies=False, en="Aspirin 300 mg", tr="300 mg aspirin")],
        "targets": [_tgt("aspirin", "aspirin", 60, "NICE NG128 https://www.nice.org.uk/guidance/ng128 (immediately)", basis="design")],
    },
    "gbs": {
        "pattern": "hypercapnic_resp", "s0": 0.3, "rate_h": 0.04, "hypercapnic": False,
        "groups": [_grp("ivig", ("ivig",), (), lag_min=600, en="IVIg or plasma exchange", tr="İVİG veya plazmaferez")],
        "targets": [_tgt("ivig", "ivig", 1440, "EAN/PNS 2023 https://doi.org/10.1111/ene.16073", basis="design")],
    },
    "myasthenic_crisis": {
        "pattern": "hypercapnic_resp", "s0": 0.5, "rate_h": 0.15, "hypercapnic": False,
        "groups": [_grp("ventilation", ("airway_niv",), ("niv",), lag_min=10, en="NIV or intubation", tr="NIV veya entübasyon")],
        "targets": [_tgt("ventilation", "ventilation", 30, "Sanders 2016 https://doi.org/10.1212/WNL.0000000000002790", basis="design")],
        "row_harms": {"aminoglycoside_mg": _harm({}, rate_mult=1.5, en="Aminoglycoside or magnesium worsens weakness (Sanders 2016)",
                                                 tr="Aminoglikozit veya magnezyum güçsüzlüğü artırır (Sanders 2016)")},
    },
    "spinal_cord_compression": {
        "pattern": "local_time_critical", "rate_h": 0.02,
        "groups": [_grp("mri", ("mri_24h",), (), modifies=False, en="Whole-spine MRI", tr="Tüm omurga MR"),
                   _grp("decompression", ("spinal_referral",), (), en="Spinal surgery or radiotherapy", tr="Omurga cerrahisi veya radyoterapi")],
        "targets": [_tgt("mri_24h", "mri", 1440, "NICE NG234 https://www.nice.org.uk/guidance/ng234")],
    },
    "encephalitis": {
        "pattern": "neuro_infective",
        "groups": [_grp("antiviral", ("aciclovir",), ("antiviral",), lag_min=120, en="IV aciclovir", tr="İ.V. asiklovir")],
        "targets": [_tgt("aciclovir_6h", "antiviral", 360, "ABN/BIA 2012 https://doi.org/10.1016/j.jinf.2011.11.013")],
        "branches": [_br("seizure", "status_epilepticus", [], p=0.2, window=(30, 110), supersede=False, s_start=0.6,
                         why_en="Seeded seizure in encephalitis (ABN/BIA 2012)", why_tr="Ensefalitte tohumlanmış nöbet (ABN/BIA 2012)")],
    },
    "tetanus": {
        "pattern": "hypercapnic_resp", "s0": 0.4, "rate_h": 0.1, "hypercapnic": False,
        "groups": [_grp("spasm_control", ("benzo_mag_quiet",), ("benzodiazepine",), recover_h=0.2, en="Spasm control", tr="Spazm kontrolü"),
                   _grp("antitoxin", ("htig",), (), modifies=False, en="Antitoxin", tr="Antitoksin")],
        "targets": [_tgt("antitoxin", "antitoxin", 60, "Yen & Thwaites, Lancet 2019 https://doi.org/10.1016/S0140-6736(19)31894-6", basis="design")],
        "row_harms": {"stimulation": _harm({"rr": -6, "spo2": -8}, onset_min=2, rate_mult=1.5, en="Stimulation triggers spasm and laryngospasm",
                                           tr="Uyarım spazm ve laringospazm tetikler")},
    },
    "myxedema_coma": {
        "pattern": "hypothermic", "s0": 0.5, "rate_h": 0.05, "recover_h": 0.05,
        "peri": {"tempC": 30.0, "hr": 35, "systolic": 70, "diastolic": 40, "rr": 6, "gcs": 5},
        "groups": [_grp("thyroid_hormone", ("iv_levothyroxine_hc",), ("corticosteroid",), lag_min=120, en="IV levothyroxine and hydrocortisone", tr="İ.V. levotiroksin ve hidrokortizon")],
        "targets": [_tgt("thyroid_hormone", "thyroid_hormone", 60, "ATA 2014 https://doi.org/10.1089/thy.2014.0028", basis="design")],
        "row_harms": {"aggressive_rewarm": _harm({"systolic": -20, "diastolic": -10}, onset_min=15, en="Active rewarming vasodilates: hypotension (ATA 2014)",
                                                 tr="Aktif ısıtma vazodilatasyon yapar: hipotansiyon (ATA 2014)")},
    },
    "hyponatremia": {
        "pattern": "metabolic_coma", "rate_h": 0.1, "lag_min": 20, "recover_h": 0.4,
        "groups": [_grp("hypertonic", ("hypertonic_bolus",), (), en="Hypertonic saline bolus", tr="Hipertonik salin bolusu")],
        "targets": [_tgt("hypertonic", "hypertonic", 30, "Spasovski 2014 https://doi.org/10.1530/EJE-13-1020 (immediately)", basis="design")],
        "branches": [_br("seizure", "status_epilepticus", [_c("unmet:hypertonic", "==", 1)], p=0.2, window=(15, 90), supersede=False,
                         why_en="Seeded hyponatraemic seizure without hypertonic saline (Spasovski 2014)",
                         why_tr="Hipertonik salin olmadan tohumlanmış hiponatremik nöbet (Spasovski 2014)")],
        "row_harms": {"rapid_correction": _harm({}, en="Over-rapid correction risks osmotic demyelination days later (Spasovski 2014)",
                                                tr="Aşırı hızlı düzeltme günler sonra osmotik demiyelinizasyon riski taşır (Spasovski 2014)")},
    },
    "pheochromocytoma": {
        "pattern": "hypertensive_crisis",
        "groups": [_grp("alpha_blockade", ("alpha_blockade",), (), recover_h=0.4, en="Alpha-blockade", tr="Alfa blokaj")],
        "targets": [_tgt("alpha_blockade", "alpha_blockade", 30, "Endocrine Society 2014 https://doi.org/10.1210/jc.2014-1498", basis="design")],
        "row_harms": {"beta_first": _harm({"systolic": 30, "diastolic": 15}, onset_min=10, rate_mult=1.5,
                                          en="Beta-blocker before alpha-blockade: unopposed alpha vasoconstriction (Endocrine Society 2014)",
                                          tr="Alfa blokajdan önce beta bloker: karşılanmamış alfa vazokonstriksiyonu (Endokrin Derneği 2014)")},
    },
    "hyperkalemia_esrd": {
        "pattern": "electrolyte_arrhythmia",
        "groups": [_grp("calcium", ("calcium",), (), active_min=45, en="IV calcium", tr="İ.V. kalsiyum"),
                   _grp("shift", ("insulin_dextrose",), ("insulin_dextrose",), active_min=120, en="Insulin-glucose", tr="İnsülin-glukoz"),
                   _grp("removal", ("urgent_dialysis",), (), lag_min=60, en="Haemodialysis", tr="Hemodiyaliz")],
        "targets": [_tgt("calcium", "calcium", 10, "UKKA 2023 https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults", basis="design"),
                    _tgt("shift", "shift", 30, "UKKA 2023 https://ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults", basis="design")],
        "row_classes": {"insulin_dextrose": ["insulin_dextrose"]},
        "row_harms": {"k_fluids": _harm({}, rate_mult=1.5, en="Potassium-containing fluid raises potassium further",
                                        tr="Potasyum içeren sıvı potasyumu daha da artırır")},
    },
    "testicular_torsion": {
        "pattern": "local_time_critical",
        "groups": [_grp("exploration", ("urology_exploration",), ("procedure",), en="Scrotal exploration", tr="Skrotal eksplorasyon")],
        "targets": [_tgt("exploration", "exploration", 60, "EAU Paediatric Urology 2023 https://uroweb.org/guidelines/paediatric-urology (salvage best within 6 h)", basis="design")],
    },
    "priapism": {
        "pattern": "local_time_critical", "rate_h": 0.1,
        "groups": [_grp("aspiration", ("aspiration_phenylephrine",), (), en="Aspiration and phenylephrine", tr="Aspirasyon ve fenilefrin")],
        "targets": [_tgt("aspiration", "aspiration", 60, "AUA/SMSNA 2022 https://doi.org/10.1097/JU.0000000000002236", basis="design")],
    },
    "suicidal_ideation": {
        "pattern": "psych_risk",
        "groups": [_grp("observation", ("safe_observation",), (), modifies=False, en="Safe observation", tr="Güvenli gözlem")],
        "targets": [_tgt("observation", "observation", 15, "NICE NG225 https://www.nice.org.uk/guidance/ng225", basis="design")],
    },
    "acute_psychosis": {
        "pattern": "psych_risk",
        "groups": [_grp("organic", ("organic_screen",), (), modifies=False, en="Organic screen", tr="Organik tarama")],
        "targets": [_tgt("organic", "organic", 60, "NICE CG178 https://www.nice.org.uk/guidance/cg178", basis="design")],
    },
    "serotonin_syndrome": {
        "pattern": "hyperthermia", "s0": 0.4, "rate_h": 0.15, "recover_h": 0.5,
        "groups": [_grp("stop_cool", ("stop_agent_cool", "benzo"), ("benzodiazepine",), en="Stop agent, benzodiazepine, cool", tr="Ajanı kesin, benzodiazepin, soğutun")],
        "targets": [_tgt("stop_cool", "stop_cool", 30, "Boyer 2005 https://doi.org/10.1056/NEJMra041867", basis="design")],
        "row_harms": {"restraint_antipsychotic": _harm({"tempC": 0.5}, onset_min=20, rate_mult=1.5, en="Restraint raises muscle heat production (Boyer 2005)",
                                                       tr="Tespit kas ısı üretimini artırır (Boyer 2005)")},
    },
    "nms": {
        "pattern": "hyperthermia", "s0": 0.4, "rate_h": 0.1, "recover_h": 0.3,
        "groups": [_grp("stop", ("stop_antipsychotic", "benzo_dantrolene"), ("benzodiazepine",), en="Stop the antipsychotic", tr="Antipsikotiği kesin")],
        "targets": [_tgt("stop", "stop", 30, "Berman 2011 https://doi.org/10.1177/1941875210386491", basis="design")],
        "row_harms": {"more_antipsychotic": _harm({"tempC": 0.4}, onset_min=30, rate_mult=1.5, en="More antipsychotic worsens NMS", tr="Ek antipsikotik NMS'yi kötüleştirir")},
    },
    "delirium_tremens": {
        "pattern": "hyperthermia", "s0": 0.45, "rate_h": 0.2, "recover_h": 0.4,
        "peri": {"hr": 150, "systolic": 180, "diastolic": 105, "tempC": 39.5, "gcs": 9, "rr": 28},
        "groups": [_grp("benzodiazepine", ("benzo_titrated",), ("benzodiazepine",), en="Benzodiazepine", tr="Benzodiazepin"),
                   _grp("thiamine", ("thiamine_iv",), (), modifies=False, en="IV thiamine", tr="İ.V. tiamin")],
        "targets": [_tgt("benzo", "benzodiazepine", 30, "NICE CG100 https://www.nice.org.uk/guidance/cg100", basis="design"),
                    _tgt("thiamine", "thiamine", 60, "NICE CG100 https://www.nice.org.uk/guidance/cg100", basis="design")],
        "branches": [_br("withdrawal_seizure", "status_epilepticus", [_c("unmet:benzodiazepine", "==", 1)], p=0.2, window=(20, 100), supersede=False,
                         why_en="Seeded withdrawal seizure (NICE CG100)", why_tr="Tohumlanmış yoksunluk nöbeti (NICE CG100)")],
    },
    "tumor_lysis": {
        "pattern": "electrolyte_arrhythmia", "s0": 0.35, "rate_h": 0.08, "bedside0": {"k": 6.2},
        "groups": [_grp("hydration", ("hydration_tls", "rasburicase"), ("fluids",), en="Hydration and rasburicase", tr="Hidrasyon ve rasburikaz")],
        "targets": [_tgt("hydration", "hydration", 60, "Howard 2011 https://doi.org/10.1056/NEJMra0904569", basis="design")],
    },
    "dic": {
        "pattern": "haemorrhagic_shock", "s0": 0.35, "rate_h": 0.1,
        "groups": [_grp("cause", ("treat_cause",), (), en="Treat the cause", tr="Nedeni tedavi edin"),
                   _grp("products", ("blood_products_dic",), (), modifies=False, en="Blood products", tr="Kan ürünleri")],
        "targets": [_tgt("cause", "cause", 60, "BCSH 2009 https://doi.org/10.1111/j.1365-2141.2009.07600.x", basis="design")],
    },
    "acute_leukemia": {
        "pattern": "sepsis", "s0": 0.25, "rate_h": 0.05,
        "groups": [_grp("referral", ("haematology_urgent",), (), modifies=False, en="Urgent haematology", tr="Acil hematoloji")],
        "targets": [_tgt("referral", "referral", 240, "ELN 2022 https://doi.org/10.1182/blood.2022016867", basis="design")],
    },
    "hemophilia_bleed": {
        "pattern": "haemorrhagic_shock", "s0": 0.35, "rate_h": 0.15,
        "groups": [_grp("factor", ("factor_now",), (), lag_min=15, en="Factor concentrate", tr="Faktör konsantresi")],
        "targets": [_tgt("factor", "factor", 30, "WFH 2020 https://doi.org/10.1111/hae.14046 (as soon as possible)", basis="design")],
    },
    "transfusion_reaction": {
        "pattern": "distributive_shock", "s0": 0.4, "rate_h": 0.6, "recover_h": 0.6, "lag_min": 0,
        "groups": [_grp("stop", ("stop_transfusion",), (), en="Stop the transfusion", tr="Transfüzyonu durdurun")],
        "targets": [_tgt("stop", "stop", 5, "BSH 2012 https://doi.org/10.1111/bjh.12017 (immediately)", basis="design")],
        "row_harms": {"continue_slower": _harm({}, rate_mult=1.5, en="Continuing the transfusion continues the exposure (BSH 2012)",
                                               tr="Transfüzyona devam etmek maruziyeti sürdürür (BSH 2012)")},
    },
    "ovarian_torsion": {
        "pattern": "local_time_critical",
        "groups": [_grp("laparoscopy", ("gyn_laparoscopy",), ("procedure",), en="Laparoscopy and detorsion", tr="Laparoskopi ve detorsiyon")],
        "targets": [_tgt("laparoscopy", "laparoscopy", 120, "ACOG CO 783 https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/08/adnexal-torsion-in-adolescents", basis="design")],
    },
    "eclampsia": {
        "pattern": "seizure", "s0": 0.5,
        "peri": {"gcs": 3, "hr": 140, "systolic": 200, "diastolic": 120, "rr": 10, "spo2": 80},
        "well": {"gcs": 14, "hr": 95, "systolic": 150, "diastolic": 95, "rr": 16, "spo2": 96},
        "groups": [_grp("magnesium", ("magnesium_load",), (), lag_min=5, recover_h=1.0, en="Magnesium sulfate", tr="Magnezyum sülfat"),
                   _grp("antihypertensive", ("antihypertensive",), (), modifies=False, en="Antihypertensive", tr="Antihipertansif")],
        "targets": [_tgt("magnesium", "magnesium", 15, "Eclampsia Trial, Lancet 1995 https://doi.org/10.1016/S0140-6736(95)91034-3 ; NICE NG133", basis="design"),
                    _tgt("antihypertensive", "antihypertensive", 60, "ACOG CO 767 https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/02/emergent-therapy-for-acute-onset-severe-hypertension-during-pregnancy-and-the-postpartum-period")],
    },
    "placental_abruption": {
        "pattern": "haemorrhagic_shock", "s0": 0.5, "rate_h": 0.3,
        "groups": [_grp("delivery", ("ctg_delivery",), (), lag_min=30, en="Urgent delivery", tr="Acil doğum"),
                   _grp("resuscitation", ("resus_mhp",), ("fluids",), modifies=False, en="Resuscitation", tr="Resüsitasyon")],
        "targets": [_tgt("delivery", "delivery", 60, "RCOG GTG 63 https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/antepartum-haemorrhage-green-top-guideline-no-63/", basis="design")],
        "row_harms": {"tocolysis": _harm({}, rate_mult=1.3, en="Tocolysis is contraindicated in abruption (RCOG GTG 63)", tr="Dekolmanda tokoliz kontrendikedir (RCOG GTG 63)")},
    },
    "open_fracture": {
        "pattern": "local_time_critical", "rate_h": 0.05,
        "groups": [_grp("antimicrobial", ("iv_abx_1h",), ("antibiotic",), needs=("gram_pos",), modifies=False, en="IV antibiotics", tr="İ.V. antibiyotik")],
        "targets": [_tgt("abx_1h", "antimicrobial", 60, "BOAST 4 https://www.boa.ac.uk/resource/boast-4-pdf.html")],
    },
    "tca_overdose": {
        "pattern": "tox_cardiac",
        "groups": [_grp("bicarbonate", ("sodium_bicarb",), (), en="Sodium bicarbonate", tr="Sodyum bikarbonat")],
        "targets": [_tgt("bicarbonate", "bicarbonate", 15, "AHA 2023 poisoning https://doi.org/10.1161/CIR.0000000000001161", basis="design")],
        "branches": [_br("vf", "", [_c("unmet:bicarbonate", "==", 1)], p=0.15, window=(20, 100), arrest="VF",
                         why_en="Seeded ventricular arrhythmia with QRS widening and no bicarbonate (AHA 2023)",
                         why_tr="QRS genişlemesi ve bikarbonat yokken tohumlanmış ventriküler aritmi (AHA 2023)")],
        "row_harms": {"physostigmine_flumazenil": _harm({}, arrest="asystole", p=0.5, en="Physostigmine or flumazenil in TCA poisoning: asystole or seizures (AHA 2023)",
                                                        tr="TSA zehirlenmesinde fizostigmin veya flumazenil: asistoli veya nöbet (AHA 2023)")},
    },
    "anticholinergic_tox": {
        "pattern": "hyperthermia", "s0": 0.35, "rate_h": 0.08, "recover_h": 0.4, "arrest_rhythm": None,
        "groups": [_grp("benzo", ("benzo_cooling", "physostigmine_expert"), ("benzodiazepine",), en="Benzodiazepine and cooling", tr="Benzodiazepin ve soğutma")],
        "targets": [_tgt("benzo", "benzo", 60, "Dawson 2016 https://doi.org/10.1111/bcp.12619", basis="design")],
    },
    "rhabdomyolysis": {
        "pattern": "metabolic_slow", "rate_h": 0.05, "metabolic": "hyperk", "bedside0": {"k": 5.6}, "fluid_limit_ml": 6000,
        "groups": [_grp("fluids", ("fluids_uo",), ("fluids",), en="IV fluids", tr="İ.V. sıvı")],
        "targets": [_tgt("fluids", "fluids", 60, "Bosch 2009 https://doi.org/10.1056/NEJMra0801327", basis="design")],
    },
    "salicylate_od": {
        "pattern": "metabolic_slow", "rate_h": 0.12, "arrest_rhythm": "PEA",
        "peri": {"hr": 140, "rr": 40, "systolic": 85, "diastolic": 50, "gcs": 8, "tempC": 38.8},
        "groups": [_grp("alkalinisation", ("bicarb_alkalinise",), (), lag_min=30, recover_h=0.2, en="Urinary alkalinisation", tr="İdrar alkalinizasyonu")],
        "targets": [_tgt("alkalinisation", "alkalinisation", 60, "EXTRIP 2015 https://doi.org/10.1016/j.annemergmed.2015.03.032", basis="design")],
        "row_harms": {"intubate_no_hypervent": _harm({}, arrest="PEA", p=0.5, en="Intubation without matched ventilation: acidaemia and arrest (EXTRIP 2015)",
                                                     tr="Ventilasyonu karşılanmadan entübasyon: asidemi ve arrest (EXTRIP 2015)")},
    },
    "organophosphate_poisoning": {
        "pattern": "hypercapnic_resp", "s0": 0.55, "rate_h": 0.3, "recover_h": 1.5, "hypercapnic": False,
        "peri": {"hr": 35, "systolic": 70, "diastolic": 40, "rr": 6, "spo2": 70, "gcs": 6},
        "groups": [_grp("atropine", ("atropine_double",), (), lag_min=2, en="Atropine", tr="Atropin")],
        "targets": [_tgt("atropine", "atropine", 10, "Eddleston 2008 https://doi.org/10.1016/S0140-6736(07)61202-1", basis="design")],
        "row_harms": {"suxamethonium": _harm({}, rate_mult=1.5, en="Suxamethonium: prolonged paralysis (Eddleston 2008)", tr="Süksinilkolin: uzamış paralizi (Eddleston 2008)")},
    },
    # Branch-only labels.
    "refractory_shock": {"pattern": "stable", "groups": [], "targets": []},
}

# Antimicrobial spectrum by formulary code (review 06b F11). An abstract case
# row ("Broad-spectrum IV antibiotics") is taken as adequate for its own
# condition; a named formulary agent is checked against the rule's ``needs``.
# Sources: NICE NG240 (ceftriaxone and chloramphenicol cross the blood-brain
# barrier; vancomycin is an add-on), IDSA meningitis 2004
# https://doi.org/10.1086/425368 , Tokyo Guidelines 2018, NICE CG151, BNF
# treatment summaries https://bnf.nice.org.uk/treatment-summaries/
AGENT_COVERAGE: dict[str, list[str]] = {
    "2193": ["gram_pos", "gram_neg", "cns"],
    "pip-tazo": ["gram_pos", "gram_neg", "anaerobe", "pseudomonas"],
    "29561": ["gram_pos", "gram_neg", "anaerobe", "pseudomonas", "cns"],
    "11124": ["gram_pos", "mrsa"],
    "4413": ["gram_neg", "pseudomonas"],
    "82122": ["gram_pos", "gram_neg", "atypical"],
    "21212": ["atypical"],
    "3640": ["atypical", "gram_pos"],
    "2582": ["gram_pos", "anaerobe"],
    "6922": ["anaerobe"],
    "2348": ["gram_pos", "gram_neg", "anaerobe", "cns"],
}

# Allergen class by formulary code (06b section 4.3).
AGENT_ALLERGY_CLASS: dict[str, str] = {
    "pip-tazo": "penicillin", "2193": "cephalosporin", "29561": "carbapenem", "1191": "nsaid", "7052": "opioid",
}

# Treatment class of each formulary code (normalize.WEB_TREATMENT_CATALOG, F08:
# classes come from the catalogue, never from a substring such as "beta").
CODE_CLASSES: dict[str, list[str]] = {
    "7806": ["oxygen"], "313002": ["fluids"], "1191": ["antiplatelet"], "4917": ["nitrate"], "7052": ["opioid"],
    "2193": ["antibiotic"], "pip-tazo": ["antibiotic"], "29561": ["antibiotic"], "11124": ["antibiotic"],
    "4413": ["antibiotic"], "82122": ["antibiotic"], "21212": ["antibiotic"], "3640": ["antibiotic"],
    "2582": ["antibiotic"], "6922": ["antibiotic"], "2348": ["antibiotic"], "artesunate": ["antimalarial"],
    "260101": ["antiviral"], "3264": ["corticosteroid"], "435": ["bronchodilator"], "448": ["rhythm"],
    "5856": ["insulin_frii"], "7242": ["naloxone"], "6470": ["benzodiazepine"], "161": ["antipyretic"],
    "26225": ["antiemetic"], "3992-im": ["adrenaline_im"], "3992": ["adrenaline_iv"], "8410": ["thrombolytic"],
}

# Vital effect curve per treatment class (06b section 4.1). ``onset`` is the
# ramp to full effect in minutes, ``wane`` the minutes after administration
# over which it fades to nothing (None: lasts while running). Context rules
# (oxygen dose response, fluid responsiveness, titrated pressor, nitrate and
# adrenaline gates) live in course.py; the numbers live here.
CLASS_EFFECTS: dict[str, dict[str, Any]] = {
    "fluids": {"effects": {"systolic": 12, "diastolic": 6, "hr": -7, "crt": -1}, "onset": 15, "wane": [30, 75],
               "source": "Glassford 2014 https://doi.org/10.1186/s13054-014-0696-5 ; NICE CG174"},
    "adrenaline_im": {"effects": {"systolic": 20, "diastolic": 8, "spo2": 5, "rr": -5, "hr": -5}, "onset": 4, "wane": [10, 30],
                      "source": RCUK21 + " ; Simons 2001 https://doi.org/10.1067/mai.2001.119411"},
    "adrenaline_iv_bolus": {"effects": {"systolic": 60, "diastolic": 25, "hr": 40}, "onset": 1, "wane": [5, 15], "source": RCUK21},
    "nitrate": {"effects": {"systolic": -15, "diastolic": -8}, "onset": 3, "wane": [20, 40], "source": ESC21HF},
    "nitrate_harm": {"effects": {"systolic": -35, "diastolic": -15, "hr": 15}, "onset": 3, "wane": [20, 45],
                     "source": ESC23 + " ; AHA ACS 2025 https://doi.org/10.1161/CIR.0000000000001309"},
    "loop_diuretic": {"effects": {"rr": -4, "spo2": 3, "urine": 100}, "onset": 30, "wane": None, "source": ESC21HF},
    "niv": {"effects": {"spo2": 6, "rr": -4}, "onset": 10, "wane": None, "source": ESC21HF + " ; BTS/ICS 2016"},
    "bronchodilator": {"effects": {"rr": -4, "spo2": 3, "hr": 8}, "onset": 5, "wane": [60, 120], "source": "BTS/SIGN 2019 asthma"},
    "opioid": {"effects": {"pain": -3, "rr": -2}, "onset": 5, "wane": [120, 240], "source": "AHA 2020 opioid emergency"},
    "opioid_harm": {"effects": {"rr": -6, "spo2": -6, "gcs": -2}, "onset": 5, "wane": [60, 120], "source": "AHA 2020 opioid emergency"},
    "analgesia": {"effects": {"pain": -3}, "onset": 15, "wane": [180, 300], "source": "NICE CG143"},
    "naloxone": {"effects": {"rr": 8, "spo2": 10, "gcs": 6, "hr": 5}, "onset": 2, "wane": [30, 75],
                 "source": "Clarke 2005 https://doi.org/10.1136/emj.2004.019240"},
    "antipyretic": {"effects": {"tempC": -0.8, "hr": -8}, "onset": 60, "wane": [240, 360],
                    "source": "OFIRMEV label https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/022450lbl.pdf"},
    "beta_blocker_iv": {"effects": {"hr": -20, "systolic": -15, "diastolic": -8}, "onset": 10, "wane": None,
                        "source": "COMMIT 2005 https://doi.org/10.1016/S0140-6736(05)67661-1"},
    "glucagon": {"effects": {"systolic": 15, "diastolic": 6}, "onset": 10, "wane": [20, 40], "source": RCUK21},
    "thrombolytic_pe": {"effects": {"systolic": 20, "diastolic": 10, "hr": -15}, "onset": 60, "wane": None, "source": ESC19PE},
}

# Lab kinetics the Director integrates minute by minute (shared with kinetics.py
# rates). mmol/L per hour unless stated.
LAB_RATES: dict[str, Any] = {
    "dka_cbg_untreated_h": 0.5, "dka_cbg_fluids_h": -1.0, "dka_cbg_insulin_h": -3.0, "dextrose_offset_h": 2.5,
    "dka_k_insulin_h": -0.5, "dka_k_insulin_late_h": -0.2, "k_replacement_h": 0.5,
    "hypo_cbg_untreated_h": -0.3, "dextrose_bolus_mmol": 6.0, "dextrose_bolus_min": 10, "post_dextrose_h": -1.0,
    "hyperk_untreated_h": 0.1, "insulin_dextrose_k": -1.0, "insulin_dextrose_min": 60, "dialysis_k_h": -1.5,
    "lactate_plateau_tau_min": 240, "lactate_half_life_min": 120,
    "source": JBDS23 + " ; " + ADA24 + " ; UKKA 2023 ; kinetics.py lactate (Vincent 2016, Nguyen 2004)",
}

# Anything else the engine needs to cite.
COURSE_SOURCES: dict[str, str] = {
    "arrest": ERC21 + " ; AHA 2020 ACLS https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916",
    "fluid_overload": ESC21HF + " ; " + SSC21 + " ; Glassford 2014",
    "allergy": "NICE CG183 https://www.nice.org.uk/guidance/cg183 ; AAAAI/ACAAI 2022 https://doi.org/10.1016/j.jaci.2022.08.028 ; Pumphrey 2000 https://pubmed.ncbi.nlm.nih.gov/10931122/",
    "gcs": "NICE CG50 https://www.nice.org.uk/guidance/cg50 ; RCP NEWS2",
    "news2": "RCP NEWS2 https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/",
    "mottling": "Ait-Oufella 2011 https://doi.org/10.1007/s00134-011-2162-y",
    "lactate": "ANDROMEDA-SHOCK 2019 https://doi.org/10.1001/jama.2019.0071 ; " + SSC21,
    "oxygen": BTS17 + " ; DETO2X https://doi.org/10.1056/NEJMoa1706222",
    "design": "Rates, anchors and seeded probabilities without a guideline number follow 06b section 5 conventions (design).",
}

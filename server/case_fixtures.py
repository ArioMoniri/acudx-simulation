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

    lab       = (code, en, tr, value, unit, ref_low, ref_high, flag, category[, jitter])
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
            ("asa_p2y12", "Aspirin + P2Y12 loading", "Aspirin + P2Y12 yükleme", "indicated", [("pain", -1.5, 600000)], "Dual antiplatelet loading for STEMI.", "STEMI'de ikili antiplatelet yükleme."),
            ("primary_pci", "Activate primary PCI", "Primer PKG aktivasyonu", "indicated", [("pain", -3.0, 900000)], "Primary PCI is first-line reperfusion when timely.", "Zamanında ise primer PKG birinci basamak reperfüzyondur."),
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
            ("asa_p2y12", "Aspirin + P2Y12 inhibitor", "Aspirin + P2Y12 inhibitörü", "indicated", [("pain", -1.5, 600000)], "Dual antiplatelet therapy for NSTE-ACS.", "NSTE-AKS'de ikili antiplatelet tedavi."),
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
            ("antiplatelet", "Aspirin + anti-ischaemic therapy", "Aspirin + anti-iskemik tedavi", "indicated", [("pain", -2.0, 600000)], "Antiplatelet and anti-ischaemic treatment.", "Antiplatelet ve anti-iskemik tedavi."),
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
            ("dc_shock", "Synchronised DC cardioversion if unstable", "İnstabilse senkron DC kardiyoversiyon", "indicated", [("hr", -60.0, 60000)], "Immediate cardioversion for pulseless/unstable VT.", "Nabızsız/instabil VT'de hemen kardiyoversiyon."),
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
            ("fluid_support", "IV fluids to support filling", "Dolumu desteklemek için IV sıvı", "indicated", [("systolic", 8.0, 300000)], "Fluids temporise while preparing to drain.", "Boşaltmaya hazırlanırken sıvı zaman kazandırır."),
            ("aggressive_diuresis", "Aggressive diuresis / vasodilators", "Agresif diürez / vazodilatör", "contraindicated", [], "Reducing preload worsens tamponade.", "Ön yükü azaltmak tamponadı kötüleştirir."),
        ],
    },
    "hypertensive_emergency": {
        "labs": [
            ("2160-0", "Creatinine", "Kreatinin", 1.7, "mg/dL", 0.6, 1.3, "H", "chemistry", 0.15),
            ("2888-6", "Urine protein", "İdrar proteini", 2.0, "+", 0, 0, "H", "urinalysis"),
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
            ("prolonged_abx", "Prolonged IV antibiotics", "Uzun süreli IV antibiyotik", "indicated", [("tempC", -0.6, 1800000)], "Extended targeted IV antibiotic course.", "Uzun süreli hedefli IV antibiyotik kürü."),
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
            ("thrombolysis_massive", "Thrombolysis if massive PE with shock", "Şoklu masif PE'de tromboliz", "neutral", [], "Reserve thrombolysis for haemodynamic instability.", "Trombolizi hemodinamik instabilite için saklayın."),
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
        ],
    },
    "pneumonia_cap": {
        "labs": [
            ("1988-5", "C-reactive protein", "CRP", 180, "mg/L", 0, 5, "H", "chemistry", 15),
            ("3094-0", "Urea", "Üre", 9.2, "mmol/L", 2.5, 7.1, "H", "chemistry", 0.5),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Lobar consolidation with an air bronchogram.",
                    "Hava bronkogramıyla lober konsolidasyon.",
                    "pneumonia chest x-ray consolidation", "pnömoni akciğer grafisi konsolidasyon"),
        "treatments": [
            ("severity_abx", "Antibiotics guided by severity (CURB-65)", "Ağırlığa göre antibiyotik (CURB-65)", "indicated", [("tempC", -0.6, 1800000)], "Choose antibiotics by severity score.", "Antibiyotiği ağırlık skoruna göre seçin."),
            ("oxygen_fluids", "Oxygen + fluids as needed", "Gerektiğinde oksijen + sıvı", "indicated", [("spo2", 3.0, 300000)], "Support oxygenation and hydration.", "Oksijenizasyon ve hidrasyonu destekleyin."),
            ("delay_abx", "Delay antibiotics pending cultures", "Kültür için antibiyotiği ertele", "contraindicated", [], "Do not delay antibiotics in pneumonia.", "Pnömonide antibiyotiği geciktirmeyin."),
        ],
    },
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
            ("13969-1", "CSF xanthochromia (if CT negative)", "BOS ksantokromi (BT negatifse)", 1.0, "positive", 0, 0, "H", "csf"),
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
    "bacterial_meningitis": {
        "labs": [
            ("30405-5", "CSF white cells (neutrophilic)", "BOS lökosit (nötrofilik)", 2200, "10^6/L", 0, 5, "HH", "csf", 200),
            ("2342-4", "CSF glucose (low)", "BOS glukozu (düşük)", 1.6, "mmol/L", 2.8, 4.2, "L", "csf", 0.2),
        ],
        "imaging": ("30799-1", "CT head (if indicated before LP)", "LP öncesi endike ise beyin BT",
                    "Exclude a mass lesion before lumbar puncture where indicated.",
                    "Endike ise lomber ponksiyon öncesi kitle lezyonu dışlanır.",
                    "meningitis CT before lumbar puncture", "menenjit LP öncesi BT"),
        "treatments": [
            ("immediate_ceftriaxone", "Immediate IV ceftriaxone + dexamethasone", "Hemen IV seftriakson + deksametazon", "indicated", [("tempC", -0.6, 1800000)], "Do not wait for LP/CT to give antibiotics.", "Antibiyotik için LP/BT beklemeyin."),
            ("blood_cultures", "Blood cultures", "Kan kültürü", "indicated", [], "Cultures without delaying antibiotics.", "Antibiyotiği geciktirmeden kültür."),
            ("delay_abx_imaging", "Delay antibiotics for imaging", "Görüntüleme için antibiyotiği ertele", "contraindicated", [], "Never delay antibiotics for imaging.", "Antibiyotiği görüntüleme için asla geciktirmeyin."),
        ],
    },
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
            ("aggressive_fluids", "Aggressive IV fluid resuscitation", "Agresif IV sıvı resüsitasyonu", "indicated", [("hr", -10.0, 600000), ("systolic", 8.0, 600000)], "Early goal-directed fluids.", "Erken hedefe yönelik sıvı."),
            ("analgesia_nbm", "Analgesia + NBM", "Analjezi + ağızdan kapalı", "indicated", [("pain", -3.0, 300000)], "Pain control and bowel rest.", "Ağrı kontrolü ve bağırsak istirahati."),
            ("prophylactic_abx", "Routine prophylactic antibiotics", "Rutin profilaktik antibiyotik", "contraindicated", [], "No prophylactic antibiotics in mild pancreatitis.", "Hafif pankreatitte profilaktik antibiyotik yok."),
        ],
    },
    "upper_gi_bleed": {
        "labs": [
            ("718-7", "Haemoglobin", "Hemoglobin", 7.6, "g/dL", 12.0, 16.0, "L", "haematology", 0.4),
            ("3094-0", "Urea", "Üre", 12.5, "mmol/L", 2.5, 7.1, "H", "chemistry", 0.6),
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
    "ascending_cholangitis": {
        "labs": [
            ("1975-2", "Total bilirubin", "Total bilirubin", 5.8, "mg/dL", 0.2, 1.2, "H", "chemistry", 0.5),
            ("6768-6", "Alkaline phosphatase", "ALP", 420, "U/L", 40, 130, "H", "chemistry", 30),
        ],
        "imaging": ("24558-9", "US / MRCP of the biliary tree", "Safra yolu US / MRCP",
                    "Dilated bile ducts with an obstructing stone.",
                    "Tıkayıcı taşla genişlemiş safra yolları.",
                    "cholangitis MRCP dilated ducts", "kolanjit MRCP genişlemiş kanal"),
        "treatments": [
            ("abx_fluids", "IV antibiotics + fluids", "IV antibiyotik + sıvı", "indicated", [("tempC", -0.6, 1800000)], "Broad-spectrum antibiotics and resuscitation.", "Geniş spektrumlu antibiyotik ve resüsitasyon."),
            ("biliary_drainage", "Urgent biliary drainage (ERCP)", "Acil biliyer drenaj (ERCP)", "indicated", [], "Decompress the obstructed duct urgently.", "Tıkalı kanalı acilen dekomprese edin."),
            ("delay_drainage", "Delay drainage in septic patient", "Septik hastada drenajı ertele", "contraindicated", [], "Do not delay drainage in cholangitis sepsis.", "Kolanjit sepsisinde drenajı geciktirmeyin."),
        ],
    },
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
            ("beta_blocker", "IV beta-blocker (propranolol)", "IV beta-bloker (propranolol)", "indicated", [("hr", -25.0, 600000)], "Control adrenergic symptoms.", "Adrenerjik semptomları kontrol edin."),
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
            ("2532-0", "Creatine kinase", "Kreatin kinaz", 900, "U/L", 30, 200, "H", "chemistry", 80),
        ],
        "imaging": ("36643-5", "Imaging must not delay surgery", "Görüntüleme cerrahiyi geciktirmemeli",
                    "Soft-tissue gas may be seen but must not delay debridement.",
                    "Yumuşak dokuda gaz görülebilir ama debridmanı geciktirmemeli.",
                    "necrotising fasciitis soft tissue gas", "nekrotizan fasiit yumuşak doku gazı"),
        "treatments": [
            ("surgical_debridement", "Urgent surgical debridement", "Acil cerrahi debridman", "indicated", [], "Source control by early debridement.", "Erken debridmanla kaynak kontrolü."),
            ("broad_abx", "Broad-spectrum antibiotics + clindamycin", "Geniş spektrumlu antibiyotik + klindamisin", "indicated", [("tempC", -0.5, 1800000)], "Add clindamycin for toxin suppression.", "Toksin baskılaması için klindamisin ekleyin."),
            ("watchful_waiting", "Watchful waiting", "İzlemle bekleme", "contraindicated", [], "Delay is fatal; operate early.", "Gecikme öldürücüdür; erken opere edin."),
        ],
    },
    "pyelonephritis": {
        "labs": [
            ("5799-2", "Urinalysis (leucocytes/nitrites)", "İdrar (lökosit/nitrit)", 1.0, "positive", 0, 0, "H", "urinalysis"),
            ("1988-5", "C-reactive protein", "CRP", 110, "mg/L", 0, 5, "H", "chemistry", 10),
        ],
        "imaging": ("24558-9", "Renal ultrasound", "Renal ultrason",
                    "Exclude obstruction / pyonephrosis.",
                    "Obstrüksiyon / piyonefroz dışlanır.",
                    "pyelonephritis ultrasound obstruction", "piyelonefrit ultrason obstrüksiyon"),
        "treatments": [
            ("iv_abx_fluids", "IV antibiotics + fluids", "IV antibiyotik + sıvı", "indicated", [("tempC", -0.6, 1800000)], "Empirical antibiotics and rehydration.", "Ampirik antibiyotik ve rehidrasyon."),
            ("drain_obstruction", "Drain if obstructed + infected", "Tıkalı + enfekte ise drenaj", "indicated", [], "Decompress an obstructed infected system.", "Tıkalı enfekte sistemi dekomprese edin."),
            ("delay_obstructed", "Delay in obstructed pyonephrosis", "Tıkalı piyonefrozda gecikme", "contraindicated", [], "Obstructed infection needs urgent drainage.", "Tıkalı enfeksiyon acil drenaj gerektirir."),
        ],
    },
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
            ("immediate_ceftriaxone", "Immediate IV ceftriaxone", "Hemen IV seftriakson", "indicated", [("tempC", -0.6, 1800000)], "Antibiotics at first suspicion.", "İlk şüphede antibiyotik."),
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
            ("5794-3", "Urine blood", "İdrar kanı", 1.0, "positive", 0, 0, "H", "urinalysis"),
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
            ("thiamine_first", "IV thiamine before glucose", "Glukozdan önce IV tiamin", "indicated", [], "Give thiamine before any glucose load.", "Herhangi glukoz yüklemesinden önce tiamin verin."),
            ("glucose_before_thiamine", "Glucose before thiamine", "Tiaminden önce glukoz", "contraindicated", [], "Glucose before thiamine risks Wernicke's.", "Tiaminden önce glukoz Wernicke riski taşır."),
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
            ("3298-4", "Paracetamol level (timed)", "Parasetamol düzeyi (zamanlı)", 180, "mg/L", 0, 10, "H", "toxicology", 15),
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
            ("2888-6", "Urine protein", "İdrar proteini", 3.0, "+", 0, 0, "H", "urinalysis"),
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
            ("3255-7", "Fibrinogen", "Fibrinojen", 1.4, "g/L", 2.0, 4.0, "L", "coagulation", 0.15),
        ],
        "imaging": ("11524-6", "No imaging — act on the '4 Ts'", "Görüntüleme yok — '4T'ye göre hareket",
                    "Identify tone/trauma/tissue/thrombin as the cause.",
                    "Nedeni tonus/travma/doku/trombin olarak belirleyin.",
                    "postpartum haemorrhage four Ts", "doğum sonu kanama dört T"),
        "treatments": [
            ("uterotonics", "Uterine massage + uterotonics", "Uterin masaj + uterotonikler", "indicated", [], "Oxytocin and massage for atony.", "Atoni için oksitosin ve masaj."),
            ("tranexamic_acid", "Tranexamic acid", "Traneksamik asit", "indicated", [], "Give tranexamic acid early.", "Traneksamik asidi erken verin."),
            ("resus_transfuse", "Resuscitate + transfuse", "Resüsitasyon + transfüzyon", "indicated", [("systolic", 12.0, 600000)], "Major haemorrhage protocol.", "Masif kanama protokolü."),
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
            ("2532-0", "Creatine kinase", "Kreatin kinaz", 1500, "U/L", 30, 200, "HH", "chemistry", 150),
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
    "febrile_neutropenia": {
        "labs": [
            ("751-8", "Absolute neutrophil count", "Mutlak nötrofil sayısı", 0.3, "10^9/L", 2.0, 7.5, "LL", "haematology", 0.05),
            ("1988-5", "C-reactive protein", "CRP", 140, "mg/L", 0, 5, "H", "chemistry", 12),
        ],
        "imaging": ("36643-5", "Chest X-ray", "Akciğer grafisi",
                    "Screen for an occult source of infection.",
                    "Gizli enfeksiyon kaynağı taranır.",
                    "febrile neutropenia chest x-ray source", "febril nötropeni akciğer grafisi kaynak"),
        "treatments": [
            ("immediate_abx", "Broad-spectrum antibiotics within 1 hour", "1 saat içinde geniş spektrumlu antibiyotik", "indicated", [("tempC", -0.5, 1800000)], "Antibiotics within the hour, before cultures return.", "Kültür sonucundan önce, ilk saatte antibiyotik."),
            ("cultures", "Blood cultures", "Kan kültürü", "indicated", [], "Culture without delaying antibiotics.", "Antibiyotiği geciktirmeden kültür."),
            ("delay_abx", "Delay antibiotics for investigations", "Tetkik için antibiyotiği ertele", "contraindicated", [], "Never delay antibiotics in neutropenic fever.", "Nötropenik ateşte antibiyotiği geciktirmeyin."),
        ],
    },
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
            ("2532-0", "Lactate dehydrogenase", "Laktat dehidrogenaz", 480, "U/L", 120, 250, "H", "chemistry", 40),
        ],
        "imaging": ("36643-5", "Chest X-ray (if chest symptoms)", "Göğüs semptomu varsa akciğer grafisi",
                    "Screen for acute chest syndrome.",
                    "Akut göğüs sendromu taranır.",
                    "sickle cell acute chest syndrome x-ray", "orak hücre akut göğüs sendromu grafi"),
        "treatments": [
            ("analgesia", "Prompt opioid analgesia", "Hızlı opioid analjezi", "indicated", [("pain", -4.0, 300000)], "Treat crisis pain without delay.", "Kriz ağrısını gecikmeden tedavi edin."),
            ("fluids_oxygen", "IV fluids + oxygen", "IV sıvı + oksijen", "indicated", [("spo2", 3.0, 300000)], "Hydration and oxygenation.", "Hidrasyon ve oksijenizasyon."),
            ("withhold_analgesia", "Withhold opioids for observation", "Gözlem için opioidi geciktir", "contraindicated", [], "Do not withhold analgesia in crisis.", "Krizde analjeziyi geciktirmeyin."),
        ],
    },
}

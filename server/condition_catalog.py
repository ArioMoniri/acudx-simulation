"""AcuDx Gateway — a broad, sampleable clinical condition catalog.

The seed corpus behind **unlimited** dynamic case generation
(``server/case_generator.py``). It is a curated table of ~160 conditions spread
across the acute-care systems the simulator teaches — emergency, cardiology,
pulmonology, gastroenterology, neurology, infectious disease, endocrine, renal,
psychiatry (DSM-5-TR), plus a genitourinary / obstetric / haematology-oncology /
musculoskeletal / toxicology tail for breadth. A generator samples one entry
(randomly by default, or constrained by system / difficulty / complaint) and
hands it to the open model as the *spine* of a synthesized case; the deterministic
templated fallback is also assembled from the very same entry, so a case can
always be produced offline.

Each entry::

    {
      "id":            "acs_nstemi",          # stable slug
      "icd11":         "BA41.1",              # ICD-11 stem (best-effort mapping)
      "icd10":         "I21.4",               # ICD-10 code
      "dsm5tr":        "300.01",              # OPTIONAL — psychiatric entries only
      "label_en":      "Non-ST elevation myocardial infarction",
      "label_tr":      "ST yükselmesiz miyokart enfarktüsü",
      "system":        "cardiology",
      "typical_complaint_en": "Central chest pressure radiating to the arm",
      "typical_complaint_tr": "Kola yayılan orta hat göğüs baskısı",
      "typical_acuity": 2,                    # ESI 1 (most acute) .. 5 (least)
      "difficulty":     3,                    # 1 (foundation) .. 5 (expert)
      "red_flags": [{"en": "...", "tr": "..."}, ...],
    }

Codes are best-effort educational mappings for a *synthetic* simulator; they are
not a clinical coding authority and carry no real patient data. Facts and
thresholds are not copyrightable and no copyrighted guideline text is stored here.

Public API::

    list_systems() -> list[str]
    sample_condition(system=None, difficulty=None, complaint=None, rng=None) -> dict

``rng`` may be a ``random.Random`` (seedable, for reproducibility), an int seed,
or ``None``. ``sample_condition`` never raises and always returns a fresh dict
copy (callers may annotate freely without mutating the shared table).
"""

from __future__ import annotations

import random
import re
from typing import Any, Optional

# --------------------------------------------------------------------------- #
# Compact builder — one row per condition to keep the table dense + readable.  #
# Row: (id, icd11, icd10, dsm5tr|"", label_en, label_tr, cc_en, cc_tr,         #
#        acuity, difficulty, [(rf_en, rf_tr), ...])                            #
# --------------------------------------------------------------------------- #
_Row = tuple


def _mk(system: str, rows: list[_Row]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in rows:
        id_, icd11, icd10, dsm, en, tr, cc_en, cc_tr, acuity, diff, rfs = r
        entry: dict[str, Any] = {
            "id": id_,
            "icd11": icd11,
            "icd10": icd10,
            "label_en": en,
            "label_tr": tr,
            "system": system,
            "typical_complaint_en": cc_en,
            "typical_complaint_tr": cc_tr,
            "typical_acuity": int(acuity),
            "difficulty": int(diff),
            "red_flags": [{"en": a, "tr": b} for (a, b) in rfs],
        }
        if dsm:
            entry["dsm5tr"] = dsm
        out.append(entry)
    return out


# --------------------------------------------------------------------------- #
# EMERGENCY / undifferentiated acute presentations                            #
# --------------------------------------------------------------------------- #
_EMERGENCY = _mk("emergency", [
    ("anaphylaxis", "4A84", "T78.2", "", "Anaphylaxis", "Anafilaksi", "Sudden rash, swelling and difficulty breathing", "Ani döküntü, şişlik ve nefes darlığı", 1, 3, [("Airway swelling or stridor", "Hava yolu ödemi veya stridor"), ("Hypotension after allergen exposure", "Alerjen sonrası hipotansiyon")]),
    ("septic_shock", "1G41", "R65.21", "", "Septic shock", "Septik şok", "Fever, confusion and feeling very unwell", "Ateş, konfüzyon ve çok kötü hissetme", 1, 4, [("Hypotension unresponsive to fluids", "Sıvıya yanıtsız hipotansiyon"), ("Lactate above 2 mmol/L", "Laktat 2 mmol/L üzerinde")]),
    ("cardiac_arrest", "MC82", "I46.9", "", "Cardiac arrest", "Kardiyak arrest", "Collapse with no response", "Yanıtsız kollaps", 1, 4, [("No pulse or breathing", "Nabız veya solunum yok")]),
    ("major_trauma", "NB98", "T07", "", "Polytrauma", "Politravma", "Multiple injuries after a high-energy collision", "Yüksek enerjili çarpışma sonrası çoklu yaralanma", 1, 4, [("Uncontrolled external haemorrhage", "Kontrolsüz dış kanama"), ("GCS drop with head injury", "Kafa travmasıyla GKS düşüşü")]),
    ("heat_stroke", "NF01", "T67.0", "", "Heat stroke", "Sıcak çarpması", "Collapse and confusion in extreme heat", "Aşırı sıcakta kollaps ve konfüzyon", 1, 3, [("Core temperature above 40C with CNS signs", "40C üzeri vücut ısısıyla SSS bulguları")]),
    ("hypothermia", "NF02", "T68", "", "Accidental hypothermia", "Kaza sonucu hipotermi", "Found cold, drowsy and shivering", "Soğuk, uykulu ve titreyen halde bulundu", 2, 3, [("Core temperature below 32C", "32C altında vücut ısısı"), ("Bradycardia with arrhythmia", "Aritmiyle bradikardi")]),
    ("drowning", "NF04", "T75.1", "", "Drowning / submersion injury", "Boğulma / submersiyon", "Rescued from water, coughing and breathless", "Sudan çıkarıldı, öksürük ve nefes darlığı", 1, 3, [("Persistent hypoxia after rescue", "Kurtarma sonrası süren hipoksi")]),
    ("electrical_injury", "NE00", "T75.4", "", "Electrical injury", "Elektrik yaralanması", "Shocked by a live wire, chest discomfort", "Elektrik akımına kapıldı, göğüste rahatsızlık", 2, 3, [("Arrhythmia after high-voltage contact", "Yüksek voltaj sonrası aritmi")]),
    ("undiff_syncope", "MG45", "R55", "", "Syncope, undifferentiated", "Ayrımı yapılmamış senkop", "Passed out briefly and recovered", "Kısa süre bayıldı ve toparladı", 3, 3, [("Exertional or cardiac syncope", "Efor veya kardiyak senkop"), ("Syncope with new murmur", "Yeni üfürümle senkop")]),
    ("undiff_chest_pain", "MD30", "R07.4", "", "Chest pain, undifferentiated", "Ayrımı yapılmamış göğüs ağrısı", "Chest pain, unsure of the cause", "Nedeni belirsiz göğüs ağrısı", 2, 2, [("Pain with diaphoresis and dyspnoea", "Terleme ve nefes darlığıyla ağrı")]),
    ("undiff_abdo_pain", "MD81", "R10.4", "", "Abdominal pain, undifferentiated", "Ayrımı yapılmamış karın ağrısı", "Belly pain that will not settle", "Geçmeyen karın ağrısı", 3, 2, [("Rigid abdomen or peritonism", "Rijit karın veya peritonizm")]),
    ("undiff_dyspnea", "MD11", "R06.0", "", "Dyspnoea, undifferentiated", "Ayrımı yapılmamış nefes darlığı", "Getting breathless doing little", "Az eforla nefes darlığı", 2, 2, [("Hypoxia at rest", "İstirahatte hipoksi")]),
    ("undiff_headache", "MB4A", "R51", "", "Headache, undifferentiated", "Ayrımı yapılmamış baş ağrısı", "Bad headache unlike the usual", "Alışılmadık şiddette baş ağrısı", 3, 2, [("Thunderclap onset", "Gök gürültüsü tarzı başlangıç"), ("Fever with neck stiffness", "Ateşle ense sertliği")]),
    ("undiff_dizziness", "MB48", "R42", "", "Dizziness / vertigo, undifferentiated", "Ayrımı yapılmamış baş dönmesi", "Room-spinning dizziness", "Odanın döndüğü baş dönmesi", 3, 2, [("Vertigo with focal neurology", "Fokal nörolojiyle vertigo")]),
    ("undiff_fever", "MG26", "R50.9", "", "Fever, undifferentiated", "Ayrımı yapılmamış ateş", "Feeling hot and unwell for days", "Günlerdir ateşli ve halsiz", 3, 2, [("Fever with confusion or petechiae", "Konfüzyon veya peteşiyle ateş")]),
    ("poisoning_unknown", "NE61", "T65.9", "", "Poisoning, unknown agent", "Zehirlenme, ajan bilinmiyor", "Found drowsy near open pill bottles", "Açık ilaç kutuları yanında uykulu bulundu", 1, 3, [("Reduced GCS with respiratory depression", "Solunum depresyonuyla GKS düşüklüğü")]),
    ("sepsis_uncomplicated", "1G40", "A41.9", "", "Sepsis", "Sepsis", "Fever with a fast heart rate and malaise", "Ateş, hızlı nabız ve halsizlik", 2, 3, [("Organ dysfunction with suspected infection", "Enfeksiyonla organ disfonksiyonu")]),
    ("acute_agitation", "MB23", "R45.1", "", "Acute agitation", "Akut ajitasyon", "Agitated, restless and aggressive", "Ajite, huzursuz ve saldırgan", 2, 3, [("Agitation with hyperthermia", "Hipertermiyle ajitasyon")]),
])

# --------------------------------------------------------------------------- #
# CARDIOLOGY                                                                   #
# --------------------------------------------------------------------------- #
_CARDIOLOGY = _mk("cardiology", [
    ("acs_stemi", "BA41.0", "I21.3", "", "ST-elevation myocardial infarction", "ST yükselmeli miyokart enfarktüsü", "Crushing central chest pain with sweating", "Terlemeyle ezici göğüs ağrısı", 1, 3, [("ST elevation on ECG", "EKG'de ST yükselmesi"), ("Ongoing pain with haemodynamic instability", "Hemodinamik bozuklukla süren ağrı")]),
    ("acs_nstemi", "BA41.1", "I21.4", "", "Non-ST elevation myocardial infarction", "ST yükselmesiz miyokart enfarktüsü", "Central chest pressure radiating to the arm", "Kola yayılan göğüs baskısı", 2, 3, [("Dynamic troponin rise", "Dinamik troponin yükselişi")]),
    ("unstable_angina", "BA40", "I20.0", "", "Unstable angina", "Kararsız angina", "Chest tightness now coming on at rest", "İstirahatte gelen göğüs sıkışması", 2, 3, [("Crescendo pattern at rest", "İstirahatte artan patern")]),
    ("aortic_dissection", "BD50", "I71.0", "", "Acute aortic dissection", "Akut aort diseksiyonu", "Sudden tearing chest and back pain", "Ani yırtıcı göğüs ve sırt ağrısı", 1, 4, [("Pulse or blood-pressure differential between arms", "Kollar arası nabız/tansiyon farkı"), ("Tearing pain radiating to the back", "Sırta yayılan yırtıcı ağrı")]),
    ("heart_failure_acute", "BD10", "I50.9", "", "Acute decompensated heart failure", "Akut dekompanse kalp yetmezliği", "Breathless and swollen legs, worse lying flat", "Nefes darlığı ve bacak şişliği, yatınca artan", 2, 3, [("Pulmonary oedema with hypoxia", "Hipoksiyle akciğer ödemi")]),
    ("afib_rvr", "BC81.3", "I48.0", "", "Atrial fibrillation with rapid response", "Hızlı yanıtlı atriyal fibrilasyon", "Palpitations with an irregular fast pulse", "Düzensiz hızlı nabızla çarpıntı", 2, 3, [("Rapid AF with hypotension", "Hipotansiyonla hızlı AF")]),
    ("svt", "BC81.0", "I47.1", "", "Supraventricular tachycardia", "Supraventriküler taşikardi", "Sudden racing heartbeat", "Ani hızlanan kalp atışı", 3, 2, [("Narrow-complex tachycardia with instability", "İnstabiliteyle dar QRS taşikardisi")]),
    ("vt", "BC71.0", "I47.2", "", "Ventricular tachycardia", "Ventriküler taşikardi", "Palpitations with lightheadedness and chest pain", "Baş dönmesi ve göğüs ağrısıyla çarpıntı", 1, 4, [("Broad-complex tachycardia with shock", "Şokla geniş QRS taşikardisi")]),
    ("complete_heart_block", "BC63.3", "I44.2", "", "Complete heart block", "Tam kalp bloğu", "Fainting spells with a very slow pulse", "Çok yavaş nabızla bayılma atakları", 1, 3, [("Bradycardia with syncope", "Senkopla bradikardi")]),
    ("pericarditis", "BB20", "I30.9", "", "Acute pericarditis", "Akut perikardit", "Sharp chest pain, better sitting forward", "Öne eğilince azalan keskin göğüs ağrısı", 3, 2, [("Pain with a pericardial rub", "Perikardiyal frotmanla ağrı")]),
    ("cardiac_tamponade", "BB40", "I31.4", "", "Cardiac tamponade", "Kardiyak tamponad", "Breathless with faintness and chest pressure", "Baş dönmesi ve göğüs baskısıyla nefes darlığı", 1, 4, [("Hypotension with muffled heart sounds", "Boğuk kalp sesleriyle hipotansiyon")]),
    ("hypertensive_emergency", "BA00", "I16.9", "", "Hypertensive emergency", "Hipertansif acil", "Severe headache with very high blood pressure", "Çok yüksek tansiyonla şiddetli baş ağrısı", 2, 3, [("Very high BP with end-organ signs", "Hedef organ bulgularıyla çok yüksek TA")]),
    ("infective_endocarditis", "BB40.0", "I33.0", "", "Infective endocarditis", "Enfektif endokardit", "Weeks of fever, sweats and fatigue", "Haftalarca ateş, terleme ve yorgunluk", 2, 4, [("New murmur with fever and emboli", "Ateş ve embolisiyle yeni üfürüm")]),
    ("myocarditis", "BB30", "I40.9", "", "Acute myocarditis", "Akut miyokardit", "Chest pain and breathlessness after a viral illness", "Viral hastalık sonrası göğüs ağrısı ve nefes darlığı", 2, 3, [("Heart failure in a young patient", "Genç hastada kalp yetmezliği")]),
    ("aortic_stenosis", "BB01", "I35.0", "", "Severe aortic stenosis", "Ağır aort darlığı", "Breathless and faint on exertion", "Eforla nefes darlığı ve baş dönmesi", 3, 3, [("Exertional syncope with a murmur", "Üfürümle efor senkopu")]),
    ("stable_angina", "BA40.Z", "I20.9", "", "Stable angina", "Kararlı angina", "Chest tightness on walking that eases with rest", "Yürürken gelen, istirahatte azalan göğüs sıkışması", 4, 2, [("Escalating symptoms suggesting instability", "İnstabiliteyi düşündüren artan semptomlar")]),
])

# --------------------------------------------------------------------------- #
# PULMONOLOGY                                                                  #
# --------------------------------------------------------------------------- #
_PULMONOLOGY = _mk("pulmonology", [
    ("pulmonary_embolism", "BB00", "I26.9", "", "Pulmonary embolism", "Pulmoner emboli", "Sudden breathlessness with sharp chest pain", "Keskin göğüs ağrısıyla ani nefes darlığı", 2, 3, [("Hypoxia with tachycardia", "Taşikardiyle hipoksi"), ("Unilateral leg swelling", "Tek taraflı bacak şişliği")]),
    ("asthma_exacerbation", "CA23", "J45.901", "", "Acute asthma exacerbation", "Akut astım alevlenmesi", "Wheezy and struggling to breathe", "Hırıltı ve nefes almada zorlanma", 2, 2, [("Silent chest or exhaustion", "Sessiz akciğer veya tükenme"), ("SpO2 below 92% on air", "Oda havasında SpO2 %92 altında")]),
    ("copd_exacerbation", "CA22", "J44.1", "", "COPD exacerbation", "KOAH alevlenmesi", "More breathless with a change in sputum", "Balgam değişikliğiyle artan nefes darlığı", 2, 3, [("Rising CO2 with drowsiness", "Uykuyla artan CO2")]),
    ("pneumonia_cap", "CA40", "J18.9", "", "Community-acquired pneumonia", "Toplum kökenli pnömoni", "Cough, fever and breathlessness", "Öksürük, ateş ve nefes darlığı", 3, 2, [("Confusion or hypotension (severity)", "Konfüzyon veya hipotansiyon (ağırlık)")]),
    ("tension_pneumothorax", "CB21", "J93.0", "", "Tension pneumothorax", "Tansiyon pnömotoraks", "Sudden severe breathlessness and chest pain", "Ani şiddetli nefes darlığı ve göğüs ağrısı", 1, 4, [("Tracheal deviation with hypotension", "Hipotansiyonla trakeal deviasyon")]),
    ("spontaneous_pneumothorax", "CB21.0", "J93.1", "", "Spontaneous pneumothorax", "Spontan pnömotoraks", "Sudden one-sided chest pain and breathlessness", "Ani tek taraflı göğüs ağrısı ve nefes darlığı", 3, 2, [("Enlarging pneumothorax with distress", "Sıkıntıyla büyüyen pnömotoraks")]),
    ("pleural_effusion", "CB27", "J90", "", "Pleural effusion", "Plevral efüzyon", "Gradual breathlessness and a dull ache", "Giderek artan nefes darlığı ve künt ağrı", 3, 2, [("Large effusion with respiratory compromise", "Solunum bozukluğuyla büyük efüzyon")]),
    ("hemoptysis", "MD24", "R04.2", "", "Haemoptysis", "Hemoptizi", "Coughing up blood", "Kan tükürme", 2, 3, [("Massive haemoptysis with airway risk", "Hava yolu riskiyle masif hemoptizi")]),
    ("aspiration_pneumonitis", "CA40.2", "J69.0", "", "Aspiration pneumonitis", "Aspirasyon pnömonisi", "Choking then breathless after a meal", "Yemek sonrası boğulma ve nefes darlığı", 2, 3, [("Hypoxia after a witnessed aspiration", "Tanıklı aspirasyon sonrası hipoksi")]),
    ("ards", "CB00", "J80", "", "Acute respiratory distress syndrome", "Akut solunum sıkıntısı sendromu", "Rapidly worsening breathlessness", "Hızla kötüleşen nefes darlığı", 1, 4, [("Refractory hypoxaemia", "Dirençli hipoksemi")]),
    ("bronchiolitis", "CA42", "J21.9", "", "Bronchiolitis", "Bronşiolit", "Wheezy infant feeding poorly", "Kötü beslenen hırıltılı bebek", 3, 2, [("Apnoea or poor feeding in an infant", "Bebekte apne veya kötü beslenme")]),
    ("tb_pulmonary", "1B10", "A15.0", "", "Pulmonary tuberculosis", "Akciğer tüberkülozu", "Weeks of cough, night sweats and weight loss", "Haftalarca öksürük, gece terlemesi ve kilo kaybı", 4, 3, [("Haemoptysis with weight loss", "Kilo kaybıyla hemoptizi")]),
    ("carbon_monoxide", "NE64", "T58", "", "Carbon monoxide poisoning", "Karbonmonoksit zehirlenmesi", "Headache and dizziness with a faulty heater", "Arızalı sobayla baş ağrısı ve baş dönmesi", 2, 3, [("Reduced consciousness with high COHb", "Yüksek COHb ile bilinç bozukluğu")]),
    ("obstructive_sleep_apnea", "7A41", "G47.33", "", "Obstructive sleep apnoea", "Obstrüktif uyku apnesi", "Loud snoring and daytime sleepiness", "Yüksek horlama ve gündüz uykululuğu", 5, 2, [("Witnessed apnoeas with hypoxia", "Hipoksiyle tanıklı apneler")]),
])

# --------------------------------------------------------------------------- #
# GASTROENTEROLOGY                                                             #
# --------------------------------------------------------------------------- #
_GI = _mk("gastroenterology", [
    ("appendicitis", "DA20", "K35.80", "", "Acute appendicitis", "Akut apandisit", "Pain that moved to the right lower belly", "Sağ alt karına göç eden ağrı", 3, 2, [("Peritonism at McBurney point", "McBurney noktasında peritonizm")]),
    ("cholecystitis", "DC12", "K81.0", "", "Acute cholecystitis", "Akut kolesistit", "Right upper belly pain after fatty food", "Yağlı yemek sonrası sağ üst karın ağrısı", 3, 2, [("Positive Murphy sign with fever", "Ateşle pozitif Murphy bulgusu")]),
    ("pancreatitis", "DC31", "K85.9", "", "Acute pancreatitis", "Akut pankreatit", "Severe upper belly pain boring to the back", "Sırta vuran şiddetli üst karın ağrısı", 2, 3, [("Pain with vomiting and tachycardia", "Kusma ve taşikardiyle ağrı")]),
    ("upper_gi_bleed", "DA63", "K92.2", "", "Upper gastrointestinal bleed", "Üst gastrointestinal kanama", "Vomiting blood and black stools", "Kan kusma ve siyah dışkı", 1, 3, [("Haematemesis with hypotension", "Hipotansiyonla hematemez"), ("Melaena with tachycardia", "Taşikardiyle melena")]),
    ("perforated_ulcer", "DA60.0", "K25.1", "", "Perforated peptic ulcer", "Perfore peptik ülser", "Sudden severe belly pain, board-like abdomen", "Ani şiddetli karın ağrısı, tahta karın", 1, 4, [("Rigid abdomen with free air", "Serbest havayla rijit karın")]),
    ("bowel_obstruction", "DA91", "K56.60", "", "Bowel obstruction", "Bağırsak tıkanıklığı", "Cramping pain, vomiting and no bowel motion", "Kramp tarzı ağrı, kusma ve gaz-gaita çıkışı yok", 2, 3, [("Distension with absolute constipation", "Mutlak kabızlıkla distansiyon")]),
    ("mesenteric_ischemia", "DD30", "K55.0", "", "Acute mesenteric ischaemia", "Akut mezenter iskemi", "Severe belly pain out of proportion to exam", "Muayeneyle orantısız şiddetli karın ağrısı", 1, 4, [("Pain out of proportion with acidosis", "Asidozla orantısız ağrı")]),
    ("diverticulitis", "DB32", "K57.92", "", "Acute diverticulitis", "Akut divertikülit", "Left lower belly pain with fever", "Ateşle sol alt karın ağrısı", 3, 2, [("Peritonitis suggesting perforation", "Perforasyonu düşündüren peritonit")]),
    ("acute_hepatitis", "DB90", "K72.0", "", "Acute hepatitis", "Akut hepatit", "Yellow eyes, nausea and right upper pain", "Sarı gözler, bulantı ve sağ üst ağrı", 3, 3, [("Encephalopathy or coagulopathy", "Ensefalopati veya koagülopati")]),
    ("gastroenteritis", "1A40", "A09", "", "Infectious gastroenteritis", "Enfeksiyöz gastroenterit", "Vomiting and watery diarrhoea", "Kusma ve sulu ishal", 4, 1, [("Dehydration with reduced urine output", "İdrar azalmasıyla dehidratasyon")]),
    ("gi_reflux", "DA22", "K21.9", "", "Gastro-oesophageal reflux disease", "Gastroözofageal reflü hastalığı", "Burning behind the chest after meals", "Yemek sonrası göğüs arkasında yanma", 5, 1, [("Alarm features: dysphagia or weight loss", "Alarm bulguları: disfaji veya kilo kaybı")]),
    ("ibd_flare", "DD70", "K51.90", "", "Inflammatory bowel disease flare", "İnflamatuar bağırsak hastalığı alevlenmesi", "Bloody diarrhoea and cramping", "Kanlı ishal ve kramp", 3, 3, [("Toxic megacolon signs", "Toksik megakolon bulguları")]),
    ("biliary_colic", "DC11", "K80.20", "", "Biliary colic", "Bilier kolik", "Episodic right upper belly pain after eating", "Yemek sonrası ataklarla sağ üst karın ağrısı", 4, 2, [("Fever or jaundice suggesting complication", "Komplikasyonu düşündüren ateş/sarılık")]),
    ("ascending_cholangitis", "DC13", "K83.09", "", "Ascending cholangitis", "Asendan kolanjit", "Fever, jaundice and right upper pain", "Ateş, sarılık ve sağ üst ağrı", 1, 3, [("Charcot triad with hypotension", "Hipotansiyonla Charcot triadı")]),
    ("bariatric_dumping", "DA0Z", "K91.1", "", "Dumping syndrome", "Dumping sendromu", "Sweating and palpitations after eating", "Yemek sonrası terleme ve çarpıntı", 5, 3, [("Severe post-prandial hypoglycaemia", "Ağır tokluk hipoglisemisi")]),
])

# --------------------------------------------------------------------------- #
# NEUROLOGY                                                                    #
# --------------------------------------------------------------------------- #
_NEURO = _mk("neurology", [
    ("ischemic_stroke", "8B11", "I63.9", "", "Acute ischaemic stroke", "Akut iskemik inme", "Sudden weakness and slurred speech", "Ani güçsüzlük ve peltek konuşma", 1, 3, [("Focal deficit within the thrombolysis window", "Tromboliz penceresinde fokal defisit")]),
    ("intracerebral_hemorrhage", "8B00", "I61.9", "", "Intracerebral haemorrhage", "İntraserebral kanama", "Sudden headache with weakness and vomiting", "Güçsüzlük ve kusmayla ani baş ağrısı", 1, 4, [("Reduced GCS with focal signs", "Fokal bulgularla GKS düşüklüğü")]),
    ("subarachnoid_hemorrhage", "8B01", "I60.9", "", "Subarachnoid haemorrhage", "Subaraknoid kanama", "Sudden worst-ever thunderclap headache", "Aniden gelen en şiddetli gök gürültüsü baş ağrısı", 1, 4, [("Thunderclap onset", "Gök gürültüsü başlangıç"), ("Neck stiffness with photophobia", "Fotofobiyle ense sertliği")]),
    ("bacterial_meningitis", "1D01", "G00.9", "", "Bacterial meningitis", "Bakteriyel menenjit", "Fever, severe headache and a stiff neck", "Ateş, şiddetli baş ağrısı ve ense sertliği", 1, 3, [("Fever with neck stiffness and rash", "Döküntü ve ense sertliğiyle ateş"), ("Non-blanching purpuric rash", "Basmakla solmayan purpurik döküntü")]),
    ("status_epilepticus", "8A6Z", "G41.9", "", "Status epilepticus", "Status epileptikus", "A seizure that will not stop", "Durmayan nöbet", 1, 4, [("Continuous or recurrent seizures", "Sürekli veya tekrarlayan nöbetler")]),
    ("first_seizure", "8A60", "R56.9", "", "First unprovoked seizure", "İlk provoke olmayan nöbet", "First-ever fit witnessed by family", "Ailenin tanık olduğu ilk nöbet", 3, 3, [("Prolonged post-ictal deficit", "Uzamış postiktal defisit")]),
    ("tia", "8B10", "G45.9", "", "Transient ischaemic attack", "Geçici iskemik atak", "Brief weakness and speech trouble, now resolved", "Kısa süreli güçsüzlük ve konuşma sorunu, geçti", 2, 3, [("High ABCD2 with recurrent episodes", "Tekrarlayan ataklarla yüksek ABCD2")]),
    ("migraine", "8A80", "G43.909", "", "Migraine", "Migren", "Throbbing one-sided headache with nausea", "Bulantıyla zonklayan tek taraflı baş ağrısı", 4, 1, [("Atypical features suggesting a secondary cause", "İkincil nedeni düşündüren atipik bulgular")]),
    ("gbs", "8C01", "G61.0", "", "Guillain-Barre syndrome", "Guillain-Barre sendromu", "Progressive leg then arm weakness", "İlerleyici bacak sonra kol güçsüzlüğü", 2, 4, [("Ascending weakness with breathing difficulty", "Nefes güçlüğüyle çıkan güçsüzlük")]),
    ("myasthenic_crisis", "8C6Z", "G70.01", "", "Myasthenic crisis", "Miyastenik kriz", "Worsening droopy eyes and breathing trouble", "Kötüleşen düşük göz kapağı ve nefes güçlüğü", 1, 4, [("Respiratory muscle weakness", "Solunum kası güçsüzlüğü")]),
    ("bells_palsy", "8B88", "G51.0", "", "Bell palsy", "Bell felci", "Sudden one-sided facial droop", "Ani tek taraflı yüz düşüklüğü", 4, 2, [("Forehead sparing suggesting a central lesion", "Santral lezyonu düşündüren alın korunması")]),
    ("vertigo_bppv", "AB31.0", "H81.1", "", "Benign paroxysmal positional vertigo", "Benign paroksismal pozisyonel vertigo", "Brief spinning with head movements", "Baş hareketiyle kısa dönme hissi", 4, 2, [("Central features on HINTS exam", "HINTS muayenesinde santral bulgular")]),
    ("spinal_cord_compression", "8B4Z", "G95.20", "", "Acute spinal cord compression", "Akut spinal kord basısı", "Back pain with leg weakness and retention", "Bacak güçsüzlüğü ve idrar retansiyonuyla sırt ağrısı", 1, 4, [("Saddle anaesthesia with retention", "Retansiyonla eyer anestezisi")]),
    ("encephalitis", "1C00", "G04.90", "", "Viral encephalitis", "Viral ensefalit", "Fever with confusion and odd behaviour", "Konfüzyon ve garip davranışla ateş", 1, 4, [("Fever with altered mental state and seizures", "Nöbet ve bilinç değişimiyle ateş")]),
    ("delirium", "6D70", "F05", "", "Delirium", "Deliryum", "Suddenly confused and inattentive", "Ani konfüzyon ve dikkat kaybı", 3, 2, [("Acute fluctuating confusion with infection", "Enfeksiyonla akut dalgalanan konfüzyon")]),
])

# --------------------------------------------------------------------------- #
# INFECTIOUS DISEASE                                                           #
# --------------------------------------------------------------------------- #
_INFECTIOUS = _mk("infectious", [
    ("influenza", "1E30", "J10.1", "", "Influenza", "İnfluenza", "Fever, aches and cough for two days", "İki gündür ateş, ağrı ve öksürük", 4, 1, [("Breathlessness or hypoxia (complication)", "Nefes darlığı veya hipoksi (komplikasyon)")]),
    ("covid19", "RA01", "U07.1", "", "COVID-19", "COVID-19", "Cough, fever and loss of smell", "Öksürük, ateş ve koku kaybı", 4, 2, [("Silent hypoxia", "Sessiz hipoksi")]),
    ("cellulitis", "1B70", "L03.90", "", "Cellulitis", "Selülit", "Spreading red, hot, tender skin", "Yayılan kırmızı, sıcak, hassas cilt", 3, 2, [("Rapid spread with systemic upset", "Sistemik bozuklukla hızlı yayılma")]),
    ("nec_fasciitis", "1B71", "M72.6", "", "Necrotising fasciitis", "Nekrotizan fasiit", "Severe skin pain out of proportion", "Orantısız şiddetli cilt ağrısı", 1, 4, [("Pain out of proportion with crepitus", "Krepitasyonla orantısız ağrı")]),
    ("pyelonephritis", "GC00", "N10", "", "Acute pyelonephritis", "Akut piyelonefrit", "Fever with flank pain and burning urine", "Yan ağrısı ve yanmayla ateş", 3, 2, [("Sepsis from an obstructed kidney", "Tıkalı böbrekten sepsis")]),
    ("malaria", "1F40", "B54", "", "Malaria", "Sıtma", "Cyclical fevers after tropical travel", "Tropik seyahat sonrası döngüsel ateş", 2, 3, [("Cerebral or severe malaria signs", "Serebral veya ağır sıtma bulguları")]),
    ("meningococcemia", "1C1G", "A39.4", "", "Meningococcaemia", "Meningokoksemi", "Fever with a fast-spreading rash", "Hızla yayılan döküntüyle ateş", 1, 4, [("Non-blanching rash with shock", "Şokla basmakla solmayan döküntü")]),
    ("infectious_diarrhea", "1A0Z", "A09.0", "", "Infectious diarrhoea", "Enfeksiyöz ishal", "Frequent watery stools and cramps", "Sık sulu dışkı ve kramp", 4, 1, [("Bloody stool with high fever", "Yüksek ateşle kanlı dışkı")]),
    ("tetanus", "1C13", "A35", "", "Tetanus", "Tetanoz", "Jaw stiffness after a dirty wound", "Kirli yara sonrası çene kilitlenmesi", 1, 4, [("Muscle spasms with autonomic instability", "Otonom instabiliteyle kas spazmları")]),
    ("hiv_seroconversion", "1C62", "B20", "", "Acute HIV / opportunistic infection", "Akut HIV / fırsatçı enfeksiyon", "Fever, rash and sore throat", "Ateş, döküntü ve boğaz ağrısı", 3, 3, [("Opportunistic infection with immunosuppression", "İmmünsüpresyonla fırsatçı enfeksiyon")]),
    ("septic_arthritis", "FA10", "M00.9", "", "Septic arthritis", "Septik artrit", "A hot, swollen, very painful joint", "Sıcak, şiş, çok ağrılı eklem", 2, 3, [("Acute mono-arthritis with fever", "Ateşle akut monoartrit")]),
    ("osteomyelitis", "FB84", "M86.9", "", "Osteomyelitis", "Osteomiyelit", "Deep bone pain with fever", "Ateşle derin kemik ağrısı", 3, 3, [("Non-healing ulcer over bone", "Kemik üzerinde iyileşmeyen ülser")]),
    ("uti_lower", "GC08", "N39.0", "", "Lower urinary tract infection", "Alt üriner sistem enfeksiyonu", "Burning and frequency passing urine", "İdrarda yanma ve sık idrar", 4, 1, [("Fever or flank pain (upper tract)", "Ateş veya yan ağrısı (üst sistem)")]),
    ("infectious_mononucleosis", "1D82", "B27.90", "", "Infectious mononucleosis", "Enfeksiyöz mononükleoz", "Sore throat, fever and fatigue for a week", "Bir haftadır boğaz ağrısı, ateş ve yorgunluk", 4, 2, [("Airway compromise from tonsillar swelling", "Bademcik şişmesiyle hava yolu bası")]),
])

# --------------------------------------------------------------------------- #
# ENDOCRINE / METABOLIC                                                        #
# --------------------------------------------------------------------------- #
_ENDOCRINE = _mk("endocrine", [
    ("dka", "5A22", "E10.10", "", "Diabetic ketoacidosis", "Diyabetik ketoasidoz", "Thirst, vomiting and deep breathing", "Susama, kusma ve derin nefes", 2, 3, [("Kussmaul breathing with ketosis", "Ketozla Kussmaul solunumu")]),
    ("hhs", "5A22.1", "E11.00", "", "Hyperosmolar hyperglycaemic state", "Hiperozmolar hiperglisemik durum", "Confusion with very high sugar", "Çok yüksek şekerle konfüzyon", 2, 4, [("Marked dehydration with altered mental state", "Bilinç değişimiyle belirgin dehidratasyon")]),
    ("hypoglycemia", "5A41", "E16.2", "", "Severe hypoglycaemia", "Ağır hipoglisemi", "Sweaty, shaky and confused", "Terli, titrek ve konfüze", 2, 2, [("Reduced consciousness from low glucose", "Düşük glukozla bilinç bozukluğu")]),
    ("thyroid_storm", "5A42", "E05.51", "", "Thyroid storm", "Tiroid fırtınası", "Fever, racing heart and agitation", "Ateş, hızlı kalp ve ajitasyon", 1, 4, [("Hyperthermia with tachyarrhythmia", "Taşiaritmiyle hipertermi")]),
    ("myxedema_coma", "5A00", "E03.5", "", "Myxoedema coma", "Miksödem koması", "Very drowsy, cold and slow", "Çok uykulu, soğuk ve yavaş", 1, 4, [("Hypothermia with reduced consciousness", "Bilinç bozukluğuyla hipotermi")]),
    ("adrenal_crisis", "5A74", "E27.2", "", "Adrenal crisis", "Adrenal kriz", "Weakness, vomiting and low blood pressure", "Güçsüzlük, kusma ve düşük tansiyon", 1, 4, [("Hypotension unresponsive to fluids", "Sıvıya yanıtsız hipotansiyon")]),
    ("hyperkalemia", "5B5A", "E87.5", "", "Severe hyperkalaemia", "Ağır hiperkalemi", "Weakness and palpitations, missed dialysis", "Kaçırılmış diyalizle güçsüzlük ve çarpıntı", 1, 3, [("ECG changes with high potassium", "Yüksek potasyumla EKG değişiklikleri")]),
    ("hyponatremia", "5B5A.1", "E87.1", "", "Severe hyponatraemia", "Ağır hiponatremi", "Confusion and nausea, low sodium", "Düşük sodyumla konfüzyon ve bulantı", 2, 3, [("Seizures from rapid sodium shift", "Hızlı sodyum kaymasıyla nöbet")]),
    ("hypercalcemia", "5B90", "E83.52", "", "Hypercalcaemia", "Hiperkalsemi", "Thirst, constipation and confusion", "Susama, kabızlık ve konfüzyon", 3, 3, [("Marked hypercalcaemia with drowsiness", "Uykuyla belirgin hiperkalsemi")]),
    ("pheochromocytoma", "2F37", "E27.5", "", "Phaeochromocytoma crisis", "Feokromositoma krizi", "Episodic sweating, headache and palpitations", "Ataklarla terleme, baş ağrısı ve çarpıntı", 2, 4, [("Severe paroxysmal hypertension", "Ağır paroksismal hipertansiyon")]),
    ("diabetes_new", "5A11", "E11.9", "", "Newly diagnosed type 2 diabetes", "Yeni tanı tip 2 diyabet", "Thirst, tiredness and blurred vision", "Susama, yorgunluk ve bulanık görme", 4, 2, [("Ketosis suggesting insulin deficiency", "İnsülin eksikliğini düşündüren ketoz")]),
    ("hypothyroid_new", "5A00.0", "E03.9", "", "Hypothyroidism", "Hipotiroidi", "Tired, cold and gaining weight", "Yorgun, üşüyen ve kilo alan", 5, 1, [("Bradycardia or hypothermia (severe)", "Bradikardi veya hipotermi (ağır)")]),
])

# --------------------------------------------------------------------------- #
# RENAL / GENITOURINARY                                                        #
# --------------------------------------------------------------------------- #
_RENAL = _mk("renal", [
    ("aki", "GB60", "N17.9", "", "Acute kidney injury", "Akut böbrek hasarı", "Passing very little urine and swollen", "Çok az idrar ve şişlik", 2, 3, [("Anuria with fluid overload", "Sıvı yüklenmesiyle anüri")]),
    ("renal_colic", "GB70", "N23", "", "Renal colic", "Renal kolik", "Severe loin pain radiating to the groin", "Kasığa yayılan şiddetli yan ağrısı", 3, 2, [("Fever with an obstructing stone", "Tıkayıcı taşla ateş")]),
    ("hyperkalemia_esrd", "GB61", "N18.6", "", "End-stage renal disease with hyperkalaemia", "Hiperkalemiyle son dönem böbrek hastalığı", "Missed dialysis, weak and breathless", "Kaçırılmış diyaliz, güçsüz ve nefes darlığı", 1, 3, [("ECG changes with missed dialysis", "Kaçırılmış diyalizle EKG değişiklikleri")]),
    ("urinary_retention", "MF50.2", "R33.9", "", "Acute urinary retention", "Akut idrar retansiyonu", "Cannot pass urine with a painful bladder", "İdrar yapamama ve ağrılı mesane", 3, 2, [("Retention with kidney injury", "Böbrek hasarıyla retansiyon")]),
    ("nephrotic_syndrome", "GB40", "N04.9", "", "Nephrotic syndrome", "Nefrotik sendrom", "Frothy urine and swollen legs and face", "Köpüklü idrar, bacak ve yüz şişliği", 4, 3, [("Thromboembolism risk with heavy proteinuria", "Ağır proteinüriyle tromboemboli riski")]),
    ("glomerulonephritis", "GB4Z", "N05.9", "", "Acute glomerulonephritis", "Akut glomerülonefrit", "Blood in urine with high blood pressure", "Yüksek tansiyonla idrarda kan", 3, 3, [("Rapidly rising creatinine", "Hızla yükselen kreatinin")]),
    ("testicular_torsion", "GB05", "N44.00", "", "Testicular torsion", "Testis torsiyonu", "Sudden severe one-sided testicular pain", "Ani şiddetli tek taraflı testis ağrısı", 1, 3, [("Acute scrotal pain in a young male (time-critical)", "Genç erkekte akut skrotal ağrı (zaman kritik)")]),
    ("bph_retention", "GA90", "N40.1", "", "Benign prostatic hyperplasia", "Benign prostat hiperplazisi", "Poor stream and straining to pass urine", "Zayıf akım ve idrarda zorlanma", 5, 1, [("Retention with post-renal failure", "Postrenal yetmezlikle retansiyon")]),
    ("epididymo_orchitis", "GB41", "N45.3", "", "Epididymo-orchitis", "Epididimo-orşit", "Painful, swollen testicle developing over a day", "Bir gün içinde gelişen ağrılı, şiş testis", 3, 2, [("Cannot exclude torsion in a young male", "Genç erkekte torsiyon dışlanamıyor")]),
    ("acute_prostatitis", "GA91", "N41.0", "", "Acute prostatitis", "Akut prostatit", "Fever with pelvic pain and painful urination", "Ateşle pelvik ağrı ve ağrılı idrar", 3, 2, [("Sepsis or acute retention", "Sepsis veya akut retansiyon")]),
    ("priapism", "MF40.2", "N48.30", "", "Priapism", "Priapizm", "A painful erection lasting several hours", "Saatlerce süren ağrılı ereksiyon", 2, 3, [("Ischaemic priapism beyond 4 hours (time-critical)", "4 saati aşan iskemik priapizm (zaman kritik)")]),
])

# --------------------------------------------------------------------------- #
# PSYCHIATRY (DSM-5-TR)                                                        #
# --------------------------------------------------------------------------- #
_PSYCH = _mk("psychiatry", [
    ("panic_disorder", "6B01", "F41.0", "300.01", "Panic disorder", "Panik bozukluğu", "Chest tightness, palpitations and intense fear", "Göğüste sıkışma, çarpıntı ve yoğun korku", 3, 2, [("Do not anchor: rule out ACS first", "Yanlılığa düşmeyin: önce ACS dışlayın")]),
    ("mdd", "6A70", "F32.9", "296.20", "Major depressive disorder", "Majör depresif bozukluk", "Low mood and no interest for weeks", "Haftalardır çökkün duygudurum ve ilgisizlik", 4, 3, [("Active suicidal ideation with a plan", "Planlı aktif intihar düşüncesi")]),
    ("suicidal_ideation", "MB23.R", "R45.851", "", "Suicidal ideation", "İntihar düşüncesi", "Thoughts of not wanting to be here", "Var olmak istememe düşünceleri", 2, 4, [("Plan, intent or access to means", "Plan, niyet veya araca erişim")]),
    ("gad", "6B00", "F41.1", "300.02", "Generalised anxiety disorder", "Yaygın anksiyete bozukluğu", "Constant worry and being on edge", "Sürekli endişe ve gerginlik", 5, 2, [("Functional collapse or comorbid depression", "İşlevsel çöküş veya eşlik eden depresyon")]),
    ("bipolar_mania", "6A60", "F31.2", "296.44", "Bipolar disorder, manic episode", "Bipolar bozukluk, manik dönem", "Not sleeping, racing thoughts and overspending", "Uyumama, hızlı düşünce ve aşırı harcama", 3, 3, [("Psychosis or risk-taking with grandiosity", "Grandiyoziteyle psikoz veya riskli davranış")]),
    ("schizophrenia", "6A20", "F20.9", "295.90", "Schizophrenia", "Şizofreni", "Hearing voices and feeling watched", "Sesler duyma ve izlendiğini hissetme", 3, 4, [("Command hallucinations with risk", "Riskli komut halüsinasyonları")]),
    ("acute_psychosis", "6A2Z", "F29", "298.9", "Acute psychosis, unspecified", "Akut psikoz, tanımlanmamış", "Sudden odd beliefs and disorganised speech", "Ani garip inançlar ve dağınık konuşma", 2, 3, [("Agitation with risk to self or others", "Kendine/başkasına riskle ajitasyon")]),
    ("ptsd", "6B40", "F43.10", "309.81", "Post-traumatic stress disorder", "Travma sonrası stres bozukluğu", "Flashbacks and nightmares after a trauma", "Travma sonrası flashback ve kâbuslar", 4, 3, [("Dissociation or suicidality", "Disosiyasyon veya intihar riski")]),
    ("anorexia_nervosa", "6B80", "F50.00", "307.1", "Anorexia nervosa", "Anoreksiya nervoza", "Severe weight loss and fear of eating", "Ağır kilo kaybı ve yemekten korku", 3, 4, [("Bradycardia or electrolyte derangement", "Bradikardi veya elektrolit bozukluğu")]),
    ("alcohol_withdrawal", "6C40.4", "F10.239", "291.81", "Alcohol withdrawal", "Alkol yoksunluğu", "Shaking, sweating and anxious after stopping drinking", "İçkiyi bırakınca titreme, terleme ve anksiyete", 2, 3, [("Seizures or delirium tremens", "Nöbet veya deliryum tremens")]),
    ("opioid_overdose", "6C43.4", "T40.2X", "", "Opioid overdose", "Opioid aşırı dozu", "Found unresponsive with slow breathing", "Yavaş nefesle yanıtsız bulundu", 1, 3, [("Respiratory depression with pinpoint pupils", "İğne başı pupillayla solunum depresyonu")]),
    ("serotonin_syndrome", "6C4Z", "T43.225", "", "Serotonin syndrome", "Serotonin sendromu", "Agitation, tremor and fever after a dose change", "Doz değişimi sonrası ajitasyon, tremor ve ateş", 1, 4, [("Hyperthermia with clonus and rigidity", "Klonus ve rijiditeyle hipertermi")]),
    ("nms", "6C4Z.1", "G21.0", "", "Neuroleptic malignant syndrome", "Nöroleptik malign sendrom", "High fever and stiffness on antipsychotics", "Antipsikotikle yüksek ateş ve sertlik", 1, 4, [("Rigidity with hyperthermia and raised CK", "Yüksek CK ve hipertermiyle rijidite")]),
    ("somatic_symptom", "6C20", "F45.1", "300.82", "Somatic symptom disorder", "Somatik semptom bozukluğu", "Persistent worrying physical symptoms", "Sürekli endişe veren fiziksel semptomlar", 5, 3, [("Do not miss an organic cause", "Organik nedeni atlamayın")]),
    ("delirium_tremens", "6C40.6", "F10.231", "291.0", "Delirium tremens", "Deliryum tremens", "Confusion, tremor and hallucinations off alcohol", "Alkolsüz konfüzyon, tremor ve halüsinasyon", 1, 4, [("Autonomic instability with confusion", "Konfüzyonla otonom instabilite")]),
    ("eating_binge", "6B82", "F50.81", "307.51", "Binge eating disorder", "Tıkınırcasına yeme bozukluğu", "Recurrent loss of control with eating", "Yemede tekrarlayan kontrol kaybı", 5, 2, [("Comorbid mood disorder or purging", "Eşlik eden duygudurum bozukluğu veya çıkarma")]),
])

# --------------------------------------------------------------------------- #
# BREADTH TAIL — heme/onc, obstetric/gynae, musculoskeletal, tox, derm         #
# --------------------------------------------------------------------------- #
_HEMATOLOGY = _mk("hematology", [
    ("febrile_neutropenia", "2A20", "D70.9", "", "Febrile neutropenia", "Febril nötropeni", "Fever days after chemotherapy", "Kemoterapi sonrası günlerce ateş", 1, 3, [("Fever with neutropenia (oncologic emergency)", "Nötropeniyle ateş (onkolojik acil)")]),
    ("sickle_crisis", "3A51", "D57.00", "", "Sickle cell crisis", "Orak hücre krizi", "Severe bone pain in a sickle patient", "Orak hücreli hastada şiddetli kemik ağrısı", 2, 3, [("Chest syndrome with hypoxia", "Hipoksiyle göğüs sendromu")]),
    ("dvt", "BD71", "I82.409", "", "Deep vein thrombosis", "Derin ven trombozu", "Swollen, painful calf", "Şiş, ağrılı baldır", 3, 2, [("Signs of concurrent pulmonary embolism", "Eşlik eden pulmoner emboli bulguları")]),
    ("tumor_lysis", "2A00.0", "E88.3", "", "Tumour lysis syndrome", "Tümör lizis sendromu", "Unwell soon after starting chemotherapy", "Kemoterapi başlangıcından kısa süre sonra kötüleşme", 1, 4, [("Hyperkalaemia with acute kidney injury", "Akut böbrek hasarıyla hiperkalemi")]),
    ("anemia_symptomatic", "3A9Z", "D64.9", "", "Symptomatic anaemia", "Semptomatik anemi", "Tired, pale and breathless on exertion", "Yorgun, solgun ve eforla nefes darlığı", 3, 2, [("Anaemia with chest pain or syncope", "Göğüs ağrısı veya senkopla anemi")]),
    ("dic", "3B20", "D65", "", "Disseminated intravascular coagulation", "Yaygın damar içi pıhtılaşma", "Bleeding and bruising while very unwell", "Çok kötü durumda kanama ve morarma", 1, 4, [("Bleeding with thrombosis and organ failure", "Trombozla kanama ve organ yetmezliği")]),
    ("itp", "3B64.10", "D69.3", "", "Immune thrombocytopenia", "İmmün trombositopeni", "Easy bruising and a pinpoint rash", "Kolay morarma ve iğne başı döküntü", 3, 3, [("Mucosal or intracranial bleeding", "Mukozal veya kafa içi kanama")]),
    ("acute_leukemia", "2B33.Z", "C95.00", "", "Acute leukaemia (new)", "Akut lösemi (yeni)", "Weeks of fatigue, bruising and infections", "Haftalarca yorgunluk, morarma ve enfeksiyon", 2, 4, [("Blasts with bleeding or infection", "Kanama veya enfeksiyonla blast")]),
    ("hemophilia_bleed", "3B10", "D66", "", "Haemophilia with acute bleed", "Akut kanamalı hemofili", "Painful, swollen joint after minor injury", "Küçük travma sonrası ağrılı, şiş eklem", 2, 3, [("Head injury in a haemophiliac", "Hemofili hastasında kafa travması")]),
    ("transfusion_reaction", "NE80", "T80.919", "", "Acute transfusion reaction", "Akut transfüzyon reaksiyonu", "Fever and chills during a blood transfusion", "Kan transfüzyonu sırasında ateş ve titreme", 2, 3, [("Haemolysis or anaphylaxis during transfusion", "Transfüzyon sırasında hemoliz veya anafilaksi")]),
])

_OBGYN = _mk("obstetrics-gynecology", [
    ("ectopic_pregnancy", "JA01", "O00.90", "", "Ectopic pregnancy", "Ektopik gebelik", "Lower belly pain and spotting with a late period", "Geciken adetle alt karın ağrısı ve lekelenme", 1, 3, [("Positive pregnancy test with abdominal pain and shock", "Karın ağrısı ve şokla pozitif gebelik testi")]),
    ("preeclampsia", "JA24", "O14.90", "", "Pre-eclampsia", "Preeklampsi", "Headache and swelling late in pregnancy", "Gebeliğin geç döneminde baş ağrısı ve şişlik", 2, 3, [("High BP with headache or visual change", "Baş ağrısı/görme değişimiyle yüksek TA")]),
    ("pph", "JA43", "O72.1", "", "Postpartum haemorrhage", "Doğum sonu kanama", "Heavy bleeding after delivery", "Doğum sonrası yoğun kanama", 1, 4, [("Ongoing blood loss with tachycardia", "Taşikardiyle süren kan kaybı")]),
    ("ovarian_torsion", "GA1Z", "N83.51", "", "Ovarian torsion", "Over torsiyonu", "Sudden severe one-sided pelvic pain", "Ani şiddetli tek taraflı pelvik ağrı", 2, 3, [("Acute pelvic pain with an adnexal mass", "Adneksiyal kitleyle akut pelvik ağrı")]),
    ("pid", "GA05", "N73.9", "", "Pelvic inflammatory disease", "Pelvik enflamatuar hastalık", "Pelvic pain, discharge and fever", "Pelvik ağrı, akıntı ve ateş", 3, 2, [("Tubo-ovarian abscess with sepsis", "Sepsisle tubo-ovaryan apse")]),
    ("hyperemesis", "JA86", "O21.0", "", "Hyperemesis gravidarum", "Gebelik hiperemezisi", "Relentless vomiting in early pregnancy", "Erken gebelikte durmayan kusma", 3, 2, [("Ketosis and dehydration", "Ketoz ve dehidratasyon")]),
    ("eclampsia", "JA25", "O15.9", "", "Eclampsia", "Eklampsi", "A seizure late in pregnancy with high blood pressure", "Gebeliğin geç döneminde yüksek tansiyonla nöbet", 1, 4, [("Seizure with hypertension in pregnancy", "Gebelikte hipertansiyonla nöbet")]),
    ("placental_abruption", "JA45", "O45.9", "", "Placental abruption", "Plasenta dekolmanı", "Painful vaginal bleeding late in pregnancy", "Gebeliğin geç döneminde ağrılı vajinal kanama", 1, 3, [("Concealed haemorrhage with a tense uterus", "Gergin uterusla gizli kanama")]),
    ("threatened_miscarriage", "JA00", "O20.0", "", "Threatened miscarriage", "Düşük tehdidi", "Vaginal bleeding in early pregnancy", "Erken gebelikte vajinal kanama", 3, 2, [("Heavy bleeding with haemodynamic change", "Hemodinamik değişimle yoğun kanama")]),
    ("ovarian_cyst_rupture", "GA1Z", "N83.8", "", "Ruptured ovarian cyst", "Rüptüre over kisti", "Sudden one-sided pelvic pain mid-cycle", "Siklus ortasında ani tek taraflı pelvik ağrı", 3, 2, [("Haemoperitoneum with instability", "İnstabiliteyle hemoperitoneum")]),
])

_MSK_TOX = _mk("musculoskeletal", [
    ("cauda_equina", "FA80", "G83.4", "", "Cauda equina syndrome", "Kauda ekina sendromu", "Back pain with leg weakness and numb saddle", "Bacak güçsüzlüğü ve eyer uyuşmasıyla sırt ağrısı", 1, 4, [("Bladder dysfunction with saddle anaesthesia", "Eyer anestezisiyle mesane işlev bozukluğu")]),
    ("open_fracture", "NC72", "S82.90", "", "Open long-bone fracture", "Açık uzun kemik kırığı", "Deformed limb with a wound after a fall", "Düşme sonrası yaralı ve deforme uzuv", 2, 3, [("Neurovascular compromise distal to injury", "Yaralanma distalinde nörovasküler bozukluk")]),
    ("compartment_syndrome", "FB32.Y", "T79.A0", "", "Acute compartment syndrome", "Akut kompartman sendromu", "Severe limb pain after a crush injury", "Ezilme sonrası şiddetli uzuv ağrısı", 1, 4, [("Pain on passive stretch out of proportion", "Pasif gerilmeyle orantısız ağrı")]),
    ("gout", "FA25", "M10.9", "", "Acute gout", "Akut gut", "A hot, swollen, very painful big toe", "Sıcak, şiş, çok ağrılı ayak başparmağı", 4, 1, [("Cannot exclude septic arthritis", "Septik artrit dışlanamıyor")]),
    ("low_back_pain", "ME84", "M54.5", "", "Mechanical low back pain", "Mekanik bel ağrısı", "Back pain after lifting, no red flags", "Kaldırma sonrası bel ağrısı, kırmızı bayrak yok", 5, 1, [("Emerging red flags: retention or weakness", "Ortaya çıkan kırmızı bayraklar: retansiyon/güçsüzlük")]),
    ("paracetamol_od", "NE60", "T39.1X", "", "Paracetamol overdose", "Parasetamol aşırı dozu", "Took many paracetamol tablets", "Çok sayıda parasetamol aldı", 2, 3, [("Late presentation with deranged LFTs", "Bozuk KCFT'yle geç başvuru")]),
    ("tca_overdose", "NE60.1", "T43.0X", "", "Tricyclic antidepressant overdose", "Trisiklik antidepresan aşırı dozu", "Drowsy after taking antidepressants", "Antidepresan sonrası uykululuk", 1, 4, [("Wide QRS with hypotension or seizures", "Hipotansiyon/nöbetle geniş QRS")]),
    ("anticholinergic_tox", "NE60.2", "T44.3X", "", "Anticholinergic toxicity", "Antikolinerjik toksisite", "Confused, flushed and dry after an overdose", "Aşırı doz sonrası konfüze, kızarık ve kuru", 2, 3, [("Hyperthermia with delirium and tachycardia", "Taşikardi ve deliryumla hipertermi")]),
    ("rhabdomyolysis", "FB32.3", "M62.82", "", "Rhabdomyolysis", "Rabdomiyoliz", "Muscle pain and dark urine after a long lie", "Uzun süre yattıktan sonra kas ağrısı ve koyu idrar", 2, 3, [("Hyperkalaemia or acute kidney injury", "Hiperkalemi veya akut böbrek hasarı")]),
    ("hip_fracture", "NC72.3", "S72.009", "", "Hip fracture", "Kalça kırığı", "Unable to weight-bear after a fall in an older adult", "Yaşlı hastada düşme sonrası basamama", 3, 2, [("Shortened, externally rotated leg", "Kısalmış, dışa dönük bacak")]),
    ("salicylate_od", "NE60", "T39.01X", "", "Salicylate (aspirin) overdose", "Salisilat (aspirin) aşırı dozu", "Ringing ears and fast breathing after an overdose", "Aşırı doz sonrası kulak çınlaması ve hızlı solunum", 2, 4, [("Altered mental state with mixed acid-base picture", "Karışık asit-baz tablosuyla bilinç değişimi")]),
    ("organophosphate_poisoning", "NE61", "T60.0X", "", "Organophosphate poisoning", "Organofosfat zehirlenmesi", "Drooling, sweating and pinpoint pupils after a spray", "İlaçlama sonrası salya, terleme ve iğne başı pupil", 1, 4, [("Cholinergic crisis with bronchorrhoea", "Bronşoreyle kolinerjik kriz")]),
])

# All conditions, in a stable order (systems grouped as declared above).
CATALOG: list[dict[str, Any]] = (
    _EMERGENCY + _CARDIOLOGY + _PULMONOLOGY + _GI + _NEURO + _INFECTIOUS
    + _ENDOCRINE + _RENAL + _PSYCH + _HEMATOLOGY + _OBGYN + _MSK_TOX
)

# --------------------------------------------------------------------------- #
# System-name normalisation (accept common synonyms / abbreviations).          #
# --------------------------------------------------------------------------- #
_SYSTEM_ALIASES: dict[str, str] = {
    "em": "emergency", "er": "emergency", "ed": "emergency", "emerg": "emergency",
    "cardio": "cardiology", "cardiac": "cardiology", "heart": "cardiology",
    "pulm": "pulmonology", "pulmonary": "pulmonology", "respiratory": "pulmonology",
    "resp": "pulmonology", "chest": "pulmonology",
    "gi": "gastroenterology", "gastro": "gastroenterology", "gastrointestinal": "gastroenterology",
    "neuro": "neurology", "neurological": "neurology",
    "id": "infectious", "infection": "infectious", "infectious-disease": "infectious",
    "infectious_disease": "infectious", "infxn": "infectious",
    "endo": "endocrine", "metabolic": "endocrine", "endocrinology": "endocrine",
    "nephrology": "renal", "kidney": "renal", "nephro": "renal", "gu": "renal",
    "genitourinary": "renal", "urology": "renal",
    "psych": "psychiatry", "psychiatric": "psychiatry", "dsm": "psychiatry",
    "mental-health": "psychiatry", "mental_health": "psychiatry", "psychology": "psychiatry",
    "heme": "hematology", "haematology": "hematology", "onc": "hematology",
    "oncology": "hematology", "hematology-oncology": "hematology",
    "obgyn": "obstetrics-gynecology", "ob-gyn": "obstetrics-gynecology",
    "obstetrics": "obstetrics-gynecology", "gynecology": "obstetrics-gynecology",
    "gynaecology": "obstetrics-gynecology",
    "msk": "musculoskeletal", "ortho": "musculoskeletal", "orthopedics": "musculoskeletal",
    "tox": "musculoskeletal", "toxicology": "musculoskeletal", "trauma": "musculoskeletal",
}

_TOKEN_SPLIT = re.compile(r"[^a-z0-9çğıöşü]+", re.I)


def _normalize_system(system: str) -> str:
    s = (system or "").strip().lower().replace(" ", "-")
    return _SYSTEM_ALIASES.get(s, _SYSTEM_ALIASES.get(s.replace("-", ""), s))


def list_systems() -> list[str]:
    """The distinct systems present in the catalog, in declaration order."""
    seen: list[str] = []
    for c in CATALOG:
        if c["system"] not in seen:
            seen.append(c["system"])
    return seen


def _haystack(cond: dict[str, Any]) -> str:
    rf = " ".join(f"{r['en']} {r['tr']}" for r in cond.get("red_flags", []))
    return " ".join([
        cond["id"], cond["label_en"], cond["label_tr"], cond["system"],
        cond["typical_complaint_en"], cond["typical_complaint_tr"],
        cond.get("icd10", ""), cond.get("icd11", ""), cond.get("dsm5tr", ""), rf,
    ]).lower()


def _matches_complaint(cond: dict[str, Any], needle: str) -> bool:
    needle = (needle or "").strip().lower()
    if not needle:
        return True
    hay = _haystack(cond)
    tokens = [t for t in _TOKEN_SPLIT.split(needle) if len(t) >= 3]
    if not tokens:
        return needle in hay
    return any(t in hay for t in tokens)


def _rng_of(rng: Optional[Any]) -> random.Random:
    if isinstance(rng, random.Random):
        return rng
    if rng is None:
        return random.Random()
    try:
        return random.Random(rng)          # int / str / bytes seed
    except TypeError:
        return random.Random()


def sample_condition(
    system: Optional[str] = None,
    difficulty: Optional[int] = None,
    complaint: Optional[str] = None,
    rng: Optional[Any] = None,
    exclude_ids: Optional[set] = None,
) -> dict[str, Any]:
    """Sample one condition, optionally constrained. Never raises.

    * ``system``     — one of :func:`list_systems` (synonyms accepted). Ignored
      if it selects nothing.
    * ``difficulty`` — 1..5; if no exact match, the nearest difficulty is used.
    * ``complaint``  — free text; token-overlap match against label / complaint /
      red-flags / codes. Ignored if it selects nothing.
    * ``rng``        — a ``random.Random`` (seedable), an int/str seed, or None.
    * ``exclude_ids``— recently-served condition ids to avoid (anti-repeat).
      Applied AFTER the other filters and ONLY while it still leaves at least one
      candidate, so a constrained pool is never emptied by the exclusion.

    Returns a fresh shallow+nested copy so the caller may annotate freely.
    """
    r = _rng_of(rng)
    pool = CATALOG

    if system:
        target = _normalize_system(system)
        sub = [c for c in pool if c["system"] == target]
        if sub:
            pool = sub

    if complaint:
        sub = [c for c in pool if _matches_complaint(c, complaint)]
        if sub:
            pool = sub

    if difficulty is not None:
        try:
            d = int(difficulty)
        except (TypeError, ValueError):
            d = None
        if d is not None:
            exact = [c for c in pool if c["difficulty"] == d]
            if exact:
                pool = exact
            else:
                best = min(abs(c["difficulty"] - d) for c in pool)
                pool = [c for c in pool if abs(c["difficulty"] - d) == best]

    if not pool:
        pool = CATALOG

    # Anti-repeat: drop recently-served ids only if some candidate survives.
    if exclude_ids:
        fresh = [c for c in pool if c["id"] not in exclude_ids]
        if fresh:
            pool = fresh

    chosen = r.choice(pool)
    # Deep-ish copy: red_flags list of dicts must not be shared/mutated.
    out = dict(chosen)
    out["red_flags"] = [dict(rf) for rf in chosen.get("red_flags", [])]
    return out


if __name__ == "__main__":  # tiny self-check when run directly
    import json

    systems = list_systems()
    print(f"{len(CATALOG)} conditions across {len(systems)} systems: {systems}")
    counts = {s: sum(1 for c in CATALOG if c['system'] == s) for s in systems}
    print("per system:", counts)
    # id uniqueness
    ids = [c["id"] for c in CATALOG]
    dupes = {i for i in ids if ids.count(i) > 1}
    print("duplicate ids (should be empty):", dupes)
    # every entry has the required keys + acuity/difficulty in range
    bad = [c["id"] for c in CATALOG
           if not (1 <= c["typical_acuity"] <= 5 and 1 <= c["difficulty"] <= 5)]
    print("out-of-range acuity/difficulty (should be empty):", bad)
    rng = random.Random(7)
    print("sample(cardiology):", sample_condition("cardiology", rng=rng)["label_en"])
    print("sample(gi, dx=2):", sample_condition("gi", difficulty=2, rng=rng)["label_en"])
    print("sample(complaint=chest):", sample_condition(complaint="chest pain", rng=rng)["label_en"])
    print(json.dumps(sample_condition("psychiatry", rng=random.Random(1)), ensure_ascii=False, indent=2))

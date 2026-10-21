"""Attending tips: short, actionable teaching points generated ONLY from verified statements.

Each ``AttendingTip`` is authored by hand in the AMBOSS "attending tips" register (next best
action, pitfall, timing) and links to one or more GuidelineStatement ids. ``list_tips`` joins
a tip to the store and emits it only when EVERY linked statement is ``verified``; a tip whose
evidence failed verification is withheld, never shown with a weaker citation.

Condition join: ``condition`` may be an ICD-10 code (``I21.3``), a ``server/condition_catalog``
id (``acs_stemi``) or a label; a tip matches when any of its ``condition_codes`` matches by
exact or prefix comparison (``I21`` matches ``I21.3``).
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Set

from pydantic import BaseModel, Field

from server.guidelines.store import GuidelineStore, code_matches, resolve_condition_codes

STAGES = ("triage", "history", "exam", "workup", "treatment", "disposition")


class AttendingTip(BaseModel):
    id: str
    condition_codes: List[str]
    stage: str
    tip_en: str
    tip_tr: str
    pitfall_en: str = ""
    pitfall_tr: str = ""
    timing_hint: str = ""
    statement_ids: List[str] = Field(default_factory=list)


def _t(tid: str, codes: Sequence[str], stage: str, tip_en: str, tip_tr: str, pitfall_en: str, pitfall_tr: str,
       timing: str, ids: Sequence[str]) -> AttendingTip:
    assert stage in STAGES, stage
    return AttendingTip(id=tid, condition_codes=list(codes), stage=stage, tip_en=tip_en, tip_tr=tip_tr,
                        pitfall_en=pitfall_en, pitfall_tr=pitfall_tr, timing_hint=timing, statement_ids=list(ids))


ACS = ["I21.3", "I21.4", "I20.0", "R07.4"]
STEMI = ["I21.3"]
PE = ["I26.9"]
AAD = ["I71.0", "I71.00", "I71.01"]
SEP = ["A41.9", "R65.21", "R65.20"]
DKA = ["E10.10", "E11.10"]
STROKE = ["I63.9", "G45.9"]
ICH = ["I61.9"]
SAH = ["I60.9", "R51"]
ANA = ["T78.2", "T78.0", "T88.6"]
ASTH = ["J45.901", "J45.902"]
COPD = ["J44.1"]
CAP = ["J18.9"]
PTX = ["J93.1", "J93.0", "J93.11"]
APPY = ["K35.80", "K35.2", "K35.3", "R10.4"]
ACC = ["K81.0", "K80.20", "K83.09"]
PANC = ["K85.9"]
UGIB = ["K92.2", "K92.0", "K92.1", "I85.01"]
AKI = ["N17.9"]
HYPK = ["E87.5", "N18.6", "N17.9"]
PARA = ["T39.1X", "T39.1"]
OPI = ["T40.2X", "T40.1X", "T40.4X", "T40.60"]
SE = ["G41.9", "R56.9"]
PPH = ["O72.1", "O72.0"]
ECT = ["O00.90", "O00.1", "O00.10"]
PANIC = ["F41.0", "F41.1"]
SH = ["R45.851", "T14.91"]
AGIT = ["R45.1", "F29", "F31.2", "F20.9"]
MEN = ["G00.9", "A39.4", "A39.0"]
ALC = ["F10.239", "F10.231"]


TIPS: List[AttendingTip] = [
    # ---------------- ACS ----------------
    _t("tip_acs_ecg_first", ACS, "triage",
       "Any chest pain that could be ischaemic gets a resting 12-lead ECG at first contact, read for dynamic or unstable ST changes; if STEMI, assess reperfusion eligibility immediately.",
       "İskemik olabilecek her göğüs ağrısında ilk temasta 12 derivasyonlu EKG çekin ve dinamik ya da kararsız ST değişikliklerini okuyun; STEMI ise reperfüzyon uygunluğunu hemen değerlendirin.",
       "Waiting for a troponin result before deciding on reperfusion.",
       "Reperfüzyon kararı için troponin sonucunu beklemek.",
       "ECG at first contact; reperfusion eligibility immediately", ["gs_nice_ng185_nstemi_assessment", "gs_nice_ng185_reperfusion_eligibility"]),
    _t("tip_acs_aspirin", STEMI, "treatment",
       "Give a single 300 mg loading dose of aspirin as soon as STEMI is suspected unless there is clear evidence of allergy.",
       "STEMI şüphesi doğar doğmaz, açık alerji kanıtı yoksa tek bir 300 mg aspirin yükleme dozu verin.",
       "Withholding aspirin for a vague 'intolerance' that is not an allergy.",
       "Alerji olmayan belirsiz bir 'intolerans' nedeniyle aspirini esirgemek.",
       "As soon as possible", ["gs_nice_ng185_aspirin300"]),
    _t("tip_acs_reperfusion_window", STEMI, "treatment",
       "Within 12 hours of symptom onset, primary PCI is preferred only if it can be delivered within 120 minutes of the time fibrinolysis could have been given; otherwise give fibrinolysis.",
       "Semptom başlangıcından sonraki 12 saat içinde primer PKG, yalnızca fibrinolizin verilebileceği zamandan itibaren 120 dakika içinde uygulanabiliyorsa tercih edilir; aksi halde fibrinoliz verin.",
       "Letting a transfer delay run past the 120-minute window without switching to fibrinolysis.",
       "Fibrinolize geçmeden nakil gecikmesinin 120 dakikalık pencereyi aşmasına izin vermek.",
       "PCI within 120 min of the lysis decision point", ["gs_nice_ng185_ppci_120min", "gs_nice_ng185_fibrinolysis"]),
    _t("tip_acs_nstemi_risk", ["I21.4", "I20.0", "R07.4"], "workup",
       "For NSTEMI or unstable angina, structure the risk assessment: history, blood pressure and heart rate, a resting ECG for dynamic changes, and troponin, creatinine, glucose and haemoglobin.",
       "NSTEMI veya kararsız anjinada risk değerlendirmesini yapılandırın: öykü, kan basıncı ve kalp hızı, dinamik değişiklikler için istirahat EKG'si ve troponin, kreatinin, glukoz ile hemoglobin.",
       "Treating a single early troponin as a rule-out without knowing its timing from symptom onset.",
       "Semptom başlangıcına göre zamanlamasını bilmeden tek bir erken troponini dışlama olarak kabul etmek.",
       "Bloods with the first ECG", ["gs_nice_ng185_nstemi_assessment"]),

    # ---------------- Pulmonary embolism ----------------
    _t("tip_pe_wells_first", PE, "history",
       "Score the two-level PE Wells before you order anything: it decides whether the next step is a D-dimer or a CTPA.",
       "Herhangi bir istem yapmadan önce iki düzeyli PE Wells skorunu hesaplayın: sonraki adımın D-dimer mi BTPA mı olacağını belirler.",
       "Ordering a D-dimer in a PE-likely patient: a positive result adds nothing and a negative one does not rule PE out.",
       "PE olası hastada D-dimer istemek: pozitif sonuç bir şey katmaz, negatif sonuç PE'yi dışlamaz.",
       "Before imaging", ["gs_nice_ng158_pe_wells"]),
    _t("tip_pe_likely_ctpa", PE, "workup",
       "Wells more than 4: CTPA immediately if possible; if the scan will be delayed, start interim therapeutic anticoagulation while you wait.",
       "Wells 4'ün üzerinde: mümkünse hemen BTPA; tarama gecikecekse beklerken geçici terapötik antikoagülasyon başlayın.",
       "Leaving a PE-likely patient unanticoagulated overnight because the scanner is busy.",
       "Tomografi meşgul diye PE olası hastayı gece boyunca antikoagüle etmemek.",
       "CTPA immediately; anticoagulate if delayed", ["gs_nice_ng158_pe_ctpa"]),
    _t("tip_pe_unlikely_ddimer", PE, "workup",
       "Wells 4 or less: D-dimer with the result within 4 hours; if the result will take longer, offer interim anticoagulation while awaiting it.",
       "Wells 4 veya altı: sonucu 4 saat içinde alınacak D-dimer; sonuç daha uzun sürecekse beklerken geçici antikoagülasyon önerin.",
       "Treating an age-unadjusted borderline D-dimer in an older patient as a definite positive without considering the threshold.",
       "Yaşlı hastada yaşa göre ayarlanmamış sınırda bir D-dimeri eşiği düşünmeden kesin pozitif saymak.",
       "Result within 4 hours", ["gs_nice_ng158_pe_unlikely_ddimer"]),

    # ---------------- Aortic dissection ----------------
    _t("tip_aad_pain_character", AAD, "history",
       "Ask specifically for sudden, severe, tearing pain that the patient has never experienced and that migrates: anterior chest points to type A, back or abdomen to type B.",
       "Hastanın daha önce hiç yaşamadığı ani, şiddetli, yırtılma tarzında ve yer değiştiren ağrıyı özellikle sorun: ön göğüs Tip A'yı, sırt veya karın Tip B'yi düşündürür.",
       "Anchoring on ACS because the ECG is abnormal; dissection can involve the coronary ostia.",
       "EKG anormal diye AKS'ye kilitlenmek; diseksiyon koroner ostiumları tutabilir.",
       "At first history", ["gs_jcs2020_aad_pain"]),
    _t("tip_aad_pulses", AAD, "exam",
       "Palpate every limb pulse, measure blood pressure in both arms and listen for a new aortic regurgitation murmur; a pulse deficit or inter-arm difference raises the probability sharply.",
       "Tüm ekstremite nabızlarını palpe edin, her iki koldan kan basıncı ölçün ve yeni bir aort yetersizliği üfürümünü dinleyin; nabız defisiti veya kollar arası fark olasılığı belirgin artırır.",
       "Recording a single arm pressure and moving on.",
       "Tek koldan basınç kaydedip geçmek.",
       "Before imaging", ["gs_jcs2020_aad_assessment"]),
    _t("tip_aad_imaging", AAD, "workup",
       "A raised D-dimer is sensitive and should push you towards imaging; bedside echo for pericardial fluid or aortic regurgitation supports the diagnosis, and contrast-enhanced CT confirms it once the patient is stable.",
       "Yüksek D-dimer duyarlıdır ve sizi görüntülemeye yönlendirmelidir; perikardiyal sıvı veya aort yetersizliği için yatak başı eko tanıyı destekler ve hasta stabilken kontrastlı BT doğrular.",
       "Giving antiplatelets or anticoagulants for presumed ACS before dissection is excluded.",
       "Diseksiyon dışlanmadan varsayılan AKS için antiplatelet veya antikoagülan vermek.",
       "CT as soon as haemodynamics allow", ["gs_jcs2020_aad_ddimer_ct"]),
    _t("tip_aad_control_transfer", AAD, "treatment",
       "Start strict control now: heart rate below 60/min and systolic 100 to 120 mmHg, then move the patient to a centre that can operate or stent emergently; type A with a patent false lumen needs urgent open surgery.",
       "Sıkı kontrole hemen başlayın: kalp hızı 60/dk altı ve sistolik 100-120 mmHg; ardından hastayı acil ameliyat veya stent yapabilen bir merkeze nakledin; yalancı lümeni açık Tip A acil açık cerrahi gerektirir.",
       "Lowering blood pressure before controlling heart rate, which increases shear stress.",
       "Kalp hızını kontrol etmeden kan basıncını düşürmek, bu kesme gerilimini artırır.",
       "Immediately; transfer in parallel", ["gs_jcs2020_aad_bp_hr", "gs_jcs2020_aad_typeA_surgery"]),

    # ---------------- Sepsis ----------------
    _t("tip_sepsis_screen", SEP, "triage",
       "Screen with NEWS2 (not qSOFA) and look for the high-risk criteria: RR 25 or more, new oxygen need to keep SpO2 above 92%, systolic 90 or less or 40 below baseline, HR above 130, no urine for 18 hours.",
       "qSOFA değil NEWS2 ile tarayın ve yüksek risk kriterlerini arayın: SS 25 ve üzeri, SpO2'yi %92 üzerinde tutmak için yeni oksijen gereksinimi, sistolik 90 ve altı veya bazalin 40 altında, KH 130 üzeri, 18 saat idrar yok.",
       "Ruling sepsis out on a normal lactate or a single biomarker.",
       "Normal laktat veya tek bir biyobelirteçle sepsisi dışlamak.",
       "At triage and every reassessment", ["gs_ssc21_screening", "gs_nice_ng253_high_risk_criteria"]),
    _t("tip_sepsis_cultures_lactate", SEP, "workup",
       "Draw blood cultures before the first antibiotic dose only if that does not delay it, measure lactate now and repeat it to steer resuscitation.",
       "İlk antibiyotik dozunu geciktirmiyorsa kan kültürlerini önce alın, laktatı hemen ölçün ve resüsitasyonu yönlendirmek için tekrarlayın.",
       "Holding antibiotics for an hour while cultures are chased.",
       "Kültür peşinde koşarken antibiyotiği bir saat bekletmek.",
       "Cultures with the cannula; lactate now and serially", ["gs_ssc21_lactate_cultures"]),
    _t("tip_sepsis_abx_1h", SEP, "treatment",
       "Septic shock or probable sepsis: antimicrobials immediately, ideally within 1 hour of recognition.",
       "Septik şok veya muhtemel sepsis: antimikrobiyaller hemen, ideal olarak tanınmadan sonraki 1 saat içinde.",
       "Waiting for imaging to 'find the source' before the first dose.",
       "İlk dozdan önce 'odağı bulmak' için görüntülemeyi beklemek.",
       "Within 1 hour of recognition", ["gs_ssc21_antimicrobials_1h"]),
    _t("tip_sepsis_fluids", SEP, "treatment",
       "Hypoperfusion or shock: at least 30 mL/kg of balanced crystalloid within the first 3 hours, then reassess rather than running fluids to a fixed total.",
       "Hipoperfüzyon veya şok: ilk 3 saat içinde en az 30 mL/kg dengeli kristaloid; ardından sabit bir toplama kadar sıvı vermek yerine yeniden değerlendirin.",
       "Using gelatin or starch, or continuing boluses without a perfusion check.",
       "Jelatin veya nişasta kullanmak ya da perfüzyon kontrolü olmadan boluslara devam etmek.",
       "First 3 hours", ["gs_ssc21_fluids_30mlkg"]),
    _t("tip_sepsis_vasopressor", ["R65.21"], "treatment",
       "If the MAP stays below 65 mm Hg despite fluids, start norepinephrine through a peripheral line rather than waiting for central access.",
       "Sıvılara rağmen OAB 65 mm Hg altında kalıyorsa santral erişimi beklemeden periferik yoldan norepinefrin başlayın.",
       "Delaying vasopressors until a central line is in.",
       "Vazopresörü santral kateter takılana kadar geciktirmek.",
       "As soon as fluid-refractory", ["gs_ssc21_norepinephrine_map65"]),

    # ---------------- DKA ----------------
    _t("tip_dka_diagnosis", DKA, "workup",
       "Confirm all three before you call it DKA: glucose above 11 or known diabetes, ketones above 3 (or 2+ on the stick), and pH below 7.3 or bicarbonate below 15 on a venous gas.",
       "DKA demeden önce üçünü de doğrulayın: 11 üzerinde glukoz veya bilinen diyabet, 3 üzerinde keton (veya çubukta 2+) ve venöz gazda 7,3 altında pH ya da 15 altında bikarbonat.",
       "Missing euglycaemic DKA in a patient on an SGLT2 inhibitor because the glucose is unimpressive.",
       "Glukoz etkileyici değil diye SGLT2 inhibitörü kullanan hastada öglisemik DKA'yı kaçırmak.",
       "At presentation", ["gs_jbds_dka_diagnosis"]),
    _t("tip_dka_fluids_potassium", DKA, "treatment",
       "Fluids come first: 1 L of 0.9% sodium chloride over the first hour (500 ml boluses if systolic is below 90), and add 40 mmol/L potassium chloride as soon as the potassium is 3.5 to 5.5.",
       "Önce sıvı: ilk saatte 1 L %0,9 sodyum klorür (sistolik 90 altındaysa 500 ml boluslar) ve potasyum 3,5-5,5 olur olmaz 40 mmol/L potasyum klorür ekleyin.",
       "Giving bicarbonate for the acidosis, or forgetting potassium before the insulin drives it down.",
       "Asidoz için bikarbonat vermek ya da insülin potasyumu düşürmeden önce potasyumu unutmak.",
       "First 60 minutes", ["gs_jbds_dka_fluids_potassium", "gs_nice_ng17_dka_fluids_bicarb"]),
    _t("tip_dka_insulin", DKA, "treatment",
       "Start a fixed rate insulin infusion at 0.1 unit/kg/hour and keep the patient's usual long-acting insulin going.",
       "0,1 ünite/kg/saat sabit hızlı insülin infüzyonu başlayın ve hastanın olağan uzun etkili insülinine devam edin.",
       "Stopping the basal insulin, which guarantees rebound ketosis when the infusion comes off.",
       "Bazal insülini kesmek; bu, infüzyon kesildiğinde geri tepme ketozunu garantiler.",
       "After fluids are running", ["gs_jbds_dka_friii", "gs_nice_ng17_dka_fluids_bicarb"]),
    _t("tip_dka_monitoring", DKA, "workup",
       "Hourly glucose and ketones, venous gas at 1 hour, 2 hours and then 2-hourly; you want ketones falling 0.5, bicarbonate rising 3 and glucose falling 3 per hour, and 10% glucose at 125 ml/hour once glucose drops below 14.",
       "Saatlik glukoz ve keton, 1. saat, 2. saat ve sonrasında 2 saatte bir venöz gaz; ketonun saatte 0,5 düşmesini, bikarbonatın 3 yükselmesini ve glukozun 3 düşmesini istersiniz; glukoz 14'ün altına inince 125 ml/saat %10 glukoz.",
       "Turning the insulin off when glucose normalises while ketones are still present.",
       "Ketonlar sürerken glukoz normale geldi diye insülini kapatmak.",
       "Reassess hourly; gas at 1 h, 2 h, then 2-hourly", ["gs_jbds_dka_monitoring", "gs_jbds_dka_targets_glucose"]),

    # ---------------- Stroke / ICH ----------------
    _t("tip_stroke_fast_glucose", STROKE, "triage",
       "FAST positive is a stroke until proven otherwise, but check the glucose first: hypoglycaemia is the one mimic you can fix in a minute.",
       "FAST pozitif, aksi kanıtlanana kadar inmedir; ancak önce glukoza bakın: hipoglisemi bir dakikada düzeltebileceğiniz tek taklitçidir.",
       "Starting the stroke pathway without a glucose.",
       "Glukoz bakmadan inme yolağını başlatmak.",
       "At first contact", ["gs_nice_ng128_fast_glucose"]),
    _t("tip_stroke_ct_immediate", STROKE + ICH, "workup",
       "Image immediately with non-contrast CT when the patient is a thrombolysis or thrombectomy candidate, is anticoagulated, has a bleeding tendency, GCS below 13, fluctuating symptoms, papilloedema, neck stiffness, fever or a severe headache at onset.",
       "Hasta tromboliz veya trombektomi adayıysa, antikoagüle ise, kanama eğilimi varsa, GKS 13'ün altındaysa, semptomlar dalgalıysa, papilödem, ense sertliği, ateş veya başlangıçta şiddetli baş ağrısı varsa hemen kontrastsız BT çekin.",
       "Booking the scan 'within 24 hours' for a patient still inside the thrombolysis window.",
       "Hala tromboliz penceresi içindeki hastaya taramayı '24 saat içinde' planlamak.",
       "Immediately", ["gs_nice_ng128_ct_immediate"]),
    _t("tip_stroke_thrombolysis", ["I63.9"], "treatment",
       "Thrombolysis (alteplase or tenecteplase) is given within 4.5 hours of onset once haemorrhage is excluded, and only inside an organised stroke service that can monitor for complications.",
       "Tromboliz (alteplaz veya tenekteplaz) kanama dışlandıktan sonra başlangıçtan itibaren 4,5 saat içinde ve yalnızca komplikasyonları izleyebilen organize bir inme servisinde verilir.",
       "Letting an uncertain onset time become 'last seen well 4 hours ago' by assumption.",
       "Belirsiz başlangıç zamanını varsayımla 'en son 4 saat önce iyi görüldü' yapmak.",
       "Within 4.5 hours of onset", ["gs_nice_ng128_thrombolysis"]),
    _t("tip_stroke_aspirin_swallow", ["I63.9"], "treatment",
       "Once haemorrhage is excluded give aspirin 300 mg within 24 hours, orally only after a swallow screen, otherwise rectally or by enteral tube.",
       "Kanama dışlandıktan sonra 24 saat içinde 300 mg aspirin verin; oral yol yalnızca yutma taramasından sonra, aksi halde rektal veya enteral tüple.",
       "Oral aspirin or sips of water before anyone has screened the swallow.",
       "Kimse yutmayı taramadan oral aspirin veya su yudumları.",
       "Within 24 hours; swallow screen first", ["gs_nice_ng128_aspirin_swallow"]),
    _t("tip_stroke_unit", STROKE, "disposition",
       "Admit directly to a specialist acute stroke unit from the department; do not route through a general ward.",
       "Acil servisten doğrudan uzmanlaşmış akut inme ünitesine yatırın; genel servis üzerinden yönlendirmeyin.",
       "A 'medical bed first, stroke unit tomorrow' plan.",
       "'Önce dahiliye yatağı, yarın inme ünitesi' planı.",
       "On admission", ["gs_nice_ng128_stroke_unit"]),
    _t("tip_ich_bp", ICH, "treatment",
       "In intracerebral haemorrhage presenting within 6 hours with systolic 150 to 220 mmHg, consider rapid blood pressure lowering once the exclusions are checked.",
       "6 saat içinde başvuran ve sistoliği 150-220 mmHg olan intraserebral kanamada dışlama kriterleri kontrol edildikten sonra hızlı kan basıncı düşürmeyi değerlendirin.",
       "Treating the pressure before the CT has distinguished bleed from infarct.",
       "BT kanama ile enfarktı ayırmadan basıncı tedavi etmek.",
       "Within 6 hours of onset", ["gs_nice_ng128_ich_bp"]),

    # ---------------- SAH / headache ----------------
    _t("tip_sah_time_to_peak", SAH, "history",
       "Ask how long the headache took to reach its worst: peak intensity within 1 to 5 minutes is a thunderclap headache and a red flag for subarachnoid haemorrhage, so senior review and an urgent non-contrast CT follow.",
       "Baş ağrısının en şiddetli hale ne kadar sürede geldiğini sorun: 1-5 dakika içinde zirveye ulaşması gök gürültüsü baş ağrısıdır ve subaraknoid kanama için kırmızı bayraktır; kıdemli değerlendirme ve acil kontrastsız BT izler.",
       "Letting a good response to analgesia talk you out of the scan.",
       "Analjeziye iyi yanıtın sizi taramadan vazgeçirmesine izin vermek.",
       "Urgent CT; accuracy highest within 6 hours", ["gs_nice_ng228_thunderclap", "gs_nice_cg150_redflags"]),
    _t("tip_sah_cta_transfer", ["I60.9"], "workup",
       "A confirmed subarachnoid haemorrhage needs CT angiography without delay and an urgent conversation with the neurosurgical centre about transfer; rebleeding is most likely in the first 24 hours.",
       "Doğrulanmış subaraknoid kanamada gecikmeden BT anjiyografi ve nöroşirürji merkeziyle nakil için acil görüşme gerekir; yeniden kanama en çok ilk 24 saatte olasıdır.",
       "Sitting on a positive CT overnight for 'the morning round'.",
       "Pozitif BT'yi 'sabah vizitine' kadar bekletmek.",
       "Without delay", ["gs_nice_ng228_cta_transfer"]),
    _t("tip_sah_nimodipine", ["I60.9"], "treatment",
       "Start enteral nimodipine once the haemorrhage is confirmed; the intravenous form belongs to the specialist unit.",
       "Kanama doğrulandıktan sonra enteral nimodipin başlayın; intravenöz formu uzman üniteye aittir.",
       "Omitting nimodipine because the patient is 'going to neurosurgery anyway'.",
       "Hasta 'zaten nöroşirürjiye gidiyor' diye nimodipini atlamak.",
       "After confirmation", ["gs_nice_ng228_nimodipine"]),

    # ---------------- Anaphylaxis ----------------
    _t("tip_anaph_adrenaline", ANA, "treatment",
       "Intramuscular adrenaline first: 0.01 mg/kg to a maximum of 0.5 mg into the mid-anterolateral thigh, repeated every 5 to 15 minutes if symptoms persist.",
       "Önce kas içi adrenalin: uyluğun orta anterolateral bölgesine en fazla 0,5 mg olmak üzere 0,01 mg/kg; semptomlar sürerse 5-15 dakikada bir tekrarlayın.",
       "Reaching for an antihistamine or steroid before adrenaline.",
       "Adrenalinden önce antihistaminik veya steroide uzanmak.",
       "Immediately; repeat at 5 to 15 min", ["gs_wao2020_anaph_epinephrine_im"]),
    _t("tip_anaph_position", ANA, "exam",
       "Lie the patient flat; sit them up only for respiratory distress, left lateral semi-recumbent if pregnant, recovery position if unconscious.",
       "Hastayı düz yatırın; yalnızca solunum sıkıntısında oturtun, gebeyse sol yan yarı yatar, bilinci kapalıysa derlenme pozisyonu.",
       "Letting the patient stand or walk to a cubicle, which can precipitate collapse.",
       "Hastanın ayağa kalkmasına veya odaya yürümesine izin vermek; bu kollapsı tetikleyebilir.",
       "Alongside the first adrenaline dose", ["gs_wao2020_anaph_positioning"]),
    _t("tip_anaph_observe", ANA, "disposition",
       "Observe before discharge: around half of biphasic reactions occur within 6 to 12 hours, and longer observation is warranted after a severe reaction or more than one adrenaline dose.",
       "Taburculuktan önce gözlemleyin: bifazik reaksiyonların yaklaşık yarısı 6-12 saat içinde ortaya çıkar; ağır reaksiyon veya birden fazla adrenalin dozundan sonra daha uzun gözlem gerekir.",
       "Discharging an hour after the first dose because the rash settled.",
       "Döküntü geçti diye ilk dozdan bir saat sonra taburcu etmek.",
       "6 to 12 hours observation", ["gs_wao2020_anaph_observation"]),

    # ---------------- Asthma / COPD ----------------
    _t("tip_asthma_grade", ASTH, "triage",
       "Grade severity at the door: PEF 33 to 50%, RR 25 or more, HR 110 or more or incomplete sentences is acute severe; PEF below 33%, SpO2 below 92%, silent chest, cyanosis, poor effort, arrhythmia, hypotension or altered consciousness is life-threatening.",
       "Şiddeti kapıda derecelendirin: PEF %33-50, SS 25 ve üzeri, KH 110 ve üzeri veya cümle tamamlayamama akut ağır; PEF %33 altı, SpO2 %92 altı, sessiz göğüs, siyanoz, zayıf efor, aritmi, hipotansiyon veya bilinç değişikliği yaşamı tehdit eden astımdır.",
       "Being reassured by a quiet chest; a silent chest means almost no air is moving.",
       "Sessiz göğüsten rahatlamak; sessiz göğüs neredeyse hiç hava hareket etmediği anlamına gelir.",
       "At triage and after each treatment", ["gs_sign158_asthma_severity"]),
    _t("tip_asthma_oxygen_saba", ASTH, "treatment",
       "Controlled oxygen to SpO2 94 to 98% and high-dose inhaled beta-2 agonist as early as possible, with nebulisers driven by oxygen.",
       "SpO2 %94-98 hedefiyle kontrollü oksijen ve mümkün olan en erken zamanda yüksek doz inhale beta-2 agonist; nebülizatörler oksijenle sürülsün.",
       "Delaying bronchodilator while waiting for a blood gas.",
       "Kan gazı beklerken bronkodilatörü geciktirmek.",
       "Immediately", ["gs_sign158_asthma_oxygen_saba"]),
    _t("tip_asthma_steroids", ASTH, "treatment",
       "Give steroids to every acute attack: prednisolone 40 to 50 mg daily (or hydrocortisone 400 mg a day) continued for at least 5 days until recovery.",
       "Her akut atakta steroid verin: günde 40-50 mg prednizolon (veya günde 400 mg hidrokortizon) iyileşmeye kadar en az 5 gün.",
       "Reserving steroids for the ones that 'fail nebs'.",
       "Steroidi yalnızca 'nebül başarısız olanlara' saklamak.",
       "Within the first hour", ["gs_sign158_asthma_steroids"]),
    _t("tip_asthma_abg_mg", ASTH, "workup",
       "SpO2 below 92% or any life-threatening feature means an arterial gas, because hypercapnia hides from the oximeter; a single IV dose of magnesium sulphate is safe in acute severe asthma and may avert intubation.",
       "SpO2 %92 altı veya herhangi bir yaşamı tehdit eden özellik arter kan gazı gerektirir; çünkü hiperkapni oksimetreden gizlenir; akut ağır astımda tek doz IV magnezyum sülfat güvenlidir ve entübasyonu önleyebilir.",
       "Accepting a 'normal' PaCO2 as reassuring in a tiring patient.",
       "Yorulan hastada 'normal' PaCO2'yi güven verici kabul etmek.",
       "Gas if SpO2 below 92%", ["gs_sign158_asthma_abg_magnesium"]),
    _t("tip_copd_steroids_niv", COPD, "treatment",
       "COPD exacerbation with disabling breathlessness: prednisolone 30 mg daily for 5 days, and non-invasive ventilation is the treatment of choice if hypercapnic ventilatory failure persists despite optimal medical therapy.",
       "Günlük aktiviteyi bozan nefes darlığıyla KOAH alevlenmesi: 5 gün günde 30 mg prednizolon; optimal medikal tedaviye rağmen hiperkapnik ventilatuar yetmezlik sürüyorsa tercih edilen tedavi noninvaziv ventilasyondur.",
       "Running a 2-week steroid course by habit; longer than 7 days adds no benefit.",
       "Alışkanlıkla 2 haftalık steroid kürü vermek; 7 günden uzun ek yarar sağlamaz.",
       "Steroids today; reassess gas for NIV", ["gs_nice_ng115_copd_steroids", "gs_nice_ng115_copd_niv"]),

    # ---------------- Pneumonia ----------------
    _t("tip_cap_cxr_curb65", CAP, "workup",
       "Get the chest X-ray and make the diagnosis within 4 hours of arrival, then grade severity with CURB65 plus clinical judgement.",
       "Varıştan sonraki 4 saat içinde akciğer grafisini çekip tanıyı koyun, ardından CURB65 ve klinik yargıyla şiddeti derecelendirin.",
       "Treating the score as the decision instead of as one input to it.",
       "Skoru karara girdi olarak değil kararın kendisi olarak kullanmak.",
       "Within 4 hours of presentation", ["gs_nice_ng250_cap_4h", "gs_nice_ng250_curb65"]),
    _t("tip_cap_abx_4h", CAP, "treatment",
       "Start antibiotics as soon as the diagnosis is made and within 4 hours of presentation to hospital.",
       "Tanı konulduğunda hemen ve hastaneye başvurudan sonraki 4 saat içinde antibiyotiğe başlayın.",
       "Waiting for sputum or blood culture results before the first dose.",
       "İlk dozdan önce balgam veya kan kültürü sonuçlarını beklemek.",
       "Within 4 hours", ["gs_nice_ng250_cap_4h"]),
    _t("tip_cap_microbiology", CAP, "workup",
       "Skip routine microbiology in low-severity pneumonia; in moderate or high severity send sputum and add blood cultures when sepsis is a concern.",
       "Düşük şiddetli pnömonide rutin mikrobiyolojiyi atlayın; orta veya yüksek şiddette balgam gönderin ve sepsis kaygısı varsa kan kültürü ekleyin.",
       "Blanket cultures in every mild case, delaying discharge for results that will not change management.",
       "Her hafif olguda toplu kültür almak; yönetimi değiştirmeyecek sonuçlar için taburculuğu geciktirir.",
       "Before antibiotics when indicated", ["gs_nice_ng250_cap_micro"]),

    # ---------------- Pneumothorax ----------------
    _t("tip_ptx_decompress", PTX, "triage",
       "Signs of immediate severity mean emergency chest decompression now, 2nd intercostal space mid-clavicular or 4th intercostal mid-axillary, with whatever needle device is to hand; tension pneumothorax is decompressed first and drained after.",
       "Acil ciddiyet bulguları hemen göğüs dekompresyonu demektir; 2. interkostal midklaviküler veya 4. interkostal midaksiller, eldeki herhangi bir iğne aracıyla; tansiyon pnömotoraks önce dekomprese edilir, sonra drene edilir.",
       "Sending a hypotensive, hypoxic patient for a chest X-ray to confirm what the examination already shows.",
       "Hipotansif, hipoksik hastayı muayenenin zaten gösterdiğini doğrulamak için akciğer grafisine göndermek.",
       "Immediately, before imaging", ["gs_splf2023_psp_emergency_decompression", "gs_wses2025_tension_ptx"]),
    _t("tip_ptx_outpatient", ["J93.1", "J93.11"], "disposition",
       "A large primary spontaneous pneumothorax without severity signs can go home after needle aspiration or a mini-chest tube with a one-way valve, provided the patient is stable afterwards, follow-up is organised and imaging is booked at 24 to 72 hours.",
       "Ciddiyet bulgusu olmayan büyük primer spontan pnömotoraks, iğne aspirasyonu veya tek yönlü valfli mini göğüs tübünden sonra hasta stabilse, izlem organize edilmişse ve 24-72 saatte görüntüleme planlanmışsa eve gidebilir.",
       "Admitting every pneumothorax by reflex, or discharging without a booked review.",
       "Her pnömotoraksı refleks olarak yatırmak ya da planlanmış kontrol olmadan taburcu etmek.",
       "Review at 24 to 72 hours", ["gs_splf2023_psp_outpatient"]),

    # ---------------- Appendicitis ----------------
    _t("tip_appy_scores", APPY, "workup",
       "Use a clinical score before imaging: AIR or Adult Appendicitis Score identifies who needs imaging, and an Alvarado below 5 is sensitive enough to exclude appendicitis in low-risk patients.",
       "Görüntülemeden önce klinik skor kullanın: AIR veya Erişkin Apandisit Skoru kimin görüntüleme gerektirdiğini belirler ve 5'in altında Alvarado düşük riskli hastalarda apandisiti dışlamak için yeterince duyarlıdır.",
       "Scanning every right iliac fossa pain regardless of pre-test probability.",
       "Test öncesi olasılığa bakmadan her sağ alt kadran ağrısını taramak.",
       "Before imaging", ["gs_wses2020_appy_scores", "gs_wses2020_appy_tailored"]),
    _t("tip_appy_pregnancy", APPY, "history",
       "In pregnancy do not make the diagnosis on clinical grounds alone; the signs are unreliable and imaging is part of the pathway.",
       "Gebelikte tanıyı yalnızca klinik temelde koymayın; bulgular güvenilmezdir ve görüntüleme yolağın parçasıdır.",
       "Attributing the pain to the pregnancy and sending the patient home.",
       "Ağrıyı gebeliğe bağlayıp hastayı eve göndermek.",
       "At assessment", ["gs_wses2020_appy_tailored"]),
    _t("tip_appy_management", APPY, "treatment",
       "Laparoscopic appendectomy is the most effective treatment; in uncomplicated appendicitis without an appendicolith, antibiotics-first is a discussable alternative with up to 39% recurrence at 5 years.",
       "Laparoskopik apendektomi en etkili tedavidir; apendikoliti olmayan komplike olmayan apandisitte 5 yılda %39'a varan nüks riskiyle önce antibiyotik yaklaşımı tartışılabilir bir alternatiftir.",
       "Offering antibiotics-first without telling the patient about failure and recurrence.",
       "Başarısızlık ve nüksü anlatmadan önce antibiyotik yaklaşımı önermek.",
       "Surgical referral once diagnosed", ["gs_wses2020_appy_laparoscopic", "gs_wses2020_appy_nom"]),

    # ---------------- Cholecystitis ----------------
    _t("tip_acc_ultrasound_lfts", ACC, "workup",
       "Ultrasound is the first imaging test for suspected cholecystitis; raised liver tests or bilirubin alone do not confirm a duct stone, so image the duct before you plan.",
       "Şüpheli kolesistitte ilk görüntüleme ultrasondur; tek başına yüksek karaciğer testleri veya bilirubin kanal taşını doğrulamaz, planlamadan önce kanalı görüntüleyin.",
       "Booking an ERCP on the strength of a raised bilirubin alone.",
       "Yalnızca yüksek bilirubine dayanarak ERCP planlamak.",
       "Ultrasound at presentation", ["gs_wses2020_acc_ultrasound", "gs_wses2020_acc_lfts"]),
    _t("tip_acc_early_surgery", ACC, "treatment",
       "Aim for early laparoscopic cholecystectomy within 7 days of admission and 10 days of symptom onset; antibiotics with observation is for those unfit for or refusing surgery.",
       "Yatıştan sonraki 7 gün ve semptom başlangıcından sonraki 10 gün içinde erken laparoskopik kolesistektomi hedefleyin; antibiyotik ve gözlem cerrahiye uygun olmayan veya reddedenler içindir.",
       "'Cooling it down' for 6 weeks by default in a fit patient.",
       "Uygun hastada varsayılan olarak 6 hafta 'soğutmak'.",
       "Surgery within 7 days of admission", ["gs_wses2020_acc_elc", "gs_wses2020_acc_nom"]),

    # ---------------- Pancreatitis ----------------
    _t("tip_panc_diagnosis_cause", PANC, "workup",
       "Two of three makes the diagnosis: typical pain, lipase or amylase above three times the upper limit, or imaging; then find the cause and do not blame alcohol just because the patient drinks.",
       "Üçte iki tanıyı koyar: tipik ağrı, üst sınırın üç katını aşan lipaz veya amilaz ya da görüntüleme; sonra nedeni bulun ve hasta içiyor diye alkolü suçlamayın.",
       "Skipping the gallstone ultrasound in a drinker.",
       "Alkol kullanan hastada safra taşı ultrasonunu atlamak.",
       "Lipase at presentation; cause within the admission", ["gs_wses2019_panc_diagnosis", "gs_nice_ng104_panc_cause"]),
    _t("tip_panc_no_abx_feed", PANC, "treatment",
       "No prophylactic antibiotics, no routine nil-by-mouth, and enteral nutrition within 72 hours for moderately severe or severe disease.",
       "Profilaktik antibiyotik yok, rutin ağızdan beslenme kesme yok ve orta-ağır veya ağır hastalıkta 72 saat içinde enteral beslenme.",
       "Starting 'cover' antibiotics for a fever that is the pancreatitis itself.",
       "Pankreatitin kendisine ait ateş için 'koruyucu' antibiyotik başlamak.",
       "Feed within 72 hours", ["gs_nice_ng104_panc_abx_nutrition"]),

    # ---------------- Upper GI bleed ----------------
    _t("tip_ugib_scores", UGIB, "triage",
       "Blatchford at first assessment, full Rockall after endoscopy; a pre-endoscopy Blatchford of 0 is a candidate for early discharge.",
       "İlk değerlendirmede Blatchford, endoskopi sonrasında tam Rockall; endoskopi öncesi Blatchford 0 erken taburculuk adayıdır.",
       "Admitting a Blatchford 0 overnight 'to be safe'.",
       "Blatchford 0 hastayı 'emin olmak için' gece yatırmak.",
       "At first assessment", ["gs_nice_cg141_scores"]),
    _t("tip_ugib_transfusion_ppi", UGIB, "treatment",
       "Massive bleeding gets blood, platelets and clotting factors by protocol, judged on the whole picture because over-transfusion harms too; do not give a PPI before endoscopy for suspected non-variceal bleeding.",
       "Masif kanamada protokole göre kan, trombosit ve koagülasyon faktörleri; aşırı transfüzyon da zarar verdiği için bütün tabloya göre karar verin; şüpheli varis dışı kanamada endoskopi öncesi PPİ vermeyin.",
       "Transfusing to a number rather than to the patient.",
       "Hastaya değil sayıya transfüzyon yapmak.",
       "Resuscitate first", ["gs_nice_cg141_transfusion_ppi"]),
    _t("tip_ugib_variceal", ["I85.01", "K92.2"], "treatment",
       "Suspected variceal bleeding: terlipressin at presentation, stopped at definitive haemostasis or after 5 days.",
       "Şüpheli varis kanaması: başvuruda terlipressin; kesin hemostazda veya 5 gün sonra kesin.",
       "Waiting for endoscopy to confirm varices before starting the vasoactive drug.",
       "Vazoaktif ilaca başlamadan önce varisleri doğrulamak için endoskopiyi beklemek.",
       "At presentation", ["gs_nice_cg141_terlipressin"]),
    _t("tip_ugib_endoscopy_timing", UGIB, "disposition",
       "Unstable with severe bleeding: endoscopy immediately after resuscitation; everyone else within 24 hours of admission.",
       "Ağır kanamalı instabil hasta: resüsitasyondan hemen sonra endoskopi; diğer herkes yatıştan sonraki 24 saat içinde.",
       "Letting an unstable bleeder wait for the morning list.",
       "İnstabil kanayan hastayı sabah listesine bekletmek.",
       "Immediately if unstable; within 24 hours otherwise", ["gs_nice_cg141_endoscopy_timing"]),

    # ---------------- AKI / hyperkalaemia ----------------
    _t("tip_aki_detect", AKI, "workup",
       "In any acutely ill adult with a risk factor (CKD, heart or liver failure, diabetes, hypovolaemia, nephrotoxic drugs, contrast, obstruction, sepsis, age 65 or over) check the creatinine against baseline, dipstick the urine, and ultrasound within 6 hours if pyonephrosis is possible or within 24 hours if the cause is unclear.",
       "Risk faktörü olan (KBH, kalp veya karaciğer yetersizliği, diyabet, hipovolemi, nefrotoksik ilaç, kontrast, obstrüksiyon, sepsis, 65 yaş ve üzeri) her akut hasta erişkinde kreatinini bazalle karşılaştırın, idrar çubuğu bakın ve piyonefroz olasıysa 6 saat, neden belirsizse 24 saat içinde ultrason yapın.",
       "Calling a creatinine 'normal' without knowing the patient's baseline.",
       "Hastanın bazalini bilmeden kreatinini 'normal' saymak.",
       "Dipstick now; ultrasound within 6 to 24 hours", ["gs_nice_ng148_detect", "gs_nice_ng148_urinalysis_us"]),
    _t("tip_hyperk_ecg_monitor", HYPK, "workup",
       "Potassium 6.0 or more: urgent 12-lead ECG now; 6.5 or more, or any ECG change, means continuous monitoring. Use the point-of-care gas while the lab result is pending.",
       "Potasyum 6,0 ve üzeri: hemen acil 12 derivasyonlu EKG; 6,5 ve üzeri veya herhangi bir EKG değişikliği sürekli izlem gerektirir. Laboratuvar sonucu beklenirken hasta başı kan gazını kullanın.",
       "Repeating the venous sample to 'exclude haemolysis' before treating a patient with ECG changes.",
       "EKG değişikliği olan hastayı tedavi etmeden önce 'hemolizi dışlamak' için venöz örneği tekrarlamak.",
       "ECG within minutes", ["gs_ukka_hyperk_ecg_monitoring", "gs_ukka_hyperk_poc"]),
    _t("tip_hyperk_treat", HYPK, "treatment",
       "ECG changes: intravenous calcium (6.8 mmol) first to protect the heart, then shift potassium with insulin-glucose (10 units in 25 g) and nebulised salbutamol 10 to 20 mg; salbutamol is never the only treatment.",
       "EKG değişiklikleri: önce kalbi korumak için intravenöz kalsiyum (6,8 mmol), ardından insülin-glukoz (25 g içinde 10 ünite) ve 10-20 mg nebülize salbutamol ile potasyumu kaydırın; salbutamol asla tek tedavi değildir.",
       "Forgetting to check and recheck glucose after the insulin.",
       "İnsülinden sonra glukozu kontrol etmeyi ve yeniden kontrol etmeyi unutmak.",
       "Calcium within minutes of the ECG", ["gs_ukka_hyperk_calcium", "gs_ukka_hyperk_insulin_salbutamol"]),
    _t("tip_aki_rrt", AKI + ["E87.5"], "disposition",
       "Hyperkalaemia, acidosis, uraemic complications, fluid overload or pulmonary oedema that do not respond to medical treatment mean an immediate referral for renal replacement; decide on the whole patient, not an isolated number.",
       "Medikal tedaviye yanıt vermeyen hiperkalemi, asidoz, üremik komplikasyonlar, sıvı yüklenmesi veya pulmoner ödem hemen renal replasman için sevk anlamına gelir; tek bir sayıya değil hastanın bütününe göre karar verin.",
       "Delaying the call because 'the potassium came down a bit'.",
       "'Potasyum biraz düştü' diye çağrıyı geciktirmek.",
       "Immediately when refractory", ["gs_nice_ng148_rrt"]),

    # ---------------- Paracetamol overdose ----------------
    _t("tip_para_nomogram", PARA, "workup",
       "Take a timed paracetamol level at or after 4 hours and plot it on the single treatment line (100 mg/L at 4 h to 15 mg/L at 15 h); on or above the line means acetylcysteine regardless of risk factors.",
       "4. saatte veya sonrasında zamanlı parasetamol düzeyi alıp tek tedavi çizgisine (4. saatte 100 mg/L, 15. saatte 15 mg/L) işaretleyin; çizgi üzerinde veya üstündeyse risk faktörlerinden bağımsız asetilsistein.",
       "Sending the level before 4 hours and acting on it.",
       "Düzeyi 4 saatten önce gönderip ona göre hareket etmek.",
       "Level at 4 hours post-ingestion", ["gs_mhra2012_paracetamol_nomogram"]),
    _t("tip_para_staggered", PARA, "treatment",
       "Staggered ingestion or uncertain timing: start acetylcysteine now and do not use the nomogram; given within 8 hours it is almost completely protective.",
       "Kademeli alım veya belirsiz zamanlama: asetilsisteini hemen başlayın ve nomogramı kullanmayın; 8 saat içinde verildiğinde neredeyse tamamen koruyucudur.",
       "Waiting for a level that cannot be interpreted.",
       "Yorumlanamayacak bir düzeyi beklemek.",
       "Now; protective window 8 hours", ["gs_mhra2012_paracetamol_staggered"]),
    _t("tip_para_infusion", PARA, "treatment",
       "Run the first acetylcysteine bag over 60 minutes to limit dose-related reactions; a previous reaction is not a contraindication.",
       "Doza bağlı reaksiyonları sınırlamak için ilk asetilsistein torbasını 60 dakikada verin; önceki bir reaksiyon kontrendikasyon değildir.",
       "Stopping treatment for a mild flushing reaction instead of slowing it.",
       "Hafif kızarma reaksiyonunda infüzyonu yavaşlatmak yerine tedaviyi kesmek.",
       "First bag over 60 min", ["gs_mhra2012_paracetamol_infusion"]),

    # ---------------- Opioid overdose ----------------
    _t("tip_opioid_recognise", OPI, "triage",
       "Pinpoint pupils, unconsciousness and slow or absent breathing are the opioid triad: open the airway and support ventilation first, then naloxone.",
       "İğne ucu pupiller, bilinç kaybı ve yavaş ya da olmayan solunum opioid üçlüsüdür: önce hava yolunu açıp ventilasyonu destekleyin, sonra nalokson.",
       "Treating a reduced GCS as 'just drunk' without looking at the pupils and the respiratory rate.",
       "Pupillere ve solunum sayısına bakmadan düşük GKS'yi 'sadece sarhoş' saymak.",
       "Airway and breathing first", ["gs_who_opioid_signs", "gs_who_opioid_naloxone_bls"]),
    _t("tip_opioid_naloxone", OPI, "treatment",
       "Naloxone with basic life support reverses the overdose if given in time and does essentially nothing in someone who has not taken an opioid, so when in doubt, give it.",
       "Temel yaşam desteğiyle birlikte nalokson zamanında verildiğinde aşırı dozu geri çevirir ve opioid almamış kişide neredeyse hiçbir şey yapmaz; şüphede kaldığınızda verin.",
       "Expecting a single dose to last; the opioid often outlives the naloxone.",
       "Tek dozun yeteceğini beklemek; opioid çoğu zaman naloksondan uzun sürer.",
       "Immediately; observe for re-sedation", ["gs_who_opioid_naloxone_bls"]),

    # ---------------- Status epilepticus ----------------
    _t("tip_se_first_line", SE, "treatment",
       "A convulsive seizure at 5 minutes is status: resuscitate and give a benzodiazepine now, intravenous lorazepam in hospital, buccal midazolam or rectal diazepam without IV access.",
       "5 dakikayı geçen konvülsif nöbet statustur: resüsite edin ve hemen benzodiazepin verin; hastanede intravenöz lorazepam, IV erişim yoksa bukkal midazolam veya rektal diazepam.",
       "Waiting for the 'classic' 30 minutes before treating.",
       "Tedavi etmeden önce 'klasik' 30 dakikayı beklemek.",
       "At 5 minutes", ["gs_nice_ng217_se_firstline"]),
    _t("tip_se_second_line", SE, "treatment",
       "No response within 5 to 10 minutes: second benzodiazepine dose; after two doses move to intravenous levetiracetam, phenytoin or valproate, with levetiracetam quicker to give and better tolerated.",
       "5-10 dakikada yanıt yoksa ikinci benzodiazepin dozu; iki dozdan sonra intravenöz levetirasetam, fenitoin veya valproata geçin; levetirasetam daha hızlı verilir ve daha iyi tolere edilir.",
       "Giving a third and fourth benzodiazepine instead of escalating.",
       "Eskalasyon yerine üçüncü ve dördüncü benzodiazepin vermek.",
       "Second dose at 5 to 10 min; second line after 2 doses", ["gs_nice_ng217_se_secondline"]),
    _t("tip_se_causes", SE, "workup",
       "While treating, hunt the cause: glucose, eclampsia in pregnancy, alcohol withdrawal and missed antiseizure medication; if two second-line agents fail, phenobarbital or general anaesthesia under expert guidance.",
       "Tedavi ederken nedeni arayın: glukoz, gebelikte eklampsi, alkol yoksunluğu ve atlanan antinöbet ilaçları; iki ikinci basamak ajan başarısız olursa uzman rehberliğinde fenobarbital veya genel anestezi.",
       "Forgetting the bedside glucose in the rush to the drug chart.",
       "İlaç kartına koşarken yatak başı glukozu unutmak.",
       "Glucose immediately", ["gs_nice_ng217_se_causes"]),

    # ---------------- Postpartum haemorrhage ----------------
    _t("tip_pph_recognise", PPH, "triage",
       "500 ml or more from the genital tract within 24 hours of birth is a PPH and more than 1000 ml is major: call for help the moment you recognise it.",
       "Doğumdan sonraki 24 saat içinde genital kanaldan 500 ml ve üzeri kanama PPH'dir, 1000 ml'den fazlası majördür: tanıdığınız anda yardım çağırın.",
       "Underestimating visible loss and waiting for the blood pressure to fall.",
       "Görünen kaybı hafife alıp kan basıncının düşmesini beklemek.",
       "Call for help immediately", ["gs_rcog_gtg52_pph_definition", "gs_nice_ng235_pph_immediate"]),
    _t("tip_pph_immediate", PPH, "treatment",
       "Immediate treatment in parallel: empty the bladder, massage the uterus, give uterotonics and IV fluids, deliver the placenta with controlled cord traction, and keep assessing blood loss while you look for the source.",
       "Eş zamanlı hemen tedavi: mesaneyi boşaltın, uterusa masaj yapın, uterotonik ve IV sıvı verin, plasentayı kontrollü kord traksiyonuyla doğurtun ve kaynağı ararken kan kaybını değerlendirmeye devam edin.",
       "Fixating on atony and missing a tear or retained tissue.",
       "Atoniye odaklanıp yırtığı veya kalan dokuyu kaçırmak.",
       "Within minutes", ["gs_nice_ng235_pph_immediate"]),
    _t("tip_pph_txa_uterotonics", PPH, "treatment",
       "Add tranexamic acid 1 g IV over 10 minutes (repeat after 30 minutes if bleeding continues) to the uterotonic ladder: oxytocin plus ergometrine or an oxytocin infusion, carboprost every 15 minutes up to 8 doses, or misoprostol 800 micrograms.",
       "Uterotonik basamaklarına (oksitosin ve ergometrin veya oksitosin infüzyonu, 15 dakikada bir en fazla 8 doz karboprost ya da 800 mikrogram misoprostol) 10 dakikada IV 1 g traneksamik asit ekleyin; kanama sürerse 30 dakika sonra tekrarlayın.",
       "Giving ergometrine to a woman with pre-eclampsia.",
       "Preeklampsili kadına ergometrin vermek.",
       "TXA with the first uterotonic", ["gs_nice_ng235_pph_txa", "gs_nice_ng235_pph_uterotonics"]),

    # ---------------- Ectopic pregnancy ----------------
    _t("tip_ectopic_test", ECT, "history",
       "Every woman of reproductive age with abdominal or pelvic symptoms gets a pregnancy test, even when the symptoms look gastrointestinal or urinary; shoulder tip pain, dizziness or syncope with a positive test are ectopic until proven otherwise.",
       "Karın veya pelvik semptomu olan üreme çağındaki her kadına, semptomlar gastrointestinal veya üriner görünse bile gebelik testi yapın; pozitif testle birlikte omuz ucu ağrısı, baş dönmesi veya senkop aksi kanıtlanana kadar ektopiktir.",
       "Accepting 'I can't be pregnant' without a test.",
       "'Gebe olamam' ifadesini test yapmadan kabul etmek.",
       "At triage", ["gs_nice_ng126_ectopic_pregnancy_test", "gs_nice_ng126_ectopic_symptoms"]),
    _t("tip_ectopic_refer", ECT, "disposition",
       "Haemodynamically unstable or significant pain or bleeding: resuscitation area now; a positive test with abdominal, pelvic or cervical motion tenderness goes immediately to the early pregnancy assessment service.",
       "Hemodinamik olarak instabil veya anlamlı ağrı ya da kanama: hemen resüsitasyon alanı; karın, pelvik veya servikal hareket hassasiyetiyle pozitif test hemen erken gebelik değerlendirme servisine.",
       "Sending a tender, pregnant patient home with a next-week scan.",
       "Hassas, gebe hastayı gelecek haftaya tarama ile eve göndermek.",
       "Immediately", ["gs_nice_ng126_ectopic_refer"]),
    _t("tip_ectopic_management", ECT, "treatment",
       "Methotrexate suits the pain-free woman with an unruptured ectopic under 35 mm, no heartbeat, hCG below 1,500 IU/L, no intrauterine pregnancy and reliable follow-up; otherwise surgery, laparoscopic whenever possible.",
       "Metotreksat, ağrısız, 35 mm'den küçük rüptüre olmamış ektopiği olan, kalp atımı görülmeyen, hCG 1.500 IU/L altında, intrauterin gebeliği olmayan ve güvenilir izlem yapılabilen kadına uygundur; aksi halde cerrahi, mümkün olduğunda laparoskopik.",
       "Giving methotrexate before a viable intrauterine pregnancy is excluded.",
       "Canlı intrauterin gebelik dışlanmadan metotreksat vermek.",
       "After definitive diagnosis", ["gs_nice_ng126_ectopic_methotrexate"]),

    # ---------------- Panic / psychiatric emergency ----------------
    _t("tip_panic_ed", PANIC + ["R07.4"], "workup",
       "A panic attack in the department: ask whether the person is already in treatment, do the minimum investigations needed to exclude an acute physical cause, avoid admission as a rule, and arrange primary care follow-up.",
       "Acil serviste panik atak: kişinin zaten tedavi alıp almadığını sorun, akut fiziksel nedeni dışlamak için gereken en az tetkiki yapın, kural olarak yatıştan kaçının ve birinci basamak izlemi düzenleyin.",
       "A full cardiac work-up every visit, or the opposite: dismissing chest pain in a known panic patient.",
       "Her başvuruda tam kardiyak tetkik ya da tersi: bilinen panik hastasında göğüs ağrısını önemsememek.",
       "Minimum necessary investigations", ["gs_nice_cg113_panic_ae"]),
    _t("tip_panic_no_benzo", PANIC + ["R07.4"], "treatment",
       "Do not prescribe benzodiazepines, sedating antihistamines or antipsychotics for panic disorder; in young, female or coronary-free patients with chest pain, panic is the likelier cause, but exclude the physical problem first.",
       "Panik bozukluğu için benzodiazepin, sedatif antihistaminik veya antipsikotik reçete etmeyin; göğüs ağrılı genç, kadın veya koroner hastalığı olmayan hastalarda panik daha olası nedendir, ancak önce fiziksel sorunu dışlayın.",
       "A 'take-home' benzodiazepine that worsens the long-term outcome.",
       "Uzun dönem sonucu kötüleştiren 'eve götür' benzodiazepin.",
       "At discharge", ["gs_nice_cg113_panic_benzo", "gs_nice_cg113_panic_chest_pain"]),
    _t("tip_selfharm_initial", SH, "triage",
       "After self-harm establish quickly: how urgent the medical treatment is, the person's mental state and distress, immediate safety, safeguarding, the nursing observation level and whether specialist mental health assessment is needed.",
       "Kendine zarar vermeden sonra hızla belirleyin: tıbbi tedavinin aciliyeti, kişinin ruhsal durumu ve sıkıntısı, acil güvenlik, koruma gereksinimi, hemşirelik gözlem düzeyi ve uzman ruh sağlığı değerlendirmesi gereksinimi.",
       "Leaving the person alone in a waiting area out of sight of staff.",
       "Kişiyi personelin görüş alanı dışında bir bekleme alanında tek bırakmak.",
       "At arrival", ["gs_nice_ng225_selfharm_ed"]),
    _t("tip_selfharm_means_assessment", SH, "workup",
       "Ask about the means of self-harm and negotiate removing them; run the psychosocial assessment alongside the medical care rather than after it, and do not use risk scales to decide who is treated or discharged.",
       "Kendine zarar verme aracını sorun ve uzaklaştırılmasını görüşün; psikososyal değerlendirmeyi tıbbi bakımdan sonra değil onunla birlikte yürütün ve kimin tedavi edileceğine veya taburcu edileceğine risk ölçekleriyle karar vermeyin.",
       "Deferring the mental health assessment until the paracetamol level is back.",
       "Ruh sağlığı değerlendirmesini parasetamol düzeyi gelene kadar ertelemek.",
       "Concurrent with medical treatment", ["gs_nice_ng225_selfharm_means_concurrent", "gs_nice_ng225_selfharm_no_risk_tools"]),
    _t("tip_agitation_rt", AGIT, "treatment",
       "When de-escalation fails and rapid tranquillisation is needed, use IM lorazepam alone or IM haloperidol with promethazine; lorazepam alone if the person is antipsychotic-naive, has cardiovascular disease, a long QT or no ECG.",
       "Yumuşatma başarısız olup hızlı sakinleştirme gerektiğinde tek başına IM lorazepam veya IM haloperidol ile prometazin kullanın; kişi antipsikotik kullanmamışsa, kardiyovasküler hastalığı, uzun QT'si varsa veya EKG yoksa tek başına lorazepam.",
       "IM haloperidol in a patient nobody has put on a monitor or ECG.",
       "Monitöre veya EKG'ye bağlanmamış hastaya IM haloperidol.",
       "Only after de-escalation", ["gs_nice_ng10_rapid_tranq"]),
    _t("tip_agitation_monitor", AGIT, "disposition",
       "After rapid tranquillisation monitor pulse, blood pressure, respiratory rate, temperature, hydration and consciousness at least hourly, and every 15 minutes if the BNF maximum was exceeded or the person is sedated, intoxicated or physically unwell.",
       "Hızlı sakinleştirmeden sonra nabız, kan basıncı, solunum sayısı, ateş, hidrasyon ve bilinci en az saatte bir; BNF maksimumu aşılmışsa veya kişi sedatize, intoksike ya da fiziksel olarak hastaysa 15 dakikada bir izleyin.",
       "Sedating the patient and walking away.",
       "Hastayı sedatize edip uzaklaşmak.",
       "Hourly; every 15 min if high risk", ["gs_nice_ng10_rt_monitoring"]),

    # ---------------- Bacterial meningitis ----------------
    _t("tip_men_abx_1h", MEN, "treatment",
       "Suspected bacterial meningitis: antibiotics within 1 hour of arrival; take blood and do the lumbar puncture first only when it is safe and will not cause a meaningful delay.",
       "Şüpheli bakteriyel menenjit: varıştan sonraki 1 saat içinde antibiyotik; kan alma ve lomber ponksiyonu yalnızca güvenliyse ve anlamlı gecikmeye yol açmayacaksa önce yapın.",
       "Holding antibiotics for a CT or an LP slot.",
       "BT veya LP sırası için antibiyotiği bekletmek.",
       "Within 1 hour of arrival", ["gs_nice_ng240_abx_1h"]),
    _t("tip_men_lp_imaging", MEN, "workup",
       "No routine CT before lumbar puncture, but image first (and defer the LP) for new focal signs, abnormal pupils, GCS 9 or less or a falling conscious level; bloods, antibiotics and stabilisation come before the scanner.",
       "Lomber ponksiyon öncesi rutin BT yok; ancak yeni fokal bulgular, anormal pupiller, GKS 9 veya altı ya da düşen bilinç düzeyinde önce görüntüleme yapın (LP'yi erteleyin); kan, antibiyotik ve stabilizasyon tomografiden önce gelir.",
       "A 'routine' CT that delays both the LP and the antibiotics.",
       "Hem LP'yi hem antibiyotiği geciktiren 'rutin' BT.",
       "Antibiotics before imaging", ["gs_nice_ng240_lp_imaging"]),
    _t("tip_men_dexamethasone", MEN, "treatment",
       "Give intravenous dexamethasone with the antibiotics in strongly suspected or confirmed bacterial meningitis over 3 months of age; continue only for pneumococcus or Haemophilus influenzae type b.",
       "3 aylıktan büyük kuvvetle şüphelenilen veya doğrulanmış bakteriyel menenjitte antibiyotiklerle birlikte intravenöz deksametazon verin; yalnızca pnömokok veya Haemophilus influenzae tip b'de devam edin.",
       "Continuing steroids for weeks after a meningococcal diagnosis.",
       "Meningokok tanısından sonra haftalarca steroide devam etmek.",
       "With the first antibiotic dose", ["gs_nice_ng240_dexamethasone"]),

    # ---------------- Alcohol withdrawal ----------------
    _t("tip_alc_symptom_triggered", ALC, "treatment",
       "In a monitored setting treat withdrawal with a symptom-triggered benzodiazepine regimen; delirium tremens gets oral lorazepam first line, and phenytoin has no place for withdrawal seizures.",
       "İzlemli ortamda yoksunluğu semptom tetiklemeli benzodiazepin rejimiyle tedavi edin; deliryum tremense birinci basamak oral lorazepam verilir ve yoksunluk nöbetlerinde fenitoinin yeri yoktur.",
       "A fixed taper that over-sedates one patient and under-treats the next.",
       "Bir hastayı aşırı sedatize edip diğerini yetersiz tedavi eden sabit azaltma şeması.",
       "Score and dose regularly", ["gs_nice_cg100_symptom_triggered"]),
    _t("tip_alc_thiamine", ALC, "treatment",
       "Suspect Wernicke's in any intoxicated or malnourished drinker and give parenteral thiamine for at least 5 days unless it is excluded.",
       "İntoksike veya malnütre her içicide Wernicke'yi düşünün ve dışlanmadıkça en az 5 gün parenteral tiamin verin.",
       "Glucose-containing fluids before the thiamine.",
       "Tiaminden önce glukozlu sıvılar.",
       "Before any carbohydrate load", ["gs_nice_cg100_thiamine"]),

    # ---------------- Other infections / renal ----------------
    _t("tip_neutropenic_sepsis", ["D70.9"], "treatment",
       "A febrile patient on anticancer treatment is neutropenic sepsis until the count says otherwise: empiric piperacillin-tazobactam immediately, with FBC, renal and liver function, CRP, lactate and cultures.",
       "Antikanser tedavi alan ateşli hasta, sayım aksini söyleyene kadar nötropenik sepsistir: hemen ampirik piperasilin-tazobaktam ile tam kan sayımı, böbrek ve karaciğer fonksiyonu, CRP, laktat ve kültürler.",
       "Waiting for the neutrophil count before the first dose.",
       "İlk dozdan önce nötrofil sayısını beklemek.",
       "Immediately", ["gs_nice_cg151_neutropenic"]),
    _t("tip_pyelo_msu", ["N10", "N39.0"], "workup",
       "Send a midstream urine for culture before the first antibiotic and choose the agent on severity, complication risk and previous culture and antibiotic history; review when the result lands.",
       "İlk antibiyotikten önce orta akım idrarı kültüre gönderin ve ajanı şiddete, komplikasyon riskine ve önceki kültür ile antibiyotik öyküsüne göre seçin; sonuç geldiğinde gözden geçirin.",
       "Treating a dipstick in a catheterised patient as an infection.",
       "Kateterli hastada idrar çubuğu bulgusunu enfeksiyon olarak tedavi etmek.",
       "Culture before antibiotics", ["gs_nice_ng111_msu"]),
    _t("tip_cellulitis_mark", ["L03.90", "L03.115"], "treatment",
       "Draw round the erythema with a single-use marker before the first dose so progress is measurable, remembering redness shows poorly on darker skin; flucloxacillin is first choice for adults.",
       "İlerlemenin ölçülebilmesi için ilk dozdan önce eritemin sınırını tek kullanımlık kalemle çizin; kızarıklığın koyu tende zor görüldüğünü unutmayın; erişkinde ilk tercih flukloksasilindir.",
       "Calling bilateral leg redness cellulitis; it is almost always something else.",
       "İki taraflı bacak kızarıklığına selülit demek; neredeyse her zaman başka bir şeydir.",
       "Mark before the first dose", ["gs_nice_ng141_marker"]),
    _t("tip_renal_colic", ["N23", "N20.0", "N20.1"], "workup",
       "Suspected renal colic: low-dose non-contrast CT within 24 hours (ultrasound if pregnant), an NSAID by any route first, IV paracetamol if NSAIDs are unsuitable, and no antispasmodics.",
       "Şüpheli renal kolik: 24 saat içinde düşük doz kontrastsız BT (gebeyse ultrason), önce herhangi bir yoldan NSAİİ, NSAİİ uygun değilse IV parasetamol ve antispazmodik yok.",
       "Missing a leaking aortic aneurysm in an older patient labelled 'first renal colic'.",
       "'İlk renal kolik' etiketli yaşlı hastada sızdıran aort anevrizmasını kaçırmak.",
       "CT within 24 hours", ["gs_nice_ng118_ct_nsaid"]),

    # ---------------- Febrile families (acceptance 2026-10-20, D-24) ----------------
    _t("tip_neutropenic_workup", ["D70.9"], "workup",
       "Fever after chemotherapy: the first antibiotic dose does not wait for the full blood count; draw FBC, renal and liver function, CRP, lactate and blood cultures with the cannula and give the antibiotic straight after.",
       "Kemoterapi sonrası ateş: ilk antibiyotik dozu tam kan sayımını beklemez; kanül takarken tam kan sayımı, böbrek ve karaciğer fonksiyonu, CRP, laktat ve kan kültürünü alın ve antibiyotiği hemen ardından verin.",
       "Ordering the bloods and then waiting for the neutrophil count to decide.",
       "Kanları isteyip karar vermek için nötrofil sayısını beklemek.",
       "Antibiotics immediately", ["gs_nice_cg151_neutropenic"]),
    _t("tip_malaria_smears", ["B54", "B50.9"], "workup",
       "Fever after travel to a malaria area is malaria until three blood films say otherwise: send thick and thin films with a rapid diagnostic test now, and repeat the films every 12 to 24 hours if the first set is negative.",
       "Sıtma bölgesine seyahat sonrası ateş, üç kan yayması aksini gösterene kadar sıtmadır: hemen kalın ve ince yayma ile hızlı tanı testi gönderin; ilk set negatifse yaymaları 12-24 saatte bir tekrarlayın.",
       "Accepting a single negative film, or an RDT without a film.",
       "Tek negatif yaymayla veya yaymasız bir hızlı testle yetinmek.",
       "Films now, repeat every 12 to 24 h", ["gs_cdc_malaria_smears"]),
    _t("tip_malaria_severe", ["B54", "B50.9", "B50.0"], "treatment",
       "Any sign of severe malaria (impaired consciousness, acidosis, shock, high parasitaemia, renal failure) means intravenous artesunate now, whatever the species, then a full oral follow-on course once the patient can swallow and parasitaemia is below 1 percent.",
       "Ağır sıtmanın herhangi bir bulgusu (bilinç bozukluğu, asidoz, şok, yüksek parazitemi, böbrek yetmezliği) türden bağımsız olarak hemen intravenöz artesunat demektir; hasta yutabildiğinde ve parazitemi yüzde 1'in altına indiğinde tam oral idame kürü verilir.",
       "Starting oral treatment in a patient who is already drowsy.",
       "Zaten uykuya meyilli hastada oral tedaviye başlamak.",
       "Immediately once severe", ["gs_cdc_malaria_severe_artesunate"]),
    _t("tip_sepsis_source_control", ["A41.9", "R65.21", "R65.20", "K83.09", "M00.9", "N73.9", "M72.6", "N41.0"], "treatment",
       "Antibiotics treat the bacteraemia, not the pus: look for an obstructed duct, a collection, an infected joint or necrotic tissue and arrange drainage or debridement early, ideally within 6 hours.",
       "Antibiyotikler bakteriyemiyi tedavi eder, irini değil: tıkalı kanal, koleksiyon, enfekte eklem veya nekrotik doku arayın ve drenaj ya da debridmanı erken, ideal olarak 6 saat içinde planlayın.",
       "Escalating antibiotics in a patient whose source has never been drained.",
       "Kaynağı hiç drene edilmemiş hastada antibiyotiği tırmandırmak.",
       "Within 6 hours", ["gs_ssc21_source_control"]),
    _t("tip_prostatitis_msu", ["N41.0"], "workup",
       "Acute prostatitis: midstream urine for culture before the first antibiotic, and admit if there are signs of sepsis, retention or an abscess.",
       "Akut prostatit: ilk antibiyotikten önce kültür için orta akım idrarı alın; sepsis, retansiyon veya apse bulgusu varsa yatırın.",
       "Vigorous prostatic massage to obtain a specimen.",
       "Örnek almak için kuvvetli prostat masajı.",
       "Culture before antibiotics", ["gs_nice_ng110_abx_msu", "gs_nice_ng110_refer"]),
    _t("tip_pid_criteria", ["N73.9", "N70.93"], "exam",
       "Pelvic or lower abdominal pain with cervical motion, uterine or adnexal tenderness is enough to start PID treatment once pregnancy and surgical causes are considered; do not wait for swabs.",
       "Gebelik ve cerrahi nedenler düşünüldükten sonra servikal hareket, uterus veya adneksiyal hassasiyetle birlikte pelvik veya alt karın ağrısı PİH tedavisine başlamak için yeterlidir; sürüntü sonuçlarını beklemeyin.",
       "Missing an ectopic pregnancy because no pregnancy test was sent.",
       "Gebelik testi gönderilmediği için ektopik gebeliği kaçırmak.",
       "Treat on clinical criteria", ["gs_cdc_pid_minimum_criteria"]),
    _t("tip_flu_antiviral", ["J10.1", "J11.1"], "treatment",
       "A patient admitted with suspected influenza gets oseltamivir as soon as possible; the 48-hour window applies to well outpatients, not to the sick or the high risk.",
       "Şüpheli influenzayla yatırılan hastaya mümkün olan en kısa sürede oseltamivir verilir; 48 saatlik pencere hasta veya yüksek riskli kişiler için değil, iyi durumdaki ayaktan hastalar için geçerlidir.",
       "Withholding the antiviral because symptoms began three days ago.",
       "Belirtiler üç gün önce başladı diye antivirali vermemek.",
       "As soon as possible", ["gs_cdc_flu_oseltamivir"]),
    _t("tip_covid_steroid_no_abx", ["U07.1"], "treatment",
       "COVID-19 needing oxygen: dexamethasone 6 mg daily; antibiotics only when a bacterial co-infection is actually suspected, never as routine cover for viral pneumonia.",
       "Oksijen gereken COVID-19: günde 6 mg deksametazon; antibiyotik yalnızca bakteriyel ko-enfeksiyondan gerçekten şüpheleniliyorsa, viral pnömoni için asla rutin koruma olarak verilmez.",
       "Steroids for a patient who is not hypoxic.",
       "Hipoksik olmayan hastaya steroid.",
       "Once oxygen is needed", ["gs_nice_ng191_dexamethasone", "gs_nice_ng191_no_antibiotics"]),
]


# ---------------------------------------------------------------------------
# Joins
# ---------------------------------------------------------------------------

def all_tips() -> List[AttendingTip]:
    return list(TIPS)


def referenced_statement_ids(tips: Iterable[AttendingTip] = TIPS) -> Set[str]:
    return {sid for t in tips for sid in t.statement_ids}


def _matches_condition(tip: AttendingTip, codes: Sequence[str]) -> bool:
    return any(code_matches(c, tc) for c in codes for tc in tip.condition_codes)


def list_tips(store: GuidelineStore, *, condition: Optional[str] = None, stage: Optional[str] = None,
              require_verified: bool = True) -> List[AttendingTip]:
    """Tips for a condition/stage whose EVERY linked statement is verified in ``store``."""
    codes = resolve_condition_codes(condition) if condition else []
    out: List[AttendingTip] = []
    verified_ids: Optional[Set[str]] = None
    if require_verified:
        verified_ids = {s.id for s in store.list(status="verified", ids=sorted(referenced_statement_ids()))}
    for tip in TIPS:
        if stage and tip.stage != stage:
            continue
        if codes and not _matches_condition(tip, codes):
            continue
        if verified_ids is not None and not set(tip.statement_ids) <= verified_ids:
            continue
        out.append(tip)
    return out


def statement_ids_for_stage(store: GuidelineStore, stage: str, *, condition: Optional[str] = None) -> Set[str]:
    """Statements a stage's tips are grounded in (used by GET /statements?stage=)."""
    return referenced_statement_ids(list_tips(store, condition=condition, stage=stage))


def tips_by_stage(tips: Iterable[AttendingTip]) -> Dict[str, List[AttendingTip]]:
    groups: Dict[str, List[AttendingTip]] = {s: [] for s in STAGES}
    for t in tips:
        groups[t.stage].append(t)
    return groups


# Catalogue coverage (2026-10-21): tips for the conditions that had none, grounded in
# server/guidelines/seed_catalog.py. Imported last because it builds on ``_t`` above.
from server.guidelines.tips_catalog import CATALOG_TIPS  # noqa: E402

TIPS.extend(CATALOG_TIPS)

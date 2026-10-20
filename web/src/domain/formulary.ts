/**
 * AcuDx — adult formulary for the treatment catalogue.
 *
 * Every agent a learner can administer carries its adult dose (default, range
 * and ceiling), permitted routes, frequency / minimum dosing interval, the
 * indication it is prescribed for, the allergy class used by the allergy
 * cross-check, and the guideline or formulary source for each number.
 *
 * Introduced for review 02 finding 9 (critical): medications were
 * "administered" by clicking a chip with no dose, route, allergy check or
 * administration record. Protocol rule 2 requires every clinical fact to carry
 * a resolving citation, so each entry lists its sources.
 *
 * Pure data + two lookups. Education only. No real patient data path.
 */

import type { Bilingual } from "@/data/schema";

/** Administration routes the formulary recognises. */
export type Route = "IV" | "IM" | "PO" | "SL" | "INH" | "NEB" | "SC" | "IO";

export const ROUTE_LABEL: Record<Route, Bilingual> = {
  IV: { en: "IV", tr: "İ.V." },
  IM: { en: "IM", tr: "İ.M." },
  PO: { en: "PO", tr: "Ağızdan" },
  SL: { en: "SL", tr: "Dilaltı" },
  INH: { en: "Inhaled", tr: "İnhalasyon" },
  NEB: { en: "Nebulised", tr: "Nebül" },
  SC: { en: "SC", tr: "S.C." },
  IO: { en: "IO", tr: "İ.O." },
};

export interface FormularySource {
  title: string;
  url: string;
}

export interface FormularyEntry {
  /** Treatment catalogue code (RxNorm or stable synthetic id). */
  code: string;
  drug: Bilingual;
  /**
   * Allergy class keywords matched (case-insensitively) against the patient's
   * documented allergies. Includes cross-reacting classes (penicillin for a
   * cephalosporin, NSAID for aspirin, opiates for morphine).
   */
  allergyClass: string[];
  /**
   * Allergy keywords that call for caution but do not block (a carbapenem in a
   * documented penicillin allergy: cross-reactivity under 1%).
   */
  allergyCaution?: string[];
  /** Therapeutic group used to suggest allergy-safe alternatives. */
  group?: "antibacterial" | "antiviral" | "antiparasitic";
  routes: Route[];
  defaultRoute: Route;
  dose: {
    default: number;
    min: number;
    max: number;
    unit: string;
    /** Weight-based dose (per kg) when the guideline expresses it that way. */
    perKg?: number;
    /**
     * The per-kg ceiling applies only below this weight (paracetamol: 15 mg/kg
     * under 50 kg). Unset means it applies at any weight.
     */
    perKgBelowKg?: number;
  };
  /** Maximum cumulative dose in 24 h (same unit), when the source states one. */
  maxPerDay?: number;
  /** Minimum interval between repeat doses in ms (the "right time" check). */
  minIntervalMs: number;
  frequency: Bilingual;
  indication: Bilingual;
  /** High-alert medication: independent double check expected (ISMP list). */
  highAlert?: boolean;
  sources: FormularySource[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;

const RCUK_ANAPHYLAXIS: FormularySource = {
  title: "Resuscitation Council UK — Emergency treatment of anaphylaxis (2021)",
  url: "https://www.resus.org.uk/library/additional-guidance/guidance-anaphylaxis/emergency-treatment",
};
const AHA_ACLS_2020: FormularySource = {
  title: "AHA 2020 Adult Advanced Cardiovascular Life Support",
  url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000916",
};
const ESC_ACS_2023: FormularySource = {
  title: "ESC 2023 Guidelines for the management of acute coronary syndromes",
  url: "https://doi.org/10.1093/eurheartj/ehad191",
};
const ACC_STEMI_2013: FormularySource = {
  title: "ACCF/AHA 2013 STEMI guideline (nitrate dosing and contraindications)",
  url: "https://www.ahajournals.org/doi/10.1161/CIR.0b013e3182742cf6",
};
const NICE_CG151: FormularySource = {
  title: "NICE CG151 Neutropenic sepsis",
  url: "https://www.nice.org.uk/guidance/cg151/chapter/Recommendations",
};
const NICE_NG250: FormularySource = {
  title: "NICE NG250 Pneumonia: diagnosis and management",
  url: "https://www.nice.org.uk/guidance/ng250/chapter/Recommendations",
};
const NICE_NG141: FormularySource = {
  title: "NICE NG141 Cellulitis and erysipelas: antimicrobial prescribing",
  url: "https://www.nice.org.uk/guidance/ng141/chapter/Recommendations",
};
const NICE_NG240: FormularySource = {
  title: "NICE NG240 Meningitis (bacterial) and meningococcal disease",
  url: "https://www.nice.org.uk/guidance/ng240/chapter/Recommendations",
};
const AAAAI_2022: FormularySource = {
  title: "AAAAI/ACAAI Drug allergy: a 2022 practice parameter update (carbapenems in penicillin allergy)",
  url: "https://doi.org/10.1016/j.jaci.2022.08.028",
};
const BNF = (drug: string, slug: string): FormularySource => ({
  title: `BNF — ${drug}`,
  url: `https://bnf.nice.org.uk/drugs/${slug}/`,
});

export const FORMULARY: FormularyEntry[] = [
  {
    code: "7806",
    drug: { en: "Oxygen", tr: "Oksijen" },
    allergyClass: [],
    routes: ["INH"],
    defaultRoute: "INH",
    dose: { default: 4, min: 1, max: 15, unit: "L/min" },
    minIntervalMs: 0,
    frequency: { en: "Continuous, titrated to target SpO2 94-98% (88-92% if at risk of hypercapnia)", tr: "Sürekli, hedef SpO2 %94-98'e titre (hiperkapni riski varsa %88-92)" },
    indication: { en: "Hypoxaemia", tr: "Hipoksemi" },
    sources: [{ title: "BTS guideline for oxygen use in adults (2017)", url: "https://doi.org/10.1136/thoraxjnl-2016-209729" }],
  },
  {
    code: "313002",
    drug: { en: "Crystalloid bolus (0.9% saline / lactated Ringer's)", tr: "Kristaloid bolus (%0.9 NaCl / laktatlı Ringer)" },
    allergyClass: [],
    routes: ["IV", "IO"],
    defaultRoute: "IV",
    dose: { default: 500, min: 250, max: 1000, unit: "mL" },
    maxPerDay: 6000,
    minIntervalMs: 10 * MIN,
    frequency: { en: "Bolus over 15 min, reassess after each", tr: "15 dakikada bolus, her bolustan sonra yeniden değerlendir" },
    indication: { en: "Hypovolaemia / hypotension (not pulmonary oedema or tamponade without hypovolaemia)", tr: "Hipovolemi / hipotansiyon (pulmoner ödem veya hipovolemi olmayan tamponadda değil)" },
    sources: [
      { title: "NICE CG174 Intravenous fluid therapy in adults in hospital", url: "https://www.nice.org.uk/guidance/cg174" },
      { title: "Surviving Sepsis Campaign 2021 (30 mL/kg for sepsis-induced hypoperfusion)", url: "https://doi.org/10.1007/s00134-021-06506-y" },
    ],
  },
  {
    code: "1191",
    drug: { en: "Aspirin", tr: "Aspirin" },
    allergyClass: ["aspirin", "salicylate", "nsaid", "ibuprofen", "non-steroidal"],
    routes: ["PO"],
    defaultRoute: "PO",
    dose: { default: 300, min: 150, max: 325, unit: "mg" },
    maxPerDay: 325,
    minIntervalMs: 24 * HOUR,
    frequency: { en: "Single loading dose (chewed)", tr: "Tek yükleme dozu (çiğnenerek)" },
    indication: { en: "Suspected acute coronary syndrome", tr: "Şüpheli akut koroner sendrom" },
    sources: [ESC_ACS_2023],
  },
  {
    code: "4917",
    drug: { en: "Glyceryl trinitrate (nitroglycerin)", tr: "Gliseril trinitrat (nitrogliserin)" },
    allergyClass: ["nitrate", "nitroglycerin", "glyceryl trinitrate"],
    routes: ["SL", "IV"],
    defaultRoute: "SL",
    dose: { default: 0.4, min: 0.3, max: 0.8, unit: "mg" },
    maxPerDay: 2.4,
    minIntervalMs: 5 * MIN,
    frequency: { en: "Every 5 min, up to 3 doses", tr: "5 dakikada bir, en fazla 3 doz" },
    indication: { en: "Ischaemic chest pain or acute pulmonary oedema with SBP >= 90 mmHg; not with PDE-5 inhibitor use, RV infarction, HR < 50 or > 100", tr: "SKB >= 90 mmHg ile iskemik göğüs ağrısı veya akut pulmoner ödem; PDE-5 inhibitörü, sağ ventrikül enfarktı, HR < 50 veya > 100 ile değil" },
    sources: [ACC_STEMI_2013, ESC_ACS_2023],
  },
  {
    code: "7052",
    drug: { en: "Morphine", tr: "Morfin" },
    allergyClass: ["morphine", "opioid", "opiate", "codeine", "diamorphine"],
    routes: ["IV", "IM", "SC"],
    defaultRoute: "IV",
    dose: { default: 2.5, min: 1, max: 10, unit: "mg" },
    maxPerDay: 40,
    minIntervalMs: 5 * MIN,
    frequency: { en: "Titrated every 5 min to effect; monitor RR and sedation", tr: "Etkiye göre 5 dakikada bir titre; SS ve sedasyonu izle" },
    indication: { en: "Severe acute pain", tr: "Şiddetli akut ağrı" },
    highAlert: true,
    sources: [BNF("Morphine", "morphine"), { title: "AHRQ PSNet — Medication administration errors (high-alert opioids)", url: "https://psnet.ahrq.gov/primer/medication-administration-errors" }],
  },
  {
    code: "2193",
    drug: { en: "Ceftriaxone", tr: "Seftriakson" },
    allergyClass: ["ceftriaxone", "cephalosporin", "penicillin", "beta-lactam", "amoxicillin"],
    routes: ["IV", "IM"],
    defaultRoute: "IV",
    dose: { default: 2000, min: 1000, max: 2000, unit: "mg" },
    maxPerDay: 4000,
    minIntervalMs: 12 * HOUR,
    frequency: { en: "Once daily (12-hourly for meningitis)", tr: "Günde bir kez (menenjitte 12 saatte bir)" },
    indication: { en: "Suspected bacterial sepsis, meningitis, pneumonia, pyelonephritis", tr: "Şüpheli bakteriyel sepsis, menenjit, pnömoni, piyelonefrit" },
    group: "antibacterial",
    sources: [BNF("Ceftriaxone", "ceftriaxone")],
  },
  {
    code: "435",
    drug: { en: "Salbutamol", tr: "Salbutamol" },
    allergyClass: ["salbutamol", "albuterol", "beta-agonist"],
    routes: ["NEB", "INH"],
    defaultRoute: "NEB",
    dose: { default: 5, min: 2.5, max: 5, unit: "mg" },
    minIntervalMs: 15 * MIN,
    frequency: { en: "Every 15-20 min (back-to-back) in acute severe asthma", tr: "Akut ağır astımda 15-20 dakikada bir (ardışık)" },
    indication: { en: "Acute bronchospasm (asthma, COPD exacerbation)", tr: "Akut bronkospazm (astım, KOAH alevlenmesi)" },
    sources: [BNF("Salbutamol", "salbutamol"), { title: "BTS/SIGN British guideline on the management of asthma", url: "https://www.brit-thoracic.org.uk/quality-improvement/guidelines/asthma/" }],
  },
  {
    code: "448",
    drug: { en: "Adenosine", tr: "Adenozin" },
    allergyClass: ["adenosine"],
    routes: ["IV"],
    defaultRoute: "IV",
    dose: { default: 6, min: 6, max: 12, unit: "mg" },
    maxPerDay: 30,
    minIntervalMs: 1 * MIN,
    frequency: { en: "Rapid IV push 6 mg, then 12 mg if no conversion after 1-2 min", tr: "Hızlı IV puşe 6 mg, 1-2 dakikada dönmezse 12 mg" },
    indication: { en: "Regular narrow-complex SVT after vagal manoeuvres", tr: "Vagal manevra sonrası düzenli dar QRS SVT" },
    sources: [AHA_ACLS_2020],
  },
  {
    code: "5856",
    drug: { en: "Insulin (soluble), fixed-rate infusion", tr: "İnsülin (regüler), sabit hızlı infüzyon" },
    allergyClass: ["insulin"],
    routes: ["IV", "SC"],
    defaultRoute: "IV",
    dose: { default: 0.1, min: 0.05, max: 0.1, unit: "units/kg/h", perKg: 0.1 },
    minIntervalMs: 60 * MIN,
    frequency: { en: "Continuous infusion after fluids; only once K >= 3.3 mmol/L", tr: "Sıvıdan sonra sürekli infüzyon; yalnızca K >= 3.3 mmol/L iken" },
    indication: { en: "Diabetic ketoacidosis / hyperosmolar hyperglycaemic state", tr: "Diyabetik ketoasidoz / hiperozmolar hiperglisemik durum" },
    highAlert: true,
    sources: [
      { title: "ADA/EASD 2024 consensus on hyperglycaemic crises in adults", url: "https://doi.org/10.2337/dci24-0032" },
      { title: "JBDS-IP 02 Management of DKA in adults", url: "https://abcd.care/resource/current/jbds-02-management-diabetic-ketoacidosis-adults" },
    ],
  },
  {
    code: "7242",
    drug: { en: "Naloxone", tr: "Nalokson" },
    allergyClass: ["naloxone"],
    routes: ["IV", "IM", "SC"],
    defaultRoute: "IV",
    dose: { default: 0.4, min: 0.04, max: 2, unit: "mg" },
    maxPerDay: 10,
    minIntervalMs: 2 * MIN,
    frequency: { en: "Titrated every 2-3 min to restore ventilation (small doses in opioid dependence)", tr: "Solunumu geri getirmek için 2-3 dakikada bir titre (bağımlıda küçük dozlar)" },
    indication: { en: "Opioid toxidrome with respiratory depression", tr: "Solunum depresyonuyla opioid toksidromu" },
    sources: [AHA_ACLS_2020, BNF("Naloxone hydrochloride", "naloxone-hydrochloride")],
  },
  {
    code: "6470",
    drug: { en: "Lorazepam", tr: "Lorazepam" },
    allergyClass: ["lorazepam", "benzodiazepine", "diazepam", "midazolam"],
    routes: ["IV", "IM"],
    defaultRoute: "IV",
    dose: { default: 4, min: 1, max: 4, unit: "mg", perKg: 0.1 },
    maxPerDay: 8,
    minIntervalMs: 5 * MIN,
    frequency: { en: "Once, repeat after 5-10 min if the seizure continues", tr: "Bir kez, nöbet sürerse 5-10 dakika sonra tekrar" },
    indication: { en: "Convulsive status epilepticus; acute severe agitation", tr: "Konvülzif status epileptikus; akut ağır ajitasyon" },
    highAlert: true,
    sources: [{ title: "NICE NG217 Epilepsies: diagnosis and management", url: "https://www.nice.org.uk/guidance/ng217" }],
  },
  {
    code: "161",
    drug: { en: "Paracetamol", tr: "Parasetamol" },
    allergyClass: ["paracetamol", "acetaminophen"],
    routes: ["PO", "IV"],
    // Review 02 finding 44: oral first line when the patient can swallow; IV
    // reserved for nil-by-mouth or vomiting. NICE CKS analgesia.
    defaultRoute: "PO",
    // Acceptance 2026-10-20: the 15 mg/kg ceiling applied at any weight and
    // blocked 1 g in a 60 kg adult; BNF and the frequency line: under 50 kg only.
    dose: { default: 1000, min: 500, max: 1000, unit: "mg", perKg: 15, perKgBelowKg: 50 },
    maxPerDay: 4000,
    minIntervalMs: 4 * HOUR,
    frequency: { en: "Every 4-6 h, maximum 4 g in 24 h (15 mg/kg if under 50 kg)", tr: "4-6 saatte bir, 24 saatte en fazla 4 g (50 kg altında 15 mg/kg)" },
    indication: { en: "Mild to moderate pain; fever", tr: "Hafif-orta ağrı; ateş" },
    sources: [{ title: "NICE CKS — Analgesia, mild-to-moderate pain", url: "https://cks.nice.org.uk/topics/analgesia-mild-to-moderate-pain/" }, BNF("Paracetamol", "paracetamol")],
  },
  {
    code: "26225",
    drug: { en: "Ondansetron", tr: "Ondansetron" },
    allergyClass: ["ondansetron", "5-ht3"],
    routes: ["IV", "PO", "IM"],
    defaultRoute: "IV",
    dose: { default: 4, min: 4, max: 8, unit: "mg" },
    maxPerDay: 16,
    minIntervalMs: 4 * HOUR,
    frequency: { en: "Every 4-8 h as needed", tr: "Gerektiğinde 4-8 saatte bir" },
    indication: { en: "Nausea and vomiting", tr: "Bulantı ve kusma" },
    sources: [BNF("Ondansetron", "ondansetron")],
  },
  {
    // Review 02 finding 7 (critical): first-line anaphylaxis treatment is IM
    // adrenaline 0.5 mg (adult) into the anterolateral thigh, repeated after
    // 5 min; IV adrenaline is for specialists in monitored settings.
    code: "3992-im",
    drug: { en: "Adrenaline 1 mg/mL (1:1000) IM", tr: "Adrenalin 1 mg/mL (1:1000) İ.M." },
    allergyClass: ["adrenaline", "epinephrine"],
    routes: ["IM"],
    defaultRoute: "IM",
    dose: { default: 0.5, min: 0.3, max: 0.5, unit: "mg" },
    minIntervalMs: 5 * MIN,
    frequency: { en: "Anterolateral thigh; repeat after 5 min if no improvement", tr: "Anterolateral uyluk; düzelme yoksa 5 dakika sonra tekrar" },
    indication: { en: "Anaphylaxis (first line)", tr: "Anafilaksi (birinci basamak)" },
    highAlert: true,
    sources: [RCUK_ANAPHYLAXIS],
  },
  {
    code: "3992",
    drug: { en: "Adrenaline IV (cardiac arrest bolus / refractory-anaphylaxis infusion)", tr: "Adrenalin İ.V. (kardiyak arrest bolus / dirençli anafilaksi infüzyonu)" },
    allergyClass: ["adrenaline", "epinephrine"],
    routes: ["IV", "IO"],
    defaultRoute: "IV",
    dose: { default: 1, min: 0.05, max: 1, unit: "mg" },
    minIntervalMs: 3 * MIN,
    frequency: { en: "1 mg every 3-5 min in cardiac arrest; low-dose infusion only for refractory anaphylaxis by an experienced clinician", tr: "Kardiyak arrestte 3-5 dakikada bir 1 mg; dirençli anafilakside yalnızca deneyimli klinisyen tarafından düşük doz infüzyon" },
    indication: { en: "Cardiac arrest; refractory anaphylaxis in a monitored setting", tr: "Kardiyak arrest; monitörlü ortamda dirençli anafilaksi" },
    highAlert: true,
    sources: [AHA_ACLS_2020, RCUK_ANAPHYLAXIS],
  },
  {
    code: "8410",
    drug: { en: "Alteplase", tr: "Alteplaz" },
    allergyClass: ["alteplase", "tenecteplase", "thrombolytic"],
    routes: ["IV"],
    defaultRoute: "IV",
    dose: { default: 0.9, min: 0.9, max: 0.9, unit: "mg/kg", perKg: 0.9 },
    maxPerDay: 90,
    minIntervalMs: 24 * HOUR,
    frequency: { en: "0.9 mg/kg (max 90 mg), 10% bolus then infusion over 60 min", tr: "0.9 mg/kg (en fazla 90 mg), %10 bolus ardından 60 dakikada infüzyon" },
    indication: { en: "Acute ischaemic stroke within 4.5 h with BP < 185/110 and glucose 2.8-22 mmol/L; high-risk pulmonary embolism", tr: "TA < 185/110 ve glukoz 2.8-22 mmol/L ile 4.5 saat içinde akut iskemik inme; yüksek riskli pulmoner emboli" },
    highAlert: true,
    sources: [
      { title: "AHA/ASA 2019 guidelines for the early management of acute ischemic stroke", url: "https://doi.org/10.1161/STR.0000000000000211" },
      { title: "ESC 2019 acute pulmonary embolism guideline", url: "https://doi.org/10.1093/eurheartj/ehz405" },
    ],
  },
  /* ------------------------------------------------------------------------ */
  /* Acceptance 2026-10-20 D-17 (critical): the formulary held one antibiotic  */
  /* (ceftriaxone), so a patient with a penicillin allergy could not be        */
  /* treated at all. Adult doses below are BNF doses unless stated.           */
  /* ------------------------------------------------------------------------ */
  {
    code: "pip-tazo",
    drug: { en: "Piperacillin-tazobactam", tr: "Piperasilin-tazobaktam" },
    allergyClass: ["piperacillin", "tazobactam", "penicillin", "beta-lactam", "amoxicillin", "cephalosporin"],
    routes: ["IV"],
    defaultRoute: "IV",
    dose: { default: 4500, min: 2250, max: 4500, unit: "mg" },
    maxPerDay: 18000,
    minIntervalMs: 6 * HOUR,
    frequency: { en: "4.5 g every 6-8 h", tr: "6-8 saatte bir 4,5 g" },
    indication: { en: "Sepsis of unknown source, neutropenic sepsis, biliary sepsis", tr: "Kaynağı bilinmeyen sepsis, nötropenik sepsis, biliyer sepsis" },
    group: "antibacterial",
    sources: [BNF("Piperacillin with tazobactam", "piperacillin-with-tazobactam"), NICE_CG151],
  },
  {
    code: "29561",
    drug: { en: "Meropenem", tr: "Meropenem" },
    // Carbapenems are a different class; cross-reactivity with a penicillin
    // allergy is under 1% and the 2022 AAAAI/ACAAI practice parameter suggests
    // giving them without testing. The cross-check flags a caution, not a block.
    allergyClass: ["meropenem", "carbapenem", "imipenem", "ertapenem"],
    allergyCaution: ["penicillin", "beta-lactam", "cephalosporin", "amoxicillin"],
    routes: ["IV"],
    defaultRoute: "IV",
    dose: { default: 1000, min: 500, max: 2000, unit: "mg" },
    maxPerDay: 6000,
    minIntervalMs: 8 * HOUR,
    frequency: { en: "1 g every 8 h (2 g every 8 h in meningitis)", tr: "8 saatte bir 1 g (menenjitte 8 saatte bir 2 g)" },
    indication: { en: "Severe sepsis or neutropenic sepsis when a penicillin cannot be used", tr: "Penisilin kullanılamadığında ağır sepsis veya nötropenik sepsis" },
    group: "antibacterial",
    sources: [BNF("Meropenem", "meropenem"), AAAAI_2022],
  },
  {
    code: "11124",
    drug: { en: "Vancomycin", tr: "Vankomisin" },
    allergyClass: ["vancomycin", "glycopeptide", "teicoplanin"],
    routes: ["IV"],
    defaultRoute: "IV",
    // ASHP/IDSA 2020: loading 20-35 mg/kg (actual body weight), maximum 3 g.
    dose: { default: 1500, min: 500, max: 3000, unit: "mg", perKg: 35 },
    minIntervalMs: 8 * HOUR,
    frequency: { en: "Loading 20-35 mg/kg, then 15-20 mg/kg every 8-12 h by levels (AUC-guided)", tr: "Yükleme 20-35 mg/kg, ardından düzeylere göre 8-12 saatte bir 15-20 mg/kg (EAA rehberli)" },
    indication: { en: "MRSA risk; beta-lactam anaphylaxis (with gentamicin for Gram-negative cover)", tr: "MRSA riski; beta-laktam anafilaksisi (Gram-negatif kapsam için gentamisinle)" },
    highAlert: true,
    group: "antibacterial",
    sources: [{ title: "ASHP/IDSA/PIDS/SIDP 2020 vancomycin therapeutic monitoring consensus", url: "https://doi.org/10.1093/ajhp/zxaa036" }, BNF("Vancomycin", "vancomycin")],
  },
  {
    code: "4413",
    drug: { en: "Gentamicin", tr: "Gentamisin" },
    allergyClass: ["gentamicin", "aminoglycoside", "tobramycin", "amikacin"],
    routes: ["IV", "IM"],
    defaultRoute: "IV",
    dose: { default: 5, min: 3, max: 7, unit: "mg/kg", perKg: 7 },
    minIntervalMs: 24 * HOUR,
    frequency: { en: "Once daily 5-7 mg/kg (ideal or adjusted body weight), later doses by level", tr: "Günde bir kez 5-7 mg/kg (ideal veya düzeltilmiş ağırlık), sonraki dozlar düzeye göre" },
    indication: { en: "Pyelonephritis or sepsis with Gram-negative risk; beta-lactam allergy", tr: "Gram-negatif riskli piyelonefrit veya sepsis; beta-laktam alerjisi" },
    highAlert: true,
    group: "antibacterial",
    sources: [{ title: "NICE NG111 Pyelonephritis (acute): antimicrobial prescribing", url: "https://www.nice.org.uk/guidance/ng111/chapter/Recommendations" }, BNF("Gentamicin", "gentamicin")],
  },
  {
    code: "82122",
    drug: { en: "Levofloxacin", tr: "Levofloksasin" },
    allergyClass: ["levofloxacin", "quinolone", "fluoroquinolone", "ciprofloxacin", "moxifloxacin"],
    routes: ["PO", "IV"],
    defaultRoute: "IV",
    dose: { default: 500, min: 250, max: 750, unit: "mg" },
    maxPerDay: 1000,
    minIntervalMs: 12 * HOUR,
    frequency: { en: "500 mg every 12 h (high-severity CAP) or once daily; MHRA 2024 fluoroquinolone restrictions apply", tr: "12 saatte bir 500 mg (yüksek ağırlıkta TKP) veya günde bir kez; MHRA 2024 florokinolon kısıtlamaları geçerli" },
    indication: { en: "Pneumonia, prostatitis or biliary sepsis when a penicillin cannot be used", tr: "Penisilin kullanılamadığında pnömoni, prostatit veya biliyer sepsis" },
    group: "antibacterial",
    sources: [NICE_NG250, BNF("Levofloxacin", "levofloxacin")],
  },
  {
    code: "21212",
    drug: { en: "Clarithromycin", tr: "Klaritromisin" },
    allergyClass: ["clarithromycin", "macrolide", "erythromycin", "azithromycin"],
    routes: ["PO", "IV"],
    defaultRoute: "PO",
    dose: { default: 500, min: 250, max: 500, unit: "mg" },
    maxPerDay: 1000,
    minIntervalMs: 12 * HOUR,
    frequency: { en: "500 mg every 12 h", tr: "12 saatte bir 500 mg" },
    indication: { en: "Pneumonia (atypical cover) or cellulitis in penicillin allergy", tr: "Penisilin alerjisinde pnömoni (atipik kapsam) veya selülit" },
    group: "antibacterial",
    sources: [NICE_NG141, NICE_NG250, BNF("Clarithromycin", "clarithromycin")],
  },
  {
    code: "3640",
    drug: { en: "Doxycycline", tr: "Doksisiklin" },
    allergyClass: ["doxycycline", "tetracycline", "minocycline"],
    routes: ["PO"],
    defaultRoute: "PO",
    dose: { default: 200, min: 100, max: 200, unit: "mg" },
    maxPerDay: 200,
    minIntervalMs: 12 * HOUR,
    frequency: { en: "200 mg on day 1, then 100 mg daily (100 mg every 12 h in PID)", tr: "1. gün 200 mg, ardından günde 100 mg (PİH'de 12 saatte bir 100 mg)" },
    indication: { en: "Pneumonia or cellulitis in penicillin allergy; PID with ceftriaxone", tr: "Penisilin alerjisinde pnömoni veya selülit; seftriaksonla birlikte PİH" },
    group: "antibacterial",
    sources: [NICE_NG141, NICE_NG250, BNF("Doxycycline", "doxycycline")],
  },
  {
    code: "2582",
    drug: { en: "Clindamycin", tr: "Klindamisin" },
    allergyClass: ["clindamycin", "lincosamide", "lincomycin"],
    routes: ["IV", "PO"],
    defaultRoute: "IV",
    dose: { default: 600, min: 300, max: 1200, unit: "mg" },
    maxPerDay: 4800,
    minIntervalMs: 6 * HOUR,
    frequency: { en: "600-900 mg IV every 8 h (toxin suppression in necrotising infection)", tr: "8 saatte bir 600-900 mg IV (nekrotizan enfeksiyonda toksin baskılama)" },
    indication: { en: "Skin, soft tissue, bone and joint infection in penicillin allergy; PID with gentamicin", tr: "Penisilin alerjisinde deri, yumuşak doku, kemik ve eklem enfeksiyonu; gentamisinle PİH" },
    group: "antibacterial",
    sources: [{ title: "IDSA 2014 skin and soft tissue infections (Stevens et al.)", url: "https://doi.org/10.1093/cid/ciu296" }, BNF("Clindamycin", "clindamycin")],
  },
  {
    code: "6922",
    drug: { en: "Metronidazole", tr: "Metronidazol" },
    allergyClass: ["metronidazole", "nitroimidazole", "tinidazole"],
    routes: ["IV", "PO"],
    defaultRoute: "IV",
    dose: { default: 500, min: 400, max: 500, unit: "mg" },
    maxPerDay: 1500,
    minIntervalMs: 8 * HOUR,
    frequency: { en: "500 mg every 8 h IV (every 12 h in PID)", tr: "8 saatte bir 500 mg IV (PİH'de 12 saatte bir)" },
    indication: { en: "Anaerobic cover: biliary or abdominal sepsis, PID", tr: "Anaerop kapsam: biliyer veya karın kaynaklı sepsis, PİH" },
    group: "antibacterial",
    sources: [{ title: "CDC STI Treatment Guidelines 2021: PID", url: "https://www.cdc.gov/std/treatment-guidelines/pid.htm" }, BNF("Metronidazole", "metronidazole")],
  },
  {
    code: "2348",
    drug: { en: "Chloramphenicol", tr: "Kloramfenikol" },
    allergyClass: ["chloramphenicol"],
    routes: ["IV"],
    defaultRoute: "IV",
    dose: { default: 25, min: 12.5, max: 25, unit: "mg/kg", perKg: 25 },
    minIntervalMs: 6 * HOUR,
    frequency: { en: "12.5 mg/kg every 6 h, up to 25 mg/kg every 6 h in meningitis", tr: "6 saatte bir 12,5 mg/kg, menenjitte 6 saatte bir 25 mg/kg'a kadar" },
    indication: { en: "Bacterial meningitis with severe beta-lactam allergy (infection specialist advice)", tr: "Ağır beta-laktam alerjisinde bakteriyel menenjit (enfeksiyon uzmanı önerisiyle)" },
    highAlert: true,
    group: "antibacterial",
    sources: [NICE_NG240, BNF("Chloramphenicol", "chloramphenicol")],
  },
  {
    code: "artesunate",
    drug: { en: "Artesunate IV", tr: "Artesunat İ.V." },
    allergyClass: ["artesunate", "artemisinin", "artemether"],
    routes: ["IV", "IM"],
    defaultRoute: "IV",
    dose: { default: 2.4, min: 2.4, max: 2.4, unit: "mg/kg", perKg: 2.4 },
    minIntervalMs: 12 * HOUR,
    frequency: { en: "2.4 mg/kg at 0, 12 and 24 h, then daily until oral treatment is possible", tr: "0, 12 ve 24. saatte 2,4 mg/kg, ardından oral tedavi mümkün olana dek günde bir" },
    indication: { en: "Severe malaria (any species)", tr: "Ağır sıtma (tüm türler)" },
    group: "antiparasitic",
    sources: [{ title: "WHO Guidelines for malaria", url: "https://www.who.int/publications/i/item/guidelines-for-malaria" }, { title: "CDC malaria treatment tables (Appendix A)", url: "https://www.cdc.gov/malaria/hcp/clinical-guidance/appendix-a-treatment-tables.html" }],
  },
  {
    code: "260101",
    drug: { en: "Oseltamivir", tr: "Oseltamivir" },
    allergyClass: ["oseltamivir", "neuraminidase"],
    routes: ["PO"],
    defaultRoute: "PO",
    dose: { default: 75, min: 30, max: 75, unit: "mg" },
    maxPerDay: 150,
    minIntervalMs: 12 * HOUR,
    frequency: { en: "75 mg every 12 h for 5 days (reduce in renal impairment)", tr: "5 gün boyunca 12 saatte bir 75 mg (böbrek yetmezliğinde azaltın)" },
    indication: { en: "Influenza in a hospitalised or high-risk patient", tr: "Yatan veya yüksek riskli hastada influenza" },
    group: "antiviral",
    sources: [{ title: "CDC Influenza antiviral medications: summary for clinicians", url: "https://www.cdc.gov/flu/hcp/antivirals/summary-clinicians.html" }, BNF("Oseltamivir", "oseltamivir")],
  },
  {
    code: "3264",
    drug: { en: "Dexamethasone", tr: "Deksametazon" },
    allergyClass: ["dexamethasone"],
    routes: ["IV", "PO"],
    defaultRoute: "IV",
    dose: { default: 6, min: 6, max: 10, unit: "mg" },
    maxPerDay: 40,
    minIntervalMs: 6 * HOUR,
    frequency: { en: "6 mg once daily (COVID-19 needing oxygen); 10 mg every 6 h with the first antibiotic in bacterial meningitis", tr: "Günde bir kez 6 mg (oksijen gereken COVID-19); bakteriyel menenjitte ilk antibiyotikle 6 saatte bir 10 mg" },
    indication: { en: "COVID-19 needing supplemental oxygen; bacterial meningitis", tr: "Ek oksijen gereken COVID-19; bakteriyel menenjit" },
    sources: [{ title: "NICE NG191 COVID-19 rapid guideline (therapeutics)", url: "https://www.nice.org.uk/guidance/ng191/chapter/4-Therapeutics-for-COVID-19" }, NICE_NG240],
  },
];

const BY_CODE = new Map(FORMULARY.map((f) => [f.code, f] as const));

/** The formulary entry for a treatment code, if any. */
export function formularyFor(code: string): FormularyEntry | undefined {
  return BY_CODE.get(code);
}

/** All codes the formulary covers (used by the catalogue completeness test). */
export function formularyCodes(): string[] {
  return FORMULARY.map((f) => f.code);
}


/* -------------------------------------------------------------------------- */
/* Allergy-safe alternatives (acceptance 2026-10-20 D-17)                      */
/* -------------------------------------------------------------------------- */

/** Guideline alternatives in documented allergy, by ICD-10 prefix of the diagnosis. */
export interface AllergyAlternativeRule {
  /** ICD-10 code prefixes (A41, G00, J18 ...). */
  icd: string[];
  /** Formulary codes, in the guideline's order of preference. */
  codes: string[];
  /** Verified GuidelineStatement id (server/guidelines) or a resolving source. */
  statementId?: string;
  source: FormularySource;
}

export const ALLERGY_ALTERNATIVES: AllergyAlternativeRule[] = [
  { icd: ["G00", "A39"], codes: ["2348", "11124"], statementId: "gs_nice_ng240_antibiotic_allergy", source: NICE_NG240 },
  { icd: ["J18"], codes: ["82122", "3640", "21212"], statementId: "gs_nice_ng250_penicillin_allergy", source: NICE_NG250 },
  { icd: ["L03"], codes: ["21212", "3640", "2582", "11124"], statementId: "gs_nice_ng141_penicillin_allergy", source: NICE_NG141 },
  { icd: ["N10", "N39"], codes: ["4413", "82122"], statementId: "gs_nice_ng111_iv_choice",
    source: { title: "NICE NG111 Pyelonephritis (acute): antimicrobial prescribing", url: "https://www.nice.org.uk/guidance/ng111/chapter/Recommendations" } },
  { icd: ["N41"], codes: ["82122", "4413"], statementId: "gs_nice_ng110_abx_msu",
    source: { title: "NICE NG110 Prostatitis (acute): antimicrobial prescribing", url: "https://www.nice.org.uk/guidance/ng110/chapter/Recommendations" } },
  { icd: ["N73", "N70"], codes: ["2582", "4413", "3640", "6922"], statementId: "gs_cdc_pid_alternative",
    source: { title: "CDC STI Treatment Guidelines 2021: PID (alternative parenteral regimens)", url: "https://www.cdc.gov/std/treatment-guidelines/pid.htm" } },
  { icd: ["K83", "K81"], codes: ["82122", "6922"],
    source: { title: "Tokyo Guidelines 2018: antimicrobial therapy for acute cholangitis", url: "https://doi.org/10.1002/jhbp.518" } },
  { icd: ["M00"], codes: ["2582", "11124"],
    source: { title: "BSR/BOA guideline: management of the hot swollen joint in adults (2006)", url: "https://doi.org/10.1093/rheumatology/kel163" } },
  { icd: ["A41", "R65", "D70"], codes: ["29561", "11124", "4413"], source: AAAAI_2022 },
];

/** Default when the diagnosis has no specific rule: carbapenem with caution, or glycopeptide + aminoglycoside. */
const DEFAULT_ALTERNATIVES = ["29561", "11124", "4413", "82122"];

export interface AllergyAlternative {
  entry: FormularyEntry;
  /** True when the alternative carries a cross-reactivity caution for this patient. */
  caution: boolean;
}

function matchesAny(allergyTexts: string[], keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return false;
  return allergyTexts.some((t) => keywords.some((k) => t.includes(k.toLowerCase())));
}

/**
 * Allergy-safe alternatives for a drug blocked by the allergy cross-check:
 * same therapeutic group, not conflicting with any documented allergy, in the
 * order the diagnosis's guideline prefers. Pure.
 */
export function allergySafeAlternatives(
  blockedCode: string,
  allergyTexts: string[],
  dxCode = "",
): { alternatives: AllergyAlternative[]; source: FormularySource; statementId?: string } {
  const blocked = formularyFor(blockedCode);
  const texts = allergyTexts.map((t) => t.toLowerCase()).filter((t) => !/no known|nkda|bilinen.*yok/.test(t));
  const dx = dxCode.toUpperCase();
  const rule = ALLERGY_ALTERNATIVES.find((r) => r.icd.some((p) => dx.startsWith(p)));
  const order = [...(rule?.codes ?? []), ...DEFAULT_ALTERNATIVES];
  const seen = new Set<string>();
  const alternatives: AllergyAlternative[] = [];
  for (const code of order) {
    if (seen.has(code) || code === blockedCode) continue;
    seen.add(code);
    const e = formularyFor(code);
    if (!e || (blocked?.group && e.group !== blocked.group)) continue;
    if (matchesAny(texts, e.allergyClass)) continue;
    alternatives.push({ entry: e, caution: matchesAny(texts, e.allergyCaution) });
  }
  return { alternatives, source: rule?.source ?? AAAAI_2022, ...(rule?.statementId ? { statementId: rule.statementId } : {}) };
}

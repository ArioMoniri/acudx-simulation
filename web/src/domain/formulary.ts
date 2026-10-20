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
  routes: Route[];
  defaultRoute: Route;
  dose: {
    default: number;
    min: number;
    max: number;
    unit: string;
    /** Weight-based dose (per kg) when the guideline expresses it that way. */
    perKg?: number;
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
    dose: { default: 1000, min: 500, max: 1000, unit: "mg", perKg: 15 },
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

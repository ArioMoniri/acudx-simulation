/**
 * AcuDx — condition-specific feedback rows and their verified citations.
 *
 * Acceptance 2026-10-20 D-11: the Feedback page listed "Screened cardiac red
 * flags" for a sepsis case and cited NICE NG185 (acute coronary syndromes) for
 * allergy checking in every case. Each row now names the presentation's own
 * red flags and cites a verified GuidelineStatement id from
 * server/guidelines/statements.verified.json (server/tests/test_acceptance_fever.py
 * checks every id in this file is verified).
 *
 * Pure data + one lookup. Education only.
 */

import type { Bilingual } from "@/data/schema";

export interface ConditionFeedback {
  /** ICD-10 prefixes this row set applies to. */
  icd: string[];
  redFlags: Bilingual;
  redFlagCitation: string;
  /** Statement for the work-up / low-value ordering gap card. */
  workupCitation: string;
}

/** Drug allergy check before prescribing (NICE CG183), every presentation. */
export const ALLERGY_CITATION = "gs_nice_cg183_check_allergy";
/** Ideas, concerns and expectations: what matters to the person (NICE NG197). */
export const ICE_CITATION = "gs_nice_ng197_what_matters";

export const CONDITION_FEEDBACK: ConditionFeedback[] = [
  { icd: ["A41", "R65"], redFlags: { en: "Screened sepsis red flags (NEWS2, hypotension, confusion, mottling, no urine)", tr: "Sepsis kırmızı bayraklarını taradı (NEWS2, hipotansiyon, konfüzyon, alacalanma, idrar yok)" },
    redFlagCitation: "gs_nice_ng253_high_risk_criteria", workupCitation: "gs_ssc21_lactate_cultures" },
  { icd: ["D70"], redFlags: { en: "Screened neutropenic sepsis red flags (recent chemotherapy, rigors, line)", tr: "Nötropenik sepsis kırmızı bayraklarını taradı (yakın kemoterapi, titreme, kateter)" },
    redFlagCitation: "gs_nice_cg151_neutropenic", workupCitation: "gs_nice_cg151_neutropenic" },
  { icd: ["G00", "A39"], redFlags: { en: "Screened meningitis red flags (neck stiffness, photophobia, rash, falling GCS)", tr: "Menenjit kırmızı bayraklarını taradı (ense sertliği, fotofobi, döküntü, düşen GKS)" },
    redFlagCitation: "gs_nice_ng240_lp_imaging", workupCitation: "gs_nice_ng240_abx_1h" },
  { icd: ["J18"], redFlags: { en: "Screened pneumonia severity (confusion, urea, respiratory rate, blood pressure, age)", tr: "Pnömoni ağırlığını taradı (konfüzyon, üre, solunum sayısı, kan basıncı, yaş)" },
    redFlagCitation: "gs_nice_ng250_curb65", workupCitation: "gs_nice_ng250_cap_micro" },
  { icd: ["N10", "N39"], redFlags: { en: "Screened urosepsis red flags (rigors, flank pain, obstruction)", tr: "Ürosepsis kırmızı bayraklarını taradı (titreme, yan ağrısı, obstrüksiyon)" },
    redFlagCitation: "gs_nice_ng111_msu", workupCitation: "gs_nice_ng111_msu" },
  { icd: ["N41"], redFlags: { en: "Screened prostatitis red flags (sepsis, retention, abscess)", tr: "Prostatit kırmızı bayraklarını taradı (sepsis, retansiyon, apse)" },
    redFlagCitation: "gs_nice_ng110_refer", workupCitation: "gs_nice_ng110_abx_msu" },
  { icd: ["L03"], redFlags: { en: "Screened spreading infection red flags (rapid spread, systemic upset, pain out of proportion)", tr: "Yayılan enfeksiyon kırmızı bayraklarını taradı (hızlı yayılım, sistemik bozulma, orantısız ağrı)" },
    redFlagCitation: "gs_nice_ng141_marker", workupCitation: "gs_nice_ng141_marker" },
  { icd: ["K83", "K81"], redFlags: { en: "Screened biliary sepsis red flags (rigors, jaundice, hypotension)", tr: "Biliyer sepsis kırmızı bayraklarını taradı (titreme, sarılık, hipotansiyon)" },
    redFlagCitation: "gs_ssc21_source_control", workupCitation: "gs_wses2020_acc_lfts" },
  { icd: ["M00"], redFlags: { en: "Screened septic joint red flags (hot swollen joint, fever, recent injection)", tr: "Septik eklem kırmızı bayraklarını taradı (sıcak şiş eklem, ateş, yakın enjeksiyon)" },
    redFlagCitation: "gs_ssc21_source_control", workupCitation: "gs_ssc21_lactate_cultures" },
  { icd: ["B50", "B54"], redFlags: { en: "Screened malaria red flags (travel, confusion, jaundice, dark urine)", tr: "Sıtma kırmızı bayraklarını taradı (seyahat, konfüzyon, sarılık, koyu idrar)" },
    redFlagCitation: "gs_cdc_malaria_severe_artesunate", workupCitation: "gs_cdc_malaria_smears" },
  { icd: ["J10", "J11", "J09"], redFlags: { en: "Screened influenza complications (breathlessness, hypoxia, high-risk groups)", tr: "İnfluenza komplikasyonlarını taradı (nefes darlığı, hipoksi, yüksek riskli gruplar)" },
    redFlagCitation: "gs_cdc_flu_oseltamivir", workupCitation: "gs_nice_ng191_no_antibiotics" },
  { icd: ["U07"], redFlags: { en: "Screened COVID-19 red flags (silent hypoxia, oxygen need)", tr: "COVID-19 kırmızı bayraklarını taradı (sessiz hipoksi, oksijen ihtiyacı)" },
    redFlagCitation: "gs_nice_ng191_dexamethasone", workupCitation: "gs_nice_ng191_no_antibiotics" },
  { icd: ["N73", "N70"], redFlags: { en: "Screened PID red flags (pregnancy, abscess, peritonism)", tr: "PİH kırmızı bayraklarını taradı (gebelik, apse, peritonizm)" },
    redFlagCitation: "gs_cdc_pid_minimum_criteria", workupCitation: "gs_cdc_pid_minimum_criteria" },
  { icd: ["I21", "I20", "R07"], redFlags: { en: "Screened cardiac red flags", tr: "Kardiyak kırmızı bayrakları taradı" },
    redFlagCitation: "gs_nice_ng185_reperfusion_eligibility", workupCitation: "gs_nice_ng185_nstemi_assessment" },
];

const GENERIC: Omit<ConditionFeedback, "icd"> = {
  redFlags: { en: "Screened red flags for this presentation", tr: "Bu tablonun kırmızı bayraklarını taradı" },
  redFlagCitation: "",
  workupCitation: "",
};

/** Feedback rows for an ICD-10 diagnosis code (generic, uncited when unknown). */
export function feedbackFor(icd10 = ""): Omit<ConditionFeedback, "icd"> {
  const code = icd10.toUpperCase();
  return CONDITION_FEEDBACK.find((r) => r.icd.some((p) => code.startsWith(p))) ?? GENERIC;
}

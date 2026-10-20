/**
 * AcuDx — searchable diagnosis catalogue (ICD-10-CM + ICD-11 MMS + DSM-5-TR).
 *
 * A broad, cross-system reference set the student searches to build a genuine
 * differential and commit a working diagnosis — NOT a fixed per-case demo list.
 * It spans every major organ system (cardiology, respiratory, GI / surgical,
 * neurology, infectious, endocrine, renal / urology, vascular, OB-GYN, allergy,
 * rheumatology / MSK, psychiatry, toxicology, dermatology, haematology, ENT /
 * eye) so that whatever case the generator (src/domain/caseGen.ts) or the pod
 * backend produces, its correct diagnosis and its distractors resolve to a rich
 * catalogue entry with a crosswalk code and a localized label.
 *
 * The catalogue is keyed on the ICD-10-CM code (the code the rest of the app
 * grounds and scores on — see CaseInstance.correctDiagnosis.code.coding[0]).
 * ICD-11 MMS codes are carried as teaching crosswalk anchors, and DSM-5-TR codes
 * for the psychiatric entries so a panic / anxiety case grades correctly.
 *
 * Codes are illustrative education anchors, curated for teaching — not a
 * validated clinical terminology service. Education only. No real patient data.
 */

import type { Bilingual, Lang } from "@/data/schema";
import { CODE_SYSTEMS, type Coding } from "@/domain/fhir";

/* -------------------------------------------------------------------------- */
/* Systems                                                                     */
/* -------------------------------------------------------------------------- */

/** Top-level clinical system a diagnosis belongs to (drives grouping + filter). */
export type DiagnosisSystem =
  | "cardiovascular"
  | "respiratory"
  | "gastrointestinal"
  | "neurology"
  | "infectious"
  | "endocrine"
  | "renal-urology"
  | "vascular"
  | "obstetrics-gynecology"
  | "allergy-immunology"
  | "rheumatology-msk"
  | "psychiatry"
  | "toxicology"
  | "dermatology"
  | "hematology"
  | "ent-eye"
  | "general";

/** Bilingual display label for each system (for badges / section headers). */
export const SYSTEM_LABELS: Record<DiagnosisSystem, Bilingual> = {
  cardiovascular: { en: "Cardiovascular", tr: "Kardiyovasküler" },
  respiratory: { en: "Respiratory", tr: "Solunum" },
  gastrointestinal: { en: "Gastrointestinal", tr: "Gastrointestinal" },
  neurology: { en: "Neurology", tr: "Nöroloji" },
  infectious: { en: "Infectious disease", tr: "Enfeksiyon" },
  endocrine: { en: "Endocrine / metabolic", tr: "Endokrin / metabolik" },
  "renal-urology": { en: "Renal / urology", tr: "Renal / üroloji" },
  vascular: { en: "Vascular", tr: "Vasküler" },
  "obstetrics-gynecology": { en: "Obstetrics / gynecology", tr: "Kadın doğum" },
  "allergy-immunology": { en: "Allergy / immunology", tr: "Alerji / immünoloji" },
  "rheumatology-msk": { en: "Rheumatology / MSK", tr: "Romatoloji / kas-iskelet" },
  psychiatry: { en: "Psychiatry", tr: "Psikiyatri" },
  toxicology: { en: "Toxicology", tr: "Toksikoloji" },
  dermatology: { en: "Dermatology", tr: "Dermatoloji" },
  hematology: { en: "Hematology", tr: "Hematoloji" },
  "ent-eye": { en: "ENT / eye", tr: "KBB / göz" },
  general: { en: "General", tr: "Genel" },
};

/* -------------------------------------------------------------------------- */
/* Entry shape                                                                 */
/* -------------------------------------------------------------------------- */

export interface DiagnosisEntry {
  /** ICD-10-CM code — the canonical key the app grounds + scores on. */
  icd10: string;
  /** ICD-11 MMS crosswalk code (teaching anchor). */
  icd11?: string;
  /** DSM-5-TR code, present for psychiatric entries. */
  dsm5tr?: string;
  /** Bilingual diagnosis label. */
  label: Bilingual;
  system: DiagnosisSystem;
  /** Extra search terms — synonyms, abbreviations, both languages. */
  synonyms?: string[];
}

/** A search hit: the entry plus the resolved display + a rank score. */
export interface DiagnosisSearchResult extends DiagnosisEntry {
  /** Resolved label in the requested language. */
  display: string;
  /** Lower = stronger match (for stable ranking). */
  rank: number;
}

/* -------------------------------------------------------------------------- */
/* Catalogue data                                                             */
/* -------------------------------------------------------------------------- */

/** Terse row builder: (icd10, icd11, system, en, tr, synonyms?). */
function d(
  icd10: string,
  icd11: string | undefined,
  system: DiagnosisSystem,
  en: string,
  tr: string,
  synonyms?: string[],
): DiagnosisEntry {
  return { icd10, ...(icd11 ? { icd11 } : {}), system, label: { en, tr }, ...(synonyms ? { synonyms } : {}) };
}

/** Psychiatric row builder that also carries a DSM-5-TR code. */
function p(
  icd10: string,
  icd11: string | undefined,
  dsm5tr: string,
  en: string,
  tr: string,
  synonyms?: string[],
): DiagnosisEntry {
  return {
    icd10,
    ...(icd11 ? { icd11 } : {}),
    dsm5tr,
    system: "psychiatry",
    label: { en, tr },
    ...(synonyms ? { synonyms } : {}),
  };
}

const ENTRIES: DiagnosisEntry[] = [
  /* ===== Cardiovascular ===== */
  d("I21.3", "BA41.0", "cardiovascular", "ST-elevation myocardial infarction (STEMI)", "ST yükselmeli miyokart enfarktüsü (STEMI)", ["stemi", "acs", "heart attack", "kalp krizi", "koroner"]),
  d("I21.4", "BA41.1", "cardiovascular", "Non-ST-elevation myocardial infarction (NSTEMI)", "ST yükselmesiz miyokart enfarktüsü (NSTEMI)", ["nstemi", "acs", "akut koroner sendrom"]),
  d("I20.0", "BA40", "cardiovascular", "Unstable angina", "Kararsız angina", ["acs", "anjina"]),
  d("I20.9", "BA40", "cardiovascular", "Stable angina pectoris", "Kararlı angina pektoris", ["angina", "anjina"]),
  d("I30.9", "BB20", "cardiovascular", "Acute pericarditis", "Akut perikardit", ["pericarditis", "perikardit"]),
  // Review 02 finding 29: ICD-11 MMS crosswalks reconciled with the WHO browser
  // (BB23 cardiac tamponade, BB40 infective endocarditis, BC42 myocarditis, BC63
  // complete AV block) and kept identical to server/condition_catalog.py, which
  // server/tests/test_clinical_content.py cross-checks.
  // https://icd.who.int/browse/2025-01/mms/en
  d("I31.4", "BB23", "cardiovascular", "Cardiac tamponade", "Kardiyak tamponad", ["tamponade", "tamponad", "effusion"]),
  d("I40.9", "BC42", "cardiovascular", "Acute myocarditis", "Akut miyokardit", ["myocarditis", "miyokardit"]),
  d("I33.0", "BB40", "cardiovascular", "Infective endocarditis", "İnfektif endokardit", ["endocarditis", "endokardit"]),
  d("I50.9", "BD10", "cardiovascular", "Heart failure, unspecified", "Kalp yetmezliği", ["chf", "kalp yetmezliği", "heart failure"]),
  d("I50.1", "BD11", "cardiovascular", "Acute pulmonary oedema / decompensated heart failure", "Akut akciğer ödemi / dekompanse kalp yetmezliği", ["pulmonary edema", "akciğer ödemi", "aphf"]),
  d("I48.91", "BC81.3", "cardiovascular", "Atrial fibrillation", "Atriyal fibrilasyon", ["af", "afib", "aritmi", "arrhythmia"]),
  d("I47.1", "BC81.0", "cardiovascular", "Supraventricular tachycardia (SVT)", "Supraventriküler taşikardi (SVT)", ["svt", "taşikardi"]),
  d("I47.2", "BC71.0", "cardiovascular", "Ventricular tachycardia", "Ventriküler taşikardi", ["vt", "vtach"]),
  d("I44.2", "BC63", "cardiovascular", "Complete atrioventricular block", "Tam atriyoventriküler blok", ["heart block", "av block", "bradikardi", "bradycardia"]),
  d("I16.1", "BA00", "cardiovascular", "Hypertensive emergency", "Hipertansif acil", ["hypertensive crisis", "hipertansif kriz"]),
  d("R57.0", "BD1Z", "cardiovascular", "Cardiogenic shock", "Kardiyojenik şok", ["shock", "şok"]),
  d("R55", "MB48.0", "cardiovascular", "Syncope and collapse", "Senkop ve kollaps", ["syncope", "senkop", "fainting", "bayılma"]),
  d("R00.2", "MC81.0", "cardiovascular", "Palpitations", "Çarpıntı", ["palpitations", "çarpıntı"]),

  /* ===== Respiratory ===== */
  d("J18.9", "CA40.Z", "respiratory", "Pneumonia, unspecified organism", "Pnömoni", ["pneumonia", "pnömoni", "zatürre", "chest infection"]),
  d("J44.1", "CA22.1", "respiratory", "COPD with acute exacerbation", "KOAH alevlenmesi", ["copd", "koah", "aecopd"]),
  d("J45.901", "CA23", "respiratory", "Asthma with acute exacerbation", "Astım alevlenmesi", ["asthma", "astım", "wheeze", "hışıltı"]),
  d("J20.9", "CA42.Z", "respiratory", "Acute bronchitis", "Akut bronşit", ["bronchitis", "bronşit"]),
  d("J93.11", "CB21.0", "respiratory", "Primary spontaneous pneumothorax", "Primer spontan pnömotoraks", ["pneumothorax", "pnömotoraks", "collapsed lung"]),
  d("J90", "CB27.0", "respiratory", "Pleural effusion", "Plevral efüzyon", ["effusion", "plevral sıvı"]),
  d("J81.0", "CB01", "respiratory", "Acute pulmonary oedema", "Akut akciğer ödemi", ["pulmonary edema", "akciğer ödemi"]),
  d("J80", "CB00", "respiratory", "Acute respiratory distress syndrome (ARDS)", "Akut solunum sıkıntısı sendromu (ARDS)", ["ards"]),
  d("J96.00", "CB41.0", "respiratory", "Acute respiratory failure", "Akut solunum yetmezliği", ["respiratory failure", "solunum yetmezliği", "hypoxia", "hipoksi"]),
  d("J11.1", "CA07.0", "respiratory", "Influenza with respiratory manifestations", "Grip (influenza)", ["flu", "grip", "influenza"]),
  d("U07.1", "RA01.0", "respiratory", "COVID-19", "COVID-19", ["covid", "koronavirüs", "sars-cov-2"]),
  d("J06.9", "CA07.1", "respiratory", "Acute upper respiratory infection", "Akut üst solunum yolu enfeksiyonu", ["uri", "üsye", "cold", "soğuk algınlığı"]),
  d("J05.0", "CA05.0", "respiratory", "Acute laryngotracheitis (croup)", "Akut larengotrakeit (krup)", ["croup", "krup"]),
  d("J05.10", "CA04", "respiratory", "Acute epiglottitis", "Akut epiglottit", ["epiglottitis", "epiglottit"]),
  d("R04.2", "MD26", "respiratory", "Haemoptysis", "Hemoptizi", ["hemoptysis", "hemoptizi", "coughing blood"]),
  d("C34.90", "2C25.Z", "respiratory", "Malignant neoplasm of lung", "Akciğer kanseri", ["lung cancer", "akciğer kanseri", "bronchogenic carcinoma"]),

  /* ===== Gastrointestinal / surgical ===== */
  d("K35.80", "DC10", "gastrointestinal", "Acute appendicitis", "Akut apandisit", ["appendicitis", "apandisit"]),
  d("K81.0", "DC12.0", "gastrointestinal", "Acute cholecystitis", "Akut kolesistit", ["cholecystitis", "kolesistit", "gallbladder"]),
  d("K80.20", "DC11.0", "gastrointestinal", "Calculus of gallbladder (biliary colic)", "Safra kesesi taşı (bilier kolik)", ["gallstone", "safra taşı", "biliary colic", "bilier kolik"]),
  // Review 02 finding 34: ICD-10-CM leaf code K83.09 (matches the server catalog).
  d("K83.09", "DC13", "gastrointestinal", "Ascending cholangitis", "Kolanjit", ["cholangitis", "kolanjit"]),
  d("K85.90", "DC31", "gastrointestinal", "Acute pancreatitis", "Akut pankreatit", ["pancreatitis", "pankreatit"]),
  d("K27.9", "DA60.Z", "gastrointestinal", "Peptic ulcer disease", "Peptik ülser", ["peptic ulcer", "peptik ülser", "gastric ulcer", "duodenal ulcer"]),
  d("K21.9", "DA22.Z", "gastrointestinal", "Gastro-oesophageal reflux disease (GERD)", "Gastroözofageal reflü hastalığı (GÖRH)", ["gerd", "reflü", "reflux", "heartburn"]),
  d("K52.9", "DA94.Z", "gastrointestinal", "Gastroenteritis / colitis, noninfective", "Gastroenterit / kolit", ["gastroenteritis", "gastroenterit", "ishal"]),
  d("A09", "1A40", "gastrointestinal", "Infectious gastroenteritis", "Enfeksiyöz gastroenterit", ["diarrhea", "ishal", "food poisoning", "gıda zehirlenmesi"]),
  d("K56.609", "DB30", "gastrointestinal", "Intestinal obstruction (small bowel)", "İnce bağırsak tıkanıklığı", ["sbo", "bowel obstruction", "ileus", "bağırsak tıkanıklığı"]),
  d("K56.2", "DB33", "gastrointestinal", "Volvulus", "Volvulus", ["volvulus", "malrotation"]),
  d("K57.32", "DB32.0", "gastrointestinal", "Diverticulitis of colon", "Divertikülit", ["diverticulitis", "divertikülit"]),
  d("K55.0", "DD30", "gastrointestinal", "Acute mesenteric ischaemia", "Akut mezenter iskemi", ["mesenteric ischemia", "mezenter iskemi"]),
  d("K92.2", "ME24.9", "gastrointestinal", "Gastrointestinal haemorrhage", "Gastrointestinal kanama", ["gi bleed", "gis kanama", "melena", "hematemesis"]),
  d("K50.90", "DD70", "gastrointestinal", "Crohn disease", "Crohn hastalığı", ["crohn", "ibd"]),
  d("K51.90", "DD71", "gastrointestinal", "Ulcerative colitis", "Ülseratif kolit", ["ulcerative colitis", "ülseratif kolit", "ibd"]),
  d("K75.9", "DB9Z", "gastrointestinal", "Acute hepatitis", "Akut hepatit", ["hepatitis", "hepatit", "liver"]),
  d("K74.60", "DB93.Z", "gastrointestinal", "Cirrhosis of liver", "Karaciğer sirozu", ["cirrhosis", "siroz"]),
  d("I88.0", "3A02", "gastrointestinal", "Mesenteric lymphadenitis", "Mezenterik adenit", ["mesenteric adenitis", "mezenterik adenit"]),
  d("K46.0", "DD50.0", "gastrointestinal", "Incarcerated / strangulated hernia", "İnkarsere / strangüle herni", ["hernia", "fıtık"]),
  d("K63.1", "DB34", "gastrointestinal", "Perforation of intestine", "Bağırsak perforasyonu", ["perforation", "perforasyon", "perforated viscus"]),
  d("K59.00", "DD91.1", "gastrointestinal", "Constipation", "Kabızlık", ["constipation", "kabızlık"]),
  d("A04.7", "1A04", "gastrointestinal", "Clostridioides difficile colitis", "C. difficile koliti", ["c diff", "pseudomembranous colitis"]),
  d("C18.9", "2B90.Z", "gastrointestinal", "Malignant neoplasm of colon", "Kolon kanseri", ["colon cancer", "kolon kanseri", "colorectal"]),

  /* ===== Neurology ===== */
  d("I60.9", "8B00", "neurology", "Subarachnoid haemorrhage", "Subaraknoid kanama", ["sah", "subaraknoid", "thunderclap"]),
  d("I61.9", "8B01", "neurology", "Intracerebral haemorrhage", "İntraserebral kanama", ["ich", "beyin kanaması", "hemorrhagic stroke"]),
  d("I63.9", "8B11", "neurology", "Acute ischaemic stroke", "Akut iskemik inme", ["stroke", "inme", "cva", "cerebral infarction"]),
  d("G45.9", "8B10", "neurology", "Transient ischaemic attack (TIA)", "Geçici iskemik atak (GİA)", ["tia", "gia", "mini stroke"]),
  d("G43.909", "8A80.Z", "neurology", "Migraine, unspecified", "Migren", ["migraine", "migren"]),
  d("G44.209", "8A81.0", "neurology", "Tension-type headache", "Gerilim tipi baş ağrısı", ["tension headache", "gerilim baş ağrısı"]),
  d("G44.009", "8A80.1", "neurology", "Cluster headache", "Küme baş ağrısı", ["cluster headache", "küme baş ağrısı"]),
  d("G00.9", "1D01.Z", "neurology", "Bacterial meningitis", "Bakteriyel menenjit", ["meningitis", "menenjit"]),
  d("A87.9", "1C8Y", "neurology", "Viral meningitis", "Viral menenjit", ["viral meningitis", "viral menenjit", "aseptic"]),
  d("G04.90", "1C00", "neurology", "Encephalitis", "Ensefalit", ["encephalitis", "ensefalit"]),
  d("M31.6", "4A44.2", "neurology", "Giant cell (temporal) arteritis", "Dev hücreli (temporal) arterit", ["gca", "temporal arteritis", "temporal arterit"]),
  d("G40.909", "8A6Z", "neurology", "Epilepsy / seizure", "Epilepsi / nöbet", ["seizure", "nöbet", "epilepsi", "convulsion"]),
  d("G41.9", "8A66", "neurology", "Status epilepticus", "Status epileptikus", ["status epilepticus"]),
  d("G51.0", "8B88.0", "neurology", "Bell palsy", "Bell felci", ["bell palsy", "bell felci", "facial palsy"]),
  d("G61.0", "8C01.0", "neurology", "Guillain-Barré syndrome", "Guillain-Barré sendromu", ["gbs", "guillain barre"]),
  d("G35", "8A40.Z", "neurology", "Multiple sclerosis", "Multipl skleroz", ["ms", "multiple sclerosis", "multipl skleroz"]),
  d("G93.2", "8D40", "neurology", "Idiopathic intracranial hypertension", "İdiyopatik intrakraniyal hipertansiyon", ["iih", "pseudotumor cerebri"]),
  d("H81.10", "AB31.0", "neurology", "Benign paroxysmal positional vertigo (BPPV)", "Benign paroksismal pozisyonel vertigo (BPPV)", ["vertigo", "bppv", "baş dönmesi", "dizziness"]),
  d("G95.20", "8B4Z", "neurology", "Spinal cord compression", "Spinal kord basısı", ["cord compression", "cauda equina"]),
  d("F05", "6D70.Z", "neurology", "Delirium", "Deliryum", ["delirium", "deliryum", "confusion", "konfüzyon"]),

  /* ===== Infectious disease ===== */
  d("A41.9", "1G41", "infectious", "Sepsis, unspecified organism", "Sepsis", ["sepsis", "sepsis"]),
  d("R65.21", "1G40", "infectious", "Septic shock", "Septik şok", ["septic shock", "septik şok"]),
  d("L03.90", "1B70.Z", "infectious", "Cellulitis", "Selülit", ["cellulitis", "selülit"]),
  d("A15.0", "1B10.0", "infectious", "Pulmonary tuberculosis", "Akciğer tüberkülozu", ["tb", "tuberculosis", "tüberküloz", "verem"]),
  d("B27.90", "1D81", "infectious", "Infectious mononucleosis", "Enfeksiyöz mononükleoz", ["mono", "ebv", "glandular fever"]),
  d("M86.9", "FB80.Z", "infectious", "Osteomyelitis", "Osteomiyelit", ["osteomyelitis", "osteomiyelit"]),
  d("M00.9", "FA1Z", "infectious", "Septic arthritis", "Septik artrit", ["septic arthritis", "septik artrit"]),
  d("M72.6", "1B71", "infectious", "Necrotising fasciitis", "Nekrotizan fasiit", ["nec fasc", "nekrotizan fasiit", "flesh eating"]),
  d("B54", "1F40.Z", "infectious", "Malaria", "Sıtma", ["malaria", "sıtma"]),
  d("A90", "1D20", "infectious", "Dengue fever", "Dang ateşi", ["dengue"]),

  /* ===== Endocrine / metabolic ===== */
  d("E10.10", "5A22", "endocrine", "Diabetic ketoacidosis (DKA)", "Diyabetik ketoasidoz (DKA)", ["dka", "ketoacidosis", "ketoasidoz"]),
  d("E11.00", "5A22", "endocrine", "Hyperosmolar hyperglycaemic state (HHS)", "Hiperozmolar hiperglisemik durum (HHS)", ["hhs", "hyperosmolar"]),
  d("E16.2", "5A41", "endocrine", "Hypoglycaemia", "Hipoglisemi", ["hypoglycemia", "hipoglisemi", "low sugar"]),
  d("E11.65", "5A11", "endocrine", "Type 2 diabetes with hyperglycaemia", "Hiperglisemili tip 2 diyabet", ["hyperglycemia", "hiperglisemi", "diabetes", "diyabet"]),
  // Review 02 finding 17: E05.5X1 is not a valid ICD-10-CM code; E05.91 is
  // "Thyrotoxicosis, unspecified, with thyrotoxic crisis or storm".
  // https://www.aapc.com/codes/icd-10-codes/E05.91
  d("E05.91", "5A02", "endocrine", "Thyroid storm (thyrotoxic crisis)", "Tiroid fırtınası", ["thyroid storm", "tiroid fırtınası", "thyrotoxicosis", "tirotoksikoz"]),
  d("E03.5", "5A00.1", "endocrine", "Myxoedema coma / severe hypothyroidism", "Miksödem koması / ağır hipotiroidi", ["myxedema", "hypothyroid", "hipotiroidi"]),
  d("E27.2", "5A74", "endocrine", "Addisonian (adrenal) crisis", "Adrenal kriz", ["adrenal crisis", "addisonian", "adrenal yetmezlik"]),
  d("E87.5", "5C77", "endocrine", "Hyperkalaemia", "Hiperkalemi", ["hyperkalemia", "hiperkalemi", "high potassium"]),
  d("E87.1", "5C77", "endocrine", "Hyponatraemia", "Hiponatremi", ["hyponatremia", "hiponatremi", "low sodium"]),
  d("E83.52", "5C64.2", "endocrine", "Hypercalcaemia", "Hiperkalsemi", ["hypercalcemia", "hiperkalsemi"]),
  d("E86.0", "5C70", "endocrine", "Dehydration / volume depletion", "Dehidratasyon", ["dehydration", "dehidratasyon", "hipovolemi"]),
  d("M62.82", "FB32.Y", "endocrine", "Rhabdomyolysis", "Rabdomiyoliz", ["rhabdo", "rabdomiyoliz"]),

  /* ===== Renal / urology ===== */
  d("N20.0", "GB70.0", "renal-urology", "Renal / ureteric calculus (colic)", "Böbrek / üreter taşı (kolik)", ["renal colic", "kidney stone", "böbrek taşı", "ürolitiazis"]),
  d("N17.9", "GB60.Z", "renal-urology", "Acute kidney injury", "Akut böbrek hasarı", ["aki", "acute renal failure", "abh"]),
  d("N30.90", "GC00.0", "renal-urology", "Cystitis / urinary tract infection", "Sistit / idrar yolu enfeksiyonu", ["uti", "cystitis", "sistit", "idrar yolu enfeksiyonu"]),
  d("N10", "GB50", "renal-urology", "Acute pyelonephritis", "Akut piyelonefrit", ["pyelonephritis", "piyelonefrit", "kidney infection"]),
  d("R33.9", "MF50.2", "renal-urology", "Acute urinary retention", "Akut idrar retansiyonu", ["urinary retention", "idrar retansiyonu"]),
  d("N44.00", "GB01", "renal-urology", "Testicular torsion", "Testis torsiyonu", ["testicular torsion", "testis torsiyonu"]),
  d("N45.1", "GB02", "renal-urology", "Epididymitis / orchitis", "Epididimit / orşit", ["epididymitis", "epididimit", "orchitis"]),
  d("N40.1", "GA90", "renal-urology", "Benign prostatic hyperplasia with symptoms", "Semptomatik benign prostat hiperplazisi", ["bph", "prostate", "prostat"]),
  d("R31.9", "MF52", "renal-urology", "Haematuria", "Hematüri", ["hematuria", "hematüri", "blood in urine"]),

  /* ===== Vascular ===== */
  d("I71.01", "BD50.0", "vascular", "Thoracic aortic dissection", "Torasik aort diseksiyonu", ["aortic dissection", "aort diseksiyonu"]),
  d("I71.4", "BD51.0", "vascular", "Abdominal aortic aneurysm", "Abdominal aort anevrizması", ["aaa", "aort anevrizması"]),
  d("I26.99", "BB00", "vascular", "Pulmonary embolism", "Pulmoner emboli", ["pe", "pulmoner emboli", "clot"]),
  d("I82.409", "BD71.Z", "vascular", "Deep vein thrombosis", "Derin ven trombozu", ["dvt", "derin ven trombozu"]),
  d("I74.3", "BD5Z", "vascular", "Acute limb ischaemia", "Akut ekstremite iskemisi", ["limb ischemia", "ekstremite iskemi"]),
  d("I73.9", "BD40.Z", "vascular", "Peripheral arterial disease", "Periferik arter hastalığı", ["pad", "periferik arter"]),

  /* ===== Obstetrics / gynecology ===== */
  d("O00.9", "JA01.Z", "obstetrics-gynecology", "Ectopic pregnancy", "Ektopik gebelik", ["ectopic", "ektopik gebelik", "tubal"]),
  d("N83.20", "GA31.Z", "obstetrics-gynecology", "Ovarian cyst", "Over kisti", ["ovarian cyst", "over kisti"]),
  d("N83.51", "GA31.3", "obstetrics-gynecology", "Ovarian torsion", "Over torsiyonu", ["ovarian torsion", "over torsiyonu", "adnexal torsion"]),
  d("N70.91", "GA05.Z", "obstetrics-gynecology", "Pelvic inflammatory disease", "Pelvik inflamatuar hastalık", ["pid", "pelvik inflamatuar"]),
  d("O20.0", "JA00.0", "obstetrics-gynecology", "Threatened miscarriage", "Abortus imminens (düşük tehdidi)", ["miscarriage", "düşük", "threatened abortion"]),
  d("O21.0", "JA80", "obstetrics-gynecology", "Hyperemesis gravidarum", "Hiperemezis gravidarum", ["hyperemesis", "gebelik kusması"]),
  d("O14.90", "JA24.Z", "obstetrics-gynecology", "Pre-eclampsia", "Preeklampsi", ["preeclampsia", "preeklampsi", "toxemia"]),
  d("O45.90", "JA43", "obstetrics-gynecology", "Placental abruption", "Plasenta dekolmanı", ["abruption", "dekolman"]),
  d("N80.9", "GA10.Z", "obstetrics-gynecology", "Endometriosis", "Endometriozis", ["endometriosis", "endometriozis"]),
  d("N92.0", "GA20.0", "obstetrics-gynecology", "Menorrhagia / abnormal uterine bleeding", "Menoraji / anormal uterin kanama", ["menorrhagia", "aub", "menoraji"]),
  d("N75.1", "GA13", "obstetrics-gynecology", "Bartholin gland abscess", "Bartholin bezi apsesi", ["bartholin", "bartolin"]),

  /* ===== Allergy / immunology ===== */
  d("T78.2XXA", "4A84", "allergy-immunology", "Anaphylaxis", "Anafilaksi", ["anaphylaxis", "anafilaksi", "allergic shock"]),
  d("T78.3XXA", "EB01", "allergy-immunology", "Angioedema", "Anjiyoödem", ["angioedema", "anjiyoödem"]),
  d("L50.9", "EB00.Z", "allergy-immunology", "Urticaria (hives)", "Ürtiker (kurdeşen)", ["urticaria", "hives", "ürtiker", "kurdeşen"]),
  d("T88.7XXA", "NE60", "allergy-immunology", "Adverse drug reaction", "İlaç advers reaksiyonu", ["adverse drug reaction", "ilaç reaksiyonu", "drug allergy"]),
  d("J30.9", "CA08.0", "allergy-immunology", "Allergic rhinitis", "Alerjik rinit", ["allergic rhinitis", "alerjik rinit", "hay fever"]),
  d("T80.52XA", "NE80", "allergy-immunology", "Anaphylactic reaction to serum / vaccine", "Serum / aşıya anafilaktik reaksiyon", ["serum sickness", "vaccine reaction"]),

  /* ===== Rheumatology / MSK ===== */
  d("M10.9", "FA25.Z", "rheumatology-msk", "Gout", "Gut", ["gout", "gut", "podagra"]),
  d("M06.9", "FA20.Z", "rheumatology-msk", "Rheumatoid arthritis", "Romatoid artrit", ["ra", "romatoid artrit"]),
  d("M32.9", "4A40.Z", "rheumatology-msk", "Systemic lupus erythematosus (flare)", "Sistemik lupus eritematozus (alevlenme)", ["sle", "lupus"]),
  d("M35.3", "FA22", "rheumatology-msk", "Polymyalgia rheumatica", "Polimiyaljiya romatika", ["pmr", "polymyalgia"]),
  d("M94.0", "FB56.0", "rheumatology-msk", "Costochondritis (Tietze)", "Kostokondrit (Tietze)", ["costochondritis", "kostokondrit"]),
  d("M54.50", "ME84.2", "rheumatology-msk", "Low back pain", "Bel ağrısı", ["low back pain", "bel ağrısı", "lumbago"]),
  d("M54.30", "8B93.0", "rheumatology-msk", "Sciatica", "Siyatik", ["sciatica", "siyatik", "radiculopathy"]),
  d("M79.7", "MG30.0", "rheumatology-msk", "Fibromyalgia", "Fibromiyalji", ["fibromyalgia", "fibromiyalji"]),
  d("M25.50", "FA0Z", "rheumatology-msk", "Acute monoarthritis / joint pain", "Akut monoartrit / eklem ağrısı", ["arthritis", "artrit", "joint pain", "eklem ağrısı"]),
  d("M62.830", "ME84.20", "rheumatology-msk", "Muscle spasm / strain", "Kas spazmı / zorlanması", ["muscle strain", "kas zorlanması"]),

  /* ===== Psychiatry (DSM-5-TR) ===== */
  p("F41.0", "6B01", "300.01", "Panic disorder", "Panik bozukluğu", ["panic", "panik", "panic attack"]),
  p("F41.1", "6B00", "300.02", "Generalized anxiety disorder", "Yaygın anksiyete bozukluğu", ["gad", "anxiety", "anksiyete", "yaygın anksiyete"]),
  p("F45.1", "6C20", "300.82", "Somatic symptom disorder", "Somatik semptom bozukluğu", ["somatic", "somatizasyon", "somatoform"]),
  p("F43.0", "6B41", "308.3", "Acute stress disorder", "Akut stres bozukluğu", ["acute stress", "akut stres"]),
  p("F32.9", "6A70.Z", "296.20", "Major depressive disorder", "Majör depresif bozukluk", ["depression", "depresyon", "mdd"]),
  p("F31.9", "6A60.Z", "296.80", "Bipolar disorder (manic episode)", "Bipolar bozukluk (manik dönem)", ["bipolar", "mani", "mania"]),
  p("F20.9", "6A20.Z", "295.90", "Schizophrenia / acute psychosis", "Şizofreni / akut psikoz", ["psychosis", "psikoz", "schizophrenia", "şizofreni"]),
  p("F10.239", "6C40.5", "291.81", "Alcohol withdrawal", "Alkol yoksunluğu", ["alcohol withdrawal", "alkol yoksunluğu", "dt", "delirium tremens"]),
  p("F10.129", "6C40.3", "303.00", "Acute alcohol intoxication", "Akut alkol entoksikasyonu", ["intoxication", "alkol entoksikasyonu", "drunk"]),
  p("R45.851", "MB26.A", "V62.84", "Suicidal ideation", "İntihar düşüncesi", ["suicidal", "intihar", "self harm"]),
  p("F44.9", "6B60.Z", "300.11", "Conversion (functional neurological) disorder", "Konversiyon bozukluğu", ["conversion", "konversiyon", "functional"]),
  p("F19.90", "6C4G", "292.9", "Substance use / intoxication", "Madde kullanımı / entoksikasyon", ["substance", "madde", "drug use"]),

  /* ===== Toxicology / environmental ===== */
  d("T39.1X1A", "NE61", "toxicology", "Paracetamol (acetaminophen) overdose", "Parasetamol zehirlenmesi", ["acetaminophen", "parasetamol", "paracetamol overdose"]),
  d("T40.2X1A", "NE60", "toxicology", "Opioid overdose", "Opioid aşırı dozu", ["opioid", "heroin", "overdose", "aşırı doz"]),
  d("T58.91XA", "NE68", "toxicology", "Carbon monoxide poisoning", "Karbon monoksit zehirlenmesi", ["carbon monoxide", "co poisoning", "karbon monoksit"]),
  d("T43.011A", "NE60", "toxicology", "Tricyclic antidepressant overdose", "Trisiklik antidepresan zehirlenmesi", ["tca", "trisiklik", "amitriptyline"]),
  d("T43.225A", "NE60", "toxicology", "Serotonin syndrome", "Serotonin sendromu", ["serotonin syndrome", "serotonin sendromu"]),
  d("T42.4X1A", "NE60", "toxicology", "Benzodiazepine overdose", "Benzodiazepin aşırı dozu", ["benzo", "benzodiazepin"]),
  d("T67.0XXA", "NF01.Z", "toxicology", "Heat stroke", "Sıcak çarpması", ["heat stroke", "sıcak çarpması", "hyperthermia"]),
  d("T68.XXXA", "NF02", "toxicology", "Hypothermia", "Hipotermi", ["hypothermia", "hipotermi"]),
  // Review 02 finding 18: T78.40XA is "Allergy, unspecified"; a poisoning commit
  // must be graded against T65.91XA (toxic effect of unspecified substance,
  // accidental, initial encounter). https://www.aapc.com/codes/icd-10-codes/T65.91
  d("T65.91XA", "NE61", "toxicology", "Poisoning / toxic ingestion, unspecified", "Zehirlenme (belirsiz)", ["poisoning", "zehirlenme", "ingestion"]),

  /* ===== Dermatology ===== */
  d("B02.9", "1E91.Z", "dermatology", "Herpes zoster (shingles)", "Herpes zoster (zona)", ["shingles", "zona", "herpes zoster"]),
  d("L51.1", "EB40.1", "dermatology", "Stevens-Johnson syndrome", "Stevens-Johnson sendromu", ["sjs", "stevens johnson"]),
  d("L01.00", "1B72", "dermatology", "Impetigo", "İmpetigo", ["impetigo"]),
  d("A46", "1B70.0", "dermatology", "Erysipelas", "Erizipel", ["erysipelas", "erizipel"]),
  d("L52", "EE40", "dermatology", "Erythema nodosum", "Eritema nodozum", ["erythema nodosum", "eritema nodozum"]),
  d("R21", "EC50", "dermatology", "Rash, unspecified", "Döküntü (belirsiz)", ["rash", "döküntü", "exanthem"]),

  /* ===== Hematology ===== */
  d("D57.00", "3A51.0", "hematology", "Sickle cell crisis", "Orak hücre krizi", ["sickle cell", "orak hücre", "vaso-occlusive"]),
  d("D64.9", "3A9Z", "hematology", "Anaemia, unspecified", "Anemi", ["anemia", "anemi", "kansızlık"]),
  d("D69.6", "3B64.1", "hematology", "Thrombocytopenia", "Trombositopeni", ["thrombocytopenia", "trombositopeni", "low platelets"]),
  d("D69.3", "3B64.10", "hematology", "Immune thrombocytopenic purpura (ITP)", "İmmün trombositopenik purpura (ITP)", ["itp", "immün trombositopeni"]),
  d("D65", "3B20.Z", "hematology", "Disseminated intravascular coagulation (DIC)", "Yaygın damar içi pıhtılaşma (DIC)", ["dic", "coagulopathy"]),
  d("D68.9", "3B10.Z", "hematology", "Coagulopathy / bleeding disorder", "Koagülopati / kanama bozukluğu", ["coagulopathy", "koagülopati"]),
  d("C95.90", "2B33.Z", "hematology", "Acute leukaemia", "Akut lösemi", ["leukemia", "lösemi"]),

  /* ===== ENT / eye ===== */
  d("R04.0", "MD25", "ent-eye", "Epistaxis (nosebleed)", "Epistaksis (burun kanaması)", ["epistaxis", "burun kanaması", "nosebleed"]),
  d("J36", "CA0J", "ent-eye", "Peritonsillar abscess (quinsy)", "Peritonsiller apse", ["quinsy", "peritonsiller apse"]),
  d("J03.90", "CA03.Z", "ent-eye", "Acute tonsillitis", "Akut tonsillit", ["tonsillitis", "tonsillit", "sore throat", "boğaz ağrısı"]),
  d("H66.90", "AB00.Z", "ent-eye", "Acute otitis media", "Akut otitis media", ["otitis media", "kulak enfeksiyonu", "ear infection"]),
  d("H40.219", "9C61.0", "ent-eye", "Acute angle-closure glaucoma", "Akut dar açılı glokom", ["glaucoma", "glokom", "angle closure"]),
  d("H33.20", "9B78.0", "ent-eye", "Retinal detachment", "Retina dekolmanı", ["retinal detachment", "retina dekolmanı"]),
  d("H10.9", "9A60.Z", "ent-eye", "Conjunctivitis", "Konjonktivit", ["conjunctivitis", "konjonktivit", "pink eye"]),
  d("K04.7", "DA0C.0", "ent-eye", "Dental abscess", "Diş apsesi", ["dental abscess", "diş apsesi", "tooth infection"]),
  d("J01.90", "CA0A.Z", "ent-eye", "Acute sinusitis", "Akut sinüzit", ["sinusitis", "sinüzit"]),

  /* ===== General / undifferentiated ===== */
  d("R50.9", "MG26", "general", "Fever, unspecified", "Ateş (belirsiz)", ["fever", "ateş", "pyrexia"]),
  d("R10.9", "MD81", "general", "Abdominal pain, unspecified", "Karın ağrısı (belirsiz)", ["abdominal pain", "karın ağrısı"]),
  d("R07.9", "MD30.Z", "general", "Chest pain, unspecified", "Göğüs ağrısı (belirsiz)", ["chest pain", "göğüs ağrısı"]),
  d("R51.9", "MB40.0", "general", "Headache, unspecified", "Baş ağrısı (belirsiz)", ["headache", "baş ağrısı"]),
  d("R06.02", "MD11.5", "general", "Dyspnoea / shortness of breath", "Dispne / nefes darlığı", ["dyspnea", "nefes darlığı", "sob", "breathlessness"]),
  d("R53.1", "MG22", "general", "Weakness / fatigue", "Halsizlik / yorgunluk", ["weakness", "halsizlik", "fatigue", "yorgunluk"]),
  d("R11.2", "MD90", "general", "Nausea and vomiting", "Bulantı ve kusma", ["nausea", "vomiting", "bulantı", "kusma"]),
];

/* -------------------------------------------------------------------------- */
/* Index + public API                                                          */
/* -------------------------------------------------------------------------- */

/** Fold a string for accent/case-insensitive matching (EN + TR aware). */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ıİ]/g, "i") // Turkish dotless/dotted i -> i
    .toLowerCase()
    .trim();
}

/** Every code an entry can be looked up by (ICD-10 canonical + crosswalks). */
function entryCodes(e: DiagnosisEntry): string[] {
  return [e.icd10, e.icd11, e.dsm5tr].filter((c): c is string => Boolean(c));
}

// Lookup index by every code an entry carries (upper-cased, exact).
const BY_CODE = new Map<string, DiagnosisEntry>();
for (const e of ENTRIES) {
  for (const code of entryCodes(e)) {
    if (!BY_CODE.has(code.toUpperCase())) BY_CODE.set(code.toUpperCase(), e);
  }
}

/** The full catalogue (read-only). */
export const DIAGNOSIS_CATALOG: readonly DiagnosisEntry[] = ENTRIES;

/** Localized label for an entry. */
export function diagnosisLabel(e: DiagnosisEntry, lang: Lang): string {
  return e.label[lang] ?? e.label.en;
}

/** Localized system label. */
export function systemLabel(system: DiagnosisSystem, lang: Lang): string {
  const b = SYSTEM_LABELS[system];
  return b[lang] ?? b.en;
}

/**
 * Look up a diagnosis by ANY of its codes (ICD-10 / ICD-11 / DSM-5-TR). Case
 * codes are grounded on `coding[0].code`, which may be an ICD-10, ICD-11 or DSM
 * code depending on the case, so matching on all three keeps the catalogue and
 * the generated cases in sync. Returns undefined for an unknown code.
 */
export function getDiagnosis(code: string): DiagnosisEntry | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.toUpperCase());
}

/** Build a FHIR Coding for a catalogue entry (ICD-10-CM primary). */
export function diagnosisCoding(e: DiagnosisEntry, lang: Lang): Coding {
  return { system: CODE_SYSTEMS.icd10, code: e.icd10, display: diagnosisLabel(e, lang) };
}

/**
 * Build a searchable entry from a case-provided diagnosis — a code plus an
 * already-localized display — so a diagnosis the generator or the pod backend
 * emits *outside* the static catalogue (unbounded ICD-11 / ICD-10 / DSM-5-TR
 * synthesis, see lib/liveCaseGen.ts) is still findable by name in the picker,
 * not merely committable from the "suggested" row. Pass the result(s) to
 * `searchDiagnoses(query, lang, limit, extra)`. On a code collision the richer
 * catalogue entry wins (see `mergeCorpus`), so this only ever surfaces a
 * genuinely novel diagnosis. The display is stored under both language labels
 * because that is the only rendering the case hands us.
 */
export function caseEntry(code: string, display: string): DiagnosisEntry {
  return { icd10: code, label: { en: display, tr: display }, system: "general" };
}

/**
 * Fold `extra` case-provided entries into the catalogue for a single search.
 * A catalogue entry always wins a code collision (by ANY of its codes), so a
 * generated diagnosis whose code the catalogue already covers is never
 * duplicated; only truly novel diagnoses are appended.
 */
function mergeCorpus(extra?: readonly DiagnosisEntry[]): readonly DiagnosisEntry[] {
  if (!extra || extra.length === 0) return ENTRIES;
  const known = new Set(BY_CODE.keys()); // already upper-cased
  const merged = ENTRIES.slice();
  for (const e of extra) {
    const codes = entryCodes(e).map((c) => c.toUpperCase());
    if (codes.length === 0 || codes.some((c) => known.has(c))) continue;
    for (const c of codes) known.add(c);
    merged.push(e);
  }
  return merged;
}

/**
 * searchDiagnoses — rank the catalogue against a free-text query in `lang`.
 *
 * Matches label (active language + English + Turkish), ICD-10 / ICD-11 / DSM
 * codes, synonyms and the system label. Ranks exact-code and prefix hits above
 * substring hits so the intended diagnosis surfaces first. An empty query
 * returns the catalogue in a stable, system-grouped order.
 *
 * ALL matches are returned by default (no silent truncation): the caller paginates
 * for display. Pass `extra` (see `caseEntry`) to make case-provided diagnoses that
 * live outside the catalogue searchable too; pass `limit` only to cap deliberately.
 */
export function searchDiagnoses(
  query: string,
  lang: Lang,
  limit: number = Number.POSITIVE_INFINITY,
  extra?: readonly DiagnosisEntry[],
): DiagnosisSearchResult[] {
  const corpus = mergeCorpus(extra);
  const q = fold(query);

  if (!q) {
    return corpus.slice(0, limit).map((e) => ({
      ...e,
      display: diagnosisLabel(e, lang),
      rank: 0,
    }));
  }

  const results: DiagnosisSearchResult[] = [];
  for (const e of corpus) {
    const display = diagnosisLabel(e, lang);
    const rank = scoreEntry(e, display, lang, q);
    if (rank < Infinity) results.push({ ...e, display, rank });
  }

  results.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.display.localeCompare(b.display)));
  return Number.isFinite(limit) ? results.slice(0, limit) : results;
}

/** Score one entry against a folded query. Lower = better; Infinity = no match. */
function scoreEntry(e: DiagnosisEntry, display: string, lang: Lang, q: string): number {
  // Exact code match — strongest signal.
  for (const code of entryCodes(e)) {
    const fc = fold(code);
    if (fc === q) return 0;
    if (fc.startsWith(q)) return 1;
  }

  const primary = fold(display);
  if (primary === q) return 1;
  if (primary.startsWith(q)) return 2;

  // Any language label + synonyms + system label.
  const haystacks = [
    fold(e.label.en),
    fold(e.label.tr),
    fold(systemLabel(e.system, lang)),
    ...(e.synonyms ?? []).map(fold),
  ];

  // Word-boundary prefix within the active-language label (e.g. "myoc" -> myocardial).
  if (primary.split(/\s+/).some((w) => w.startsWith(q))) return 3;

  for (const h of haystacks) {
    if (h.startsWith(q)) return 4;
  }
  if (primary.includes(q)) return 5;
  for (const code of entryCodes(e)) {
    if (fold(code).includes(q)) return 6;
  }
  for (const h of haystacks) {
    if (h.includes(q)) return 7;
  }
  return Infinity;
}

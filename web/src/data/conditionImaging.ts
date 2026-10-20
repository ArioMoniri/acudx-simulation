/**
 * conditionImaging — curated bundle of REAL, openly-licensed representative
 * studies (ECG / chest X-ray / CT / abdominal X-ray) mapped to the clinical
 * conditions AcuDx simulates.
 *
 * Why a curated bundle: a free-text search against a media repository can
 * surface a plausible-but-wrong film (the runtime Commons search that once
 * lived in `src/lib/openMedicalImages.ts` was removed for that reason; Live
 * mode now takes the server engine's matched image). For a teaching tool that
 * is unacceptable — an "anterior STEMI" case must show an anterior-STEMI ECG,
 * not a random tracing.
 * Every entry here was individually verified on the file's Commons description
 * page to genuinely depict the stated condition + modality, and carries the
 * author + license + source URL required for CC-BY attribution. Nothing is a
 * picture of the actual simulated patient — all are labelled representative.
 *
 * Provenance & licences are documented per entry (`attribution`). All source
 * files are CC-BY / CC-BY-SA / CC0 / public-domain from Wikimedia Commons.
 *
 * Resolution:
 *   - `resolveConditionImaging(caseInstance, modality?)` matches a case's
 *     correctDiagnosis (ICD-10 code + bilingual text) and chief complaint.
 *   - `resolveCuratedImagingByText(query, modalityLabel?)` matches the free-text
 *     query + short modality label that `ConditionImage` already receives, so
 *     the curated bundle can be preferred without changing that component's API.
 * Both return the best match or `null` (the caller shows the report alone).
 */

import type { CaseInstance } from "@/domain/case";

export type ImagingModality = "ecg" | "cxr" | "ct" | "axr" | "us" | "mri";

export interface CuratedImagingAttribution {
  /** Author / uploader, as credited on the Commons file page. */
  author: string;
  /** Short licence name — CC-BY / CC-BY-SA / CC0 / public domain. */
  license: string;
  /** Canonical Commons file-description page (licence + source). */
  sourceUrl: string;
}

export interface CuratedImaging {
  id: string;
  modality: ImagingModality;
  /**
   * ICD-10 code prefixes (e.g. "I21.3") AND EN/TR keywords (e.g. "stemi",
   * "ön duvar") that map a case/study to this image. Code-shaped keys are
   * matched against the case's diagnosis code; word keys against its text.
   */
  conditionKeys: string[];
  src: string;
  /** Short bilingual teaching label describing what the study shows. */
  caption: { en: string; tr: string };
  attribution: CuratedImagingAttribution;
}

const base = import.meta.env.BASE_URL;
const img = (slug: string): string => `${base}imaging/${slug}.jpg`;

/* -------------------------------------------------------------------------- */
/* Curated catalogue                                                           */
/* -------------------------------------------------------------------------- */

export const CURATED_IMAGING: readonly CuratedImaging[] = [
  /* ------------------------------- ECG ---------------------------------- */
  {
    id: "ecg-normal",
    modality: "ecg",
    conditionKeys: ["Z00", "normal sinus", "sinus rhythm", "sinüs ritmi", "normal ecg", "normal ekg", "normal 12-lead"],
    src: img("ecg-normal"),
    caption: { en: "Normal sinus rhythm — 12-lead ECG", tr: "Normal sinüs ritmi — 12 derivasyonlu EKG" },
    attribution: {
      author: "Glenlarson",
      license: "Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:12_lead_generated_sinus_rhythm.JPG",
    },
  },
  {
    id: "ecg-anterior-stemi",
    modality: "ecg",
    conditionKeys: [
      "I21.0", "I21.2", "I21.3", "anterior stemi", "anterior mi", "anterior myocardial", "anteroseptal",
      "ön duvar", "önyüz", "stemi", "st elevation", "st yükselme", "st-elevation",
    ],
    src: img("ecg-anterior-stemi"),
    caption: { en: "Acute anterior STEMI — ST elevation V2–V4", tr: "Akut ön duvar STEMI — V2–V4 ST elevasyonu" },
    attribution: {
      author: "CardioNetworks / ECGpedia.org",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:AMI_anterior_(CardioNetworks_ECGpedia).png",
    },
  },
  {
    id: "ecg-inferior-stemi",
    modality: "ecg",
    conditionKeys: [
      "I21.1", "I21.3", "inferior stemi", "inferior mi", "inferior myocardial", "inferior infarct",
      "alt duvar", "alt cidar", "ii iii avf", "stemi", "st elevation", "st yükselme", "st-elevation",
    ],
    src: img("ecg-inferior-stemi"),
    caption: { en: "Acute inferior STEMI — ST elevation II, III, aVF", tr: "Akut alt duvar STEMI — II, III, aVF ST elevasyonu" },
    attribution: {
      author: "Glenlarson (Wikimedia Commons)",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:ECG_001.jpg",
    },
  },
  {
    id: "ecg-nstemi-ischemia",
    modality: "ecg",
    conditionKeys: [
      "I21.4", "I20", "nstemi", "non-st", "non st", "unstable angina", "kararsız angina",
      "st depression", "st segment depression", "st çökme", "st depresyon", "subendocardial",
      "myocardial ischaemia", "myocardial ischemia", "ischaemia", "ischemia", "iskemi",
    ],
    src: img("ecg-nstemi-ischemia"),
    caption: { en: "Myocardial ischaemia — ST-segment depression", tr: "Miyokart iskemisi — ST segment çökmesi" },
    attribution: {
      author: "Michael Rosengarten, McGill / ECGpedia.org",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:E231_(CardioNetworks_ECGpedia).jpg",
    },
  },
  {
    id: "ecg-atrial-fibrillation",
    modality: "ecg",
    conditionKeys: ["I48.0", "I48.1", "I48.2", "I48.91", "atrial fibrillation", "atriyal fibrilasyon", "fibrillation", "fibrilasyon", "afib"],
    src: img("ecg-atrial-fibrillation"),
    caption: { en: "Atrial fibrillation — irregularly irregular, no P waves", tr: "Atriyal fibrilasyon — düzensiz ritim, P dalgası yok" },
    attribution: {
      author: "Ewingdo",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:ECG_Atrial_Fibrillation_90_bpm.jpg",
    },
  },
  {
    id: "ecg-atrial-flutter",
    modality: "ecg",
    conditionKeys: ["I48.3", "I48.4", "I48.92", "atrial flutter", "atriyal flutter", "flutter", "sawtooth", "testere dişi"],
    src: img("ecg-atrial-flutter"),
    caption: { en: "Atrial flutter — sawtooth flutter waves", tr: "Atriyal flutter — testere dişi flutter dalgaları" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:AtrialFlutter12.JPG",
    },
  },
  {
    id: "ecg-svt",
    modality: "ecg",
    conditionKeys: ["I47.1", "supraventricular tachycardia", "supraventriküler taşikardi", "supraventricular", "supraventriküler", "psvt", "avnrt", "avrt"],
    src: img("ecg-svt"),
    caption: { en: "Supraventricular tachycardia (SVT)", tr: "Supraventriküler taşikardi (SVT)" },
    attribution: {
      author: "James Heilman, MD",
      license: "Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:SVT_Lead_II-2.JPG",
    },
  },
  {
    id: "ecg-vt",
    modality: "ecg",
    conditionKeys: ["I47.2", "ventricular tachycardia", "ventriküler taşikardi", "vtach", "monomorphic vt", "wide complex tachycardia"],
    src: img("ecg-vt"),
    caption: { en: "Ventricular tachycardia — wide-complex tachycardia", tr: "Ventriküler taşikardi — geniş kompleksli taşikardi" },
    attribution: {
      author: "Ksheka (Wikimedia Commons)",
      license: "CC BY-SA 2.5",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Electrocardiogram_of_Ventricular_Tachycardia.png",
    },
  },
  {
    id: "ecg-complete-heart-block",
    modality: "ecg",
    conditionKeys: [
      "I44.2", "complete heart block", "third degree", "third-degree", "3rd degree", "heart block",
      "atrioventricular block", "av block", "tam av blok", "atriyoventriküler blok", "tam blok", "av dissociation",
    ],
    src: img("ecg-complete-heart-block"),
    caption: { en: "Complete (third-degree) AV block", tr: "Tam (üçüncü derece) AV blok" },
    attribution: {
      author: "Gregory Marcus, MD, MAS, FACC",
      license: "CC BY 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:3rd_degree_heart_block.PNG",
    },
  },
  {
    id: "ecg-pericarditis",
    modality: "ecg",
    conditionKeys: ["I30", "pericarditis", "perikardit", "diffuse st elevation", "yaygın st"],
    src: img("ecg-pericarditis"),
    caption: { en: "Acute pericarditis — diffuse ST elevation", tr: "Akut perikardit — yaygın ST elevasyonu" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:PericarditisECG.JPG",
    },
  },
  {
    id: "ecg-hyperkalemia",
    modality: "ecg",
    conditionKeys: ["E87.5", "hyperkal", "hiperkal", "peaked t", "sivri t", "potassium", "potasyum"],
    src: img("ecg-hyperkalemia"),
    caption: { en: "Hyperkalaemia — peaked T waves", tr: "Hiperkalemi — sivri T dalgaları" },
    attribution: {
      author: "Drs. M-J. F. Agbayani & E. Gonzales",
      license: "CC BY 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Hyperkalemia_ECG.jpg",
    },
  },

  /* --------------------------- Chest X-ray ------------------------------ */
  {
    id: "cxr-normal",
    modality: "cxr",
    conditionKeys: ["Z00", "normal chest", "normal cxr", "normal akciğer", "clear lungs", "no acute"],
    src: img("cxr-normal"),
    caption: { en: "Normal chest radiograph (PA)", tr: "Normal akciğer grafisi (PA)" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0 / Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Normal_posteroanterior_(PA)_chest_radiograph_(X-ray).jpg",
    },
  },
  {
    id: "cxr-pneumonia",
    modality: "cxr",
    conditionKeys: ["J18", "J15", "J13", "J14", "pneumonia", "pnömoni", "zatürre", "consolidation", "konsolidasyon", "airspace", "lobar"],
    src: img("cxr-pneumonia"),
    caption: { en: "Pneumonia — airspace consolidation", tr: "Pnömoni — hava boşluğu konsolidasyonu" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0 / Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Chest_radiograph_in_influensa_and_H_influenzae,_posteroanterior.jpg",
    },
  },
  {
    id: "cxr-pulmonary-edema",
    modality: "cxr",
    conditionKeys: [
      "I50", "J81", "I11.0", "pulmonary oedema", "pulmonary edema", "akciğer ödemi", "heart failure",
      "kalp yetmezliği", "congestive", "kerley", "cardiomegaly", "kardiyomegali", "aphf", "decompensated",
    ],
    src: img("cxr-pulmonary-edema"),
    caption: { en: "Heart failure — cardiomegaly, Kerley B lines", tr: "Kalp yetmezliği — kardiyomegali, Kerley B çizgileri" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0 / Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg",
    },
  },
  {
    id: "cxr-pneumothorax",
    modality: "cxr",
    conditionKeys: ["J93", "pneumothorax", "pnömotoraks", "collapsed lung", "kollabe akciğer"],
    src: img("cxr-pneumothorax"),
    caption: { en: "Pneumothorax — absent lung markings, mediastinal shift", tr: "Pnömotoraks — akciğer izlerinin kaybı, mediastinal kayma" },
    attribution: {
      author: "Clinical Cases (clinicalcases.org)",
      license: "CC BY-SA 2.5",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Pneumothorax_CXR.jpg",
    },
  },
  {
    id: "cxr-pleural-effusion",
    modality: "cxr",
    conditionKeys: ["J90", "J91", "pleural effusion", "plevral efüzyon", "plevral sıvı", "effusion", "efüzyon"],
    src: img("cxr-pleural-effusion"),
    caption: { en: "Large pleural effusion (left)", tr: "Büyük plevral efüzyon (sol)" },
    attribution: {
      author: "ClinicalCases.blogspot.com",
      license: "CC BY-SA 2.5",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Left-sided_Pleural_Effusion.jpg",
    },
  },
  {
    id: "cxr-copd",
    modality: "cxr",
    conditionKeys: ["J44", "J43", "copd", "koah", "emphysema", "amfizem", "hyperinflation", "hiperinflasyon", "aecopd"],
    src: img("cxr-copd"),
    caption: { en: "COPD — hyperinflation, flattened diaphragms", tr: "KOAH — hiperinflasyon, düz diyafragma" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:COPD.JPG",
    },
  },

  /* -------------------------------- CT ---------------------------------- */
  {
    id: "ct-ischemic-stroke",
    modality: "ct",
    conditionKeys: [
      "I63", "G45", "ischaemic stroke", "ischemic stroke", "iskemik inme", "cerebral infarction",
      "serebral enfarkt", "mca infarct", "inme", "stroke", "cva",
    ],
    src: img("ct-ischemic-stroke"),
    caption: { en: "Ischaemic stroke — right MCA infarct (CT)", tr: "İskemik inme — sağ MCA enfarktı (BT)" },
    attribution: {
      author: "Lucien Monfils",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:INFARCT.jpg",
    },
  },
  {
    id: "ct-intracerebral-hemorrhage",
    modality: "ct",
    conditionKeys: ["I61", "intracerebral haemorrhage", "intracerebral hemorrhage", "intraserebral kanama", "beyin kanaması", "hemorrhagic stroke", "haematoma", "hematoma"],
    src: img("ct-intracerebral-hemorrhage"),
    caption: { en: "Intracerebral haemorrhage (CT)", tr: "İntraserebral kanama (BT)" },
    attribution: {
      author: "Lucien Monfils",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Intracerebral.jpg",
    },
  },
  {
    id: "ct-subarachnoid-hemorrhage",
    modality: "ct",
    conditionKeys: ["I60", "subarachnoid", "subaraknoid", "thunderclap", "basal cisterns", "aneurysmal", "anevrizma"],
    src: img("ct-subarachnoid-hemorrhage"),
    caption: { en: "Subarachnoid haemorrhage — blood in basal cisterns (CT)", tr: "Subaraknoid kanama — bazal sisternlerde kan (BT)" },
    attribution: {
      author: "Lipothymia (Wikimedia Commons)",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Subarachnoid_haemorrhage.jpg",
    },
  },
  {
    id: "ct-pulmonary-embolism",
    modality: "ct",
    conditionKeys: ["I26", "pulmonary embolism", "pulmoner emboli", "saddle embolus", "eyer emboli", "ctpa", "filling defect"],
    src: img("ct-pulmonary-embolism"),
    caption: { en: "Pulmonary embolism — saddle embolus (CTPA)", tr: "Pulmoner emboli — eyer embolisi (BT anjiyografi)" },
    attribution: {
      author: "Rvahudson",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:CTA_Chest_With_Massive_Pulmonary_Embolism_and_Complete_Occlusion.jpg",
    },
  },
  {
    id: "ct-aortic-dissection",
    modality: "ct",
    conditionKeys: ["I71.0", "I71.00", "I71.01", "aortic dissection", "aort diseksiyonu", "intimal flap", "intimal flep", "stanford"],
    src: img("ct-aortic-dissection"),
    caption: { en: "Aortic dissection — intimal flap (CT)", tr: "Aort diseksiyonu — intimal flep (BT)" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:DissectionCT.png",
    },
  },
  {
    id: "ct-appendicitis",
    modality: "ct",
    conditionKeys: ["K35", "K37", "appendicitis", "apandisit", "appendix", "apendiks"],
    src: img("ct-appendicitis"),
    caption: { en: "Acute appendicitis — dilated appendix (CT)", tr: "Akut apandisit — genişlemiş apendiks (BT)" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:CAT_scan_demonstrating_acute_appendicitis.jpg",
    },
  },
  {
    id: "ct-bowel-obstruction",
    modality: "ct",
    conditionKeys: [
      "K56", "bowel obstruction", "intestinal obstruction", "bağırsak tıkanıklığı", "barsak tıkanıklığı",
      "small bowel obstruction", "sbo", "ileus", "obstruction", "obstrüksiyon", "dilated loops",
    ],
    src: img("ct-bowel-obstruction"),
    caption: { en: "Small bowel obstruction (CT)", tr: "İnce bağırsak tıkanıklığı (BT)" },
    attribution: {
      author: "James Heilman, MD",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:PSBOCT.png",
    },
  },

  /* --------------------------- Abdominal X-ray -------------------------- */
  {
    id: "axr-bowel-obstruction",
    modality: "axr",
    conditionKeys: [
      "K56", "bowel obstruction", "intestinal obstruction", "bağırsak tıkanıklığı", "barsak tıkanıklığı",
      "small bowel obstruction", "sbo", "ileus", "obstruction", "obstrüksiyon", "air-fluid", "air fluid", "dilated loops",
    ],
    src: img("axr-bowel-obstruction"),
    caption: { en: "Bowel obstruction — dilated loops, air-fluid levels (X-ray)", tr: "Bağırsak tıkanıklığı — genişlemiş anslar, hava-sıvı seviyeleri (grafi)" },
    attribution: {
      author: "Igboeze",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:1._Bowel-obstruction-x-ray.jpg",
    },
  },

  /* ----------------------- Ultrasound / echo ---------------------------- */
  {
    // Generic normal ultrasound — the default for a NORMAL/WNL ultrasound read
    // (abdomen / RUQ / FAST / renal / pelvis / DVT), keyed broadly on
    // "ultrasound"/"doppler"/"normal" so an ordered study that reads WNL shows
    // a real normal study rather than the empty state.
    id: "us-abdomen-normal",
    modality: "us",
    conditionKeys: [
      "ultrasound", "us", "sonograph", "doppler", "normal", "no acute", "no free fluid",
      "abdominal ultrasound", "abdomen", "ruq", "right upper quadrant", "biliary", "hepatobiliary",
      "liver", "fast", "trauma", "renal ultrasound", "bladder", "pelvis", "pelvic ultrasound",
    ],
    src: img("us-abdomen-normal"),
    caption: { en: "Abdominal ultrasound — normal (representative)", tr: "Abdominal ultrason — normal (temsili)" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ultrasonography_of_a_normal_liver.jpg",
    },
  },
  {
    id: "echo-normal",
    modality: "us",
    conditionKeys: [
      "echocardiogram", "echocardiography", "echo", "tte", "pocus", "transthoracic echo",
      "cardiac ultrasound", "apical four chamber", "ejection fraction", "four chamber",
    ],
    src: img("echo-normal"),
    caption: { en: "Transthoracic echocardiogram — apical 4-chamber (representative)", tr: "Transtorasik ekokardiyogram — apikal 4 boşluk (temsili)" },
    attribution: {
      author: "Wikimedia Commons",
      license: "Public domain",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Echocardiogram_4chambers.jpg",
    },
  },
  {
    id: "us-cholelithiasis",
    modality: "us",
    conditionKeys: [
      "K80", "gallstone", "gallstones", "cholelithiasis", "gallbladder stone", "cholelith",
      "biliary colic", "cholecystitis", "safra taşı", "kolelitiazis", "kolesistit",
    ],
    src: img("us-cholelithiasis"),
    caption: { en: "Gallbladder ultrasound — gallstone with acoustic shadow", tr: "Safra kesesi ultrasonu — akustik gölgeli safra taşı" },
    attribution: {
      author: "Nevit Dilmen",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ultrasound_image_of_gallbladder_stone_Gallstone_091937515.jpg",
    },
  },
  {
    id: "us-hydronephrosis",
    modality: "us",
    conditionKeys: [
      "N13", "hydronephrosis", "hydroureter", "pelvicalyceal dilatation", "dilated calyces",
      "obstructive uropathy", "ureteric obstruction", "hidronefroz", "hidroüreter",
    ],
    src: img("us-hydronephrosis"),
    caption: { en: "Renal ultrasound — moderate hydronephrosis (dilated calyces)", tr: "Renal ultrason — orta derecede hidronefroz (genişlemiş kalisler)" },
    attribution: {
      author: "Cerevisae",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ultrasound_of_right_kidney_moderate_hydronephrosis.jpg",
    },
  },
  {
    id: "us-aaa",
    modality: "us",
    conditionKeys: [
      "I71", "abdominal aortic aneurysm", "aortic aneurysm", "aaa", "aneurysmal aorta",
      "aneurysm", "abdominal aorta", "aort anevrizması", "anevrizma",
    ],
    src: img("us-aaa"),
    caption: { en: "Aortic ultrasound — abdominal aortic aneurysm (sagittal)", tr: "Aort ultrasonu — abdominal aort anevrizması (sagital)" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ultrasonography_of_abdominal_aortic_aneurysm_in_sagittal_plane.jpg",
    },
  },

  /* -------------------------------- MRI --------------------------------- */
  {
    // Generic normal MRI + normal brain (spine / MRCP reads route to their own
    // region entries below, which outscore this on the region keyword).
    id: "mri-brain-normal",
    modality: "mri",
    conditionKeys: [
      "mri brain", "brain mri", "normal brain", "cranial mri", "intracranial", "cerebral",
      "mri head", "normal", "no acute", "no restricted diffusion", "no acute intracranial",
    ],
    src: img("mri-brain-normal"),
    caption: { en: "Brain MRI — normal, axial T2 (representative)", tr: "Beyin MRG — normal, aksiyel T2 (temsili)" },
    attribution: {
      author: "Novaksean",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Normal_axial_T2-weighted_MR_image_of_the_brain.jpg",
    },
  },
  {
    id: "mri-brain-infarct",
    modality: "mri",
    conditionKeys: [
      "I63", "infarct", "infarction", "ischemic stroke", "ischaemic stroke", "acute stroke",
      "cva", "restricted diffusion", "diffusion restriction", "dwi", "cerebral infarction",
      "middle cerebral artery", "mca infarct", "inme", "iskemik inme", "difüzyon kısıtlılığı",
    ],
    src: img("mri-brain-infarct"),
    caption: { en: "Brain MRI (DWI) — acute infarct, restricted diffusion", tr: "Beyin MRG (DWI) — akut enfarkt, difüzyon kısıtlılığı" },
    attribution: {
      author: "Shazia Mirza and Sankalp Gokhale",
      license: "CC BY 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:DWE_MRI_of_cerebral_infarction.png",
    },
  },
  {
    id: "mri-lspine",
    modality: "mri",
    conditionKeys: [
      "M51", "lumbar spine", "mri lumbar", "lumbar", "l-spine", "lumbosacral", "cauda equina",
      "disc herniation", "lumbar disc", "disc prolapse", "sciatica", "lomber", "disk hernisi",
    ],
    src: img("mri-lspine"),
    caption: { en: "Lumbar spine MRI — sagittal T2 (representative)", tr: "Lomber spinal MRG — sagital T2 (temsili)" },
    attribution: {
      author: "Stillwaterising",
      license: "CC0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Lumbar_MRI_t2-tse-rst-sagittal_05.jpg",
    },
  },
  {
    id: "mri-cspine",
    modality: "mri",
    conditionKeys: [
      "M50", "cervical spine", "mri cervical", "cervical", "c-spine", "cervical disc",
      "degenerative disc", "spondylosis", "osteophyte", "cord compression", "myelopathy",
      "servikal", "boyun", "dejeneratif disk",
    ],
    src: img("mri-cspine"),
    caption: { en: "Cervical spine MRI — degenerative disc disease, sagittal (representative)", tr: "Servikal spinal MRG — dejeneratif disk hastalığı, sagital (temsili)" },
    attribution: {
      author: "Stillwaterising",
      license: "CC BY-SA 3.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Cervical_Spine_MRI_showing_disc_herniation.jpg",
    },
  },
  {
    id: "mri-mrcp",
    modality: "mri",
    conditionKeys: [
      "mrcp", "cholangiopancreatography", "mri abdomen", "biliary tree", "pancreatic duct",
      "common bile duct", "choledocholithiasis", "biliary mri", "koledok", "safra yolları",
    ],
    src: img("mri-mrcp"),
    caption: { en: "MRCP — biliary and pancreatic ducts (representative)", tr: "MRCP — safra ve pankreas kanalları (temsili)" },
    attribution: {
      author: "Hellerhoff",
      license: "CC BY-SA 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:MRCP_Normalbefund_66M_-_MR_-_001.jpg",
    },
  },

  /* -------------------------- CT (normal head) -------------------------- */
  {
    // Normal non-contrast head CT — resolves a WNL head-CT read (e.g. r/o
    // haemorrhage → normal). Region-keyed so it never displaces the CT
    // pathology entries (stroke / ICH / SAH) on an abnormal read.
    id: "ct-head-normal",
    modality: "ct",
    conditionKeys: [
      "ct head", "head ct", "cranial ct", "non-contrast head", "noncontrast head", "normal ct head",
      "no acute intracranial", "no intracranial", "no haemorrhage", "no hemorrhage", "kraniyal bt",
    ],
    src: img("ct-head-normal"),
    caption: { en: "Non-contrast head CT — no acute intracranial abnormality (representative)", tr: "Kontrastsız kraniyal BT — akut intrakraniyal anormallik yok (temsili)" },
    attribution: {
      author: "Mikael Häggström",
      license: "CC0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:CT_of_a_normal_brain,_axial_18.png",
    },
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/** Code-shaped keys (letter then digit, e.g. "I21.3") match the diagnosis code. */
const ICD_LIKE = /^[A-Za-z]\d/;

interface MatchInput {
  /** Diagnosis code (ICD-10), when a full case is available. */
  code?: string;
  /** Lower-cased free text (diagnosis text, display, chief complaint, query). */
  text: string;
}

/**
 * Whole-word-ish containment: the key must start at a non-ASCII-letter boundary
 * so "stemi" does NOT match inside "nstemi", while staying Turkish-suffix
 * friendly (no trailing boundary, so "ödem" still matches "ödemi").
 */
/**
 * Negation cues that flip a finding immediately after them: "no ST elevation",
 * "without effusion", "denies …". Deliberately EXCLUDES "non" so positive keys
 * like "non-st" (NSTEMI) still match. Matched when the cue sits right before the
 * key (`…$`), so a report's negated finding does not score the positive image.
 */
const NEGATION_CUE =
  /(?:^|[^a-z])(no|without|denies|denied|negative|neg|absent|resolved|ruled?\sout|yok|olmayan|saptanmadı|görülmedi|izlenmedi)[\s-]+$/i;

function keywordHit(haystack: string, key: string): boolean {
  const esc = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z])${esc}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    const start = m.index + m[1].length;
    // Count only a NON-negated occurrence: "st depression" scores, but the
    // "st elevation" inside "No ST elevation" must not resolve a STEMI image.
    if (!NEGATION_CUE.test(haystack.slice(Math.max(0, start - 20), start))) return true;
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1; // guard against stalls
  }
  return false;
}

function scoreEntry(entry: CuratedImaging, input: MatchInput): number {
  const codeUpper = (input.code ?? "").toUpperCase();
  let score = 0;
  for (const key of entry.conditionKeys) {
    if (ICD_LIKE.test(key)) {
      if (codeUpper && codeUpper.startsWith(key.toUpperCase())) score += 6;
    } else if (keywordHit(input.text, key)) {
      // Prefer more specific (multi-word) keys slightly.
      score += key.includes(" ") ? 2 : 1;
    }
  }
  return score;
}

function pickBest(
  isAllowed: (m: ImagingModality) => boolean,
  input: MatchInput,
): CuratedImaging | null {
  let best: CuratedImaging | null = null;
  let bestScore = 0;
  for (const entry of CURATED_IMAGING) {
    if (!isAllowed(entry.modality)) continue;
    const score = scoreEntry(entry, input);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

/**
 * Resolve the best curated study for a case, optionally constrained to one
 * modality. Matches the case's correctDiagnosis (ICD-10 code + EN/TR text) and
 * chief complaint against each entry's `conditionKeys`.
 *
 * @returns the best-matching curated image, or `null` when nothing matches.
 */
export function resolveConditionImaging(
  caseInstance: CaseInstance,
  modality?: ImagingModality,
): CuratedImaging | null {
  const dx = caseInstance.correctDiagnosis;
  const coding = dx.code.coding[0];
  const text = [
    dx.code.text?.en,
    dx.code.text?.tr,
    coding?.display,
    caseInstance.chiefComplaint?.en,
    caseInstance.chiefComplaint?.tr,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const input: MatchInput = { code: coding?.code, text };
  const isAllowed = modality ? (m: ImagingModality) => m === modality : () => true;
  return pickBest(isAllowed, input);
}

/** Map a short modality label (e.g. "ECG", "CT", "US", "MRI", "X-ray") + query
 *  text to the curated modality buckets it may resolve to. `null` → allow every
 *  modality (unknown label). Every modality we classify is now curated. */
function bucketsForLabel(label: string, text: string): ImagingModality[] | null {
  const l = label.toLowerCase();
  if (/ecg|ekg|electrocardio|elektrokardi/.test(l)) return ["ecg"];
  if (/\bct\b|ctpa|tomograph|angiogram|angiography|bt\b/.test(l)) return ["ct"];
  // MRI + ultrasound/echo must be classified BEFORE the x-ray branch: labels
  // like "MRI abdomen / MRCP" and "Ultrasound abdomen" contain "abdom", which
  // the x-ray branch would otherwise mis-route to AXR.
  if (/mri|magnetic|mrcp/.test(l)) return ["mri"];
  if (/ultrasound|\bus\b|doppler|echo|sonograph|pocus/.test(l)) return ["us"];
  if (/x-?ray|radiograph|cxr|axr|kub|grafi|röntgen|roentgen|chest|abdom|akciğer|karın/.test(l)) {
    return /abdom|bowel|ileus|obstruction|obstrüksiyon|kub|karın|bağırsak|barsak|tıkan/.test(text)
      ? ["axr"]
      : ["cxr"];
  }
  return null;
}

/**
 * Resolve a curated study from the free-text query + short modality label that
 * `ConditionImage` already receives (keeps that component's public API stable).
 * Keyword-only match (no ICD code available on this path).
 *
 * @returns the best-matching curated image, or `null` (→ fall back to live).
 */
export function resolveCuratedImagingByText(
  query: string,
  modalityLabel?: string,
): CuratedImaging | null {
  const text = (query ?? "").toLowerCase();
  if (!text.trim()) return null;
  const buckets = bucketsForLabel((modalityLabel ?? "").toLowerCase() + " " + text, text);
  if (buckets && buckets.length === 0) return null; // defensive — no empty buckets today
  const isAllowed = buckets ? (m: ImagingModality) => buckets.includes(m) : () => true;
  return pickBest(isAllowed, { text });
}

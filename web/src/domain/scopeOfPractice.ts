/**
 * AcuDx — role scope of practice for ordering in a team room.
 *
 * Review 02 finding 24 (major): the nurse seat was `canOrder: false` with no
 * exceptions, so the 10-minute door-to-ECG target was structurally unreachable
 * without the doctor. Triage nurses initiate 12-lead ECG, point-of-care
 * glucose, IV access, oxygen, urine hCG and standard bloods under standing
 * protocols (nurse-driven triage ECG protocols, AJEM 2018
 * https://www.ajemjournal.com/article/S0735-6757(18)30097-4/fulltext ; ESC 2023
 * ACS 10-minute ECG https://doi.org/10.1093/eurheartj/ehad191).
 *
 * Review 02 finding 25 (major): the paramedic had one canned handover and no
 * prehospital interventions. The paramedic set follows the NHTSA National EMS
 * Scope of Practice Model 2019 (DOT HS 812 666)
 * https://www.ems.gov/assets/National_EMS_Scope_of_Practice_Model_2019.pdf :
 * 12-lead acquisition, oxygen, aspirin, GTN, naloxone, IM adrenaline,
 * salbutamol, glucose, IV access / fluids, CPR and defibrillation.
 *
 * Pure data + predicates. Education only.
 */

import type { ClinicalRole } from "@/data/rooms";

/** Codes the NURSE may initiate per standing protocol (posts as nurse-initiated). */
export const NURSE_PROTOCOL_ORDERS: ReadonlySet<string> = new Set([
  "11524-6", // 12-lead ECG
  "poc-glucose", // point-of-care glucose
  "2339-0", // glucose (POC) analyte code
  "iv-access", // peripheral IV access
  "7806", // oxygen (titrated)
  "urine-hcg", // urine pregnancy test
  "6690-2", // CBC draw
  "2160-0", // BMP / creatinine draw
  "67151-1", // hs-troponin draw
  "monitoring", // continuous cardiac monitoring
]);

/** Prehospital interventions the PARAMEDIC may perform and record. */
export const PARAMEDIC_INTERVENTIONS: ReadonlySet<string> = new Set([
  "11524-6", // 12-lead acquisition and transmission
  "7806", // oxygen
  "1191", // aspirin
  "4917", // GTN
  "7242", // naloxone
  "3992-im", // IM adrenaline
  "435", // salbutamol
  "poc-glucose", // glucose check
  "iv-access", // IV / IM access
  "313002", // IV fluids
  "cpr-defib", // CPR and defibrillation
]);

/** Stable ids for the protocol items that are not laboratory / medication codes. */
export const PROTOCOL_ITEM_LABELS: Record<string, { en: string; tr: string }> = {
  "iv-access": { en: "Peripheral IV access", tr: "Periferik damar yolu" },
  "urine-hcg": { en: "Urine hCG", tr: "İdrar hCG" },
  monitoring: { en: "Continuous cardiac monitoring", tr: "Sürekli kardiyak monitörizasyon" },
  "cpr-defib": { en: "CPR and defibrillation", tr: "KPR ve defibrilasyon" },
};

/**
 * May `role` place `code` for the team? The doctor may order anything; the
 * nurse only standing-protocol items; the paramedic only prehospital
 * interventions. Server-enforced in production, mirrored here for the UI.
 */
export function canPlaceOrder(role: ClinicalRole, code: string): boolean {
  if (role === "doctor") return true;
  if (role === "nurse") return NURSE_PROTOCOL_ORDERS.has(code);
  if (role === "paramedic") return PARAMEDIC_INTERVENTIONS.has(code);
  return false;
}

/** The set of codes a role may place, for building its chip list. */
export function orderableCodesFor(role: ClinicalRole, catalogue: readonly string[]): string[] {
  return catalogue.filter((code) => canPlaceOrder(role, code));
}

/** Label suffix recorded on an order placed under protocol by a non-doctor. */
export function protocolDetailFor(role: ClinicalRole): { en: string; tr: string } | undefined {
  if (role === "nurse") return { en: "Nurse-initiated per protocol", tr: "Protokole göre hemşire tarafından başlatıldı" };
  if (role === "paramedic") return { en: "Prehospital intervention", tr: "Hastane öncesi girişim" };
  return undefined;
}

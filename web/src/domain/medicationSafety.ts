/**
 * AcuDx — medication administration safety (five rights + allergy check).
 *
 * Review 02 finding 9 (critical): a medication was "administered" by clicking
 * a chip; dose and route were optional, allergies were never checked and no
 * administration record existed. This module is the pure core the encounter
 * store runs BEFORE any treatment effect is applied:
 *
 *   - `MedicationOrder` is the complete order (drug, dose, unit, route,
 *     frequency, indication). An order without a dose or route is rejected.
 *   - `allergyCrossCheck` matches the patient's documented allergies against the
 *     formulary allergy class (including cross-reacting classes).
 *   - `fiveRightsCheck` verifies right patient, drug, dose, route and time and
 *     produces the checks stored on the `MedicationAdministrationRecord`.
 *
 * Citations: Joint Commission NPSG.03.06.01 (medication information including
 * dose and route) https://www.jointcommission.org/-/media/tjc/documents/standards/national-patient-safety-goals/2023/npsg_chapter_ahc_jul2023.pdf ;
 * AHRQ PSNet medication administration errors primer
 * https://psnet.ahrq.gov/primer/medication-administration-errors
 *
 * Pure and deterministic. Education only. No real patient data path.
 */

import type { AllergyIntolerance } from "@/domain/fhir";
import { formularyFor, type FormularyEntry, type Route } from "@/domain/formulary";

/** A complete medication order. Every field the MAR needs is required. */
export interface MedicationOrder {
  /** Treatment catalogue / formulary code (RxNorm or stable synthetic id). */
  drug: string;
  dose: number;
  unit: string;
  route: Route;
  /** Free-text frequency / repeat instruction (e.g. "once", "q5min x3"). */
  frequency: string;
  indication: string;
  /** Patient weight in kg when the dose is weight-based or weight-checked. */
  weightKg?: number;
}

export type RightKey = "patient" | "drug" | "dose" | "route" | "time";

export type SafetyFailureCode =
  | "missing-dose"
  | "missing-route"
  | "unknown-drug"
  | "wrong-patient"
  | "allergy-conflict"
  | "route-not-permitted"
  | "dose-below-range"
  | "dose-above-max"
  | "dose-exceeds-daily-max"
  | "repeat-too-soon"
  | "unit-mismatch";

export interface SafetyFailure {
  right: RightKey;
  code: SafetyFailureCode;
  /** Blocking failures stop administration; non-blocking ones are flagged. */
  blocking: boolean;
  /** Human-readable detail for the MAR / debrief (English; UI translates by code). */
  detail: string;
}

export interface FiveRightsResult {
  ok: boolean;
  rights: Record<RightKey, boolean>;
  failures: SafetyFailure[];
}

export interface AllergyMatch {
  conflict: boolean;
  /** The allergy text that matched, when a conflict was found. */
  matched?: string;
  /** The formulary keyword that matched. */
  keyword?: string;
  criticality?: AllergyIntolerance["criticality"];
}

export type MarOutcome = "given" | "blocked" | "flagged";

/** One line of the medication administration record (encounter event "mar"). */
export interface MedicationAdministrationRecord {
  id: string;
  order: MedicationOrder;
  patientId: string;
  /** Role that administered (doctor in the solo encounter; nurse / paramedic in a room). */
  administeredBy: string;
  /** Encounter-clock offset in ms. */
  at: number;
  checks: FiveRightsResult;
  allergy: AllergyMatch;
  outcome: MarOutcome;
}

/* -------------------------------------------------------------------------- */
/* Allergy cross-check                                                        */
/* -------------------------------------------------------------------------- */

const NO_KNOWN = /no known|nkda|bilinen.*yok|alerji yok|allergy.*none/i;

function allergyTexts(a: AllergyIntolerance): string[] {
  const out: string[] = [];
  for (const c of a.code.coding) if (c.display) out.push(c.display);
  if (a.code.text) out.push(a.code.text.en, a.code.text.tr);
  if (a.reaction) out.push(a.reaction.en, a.reaction.tr);
  return out.filter(Boolean);
}

/**
 * Does the patient's allergy list name this drug or a cross-reacting class?
 * A "No known drug allergies" entry never conflicts.
 */
export function allergyCrossCheck(
  drugCode: string,
  allergies: AllergyIntolerance[],
  entry: FormularyEntry | undefined = formularyFor(drugCode),
): AllergyMatch {
  if (!entry || entry.allergyClass.length === 0) return { conflict: false };
  for (const a of allergies) {
    for (const text of allergyTexts(a)) {
      if (NO_KNOWN.test(text)) continue;
      const hay = text.toLowerCase();
      for (const kw of entry.allergyClass) {
        if (hay.includes(kw.toLowerCase())) {
          return { conflict: true, matched: text, keyword: kw, criticality: a.criticality };
        }
      }
    }
  }
  return { conflict: false };
}

/* -------------------------------------------------------------------------- */
/* Five rights                                                                 */
/* -------------------------------------------------------------------------- */

export interface FiveRightsContext {
  /** The patient the order was written for. */
  orderedForPatientId: string;
  /** The patient at the bedside (identity check). */
  bedsidePatientId: string;
  allergies: AllergyIntolerance[];
  weightKg?: number;
  /** Prior administrations of ANY drug this encounter (for interval + daily max). */
  priorMar: MedicationAdministrationRecord[];
  nowMs: number;
}

function unitsCompatible(a: string, b: string): boolean {
  const n = (u: string) => u.trim().toLowerCase().replace("mcg", "µg").replace("micrograms", "µg");
  return n(a) === n(b);
}

/**
 * Verify the five rights for an order. Missing dose / route, an allergy
 * conflict, a wrong patient and a dose above the ceiling BLOCK; a dose below
 * the usual range, a route outside the formulary list and a too-early repeat
 * are FLAGGED (administration proceeds, the error is scored).
 */
export function fiveRightsCheck(order: MedicationOrder, ctx: FiveRightsContext): FiveRightsResult {
  const failures: SafetyFailure[] = [];
  const rights: Record<RightKey, boolean> = { patient: true, drug: true, dose: true, route: true, time: true };
  const fail = (right: RightKey, code: SafetyFailureCode, blocking: boolean, detail: string) => {
    rights[right] = false;
    failures.push({ right, code, blocking, detail });
  };

  const entry = formularyFor(order.drug);

  // Right patient.
  if (ctx.orderedForPatientId !== ctx.bedsidePatientId) {
    fail("patient", "wrong-patient", true, `Order written for ${ctx.orderedForPatientId}, patient at the bedside is ${ctx.bedsidePatientId}.`);
  }

  // Right drug: known to the formulary and not on the allergy list.
  if (!entry) {
    fail("drug", "unknown-drug", true, `No formulary entry for ${order.drug}.`);
  } else {
    const allergy = allergyCrossCheck(order.drug, ctx.allergies, entry);
    if (allergy.conflict) {
      fail("drug", "allergy-conflict", true, `Documented allergy: ${allergy.matched} (matches ${allergy.keyword}).`);
    }
  }

  // Right dose.
  if (!(typeof order.dose === "number" && Number.isFinite(order.dose) && order.dose > 0)) {
    fail("dose", "missing-dose", true, "A dose is required before administration.");
  } else if (entry) {
    if (!unitsCompatible(order.unit, entry.dose.unit)) {
      fail("dose", "unit-mismatch", true, `Dose unit ${order.unit} does not match the formulary unit ${entry.dose.unit}.`);
    } else {
      const weight = order.weightKg ?? ctx.weightKg;
      // Weight-based units (mg/kg, units/kg/h) are checked per kg; absolute units
      // are checked against the adult range and the per-kg ceiling when known.
      const perKgUnit = /\/kg/.test(entry.dose.unit);
      if (order.dose > entry.dose.max && !perKgUnit) {
        fail("dose", "dose-above-max", true, `${order.dose} ${order.unit} exceeds the maximum single dose of ${entry.dose.max} ${entry.dose.unit}.`);
      } else if (order.dose > entry.dose.max) {
        fail("dose", "dose-above-max", true, `${order.dose} ${order.unit} exceeds ${entry.dose.max} ${entry.dose.unit}.`);
      } else if (order.dose < entry.dose.min) {
        fail("dose", "dose-below-range", false, `${order.dose} ${order.unit} is below the usual range (${entry.dose.min}-${entry.dose.max} ${entry.dose.unit}).`);
      }
      if (entry.maxPerDay != null && !perKgUnit) {
        const dayAgo = ctx.nowMs - 24 * 60 * 60_000;
        const given = ctx.priorMar
          .filter((m) => m.order.drug === order.drug && m.outcome !== "blocked" && m.at >= dayAgo)
          .reduce((sum, m) => sum + m.order.dose, 0);
        if (given + order.dose > entry.maxPerDay) {
          fail("dose", "dose-exceeds-daily-max", true, `Cumulative ${given + order.dose} ${entry.dose.unit} would exceed the 24 h maximum of ${entry.maxPerDay} ${entry.dose.unit}.`);
        }
      }
      if (
        entry.dose.perKg != null &&
        weight != null &&
        !perKgUnit &&
        (entry.dose.perKgBelowKg == null || weight < entry.dose.perKgBelowKg)
      ) {
        const ceiling = entry.dose.perKg * weight;
        if (order.dose > ceiling && order.dose > entry.dose.min) {
          fail("dose", "dose-above-max", true, `${order.dose} ${order.unit} exceeds ${entry.dose.perKg} ${entry.dose.unit}/kg for ${weight} kg (${Math.round(ceiling)} ${entry.dose.unit}).`);
        }
      }
    }
  }

  // Right route.
  if (!order.route) {
    fail("route", "missing-route", true, "A route is required before administration.");
  } else if (entry && !entry.routes.includes(order.route)) {
    fail("route", "route-not-permitted", false, `${order.route} is not a formulary route for this drug (${entry.routes.join(", ")}).`);
  }

  // Right time: minimum interval since the last given dose of the same drug.
  if (entry && entry.minIntervalMs > 0) {
    const last = ctx.priorMar
      .filter((m) => m.order.drug === order.drug && m.outcome !== "blocked")
      .reduce<number | null>((acc, m) => (acc == null ? m.at : Math.max(acc, m.at)), null);
    if (last != null && ctx.nowMs - last < entry.minIntervalMs) {
      fail("time", "repeat-too-soon", false, `Repeated ${Math.round((ctx.nowMs - last) / 60_000)} min after the last dose; the minimum interval is ${Math.round(entry.minIntervalMs / 60_000)} min.`);
    }
  }

  return { ok: failures.every((f) => !f.blocking), rights, failures };
}

/** Outcome classification for a MAR line from its checks. */
export function marOutcome(checks: FiveRightsResult): MarOutcome {
  if (!checks.ok) return "blocked";
  return checks.failures.length > 0 ? "flagged" : "given";
}

/**
 * Build a complete order from the formulary defaults (used by the legacy
 * one-click path and the room task queue so they still carry dose + route).
 */
export function defaultOrderFor(code: string, weightKg?: number): MedicationOrder | null {
  const e = formularyFor(code);
  if (!e) return null;
  return {
    drug: code,
    dose: e.dose.default,
    unit: e.dose.unit,
    route: e.defaultRoute,
    frequency: e.frequency.en,
    indication: e.indication.en,
    ...(weightKg != null ? { weightKg } : {}),
  };
}

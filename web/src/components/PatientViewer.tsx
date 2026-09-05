/**
 * AcuDx — PatientViewer: the enlarged, symptom-aware patient modal.
 *
 * Opened from the small storyboard / flowsheet patient visual (see
 * PatientPhoto's `onClick`). It LEADS with the realistic, demographic-matched
 * PatientPhoto — large, the same unified identity (`resolvePatientVisual`: the
 * case patient's name + one distinct face) every other surface shows — with the
 * live physiology made clearly visible on it (pallor / cyanosis / diaphoresis /
 * fever / distress, breathing at the live RR). Beside it sits a concise LIVE
 * clinical-sign summary + current vitals, so the visual always reflects the
 * patient's clinical picture — not a static label. The crude procedural 3D head
 * is no longer shown here; the realistic photo is the star.
 *
 * This file also exports the shared `describeVitalSigns` + `photoSignsFromVitals`
 * helpers and the `SymptomSummary` component so every patient visual shows the
 * same live signs off the same source.
 *
 * Accessible: role="dialog" + aria-modal, focus trap, Escape to close, focus
 * restored to the trigger on close. Reduced-motion aware (media components honor
 * it themselves; the panel's own entrance is motion-safe only).
 *
 * Education only. Synthetic patient — no real patient data path.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, Pulse } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { PatientPhoto, type ClinicalSignHint } from "@/components/PatientPhoto";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import { signsFromVitals } from "@/components/ehr/PatientAvatar";
import {
  getCurrentVitals,
  useEncounterState,
} from "@/state/encounterStore";
import type { CaseInstance, TriageVitals } from "@/domain/case";
import type { CurrentVitals } from "@/domain/clinicalCourse";

/* -------------------------------------------------------------------------- */
/* Live clinical-sign summary (single source of truth for all patient visuals) */
/* -------------------------------------------------------------------------- */

/** The 6 vitals every summary needs (superset of TriageVitals / CurrentVitals). */
export interface VitalsLike {
  hr: number;
  systolic: number;
  diastolic: number;
  rr: number;
  spo2: number;
  tempC: number;
}

/** A concise clinical-sign token (i18n key `patientviewer.signs.<token>`). */
export type VitalSignToken =
  | "distress"
  | "cyanotic"
  | "hypoxic"
  | "hypotensive"
  | "hypertensive"
  | "tachycardic"
  | "bradycardic"
  | "diaphoretic"
  | "pale"
  | "febrile"
  | "hypothermic";

/**
 * Derive a short, priority-ordered clinical-sign summary from the LIVE vitals.
 * Built on `signsFromVitals` (the canonical cyanosis / respiratory-distress /
 * diaphoresis channel) so the words never contradict the portrait tint or the
 * monitor, then augmented with the obvious vitals-threshold descriptors
 * (tachycardic / pale / febrile …). Pure + deterministic; capped to `max` tokens
 * so the summary stays scannable.
 */
export function describeVitalSigns(v: VitalsLike, max = 4): VitalSignToken[] {
  const channel = signsFromVitals(v);
  const intensity = (kind: string): number =>
    channel.find((s) => s.sign === kind)?.intensity ?? 0;
  const cyanosis = intensity("cyanosis");
  const distress = intensity("respiratory-distress");
  const diaphoresis = intensity("diaphoresis");

  // [token, active?] in clinical-salience order. `pale` is reserved for mild
  // hypoperfusion so it never doubles up with `hypotensive` (< 90).
  const candidates: Array<[VitalSignToken, boolean]> = [
    ["cyanotic", cyanosis > 0.15],
    ["distress", distress > 0.15],
    ["hypoxic", v.spo2 < 92 && cyanosis <= 0.15],
    ["hypotensive", v.systolic < 90],
    ["tachycardic", v.hr >= 100],
    ["bradycardic", v.hr < 55],
    ["hypertensive", v.systolic >= 180],
    ["diaphoretic", diaphoresis > 0.15],
    ["pale", v.systolic >= 90 && v.systolic < 105],
    ["febrile", v.tempC >= 38],
    ["hypothermic", v.tempC < 35.5],
  ];

  const tokens: VitalSignToken[] = [];
  for (const [token, active] of candidates) {
    if (active && !tokens.includes(token)) tokens.push(token);
    if (tokens.length >= max) break;
  }
  return tokens;
}

/**
 * The full physiology sign channel for the realistic PHOTO: the canonical
 * cyanosis / respiratory-distress / diaphoresis channel (`signsFromVitals`)
 * augmented with pallor, fever (warm flush) and reduced-LOC so every live sign
 * is visible on the face, not just the three the base channel emits. Pure +
 * deterministic; thresholds mirror the physiology engine so the tint never
 * contradicts the monitor or the summary words. Shared by all patient surfaces.
 */
export function photoSignsFromVitals(v: VitalsLike): ClinicalSignHint[] {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const map = new Map<string, number>();
  // Take the STRONGEST intensity for each sign so nothing ever contradicts the
  // canonical channel, and a genuinely symptomatic patient reads clearly on the
  // face. `raise` only records a sign once it is actually present.
  const raise = (sign: string, intensity: number) => {
    const i = clamp01(intensity);
    if (i <= 0.001) return;
    map.set(sign, Math.max(map.get(sign) ?? 0, i));
  };

  // Start from the canonical cyanosis / respiratory-distress / diaphoresis
  // channel so the words, monitor and portrait agree at the low end.
  for (const s of signsFromVitals(v)) raise(s.sign, s.intensity);

  // Then STRENGTHEN every channel with steeper slopes so a truly tachycardic /
  // diaphoretic / hypotensive / distressed / hypoxic / febrile patient lands
  // well above the ~0.4 "clearly visible" mark, while a stable patient (HR ~75,
  // BP ~120/80, RR ~14, SpO2 ~98, 37.0 °C) yields nothing at all.
  raise("cyanosis", (95 - v.spo2) / 8); // SpO2 90 → 0.63, 88 → 0.88
  raise("respiratory-distress", (v.rr - 18) / 12); // RR 24 → 0.50, 28 → 0.83
  raise(
    "diaphoresis",
    Math.max((v.hr - 95) / 28, (90 - v.systolic) / 45), // HR 110 → 0.54; clammy shock
  );
  raise("pallor", (110 - v.systolic) / 40); // sys 100 → 0.25, 90 → 0.50, 80 → 0.75
  raise("fever", (v.tempC - 37.7) / 2); // 38.5 → 0.40, 39.0 → 0.65
  raise("reduced-loc", Math.max((88 - v.spo2) / 16, (85 - v.systolic) / 26)); // severe only

  const out: ClinicalSignHint[] = [];
  for (const [sign, intensity] of map) out.push({ sign, intensity });
  return out;
}

export interface SymptomSummaryProps {
  /** Live vitals to summarize (falls back to triage before the clock starts). */
  vitals: VitalsLike;
  /** "inline" — a single dotted line; "pills" — wrapped chips (for the modal). */
  variant?: "inline" | "pills";
  className?: string;
}

/**
 * SymptomSummary — the concise live clinical-sign line/chips shared by the small
 * storyboard/flowsheet visuals and the enlarged viewer. Text carries the meaning
 * (never color alone); an empty picture reads as "No acute distress".
 */
export function SymptomSummary({
  vitals,
  variant = "inline",
  className,
}: SymptomSummaryProps) {
  const { t } = useTranslation();
  const tokens = describeVitalSigns(vitals);
  const labels =
    tokens.length > 0
      ? tokens.map((tok) => t(`patientviewer.signs.${tok}`))
      : [t("patientviewer.signs.stable")];

  if (variant === "pills") {
    return (
      <ul
        className={cn("flex flex-wrap gap-1.5", className)}
        aria-label={t("patientviewer.summaryLabel")}
      >
        {labels.map((label, i) => (
          <li
            key={i}
            className="inline-flex items-center rounded-pill border border-border bg-bg-subtle px-2 py-0.5 text-xs font-medium text-fg"
          >
            {label}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p
      className={cn("flex items-center gap-1 text-[11px] leading-tight", className)}
      aria-label={t("patientviewer.summaryLabel")}
    >
      <Pulse weight="bold" className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{labels.join(" · ")}</span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Focus management                                                            */
/* -------------------------------------------------------------------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export interface PatientViewerProps {
  open: boolean;
  onClose: () => void;
  caseInstance: CaseInstance;
  /** Persona affect label (context line under the name). */
  affectLabel?: string;
}

/** A compact current-vitals readout so the summary ties back to the numbers. */
function VitalsLine({ vitals }: { vitals: VitalsLike }) {
  const { t } = useTranslation();
  const cells: Array<{ label: string; value: string; unit?: string }> = [
    { label: t("vitals.hrShort"), value: String(vitals.hr), unit: t("vitals.units.bpm") },
    { label: t("vitals.bpShort"), value: `${vitals.systolic}/${vitals.diastolic}` },
    { label: t("vitals.rrShort"), value: String(vitals.rr), unit: t("vitals.units.brpm") },
    { label: t("vitals.spo2Short"), value: String(vitals.spo2), unit: t("vitals.units.percent") },
    { label: t("vitals.tempShort"), value: vitals.tempC.toFixed(1), unit: t("vitals.units.celsius") },
  ];
  return (
    <dl
      className="grid grid-cols-3 gap-2 sm:grid-cols-5"
      aria-label={t("patientviewer.vitalsLabel")}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-control border border-border bg-bg-subtle px-2 py-1.5"
        >
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">
            {c.label}
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">
            {c.value}
            {c.unit ? (
              <span className="ms-0.5 text-[10px] font-medium text-muted">{c.unit}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

export function PatientViewer({
  open,
  onClose,
  caseInstance,
  affectLabel,
}: PatientViewerProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Live vitals from the SAME store the bedside monitor reads. Guard on the case
  // id so we never show another encounter's numbers; fall back to triage before
  // the encounter clock starts (or when this case isn't the active one).
  const state = useEncounterState();
  const storeVitals =
    state.caseInstance?.id === caseInstance.id ? getCurrentVitals(state) : null;
  const vitals: CurrentVitals | TriageVitals = storeVitals ?? caseInstance.triageVitals;
  // Full physiology channel so pallor / fever / reduced-LOC show on the photo too.
  const signs = photoSignsFromVitals(vitals);

  const { patient } = caseInstance;
  // The ONE unified identity — same distinct face + case name as every other surface.
  const visual = resolvePatientVisual(caseInstance);

  // Focus trap + Escape + scroll lock; restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusId = window.setTimeout(() => {
      const focusables = focusableWithin(panel);
      (focusables[0] ?? panel)?.focus();
    }, 0);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = focusableWithin(panel);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(focusId);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/60 motion-safe:animate-[fade-up_0.2s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-y-auto",
          "rounded-t-card border border-border bg-surface p-5 shadow-soft-md sm:rounded-card sm:p-6",
          "focus-visible:outline-none motion-safe:animate-[fade-up_0.24s_ease-out]",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-lg font-semibold tracking-tight text-fg"
            >
              {t("patientviewer.title", { name: patient.name })}
            </h2>
            {affectLabel ? (
              <p className="mt-1 truncate text-sm italic text-muted">{affectLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("patientviewer.close", { defaultValue: t("actions.close") })}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X weight="bold" className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* LEAD with the realistic, symptom-tinted, breathing patient — the live
            clinical-signs surface — with the sign summary + current vitals beside
            it (stacked on mobile). The crude procedural 3D head is no longer the
            primary visual here; the realistic photo is the star. */}
        <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr]">
          <Panel label={t("patientviewer.signsLabel")}>
            {/* Same distinct face + case name as every other surface; the live
                vitals course tints pallor / cyanosis / diaphoresis / fever /
                distress and drives the breathing cadence. */}
            <PatientPhoto
              sex={visual.sexAtBirth}
              age={visual.age}
              photoId={visual.photoId}
              signs={signs}
              rr={vitals.rr}
              alt={t("patientviewer.syntheticNote")}
              caption={patient.name}
              className="aspect-[4/5] w-full ring-1 ring-border"
            />
          </Panel>

          <div className="flex flex-col gap-3 rounded-card border border-border bg-bg-subtle/40 p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {t("patientviewer.summaryLabel")}
                </span>
                <span className="text-[10px] italic text-muted">
                  {t("patientviewer.reflectsLive")}
                </span>
              </div>
              <SymptomSummary vitals={vitals} variant="pills" />
            </div>
            <VitalsLine vitals={vitals} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * AcuDx — DebriefReport: the "Attending debrief" after-action report (GH #110).
 *
 * Renders a {@link Debrief} (built by the pure src/domain/debrief.ts) as a clean,
 * process-aware report shown once a working diagnosis is committed in the A&P tab.
 * It grades the CLINICAL PROCESS — diagnosis verdict, red-flag danger signs caught
 * vs missed, work-up appropriateness (over-/under-ordering), time-to-decision and
 * 1-3 teaching points — never merely "right / wrong".
 *
 * Presented as a modal dialog mirroring PatientViewer's a11y pattern: role="dialog"
 * + aria-modal, focus trap, Escape to close, scroll lock, focus restored to the
 * trigger on close. A "Print / export" action calls window.print(); `print:`
 * utilities collapse the modal chrome so the report prints as a plain page.
 *
 * Case-authored labels (red-flag evidence, work-up names) are Bilingual and
 * resolved to the active language here; the other 10 languages fall back to the
 * en/tr feature strings via i18next `fallbackLng` + `defaultValue`.
 *
 * Education only. Synthetic patient — no real patient data path.
 */

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Printer,
  CheckCircle,
  WarningCircle,
  XCircle,
  ShieldWarning,
  Clock,
  GraduationCap,
  Flag,
  Flask,
  Target,
  ArrowRight,
} from "@phosphor-icons/react";

import { Badge, Button, Card, Divider, SectionLabel, Stat, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Bilingual, Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";
import type { Debrief, DxVerdict, TeachingPoint, WorkupItem } from "@/domain/debrief";
import { getDiagnosis } from "@/domain/diagnosisCatalog";

/* -------------------------------------------------------------------------- */
/* Verdict presentation                                                        */
/* -------------------------------------------------------------------------- */

type BadgeTone = "normal" | "caution" | "warning";

const VERDICT_META: Record<
  DxVerdict,
  { tone: BadgeTone; tag: string; body: string; Icon: typeof CheckCircle }
> = {
  correct: { tone: "normal", tag: "correct", body: "correctBody", Icon: CheckCircle },
  "near-miss": { tone: "caution", tag: "nearMiss", body: "nearMissBody", Icon: WarningCircle },
  incorrect: { tone: "warning", tag: "incorrect", body: "incorrectBody", Icon: XCircle },
};

const bannerTint: Record<BadgeTone, string> = {
  normal:
    "border-[color:var(--state-normal)]/30 bg-[color-mix(in_srgb,var(--state-normal)_10%,transparent)]",
  caution:
    "border-[color:var(--state-caution)]/30 bg-[color-mix(in_srgb,var(--state-caution)_10%,transparent)]",
  warning:
    "border-[color:var(--state-warning)]/30 bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)]",
};

/* -------------------------------------------------------------------------- */
/* Focus management (mirrors PatientViewer)                                    */
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
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface DebriefReportProps {
  debrief: Debrief;
  caseInstance: CaseInstance;
  onClose?: () => void;
  /** Optional: hand the learner off to the full feedback report (kept alongside onClose). */
  onViewReport?: () => void;
}

/** Render an ICD-10 (+ICD-11) code line for a committed diagnosis code. */
function codeLine(code: string): string {
  const entry = getDiagnosis(code);
  if (!entry) return code;
  return `${entry.icd10}${entry.icd11 ? ` · ${entry.icd11}` : ""}`;
}

export function DebriefReport({ debrief, caseInstance, onClose, onViewReport }: DebriefReportProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const lang: Lang = i18n.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
  const L = (b: Bilingual): string => b[lang] ?? b.en ?? "";

  // Always call the latest onClose without re-running the mount-once effect below.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = () => onCloseRef.current?.();

  // Focus trap + Escape + scroll lock; restore focus to the trigger on unmount.
  // Runs once: the parent mounts/unmounts this modal, so mount === open.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusId = window.setTimeout(() => {
      const focusables = focusableWithin(panel);
      (focusables[0] ?? panel)?.focus();
    }, 0);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = VERDICT_META[debrief.dxVerdict];
  const { caught, missed } = debrief.redFlags;
  const hasRedFlags = caught.length + missed.length > 0;
  const { appropriate, expected, overOrdered, underOrdered } = debrief.workup;
  const workupClean = overOrdered.length === 0 && underOrdered.length === 0;
  const minutes = Math.max(0, Math.round(debrief.timeToCommitMs / 60000));
  const coveragePct = Math.round(debrief.historyCoveragePct * 100);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center print:static print:block sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/60 motion-safe:animate-[fade-up_0.2s_ease-out] print:hidden"
        onClick={close}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto",
          "rounded-t-card border border-border bg-surface p-5 shadow-soft-md sm:rounded-card sm:p-6",
          "focus-visible:outline-none motion-safe:animate-[fade-up_0.24s_ease-out]",
          "print:static print:max-h-none print:w-full print:max-w-none print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-brand">{t("debrief.eyebrow", { defaultValue: "After-action" })}</p>
            <h2 id={titleId} className="mt-0.5 truncate text-lg font-semibold tracking-tight text-fg">
              {t("debrief.title", { defaultValue: "Attending debrief" })}
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">
              {t("debrief.subtitle", {
                defaultValue: "How you ran the case — the process behind the diagnosis.",
              })}
            </p>
            <p className="mt-1 truncate text-xs text-subtle">
              {t("debrief.forPatient", {
                name: caseInstance.patient.name,
                defaultValue: "Patient: {{name}}",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("debrief.close", { defaultValue: "Close" })}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg print:hidden"
          >
            <X weight="bold" className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Verdict banner */}
        <div className={cn("mt-4 rounded-card border p-4", bannerTint[meta.tone])}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow text-muted">
                {t("debrief.committedLabel", { defaultValue: "Your working diagnosis" })}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-fg">{debrief.dxDisplay}</p>
              <p className="font-mono text-[11px] text-muted">{codeLine(debrief.dxCode)}</p>
            </div>
            <Badge
              tone={meta.tone}
              icon={<meta.Icon weight="fill" className="h-3.5 w-3.5" aria-hidden />}
            >
              {t(`debrief.verdict.${meta.tag}`, { defaultValue: meta.tag })}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted">
            {t(`debrief.verdict.${meta.body}`, {
              defaultValue: "Review the process below before your next encounter.",
            })}
          </p>
        </div>

        {/* Process stat row */}
        <div className="mt-4 grid grid-cols-1 gap-4 rounded-card border border-border bg-bg-subtle/40 p-4 sm:grid-cols-3">
          <Stat
            size="sm"
            icon={<Clock weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            label={t("debrief.timeToDecision", { defaultValue: "Time to decision" })}
            value={minutes}
            unit={t("debrief.minUnit", { defaultValue: "min" })}
          />
          <Stat
            size="sm"
            icon={<Target weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            label={t("debrief.historyCoverage", { defaultValue: "History coverage" })}
            value={`${coveragePct}%`}
            mono
          />
          <Stat
            size="sm"
            icon={<Flask weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            label={t("debrief.workupAppropriate", { defaultValue: "Indicated work-up" })}
            value={`${appropriate}/${expected}`}
            mono
          />
        </div>

        {/* Red flags */}
        <section className="mt-5" aria-labelledby={`${titleId}-rf`}>
          <SectionLabel
            id={`${titleId}-rf`}
            icon={<Flag weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("debrief.redFlags.heading", { defaultValue: "Red-flag danger signs" })}
          </SectionLabel>
          {!hasRedFlags ? (
            <p className="mt-2 text-xs italic text-muted">
              {t("debrief.redFlags.none", { defaultValue: "No red-flag danger signs defined for this case." })}
            </p>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <RedFlagColumn
                tone="normal"
                title={t("debrief.redFlags.caught", { defaultValue: "Elicited" })}
                emptyLabel={t("debrief.redFlags.caughtNone", { defaultValue: "None elicited" })}
                items={caught.map((r) => ({ id: r.id, text: L(r.label) }))}
              />
              <RedFlagColumn
                tone="warning"
                title={t("debrief.redFlags.missed", { defaultValue: "Missed" })}
                emptyLabel={t("debrief.redFlags.allCaught", { defaultValue: "All red flags elicited" })}
                items={missed.map((r) => ({ id: r.id, text: L(r.label) }))}
              />
            </div>
          )}
        </section>

        {/* Work-up appropriateness */}
        <section className="mt-5" aria-labelledby={`${titleId}-wu`}>
          <SectionLabel
            id={`${titleId}-wu`}
            icon={<Flask weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("debrief.workup.heading", { defaultValue: "Work-up appropriateness" })}
          </SectionLabel>
          {workupClean ? (
            <p className="mt-2 text-xs text-muted">
              {t("debrief.workup.clean", {
                defaultValue: "Appropriate work-up — no key tests missed and nothing over-ordered.",
              })}
            </p>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <WorkupColumn
                tone="warning"
                title={t("debrief.workup.under", { defaultValue: "Under-ordered (gaps)" })}
                emptyLabel={t("debrief.workup.underNone", { defaultValue: "No gaps" })}
                items={underOrdered}
                render={L}
              />
              <WorkupColumn
                tone="caution"
                title={t("debrief.workup.over", { defaultValue: "Over-ordered" })}
                emptyLabel={t("debrief.workup.overNone", { defaultValue: "None over-ordered" })}
                items={overOrdered}
                render={L}
              />
            </div>
          )}
        </section>

        {/* Case red-flag reference (teaching) */}
        {debrief.redFlagReference.length > 0 ? (
          <section className="mt-5" aria-labelledby={`${titleId}-ref`}>
            <SectionLabel
              id={`${titleId}-ref`}
              icon={<ShieldWarning weight="bold" className="h-3.5 w-3.5" aria-hidden />}
            >
              {t("debrief.redFlags.reference", { defaultValue: "Red flags for this presentation" })}
            </SectionLabel>
            <ul className="mt-2 flex flex-col gap-1">
              {debrief.redFlagReference.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted">
                  <StatusDot tone="caution" size="sm" className="mt-1 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{L(r)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Divider className="mt-5" />

        {/* Teaching points */}
        <section className="mt-4" aria-labelledby={`${titleId}-tp`}>
          <SectionLabel
            id={`${titleId}-tp`}
            icon={<GraduationCap weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          >
            {t("debrief.teaching.heading", { defaultValue: "Teaching points" })}
          </SectionLabel>
          <ol className="mt-2 flex flex-col gap-2">
            {debrief.teachingPoints.map((tp) => (
              <li key={tp.id}>
                <Card variant="inset" padding="sm" className="flex items-start gap-2.5">
                  <GraduationCap
                    weight="fill"
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand"
                    aria-hidden
                  />
                  <p className="min-w-0 text-sm text-fg">{teachingText(t, tp, L)}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {/* Footer actions */}
        <div className="mt-6 flex items-center justify-end gap-2 print:hidden">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.print()}
            leadingIcon={<Printer weight="bold" className="h-4 w-4" aria-hidden />}
          >
            {t("debrief.print", { defaultValue: "Print / export" })}
          </Button>
          <Button
            size="sm"
            variant={onViewReport ? "secondary" : "primary"}
            onClick={close}
          >
            {t("debrief.close", { defaultValue: "Close" })}
          </Button>
          {onViewReport ? (
            <Button
              size="sm"
              variant="primary"
              onClick={onViewReport}
              trailingIcon={<ArrowRight weight="bold" className="h-4 w-4" aria-hidden />}
            >
              {t("debrief.viewFullReport", { defaultValue: "View full report" })}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

type ColTone = "normal" | "caution" | "warning";

function RedFlagColumn({
  tone,
  title,
  emptyLabel,
  items,
}: {
  tone: ColTone;
  title: string;
  emptyLabel: string;
  items: { id: string; text: string }[];
}) {
  return (
    <div className="rounded-control border border-border bg-surface p-3">
      <SectionLabel
        className="mb-1.5"
        icon={<StatusDot tone={tone} size="sm" aria-hidden />}
      >
        {title}
      </SectionLabel>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-2 text-sm text-fg">
              <StatusDot tone={tone} size="sm" className="mt-1.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkupColumn({
  tone,
  title,
  emptyLabel,
  items,
  render,
}: {
  tone: ColTone;
  title: string;
  emptyLabel: string;
  items: WorkupItem[];
  render: (b: Bilingual) => string;
}) {
  return (
    <div className="rounded-control border border-border bg-surface p-3">
      <SectionLabel
        className="mb-1.5"
        icon={<StatusDot tone={tone} size="sm" aria-hidden />}
      >
        {title}
      </SectionLabel>
      {items.length === 0 ? (
        <p className="text-xs italic text-muted">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li key={it.code} className="flex items-start gap-2 text-sm text-fg">
              <StatusDot tone={tone} size="sm" className="mt-1.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block break-words">{render(it.label)}</span>
                <span className="block font-mono text-[10px] text-muted">{it.code}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Resolve a teaching point to localized copy, interpolating count + label. */
function teachingText(
  t: TFn,
  tp: TeachingPoint,
  L: (b: Bilingual) => string,
): string {
  const defaults: Record<string, string> = {
    safety: "Close the safety-critical gap — check allergies and order the mandatory test before management.",
    redFlags: "You missed {{count}} red-flag danger sign(s). Screen for danger signs before narrowing the differential.",
    workupGap: "A key test was not ordered ({{label}}). Order it early for this presentation.",
    dxIncorrect: "Widen the differential and order the key rule-out test before committing.",
    dxNear: "You were close — re-weigh the leading differential against the evidence you gathered.",
    overOrder: "Avoid low-value tests that do not change management; order to a question, not by reflex.",
    coverage: "Broaden the history — several expected lines of questioning were not covered.",
    clean: "Well-run encounter: safe, focused, and committed on the evidence.",
  };
  return t(`debrief.teaching.${tp.key}`, {
    defaultValue: defaults[tp.key] ?? tp.key,
    count: tp.count ?? 0,
    label: tp.label ? L(tp.label) : "",
  });
}

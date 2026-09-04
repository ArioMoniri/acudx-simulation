import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Plus,
  Check,
  ListChecks,
  CheckCircle,
  WarningCircle,
  XCircle,
  CaretUp,
  CaretDown,
  ArrowUUpLeft,
  ClipboardText,
  SealCheck,
  Note,
  Path,
} from "@phosphor-icons/react";

import { Badge, Button, Card, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";
import { conceptCode, conceptText } from "../labels";
import { DiagnosisPicker, type DxOption } from "../DiagnosisPicker";
import {
  addProblem,
  commitDiagnosis,
  useEncounterState,
} from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance, Disposition } from "@/domain/case";
import type { Condition } from "@/domain/fhir";
import { getDiagnosis } from "@/domain/diagnosisCatalog";

export interface ProblemListTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

/** How strongly the student rates a differential candidate (student-authored). */
type Likelihood = "leading" | "possible" | "unlikely";
const LIKELIHOODS: Likelihood[] = ["leading", "possible", "unlikely"];

/** Verdict of a committed working diagnosis vs. the case ground truth. */
type Verdict = "correct" | "near" | "incorrect";

/** Generic plan building blocks (student-authored, never the case's answer). */
const QUICK_PLAN = ["access", "monitor", "analgesia", "reassess", "seniorReview"] as const;
/** The seven canonical dispositions from the domain `Disposition` union. */
const DISPOSITIONS: Disposition[] = [
  "admit-ccu",
  "admit-ward",
  "admit-icu",
  "operating-room",
  "observation",
  "discharge",
  "refer-specialty",
];

const DISPOSITION_PREFIX = "disposition:";

/** Per-differential local annotation layered over the store membership. */
interface Annotation {
  likelihood?: Likelihood;
  note: string;
  noteOpen: boolean;
}

/**
 * ProblemListTab — Assessment & Plan (docs §2.2), rebuilt as a real A&P surface.
 *
 * The student searches a broad ICD-10 / ICD-11 catalogue (src/domain/
 * diagnosisCatalog.ts, via DiagnosisPicker) to build a differential, ranks and
 * annotates the candidates, commits a working diagnosis (scored correct /
 * near-miss / incorrect against the case's ground truth WITHOUT spoiling it
 * beforehand), and writes a plan with a disposition. Everything reflects the
 * event-sourced encounter store; nothing here reveals data the student has not
 * obtained.
 */
export function ProblemListTab({ caseInstance, lang }: ProblemListTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

  const [plan, setPlan] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [annotations, setAnnotations] = useState<Record<string, Annotation>>({});

  /* ---- Case ground truth as suggested (unlabelled) candidates ------------- */
  const correctCode = conceptCode(caseInstance.correctDiagnosis.code);
  const caseDifferentialCodes = useMemo(
    () => new Set(caseInstance.differentials.map((c) => conceptCode(c.code))),
    [caseInstance],
  );

  const caseOptions = useMemo<DxOption[]>(() => {
    const all: Condition[] = [caseInstance.correctDiagnosis, ...caseInstance.differentials];
    const seen = new Set<string>();
    const opts: DxOption[] = [];
    for (const c of all) {
      const code = conceptCode(c.code);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      opts.push({ code, display: conceptText(c.code, lang), entry: getDiagnosis(code), suggested: true });
    }
    // Alphabetical so the ground-truth answer is never highlighted by position.
    return opts.sort((a, b) => a.display.localeCompare(b.display));
  }, [caseInstance, lang]);

  const caseCodeSet = useMemo(() => new Set(caseOptions.map((o) => o.code)), [caseOptions]);

  /* ---- Store-derived problem list ---------------------------------------- */
  const storeDifferentialCodes = useMemo(() => {
    const seen: string[] = [];
    for (const p of state.problemList) {
      if (p.role === "differential" && !seen.includes(p.code)) seen.push(p.code);
    }
    return seen;
  }, [state.problemList]);

  // Keep the local ranking in sync as new differentials are added.
  useEffect(() => {
    setOrder((prev) => {
      const known = new Set(prev);
      const additions = storeDifferentialCodes.filter((c) => !known.has(c));
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, [storeDifferentialCodes]);

  const workingEntry = state.problemList.find((p) => p.role === "working");
  const committed = state.committedDiagnosis;

  const visibleSet = useMemo(
    () => new Set(storeDifferentialCodes.filter((c) => !removed.has(c))),
    [storeDifferentialCodes, removed],
  );

  const rankedCodes = useMemo(() => {
    const inOrder = order.filter((c) => visibleSet.has(c));
    const rest = storeDifferentialCodes.filter((c) => visibleSet.has(c) && !inOrder.includes(c));
    return [...inOrder, ...rest];
  }, [order, visibleSet, storeDifferentialCodes]);

  const differentialByCode = useMemo(() => {
    const map = new Map<string, { code: string; display: string }>();
    for (const p of state.problemList) {
      if (p.role === "differential" && !map.has(p.code)) map.set(p.code, { code: p.code, display: p.display });
    }
    return map;
  }, [state.problemList]);

  /* ---- Plan + disposition (both live in the store) ----------------------- */
  const planEntries = state.problemList.filter(
    (p) => p.role === "plan" && !p.code.startsWith(DISPOSITION_PREFIX),
  );
  const disposition = useMemo<Disposition | null>(() => {
    let value: Disposition | null = null;
    for (const p of state.problemList) {
      if (p.role === "plan" && p.code.startsWith(DISPOSITION_PREFIX)) {
        value = p.code.slice(DISPOSITION_PREFIX.length) as Disposition;
      }
    }
    return value;
  }, [state.problemList]);

  /* ---- Actions ------------------------------------------------------------ */
  function addDifferential(o: DxOption) {
    if (removed.has(o.code)) {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(o.code);
        return next;
      });
    }
    if (!storeDifferentialCodes.includes(o.code)) {
      addProblem({ code: o.code, display: o.display, role: "differential" });
    }
    setOrder((prev) => (prev.includes(o.code) ? prev : [...prev, o.code]));
  }

  function retract(code: string) {
    setRemoved((prev) => new Set(prev).add(code));
  }

  function move(code: string, dir: "up" | "down") {
    const visible = rankedCodes.slice();
    const i = visible.indexOf(code);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= visible.length) return;
    [visible[i], visible[j]] = [visible[j], visible[i]];
    setOrder((prev) => [...visible, ...prev.filter((c) => !visible.includes(c))]);
  }

  function setAnnotation(code: string, patch: Partial<Annotation>) {
    setAnnotations((prev) => {
      const base: Annotation = prev[code] ?? { note: "", noteOpen: false };
      return { ...prev, [code]: { ...base, ...patch } };
    });
  }

  function insertPlan(text: string) {
    setPlan((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${text}` : text));
  }

  function savePlan() {
    const text = plan.trim();
    if (!text) return;
    addProblem({ code: "plan", display: text, role: "plan", note: text });
    setPlan("");
  }

  function chooseDisposition(value: Disposition) {
    if (disposition === value) return;
    const label = t(`diagnosis2.dispo.${value}`);
    addProblem({ code: `${DISPOSITION_PREFIX}${value}`, display: label, role: "plan", note: label });
  }

  /* ---- Grading (revealed only AFTER commit) ------------------------------- */
  const verdict = useMemo<Verdict | null>(() => {
    if (!committed) return null;
    if (committed === correctCode) return "correct";
    if (caseDifferentialCodes.has(committed)) return "near";
    const correctSystem = getDiagnosis(correctCode)?.system;
    const committedSystem = getDiagnosis(committed)?.system;
    if (correctSystem && committedSystem && correctSystem === committedSystem) return "near";
    return "incorrect";
  }, [committed, correctCode, caseDifferentialCodes]);

  const hasSummary =
    Boolean(committed) || rankedCodes.length > 0 || planEntries.length > 0 || Boolean(disposition);

  const { container: dxContainer, item: dxItem } = useStagger();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {/* ================= Differential builder (left) ==================== */}
        <div className="flex flex-col gap-4">
          <DiagnosisPicker
            lang={lang}
            caseOptions={caseOptions}
            caseCodeSet={caseCodeSet}
            visibleSet={visibleSet}
            onAdd={addDifferential}
          />
        </div>

        {/* ================= Differential + working + plan (right) ========== */}
        <div className="flex flex-col gap-4">
          {/* Differential list */}
          <Card padding="md">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <ListChecks weight="bold" className="h-4 w-4 text-muted" aria-hidden />
                {t("ehr.ap.differentialHeading")}
              </h3>
              {rankedCodes.length > 0 ? (
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {t("ehr2.ap.differentialCount", { count: rankedCodes.length })}
                </span>
              ) : null}
            </div>

            {rankedCodes.length === 0 ? (
              <p className="text-xs italic text-muted">{t("ehr.ap.differentialEmpty")}</p>
            ) : (
              <motion.ol {...dxContainer} className="flex flex-col gap-1.5">
                {rankedCodes.map((code, i) => {
                  const d = differentialByCode.get(code);
                  if (!d) return null;
                  const entry = getDiagnosis(code);
                  const isWorking = committed === code;
                  const ann = annotations[code] ?? { note: "", noteOpen: false };
                  return (
                    <motion.li
                      key={code}
                      {...dxItem}
                      className={cn(
                        "rounded-control border px-2.5 py-2",
                        isWorking ? "border-brand/40 bg-brand-tint/40" : "border-border bg-bg-subtle",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-label={t("ehr2.ap.rankLabel", { n: i + 1 })}
                            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface font-mono text-[11px] font-semibold tabular-nums text-muted"
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-fg">{d.display}</span>
                            <span className="block font-mono text-[10px] text-muted">
                              {entry ? `${entry.icd10}${entry.icd11 ? ` · ${entry.icd11}` : ""}` : code}
                            </span>
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconBtn
                            icon={<CaretUp weight="bold" className="h-3.5 w-3.5" aria-hidden />}
                            label={t("diagnosis2.moveUpAria", { name: d.display })}
                            disabled={i === 0}
                            onClick={() => move(code, "up")}
                          />
                          <IconBtn
                            icon={<CaretDown weight="bold" className="h-3.5 w-3.5" aria-hidden />}
                            label={t("diagnosis2.moveDownAria", { name: d.display })}
                            disabled={i === rankedCodes.length - 1}
                            onClick={() => move(code, "down")}
                          />
                          <IconBtn
                            icon={<Note weight={ann.noteOpen ? "fill" : "bold"} className="h-3.5 w-3.5" aria-hidden />}
                            label={t("diagnosis2.addNote")}
                            active={ann.noteOpen || Boolean(ann.note)}
                            onClick={() => setAnnotation(code, { noteOpen: !ann.noteOpen })}
                          />
                          {!isWorking ? (
                            <IconBtn
                              icon={<ArrowUUpLeft weight="bold" className="h-3.5 w-3.5" aria-hidden />}
                              label={t("diagnosis2.retractAria", { name: d.display })}
                              onClick={() => retract(code)}
                            />
                          ) : null}
                        </div>
                      </div>

                      {/* Likelihood + commit row */}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div
                          className="inline-flex overflow-hidden rounded-full border border-border"
                          role="group"
                          aria-label={t("diagnosis2.likelihoodAria", { name: d.display })}
                        >
                          {LIKELIHOODS.map((lk) => {
                            const active = ann.likelihood === lk;
                            return (
                              <button
                                key={lk}
                                type="button"
                                onClick={() => setAnnotation(code, { likelihood: active ? undefined : lk })}
                                aria-pressed={active}
                                className={cn(
                                  "px-2 py-0.5 text-[11px] font-medium transition-colors",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                  active
                                    ? lk === "leading"
                                      ? "bg-brand text-white"
                                      : "bg-fg-subtle/15 text-fg"
                                    : "bg-surface text-muted hover:bg-bg-subtle",
                                )}
                              >
                                {t(`diagnosis2.likelihood.${lk}`)}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => commitDiagnosis(code, d.display)}
                          aria-pressed={isWorking}
                          aria-label={t("diagnosis2.commitAria", { name: d.display })}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                            "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                            isWorking
                              ? "bg-brand text-white"
                              : "border border-border bg-surface text-fg hover:bg-brand-tint hover:text-brand",
                          )}
                        >
                          {isWorking ? (
                            <>
                              <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                              {t("ehr.ap.working")}
                            </>
                          ) : (
                            t("ehr.ap.setWorking")
                          )}
                        </button>
                      </div>

                      {ann.noteOpen ? (
                        <input
                          type="text"
                          value={ann.note}
                          onChange={(e) => setAnnotation(code, { note: e.target.value })}
                          placeholder={t("diagnosis2.notePlaceholder")}
                          aria-label={t("diagnosis2.noteLabel")}
                          className="mt-2 w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        />
                      ) : ann.note ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
                          <Note weight="fill" className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />
                          <span className="min-w-0 break-words">{ann.note}</span>
                        </p>
                      ) : null}
                    </motion.li>
                  );
                })}
              </motion.ol>
            )}
          </Card>

          {/* Working diagnosis + verdict */}
          <Card padding="md">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
              <SealCheck weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("diagnosis2.workingHeading")}
            </h3>
            {committed && workingEntry ? (
              <VerdictPanel verdict={verdict} display={workingEntry.display} code={committed} t={t} />
            ) : (
              <p className="text-xs italic text-muted">{t("diagnosis2.workingEmpty")}</p>
            )}
          </Card>

          {/* Plan */}
          <Card padding="md">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
              <ClipboardText weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("ehr.ap.planHeading")}
            </h3>

            {/* Disposition — the domain Disposition union */}
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              <Path weight="bold" className="h-3 w-3" aria-hidden />
              {t("diagnosis2.dispositionHeading")}
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {DISPOSITIONS.map((disp) => {
                const active = disposition === disp;
                return (
                  <button
                    key={disp}
                    type="button"
                    onClick={() => chooseDisposition(disp)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                      "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                      active
                        ? "border-brand bg-brand text-white"
                        : "border-border bg-surface text-fg hover:bg-brand-tint hover:text-brand",
                    )}
                  >
                    {active ? <Check weight="bold" className="h-3 w-3" aria-hidden /> : null}
                    {t(`diagnosis2.dispo.${disp}`)}
                  </button>
                );
              })}
            </div>

            {/* Quick-add building blocks */}
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
              {t("ehr2.ap.quickPlanHeading")}
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_PLAN.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => insertPlan(t(`ehr2.ap.quick.${k}`))}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg",
                    "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                    "hover:bg-brand-tint hover:text-brand",
                  )}
                >
                  <Plus weight="bold" className="h-3 w-3" aria-hidden />
                  {t(`ehr2.ap.quick.${k}`)}
                </button>
              ))}
            </div>

            <label htmlFor="ap-plan" className="sr-only">
              {t("ehr.ap.planPlaceholder")}
            </label>
            <textarea
              id="ap-plan"
              rows={3}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={t("ehr.ap.planPlaceholder")}
              className="w-full resize-y rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted" aria-live="polite">
                {plan.trim()
                  ? t("ehr2.ap.planCharCount", { count: plan.trim().length })
                  : t("ehr2.ap.insertHint")}
              </span>
              <Button size="sm" variant="secondary" onClick={savePlan} disabled={!plan.trim()}>
                {t("ehr.ap.savePlan")}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* ===================== Problem list summary ======================== */}
      {hasSummary ? (
        <ProblemSummary
          t={t}
          verdict={verdict}
          committed={committed}
          workingDisplay={workingEntry?.display}
          rankedCodes={rankedCodes}
          differentialByCode={differentialByCode}
          annotations={annotations}
          planEntries={planEntries.map((p) => p.note ?? p.display)}
          disposition={disposition}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** A small square icon button used for reorder / note / retract. */
function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-control text-muted",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        active && "bg-brand-tint text-brand",
        disabled ? "cursor-default opacity-30" : "hover:bg-bg-subtle hover:text-fg",
      )}
    >
      {icon}
    </button>
  );
}

const VERDICT_META: Record<
  Verdict,
  { tone: "normal" | "caution" | "warning"; tag: string; title: string; body: string; Icon: typeof CheckCircle }
> = {
  correct: { tone: "normal", tag: "correctTag", title: "correctTitle", body: "correctBody", Icon: CheckCircle },
  near: { tone: "caution", tag: "nearTag", title: "nearTitle", body: "nearBody", Icon: WarningCircle },
  incorrect: { tone: "warning", tag: "incorrectTag", title: "incorrectTitle", body: "incorrectBody", Icon: XCircle },
};

/** The committed working-diagnosis panel with graded feedback (post-commit). */
function VerdictPanel({
  verdict,
  display,
  code,
  t,
}: {
  verdict: Verdict | null;
  display: string;
  code: string;
  t: TFn;
}) {
  const meta = verdict ? VERDICT_META[verdict] : null;
  const entry = getDiagnosis(code);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{display}</p>
          <p className="font-mono text-[11px] text-muted">
            {entry ? `${entry.icd10}${entry.icd11 ? ` · ${entry.icd11}` : ""}` : code}
          </p>
        </div>
        {meta ? (
          <Badge tone={meta.tone} icon={<meta.Icon weight="fill" className="h-3.5 w-3.5" aria-hidden />}>
            {t(`diagnosis2.verdict.${meta.tag}`)}
          </Badge>
        ) : null}
      </div>
      {meta ? (
        <div
          className={cn(
            "mt-2 rounded-control border px-2.5 py-2",
            meta.tone === "normal"
              ? "border-[color:var(--state-normal)]/30 bg-[color-mix(in_srgb,var(--state-normal)_10%,transparent)]"
              : meta.tone === "caution"
                ? "border-[color:var(--state-caution)]/30 bg-[color-mix(in_srgb,var(--state-caution)_10%,transparent)]"
                : "border-[color:var(--state-warning)]/30 bg-[color-mix(in_srgb,var(--state-warning)_10%,transparent)]",
          )}
        >
          <p className="text-xs font-semibold text-fg">{t(`diagnosis2.verdict.${meta.title}`)}</p>
          <p className="mt-0.5 text-xs text-muted">{t(`diagnosis2.verdict.${meta.body}`)}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Dense, Epic/AMBOSS-style A&P summary derived entirely from the store. */
function ProblemSummary({
  t,
  verdict,
  committed,
  workingDisplay,
  rankedCodes,
  differentialByCode,
  annotations,
  planEntries,
  disposition,
}: {
  t: TFn;
  verdict: Verdict | null;
  committed: string | null;
  workingDisplay?: string;
  rankedCodes: string[];
  differentialByCode: Map<string, { code: string; display: string }>;
  annotations: Record<string, Annotation>;
  planEntries: string[];
  disposition: Disposition | null;
}) {
  const otherDifferentials = rankedCodes.filter((c) => c !== committed);
  return (
    <Card padding="md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <ListChecks weight="bold" className="h-4 w-4 text-muted" aria-hidden />
          {t("diagnosis2.summaryHeading")}
        </h3>
        <span className="text-[11px] text-muted">{t("diagnosis2.summaryHint")}</span>
      </div>

      {/* Working diagnosis */}
      {committed && workingDisplay ? (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {t("diagnosis2.summaryWorkingLabel")}
          </p>
          <div className="flex items-center justify-between gap-2 rounded-control border border-brand/30 bg-brand-tint/40 px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <SealCheck weight="fill" className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{workingDisplay}</span>
                <span className="block font-mono text-[10px] text-muted">{codeLine(committed)}</span>
              </span>
            </span>
            <Badge tone={verdict === "correct" ? "brand" : "neutral"} variant="outline">
              {t(
                verdict === "correct"
                  ? "diagnosis2.verification.confirmed"
                  : "diagnosis2.verification.provisional",
              )}
            </Badge>
          </div>
        </div>
      ) : null}

      {/* Differential */}
      {otherDifferentials.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {t("diagnosis2.summaryDifferentialLabel")}
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {otherDifferentials.map((code, i) => {
              const d = differentialByCode.get(code);
              if (!d) return null;
              const lk = annotations[code]?.likelihood;
              return (
                <li key={code} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-fg-subtle">{i + 1}.</span>
                    <StatusDot tone="neutral" size="sm" aria-hidden />
                    <span className="min-w-0 truncate text-sm text-fg">{d.display}</span>
                    <span className="hidden font-mono text-[10px] text-muted sm:inline">{codeLine(code)}</span>
                  </span>
                  {lk ? (
                    <Badge tone={lk === "leading" ? "brand" : "neutral"} variant="outline">
                      {t(`diagnosis2.likelihood.${lk}`)}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Plan + disposition */}
      {disposition || planEntries.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {t("diagnosis2.summaryPlanLabel")}
          </p>
          {disposition ? (
            <p className="mb-1.5 flex items-center gap-1.5 text-sm text-fg">
              <Path weight="bold" className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
              <span className="text-muted">{t("diagnosis2.summaryDispositionLabel")}:</span>
              <span className="font-medium">{t(`diagnosis2.dispo.${disposition}`)}</span>
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {planEntries.map((text, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-fg">
                <CheckCircle weight="fill" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 whitespace-pre-line break-words">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/** Render an ICD-10 (+ICD-11) code line for a stored code, via the catalogue. */
function codeLine(code: string): string {
  const entry = getDiagnosis(code);
  if (!entry) return code;
  return `${entry.icd10}${entry.icd11 ? ` · ${entry.icd11}` : ""}`;
}

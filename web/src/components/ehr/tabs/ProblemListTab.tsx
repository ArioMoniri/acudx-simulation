import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Plus,
  ListChecks,
  CheckCircle,
  WarningCircle,
  XCircle,
  CaretUp,
  CaretDown,
  ArrowUUpLeft,
  ClipboardText,
  SealCheck,
  Stethoscope,
  Note,
  Path,
  GraduationCap,
} from "@phosphor-icons/react";

import { Badge, Button, Card, SectionLabel, StatusDot, TextInput, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";
import { useLiveBackend } from "@/lib/liveBackend";
import { grade, type GradeTurn } from "@/lib/backend";
import { conceptCode, conceptText, pick } from "../labels";
import { DiagnosisPicker, type DxOption } from "../DiagnosisPicker";
import { DebriefReport } from "../DebriefReport";
import {
  addProblem,
  commitDiagnosis,
  useEncounterState,
  type EncounterState,
} from "@/state/encounterStore";
import {
  buildDebrief,
  classifyDiagnosis,
  summariseGrade,
  type DxVerdict,
  type DxAssessment,
  type GradeInsight,
} from "@/domain/debrief";
import type { Lang } from "@/data/schema";
import type {
  CaseInstance,
  Disposition,
  ExamManeuver,
  QuestionIntent,
} from "@/domain/case";
import type { Condition } from "@/domain/fhir";
import { getDiagnosis, systemLabel, type DiagnosisEntry } from "@/domain/diagnosisCatalog";

export interface ProblemListTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

/** How strongly the student rates a differential candidate (student-authored). */
type Likelihood = "leading" | "possible" | "unlikely";
const LIKELIHOODS: Likelihood[] = ["leading", "possible", "unlikely"];

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
 * Session-scoped persistence for the per-differential annotations (likelihood +
 * note). Keyed on the CaseInstance IDENTITY so the ranking + reasoning survive
 * this tab's unmount/remount — Radix Tabs unmounts inactive panels — yet reset
 * automatically for a fresh encounter (a new CaseInstance object). Deliberately
 * kept OUT of the shared `problemList`: the Storyboard rail and the tab badge
 * render every problem-list entry, so persisting there would duplicate rows and
 * inflate counts. The store has no per-differential update action, so this
 * case-scoped cache is the non-invasive home; `buildGradeTranscript` reads the
 * same annotations so the learner's ranking + notes reach the grader.
 */
const annotationCache = new WeakMap<CaseInstance, Record<string, Annotation>>();

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
  const navigate = useNavigate();
  const state = useEncounterState();
  // Effective Live-mode state: reachable AND not opted out (backend-preferring).
  const { enabled: liveEnabled } = useLiveBackend();

  const [plan, setPlan] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [annotations, setAnnotations] = useState<Record<string, Annotation>>(
    () => annotationCache.get(caseInstance) ?? {},
  );
  const [debriefOpen, setDebriefOpen] = useState(false);

  /* ---- Case ground truth as suggested (unlabelled) candidates ------------- */
  const correctCode = conceptCode(caseInstance.correctDiagnosis.code);
  const correctDisplay = conceptText(caseInstance.correctDiagnosis.code, lang);
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
      const next = { ...prev, [code]: { ...base, ...patch } };
      // Persist so the ranking + notes survive a tab unmount/remount and feed
      // the grader (buildGradeTranscript reads the same annotations).
      annotationCache.set(caseInstance, next);
      return next;
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
  // Local, case-truth verdict — the SHARED classifier the debrief also uses, so
  // the A&P and the debrief always agree. Always available (offline path).
  const baseAssessment = useMemo<DxAssessment | null>(
    () => (committed ? classifyDiagnosis(committed, correctCode, caseDifferentialCodes) : null),
    [committed, correctCode, caseDifferentialCodes],
  );

  // Real pod rubric grade (server/rubric.py via POST /v1/grade), fetched once per
  // commit when Live mode is reachable. Enriches the verdict with the clinical-
  // reasoning band + a verified evidence quote; on offline/error it stays null
  // and the local verdict alone renders (graceful degrade).
  const [gradeInsight, setGradeInsight] = useState<GradeInsight | null>(null);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    setGradeInsight(null);
    if (!committed || !liveEnabled) {
      setGrading(false);
      return;
    }
    // Snapshot the transcript at commit time (a fresh commit re-runs this effect).
    const transcript = buildGradeTranscript(state, caseInstance, lang, annotations);
    if (transcript.length === 0) {
      setGrading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setGrading(true);
    void grade({ transcript, locale: lang }, { signal: controller.signal }).then((res) => {
      if (!active) return;
      setGrading(false);
      if (res.ok) setGradeInsight(summariseGrade(res.data));
    });
    return () => {
      active = false;
      controller.abort();
    };
    // State is snapshotted intentionally: we grade the committed encounter once,
    // not on every subsequent store mutation. Re-run only when the commit, the
    // case, Live availability, or the display language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, liveEnabled, caseInstance.id, lang]);

  // The verdict shown + shared with the debrief: local classification, enriched
  // with the pod grade when one arrived.
  const assessment = useMemo<DxAssessment | null>(() => {
    if (!baseAssessment) return null;
    return gradeInsight ? { ...baseAssessment, grade: gradeInsight } : baseAssessment;
  }, [baseAssessment, gradeInsight]);

  const verdict = assessment?.verdict ?? null;

  // Attending debrief (GH #110) — built lazily from the event-sourced state once
  // a working diagnosis is committed. Reuses the SAME assessment (incl. the pod
  // grade) so the debrief and the A&P agree. Pure; recomputed when state changes.
  const debrief = useMemo(
    () => (committed && assessment ? buildDebrief(state, caseInstance, assessment) : null),
    [committed, state, caseInstance, assessment],
  );

  const hasSummary =
    Boolean(committed) || rankedCodes.length > 0 || planEntries.length > 0 || Boolean(disposition);

  const { container: dxContainer, item: dxItem } = useStagger();

  return (
    <div className="flex flex-col gap-4">
      {/* ===================== Stage 1 — Differential ===================== */}
      <Stage
        n={1}
        icon={<Stethoscope weight="bold" className="h-4 w-4" aria-hidden />}
        title={t("ehr.ap.differentialHeading")}
        helper={t("diagnosis2.stage.differential", {
          defaultValue:
            "Search the catalogue, add candidates, then rank each by likelihood and note your reasoning.",
        })}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Search + suggested (the builder) */}
          <DiagnosisPicker
            lang={lang}
            caseOptions={caseOptions}
            caseCodeSet={caseCodeSet}
            visibleSet={visibleSet}
            onAdd={addDifferential}
          />

          {/* The learner's own differential — ranked + annotated */}
          <div className="border-t border-border pt-5 lg:border-s lg:border-t-0 lg:ps-5 lg:pt-0">
            <SectionLabel
              className="mb-2"
              icon={<ListChecks weight="bold" className="h-3.5 w-3.5" aria-hidden />}
              trailing={
                rankedCodes.length > 0 ? (
                  <Badge tone="brand" variant="outline">
                    {t("ehr2.ap.differentialCount", { count: rankedCodes.length })}
                  </Badge>
                ) : null
              }
            >
              {t("diagnosis2.yourDifferential", { defaultValue: "Your differential" })}
            </SectionLabel>

            {rankedCodes.length === 0 ? (
              <EmptyState
                icon={<ListChecks weight="duotone" className="h-5 w-5" aria-hidden />}
                title={t("diagnosis2.differentialEmptyTitle", {
                  defaultValue: "No candidates yet",
                })}
                hint={t("diagnosis2.differentialEmptyHint", {
                  defaultValue:
                    "Search the catalogue or tap a suggested condition to start building your differential.",
                })}
              />
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
                            "transition-colors duration-200 ease-out active:scale-[0.98]",
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
                        <TextInput
                          type="text"
                          value={ann.note}
                          onChange={(e) => setAnnotation(code, { note: e.target.value })}
                          placeholder={t("diagnosis2.notePlaceholder")}
                          aria-label={t("diagnosis2.noteLabel")}
                          className="mt-2"
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
          </div>
        </div>
      </Stage>

      {/* ==================== Stage 2 — Working diagnosis ================= */}
      <Stage
        n={2}
        icon={<SealCheck weight="bold" className="h-4 w-4" aria-hidden />}
        title={t("diagnosis2.workingHeading")}
        helper={t("diagnosis2.stage.working", {
          defaultValue:
            "Commit the single most likely diagnosis to get instant, scored feedback.",
        })}
      >
        {committed && workingEntry ? (
          <>
            <VerdictPanel
              assessment={assessment}
              display={workingEntry.display}
              code={committed}
              correctDisplay={correctDisplay}
              grading={grading}
              t={t}
              lang={lang}
            />
            {debrief ? (
              <Button
                variant="primary"
                size="sm"
                fullWidth
                className="mt-3"
                onClick={() => setDebriefOpen(true)}
                leadingIcon={<GraduationCap weight="bold" className="h-4 w-4" aria-hidden />}
              >
                {t("debrief.open", { defaultValue: "View attending debrief" })}
              </Button>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<SealCheck weight="duotone" className="h-5 w-5" aria-hidden />}
            title={t("diagnosis2.workingEmptyTitle", {
              defaultValue: "No working diagnosis yet",
            })}
            hint={t("diagnosis2.workingEmpty")}
          />
        )}
      </Stage>

      {/* ======================= Stage 3 — Disposition =================== */}
      <Stage
        n={3}
        icon={<Path weight="bold" className="h-4 w-4" aria-hidden />}
        title={t("diagnosis2.dispositionHeading")}
        helper={t("diagnosis2.dispositionHint")}
      >
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {DISPOSITIONS.map((disp) => {
            const active = disposition === disp;
            return (
              <button
                key={disp}
                type="button"
                onClick={() => chooseDisposition(disp)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-control border px-3 py-2 text-left text-sm font-medium",
                  "transition-colors duration-200 ease-out active:scale-[0.99]",
                  active
                    ? "border-brand bg-brand-tint text-brand"
                    : "border-border bg-surface text-fg hover:border-border-strong hover:bg-bg-subtle",
                )}
              >
                <span className="min-w-0 truncate">{t(`diagnosis2.dispo.${disp}`)}</span>
                {active ? (
                  <CheckCircle weight="fill" className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                ) : (
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-border-strong"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </Stage>

      {/* ========================== Stage 4 — Plan ======================= */}
      <Stage
        n={4}
        icon={<ClipboardText weight="bold" className="h-4 w-4" aria-hidden />}
        title={t("ehr.ap.planHeading")}
        helper={t("diagnosis2.stage.plan", {
          defaultValue:
            "Add the immediate steps, then refine the free-text plan before saving.",
        })}
      >
        {/* Quick-add building blocks */}
        <SectionLabel className="mb-1.5">{t("ehr2.ap.quickPlanHeading")}</SectionLabel>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {QUICK_PLAN.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => insertPlan(t(`ehr2.ap.quick.${k}`))}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg",
                "transition-colors duration-200 ease-out active:scale-[0.98]",
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
        <Textarea
          id="ap-plan"
          rows={3}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          placeholder={t("ehr.ap.planPlaceholder")}
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
      </Stage>

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

      {/* Attending debrief (GH #110) — after-action, process-aware report. */}
      {debriefOpen && debrief ? (
        <DebriefReport
          debrief={debrief}
          caseInstance={caseInstance}
          onClose={() => setDebriefOpen(false)}
          onViewReport={() => navigate("/feedback")}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Stage — one numbered step in the A&P reasoning flow (AMBOSS-style). A teal
 * numbered marker plus a titled header with instructive helper copy gives the
 * four stages (differential → working dx → disposition → plan) a clear,
 * guided sequence rather than a loose stack of panels.
 */
function Stage({
  n,
  icon,
  title,
  helper,
  children,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <Card padding="md">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand font-mono text-[13px] font-semibold tabular-nums text-white"
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <span className="text-muted" aria-hidden>
              {icon}
            </span>
            {title}
          </h3>
          {helper ? <p className="mt-0.5 text-xs text-muted">{helper}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/**
 * EmptyState — an intentional, inviting empty panel: a soft icon, a short title
 * and a guiding line, so an unstarted stage reads as a prompt to act rather
 * than an unfinished gap.
 */
function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-control border border-dashed border-border bg-bg-subtle px-4 py-6 text-center">
      <span
        className="grid h-10 w-10 place-items-center rounded-full bg-surface text-brand"
        aria-hidden
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-[34ch] text-xs text-muted">{hint}</p>
    </div>
  );
}

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
        "transition-colors",
        active && "bg-brand-tint text-brand",
        disabled ? "cursor-default opacity-30" : "hover:bg-bg-subtle hover:text-fg",
      )}
    >
      {icon}
    </button>
  );
}

const VERDICT_META: Record<
  DxVerdict,
  { tone: "normal" | "caution" | "warning"; tag: string; Icon: typeof CheckCircle }
> = {
  correct: { tone: "normal", tag: "correctTag", Icon: CheckCircle },
  "near-miss": { tone: "caution", tag: "nearTag", Icon: WarningCircle },
  incorrect: { tone: "warning", tag: "incorrectTag", Icon: XCircle },
};

/** Case-specific verdict title copy (interpolates the committed dx). */
const VERDICT_TITLE_FALLBACK: Record<DxVerdict, string> = {
  correct: "{{dx}} matches the expected diagnosis.",
  "near-miss": "{{dx}} is close, but not the expected diagnosis.",
  incorrect: "{{dx}} doesn't fit this presentation.",
};

/** Case-specific verdict body copy — reveals the correct dx + a short why. */
const VERDICT_BODY_FALLBACK: Record<DxVerdict, string> = {
  correct:
    "Your working diagnosis is the leading diagnosis for this case — confirm your management and disposition.",
  "near-miss":
    "The expected diagnosis was {{correct}} — {{why}} Re-examine the discriminating findings.",
  incorrect:
    "The expected diagnosis was {{correct}}. {{why}} Revisit the key findings and rebuild your differential.",
};

/** Localized, capitalised label for a competency band. */
function bandLabel(band: string, t: TFn): string {
  const defaults: Record<string, string> = {
    strong: "Strong",
    adequate: "Adequate",
    developing: "Developing",
    insufficient: "Insufficient",
    ungraded: "Not graded",
  };
  return t(`diagnosis2.band.${band}`, { defaultValue: defaults[band] ?? band });
}

/** A short, case-specific "why" for a near-miss / incorrect verdict. */
function whyText(
  assessment: DxAssessment,
  correctEntry: DiagnosisEntry | undefined,
  lang: Lang,
  t: TFn,
): string {
  switch (assessment.nearMissReason) {
    case "listed-differential":
      return t("diagnosis2.verdict2.whyDifferential", {
        defaultValue:
          "it's a reasonable alternative on your differential, but the findings point elsewhere.",
      });
    case "same-category":
      return t("diagnosis2.verdict2.whySameCategory", {
        defaultValue: "it's in the same disease family, so the discriminators are subtle.",
      });
    case "same-system":
      return t("diagnosis2.verdict2.whySameSystem", {
        defaultValue: "it affects the same body system.",
      });
    default:
      if (correctEntry) {
        return t("diagnosis2.verdict2.whySystem", {
          system: systemLabel(correctEntry.system, lang),
          defaultValue: "It sits in a different area — a {{system}} problem.",
        });
      }
      return "";
  }
}

/**
 * The committed working-diagnosis panel with graded feedback (post-commit). The
 * verdict copy is now CASE-SPECIFIC: it names the committed dx and, on a
 * near-miss / incorrect, reveals the case's correct diagnosis + a short why.
 * When Live mode produced a real pod rubric grade it also shows the graded
 * clinical-reasoning band + a verified evidence quote ("Examiner's read").
 */
function VerdictPanel({
  assessment,
  display,
  code,
  correctDisplay,
  grading,
  t,
  lang,
}: {
  assessment: DxAssessment | null;
  display: string;
  code: string;
  correctDisplay: string;
  grading: boolean;
  t: TFn;
  lang: Lang;
}) {
  const verdict = assessment?.verdict ?? null;
  const meta = verdict ? VERDICT_META[verdict] : null;
  const entry = getDiagnosis(code);
  const correctEntry = getDiagnosis(assessment?.correctCode ?? "");
  const gradeInsight = assessment?.grade ?? null;
  const why = assessment ? whyText(assessment, correctEntry, lang, t) : "";

  const title = verdict
    ? t(`diagnosis2.verdict2.${verdict}Title`, {
        dx: display,
        defaultValue: VERDICT_TITLE_FALLBACK[verdict],
      })
    : "";
  const body = verdict
    ? t(`diagnosis2.verdict2.${verdict}Body`, {
        dx: display,
        correct: correctDisplay,
        why,
        defaultValue: VERDICT_BODY_FALLBACK[verdict],
      })
    : "";

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
          <p className="text-xs font-semibold text-fg">{title}</p>
          <p className="mt-0.5 text-xs text-muted">{body}</p>

          {gradeInsight?.graded ? (
            <div className="mt-2 border-t border-border/60 pt-2">
              <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                <GraduationCap weight="bold" className="h-3 w-3" aria-hidden />
                {t("diagnosis2.verdict2.examinerHeading", { defaultValue: "Examiner's read" })}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t("diagnosis2.verdict2.reasoningBand", {
                  band: bandLabel(gradeInsight.reasoningBand, t),
                  defaultValue: "Clinical reasoning: {{band}}.",
                })}
              </p>
              {gradeInsight.reasoningEvidence ? (
                <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted">
                  {"“"}
                  {gradeInsight.reasoningEvidence}
                  {"”"}
                </p>
              ) : null}
            </div>
          ) : grading ? (
            <p
              className="mt-2 animate-pulse border-t border-border/60 pt-2 text-[11px] text-muted"
              aria-live="polite"
            >
              {t("diagnosis2.verdict2.grading", {
                defaultValue: "Grading your reasoning against the rubric…",
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Transcript reconstruction for the pod grader                                */
/* -------------------------------------------------------------------------- */

/**
 * English question phrasing per QuestionIntent. The grader reasons in English;
 * the CLINICIAN's action (the question asked) is scaffolded in English while the
 * PATIENT's answers stay in the learner's language (verbatim-quote matching is
 * language-agnostic), so evidence quotes remain legible to the learner.
 */
const INTENT_PHRASE: Record<QuestionIntent, string> = {
  onset: "When did this start, and how did it come on?",
  location: "Where exactly is the problem?",
  character: "Can you describe what it feels like?",
  radiation: "Does it move or spread anywhere?",
  severity: "How severe is it?",
  timing: "How has it changed over time?",
  aggravating: "Does anything make it worse?",
  relieving: "Does anything make it better?",
  "associated-symptoms": "Have you noticed any other symptoms?",
  "red-flags": "Any warning symptoms I should ask you about?",
  "past-medical-history": "Do you have any past medical problems?",
  medications: "What medications do you take?",
  allergies: "Do you have any allergies?",
  "family-history": "Any relevant family history?",
  "social-history": "Tell me about smoking, alcohol and your work.",
  "risk-factors": "Do you have any risk factors for this?",
  ice: "What are you most worried this could be?",
};

/** English phrasing per ExamManeuver (see INTENT_PHRASE rationale). */
const MANEUVER_PHRASE: Record<ExamManeuver, string> = {
  "general-inspection": "I'll start with a general inspection.",
  "vitals-recheck": "Let me recheck your vital signs.",
  cardiovascular: "I'm going to examine your heart and circulation.",
  respiratory: "I'll listen to your chest.",
  abdominal: "I'll examine your abdomen.",
  neurological: "I'll do a neurological examination.",
  musculoskeletal: "I'll examine the joints and muscles.",
  skin: "Let me take a look at your skin.",
  ent: "I'll examine your ears, nose and throat.",
  "focused-special": "I'll perform a focused special test.",
};

/**
 * Reconstruct a labelled doctor-patient transcript from the event-sourced
 * encounter, for POST /v1/grade. The live free-text dialogue lives in
 * InterviewTab's local state (not this store), so we synthesise a faithful
 * proxy from what the store DID capture: the chief complaint, each history
 * question + its revealed answer, exam maneuvers + findings, orders/treatments,
 * and the full A&P (differential, working dx, plan). This gives the grader real
 * material for the clinical-reasoning domain even offline-reconstructed.
 */
function buildGradeTranscript(
  state: EncounterState,
  caseInstance: CaseInstance,
  lang: Lang,
  annotations: Record<string, Annotation>,
): GradeTurn[] {
  const turns: GradeTurn[] = [];
  const cc = pick(caseInstance.chiefComplaint, lang);
  if (cc) turns.push({ role: "patient", content: cc });

  const historyById = new Map(caseInstance.groundTruth.history.map((h) => [h.id, h]));
  const examById = new Map(caseInstance.groundTruth.exam.map((e) => [e.id, e]));

  for (const ev of state.events) {
    const revealed = (ev.meta?.revealed as string[] | undefined) ?? [];
    if (ev.type === "question") {
      const intent = ev.ref as QuestionIntent;
      turns.push({
        role: "clinician",
        content: INTENT_PHRASE[intent] ?? `I'd like to ask about ${intent}.`,
      });
      for (const id of revealed) {
        const h = historyById.get(id);
        const answer = h ? pick(h.answer, lang) : "";
        if (answer) turns.push({ role: "patient", content: answer });
      }
    } else if (ev.type === "exam") {
      const maneuver = ev.ref as ExamManeuver;
      turns.push({
        role: "clinician",
        content: MANEUVER_PHRASE[maneuver] ?? "I'll examine you now.",
      });
      for (const id of revealed) {
        const e = examById.get(id);
        if (e) {
          turns.push({
            role: "nurse",
            content: `${pick(e.system, lang)}: ${pick(e.finding, lang)}`,
          });
        }
      }
    } else if (ev.type === "order") {
      const placed = state.orders.find((o) => o.code === ev.ref);
      const label = placed ? (lang === "tr" ? placed.labelTr : placed.labelEn) : ev.ref;
      turns.push({ role: "clinician", content: `I'm ordering ${label}.` });
    } else if (ev.type === "treatment") {
      const disp = (ev.meta?.display as string | undefined) ?? ev.ref;
      turns.push({ role: "clinician", content: `I'll start ${disp}.` });
    }
  }

  // Assessment & plan — the reasoning surface the grader most needs. Dedupe the
  // differential by code (first seen) and weave in the learner's own likelihood
  // rating + note per candidate, so the grader sees the RANKED, annotated
  // differential rather than a bare list.
  const seenDx = new Set<string>();
  const differentials: string[] = [];
  for (const p of state.problemList) {
    if (p.role !== "differential" || seenDx.has(p.code)) continue;
    seenDx.add(p.code);
    const ann = annotations[p.code];
    const bits: string[] = [];
    if (ann?.likelihood) bits.push(ann.likelihood);
    const note = ann?.note.trim();
    if (note) bits.push(`“${note}”`);
    differentials.push(bits.length ? `${p.display} (${bits.join(" — ")})` : p.display);
  }
  if (differentials.length > 0) {
    turns.push({ role: "clinician", content: `My differential includes ${differentials.join(", ")}.` });
  }
  const working = [...state.problemList].reverse().find((p) => p.role === "working");
  if (working) {
    turns.push({ role: "clinician", content: `My working diagnosis is ${working.display}.` });
  }
  // Plan — free-text steps in order, but only the CURRENT disposition. Selecting
  // a new disposition appends a fresh `plan` entry without retiring the previous
  // one, so feeding every plan entry would tell the grader the learner chose
  // several conflicting dispositions. Keep the latest disposition only.
  const planNotes: string[] = [];
  let latestDisposition: string | null = null;
  for (const p of state.problemList) {
    if (p.role !== "plan") continue;
    if (p.code.startsWith(DISPOSITION_PREFIX)) {
      latestDisposition = p.note ?? p.display; // later entries overwrite → latest wins
    } else {
      planNotes.push(p.note ?? p.display);
    }
  }
  if (latestDisposition) planNotes.push(latestDisposition);
  if (planNotes.length > 0) {
    turns.push({ role: "clinician", content: `Plan: ${planNotes.join("; ")}.` });
  }

  return turns;
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
  verdict: DxVerdict | null;
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
          <SectionLabel className="mb-1">
            {t("diagnosis2.summaryWorkingLabel")}
          </SectionLabel>
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
          <SectionLabel className="mb-1">
            {t("diagnosis2.summaryDifferentialLabel")}
          </SectionLabel>
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
          <SectionLabel className="mb-1">
            {t("diagnosis2.summaryPlanLabel")}
          </SectionLabel>
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

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  MagnifyingGlass,
  Plus,
  ListChecks,
  Check,
  CheckCircle,
  Path,
  ClipboardText,
} from "@phosphor-icons/react";

import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useStagger } from "@/lib/motion";
import { conceptCode, conceptText } from "../labels";
import {
  addProblem,
  commitDiagnosis,
  useEncounterState,
} from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";
import type { Condition } from "@/domain/fhir";

export interface ProblemListTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

interface DxOption {
  code: string;
  display: string;
}

/** Generic plan building blocks (student-authored, not case-specific answers). */
const QUICK_PLAN = ["access", "monitor", "analgesia", "reassess", "seniorReview"] as const;
/** Standard disposition options the student chooses from. */
const DISPOSITIONS = ["admitWard", "admitIcu", "observation", "discharge", "refer"] as const;

/**
 * ProblemListTab — Assessment & Plan (docs §2.2). The student builds a
 * differential from an ICD/DSM picker, ranks it, selects a working diagnosis
 * (commitDiagnosis, scored for correctness in §4), and writes a plan. The plan
 * editor offers generic building blocks and standard dispositions that seed the
 * note (edited before saving), never the case's ground-truth answer. Options
 * come from the case's true differentials + the correct diagnosis, sorted so the
 * ground-truth code is not always first.
 */
export function ProblemListTab({ caseInstance, lang }: ProblemListTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");

  // The pickable option set: correct dx + differentials (deduped by code).
  const options = useMemo<DxOption[]>(() => {
    const all: Condition[] = [
      caseInstance.correctDiagnosis,
      ...caseInstance.differentials,
    ];
    const seen = new Set<string>();
    const opts: DxOption[] = [];
    for (const c of all) {
      const code = conceptCode(c.code);
      if (seen.has(code)) continue;
      seen.add(code);
      opts.push({ code, display: conceptText(c.code, lang) });
    }
    // Sort by display so the correct answer is not always first.
    return opts.sort((a, b) => a.display.localeCompare(b.display));
  }, [caseInstance, lang]);

  const filtered = query.trim()
    ? options.filter(
        (o) =>
          o.display.toLowerCase().includes(query.trim().toLowerCase()) ||
          o.code.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  const differentials = state.problemList.filter((p) => p.role === "differential");
  const working = state.problemList.find((p) => p.role === "working");
  const committed = state.committedDiagnosis;
  const planEntries = state.problemList.filter((p) => p.role === "plan");

  const addedCodes = new Set(differentials.map((d) => d.code));

  function addDifferential(o: DxOption) {
    if (addedCodes.has(o.code)) return;
    addProblem({ code: o.code, display: o.display, role: "differential" });
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

  const { container: dxContainer, item: dxItem } = useStagger();
  const { container: planContainer, item: planItem } = useStagger();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Differential builder */}
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <MagnifyingGlass weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("ehr.ap.pickerHeading")}
            </h3>
            <span className="font-mono text-[11px] tabular-nums text-muted">
              {t("ehr2.ap.optionsCount", { count: filtered.length })}
            </span>
          </div>
          <label htmlFor="dx-search" className="sr-only">
            {t("ehr.ap.searchPlaceholder")}
          </label>
          <div className="relative">
            <input
              id="dx-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("ehr.ap.searchPlaceholder")}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
          <ul className="mt-2 flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
            {filtered.map((o) => {
              const added = addedCodes.has(o.code);
              return (
                <li
                  key={o.code}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">
                      {o.display}
                    </span>
                    <span className="block font-mono text-[11px] text-muted">
                      {o.code}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => addDifferential(o)}
                    disabled={added}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                      "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                      added
                        ? "cursor-default border-transparent bg-bg-subtle text-muted"
                        : "border-border bg-surface text-brand hover:bg-brand-tint",
                    )}
                    aria-label={t("ehr.ap.addToDifferential", { name: o.display })}
                  >
                    {added ? (
                      <Check weight="bold" className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Plus weight="bold" className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {t(added ? "ehr.ap.added" : "ehr.ap.add")}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? (
              <li className="py-3 text-center text-xs italic text-muted">
                {t("ehr.ap.noMatches")}
              </li>
            ) : null}
          </ul>
        </Card>
      </div>

      {/* Differential list + working diagnosis + plan */}
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <ListChecks weight="bold" className="h-4 w-4 text-muted" aria-hidden />
              {t("ehr.ap.differentialHeading")}
            </h3>
            {differentials.length > 0 ? (
              <span className="font-mono text-[11px] tabular-nums text-muted">
                {t("ehr2.ap.differentialCount", { count: differentials.length })}
              </span>
            ) : null}
          </div>
          {differentials.length === 0 ? (
            <p className="text-xs italic text-muted">{t("ehr.ap.differentialEmpty")}</p>
          ) : (
            <motion.ol {...dxContainer} className="flex flex-col gap-1.5">
              {differentials.map((d, i) => {
                const isWorking = working?.code === d.code;
                return (
                  <motion.li
                    key={d.code}
                    {...dxItem}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-control border px-2.5 py-1.5",
                      isWorking
                        ? "border-brand/40 bg-brand-tint/40"
                        : "border-border bg-bg-subtle",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-label={t("ehr2.ap.rankLabel", { n: i + 1 })}
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface font-mono text-[11px] font-semibold tabular-nums text-muted"
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm text-fg">
                        {d.display}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => commitDiagnosis(d.code, d.display)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                        isWorking
                          ? "bg-brand text-white"
                          : "border border-border bg-surface text-fg hover:bg-brand-tint hover:text-brand",
                      )}
                      aria-pressed={isWorking}
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
                  </motion.li>
                );
              })}
            </motion.ol>
          )}

          {committed ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-control border border-brand/30 bg-brand-tint/50 px-2.5 py-2 text-xs text-fg">
              <CheckCircle weight="fill" className="mt-px h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
              <span>
                {t("ehr.ap.committedNote", { dx: working?.display ?? committed })}
              </span>
            </p>
          ) : null}
        </Card>

        {/* Plan */}
        <Card padding="md">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <ClipboardText weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.ap.planHeading")}
          </h3>

          {/* Quick-add building blocks */}
          <div className="mb-2 flex flex-col gap-2">
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("ehr2.ap.quickPlanHeading")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PLAN.map((k) => (
                  <PlanChip
                    key={k}
                    icon={<Plus weight="bold" className="h-3 w-3" aria-hidden />}
                    label={t(`ehr2.ap.quick.${k}`)}
                    onClick={() => insertPlan(t(`ehr2.ap.quick.${k}`))}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("ehr2.ap.dispositionHeading")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {DISPOSITIONS.map((k) => (
                  <PlanChip
                    key={k}
                    icon={<Path weight="bold" className="h-3 w-3" aria-hidden />}
                    label={t(`ehr2.ap.dispo.${k}`)}
                    onClick={() => insertPlan(t(`ehr2.ap.dispo.${k}`))}
                  />
                ))}
              </div>
            </div>
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

          {planEntries.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                {t("ehr2.ap.planCount", { count: planEntries.length })}
              </p>
              <motion.ul {...planContainer} className="flex flex-col gap-1.5">
                {planEntries.map((p, i) => (
                  <motion.li
                    key={i}
                    {...planItem}
                    className="flex items-start gap-2 text-sm text-fg"
                  >
                    <CheckCircle
                      weight="fill"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
                      aria-hidden
                    />
                    <span className="whitespace-pre-line">{p.note ?? p.display}</span>
                  </motion.li>
                ))}
              </motion.ul>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

/** A small pill button that seeds a line into the plan editor. */
function PlanChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg",
        "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
        "hover:bg-brand-tint hover:text-brand",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

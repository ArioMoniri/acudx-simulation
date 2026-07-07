import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MagnifyingGlass,
  Plus,
  ListChecks,
  Check,
  CheckCircle,
} from "@phosphor-icons/react";

import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
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

/**
 * ProblemListTab — Assessment & Plan (docs §2.2). The student builds a
 * differential from an ICD/DSM picker, selects a working diagnosis
 * (commitDiagnosis, scored for correctness in §4), and writes a plan. Options
 * come from the case's true differentials + the correct diagnosis, shuffled
 * with the ground-truth code hidden among plausible distractors.
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

  const addedCodes = new Set(differentials.map((d) => d.code));

  function addDifferential(o: DxOption) {
    if (addedCodes.has(o.code)) return;
    addProblem({ code: o.code, display: o.display, role: "differential" });
  }

  function savePlan() {
    const text = plan.trim();
    if (!text) return;
    addProblem({ code: "plan", display: text, role: "plan", note: text });
    setPlan("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Differential builder */}
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <MagnifyingGlass weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.ap.pickerHeading")}
          </h3>
          <label htmlFor="dx-search" className="sr-only">
            {t("ehr.ap.searchPlaceholder")}
          </label>
          <input
            id="dx-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ehr.ap.searchPlaceholder")}
            className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-none"
          />
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
                      "transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]",
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
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <ListChecks weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("ehr.ap.differentialHeading")}
          </h3>
          {differentials.length === 0 ? (
            <p className="text-xs italic text-muted">{t("ehr.ap.differentialEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {differentials.map((d) => {
                const isWorking = working?.code === d.code;
                return (
                  <li
                    key={d.code}
                    className="flex items-center justify-between gap-2 rounded-control border border-border bg-bg-subtle px-2.5 py-1.5"
                  >
                    <span className="min-w-0 truncate text-sm text-fg">
                      {d.display}
                    </span>
                    <button
                      type="button"
                      onClick={() => commitDiagnosis(d.code, d.display)}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        "transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]",
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
                  </li>
                );
              })}
            </ul>
          )}

          {committed ? (
            <p className="mt-3 rounded-control border border-brand/30 bg-brand-tint/50 px-2.5 py-2 text-xs text-fg">
              {t("ehr.ap.committedNote", {
                dx: working?.display ?? committed,
              })}
            </p>
          ) : null}
        </Card>

        {/* Plan */}
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            {t("ehr.ap.planHeading")}
          </h3>
          <label htmlFor="ap-plan" className="sr-only">
            {t("ehr.ap.planPlaceholder")}
          </label>
          <textarea
            id="ap-plan"
            rows={3}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            placeholder={t("ehr.ap.planPlaceholder")}
            className="w-full resize-none rounded-control border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus-visible:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="secondary" onClick={savePlan} disabled={!plan.trim()}>
              {t("ehr.ap.savePlan")}
            </Button>
          </div>

          {state.problemList.filter((p) => p.role === "plan").length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              {state.problemList
                .filter((p) => p.role === "plan")
                .map((p, i) => (
                  <li key={i} className="text-sm text-fg">
                    {p.note ?? p.display}
                  </li>
                ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

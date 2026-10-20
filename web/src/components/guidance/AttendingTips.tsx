import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChalkboardTeacher,
  CheckCircle,
  Circle,
  CloudSlash,
  LockSimple,
  ShieldCheck,
  Timer,
  Warning,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Badge, Card, SectionLabel, Switch, type BadgeProps } from "@/components/ui";
import { CitationPill } from "@/components/CitationPill";
import { useLang } from "@/lib/useLang";
import { useEncounterState, type EncounterStage } from "@/state/encounterStore";
import {
  computeCoverage,
  type Coverage,
  type NextBestAction,
  type WorkupItem,
  type WorkupTiming,
} from "@/lib/guidanceEngine";
import {
  TIP_STAGES,
  useAttendingTips,
  visibleTipStages,
  type AttendingTipView,
  type TipStage,
  type TipsState,
} from "@/lib/guidelinesApi";
import type { Lang } from "@/data/schema";

export interface AttendingTipsProps {
  className?: string;
  /** Whether the card starts expanded. Defaults to open. */
  defaultOpen?: boolean;
  /**
   * Optional CONTROLLED guidance state. The encounter already owns a single
   * guidance switch (EncounterPage → ActivityTabs → InterviewTab). When that
   * shared value is threaded down to this panel, pass it here so the attending
   * tips reflect the SAME switch instead of owning a second, unsynced one. When
   * it is omitted, the panel stays on and its local control switches coaching
   * DETAIL, never a duplicate on/off.
   */
  guidanceOn?: boolean;
}

type TFunc = ReturnType<typeof useTranslation>["t"];

/* -------------------------------------------------------------------------- */
/* Timing helpers                                                              */
/* -------------------------------------------------------------------------- */

const timingTone: Record<WorkupTiming, BadgeProps["tone"]> = {
  onTime: "normal",
  late: "caution",
  pending: "neutral",
  overdue: "critical",
};

function timingLabel(timing: WorkupTiming, ordered: boolean, t: TFunc): string {
  if (ordered) return t(`guidance3.workup.${timing}`);
  return timing === "overdue" ? t("guidance3.workup.overdue") : t("guidance3.workup.pending");
}

function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** Compose the next-best-action sentence. Process only, never the diagnosis. */
function nextActionText(nba: NextBestAction, lang: Lang, t: TFunc): string {
  switch (nba.kind) {
    case "workup": {
      const label = (lang === "tr" ? nba.labelTr : nba.labelEn) ?? nba.ref ?? "";
      return t("guidance3.nba.order", { label });
    }
    case "history":
      return t("guidance3.nba.askAbout", { topic: t(`guidance3.intent.${nba.ref}`, nba.ref ?? "") });
    case "exam":
      return t("guidance3.nba.examine", { system: t(`guidance3.maneuver.${nba.ref}`, nba.ref ?? "") });
    case "redflag":
      return t("guidance3.nba.screenRedFlags");
    case "complete":
      return t("guidance3.nba.complete");
  }
}

/* -------------------------------------------------------------------------- */
/* AttendingTips                                                               */
/* -------------------------------------------------------------------------- */

/**
 * AttendingTips — an AMBOSS-style "attending physician" teaching card.
 *
 * It leads with the single next best action, gives a LIVE reading of how far
 * the learner's work-up has come, and then the attending tips themselves: dense
 * rows grouped by stage (triage, history, exam, work-up, treatment,
 * disposition), each with the action, its pitfall, a timing hint and citation
 * chips. Every tip comes from GET /v1/guidelines/tips and is backed ONLY by
 * verified GuidelineStatements; offline the section says guidance is
 * unavailable. Treatment and disposition rows stay locked until the encounter
 * reaches assessment so the coach never leaks management ahead of the work-up.
 */
export function AttendingTips({ className, defaultOpen = true, guidanceOn }: AttendingTipsProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const state = useEncounterState();
  const [open, setOpen] = useState(defaultOpen);
  // Local control over coaching DETAIL, NOT a second on/off guidance switch.
  const [detailOpen, setDetailOpen] = useState(true);

  const caseInstance = state.caseInstance;
  const conditionCode = caseInstance?.correctDiagnosis.code.coding[0]?.code;
  const tips = useAttendingTips(guidanceOn === false ? undefined : conditionCode, lang);

  if (!caseInstance) return null;

  // Dismissed -> a small reopen affordance.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-chip border border-border bg-surface px-3 py-1.5",
          "text-xs font-medium text-fg shadow-soft transition-colors hover:border-border-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          className,
        )}
      >
        <ChalkboardTeacher weight="fill" className="h-4 w-4 text-brand" aria-hidden />
        {t("guidance3.guide.reopen")}
      </button>
    );
  }

  const coachingOff = guidanceOn === false;
  const coverage = coachingOff ? null : computeCoverage(state, caseInstance);
  const nba = coverage?.nextBestAction ?? null;
  const critical = coverage ? coverage.workup.items.filter((w) => w.critical) : [];
  const consider = coverage ? coverage.workup.items.filter((w) => !w.critical) : [];

  return (
    <Card variant="surface" padding="md" className={className} role="complementary" aria-label={t("guidance3.guide.title")}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span aria-hidden="true" className="grid h-7 w-6 shrink-0 place-items-center text-brand">
            <ChalkboardTeacher weight="fill" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="serif text-lg leading-tight text-fg">{t("guidance3.guide.title")}</h3>
              <span className="rounded-chip bg-brand-tint px-1 text-[0.625rem] font-semibold uppercase leading-4 tracking-wide text-brand">
                {t("guidance3.panel.education")}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <p className="text-xs text-muted">{t("guidance3.guide.subtitle")}</p>
              {!coachingOff ? (
                <label className="flex items-center gap-1.5">
                  <span className="eyebrow">{t("guidance3.guide.detail", { defaultValue: "Full outline" })}</span>
                  <Switch
                    checked={detailOpen}
                    onCheckedChange={setDetailOpen}
                    aria-label={t("guidance3.guide.detailAria", { defaultValue: "Show the full work-up outline" })}
                  />
                </label>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("guidance3.guide.dismiss")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-subtle transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X weight="bold" className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {coachingOff || !coverage ? (
        <p className="mt-3 rounded-control border border-border bg-bg-subtle p-3 text-xs leading-relaxed text-muted">
          {t("guidance3.guide.offBody")}
        </p>
      ) : (
        <>
          {/* Next best action: the lead of the teaching card. */}
          {nba ? (
            <div
              className={cn(
                "mt-4 rounded-control border p-3",
                nba.urgent
                  ? "border-[color:var(--state-critical)]/30 bg-[color-mix(in_srgb,var(--state-critical)_8%,transparent)]"
                  : "border-brand/25 bg-brand-tint/50",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">{t("guidance3.nba.title")}</span>
                {nba.urgent ? (
                  <Badge tone="critical" dot className="py-0">
                    {t("guidance3.nba.urgent")}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white",
                    nba.urgent ? "bg-[color:var(--state-critical)]" : "bg-brand",
                  )}
                >
                  <ArrowRight weight="bold" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-fg">{nextActionText(nba, lang, t)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {nba.kind === "workup" && nba.idealWindowMs != null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Timer weight="bold" className="h-3.5 w-3.5" aria-hidden />
                        {t("guidance3.nba.within", { minutes: minutesOf(nba.idealWindowMs) })}
                      </span>
                    ) : null}
                    {nba.citationId ? <CitationPill citationId={nba.citationId} lang={lang} /> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Live coverage, reactive to what the learner has / has not done. */}
          <CoverageProgress coverage={coverage} t={t} />

          {/* Attending tips: verified, stage-grouped, dense. */}
          <TipsSection tips={tips} encounterStage={state.stage} lang={lang} t={t} />

          {/* What a strong work-up covers, only in "Full outline" detail mode. */}
          {detailOpen && coverage.workup.items.length > 0 ? (
            <div className="mt-4">
              <SectionLabel>{t("guidance3.workup.title")}</SectionLabel>
              {critical.length > 0 ? (
                <OutlineGroup heading={t("guidance3.workup.do")} tone="do">
                  {critical.map((w) => (
                    <WorkupRow key={w.expectationId} item={w} lang={lang} t={t} do />
                  ))}
                </OutlineGroup>
              ) : null}
              {consider.length > 0 ? (
                <OutlineGroup heading={t("guidance3.workup.consider")} tone="consider">
                  {consider.map((w) => (
                    <WorkupRow key={w.expectationId} item={w} lang={lang} t={t} />
                  ))}
                </OutlineGroup>
              ) : null}
            </div>
          ) : null}

          {/* Standing safety framing: process only, never the diagnosis. */}
          <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-[11px] leading-relaxed text-subtle">
            <ShieldCheck weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t("guidance3.guide.processOnly")}</span>
          </p>
        </>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Attending tips section                                                      */
/* -------------------------------------------------------------------------- */

const STAGE_ORDER: readonly TipStage[] = TIP_STAGES;

function TipsSection({
  tips,
  encounterStage,
  lang,
  t,
}: {
  tips: TipsState;
  encounterStage: EncounterStage;
  lang: Lang;
  t: TFunc;
}) {
  const visible = new Set(visibleTipStages(encounterStage));
  const lockedStages = STAGE_ORDER.filter((s) => !visible.has(s));

  return (
    <div className="mt-4">
      <SectionLabel>{t("guidance3.tips.title", { defaultValue: "Attending tips" })}</SectionLabel>
      <p className="mt-0.5 text-[11px] text-subtle">
        {t("guidance3.tips.subtitle", { defaultValue: "Short, actionable, each one traced to a verified guideline statement" })}
      </p>

      {tips.status === "loading" ? (
        <ul className="mt-2.5 flex flex-col gap-1.5" aria-busy="true" aria-label={t("guidance3.tips.loading", { defaultValue: "Loading attending tips" })}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-10 animate-pulse rounded-control border border-border bg-bg-subtle" />
          ))}
        </ul>
      ) : tips.status === "unavailable" ? (
        <div role="status" className="mt-2.5 flex items-start gap-2 rounded-control border border-dashed border-border bg-bg-subtle p-2.5">
          <CloudSlash weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <p className="text-xs leading-relaxed text-muted">
            <span className="font-semibold text-fg">{t("guidance3.unavailable.title", { defaultValue: "Guidance unavailable" })}</span>{" "}
            {t("guidance3.unavailable.body", {
              defaultValue:
                "No verified guideline statement could be served for this step. Nothing is shown rather than an unverified hint.",
            })}
          </p>
        </div>
      ) : (
        <>
          {STAGE_ORDER.filter((s) => visible.has(s) && tips.byStage[s].length > 0).map((stage) => (
            <div key={stage} className="mt-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t(`guidance3.tips.stage.${stage}`, { defaultValue: stage })}
              </span>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {tips.byStage[stage].map((tip) => (
                  <TipRow key={tip.id} tip={tip} lang={lang} t={t} />
                ))}
              </ul>
            </div>
          ))}
          {lockedStages.some((s) => tips.byStage[s].length > 0) ? (
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-subtle">
              <LockSimple weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("guidance3.tips.locked", { defaultValue: "Treatment and disposition tips unlock once you reach the assessment stage." })}</span>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function TipRow({ tip, lang, t }: { tip: AttendingTipView; lang: Lang; t: TFunc }) {
  return (
    <li className="rounded-control border border-border bg-surface px-2.5 py-2">
      <p className="text-sm leading-snug text-fg">{tip.tip}</p>
      {tip.pitfall ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-muted">
          <Warning weight="fill" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--state-caution)]" aria-hidden />
          <span>
            <span className="font-semibold text-fg">{t("guidance3.tips.pitfall", { defaultValue: "Pitfall" })}:</span> {tip.pitfall}
          </span>
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {tip.timingHint ? (
          <span className="inline-flex items-center gap-1 rounded-chip bg-bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">
            <Timer weight="bold" className="h-3 w-3" aria-hidden />
            {tip.timingHint}
          </span>
        ) : null}
        {tip.citations.map((c) => (
          <CitationPill key={c.id} citationId={c.id} citation={c} lang={lang} />
        ))}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Live coverage progress                                                      */
/* -------------------------------------------------------------------------- */

function CoverageProgress({ coverage, t }: { coverage: Coverage; t: TFunc }) {
  const pct = Math.max(0, Math.min(100, Math.round(coverage.overallPct * 100)));
  const totalDone = coverage.history.done + coverage.exam.done + coverage.workup.done;
  const totalExpected = coverage.history.expected + coverage.exam.expected + coverage.workup.expected;

  const groups = [
    { key: "history", done: coverage.history.done, total: coverage.history.expected },
    { key: "exam", done: coverage.exam.done, total: coverage.exam.expected },
    { key: "workup", done: coverage.workup.done, total: coverage.workup.expected },
  ] as const;

  return (
    <div className="mt-3 rounded-control border border-border bg-bg-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{t("guidance3.guide.progress", { defaultValue: "Your work-up so far" })}</span>
        <span className="tnum text-xs font-semibold text-fg">{t("guidance3.guide.pct", { defaultValue: "{{pct}}% covered", pct })}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-chip bg-bg-inset" role="presentation">
        <div
          className="h-full rounded-chip bg-brand transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {groups.map((g) => (
          <div key={g.key} className="min-w-0 rounded-control border border-border bg-surface px-2.5 py-1.5">
            <p className="truncate text-[11px] font-medium text-muted">{t(`guidance3.coverage.${g.key}`)}</p>
            <p className="tnum text-sm font-semibold text-fg">
              {g.done}
              <span className="text-subtle">/{g.total}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] text-subtle">
        {t("guidance3.guide.progressSummary", {
          defaultValue: "{{done}} of {{expected}} expected steps covered",
          done: totalDone,
          expected: totalExpected,
        })}
        {coverage.redFlags.total > 0 ? (
          <>
            {" · "}
            {t("guidance3.redflags.title")}{" "}
            {t("guidance3.redflags.count", { screened: coverage.redFlags.screened, total: coverage.redFlags.total })}
          </>
        ) : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Outline bits                                                                */
/* -------------------------------------------------------------------------- */

function OutlineGroup({ heading, tone, children }: { heading: string; tone: "do" | "consider"; children: React.ReactNode }) {
  return (
    <div className="mt-2.5">
      <span className={cn("text-[11px] font-semibold uppercase tracking-wide", tone === "do" ? "text-[color:var(--state-critical)]" : "text-muted")}>
        {heading}
      </span>
      <ul className="mt-1.5 flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function WorkupRow({ item, lang, t, do: isDo = false }: { item: WorkupItem; lang: Lang; t: TFunc; do?: boolean }) {
  const label = lang === "tr" ? item.labelTr : item.labelEn;
  const tone = timingTone[item.timing];
  return (
    <li className="flex items-start gap-2 rounded-control border border-border bg-surface px-2.5 py-2">
      {item.ordered ? (
        <CheckCircle weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-normal)]" aria-hidden />
      ) : isDo ? (
        <WarningCircle weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-critical)]" aria-hidden />
      ) : (
        <Circle weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-fg">{t("guidance3.workup.within", { label, minutes: minutesOf(item.idealWindowMs) })}</span>
          <Badge tone={tone} dot className="py-0">
            {timingLabel(item.timing, item.ordered, t)}
          </Badge>
        </div>
        <div className="mt-1">
          <CitationPill citationId={item.citationId} lang={lang} />
        </div>
      </div>
    </li>
  );
}

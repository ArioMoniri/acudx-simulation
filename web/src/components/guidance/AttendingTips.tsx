import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChalkboardTeacher,
  CheckCircle,
  Circle,
  ShieldCheck,
  Timer,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Badge, Card, SectionLabel, Switch, type BadgeProps } from "@/components/ui";
import { CitationPill } from "@/components/CitationPill";
import { useLang } from "@/lib/useLang";
import { useEncounterState } from "@/state/encounterStore";
import {
  computeCoverage,
  type Coverage,
  type NextBestAction,
  type WorkupItem,
  type WorkupTiming,
} from "@/lib/guidanceEngine";
import type { Lang } from "@/data/mock";

export interface AttendingTipsProps {
  className?: string;
  /** Whether the card starts expanded. Defaults to open. */
  defaultOpen?: boolean;
  /**
   * Optional CONTROLLED guidance state. The encounter already owns a single
   * guidance switch (EncounterPage → ActivityTabs → InterviewTab). When that
   * shared value is threaded down to this panel, pass it here so the attending
   * tips reflect the SAME switch instead of owning a second, unsynced one. When
   * it is omitted (today's render is `<AttendingTips defaultOpen/>`), the panel
   * stays on and its local control switches coaching DETAIL — never a duplicate
   * on/off.
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
  return timing === "overdue"
    ? t("guidance3.workup.overdue")
    : t("guidance3.workup.pending");
}

function minutesOf(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** Compose the next-best-action sentence. Process only — never the diagnosis. */
function nextActionText(nba: NextBestAction, lang: Lang, t: TFunc): string {
  switch (nba.kind) {
    case "workup": {
      const label = (lang === "tr" ? nba.labelTr : nba.labelEn) ?? nba.ref ?? "";
      return t("guidance3.nba.order", { label });
    }
    case "history":
      return t("guidance3.nba.askAbout", {
        topic: t(`guidance3.intent.${nba.ref}`, nba.ref ?? ""),
      });
    case "exam":
      return t("guidance3.nba.examine", {
        system: t(`guidance3.maneuver.${nba.ref}`, nba.ref ?? ""),
      });
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
 * AttendingTips — an AMBOSS-style "attending physician" teaching card. It leads
 * with the single next best action, then gives a LIVE reading of how far the
 * learner's work-up has come (history / exam / orders covered + red-flag
 * screening), and an on-demand outline of what a strong work-up covers (DO /
 * consider with timing nudges like "ECG within 10 min") — every finding cited to
 * its guideline. Everything reacts to the real encounter log via
 * `computeCoverage`. Dismissible to a small reopen chip. It coaches PROCESS ONLY
 * and never names, ranks, or hints at the diagnosis.
 *
 * The panel does NOT own a second guidance on/off switch. When the shared
 * `guidanceOn` is passed it mirrors that master switch; its own toggle instead
 * controls coaching DETAIL (a focused next-step view vs. the full work-up
 * outline), which is genuinely useful rather than a show/hide of a static block.
 */
export function AttendingTips({
  className,
  defaultOpen = true,
  guidanceOn,
}: AttendingTipsProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const state = useEncounterState();
  const [open, setOpen] = useState(defaultOpen);
  // Local control over coaching DETAIL — NOT a second on/off guidance switch.
  const [detailOpen, setDetailOpen] = useState(true);

  const caseInstance = state.caseInstance;
  if (!caseInstance) return null;

  // Dismissed -> a small reopen affordance.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5",
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

  // Mirror the shared guidance switch when the parent drives it. Only false
  // (an explicit off) silences the coach; undefined keeps it on.
  const coachingOff = guidanceOn === false;

  const coverage = coachingOff ? null : computeCoverage(state, caseInstance);
  const nba = coverage?.nextBestAction ?? null;
  const critical = coverage ? coverage.workup.items.filter((w) => w.critical) : [];
  const consider = coverage ? coverage.workup.items.filter((w) => !w.critical) : [];

  return (
    <Card
      variant="surface"
      padding="md"
      className={className}
      role="complementary"
      aria-label={t("guidance3.guide.title")}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-chip bg-brand-tint text-brand"
          >
            <ChalkboardTeacher weight="fill" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-fg">
                {t("guidance3.guide.title")}
              </h3>
              <span className="rounded-pill bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                {t("guidance3.panel.education")}
              </span>
            </div>
            <p className="text-xs text-muted">{t("guidance3.guide.subtitle")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!coachingOff ? (
            <label className="flex items-center gap-1.5">
              <span className="eyebrow">
                {t("guidance3.guide.detail", { defaultValue: "Full outline" })}
              </span>
              <Switch
                checked={detailOpen}
                onCheckedChange={setDetailOpen}
                aria-label={t("guidance3.guide.detailAria", {
                  defaultValue: "Show the full work-up outline",
                })}
              />
            </label>
          ) : null}
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
          {/* Next best action — the lead of the teaching card. */}
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
                  <p className="text-sm font-semibold leading-snug text-fg">
                    {nextActionText(nba, lang, t)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {nba.kind === "workup" && nba.idealWindowMs != null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Timer weight="bold" className="h-3.5 w-3.5" aria-hidden />
                        {t("guidance3.nba.within", { minutes: minutesOf(nba.idealWindowMs) })}
                      </span>
                    ) : null}
                    {nba.citationId ? (
                      <CitationPill citationId={nba.citationId} lang={lang} />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Live coverage — reactive to what the learner has / hasn't done. */}
          <CoverageProgress coverage={coverage} t={t} />

          {/* What a strong work-up covers — only in "Full outline" detail mode. */}
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

          {/* Standing safety framing — process only, never the diagnosis. */}
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
/* Live coverage progress                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A compact, live readout of how complete the work-up is — a meter plus per-area
 * counters. Every number comes from `computeCoverage`, so it tracks exactly what
 * the learner has (and has not) done this encounter.
 */
function CoverageProgress({ coverage, t }: { coverage: Coverage; t: TFunc }) {
  const pct = Math.max(0, Math.min(100, Math.round(coverage.overallPct * 100)));
  const totalDone =
    coverage.history.done + coverage.exam.done + coverage.workup.done;
  const totalExpected =
    coverage.history.expected + coverage.exam.expected + coverage.workup.expected;

  const groups = [
    { key: "history", done: coverage.history.done, total: coverage.history.expected },
    { key: "exam", done: coverage.exam.done, total: coverage.exam.expected },
    { key: "workup", done: coverage.workup.done, total: coverage.workup.expected },
  ] as const;

  return (
    <div className="mt-3 rounded-control border border-border bg-bg-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">
          {t("guidance3.guide.progress", { defaultValue: "Your work-up so far" })}
        </span>
        <span className="tnum text-xs font-semibold text-fg">
          {t("guidance3.guide.pct", { defaultValue: "{{pct}}% covered", pct })}
        </span>
      </div>

      {/* Meter — reflects overall completeness. */}
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-bg-inset"
        role="presentation"
      >
        <div
          className="h-full rounded-pill bg-brand transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {groups.map((g) => (
          <div
            key={g.key}
            className="min-w-0 rounded-control border border-border bg-surface px-2.5 py-1.5"
          >
            <p className="truncate text-[11px] font-medium text-muted">
              {t(`guidance3.coverage.${g.key}`)}
            </p>
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
            {t("guidance3.redflags.count", {
              screened: coverage.redFlags.screened,
              total: coverage.redFlags.total,
            })}
          </>
        ) : null}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Outline bits                                                                */
/* -------------------------------------------------------------------------- */

function OutlineGroup({
  heading,
  tone,
  children,
}: {
  heading: string;
  tone: "do" | "consider";
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2.5">
      <span
        className={cn(
          "text-[11px] font-semibold uppercase tracking-wide",
          tone === "do" ? "text-[color:var(--state-critical)]" : "text-muted",
        )}
      >
        {heading}
      </span>
      <ul className="mt-1.5 flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function WorkupRow({
  item,
  lang,
  t,
  do: isDo = false,
}: {
  item: WorkupItem;
  lang: Lang;
  t: TFunc;
  do?: boolean;
}) {
  const label = lang === "tr" ? item.labelTr : item.labelEn;
  const tone = timingTone[item.timing];
  return (
    <li className="flex items-start gap-2 rounded-control border border-border bg-surface px-2.5 py-2">
      {item.ordered ? (
        <CheckCircle
          weight="fill"
          className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-normal)]"
          aria-hidden
        />
      ) : isDo ? (
        <WarningCircle
          weight="fill"
          className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-critical)]"
          aria-hidden
        />
      ) : (
        <Circle weight="bold" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-fg">
            {t("guidance3.workup.within", {
              label,
              minutes: minutesOf(item.idealWindowMs),
            })}
          </span>
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

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChalkboardTeacher,
  CheckCircle,
  Circle,
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
  type NextBestAction,
  type WorkupItem,
  type WorkupTiming,
} from "@/lib/guidanceEngine";
import type { Lang } from "@/data/mock";

export interface AttendingTipsProps {
  className?: string;
  /** Whether the card starts expanded. Defaults to open. */
  defaultOpen?: boolean;
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
 * AttendingTips — a compact "attending physician" coach. It surfaces the single
 * next best action, an outline of what a strong work-up covers (as a DO /
 * consider list with timing nudges like "ECG within 10 min"), and a guide-mode
 * toggle. Dismissible to a small reopen chip. It coaches PROCESS ONLY and never
 * names, ranks, or hints at the diagnosis.
 */
export function AttendingTips({ className, defaultOpen = true }: AttendingTipsProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const state = useEncounterState();
  const [open, setOpen] = useState(defaultOpen);
  const [guideMode, setGuideMode] = useState(true);

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

  const coverage = computeCoverage(state, caseInstance);
  const nba = coverage.nextBestAction;
  const critical = coverage.workup.items.filter((w) => w.critical);
  const consider = coverage.workup.items.filter((w) => !w.critical);

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
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-chip bg-brand-tint text-brand"
          >
            <ChalkboardTeacher weight="fill" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight text-fg">
              {t("guidance3.guide.title")}
            </h3>
            <p className="text-xs text-muted">{t("guidance3.guide.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="eyebrow">{t("guidance3.guide.mode")}</span>
            <Switch
              checked={guideMode}
              onCheckedChange={setGuideMode}
              aria-label={t("guidance3.guide.mode")}
            />
          </label>
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

      {!guideMode ? (
        <p className="mt-3 rounded-control border border-border bg-bg-subtle p-3 text-xs leading-relaxed text-muted">
          {t("guidance3.guide.offBody")}
        </p>
      ) : (
        <>
          {/* Next best action */}
          {nba ? (
            <div
              className={cn(
                "mt-3 flex items-start gap-2.5 rounded-control border p-3",
                nba.urgent
                  ? "border-[color:var(--state-critical)]/30 bg-[color-mix(in_srgb,var(--state-critical)_8%,transparent)]"
                  : "border-brand/25 bg-brand-tint/50",
              )}
            >
              <ArrowRight
                weight="bold"
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  nba.urgent ? "text-[color:var(--state-critical)]" : "text-brand",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="eyebrow">{t("guidance3.nba.title")}</span>
                  {nba.urgent ? (
                    <Badge tone="critical" dot className="py-0">
                      {t("guidance3.nba.urgent")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm font-semibold leading-snug text-fg">
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
          ) : null}

          {/* What a strong work-up covers */}
          {coverage.workup.items.length > 0 ? (
            <div className="mt-3">
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

          <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-relaxed text-subtle">
            {t("guidance3.guide.processOnly")}
          </p>
        </>
      )}
    </Card>
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
    <div className="mt-2">
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
    <li className="flex items-start gap-2">
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

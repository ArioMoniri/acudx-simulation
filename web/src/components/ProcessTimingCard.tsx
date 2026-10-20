import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  Clock,
  XCircle,
  ShieldWarning,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { CitationPill } from "@/components/CitationPill";
import type { Lang } from "@/data/schema";
import type {
  CriticalActionResult,
  CriticalActionStatus,
} from "@/domain/processMetrics";

export interface ProcessTimingCardProps {
  action: CriticalActionResult;
  lang: Lang;
}

interface StatusPresentation {
  Icon: Icon;
  /** CSS var token — never the sole carrier of meaning; always paired with text. */
  token: string;
  labelKey: string;
}

const STATUS: Record<CriticalActionStatus, StatusPresentation> = {
  onTime: {
    Icon: CheckCircle,
    token: "--state-normal",
    labelKey: "feedback.process.status.onTime",
  },
  late: {
    Icon: Clock,
    token: "--state-caution",
    labelKey: "feedback.process.status.late",
  },
  missed: {
    Icon: XCircle,
    token: "--state-critical",
    labelKey: "feedback.process.status.missed",
  },
};

/** Whole minutes from ms, for compact "18 min" style labels. */
function toMin(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * ProcessTimingCard — one time-to-critical-action finding. The status is carried
 * by an icon + a text label + an aria-live region (never color alone, WCAG
 * 1.4.1), the timing is anchored ("ordered at 18 min; target <= 10 min"), and
 * the guideline is cited (docs/00-overview/04 §4.2). Correct (on-time) actions
 * are cited too, not only misses.
 */
export function ProcessTimingCard({ action, lang }: ProcessTimingCardProps) {
  const { t } = useTranslation();
  const label = lang === "tr" ? action.labelTr : action.labelEn;
  const { Icon: StatusIcon, token, labelKey } = STATUS[action.status];
  const statusLabel = t(labelKey);

  const targetMin = toMin(action.idealWindowMs);
  const takenMin = action.takenAtMs == null ? null : toMin(action.takenAtMs);

  // The evidence anchor line (what happened vs the target).
  const anchor =
    takenMin == null
      ? t("feedback.process.timing.missedAnchor", { target: targetMin })
      : t("feedback.process.timing.takenAnchor", {
          taken: takenMin,
          target: targetMin,
        });

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-control border bg-surface p-3.5",
        action.status === "missed"
          ? "border-[color:var(--state-critical)]/40"
          : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <StatusIcon
            weight="fill"
            className="mt-0.5 h-5 w-5 shrink-0"
            style={{ color: `var(${token})` }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">{label}</p>
            <p
              className="mt-0.5 text-xs text-muted"
              aria-live="polite"
            >
              {/* Text-equivalent of the status, so it never relies on color. */}
              <span className="font-medium" style={{ color: `var(${token})` }}>
                {statusLabel}
              </span>{" "}
              · {anchor}
            </p>
          </div>
        </div>
        {action.critical ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--state-critical)]/40 bg-[color-mix(in_srgb,var(--state-critical)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--state-critical)]"
            title={t("feedback.process.criticalActionTitle")}
          >
            <ShieldWarning weight="fill" className="h-3 w-3" aria-hidden />
            {t("feedback.process.criticalTag")}
          </span>
        ) : null}
      </div>
      <div className="ps-7">
        <CitationPill citationId={action.citationId} lang={lang} />
      </div>
    </div>
  );
}

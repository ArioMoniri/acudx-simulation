import { useTranslation } from "react-i18next";
import { SealCheck, Lock } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { Band, FeedbackDomainKey } from "@/data/schema";

/** The five ordered performance bands, lowest to highest. */
export const BAND_SCALE: Exclude<Band, "withheld">[] = [
  "emerging",
  "developing",
  "proficient",
  "strong",
  "exemplary",
];

export interface DomainBandProps {
  domainKey: FeedbackDomainKey;
  band: Band;
  /** Which orthogonal axis this domain belongs to (drives the accent token). */
  axis: "clinical" | "communication";
}

/**
 * DomainBand — a five-step band meter for one feedback domain.
 * The achieved band is highlighted by fill + label + position (not color
 * alone); a withheld band is shown as an explicit, reliability-gated note.
 */
export function DomainBand({ domainKey, band, axis }: DomainBandProps) {
  const { t } = useTranslation();
  const accent =
    axis === "clinical"
      ? "var(--axis-clinical)"
      : "var(--axis-communication)";
  const name = t(`feedback.domains.${domainKey}`);

  if (band === "withheld") {
    return (
      <div className="rounded-control border border-dashed border-border bg-bg-subtle p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-fg">{name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">
            <Lock weight="bold" className="h-3 w-3" aria-hidden />
            {t("bands.withheld")}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted">{t("feedback.withheld")}</p>
      </div>
    );
  }

  const achievedIndex = BAND_SCALE.indexOf(band);

  return (
    <div className="rounded-control border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{name}</span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{
            color: accent,
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
          }}
        >
          <SealCheck weight="fill" className="h-3 w-3" aria-hidden />
          {t(`bands.${band}`)}
        </span>
      </div>

      {/* Five-step meter; the achieved step is filled + carries the position */}
      <div
        className="mt-3 flex items-end gap-1"
        role="img"
        aria-label={t("feedback.achievedBand", { band: t(`bands.${band}`) })}
      >
        {BAND_SCALE.map((step, i) => {
          const reached = i <= achievedIndex;
          const isAchieved = i === achievedIndex;
          return (
            <div key={step} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={cn(
                  "w-full rounded-full transition-all duration-300 ease-out",
                  isAchieved ? "h-3" : "h-1.5",
                )}
                style={{
                  backgroundColor: reached
                    ? accent
                    : "var(--border)",
                  opacity: reached && !isAchieved ? 0.45 : 1,
                }}
              />
              <span
                className={cn(
                  "text-[9px] font-medium leading-tight",
                  isAchieved ? "text-fg" : "text-muted",
                )}
              >
                {t(`bands.${step}`)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

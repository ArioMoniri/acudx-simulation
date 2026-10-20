import { useTranslation } from "react-i18next";
import { Flask, ShieldCheck } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";

export interface SimBadgeProps {
  /** "chip" (inline pill, default) or "bar" (full-width strip). */
  variant?: "chip" | "bar";
  className?: string;
}

/**
 * SimBadge — the persistent "SIM - synthetic patient - education only" marker.
 *
 * Always visible in the EHR workspace to satisfy the safety requirement and
 * EU AI Act Art. 50 transparency (synthetic media / AI system disclosure). It
 * is intentionally low-chroma so it reads as a system marker, not a clinical
 * state. Carries an icon + text (never color alone) and an aria-label.
 */
export function SimBadge({ variant = "chip", className }: SimBadgeProps) {
  const { t } = useTranslation();
  const label = t("ehr.sim.full");

  if (variant === "bar") {
    return (
      <div
        role="note"
        aria-label={label}
        className={cn(
          "flex items-center gap-2 rounded-control border border-dashed border-border",
          "bg-bg-subtle px-3 py-1.5 text-xs text-muted",
          className,
        )}
      >
        <ShieldCheck weight="bold" className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-semibold uppercase tracking-wide">
          {t("ehr.sim.tag")}
        </span>
        <span aria-hidden className="text-muted/60">
          ·
        </span>
        <span>{t("ehr.sim.synthetic")}</span>
        <span aria-hidden className="text-muted/60">
          ·
        </span>
        <span>{t("ehr.sim.education")}</span>
      </div>
    );
  }

  return (
    <span
      role="note"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border",
        "bg-bg-subtle px-2.5 py-0.5 text-[11px] font-medium text-muted",
        className,
      )}
    >
      <Flask weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="uppercase tracking-wide">{t("ehr.sim.tag")}</span>
      <span className="hidden sm:inline text-muted">
        {t("ehr.sim.short")}
      </span>
    </span>
  );
}

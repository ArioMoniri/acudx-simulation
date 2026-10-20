import { useTranslation } from "react-i18next";
import { Flask, ShieldCheck, Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { CaseGenerationMeta } from "@/lib/liveEncounter";

export interface SimBadgeProps {
  /** "chip" (inline pill, default) or "bar" (full-width strip). */
  variant?: "chip" | "bar";
  /**
   * Provenance of the running case. When given, the badge also names the
   * source (model, template, offline, curated, published) and, for a model
   * case, the council verdict and the degraded flag, so a learner always knows
   * whether a model authored the case or a deterministic path did.
   */
  generation?: CaseGenerationMeta | null;
  className?: string;
}

/** Visible provenance tail: source word, council verdict, degraded marker. */
function ProvenanceTail({ generation }: { generation: CaseGenerationMeta }) {
  const { t } = useTranslation();
  const council = generation.council;
  const verdictKey =
    generation.source === "model" && council
      ? council.vetoed
        ? "vetoed"
        : council.decision === "accept"
          ? "accepted"
          : council.decision === "repair"
            ? "repairing"
            : null
      : null;
  return (
    <span className="inline-flex items-center gap-1" data-testid="sim-source">
      <span aria-hidden className="text-muted/60">
        ·
      </span>
      <span className="text-fg/80">{t(`live2.source.${generation.source}`)}</span>
      {verdictKey ? (
        <span className="hidden text-muted/80 sm:inline">
          {t(`live2.council.${verdictKey}`, { repairs: council?.repairs ?? 0 })}
        </span>
      ) : null}
      {generation.degraded ? (
        <span
          className="inline-flex items-center gap-0.5 text-[color:var(--state-caution)]"
          title={generation.note ?? undefined}
        >
          <Warning weight="fill" className="h-3 w-3" aria-hidden />
          {t("live2.degraded")}
        </span>
      ) : null}
    </span>
  );
}

/**
 * SimBadge — the persistent "SIM - synthetic patient - education only" marker.
 *
 * Always visible in the EHR workspace to satisfy the safety requirement and
 * EU AI Act Art. 50 transparency (synthetic media / AI system disclosure). It
 * is intentionally low-chroma so it reads as a system marker, not a clinical
 * state. Carries an icon + text (never color alone) and an aria-label.
 */
export function SimBadge({ variant = "chip", generation = null, className }: SimBadgeProps) {
  const { t } = useTranslation();
  const label = generation
    ? `${t("ehr.sim.full")} ${t("live2.sourceLabel", { source: t(`live2.source.${generation.source}`) })}`
    : t("ehr.sim.full");

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
        {generation ? <ProvenanceTail generation={generation} /> : null}
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
      {generation ? <ProvenanceTail generation={generation} /> : null}
    </span>
  );
}

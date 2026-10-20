import { useTranslation } from "react-i18next";
import { ArrowClockwise, CircleNotch, Warning } from "@phosphor-icons/react";

import { getCaseLayers, retryCaseLayer, useEncounterSelector, type EncounterState } from "@/state/encounterStore";
import { cn } from "@/lib/cn";

/**
 * LayerStrip: the parts of THIS patient's case the server is still writing (same
 * thread, review 06a 4.6). Each pending layer reads "being written for this
 * patient"; a failed layer offers Retry for that layer only. Renders nothing once
 * every layer is in.
 */
export function LayerStrip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const layers = useEncounterSelector(getCaseLayers);
  const errors = useEncounterSelector((s: EncounterState) => s.layerErrors);
  const open = Object.entries(layers).filter(([, s]) => s !== "ready");
  if (open.length === 0) return null;
  const nameOf = (layer: string) => {
    const kind = layer.split(".")[0];
    const sub = layer.includes(".") ? layer.slice(kind.length + 1) : "";
    const base = t(`oncase.layers.name.${kind}`, { defaultValue: kind });
    return kind === "event" || !sub ? base : `${base} (${sub.replace(/_/g, " ")})`;
  };
  return (
    <section
      aria-label={t("oncase.layers.label")}
      role="status"
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-2 text-xs text-muted", className)}
    >
      {open.map(([layer, status]) =>
        status === "failed" ? (
          <span key={layer} className="inline-flex items-center gap-1.5 rounded-control border border-border px-2 py-1">
            <Warning weight="fill" className="h-3.5 w-3.5 text-[color:var(--state-caution)]" aria-hidden />
            {errors[layer]?.error === "safety_veto"
              ? t("oncase.layers.rejected", { layer: nameOf(layer) })
              : t("oncase.layers.failed", { layer: nameOf(layer) })}
            <button
              type="button"
              onClick={() => retryCaseLayer(layer)}
              className="ms-1 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 font-medium text-fg hover:bg-bg-subtle focus-visible:outline-none"
            >
              <ArrowClockwise weight="bold" className="h-3 w-3" aria-hidden />
              {t("oncase.layers.retry")}
            </button>
          </span>
        ) : (
          <span key={layer} className="inline-flex items-center gap-1.5 rounded-control border border-dashed border-border px-2 py-1">
            <CircleNotch weight="bold" className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
            {layer === "treatments" && errors[layer]
              ? t("oncase.treatments.regenerating")
              : t("oncase.layers.pending", { layer: nameOf(layer) })}
          </span>
        ),
      )}
    </section>
  );
}

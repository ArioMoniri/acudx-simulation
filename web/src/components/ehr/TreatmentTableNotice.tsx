import { useTranslation } from "react-i18next";
import { ArrowClockwise, CircleNotch, ShieldWarning } from "@phosphor-icons/react";

import { Button } from "@/components/ui";
import {
  getLayerFailure,
  getLayerRetrying,
  retryCaseLayer,
  treatmentsLocked,
  useEncounterState,
} from "@/state/encounterStore";

/**
 * TreatmentTableNotice: shown above the treatment options of an on-request case while its
 * treatment table is not in (06b F30). The table is written by the model and passes the
 * blocking safety review; when the review rejects it after the rewrite the layer fails
 * honestly, it is regenerated, and administration stays blocked until a safe table lands.
 * Nothing pre-made is shown in its place. Renders nothing once the table is in.
 */
export function TreatmentTableNotice() {
  const { t } = useTranslation();
  const s = useEncounterState();
  if (!treatmentsLocked(s)) return null;
  const failed = getLayerFailure(s, "treatments");
  const retrying = getLayerRetrying(s, "treatments");
  const safety = (failed ?? retrying)?.error === "safety_veto";

  const title = failed
    ? safety
      ? t("oncase.treatments.rejected")
      : t("oncase.treatments.failed")
    : retrying
      ? t("oncase.treatments.regenerating")
      : t("oncase.treatments.writing");

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="treatment-table-notice"
      className="flex flex-wrap items-start gap-3 rounded-card border border-[color:var(--state-caution)]/40 bg-[color-mix(in_srgb,var(--state-caution)_8%,transparent)] px-3 py-2.5"
    >
      {failed ? (
        <ShieldWarning weight="fill" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-caution)]" aria-hidden />
      ) : (
        <CircleNotch weight="bold" className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[0.8125rem] font-medium text-fg">{title}</p>
        {safety ? <p className="text-xs text-muted">{t("oncase.treatments.safetyReason")}</p> : null}
        <p className="text-xs text-muted">{t("oncase.treatments.blocked")}</p>
      </div>
      {failed ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => retryCaseLayer("treatments")}
          leadingIcon={<ArrowClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />}
        >
          {t("oncase.layers.retry")}
        </Button>
      ) : null}
    </div>
  );
}

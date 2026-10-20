import { useTranslation } from "react-i18next";
import { Sparkline } from "./Sparkline";
import { stateMap } from "./clinicalState";
import type { VitalReading } from "@/data/schema";

export interface VitalCardProps {
  vital: VitalReading;
  /** Override the display value (brief specifies exact bedside numbers). */
  displayValue?: string;
}

/**
 * VitalCard — one reading on the dark vitals monitor.
 * Status is shown by BOTH an icon AND a text label (never color alone), the
 * numeric readout is tabular mono, and an aria-live region announces changes.
 * The monitor stays dark in both themes via the --monitor-* tokens.
 */
export function VitalCard({ vital, displayValue }: VitalCardProps) {
  const { t } = useTranslation();
  const present = stateMap[vital.state];
  const StatusIcon = present.icon;
  const label = t(`vitals.${vital.labelKey}`);
  const shortLabel = t(`vitals.${vital.shortKey}`);
  const unit = vital.unitKey ? t(`vitals.units.${vital.unitKey}`) : "";
  const statusText = t(present.labelKey);
  const value = displayValue ?? vital.value;

  return (
    <div
      className="rounded-control border p-3"
      style={{
        borderColor: "var(--monitor-border)",
        backgroundColor: "color-mix(in srgb, var(--monitor-fg) 4%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: "var(--monitor-dim)" }}
          >
            <abbr title={label} className="no-underline">
              {shortLabel}
            </abbr>
          </p>
          <p
            className="mt-1 flex items-baseline gap-1 font-mono text-2xl font-semibold leading-none"
            style={{ color: "var(--monitor-fg)" }}
          >
            <span
              aria-live="polite"
              aria-label={`${label}: ${value} ${unit} - ${statusText}`}
            >
              {value}
            </span>
            {unit ? (
              <span
                className="text-xs font-medium"
                style={{ color: "var(--monitor-dim)" }}
              >
                {unit}
              </span>
            ) : null}
          </p>
        </div>

        {/* Status: icon + text label, never color alone */}
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            color: present.colorVar,
            backgroundColor: `color-mix(in srgb, ${present.colorVar} 16%, transparent)`,
          }}
        >
          <StatusIcon weight="fill" className="h-3 w-3" aria-hidden />
          {statusText}
        </span>
      </div>

      <div className="mt-2.5">
        <Sparkline
          data={vital.history}
          color={present.colorVar}
          width={140}
          height={26}
          className="h-6 w-full"
        />
      </div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import {
  MagnifyingGlass,
  Stethoscope,
  ClipboardText,
  ArrowsClockwise,
  FileText,
  CheckCircle,
  WarningCircle,
  Info,
  Lock,
} from "@phosphor-icons/react";
import { Card, Badge, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import { useProgressRecords } from "@/state/progressStore";
import {
  deriveRemediationSignals,
  REMEDIATION_STAGES,
  type RemediationSignal,
  type RemediationStage,
} from "@/data/institution";

const stageIcon: Record<RemediationStage, typeof MagnifyingGlass> = {
  detect: MagnifyingGlass,
  diagnose: Stethoscope,
  prescribe: ClipboardText,
  reassess: ArrowsClockwise,
  document: FileText,
};

/**
 * The closed remediation loop, shown honestly. Only "detect" is grounded in the
 * learner's own real encounters; the instructor-driven stages
 * (diagnose -> prescribe -> re-assess -> document) are labelled as needing a
 * connected institution data source rather than faked with invented state.
 */
function LoopStages() {
  const { t } = useTranslation();
  return (
    <ol
      className="flex flex-wrap items-stretch gap-1.5"
      aria-label={t("institution.remediation.loopAria")}
    >
      {REMEDIATION_STAGES.map((stage) => {
        const grounded = stage === "detect";
        const StageIcon = stageIcon[stage];
        return (
          <li key={stage} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-control border px-2 py-1",
                grounded
                  ? "border-brand bg-brand-tint text-brand"
                  : "border-dashed border-border bg-surface text-muted",
              )}
            >
              <StageIcon
                weight="bold"
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
              <span className="text-[11px] font-semibold">
                {t(`institution.remediation.stage.${stage}`)}
              </span>
              <span className="text-[10px] font-medium">
                {grounded
                  ? t("institution.remediation.stageGrounded", {
                      defaultValue: "your data",
                    })
                  : t("institution.remediation.stageNeedsSource", {
                      defaultValue: "needs source",
                    })}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SignalCard({ signal }: { signal: RemediationSignal }) {
  const { t } = useTranslation();
  const lang = useLang();
  const communication =
    signal.domain === "communication" || signal.domain === "professionalism";
  return (
    <li>
      <Card
        padding="md"
        className="flex flex-col gap-2.5 border-l-2 border-l-[color:var(--state-warning)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-control"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--state-warning) 16%, transparent)",
                color: "var(--state-warning)",
              }}
              aria-hidden
            >
              <WarningCircle weight="fill" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                {signal.detail[lang]}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0",
                    communication ? "rounded-full" : "rotate-45",
                  )}
                  style={{
                    backgroundColor: communication
                      ? "var(--axis-communication)"
                      : "var(--axis-clinical)",
                  }}
                  aria-hidden
                />
                {t(`feedback.domains.${signal.domain}`)}
              </p>
            </div>
          </div>
          <Badge tone="warning">
            {t("institution.remediation.recurrence", {
              count: signal.recurrence,
            })}
          </Badge>
        </div>
      </Card>
    </li>
  );
}

/** RemediationLoop — real detected gaps from the learner's own encounters; the closed loop needs a data source (IN-2). */
export function RemediationLoop() {
  const { t } = useTranslation();
  const records = useProgressRecords();
  const signals = deriveRemediationSignals(records);

  return (
    <div className="flex flex-col gap-4">
      {/* Honest loop legend */}
      <Card padding="md" className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <p className="text-xs text-muted">
            {t("institution.remediation.singleUserNote", {
              defaultValue:
                "Single-user view: AcuDx detects recurring gaps from your own encounters. The closed remediation loop (diagnose, prescribe, re-assess, document) is an instructor workflow that needs a connected institution data source.",
            })}
          </p>
        </div>
        <LoopStages />
      </Card>

      {/* Empty: a plain line with a rule, not a centred icon panel. */}
      {records.length === 0 ? (
        <div className="flex flex-col gap-1 border-s-2 border-border-strong py-1 ps-3">
          <p className="text-sm font-semibold text-fg">
            {t("institution.remediation.empty.title", {
              defaultValue: "No recorded encounters yet",
            })}
          </p>
          <p className="max-w-md text-xs text-muted">
            {t("institution.remediation.empty.body", {
              defaultValue:
                "Complete an encounter and any recurring safety-critical or diagnostic gaps are detected here from your own earned evidence.",
            })}
          </p>
        </div>
      ) : signals.length === 0 ? (
        <div className="flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-3 py-4">
          <CheckCircle
            weight="fill"
            className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[color:var(--state-normal)]"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-fg">
              {t("institution.remediation.clear.title", {
                defaultValue: "No recurring gaps detected",
              })}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {t("institution.remediation.clear.body", {
                count: records.length,
                defaultValue:
                  "Across your {{count}} recorded encounters there are no recurring safety-critical, diagnostic, timing, or low-value ordering gaps.",
              })}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <SectionLabel
            icon={<Lock weight="bold" className="h-3.5 w-3.5" />}
            trailing={
              <span className="text-xs font-medium normal-case tracking-normal text-muted">
                {t("institution.remediation.detectedCount", {
                  count: signals.length,
                  defaultValue: "{{count}} detected",
                })}
              </span>
            }
          >
            {t("institution.remediation.detectedCaption", {
              defaultValue: "Detected from your own encounters",
            })}
          </SectionLabel>
          <ul className="flex flex-col gap-2.5" aria-label="remediation">
            {signals.map((s) => (
              <SignalCard key={s.id} signal={s} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

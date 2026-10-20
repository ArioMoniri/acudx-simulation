import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  XCircle,
  ShieldWarning,
  ChatCircleDots,
  Heartbeat,
} from "@phosphor-icons/react";
import { CitationPill } from "@/components/CitationPill";
import type { Lang, TreatmentBehavior } from "@/data/schema";

export interface TreatmentChecklistProps {
  behaviors: TreatmentBehavior[];
  lang: Lang;
}

/**
 * TreatmentChecklist — "How the patient was treated" (docs/00-overview/04 §4.1):
 * communication/empathy + safety behaviors as met/unmet checklist items, each
 * icon+label (never color-only) and cited. Reads the patient's *treatment*; it
 * never infers the learner's emotion (§4.1 / arch/09).
 */
export function TreatmentChecklist({ behaviors, lang }: TreatmentChecklistProps) {
  const { t } = useTranslation();

  return (
    <ul className="flex flex-col gap-2" aria-label={t("feedback.process.treatment.heading")}>
      {behaviors.map((b) => {
        const met = b.met;
        const criticalUnmet = b.critical && !met;
        const KindIcon = b.kind === "safety" ? Heartbeat : ChatCircleDots;
        const StatusIcon = met ? CheckCircle : criticalUnmet ? ShieldWarning : XCircle;
        const token = met
          ? "--state-normal"
          : criticalUnmet
            ? "--state-critical"
            : "--state-caution";
        const statusText = met
          ? t("feedback.process.treatment.met")
          : t("feedback.process.treatment.notMet");

        return (
          <li
            key={b.id}
            className="flex items-start gap-2.5 rounded-control border border-border bg-surface p-3"
          >
            <StatusIcon
              weight="fill"
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: `var(${token})` }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-fg">
                  {b.label[lang]}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
                  <KindIcon weight="bold" className="h-3 w-3" aria-hidden />
                  {b.kind === "safety"
                    ? t("feedback.process.treatment.safety")
                    : t("feedback.process.treatment.communication")}
                </span>
                {/* Text-equivalent status so meaning never relies on color. */}
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: `var(${token})` }}
                >
                  {statusText}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{b.anchor[lang]}</p>
              <div className="mt-2">
                <CitationPill citationId={b.citationId} lang={lang} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

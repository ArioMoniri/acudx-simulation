import { useTranslation } from "react-i18next";
import { Ambulance, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";

import { Button, Badge } from "@/components/ui";
import type { CaseInstance } from "@/domain/case";
import type { Lang } from "@/data/schema";

export interface PrehospitalPanelProps {
  caseInstance: CaseInstance;
  lang: Lang;
  /** True once the ATMIST handover has been delivered this session. */
  given: boolean;
  /** Deliver the structured scene handover (posts to the floor + records it). */
  onGiveHandover: () => void;
}

/**
 * PrehospitalPanel — the paramedic's role-scoped view. It carries the scene
 * picture the paramedic owns (chief complaint, arrival vitals, acuity) and a
 * single structured-handover action that posts an ATMIST/SBAR handover to the
 * team floor and records the paramedic→doctor pass on the shared timeline.
 */
export function PrehospitalPanel({ caseInstance, lang, given, onGiveHandover }: PrehospitalPanelProps) {
  const { t } = useTranslation();
  const v = caseInstance.triageVitals;

  const facts = [
    { k: t("vitals.hrShort"), v: `${v.hr} ${t("vitals.units.bpm")}` },
    { k: t("vitals.bpShort"), v: `${v.systolic}/${v.diastolic}` },
    { k: t("vitals.spo2Short"), v: `${v.spo2} ${t("vitals.units.percent")}` },
    { k: t("vitals.rrShort"), v: `${v.rr} ${t("vitals.units.brpm")}` },
  ];

  return (
    <section
      aria-label={t("roomscollab.paramedic.title")}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
          <Ambulance weight="bold" className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{t("roomscollab.paramedic.title")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("roomscollab.paramedic.desc")}</p>
        </div>
      </div>

      {/* Scene picture */}
      <div className="rounded-control border border-border bg-bg-subtle p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-fg">{caseInstance.chiefComplaint[lang]}</p>
          <Badge tone="caution">{`ESI ${caseInstance.acuityESI}`}</Badge>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.k} className="rounded-control bg-surface px-2 py-1.5">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{f.k}</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">{f.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {given ? (
        <p className="inline-flex items-center gap-1.5 rounded-control border border-border bg-bg-subtle px-3 py-2 text-xs font-medium text-[color:var(--state-normal)]">
          <CheckCircle weight="fill" className="h-4 w-4" aria-hidden />
          {t("roomscollab.paramedic.given")}
        </p>
      ) : (
        <Button
          onClick={onGiveHandover}
          leadingIcon={<PaperPlaneTilt weight="bold" className="h-4 w-4" />}
        >
          {t("roomscollab.paramedic.give")}
        </Button>
      )}
    </section>
  );
}

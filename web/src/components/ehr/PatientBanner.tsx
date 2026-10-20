import { useTranslation } from "react-i18next";
import { type ReactNode } from "react";
import { Warning } from "@phosphor-icons/react";

import { Badge, StatusDot, type StatusTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { stateMap } from "@/components/clinicalState";
import { PatientPhoto } from "@/components/PatientPhoto";
import { resolvePatientVisual } from "@/domain/patientIdentity";
import { SimBadge } from "./SimBadge";
import { conceptText, esiToState, pick } from "./labels";
import { getGeneration, useEncounterSelector } from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface PatientBannerProps {
  caseInstance: CaseInstance;
  lang: Lang;
  /** Toolbar slot (New case menu, clock) rendered on the trailing side. */
  toolbar?: ReactNode;
}

/**
 * BannerFact: one cell of the always-visible fact band. An eyebrow field name
 * over its value, the Epic storyboard record treatment. Cells are divided by
 * hairlines and wrap cleanly on narrow screens.
 */
function BannerFact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 px-3 py-1.5 first:ps-0", className)}>
      <span className="eyebrow text-[0.625rem]">{label}</span>
      <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-[0.8125rem] text-fg">
        {children}
      </div>
    </div>
  );
}

/**
 * PatientBanner: the persistent chart header (Epic storyboard condensed).
 *
 * A full-width record strip with square corners and no blur: an identity row
 * (portrait, name, age and sex, MRN in mono, SIM provenance, toolbar) over a
 * hairline-divided fact band (chief complaint, allergies, code status, ESI,
 * weight, encounter class). Allergies, acuity and code pair an icon or dot with
 * their label so meaning is never carried by colour alone (WCAG 1.4.1).
 * Sticky under the 48 px top bar so it never scrolls away.
 */
export function PatientBanner({ caseInstance, lang, toolbar }: PatientBannerProps) {
  const { t } = useTranslation();
  const { patient, encounter, allergies, triageVitals } = caseInstance;
  const generation = useEncounterSelector(getGeneration);

  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityPresent = stateMap[esiToState(caseInstance.acuityESI)];
  const acuityWord = t(acuityPresent.labelKey);
  const acuityTone = `esi-${caseInstance.acuityESI}` as StatusTone;

  const visual = resolvePatientVisual(caseInstance);

  const allergyTexts = allergies.map((a) => conceptText(a.code, lang));
  const isNkda =
    allergies.length === 1 &&
    allergies[0].code.coding[0]?.code === "409137002";

  return (
    <header
      aria-label={t("ehr.banner.label")}
      className="sticky top-12 z-30 -mx-4 border-b border-border bg-surface md:-mx-6"
    >
      {/* Identity row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:px-6">
        <PatientPhoto
          sex={visual.sexAtBirth}
          age={visual.age}
          photoId={visual.photoId}
          rr={triageVitals.rr}
          alt={t("ehr.storyboard.avatarAlt", {
            defaultValue: "Synthetic patient portrait, not a real individual",
          })}
          className="h-9 w-9 shrink-0 rounded-control ring-1 ring-border"
        />

        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-base font-semibold leading-tight tracking-tight text-fg">
            {patient.name}
          </h2>
          <span className="tnum text-[0.8125rem] text-muted">
            {t("ehr.banner.ageSex", { age: patient.ageYears, sex: sexLabel })}
          </span>
          <span className="whitespace-nowrap text-[0.8125rem]">
            <span className="eyebrow me-1 align-baseline text-[0.625rem]">{t("ehr.banner.mrn")}</span>
            <span className="font-mono text-fg">{patient.mrn}</span>
          </span>
          <SimBadge generation={generation} />
        </div>

        {toolbar ? (
          <div className="flex basis-full flex-wrap items-center gap-1.5 sm:basis-auto sm:shrink-0 sm:justify-end">
            {toolbar}
          </div>
        ) : null}
      </div>

      {/* Fact band */}
      <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-surface-2 px-4 md:px-6">
        <BannerFact
          label={t("ehr.banner.chiefComplaint")}
          className="basis-full sm:basis-auto sm:max-w-sm"
        >
          <span className="line-clamp-2 font-medium">{pick(caseInstance.chiefComplaint, lang)}</span>
        </BannerFact>

        <BannerFact label={t("ehr.banner.allergies")}>
          {isNkda ? (
            <span className="text-muted">{t("ehr.banner.nkda")}</span>
          ) : (
            <span
              className="inline-flex flex-wrap items-center gap-1 font-semibold text-[color:var(--state-critical)]"
              role="group"
              aria-label={t("ehr.banner.allergiesLabel")}
            >
              <Warning weight="fill" className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {allergyTexts.join(", ")}
            </span>
          )}
        </BannerFact>

        <BannerFact label={t("ehr.banner.codeStatus")}>
          <StatusDot tone="normal" size="sm" label={t("ehr.codeStatus.full")} />
        </BannerFact>

        <BannerFact label={t("ehrPolish.acuity")}>
          <StatusDot
            tone={acuityTone}
            size="sm"
            pulse={caseInstance.acuityESI === 1}
            label={`${t("ehr.banner.esi", { level: caseInstance.acuityESI })} ${acuityWord}`}
            aria-label={t("ehr.banner.acuityLabel", {
              level: caseInstance.acuityESI,
              state: acuityWord,
            })}
          />
        </BannerFact>

        {patient.weightKg != null ? (
          <BannerFact label={t("ehr.storyboard.weight", { defaultValue: "Weight" })} className="hidden sm:flex">
            <span className="font-mono">
              {patient.weightKg}
              <span className="ms-0.5 text-xs text-muted">kg</span>
            </span>
          </BannerFact>
        ) : null}

        <BannerFact label={t("encounter.title")} className="hidden md:flex">
          <Badge tone="neutral" variant="outline">
            {t(`ehr.encounterClass.${encounter.class}`)}
          </Badge>
        </BannerFact>
      </div>
    </header>
  );
}

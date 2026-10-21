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
import type { Lang } from "@/data/schema";
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
    <div className={cn("flex min-w-0 shrink-0 flex-col gap-0.5 py-2 sm:px-4 sm:first:ps-0", className)}>
      <span className="eyebrow text-[0.625rem]">{label}</span>
      <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-[0.8125rem] text-fg">
        {children}
      </div>
    </div>
  );
}

/**
 * PatientBanner: the persistent chart header (Epic storyboard condensed), the
 * most recognisable surface of the v4 "Ward ink" language.
 *
 * An ink identity band (always dark, both themes) with a cobalt leading edge:
 * portrait, the patient's name in the Fraunces serif, age and sex, MRN in
 * mono, SIM provenance and the toolbar. Under it a paper fact band divided by
 * 1 px rules (chief complaint, allergies, code status, ESI, weight, encounter
 * class). Allergies, acuity and code pair an icon or dot with
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
      className="relative z-30 -mx-4 border-b border-border bg-surface md:sticky md:top-12 md:-mx-6"
    >
      {/* Identity row: the ink band */}
      <div className="ink-scope relative flex flex-wrap items-center gap-x-3.5 gap-y-2 bg-ink px-4 py-2.5 before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-ink-accent md:px-6">
        <PatientPhoto
          sex={visual.sexAtBirth}
          age={visual.age}
          photoId={visual.photoId}
          lookThreadId={generation?.threadId ?? null}
          rr={triageVitals.rr}
          alt={t("ehr.storyboard.avatarAlt", {
            defaultValue: "Synthetic patient portrait, not a real individual",
          })}
          className="h-10 w-10 shrink-0 rounded-control ring-1 ring-ink-border"
        />

        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-[1.375rem] leading-tight text-ink-fg">
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
      <div className="grid grid-cols-2 gap-x-4 bg-surface px-4 sm:flex sm:flex-wrap sm:items-stretch sm:gap-x-0 sm:divide-x sm:divide-border md:flex-nowrap md:px-6">
        <BannerFact
          label={t("ehr.banner.chiefComplaint")}
          className="col-span-2 border-b border-border sm:max-w-md sm:border-b-0 md:shrink"
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

        {/* Review 2026-10-21: the banner read "Code: Full code", which a learner
            could not decode. It is the resuscitation status, written out, with
            the meaning of "full code" in the hint. */}
        <BannerFact label={t("ehrTerms.codeStatus.label")}>
          <span title={t("ehrTerms.codeStatus.hint")} className="inline-flex">
            <StatusDot
              tone="normal"
              size="sm"
              label={t("ehrTerms.codeStatus.full")}
              aria-label={`${t("ehrTerms.codeStatus.full")}. ${t("ehrTerms.codeStatus.hint")}`}
            />
          </span>
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
          <BannerFact label={t("ehr.storyboard.weight", { defaultValue: "Weight" })} className="hidden lg:flex">
            <span className="font-mono">
              {patient.weightKg}
              <span className="ms-0.5 text-xs text-muted">kg</span>
            </span>
          </BannerFact>
        ) : null}

        <BannerFact label={t("encounter.title")} className="hidden xl:flex">
          <Badge tone="neutral" variant="outline">
            {t(`ehr.encounterClass.${encounter.class}`)}
          </Badge>
        </BannerFact>
      </div>
    </header>
  );
}

import { useTranslation } from "react-i18next";
import { type ReactNode } from "react";
import {
  Warning,
  IdentificationCard,
  FirstAid,
  Heartbeat,
} from "@phosphor-icons/react";

import { Badge } from "@/components/ui";
import { stateMap } from "@/components/clinicalState";
import { SimBadge } from "./SimBadge";
import { conceptText, esiToState, pick } from "./labels";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface PatientBannerProps {
  caseInstance: CaseInstance;
  lang: Lang;
  /** Toolbar slot (New case menu, clock) rendered on the trailing side. */
  toolbar?: ReactNode;
}

/**
 * PatientBanner — the persistent Epic-Storyboard-condensed header (docs §2.1).
 *
 * Given-at-start context only: synthetic identity, chief complaint, ALLERGIES
 * (always visible, with a warning icon + list), code status, encounter type,
 * and ESI acuity. Allergies + acuity carry an icon + text label so meaning is
 * never color-only (WCAG 1.4.1). Sticky so it never scrolls away.
 */
export function PatientBanner({ caseInstance, lang, toolbar }: PatientBannerProps) {
  const { t } = useTranslation();
  const { patient, encounter, allergies } = caseInstance;

  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityState = esiToState(caseInstance.acuityESI);
  const acuityPresent = stateMap[acuityState];
  const AcuityIcon = acuityPresent.icon;

  // Allergy display: NKDA collapses to one calm chip; real allergies are a
  // high-visibility warning list.
  const allergyTexts = allergies.map((a) => conceptText(a.code, lang));
  const isNkda =
    allergies.length === 1 &&
    allergies[0].code.coding[0]?.code === "409137002";

  return (
    <header
      aria-label={t("ehr.banner.label")}
      className="sticky top-0 z-30 rounded-card border border-border bg-surface/95 px-4 py-3 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-surface/80"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* Identity + chief complaint */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {patient.name}
            </h2>
            <span className="text-sm text-muted">
              {t("ehr.banner.ageSex", {
                age: patient.ageYears,
                sex: sexLabel,
              })}
            </span>
            <span
              className="inline-flex items-center gap-1 font-mono text-xs text-muted"
              title={t("ehr.banner.mrn")}
            >
              <IdentificationCard weight="bold" className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{t("ehr.banner.mrn")}: </span>
              {patient.mrn}
            </span>
            <SimBadge />
          </div>

          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-fg">
            <span className="font-medium text-muted">{t("ehr.banner.chiefComplaint")}:</span>
            <span>{pick(caseInstance.chiefComplaint, lang)}</span>
          </p>

          {/* ALLERGIES — always visible */}
          <div className="mt-2">
            {isNkda ? (
              <Badge tone="neutral" className="gap-1.5">
                <FirstAid weight="bold" className="h-3.5 w-3.5" aria-hidden />
                {t("ehr.banner.nkda")}
              </Badge>
            ) : (
              <div
                className="inline-flex flex-wrap items-center gap-1.5 rounded-control border border-[color:color-mix(in_srgb,var(--state-critical)_45%,var(--border))] bg-[color-mix(in_srgb,var(--state-critical)_10%,transparent)] px-2.5 py-1"
                role="group"
                aria-label={t("ehr.banner.allergiesLabel")}
              >
                <Warning
                  weight="fill"
                  className="h-4 w-4 shrink-0 text-[color:var(--state-critical)]"
                  aria-hidden
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--state-critical)]">
                  {t("ehr.banner.allergies")}
                </span>
                <span className="text-sm text-fg">{allergyTexts.join(", ")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status column: encounter type, acuity, code status + toolbar */}
        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand" className="gap-1.5">
              <Heartbeat weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t(`ehr.encounterClass.${encounter.class}`)}
            </Badge>

            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                color: acuityPresent.colorVar,
                backgroundColor: `color-mix(in srgb, ${acuityPresent.colorVar} 15%, transparent)`,
              }}
              aria-label={t("ehr.banner.acuityLabel", {
                level: caseInstance.acuityESI,
                state: t(acuityPresent.labelKey),
              })}
            >
              <AcuityIcon weight="fill" className="h-3.5 w-3.5" aria-hidden />
              {t("ehr.banner.esi", { level: caseInstance.acuityESI })}
            </span>

            <Badge tone="neutral">
              {t("ehr.banner.codeStatus")}: {t("ehr.codeStatus.full")}
            </Badge>
          </div>

          {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
        </div>
      </div>
    </header>
  );
}

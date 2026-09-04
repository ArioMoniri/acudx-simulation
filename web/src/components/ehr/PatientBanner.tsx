import { useTranslation } from "react-i18next";
import { type ReactNode } from "react";
import { Warning, FirstAid, Heartbeat } from "@phosphor-icons/react";

import {
  Badge,
  DescriptionList,
  KeyValue,
  StatusDot,
  type StatusTone,
} from "@/components/ui";
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
 * Given-at-start context only: synthetic identity, the identifier strip (MRN /
 * age / sex / code status as tabular key-values), chief complaint, ALLERGIES
 * (always visible, with a warning icon + list), encounter type, and ESI acuity.
 * Allergies + acuity carry an icon/dot + text label so meaning is never
 * color-only (WCAG 1.4.1). Sticky so it never scrolls away.
 */
export function PatientBanner({ caseInstance, lang, toolbar }: PatientBannerProps) {
  const { t } = useTranslation();
  const { patient, encounter, allergies } = caseInstance;

  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityPresent = stateMap[esiToState(caseInstance.acuityESI)];
  const acuityWord = t(acuityPresent.labelKey);
  const acuityTone = `esi-${caseInstance.acuityESI}` as StatusTone;

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
        {/* Identity + identifiers + chief complaint */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-fg">
              {patient.name}
            </h2>
            <SimBadge />
          </div>

          {/* Identifier strip — dense Epic-storyboard key/values, tabular
              figures, hairline dividers between fields. */}
          <DescriptionList
            layout="stacked"
            aria-label={t("ehr.storyboard.demographics")}
            className="mt-2 flex flex-wrap items-center gap-y-1 [&>div]:px-3 [&>div:first-child]:pl-0 [&>div:not(:first-child)]:border-l [&>div:not(:first-child)]:border-border"
          >
            <KeyValue label={t("ehr.banner.mrn")} value={patient.mrn} mono />
            <KeyValue
              label={t("ehrPolish.age")}
              value={<span className="tnum">{patient.ageYears}</span>}
            />
            <KeyValue label={t("ehrPolish.sex")} value={sexLabel} />
            <KeyValue
              label={t("ehr.banner.codeStatus")}
              value={t("ehr.codeStatus.full")}
            />
          </DescriptionList>

          <p className="mt-2 flex items-start gap-1.5 text-sm text-fg">
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

        {/* Status column: encounter type, ESI acuity + toolbar */}
        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Badge tone="brand" className="gap-1.5">
              <Heartbeat weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t(`ehr.encounterClass.${encounter.class}`)}
            </Badge>

            <StatusDot
              tone={acuityTone}
              pulse={caseInstance.acuityESI === 1}
              label={`${t("ehr.banner.esi", { level: caseInstance.acuityESI })} · ${acuityWord}`}
              aria-label={t("ehr.banner.acuityLabel", {
                level: caseInstance.acuityESI,
                state: acuityWord,
              })}
              className="rounded-pill border border-border bg-surface px-2.5 py-0.5"
            />
          </div>

          {toolbar ? (
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {toolbar}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

import { useTranslation } from "react-i18next";
import { type ReactNode } from "react";
import { Warning, FirstAid, Heartbeat } from "@phosphor-icons/react";

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
 * BannerFact — one cell of the always-visible clinical fact band: an eyebrow
 * field name over its value, the dense Epic-storyboard record treatment. Cells
 * are hairline-divided by the parent strip and wrap cleanly on narrow screens.
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
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="eyebrow">{label}</span>
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-sm text-fg">
        {children}
      </div>
    </div>
  );
}

/**
 * PatientBanner — the persistent Epic-Storyboard-condensed header (docs §2.1).
 *
 * A dense, always-visible clinical header: an identity row (synthetic portrait +
 * name + age · sex · MRN, tabular figures) over a hairline-divided fact band that
 * keeps the given-at-start clinical picture single-glance — chief complaint,
 * ALLERGIES (never hidden), code status, ESI acuity and encounter type. Allergies
 * + acuity + code pair an icon/dot with their label so meaning is never carried by
 * color alone (WCAG 1.4.1). Sticky so it never scrolls away.
 */
export function PatientBanner({ caseInstance, lang, toolbar }: PatientBannerProps) {
  const { t } = useTranslation();
  const { patient, encounter, allergies, triageVitals } = caseInstance;
  // Provenance of the running case (model, template, offline, curated); the
  // badge names it so a learner never mistakes a template for a model case.
  const generation = useEncounterSelector(getGeneration);

  const sexLabel = t(`common.${patient.gender === "female" ? "female" : "male"}`);
  const acuityPresent = stateMap[esiToState(caseInstance.acuityESI)];
  const acuityWord = t(acuityPresent.labelKey);
  const acuityTone = `esi-${caseInstance.acuityESI}` as StatusTone;

  // The ONE unified visual identity — same distinct face everywhere.
  const visual = resolvePatientVisual(caseInstance);

  // Allergy display: NKDA collapses to one calm chip; real allergies are a
  // high-visibility warning list.
  const allergyTexts = allergies.map((a) => conceptText(a.code, lang));
  const isNkda =
    allergies.length === 1 &&
    allergies[0].code.coding[0]?.code === "409137002";

  return (
    <header
      aria-label={t("ehr.banner.label")}
      className="sticky top-0 z-30 overflow-hidden rounded-card border border-border bg-surface/95 shadow-soft backdrop-blur supports-[backdrop-filter]:bg-surface/80"
    >
      {/* Identity row — portrait, name, dense identifier line, toolbar. */}
      <div className="flex items-start gap-3 px-4 py-3">
        <PatientPhoto
          sex={visual.sexAtBirth}
          age={visual.age}
          photoId={visual.photoId}
          rr={triageVitals.rr}
          alt={t("ehr.storyboard.avatarAlt", {
            defaultValue: "Synthetic patient portrait — not a real individual",
          })}
          className="h-12 w-12 shrink-0 rounded-control ring-1 ring-border"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="truncate text-lg font-semibold leading-tight tracking-tight text-fg">
              {patient.name}
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className="tnum">
                {t("ehr.banner.ageSex", {
                  age: patient.ageYears,
                  sex: sexLabel,
                })}
              </span>
              <span aria-hidden className="text-border-strong">
                ·
              </span>
              <span className="whitespace-nowrap">
                <span className="eyebrow me-1 align-baseline">
                  {t("ehr.banner.mrn")}
                </span>
                <span className="font-mono tabular-nums text-fg">
                  {patient.mrn}
                </span>
              </span>
            </p>
            <SimBadge generation={generation} />
          </div>
        </div>

        {toolbar ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {toolbar}
          </div>
        ) : null}
      </div>

      {/* Clinical fact band — always-visible, hairline-divided, eyebrow-labelled.
          Chief complaint · allergies · code · acuity · encounter, each a
          single-glance cell. */}
      <div className="flex flex-wrap items-stretch gap-x-4 gap-y-3 border-t border-border bg-bg-subtle px-4 py-2.5 [&>div:not(:first-child)]:border-l [&>div:not(:first-child)]:border-border [&>div:not(:first-child)]:ps-4">
        <BannerFact
          label={t("ehr.banner.chiefComplaint")}
          className="basis-full sm:basis-auto sm:max-w-xs"
        >
          <span className="line-clamp-2 font-medium">
            {pick(caseInstance.chiefComplaint, lang)}
          </span>
        </BannerFact>

        <BannerFact label={t("ehr.banner.allergies")}>
          {isNkda ? (
            <Badge tone="neutral" className="gap-1.5">
              <FirstAid weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("ehr.banner.nkda")}
            </Badge>
          ) : (
            <span
              className="inline-flex flex-wrap items-center gap-1.5 rounded-control border border-[color:color-mix(in_srgb,var(--state-critical)_45%,var(--border))] bg-[color-mix(in_srgb,var(--state-critical)_10%,transparent)] px-2 py-0.5"
              role="group"
              aria-label={t("ehr.banner.allergiesLabel")}
            >
              <Warning
                weight="fill"
                className="h-4 w-4 shrink-0 text-[color:var(--state-critical)]"
                aria-hidden
              />
              <span className="text-sm font-semibold text-[color:var(--state-critical)]">
                {allergyTexts.join(", ")}
              </span>
            </span>
          )}
        </BannerFact>

        <BannerFact label={t("ehr.banner.codeStatus")}>
          <Badge tone="normal" variant="outline" dot>
            {t("ehr.codeStatus.full")}
          </Badge>
        </BannerFact>

        <BannerFact label={t("ehrPolish.acuity")}>
          <StatusDot
            tone={acuityTone}
            pulse={caseInstance.acuityESI === 1}
            label={`${t("ehr.banner.esi", { level: caseInstance.acuityESI })} · ${acuityWord}`}
            aria-label={t("ehr.banner.acuityLabel", {
              level: caseInstance.acuityESI,
              state: acuityWord,
            })}
            className="rounded-pill border border-border bg-surface px-2 py-0.5"
          />
        </BannerFact>

        <BannerFact label={t("encounter.title")} className="hidden md:flex">
          <Badge tone="brand" className="gap-1.5">
            <Heartbeat weight="bold" className="h-3.5 w-3.5" aria-hidden />
            {t(`ehr.encounterClass.${encounter.class}`)}
          </Badge>
        </BannerFact>
      </div>
    </header>
  );
}

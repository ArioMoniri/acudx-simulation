import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Clock,
  BookOpen,
  Gauge,
  Stethoscope,
  Sparkle,
} from "@phosphor-icons/react";

import { Card, Badge } from "@/components/ui";
import { Button } from "@/components/ui";
import { stateMap } from "@/components/clinicalState";
import { cn } from "@/lib/cn";
import { pick, esiToState } from "@/components/ehr/labels";
import {
  specialtyOf,
  codeChipOf,
  guidelineTagOf,
  languagesOf,
  estMinutesOf,
  SPECIALTY_LABELS,
  DIFFICULTY_BAND,
} from "@/data/caseLibrary";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface CaseInstanceCardProps {
  data: CaseInstance;
  lang: Lang;
  /** Fired when the learner starts this exact case; the page owns navigation. */
  onStart: (c: CaseInstance) => void;
}

/**
 * CaseInstanceCard — one library case rendered from the full CaseInstance ground
 * truth. Mirrors the medkit CaseCard language: difficulty dots (1-5), specialty,
 * guideline tag, an ICD/DSM code chip, EN/TR availability, and an acuity chip
 * that pairs an icon with a text label (never color-only). A "Start this case"
 * action hands the exact instance up to the page for navigation to /encounter.
 * A subtle provenance marker distinguishes curated seed cases from generated ones.
 */
export function CaseInstanceCard({ data, lang, onStart }: CaseInstanceCardProps) {
  const { t } = useTranslation();

  const specialty = SPECIALTY_LABELS[specialtyOf(data)][lang];
  const chip = codeChipOf(data);
  const guideline = guidelineTagOf(data);
  const languages = languagesOf(data);
  const estMinutes = estMinutesOf(data);
  const band = DIFFICULTY_BAND[data.difficulty][lang];
  const dots = data.difficulty;

  const acuityState = esiToState(data.acuityESI);
  const acuityPresent = stateMap[acuityState];
  const AcuityIcon = acuityPresent.icon;

  const isGenerated = data.provenance === "generated";

  const sexLabel = t(
    `common.${data.patient.gender === "female" ? "female" : "male"}`,
  );
  const ageSex = t("cases.card.ageSex", {
    age: data.patient.ageYears,
    sex: sexLabel,
  });

  return (
    <Card
      padding="lg"
      className="group flex h-full flex-col gap-4 transition-shadow duration-300 ease-out hover:shadow-soft-md"
    >
      {/* Row 1: demographics + provenance + difficulty */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{ageSex}</Badge>
          {isGenerated ? (
            <Badge
              tone="brand"
              icon={<Sparkle weight="fill" className="h-3 w-3" />}
            >
              {t("cases.card.generated")}
            </Badge>
          ) : null}
        </div>
        <span
          className="inline-flex items-center gap-1"
          aria-label={`${t("caseCard.difficulty")}: ${band}`}
        >
          <Gauge weight="bold" className="h-3.5 w-3.5 text-muted" aria-hidden />
          <span className="flex items-center gap-0.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i < dots ? "bg-brand" : "bg-border",
                )}
              />
            ))}
          </span>
          <span className="text-xs font-medium text-muted">{band}</span>
        </span>
      </div>

      {/* Row 2: chief complaint + specialty */}
      <div className="flex-1">
        <h3 className="text-base font-semibold tracking-tight text-fg">
          {pick(data.chiefComplaint, lang)}
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <Stethoscope weight="bold" className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {specialty}
        </p>
      </div>

      {/* Row 3: facet chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
          {guideline}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 font-mono text-xs font-medium text-muted"
          aria-label={t("cases.card.codeLabel", {
            system: chip.system,
            code: chip.code,
          })}
        >
          <span className="font-semibold uppercase tracking-wide">
            {chip.system}
          </span>
          <span aria-hidden className="text-muted/60">
            ·
          </span>
          {chip.code}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-0.5 text-xs font-medium text-muted">
          <Clock weight="bold" className="h-3 w-3" aria-hidden />
          {t("caseCard.estimate", { minutes: estMinutes })}
        </span>
      </div>

      {/* Row 4: acuity + languages */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          tone={acuityPresent.tone}
          icon={<AcuityIcon weight="bold" className="h-3.5 w-3.5" />}
        >
          {t("ehr.banner.esi", { level: data.acuityESI })}
          <span aria-hidden className="mx-1 text-current opacity-50">
            ·
          </span>
          {t(acuityPresent.labelKey)}
        </Badge>
        <span
          className="inline-flex items-center gap-1"
          aria-label={`${t("caseCard.languages")}: ${languages
            .map((l) => l.toUpperCase())
            .join(", ")}`}
        >
          {languages.map((l) => (
            <span
              key={l}
              aria-hidden
              className="rounded border border-border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
            >
              {l}
            </span>
          ))}
        </span>
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="w-full justify-between"
        trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
        onClick={() => onStart(data)}
      >
        {t("cases.card.start")}
      </Button>
    </Card>
  );
}

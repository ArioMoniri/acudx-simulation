import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Clock,
  Stethoscope,
  Sparkle,
  Gauge,
} from "@phosphor-icons/react";

import { Card, Badge, Button, SectionLabel, StatusDot } from "@/components/ui";
import type { StatusTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { pick, esiToState } from "@/components/ehr/labels";
import { stateMap } from "@/components/clinicalState";
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
 * CaseInstanceCard — one library case as a full-width catalogue row (the
 * compact / mobile representation of the case library; the desktop catalogue
 * uses the dense table). Re-crafted to the "clinical instrument" language:
 * a specialty eyebrow leads into the presentation title, the ICD/DSM code sits
 * in a mono chip, and a hairline footer pairs the acuity + difficulty read-outs
 * with the start action. Hierarchy carries the scan — no icon-chip square, no
 * resting shadow. A provenance badge distinguishes generated cases from curated.
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

  const acuityState = stateMap[esiToState(data.acuityESI)];
  const acuityTone = `esi-${data.acuityESI}` as StatusTone;
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
      variant="interactive"
      padding="md"
      className="group flex flex-col gap-3.5"
      onClick={() => onStart(data)}
    >
      {/* Specialty eyebrow → presentation title → demographic + guideline line */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel
            icon={<Stethoscope weight="bold" className="h-3.5 w-3.5" />}
          >
            {specialty}
          </SectionLabel>
          <h3 className="mt-1.5 text-[0.9375rem] font-semibold leading-snug tracking-tight text-fg">
            {pick(data.chiefComplaint, lang)}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {ageSex}
            <span aria-hidden className="mx-1.5 text-border-strong">
              ·
            </span>
            {guideline}
          </p>
        </div>
        {isGenerated ? (
          <Badge
            tone="brand"
            variant="outline"
            className="shrink-0"
            icon={<Sparkle weight="fill" className="h-3 w-3" />}
          >
            {t("cases.card.generated")}
          </Badge>
        ) : null}
      </div>

      {/* Code chip + est time + languages */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span
          className="inline-flex items-baseline gap-1.5 rounded-chip border border-border bg-bg-subtle px-2 py-0.5 font-mono"
          aria-label={t("cases.card.codeLabel", {
            system: chip.system,
            code: chip.code,
          })}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-subtle">
            {chip.system}
          </span>
          <span className="font-medium text-fg">{chip.code}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Clock weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
          {t("caseCard.estimate", { minutes: estMinutes })}
        </span>
        <span
          className="inline-flex items-center gap-1"
          role="group"
            aria-label={`${t("caseCard.languages")}: ${languages
            .map((l) => l.toUpperCase())
            .join(", ")}`}
        >
          {languages.map((l) => (
            <span
              key={l}
              aria-hidden
              className="rounded border border-border px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-subtle"
            >
              {l}
            </span>
          ))}
        </span>
      </div>

      {/* Acuity + difficulty read-outs, and the start action */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusDot
            tone={acuityTone}
            label={`${t("ehr.banner.esi", { level: data.acuityESI })} · ${t(
              acuityState.labelKey,
            )}`}
          />
          <span className="inline-flex items-center gap-1.5" aria-label={band}>
            <Gauge weight="bold" className="h-3.5 w-3.5 text-subtle" aria-hidden />
            <span className="flex items-center gap-0.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    i < dots ? "bg-brand" : "bg-border-strong",
                  )}
                />
              ))}
            </span>
            <span className="text-xs font-medium text-muted">{band}</span>
          </span>
        </div>

        <Button
          size="sm"
          variant="secondary"
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
          onClick={(e) => {
            e.stopPropagation();
            onStart(data);
          }}
        >
          {t("cases.card.start")}
        </Button>
      </div>
    </Card>
  );
}

import { useTranslation } from "react-i18next";
import {
  Target,
  GlobeHemisphereWest,
  Gauge,
  GraduationCap,
  Code,
} from "@phosphor-icons/react";
import { Card, Badge } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import { sampleBlueprint } from "@/data/authoring";

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-bg-subtle text-muted"
        aria-hidden
      >
        <Icon weight="bold" className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="text-sm font-medium text-fg">{value}</p>
      </div>
    </div>
  );
}

/**
 * BlueprintCard — the case brief the AI drafted from (Screen 7.1). Country /
 * council and locale are independent required fields (INV-10); the objectives
 * are what the rubric must cover. Read-only summary in the review view.
 */
export function BlueprintCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const bp = sampleBlueprint;

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs font-semibold text-brand">
            {bp.caseId}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-fg">
            {bp.title[lang]}
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            {bp.chiefComplaint[lang]}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="brand">
            {bp.icd11.code} · {bp.icd11.label[lang]}
          </Badge>
          <Badge tone="neutral">ICD-10 {bp.icd10}</Badge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetaItem
          icon={Gauge}
          label={t("authoring.blueprint.difficulty")}
          value={`${bp.difficulty} · ${bp.difficultyBand[lang]}`}
        />
        <MetaItem
          icon={GraduationCap}
          label={t("authoring.blueprint.level")}
          value={bp.learnerLevel[lang]}
        />
        <MetaItem
          icon={GlobeHemisphereWest}
          label={t("authoring.blueprint.council")}
          value={`${bp.country} · ${bp.council}`}
        />
        <MetaItem
          icon={Code}
          label={t("authoring.blueprint.locales")}
          value={bp.contentLocales.map((l) => l.locale.toUpperCase()).join(" · ")}
        />
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <Target weight="bold" className="h-4 w-4 text-brand" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("authoring.blueprint.objectives")}
          </p>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {bp.objectives.map((o, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm text-fg"
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                aria-hidden
              />
              {o[lang]}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

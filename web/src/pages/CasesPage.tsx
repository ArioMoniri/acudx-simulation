import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Sparkle,
  FunnelSimple,
  Shuffle,
  Heartbeat,
  Brain,
  Flask,
  Wind,
  Stethoscope,
  X,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer } from "@/components/shell";
import { Button, Card, Badge } from "@/components/ui";
import { CaseInstanceCard } from "@/components";
import { SimBadge } from "@/components/ehr";
import { useLang } from "@/lib/useLang";
import { useReveal, useHoverLift } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { seedCases } from "@/data/seedCases";
import { generateCase, type ChiefComplaintFamily } from "@/domain/caseGen";
import type { CaseInstance } from "@/domain/case";
import {
  specialtyOf,
  complaintFamilyOf,
  COMPLAINT_LABELS,
  SPECIALTY_LABELS,
  DIFFICULTY_BAND,
  type Specialty,
} from "@/data/caseLibrary";

/* -------------------------------------------------------------------------- */
/* Filter vocabularies                                                         */
/* -------------------------------------------------------------------------- */

const SPECIALTY_ORDER: Specialty[] = [
  "emergency",
  "cardiology",
  "respiratory",
  "neurology",
  "surgery",
  "psychiatry",
];

const COMPLAINT_ORDER: ChiefComplaintFamily[] = [
  "chest-pain",
  "headache",
  "abdominal-pain",
  "dyspnea",
];

const COMPLAINT_ICON: Record<ChiefComplaintFamily, Icon> = {
  "chest-pain": Heartbeat,
  headache: Brain,
  "abdominal-pain": Flask,
  dyspnea: Wind,
};

const DIFFICULTIES: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

/* -------------------------------------------------------------------------- */
/* Filter chip                                                                 */
/* -------------------------------------------------------------------------- */

function FilterChip({
  label,
  selected,
  onSelect,
  icon: IconCmp,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  icon?: Icon;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
        "transition-colors duration-200 ease-out focus-visible:outline-none",
        selected
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-surface text-muted hover:bg-bg-subtle hover:text-fg",
      )}
    >
      {IconCmp ? (
        <IconCmp weight="bold" className="h-3.5 w-3.5" aria-hidden />
      ) : null}
      {label}
    </button>
  );
}

function FilterRow({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium uppercase tracking-wide text-muted">
        {legend}
      </legend>
      <div role="radiogroup" aria-label={legend} className="flex flex-wrap gap-2">
        {children}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Generate panel                                                              */
/* -------------------------------------------------------------------------- */

function GeneratePanel({
  onGenerate,
  lang,
}: {
  onGenerate: (
    seedMode: "random" | "constrained",
    complaint: ChiefComplaintFamily | null,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
  lang: "en" | "tr";
}) {
  const { t } = useTranslation();
  const [complaint, setComplaint] = useState<ChiefComplaintFamily | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);

  function run() {
    onGenerate(complaint ? "constrained" : "random", complaint, difficulty);
  }

  return (
    <Card padding="lg" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-tint text-brand">
          <Sparkle weight="fill" className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-fg">
            {t("cases.generate.heading")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("cases.generate.hint")}</p>
        </div>
      </div>

      {/* Chief complaint (null = surprise me) */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("cases.generate.complaintLegend")}
        </legend>
        <div
          role="radiogroup"
          aria-label={t("cases.generate.complaintLegend")}
          className="flex flex-wrap gap-2"
        >
          <FilterChip
            label={t("cases.generate.surprise")}
            selected={complaint === null}
            onSelect={() => setComplaint(null)}
            icon={Shuffle}
          />
          {COMPLAINT_ORDER.map((c) => (
            <FilterChip
              key={c}
              label={COMPLAINT_LABELS[c][lang]}
              selected={complaint === c}
              onSelect={() => setComplaint(c)}
              icon={COMPLAINT_ICON[c]}
            />
          ))}
        </div>
      </fieldset>

      {/* Difficulty */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="cases-gen-difficulty"
          className="flex items-center justify-between gap-3"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("cases.generate.difficultyLegend")}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-fg">
              {difficulty}
            </span>
            <Badge tone="brand">{DIFFICULTY_BAND[difficulty][lang]}</Badge>
          </span>
        </label>
        <input
          id="cases-gen-difficulty"
          type="range"
          min={1}
          max={5}
          step={1}
          value={difficulty}
          onChange={(e) =>
            setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
          }
          aria-valuetext={t("cases.generate.difficultyValueText", {
            level: difficulty,
            label: DIFFICULTY_BAND[difficulty][lang],
          })}
          className="w-full accent-[color:var(--brand-600)]"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-md text-xs text-muted">
          {t("cases.generate.unlimited")}
        </p>
        <Button
          size="md"
          onClick={run}
          leadingIcon={<Sparkle weight="fill" className="h-4 w-4" />}
        >
          {t("cases.generate.action")}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * CasesPage — the clinical case library (docs/design/01, docs/00-overview/04 §3).
 *
 * Lists the five curated seed CaseInstances plus a "Generate case" panel that
 * calls caseGen.generateCase to append unlimited, non-repeating synthetic cases
 * to the library. Each card exposes the browsing facets (specialty, difficulty,
 * guideline, ICD/DSM code, acuity, EN/TR) and a "Start this case" action that
 * hands the exact instance to the encounter workspace. Filters narrow by
 * specialty, difficulty, and chief complaint. Everything is SIM / synthetic and
 * education only.
 */
export function CasesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();

  const header = useReveal();
  const genEntry = useReveal(0.05);
  const filterEntry = useReveal(0.09);
  const gridEntry = useReveal(0.13);
  const cardLift = useHoverLift();

  // Generated cases live in page state so the library grows without a reload,
  // demonstrating the unlimited non-repeating generation claim. Newest first.
  const [generated, setGenerated] = useState<CaseInstance[]>([]);

  // Facet filters.
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [complaint, setComplaint] = useState<ChiefComplaintFamily | null>(null);

  const allCases = useMemo(
    () => [...generated, ...seedCases],
    [generated],
  );

  const visible = useMemo(() => {
    return allCases.filter((c) => {
      if (specialty && specialtyOf(c) !== specialty) return false;
      if (difficulty && c.difficulty !== difficulty) return false;
      if (complaint && complaintFamilyOf(c) !== complaint) return false;
      return true;
    });
  }, [allCases, specialty, difficulty, complaint]);

  const anyFilter = specialty !== null || difficulty !== null || complaint !== null;

  const clearFilters = useCallback(() => {
    setSpecialty(null);
    setDifficulty(null);
    setComplaint(null);
  }, []);

  const handleGenerate = useCallback(
    (
      seedMode: "random" | "constrained",
      cc: ChiefComplaintFamily | null,
      diff: 1 | 2 | 3 | 4 | 5,
    ) => {
      const next = generateCase(
        seedMode === "constrained" && cc
          ? { seedMode: "constrained", chiefComplaint: cc, difficulty: diff, locale: lang }
          : { seedMode: "random", difficulty: diff, locale: lang },
      );
      setGenerated((prev) => [next, ...prev]);
    },
    [lang],
  );

  const startCase = useCallback(
    (c: CaseInstance) => {
      navigate("/encounter", { state: { caseInstance: c } });
    },
    [navigate],
  );

  return (
    <PageContainer className="flex flex-col gap-9">
      {/* Header */}
      <motion.header {...header} className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            <span className="gradient-mark h-1.5 w-1.5 rounded-full" aria-hidden />
            {t("cases.eyebrow")}
          </span>
          <SimBadge variant="chip" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t("cases.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">{t("cases.subtitle")}</p>
      </motion.header>

      {/* Generate panel */}
      <motion.section {...genEntry} aria-labelledby="cases-generate-heading">
        <GeneratePanel onGenerate={handleGenerate} lang={lang} />
      </motion.section>

      {/* Filters */}
      <motion.section
        {...filterEntry}
        aria-label={t("cases.filters.label")}
        className="flex flex-col gap-4 rounded-card border border-border bg-bg-subtle p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-fg">
            <FunnelSimple weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("cases.filters.label")}
          </span>
          {anyFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-sm font-medium text-brand hover:bg-brand-tint focus-visible:outline-none"
            >
              <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("cases.filters.clear")}
            </button>
          ) : null}
        </div>

        <FilterRow legend={t("cases.filters.specialty")}>
          <FilterChip
            label={t("cases.filters.all")}
            selected={specialty === null}
            onSelect={() => setSpecialty(null)}
          />
          {SPECIALTY_ORDER.map((s) => (
            <FilterChip
              key={s}
              label={SPECIALTY_LABELS[s][lang]}
              selected={specialty === s}
              onSelect={() => setSpecialty(s)}
              icon={s === "emergency" ? Stethoscope : undefined}
            />
          ))}
        </FilterRow>

        <FilterRow legend={t("cases.filters.complaint")}>
          <FilterChip
            label={t("cases.filters.all")}
            selected={complaint === null}
            onSelect={() => setComplaint(null)}
          />
          {COMPLAINT_ORDER.map((c) => (
            <FilterChip
              key={c}
              label={COMPLAINT_LABELS[c][lang]}
              selected={complaint === c}
              onSelect={() => setComplaint(c)}
              icon={COMPLAINT_ICON[c]}
            />
          ))}
        </FilterRow>

        <FilterRow legend={t("cases.filters.difficulty")}>
          <FilterChip
            label={t("cases.filters.all")}
            selected={difficulty === null}
            onSelect={() => setDifficulty(null)}
          />
          {DIFFICULTIES.map((d) => (
            <FilterChip
              key={d}
              label={`${d} · ${DIFFICULTY_BAND[d][lang]}`}
              selected={difficulty === d}
              onSelect={() => setDifficulty(d)}
            />
          ))}
        </FilterRow>
      </motion.section>

      {/* Results */}
      <motion.section
        {...gridEntry}
        aria-label={t("cases.results.label")}
        className="flex flex-col gap-4"
      >
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {t("cases.results.count", { count: visible.length })}
        </p>

        {visible.length === 0 ? (
          <Card padding="lg" className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">{t("cases.results.empty")}</p>
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {t("cases.filters.clear")}
            </Button>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <motion.li key={c.id} {...cardLift} className="flex">
                <CaseInstanceCard data={c} lang={lang} onStart={startCase} />
              </motion.li>
            ))}
          </ul>
        )}
      </motion.section>

      <p className="text-xs text-muted">{t("cases.eduNote")}</p>
    </PageContainer>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  Sparkle,
  Lightning,
  CircleNotch,
  CheckCircle,
  FunnelSimple,
  Heartbeat,
  Brain,
  Flask,
  Wind,
  Virus,
  Drop,
  Pulse,
  Warning,
  Baby,
  Bone,
  ChatCircle,
  Stethoscope,
  Stack,
  ArrowRight,
  X,
  type Icon,
} from "@phosphor-icons/react";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  Button,
  Badge,
  Card,
  Field,
  Select,
  SectionLabel,
  StatusDot,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import type { StatusTone } from "@/components/ui";
import { CaseInstanceCard } from "@/components";
import { SimBadge } from "@/components/ehr";
import { useLang } from "@/lib/useLang";
import { nextSort, sortCases, type CaseSort, type CaseSortKey } from "@/lib/caseSort";
import { useReveal } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { pick, esiToState } from "@/components/ehr/labels";
import { stateMap } from "@/components/clinicalState";
import { seedCases } from "@/data/seedCases";
import { usePublishedCases } from "@/data/authoring";
import {
  generateCase,
  CHIEF_COMPLAINT_FAMILIES,
  type ChiefComplaintFamily,
} from "@/domain/caseGen";
import {
  generateCaseFromBackend,
  type GeneratedSource,
} from "@/lib/liveCaseGen";
import { useLiveBackend } from "@/lib/liveBackend";
import type { CaseInstance } from "@/domain/case";
import {
  specialtyOf,
  complaintFamilyOf,
  codeChipOf,
  guidelineTagOf,
  languagesOf,
  estMinutesOf,
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

// Every family the generator supports is targetable here (all 16, and any
// future addition auto-surfaces).
const COMPLAINT_ORDER: ChiefComplaintFamily[] = CHIEF_COMPLAINT_FAMILIES.map(
  (f) => f.id,
);

// Map the generator's free-form icon-name hint onto a real phosphor component,
// derived for every family so no exhaustive literal needs hand-maintenance.
const ICON_BY_NAME: Record<string, Icon> = {
  Heartbeat,
  Brain,
  Flask,
  Wind,
  Lungs: Wind, // no dedicated lungs glyph in this icon set
  Virus,
  Drop,
  Pulse,
  Warning,
  Baby,
  Bone,
  ChatCircle,
};
const COMPLAINT_ICON: Record<ChiefComplaintFamily, Icon> = Object.fromEntries(
  CHIEF_COMPLAINT_FAMILIES.map((f) => [f.id, ICON_BY_NAME[f.icon ?? ""] ?? Stethoscope]),
) as Record<ChiefComplaintFamily, Icon>;

const DIFFICULTIES: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

/* -------------------------------------------------------------------------- */
/* Filter toolbar primitives                                                   */
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
        "inline-flex h-7 items-center gap-1.5 rounded-chip border px-2 text-xs font-medium",
        "transition-colors duration-[120ms] ease-out",
        selected
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-fg",
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
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="eyebrow sm:w-24 sm:shrink-0">{legend}</span>
      <div
        role="radiogroup"
        aria-label={legend}
        className="flex flex-wrap gap-1.5"
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Generator control surface                                                   */
/* -------------------------------------------------------------------------- */

/** Outcome banner for the last generation run (source + fallback / degraded). */
interface GenNote {
  source: GeneratedSource;
  degraded: boolean;
  /** True when the AI path was requested but fell back to local generation. */
  fellBack: boolean;
}

function GeneratePanel({
  onEndless,
  onQuickGenerate,
  onAiGenerate,
  onCancel,
  busy,
  note,
  lang,
}: {
  onEndless: (
    complaint: ChiefComplaintFamily | null,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
  onQuickGenerate: (
    complaint: ChiefComplaintFamily | null,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
  onAiGenerate: (
    complaint: ChiefComplaintFamily | null,
    difficulty: 1 | 2 | 3 | 4 | 5,
  ) => void;
  onCancel: () => void;
  busy: boolean;
  note: GenNote | null;
  lang: "en" | "tr";
}) {
  const { t } = useTranslation();
  const [complaint, setComplaint] = useState<ChiefComplaintFamily | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5>(3);

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionLabel icon={<Sparkle weight="bold" className="h-3.5 w-3.5" />}>
          {t("select2.cases.generator.eyebrow")}
        </SectionLabel>
        <h2
          id="cases-generate-heading"
          className="text-base font-semibold tracking-tight text-fg"
        >
          {t("cases.generate.heading")}
        </h2>
        <p className="max-w-2xl text-[0.8125rem] text-muted">{t("cases.generate.hint")}</p>
      </div>

      {/* One toolbar row: constraints, then the headline action. */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t("livegen.refine")}</span>
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label={t("cases.generate.complaintLegend")}>
            {(aria) => (
              <Select
                {...aria}
                value={complaint ?? "surprise"}
                disabled={busy}
                onChange={(e) =>
                  setComplaint(
                    e.target.value === "surprise"
                      ? null
                      : (e.target.value as ChiefComplaintFamily),
                  )
                }
              >
                <option value="surprise">{t("cases.generate.surprise")}</option>
                {COMPLAINT_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {COMPLAINT_LABELS[c][lang]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t("cases.generate.difficultyLegend")}>
            {(aria) => (
              <Select
                {...aria}
                value={String(difficulty)}
                disabled={busy}
                onChange={(e) =>
                  setDifficulty(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                }
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d} · {DIFFICULTY_BAND[d][lang]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            size="md"
            disabled={busy}
            onClick={() => onEndless(complaint, difficulty)}
            leadingIcon={<Sparkle weight="bold" className="h-4 w-4" />}
            className="h-9"
          >
            {t("livegen.endless")}
          </Button>
        </div>
        <p className="text-xs text-muted">{t("livegen.endlessHint")}</p>
      </div>

      {/* Secondary: force a specific engine (preserves the quick / AI split) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
        <span className="eyebrow">{t("livegen.pickEngine")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onQuickGenerate(complaint, difficulty)}
            leadingIcon={<Lightning weight="bold" className="h-3.5 w-3.5" />}
            title={t("livegen.quickHint")}
          >
            {t("livegen.quick")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAiGenerate(complaint, difficulty)}
            leadingIcon={<Sparkle weight="bold" className="h-3.5 w-3.5" />}
            title={t("livegen.aiHint")}
          >
            {t("livegen.ai")}
          </Button>
        </div>
        <p className="basis-full text-xs text-muted">
          {t("livegen.quickHint")} {t("livegen.aiHint")}
        </p>
      </div>

      {/* Progress + outcome surface (never blocks; AI runs async) */}
      {busy ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-control border border-border bg-bg-subtle px-3 py-2.5"
        >
          <CircleNotch
            weight="bold"
            className="h-4 w-4 shrink-0 animate-spin text-brand"
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-fg">
              {t("livegen.generating")}
            </span>
            <span className="text-xs text-muted">
              {t("livegen.generatingHint")}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            leadingIcon={<X weight="bold" className="h-3.5 w-3.5" />}
          >
            {t("livegen.cancel")}
          </Button>
        </div>
      ) : note ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-control border border-border bg-bg-subtle px-3 py-2.5 text-xs text-muted"
        >
          <CheckCircle
            weight="fill"
            className="mt-0.5 h-4 w-4 shrink-0 text-brand"
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-fg">
                {t("livegen.sourceLabel")}
              </span>
              <Badge
                tone={note.source === "local" ? "neutral" : "brand"}
                variant="outline"
              >
                {t(`livegen.source.${note.source}`)}
              </Badge>
            </span>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted">
        {t("livegen.note")} {t("cases.generate.unlimited")}
      </p>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Sortable column header                                                      */
/* -------------------------------------------------------------------------- */

/**
 * SortTh: a column header that is a real button. Carries aria-sort on the
 * cell and a glyph for the direction (Origin, Supabase). Activation cycles
 * ascending, descending, cleared (lib/caseSort nextSort).
 */
function SortTh({
  column,
  sort,
  onSort,
  numeric,
  className,
  children,
}: {
  column: CaseSortKey;
  sort: CaseSort | null;
  onSort: (key: CaseSortKey) => void;
  numeric?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const active = sort?.key === column;
  const dir = active ? sort.dir : null;
  return (
    <Th
      numeric={numeric}
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={t("cases3.sortBy", { column: String(children), defaultValue: "Sort by {{column}}" })}
        className={cn(
          "inline-flex items-center gap-1 rounded-chip eyebrow hover:text-fg",
          numeric && "flex-row-reverse",
          active && "text-fg",
        )}
      >
        {children}
        {dir === "asc" ? (
          <ArrowUp weight="bold" className="h-3 w-3" aria-hidden />
        ) : dir === "desc" ? (
          <ArrowDown weight="bold" className="h-3 w-3" aria-hidden />
        ) : (
          <ArrowsDownUp weight="bold" className="h-3 w-3 text-border-strong" aria-hidden />
        )}
      </button>
    </Th>
  );
}

/* -------------------------------------------------------------------------- */
/* Catalogue table row (desktop)                                               */
/* -------------------------------------------------------------------------- */

function CaseRow({
  data,
  lang,
  onStart,
}: {
  data: CaseInstance;
  lang: "en" | "tr";
  onStart: (c: CaseInstance) => void;
}) {
  const { t } = useTranslation();

  const specialty = SPECIALTY_LABELS[specialtyOf(data)][lang];
  const chip = codeChipOf(data);
  const guideline = guidelineTagOf(data);
  const languages = languagesOf(data);
  const estMinutes = estMinutesOf(data);
  const band = DIFFICULTY_BAND[data.difficulty][lang];
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
    <Tr interactive onClick={() => onStart(data)}>
      {/* Case — presentation, demographic + guideline, provenance, languages */}
      <Td>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-fg">
              {pick(data.chiefComplaint, lang)}
            </span>
            {isGenerated ? (
              <Badge
                tone="brand"
                variant="outline"
                icon={<Sparkle weight="fill" className="h-3 w-3" />}
              >
                {t("cases.card.generated")}
              </Badge>
            ) : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{ageSex}</span>
            <span aria-hidden className="text-border-strong">
              ·
            </span>
            <span>{guideline}</span>
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
                  className="rounded border border-border px-1 text-[10px] font-semibold uppercase tracking-wide text-subtle"
                >
                  {l}
                </span>
              ))}
            </span>
          </span>
        </div>
      </Td>

      {/* Specialty */}
      <Td className="hidden text-muted xl:table-cell">{specialty}</Td>

      {/* Code */}
      <Td>
        <span
          className="inline-flex items-baseline gap-1.5 font-mono"
          aria-label={t("cases.card.codeLabel", {
            system: chip.system,
            code: chip.code,
          })}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-subtle">
            {chip.system}
          </span>
          <span className="text-fg">{chip.code}</span>
        </span>
      </Td>

      {/* Difficulty */}
      <Td>
        <Badge tone="brand">
          <span className="tnum">{data.difficulty}</span>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          {band}
        </Badge>
      </Td>

      {/* Acuity */}
      <Td className="hidden lg:table-cell">
        <StatusDot
          tone={acuityTone}
          label={`${t("ehr.banner.esi", { level: data.acuityESI })} · ${t(
            acuityState.labelKey,
          )}`}
        />
      </Td>

      {/* Est. time */}
      <Td numeric className="hidden lg:table-cell text-muted">
        {t("caseCard.estimate", { minutes: estMinutes })}
      </Td>

      {/* Start */}
      <Td className="text-end">
        <Button
          size="sm"
          variant="secondary"
          trailingIcon={<ArrowRight weight="bold" className="h-3.5 w-3.5" />}
          onClick={(e) => {
            e.stopPropagation();
            onStart(data);
          }}
        >
          {t("select2.cases.table.action")}
        </Button>
      </Td>
    </Tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * CasesPage — the clinical case library (docs/design/01, docs/00-overview/04 §3).
 *
 * A generator control surface builds unlimited, non-repeating synthetic cases;
 * a compact filter toolbar narrows by specialty, chief complaint, and
 * difficulty; and the results read as a real catalogue — a dense, hairline
 * table on wide screens and a stack of catalogue rows on narrow ones. Each
 * case carries its browsing facets (specialty, ICD/DSM code, difficulty band,
 * acuity, est. time, EN/TR) and a "Start this case" action that hands the exact
 * instance to the encounter workspace. Everything is SIM / synthetic, education
 * only.
 */
export function CasesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();

  const header = useReveal();
  const genEntry = useReveal(0.05);
  const filterEntry = useReveal(0.09);
  const gridEntry = useReveal(0.13);

  // The live pod backend availability (health-probed once); used to skip the
  // network wait when the gateway is known to be offline.
  const { available, checking } = useLiveBackend();

  // Generated cases live in page state so the library grows without a reload,
  // demonstrating the unlimited non-repeating generation claim. Newest first.
  const [generated, setGenerated] = useState<CaseInstance[]>([]);

  // Async AI-generation state. `aiBusy` drives the progress surface; `genNote`
  // is the outcome banner (source + fallback / degraded). An AbortController
  // lets the learner cancel a slow pod request.
  const [aiBusy, setAiBusy] = useState(false);
  const [genNote, setGenNote] = useState<GenNote | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Column sort (asc, desc, then cleared; see lib/caseSort).
  const [sort, setSort] = useState<CaseSort | null>(null);
  const toggleSort = useCallback((key: CaseSortKey) => setSort((s) => nextSort(s, key)), []);

  // Facet filters.
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [complaint, setComplaint] = useState<ChiefComplaintFamily | null>(null);

  // Educator-authored, co-signed, PUBLISHED cases (persisted, cross-session).
  // Only cases that are not flagged AND are offered in the active locale reach
  // learners here — a Turkish-only case never surfaces in an English library,
  // and vice-versa. The subscription keeps this live, so a case published in
  // this session appears without a reload. Each maps to its exact caseInstance
  // so "Start" hands over the authored patient, just like a seed case.
  const published = usePublishedCases();
  const publishedInstances = useMemo(
    () =>
      published
        .filter(
          (p) =>
            p.status !== "flagged" &&
            p.locales.some((l) => l.locale === lang && l.offered),
        )
        .map((p) => p.caseInstance),
    [published, lang],
  );

  const allCases = useMemo(
    () => [...generated, ...publishedInstances, ...seedCases],
    [generated, publishedInstances],
  );

  const visible = useMemo(() => {
    const filtered = allCases.filter((c) => {
      if (specialty && specialtyOf(c) !== specialty) return false;
      if (difficulty && c.difficulty !== difficulty) return false;
      if (complaint && complaintFamilyOf(c) !== complaint) return false;
      return true;
    });
    return sortCases(filtered, sort, lang);
  }, [allCases, specialty, difficulty, complaint, sort, lang]);

  const anyFilter =
    specialty !== null || difficulty !== null || complaint !== null;

  const clearFilters = useCallback(() => {
    setSpecialty(null);
    setDifficulty(null);
    setComplaint(null);
  }, []);

  // Quick generate — INSTANT, offline, deterministic. The default path.
  const handleQuickGenerate = useCallback(
    (cc: ChiefComplaintFamily | null, diff: 1 | 2 | 3 | 4 | 5) => {
      const next = generateCase(
        cc
          ? { seedMode: "constrained", chiefComplaint: cc, difficulty: diff, locale: lang }
          : { seedMode: "random", difficulty: diff, locale: lang },
      );
      setGenerated((prev) => [next, ...prev]);
      setGenNote({ source: "local", degraded: false, fellBack: false });
    },
    [lang],
  );

  // AI generate — ASYNC pod backend, richer + ICD/DSM-sampled, with a progress
  // state and a graceful fallback to the instant client. Never blocks the UI.
  const handleAiGenerate = useCallback(
    (cc: ChiefComplaintFamily | null, diff: 1 | 2 | 3 | 4 | 5) => {
      const constraints = {
        locale: lang,
        difficulty: diff,
        complaint: cc,
        ...(specialty ? { specialty } : {}),
      };

      // Backend health-probed as offline: skip the wait, generate locally now.
      if (!checking && !available) {
        const next = generateCase(
          cc
            ? { seedMode: "constrained", chiefComplaint: cc, difficulty: diff, locale: lang }
            : { seedMode: "random", difficulty: diff, locale: lang },
        );
        setGenerated((prev) => [next, ...prev]);
        setGenNote({ source: "local", degraded: false, fellBack: true });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setAiBusy(true);
      setGenNote(null);

      void (async () => {
        try {
          const result = await generateCaseFromBackend(constraints, {
            signal: controller.signal,
          });
          setGenerated((prev) => [result.case, ...prev]);
          setGenNote({
            source: result.source,
            degraded: result.degraded,
            fellBack: result.source === "local",
          });
        } catch {
          // Aborted by the learner (Cancel) — leave the library untouched.
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setAiBusy(false);
        }
      })();
    },
    [lang, specialty, available, checking],
  );

  // Endless generation — the DEFAULT, headline action. Prefers the realtime pod
  // backend (unlimited ICD-11 / ICD-10 / DSM-5-TR synthesis) whenever it is
  // reachable, and drops to the instant on-device generator only when the pod is
  // known to be offline. Either way the learner gets a brand-new, non-repeating
  // case; the pod path shows a brief, cancellable loading state.
  const handleEndlessGenerate = useCallback(
    (cc: ChiefComplaintFamily | null, diff: 1 | 2 | 3 | 4 | 5) => {
      if (!checking && !available) {
        handleQuickGenerate(cc, diff);
      } else {
        handleAiGenerate(cc, diff);
      }
    },
    [available, checking, handleQuickGenerate, handleAiGenerate],
  );

  const handleCancelGenerate = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startCase = useCallback(
    (c: CaseInstance) => {
      navigate("/encounter", { state: { caseInstance: c } });
    },
    [navigate],
  );

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      {/* Header */}
      <motion.div {...header}>
        <PageHeader
          eyebrow={t("cases.eyebrow")}
          title={t("cases.title")}
          description={t("cases.subtitle")}
          meta={<SimBadge variant="chip" />}
        />
      </motion.div>

      {/* Generator */}
      <motion.section {...genEntry} aria-labelledby="cases-generate-heading">
        <GeneratePanel
          onEndless={handleEndlessGenerate}
          onQuickGenerate={handleQuickGenerate}
          onAiGenerate={handleAiGenerate}
          onCancel={handleCancelGenerate}
          busy={aiBusy}
          note={genNote}
          lang={lang}
        />
      </motion.section>

      {/* Secondary affordance: the curated + generated catalogue below */}
      <motion.div {...filterEntry} className="-mb-3 border-t border-border pt-5">
        <SectionLabel icon={<Stack weight="bold" className="h-3.5 w-3.5" />}>
          {t("livegen.orCurated")}
        </SectionLabel>
      </motion.div>

      {/* Filter toolbar */}
      <motion.section
        {...filterEntry}
        aria-label={t("cases.filters.label")}
        className="flex flex-col gap-2.5 border-b border-border pb-4"
      >
        <div className="flex items-center justify-between gap-3">
          <SectionLabel
            icon={<FunnelSimple weight="bold" className="h-3.5 w-3.5" />}
          >
            {t("cases.filters.label")}
          </SectionLabel>
          {anyFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-7 items-center gap-1 rounded-control px-2 text-xs font-medium text-brand hover:bg-brand-tint"
            >
              <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
              {t("cases.filters.clear")}
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5">
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
        </div>
      </motion.section>

      {/* Results */}
      <motion.section
        {...gridEntry}
        aria-label={t("cases.results.label")}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t("cases.results.label")}</SectionLabel>
          <p
            className="tnum text-xs font-medium text-muted"
            role="status"
            aria-live="polite"
          >
            {t("cases.results.count", { count: visible.length })}
          </p>
        </div>

        {visible.length === 0 ? (
          <Card
            variant="inset"
            padding="lg"
            className="flex flex-col items-start gap-3"
          >
            <p className="text-sm text-muted">{t("cases.results.empty")}</p>
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {t("cases.filters.clear")}
            </Button>
          </Card>
        ) : (
          <>
            {/* Narrow screens: catalogue rows */}
            <ul className="flex flex-col gap-3 md:hidden">
              {visible.map((c) => (
                <li key={c.id}>
                  <CaseInstanceCard data={c} lang={lang} onStart={startCase} />
                </li>
              ))}
            </ul>

            {/* Wide screens: dense catalogue table */}
            <TableWrap className="hidden md:block">
              <Table>
                <THead>
                  <Tr>
                    <SortTh column="case" sort={sort} onSort={toggleSort}>
                      {t("select2.cases.table.case")}
                    </SortTh>
                    <SortTh column="specialty" sort={sort} onSort={toggleSort} className="hidden xl:table-cell">
                      {t("cases.filters.specialty")}
                    </SortTh>
                    <SortTh column="code" sort={sort} onSort={toggleSort}>
                      {t("select2.cases.table.code")}
                    </SortTh>
                    <SortTh column="difficulty" sort={sort} onSort={toggleSort}>
                      {t("caseCard.difficulty")}
                    </SortTh>
                    <SortTh column="acuity" sort={sort} onSort={toggleSort} className="hidden lg:table-cell">
                      {t("select2.cases.table.acuity")}
                    </SortTh>
                    <SortTh column="minutes" sort={sort} onSort={toggleSort} numeric className="hidden lg:table-cell">
                      {t("select2.cases.table.time")}
                    </SortTh>
                    <Th className="text-end">
                      {t("select2.cases.table.action")}
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {visible.map((c) => (
                    <CaseRow
                      key={c.id}
                      data={c}
                      lang={lang}
                      onStart={startCase}
                    />
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </>
        )}
      </motion.section>

      <p className="text-xs text-muted">{t("cases.eduNote")}</p>
    </PageContainer>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MagnifyingGlass, Plus, Check, Stethoscope, CaretDown } from "@phosphor-icons/react";

import { Divider, SectionLabel, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Lang } from "@/data/schema";
import {
  caseEntry,
  diagnosisLabel,
  searchDiagnoses,
  systemLabel,
  type DiagnosisEntry,
  type DiagnosisSearchResult,
  type DiagnosisSystem,
} from "@/domain/diagnosisCatalog";
import { searchIcd10cm } from "@/lib/terminologyApi";
import { useEncounterState } from "@/state/encounterStore";

const EMPTY_CODES: ReadonlySet<string> = new Set();

/** How many results to reveal per page before offering "Load more". */
const RESULTS_PAGE_SIZE = 40;

/** One pickable/added candidate, resolved to a grade-aligned store code. */
export interface DxOption {
  /** The code stored + graded (a case code when it maps to a case condition). */
  code: string;
  display: string;
  entry?: DiagnosisEntry;
  /** True when this candidate is one the case itself proposes. */
  suggested: boolean;
}

export interface DiagnosisPickerProps {
  lang: Lang;
  /** The case's own differentials + correct dx, deduped and alphabetised. */
  caseOptions: DxOption[];
  /** Every code the case grounds on (icd10 | icd11 | dsm of its conditions). */
  caseCodeSet: ReadonlySet<string>;
  /** Codes currently in the student's (non-retracted) differential. */
  visibleSet: ReadonlySet<string>;
  /** Add a resolved candidate to the differential. */
  onAdd: (option: DxOption) => void;
}

/**
 * DiagnosisPicker — the differential builder.
 *
 * A search field over the whole ICD-10 / ICD-11 / DSM catalogue plus a
 * "suggested for this presentation" row seeded from the case's own conditions
 * (unlabelled, so the ground-truth answer is never given away). Selecting a
 * catalogue hit that denotes one of the case's conditions is normalised back to
 * the case's grounding code so a committed diagnosis grades correctly.
 */
export function DiagnosisPicker({
  lang,
  caseOptions,
  caseCodeSet,
  visibleSet,
  onAdd,
}: DiagnosisPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  // Diagnoses the case grounds on but the static catalogue does not carry (the
  // pod backend can synthesise dx beyond the 192-row set). Merge them into the
  // search corpus so any generated diagnosis is findable by name — not merely
  // committable from the "suggested" row below. Catalogue entries win on a code
  // collision inside searchDiagnoses, so in-catalogue cases are never doubled.
  // Review 2026-10-21: the full ICD-10-CM FY2027 release (every code, with the
  // official alphabetic-index phrases as synonyms) is searched on the server when
  // the gateway is reachable; its hits join the corpus below, and a catalogue
  // entry still wins a code collision.
  const live = useEncounterState().liveEnabled;
  const [server, setServer] = useState<{ q: string; hits: DiagnosisEntry[]; codes: ReadonlySet<string> }>({
    q: "",
    hits: [],
    codes: new Set(),
  });
  const trimmed = query.trim();
  useEffect(() => {
    if (!live || trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchIcd10cm(trimmed, 25, { signal: controller.signal }).then((res) => {
        if (!res.ok || !res.data.available) return;
        setServer({
          q: trimmed,
          hits: res.data.results.map((h) => caseEntry(h.code, h.title)),
          codes: new Set(res.data.results.map((h) => h.code)),
        });
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, live]);
  // Only the answer for the current query counts (a stale answer is ignored).
  const current = live && server.q === trimmed;
  const serverHits = useMemo(() => (current ? server.hits : []), [current, server.hits]);
  const serverCodes = current ? server.codes : EMPTY_CODES;

  const extraEntries = useMemo<DiagnosisEntry[]>(
    () => [...caseOptions.filter((o) => !o.entry).map((o) => caseEntry(o.code, o.display)), ...serverHits],
    [caseOptions, serverHits],
  );

  // Every match, ranked — never silently truncated. The list is paged for the
  // DOM via `visibleCount` + a "Load more" control below.
  const results = useMemo(() => {
    const local = searchDiagnoses(query, lang, undefined, extraEntries);
    // Server hits matched through index synonyms ("heart attack" -> I21.9) that
    // the local label search cannot see follow the local matches, in server rank.
    const seen = new Set(local.map((r) => r.icd10));
    const rest: DiagnosisSearchResult[] = serverHits
      .filter((h) => !seen.has(h.icd10))
      .map((h, i) => ({ ...h, display: h.label.en, rank: 1000 + i }));
    return [...local, ...rest];
  }, [query, lang, extraEntries, serverHits]);

  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  // Reset paging whenever the result set changes (new query / language / case).
  useEffect(() => setVisibleCount(RESULTS_PAGE_SIZE), [results]);

  const shown = results.slice(0, visibleCount);
  const hasMore = results.length > shown.length;

  /** Map a catalogue entry to a case code when it denotes the same diagnosis. */
  function toOption(entry: DiagnosisEntry): DxOption {
    for (const c of [entry.icd10, entry.icd11, entry.dsm5tr]) {
      if (c && caseCodeSet.has(c)) {
        const co = caseOptions.find((o) => o.code === c);
        if (co) return { code: c, display: co.display, entry, suggested: true };
      }
    }
    return { code: entry.icd10, display: diagnosisLabel(entry, lang), entry, suggested: false };
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Search the catalogue --------------------------------------- */}
      <div>
        <SectionLabel
          className="mb-2"
          icon={<MagnifyingGlass weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          trailing={
            query.trim() ? (
              <span className="font-mono text-[11px] tabular-nums text-muted">
                {t("diagnosis2.resultsCount", { count: results.length })}
              </span>
            ) : null
          }
        >
          {t("diagnosis2.searchSubhead", { defaultValue: "Search the catalogue" })}
        </SectionLabel>

        <label htmlFor="dx-search" className="sr-only">
          {t("ehr.ap.searchPlaceholder")}
        </label>
        <div className="relative">
          <MagnifyingGlass
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <TextInput
            id="dx-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ehr.ap.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted">{t("diagnosis2.catalogHint")}</p>

        {query.trim() ? (
          <>
            <ul className="mt-2 flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
              {shown.map((r) => {
                const o = toOption(r);
                const added = visibleSet.has(o.code);
                return (
                  <li key={r.icd10} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{o.display}</span>
                      <CodeChips entry={r} lang={lang} system={r.system} fromRelease={serverCodes.has(r.icd10)} />
                    </span>
                    <AddButton added={added} label={o.display} onClick={() => onAdd(o)} />
                  </li>
                );
              })}
              {results.length === 0 ? (
                <li className="py-3 text-center text-xs italic text-muted">{t("ehr.ap.noMatches")}</li>
              ) : null}
            </ul>
            {hasMore ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {t("diagnosis2.showingCount", {
                    defaultValue: "Showing {{shown}} of {{total}}",
                    shown: shown.length,
                    total: results.length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleCount((n) => n + RESULTS_PAGE_SIZE)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-medium text-brand",
                    "transition-colors duration-200 ease-out hover:bg-brand-tint active:scale-[0.98]",
                  )}
                >
                  <CaretDown weight="bold" className="h-3.5 w-3.5" aria-hidden />
                  {t("diagnosis2.loadMore", { defaultValue: "Load more" })}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 rounded-control border border-dashed border-border bg-bg-subtle px-3 py-4 text-center text-xs text-muted">
            {t("diagnosis2.searchEmptyHint")}
          </p>
        )}
      </div>

      <Divider />

      {/* ---- Suggested — case differentials + correct dx, unlabelled ----- */}
      <div>
        <SectionLabel
          className="mb-1"
          icon={<Stethoscope weight="bold" className="h-3.5 w-3.5" aria-hidden />}
        >
          {t("diagnosis2.suggestedHeading")}
        </SectionLabel>
        <p className="mb-2 text-[11px] text-muted">{t("diagnosis2.suggestedHint")}</p>
        <div className="flex flex-wrap gap-1.5">
          {caseOptions.map((o) => {
            const added = visibleSet.has(o.code);
            return (
              <button
                key={o.code}
                type="button"
                onClick={() => onAdd(o)}
                disabled={added}
                aria-label={t("diagnosis2.addAria", { name: o.display })}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                  "transition-colors duration-200 ease-out active:scale-[0.98]",
                  added
                    ? "cursor-default border-transparent bg-bg-subtle text-muted"
                    : "border-border bg-surface text-fg hover:bg-brand-tint hover:text-brand",
                )}
              >
                {added ? (
                  <Check weight="bold" className="h-3 w-3" aria-hidden />
                ) : (
                  <Plus weight="bold" className="h-3 w-3" aria-hidden />
                )}
                {o.display}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** ICD-10 / ICD-11 / DSM code chips + a system label for a catalogue row. */
function CodeChips({
  entry,
  lang,
  system,
  fromRelease = false,
}: {
  entry: DiagnosisEntry;
  lang: Lang;
  system: DiagnosisSystem;
  /** True for a hit from the full ICD-10-CM release (no curated system label). */
  fromRelease?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1">
      <span className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
        <span className="text-fg-subtle">{t("diagnosis2.codeIcd10")}</span> {entry.icd10}
      </span>
      {entry.icd11 ? (
        <span className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
          <span className="text-fg-subtle">{t("diagnosis2.codeIcd11")}</span> {entry.icd11}
        </span>
      ) : null}
      {entry.dsm5tr ? (
        <span className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-muted">
          <span className="text-fg-subtle">{t("diagnosis2.codeDsm")}</span> {entry.dsm5tr}
        </span>
      ) : null}
      <span className="text-[10px] text-fg-subtle">{fromRelease ? t("results3.icdSource") : systemLabel(system, lang)}</span>
    </span>
  );
}

/** The Add / Added affordance in the catalogue result list. */
function AddButton({
  added,
  label,
  onClick,
}: {
  added: boolean;
  label: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={added}
      aria-label={t("diagnosis2.addAria", { name: label })}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        "transition-colors duration-200 ease-out active:scale-[0.98]",
        added
          ? "cursor-default border-transparent bg-bg-subtle text-muted"
          : "border-border bg-surface text-brand hover:bg-brand-tint",
      )}
    >
      {added ? (
        <Check weight="bold" className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Plus weight="bold" className="h-3.5 w-3.5" aria-hidden />
      )}
      {t(added ? "ehr.ap.added" : "ehr.ap.add")}
    </button>
  );
}

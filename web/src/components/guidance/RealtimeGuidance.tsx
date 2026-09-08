import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Broadcast,
  CaretDown,
  CheckCircle,
  Circle,
  CloudSlash,
  FlagBanner,
  ListChecks,
  ShieldCheck,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Card, SectionLabel, StatusDot, type StatusTone } from "@/components/ui";
import { useLang } from "@/lib/useLang";
import {
  useEncounterState,
  type EncounterState,
} from "@/state/encounterStore";
import {
  computeCoverage,
  useLiveGrounding,
  type Coverage,
  type CoverageGroup,
} from "@/lib/guidanceEngine";
import type { CaseInstance } from "@/domain/case";
import type { Lang } from "@/data/mock";

export interface RealtimeGuidanceProps {
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Focus derivation (chief complaint + last action)                            */
/* -------------------------------------------------------------------------- */

type TFunc = ReturnType<typeof useTranslation>["t"];

/** A short, human phrase for the learner's most recent meaningful action. */
function lastActionPhrase(
  state: EncounterState,
  caseInstance: CaseInstance | null,
  lang: Lang,
  t: TFunc,
): string {
  const last = [...state.events]
    .reverse()
    .find((e) => e.type === "question" || e.type === "exam" || e.type === "order");
  if (!last) return "";
  if (last.type === "question") return t(`guidance3.intent.${last.ref}`, last.ref);
  if (last.type === "exam") return t(`guidance3.maneuver.${last.ref}`, last.ref);
  const order = caseInstance?.expectedWorkup.find(
    (w) => (w.code.coding[0]?.code ?? "") === last.ref,
  );
  return order ? order.label[lang] : last.ref;
}

/* -------------------------------------------------------------------------- */
/* Small presentational helpers                                                */
/* -------------------------------------------------------------------------- */

function groupTone(g: CoverageGroup): StatusTone {
  if (g.expected === 0) return "neutral";
  if (g.done >= g.expected) return "normal";
  return g.done > 0 ? "caution" : "neutral";
}

function MeterRow({
  label,
  group,
}: {
  label: string;
  group: CoverageGroup;
}) {
  const { t } = useTranslation();
  const pct = group.expected === 0 ? 0 : Math.round((group.done / group.expected) * 100);
  const tone = groupTone(group);
  const complete = group.expected > 0 && group.done >= group.expected;
  return (
    <div
      className="flex items-center gap-3"
      aria-label={t("guidance3.coverage.aria", {
        label,
        done: group.done,
        expected: group.expected,
      })}
    >
      <div className="flex w-24 shrink-0 items-center gap-1.5">
        <StatusDot tone={tone} size="sm" />
        <span className="text-xs font-medium text-fg">{label}</span>
      </div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-bg-inset">
        <div
          className={cn(
            "h-full rounded-pill transition-[width] duration-500 ease-out",
            complete ? "bg-[color:var(--state-normal)]" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-end font-mono text-xs tabular-nums text-muted">
        {group.done}/{group.expected}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RealtimeGuidance                                                            */
/* -------------------------------------------------------------------------- */

/**
 * RealtimeGuidance — an AMBOSS-style clinical reference panel that updates live
 * as the learner works. A lead cited guideline card for the current focus,
 * expandable guideline detail, inline superscript citations that link to a
 * numbered sources block, a history/exam/work-up coverage meter, and a red-flag
 * checklist. Grounds against the live pod backend when available and degrades to
 * the case's cited guideline reference offline. PROCESS ONLY — it never renders,
 * derives from, or hints at the diagnosis.
 */
export function RealtimeGuidance({ className }: RealtimeGuidanceProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const state = useEncounterState();
  const [expanded, setExpanded] = useState(false);

  const caseInstance = state.caseInstance;
  const chief = caseInstance ? caseInstance.chiefComplaint[lang] : "";
  const lastLabel = lastActionPhrase(state, caseInstance, lang, t);
  const citationIds = useMemo(
    () =>
      caseInstance
        ? Array.from(new Set(caseInstance.expectedWorkup.map((w) => w.citationId)))
        : [],
    [caseInstance],
  );
  const orderCodes = useMemo(
    () =>
      caseInstance
        ? caseInstance.expectedWorkup.map((w) => w.code.coding[0]?.code ?? "")
        : [],
    [caseInstance],
  );
  const query = [chief, lastLabel].filter(Boolean).join(" · ");
  const grounding = useLiveGrounding({ query, locale: lang, citationIds, orderCodes });

  // Number the citations in appearance order for the footnotes block.
  const noted = useMemo(() => {
    const map = new Map<string, number>();
    const notes: Array<{ n: number; citation: string; source: string; url?: string }> = [];
    const withNote = grounding.passages.map((p) => {
      const key = `${p.citation}|${p.source}|${p.url ?? ""}`;
      let n = map.get(key);
      if (n == null) {
        n = notes.length + 1;
        map.set(key, n);
        notes.push({ n, citation: p.citation, source: p.source, url: p.url });
      }
      return { passage: p, n };
    });
    return { withNote, notes };
  }, [grounding.passages]);

  if (!caseInstance) {
    return (
      <Card variant="inset" padding="md" className={className} role="note">
        <div className="flex items-start gap-2.5 text-muted">
          <BookOpen weight="bold" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="text-sm leading-relaxed">{t("guidance3.panel.empty")}</p>
        </div>
      </Card>
    );
  }

  const coverage: Coverage = computeCoverage(state, caseInstance);
  const [lead, ...rest] = noted.withNote;

  return (
    <section
      aria-label={t("guidance3.panel.title")}
      className={cn("flex flex-col gap-3", className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel icon={<BookOpen weight="bold" className="h-3.5 w-3.5" />}>
            {t("guidance3.panel.title")}
          </SectionLabel>
          <p className="mt-1 text-xs text-muted">{t("guidance3.panel.subtitle")}</p>
        </div>
        <ReferencePill degraded={grounding.degraded} loading={grounding.loading} />
      </div>

      {/* Lead cited guideline card */}
      <Card variant="surface" padding="md">
        <div className="flex items-center gap-2">
          <span className="eyebrow text-brand">{t("guidance3.focus")}</span>
          <span className="rounded-pill bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
            {t("guidance3.panel.education")}
          </span>
        </div>
        <p className="mt-1 text-sm font-semibold tracking-tight text-fg">
          {chief}
          {lastLabel ? (
            <span className="font-normal text-muted"> · {lastLabel}</span>
          ) : null}
        </p>

        {lead ? (
          <p className="mt-3 text-sm leading-relaxed text-fg">
            {lead.passage.text}
            <FootnoteRef n={lead.n} />
          </p>
        ) : null}

        {/* High-yield inset: red-flag reminder */}
        {coverage.redFlags.total > 0 ? (
          <div className="mt-3 flex items-start gap-2 rounded-control border border-brand/25 bg-brand-tint/50 p-2.5">
            <ShieldCheck
              weight="fill"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand"
              aria-hidden
            />
            <p className="text-xs leading-relaxed text-fg">
              <span className="font-semibold">{t("guidance3.redflags.title")}:</span>{" "}
              {t("guidance3.redflags.count", {
                screened: coverage.redFlags.screened,
                total: coverage.redFlags.total,
              })}
            </p>
          </div>
        ) : null}

        {/* Expandable guideline detail */}
        {rest.length > 0 ? (
          <div className="mt-3 border-t border-border pt-2.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand transition-colors hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-control"
            >
              <CaretDown
                weight="bold"
                className={cn(
                  "h-3 w-3 transition-transform",
                  expanded && "rotate-180",
                )}
                aria-hidden
              />
              {expanded
                ? t("guidance3.guideline.hide")
                : t("guidance3.guideline.more", { count: rest.length })}
            </button>
            {expanded ? (
              <ul className="mt-2.5 flex flex-col gap-2.5">
                {rest.map(({ passage, n }, i) => (
                  <li
                    key={`${passage.citation}-${i}`}
                    className="text-sm leading-relaxed text-fg"
                  >
                    {passage.text}
                    <FootnoteRef n={n} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Coverage meter */}
      <Card variant="surface" padding="md">
        <SectionLabel
          icon={<ListChecks weight="bold" className="h-3.5 w-3.5" />}
          trailing={
            <span className="font-mono text-xs tabular-nums text-muted">
              {Math.round(coverage.overallPct * 100)}%
            </span>
          }
        >
          {t("guidance3.coverage.title")}
        </SectionLabel>
        <div className="mt-3 flex flex-col gap-2.5">
          <MeterRow label={t("guidance3.coverage.history")} group={coverage.history} />
          <MeterRow label={t("guidance3.coverage.exam")} group={coverage.exam} />
          <MeterRow
            label={t("guidance3.coverage.workup")}
            group={{
              done: coverage.workup.done,
              expected: coverage.workup.expected,
              items: [],
            }}
          />
        </div>
      </Card>

      {/* Red-flag checklist */}
      {coverage.redFlags.total > 0 ? (
        <Card variant="surface" padding="md">
          <SectionLabel
            icon={<FlagBanner weight="bold" className="h-3.5 w-3.5" />}
            trailing={
              <span className="font-mono text-xs tabular-nums text-muted">
                {coverage.redFlags.screened}/{coverage.redFlags.total}
              </span>
            }
          >
            {t("guidance3.redflags.title")}
          </SectionLabel>
          <ul className="mt-3 flex flex-col gap-2">
            {coverage.redFlags.items.map((rf) => (
              <li key={rf.index} className="flex items-start gap-2">
                {rf.screened ? (
                  <CheckCircle
                    weight="fill"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--state-normal)]"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    weight="bold"
                    className="mt-0.5 h-4 w-4 shrink-0 text-subtle"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "text-sm leading-relaxed",
                    rf.screened ? "text-muted" : "text-fg",
                  )}
                >
                  {rf.text[lang]}
                  <span className="sr-only">
                    {" — "}
                    {rf.screened
                      ? t("guidance3.redflags.screened")
                      : t("guidance3.redflags.notScreened")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Sources / footnotes */}
      {noted.notes.length > 0 ? (
        <div>
          <SectionLabel>{t("guidance3.sources.title")}</SectionLabel>
          <ol className="mt-2 flex flex-col gap-1.5">
            {noted.notes.map((fn) => (
              <li
                key={fn.n}
                id={`gd-fn-${fn.n}`}
                className="flex gap-2 text-xs leading-relaxed text-muted"
              >
                <span className="font-mono font-semibold text-brand">{fn.n}.</span>
                <span className="min-w-0">
                  <span className="font-medium text-fg">{fn.citation}</span>
                  {fn.source && fn.source !== fn.citation ? (
                    <span> — {fn.source}</span>
                  ) : null}
                  {fn.url ? (
                    <>
                      {" "}
                      <a
                        href={fn.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
                      >
                        <BookOpen weight="bold" className="h-3 w-3" aria-hidden />
                        {t("guidance3.sources.open")}
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                        */
/* -------------------------------------------------------------------------- */

/** Inline superscript citation that links to its numbered footnote. */
function FootnoteRef({ n }: { n: number }) {
  return (
    <a
      href={`#gd-fn-${n}`}
      aria-label={`Source ${n}`}
      className="ms-0.5 align-super text-[0.65rem] font-semibold text-brand no-underline hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
    >
      {n}
    </a>
  );
}

function ReferencePill({ degraded, loading }: { degraded: boolean; loading: boolean }) {
  const { t } = useTranslation();
  const live = !degraded;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-[11px] font-medium",
        live
          ? "border-transparent bg-[color-mix(in_srgb,var(--state-normal)_14%,transparent)] text-[color:var(--state-normal)]"
          : "border-border bg-bg-subtle text-muted",
      )}
    >
      {live ? (
        <Broadcast weight="fill" className="h-3 w-3" aria-hidden />
      ) : (
        <CloudSlash weight="bold" className="h-3 w-3" aria-hidden />
      )}
      {loading
        ? t("guidance3.reference.loading")
        : live
          ? t("guidance3.reference.live")
          : t("guidance3.reference.offline")}
    </span>
  );
}

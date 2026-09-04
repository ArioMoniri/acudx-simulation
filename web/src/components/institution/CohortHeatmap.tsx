import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  GridFour,
  Table as TableIcon,
  Lock,
  CaretRight,
  Info,
  X,
} from "@phosphor-icons/react";
import {
  Card,
  Button,
  Tooltip,
  Badge,
  TableWrap,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import {
  cohortLearners,
  HEATMAP_DOMAINS,
  drillDatum,
  FRAMEWORK_DOMAIN_TAG,
  type CohortLearner,
  type HeatmapCell,
} from "@/data/institution";
import type { Band, FeedbackDomainKey } from "@/data/mock";
import {
  BAND_RANK,
  BAND_CELL_TINT,
  BAND_CELL_TEXT,
  bandCode,
} from "./bandMeta";

/* -------------------------------------------------------------------------- */
/* Drill target                                                                */
/* -------------------------------------------------------------------------- */

interface DrillTarget {
  learner: CohortLearner;
  domain: FeedbackDomainKey;
}

/** The learner's widest gap (lowest reliable band), the sensible default drill domain. */
function weakestDomain(learner: CohortLearner): FeedbackDomainKey {
  const ranked = HEATMAP_DOMAINS.map((d) => ({
    key: d.key,
    rank: BAND_RANK[learner.cells[d.key].band],
  }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  return ranked[0]?.key ?? HEATMAP_DOMAINS[0].key;
}

/* -------------------------------------------------------------------------- */
/* Cell                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A single heatmap cell. Meaning is carried three ways so it is never
 * colour-only (INV-5 / WCAG 1.4.1): a band WORD (short code, expanded in the
 * accessible name), a five-step FILL bar (ordinal position), and a tint. A
 * withheld cell is an explicit reliability note, never a guessed band.
 */
function HeatCell({
  cell,
  learner,
  domainName,
  active,
  onDrill,
}: {
  cell: HeatmapCell;
  learner: CohortLearner;
  domainName: string;
  active: boolean;
  onDrill: () => void;
}) {
  const { t } = useTranslation();
  const bandWord = t(`bands.${cell.band}`);

  if (cell.band === "withheld") {
    return (
      <td className="p-1">
        <button
          type="button"
          onClick={onDrill}
          aria-pressed={active}
          aria-label={t("institution.heatmap.cellWithheldAria", {
            learner: learner.handle,
            domain: domainName,
          })}
          className={cn(
            "flex h-full min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border bg-bg-subtle px-1 py-1.5 text-center",
            "transition-shadow duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand hover:shadow-soft-md",
            active && "ring-2 ring-brand ring-offset-1 ring-offset-surface",
          )}
        >
          <Lock weight="bold" className="h-3 w-3 text-muted" aria-hidden />
          <span className="text-[10px] font-medium leading-tight text-muted">
            {bandWord}
          </span>
        </button>
      </td>
    );
  }

  const rank = BAND_RANK[cell.band];
  const tint = BAND_CELL_TINT[cell.band as Exclude<Band, "withheld">];
  const text = BAND_CELL_TEXT[cell.band as Exclude<Band, "withheld">];

  return (
    <td className="p-1">
      <button
        type="button"
        onClick={onDrill}
        aria-pressed={active}
        aria-label={t("institution.heatmap.cellAria", {
          learner: learner.handle,
          domain: domainName,
          band: bandWord,
          count: cell.encounters,
        })}
        className={cn(
          "group flex h-full min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control px-1 py-1.5",
          "border border-border/70 transition-shadow duration-200 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand hover:shadow-soft-md",
          active && "ring-2 ring-brand ring-offset-1 ring-offset-surface",
        )}
        style={{ backgroundColor: tint, color: text }}
      >
        <span className="font-mono text-xs font-semibold leading-none">
          {bandCode(cell.band)}
        </span>
        {/* Ordinal fill bar — the shape/position channel (not colour-only) */}
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((step) => (
            <span
              key={step}
              className="w-[3px] rounded-full"
              style={{
                height: `${6 + step * 2}px`,
                backgroundColor:
                  step <= rank
                    ? "currentColor"
                    : "color-mix(in srgb, currentColor 22%, transparent)",
              }}
            />
          ))}
        </span>
      </button>
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Matrix (visual heatmap)                                                     */
/* -------------------------------------------------------------------------- */

function MatrixView({
  drill,
  onDrill,
}: {
  drill: DrillTarget | null;
  onDrill: (learner: CohortLearner, domain: FeedbackDomainKey) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label={t("institution.heatmap.matrixLabel")}
      tabIndex={0}
    >
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">
          {t("institution.heatmap.tableCaption")}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[9.5rem] bg-surface px-2 pb-2 text-left align-bottom"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t("institution.heatmap.learnerCol")}
              </span>
            </th>
            {HEATMAP_DOMAINS.map((d) => (
              <th
                key={d.key}
                scope="col"
                className="px-1 pb-2 text-center align-bottom"
              >
                <span className="mx-auto flex flex-col items-center gap-1">
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 shrink-0",
                      d.axis === "clinical" ? "rotate-45" : "rounded-full",
                    )}
                    style={{
                      backgroundColor:
                        d.axis === "clinical"
                          ? "var(--axis-clinical)"
                          : "var(--axis-communication)",
                    }}
                  />
                  <span className="text-[11px] font-medium leading-tight text-fg">
                    {t(`feedback.domains.${d.key}`)}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohortLearners.map((learner) => {
            const rowActive = drill?.learner.id === learner.id;
            return (
              <tr key={learner.id} className="group/row">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[9.5rem] bg-surface py-1 pr-2 text-left"
                >
                  <button
                    type="button"
                    onClick={() => onDrill(learner, weakestDomain(learner))}
                    aria-pressed={rowActive}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      rowActive && "bg-bg-subtle",
                    )}
                    aria-label={t("institution.heatmap.drillLearnerAria", {
                      learner: learner.handle,
                    })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-semibold text-fg">
                        {learner.handle}
                      </span>
                      <span className="block text-[10px] text-muted">
                        {t(`institution.section.${learner.sectionKey}`)}
                        {" · "}
                        {learner.locale.toUpperCase()}
                      </span>
                    </span>
                    {learner.atRisk ? (
                      <span
                        className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--state-warning)]"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--state-warning) 16%, transparent)",
                        }}
                      >
                        {t("institution.heatmap.atRiskTag")}
                      </span>
                    ) : null}
                    <CaretRight
                      weight="bold"
                      className="h-3.5 w-3.5 shrink-0 text-muted"
                      aria-hidden
                    />
                  </button>
                </th>
                {HEATMAP_DOMAINS.map((d) => (
                  <HeatCell
                    key={d.key}
                    cell={learner.cells[d.key]}
                    learner={learner}
                    domainName={t(`feedback.domains.${d.key}`)}
                    active={rowActive && drill?.domain === d.key}
                    onDrill={() => onDrill(learner, d.key)}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table equivalent (the non-graphical alternative, always available)         */
/* -------------------------------------------------------------------------- */

/** A band rendered as a compact swatch + word, so meaning is never colour-only. */
function BandTag({ band, label }: { band: Band; label: string }) {
  if (band === "withheld") {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
        <span
          className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border border-dashed border-border"
          aria-hidden
        >
          <Lock weight="bold" className="h-2.5 w-2.5 text-muted" />
        </span>
        {label}
      </span>
    );
  }
  const b = band as Exclude<Band, "withheld">;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-fg">
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border border-border/70 font-mono text-[9px] font-semibold"
        style={{ backgroundColor: BAND_CELL_TINT[b], color: BAND_CELL_TEXT[b] }}
        aria-hidden
      >
        {bandCode(b)}
      </span>
      {label}
    </span>
  );
}

function TableView() {
  const { t } = useTranslation();
  return (
    <TableWrap>
      <Table>
        <caption className="sr-only">
          {t("institution.heatmap.tableEquivCaption")}
        </caption>
        <THead>
          <Tr>
            <Th>{t("institution.heatmap.learnerCol")}</Th>
            <Th>{t("institution.heatmap.sectionCol")}</Th>
            {HEATMAP_DOMAINS.map((d) => (
              <Th key={d.key}>{t(`feedback.domains.${d.key}`)}</Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {cohortLearners.map((learner) => (
            <Tr key={learner.id}>
              <Td>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-fg">
                    {learner.handle}
                  </span>
                  {learner.atRisk ? (
                    <Badge tone="warning" dot>
                      {t("institution.heatmap.atRiskTag")}
                    </Badge>
                  ) : null}
                </span>
              </Td>
              <Td className="whitespace-nowrap text-xs text-muted">
                {t(`institution.section.${learner.sectionKey}`)}
                {" · "}
                {learner.locale.toUpperCase()}
              </Td>
              {HEATMAP_DOMAINS.map((d) => {
                const cell = learner.cells[d.key];
                return (
                  <Td key={d.key}>
                    <BandTag
                      band={cell.band}
                      label={t(`bands.${cell.band}`)}
                    />
                  </Td>
                );
              })}
            </Tr>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                      */
/* -------------------------------------------------------------------------- */

function Legend() {
  const { t } = useTranslation();
  const bands: Exclude<Band, "withheld">[] = [
    "emerging",
    "developing",
    "proficient",
    "strong",
    "exemplary",
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {bands.map((b) => (
        <li key={b} className="inline-flex items-center gap-1.5">
          <span
            className="grid h-4 w-4 place-items-center rounded-[5px] border border-border/70 font-mono text-[9px] font-semibold"
            style={{
              backgroundColor: BAND_CELL_TINT[b],
              color: BAND_CELL_TEXT[b],
            }}
            aria-hidden
          >
            {bandCode(b)}
          </span>
          <span className="text-[11px] text-muted">{t(`bands.${b}`)}</span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span
          className="grid h-4 w-4 place-items-center rounded-[5px] border border-dashed border-border"
          aria-hidden
        >
          <Lock weight="bold" className="h-2.5 w-2.5 text-muted" />
        </span>
        <span className="text-[11px] text-muted">{t("bands.withheld")}</span>
      </li>
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Drill-down panel (cohort -> section -> learner -> domain -> evidence span)  */
/* -------------------------------------------------------------------------- */

function DrillPanel({
  drill,
  onSelectDomain,
  onClose,
}: {
  drill: DrillTarget;
  onSelectDomain: (domain: FeedbackDomainKey) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const reveal = useReveal();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const { learner, domain } = drill;
  const datum = drillDatum(learner, domain);
  const domainName = t(`feedback.domains.${domain}`);
  const bandWord = t(`bands.${datum.band}`);
  const acgmeTag = FRAMEWORK_DOMAIN_TAG.acgme[domain];

  // Move focus to the panel heading when a new learner is opened, so keyboard
  // and screen-reader users land on the detail. Domain switches are announced
  // by the aria-live body rather than stealing focus each time.
  useEffect(() => {
    headingRef.current?.focus();
  }, [learner.id]);

  return (
    <motion.div
      {...reveal}
      role="region"
      aria-label={t("institution.heatmap.drill.regionLabel", {
        learner: learner.handle,
      })}
      className="mt-3 flex flex-col gap-3 rounded-control border border-border bg-bg-subtle p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <h4
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-semibold text-fg outline-none"
          >
            {t("institution.heatmap.drillTitle", { learner: learner.handle })}
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={t("institution.heatmap.drill.closeAria", {
            learner: learner.handle,
          })}
        >
          <X weight="bold" className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Breadcrumb path (cohort -> section -> learner -> domain) */}
      <p className="text-[11px] text-muted">
        {t("institution.heatmap.drill.path", {
          section: t(`institution.section.${learner.sectionKey}`),
          learner: learner.handle,
          domain: domainName,
        })}
      </p>

      {/* Domain selector — switch which domain's evidence you inspect */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("institution.heatmap.drill.domainSwitchLabel")}
        </p>
        <div
          role="group"
          aria-label={t("institution.heatmap.drill.domainSwitchLabel")}
          className="flex flex-wrap gap-1.5"
        >
          {HEATMAP_DOMAINS.map((d) => {
            const selected = d.key === domain;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onSelectDomain(d.key)}
                aria-pressed={selected}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  selected
                    ? "border-brand bg-brand-tint text-brand"
                    : "border-border bg-surface text-muted hover:text-fg",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2 w-2 shrink-0",
                    d.axis === "clinical" ? "rotate-45" : "rounded-full",
                  )}
                  style={{
                    backgroundColor:
                      d.axis === "clinical"
                        ? "var(--axis-clinical)"
                        : "var(--axis-communication)",
                  }}
                />
                {t(`feedback.domains.${d.key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Band + evidence — the live-updating detail for the selected domain */}
      <div aria-live="polite" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{domainName}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            {t("institution.heatmap.drill.bandLabel")}: {bandWord}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            {t("institution.heatmap.drill.encountersLabel", {
              count: datum.encounters,
            })}
          </span>
          <Tooltip
            content={t("institution.heatmap.drill.crosswalkTip", {
              tag: acgmeTag,
            })}
          >
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] font-medium text-muted">
              {t("institution.heatmap.drill.crosswalkChip", { tag: acgmeTag })}
            </span>
          </Tooltip>
        </div>

        {datum.evidence ? (
          <>
            <figure className="rounded-control border-l-2 border-brand bg-surface px-3 py-2">
              <blockquote
                className="text-sm italic text-fg"
                lang={learner.locale}
              >
                {"“"}
                {datum.evidence.quote[learner.locale]}
                {"”"}
              </blockquote>
              <figcaption className="mt-1 text-[11px] text-muted">
                {t("institution.heatmap.drill.evidenceLangNote", {
                  lang: learner.locale.toUpperCase(),
                })}
              </figcaption>
            </figure>
            <div className="rounded-control bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t("institution.heatmap.drill.takeHeading")}
              </p>
              <p className="mt-1 text-sm text-fg">
                {datum.evidence.take[lang]}
              </p>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-control border border-dashed border-border bg-surface px-3 py-2.5">
            <Lock
              weight="bold"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
              aria-hidden
            />
            <div>
              <p className="text-sm font-semibold text-fg">
                {t("institution.heatmap.drill.withheldHeading")}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t("institution.heatmap.drill.withheldBody", {
                  count: datum.encounters,
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

/** CohortHeatmap — learners x 6 domains, accessible band cells, table twin, drill-down (IN-1). */
export function CohortHeatmap() {
  const { t } = useTranslation();
  const [view, setView] = useState<"matrix" | "table">("matrix");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const headingId = useId();

  function openDrill(learner: CohortLearner, domain: FeedbackDomainKey) {
    setDrill((prev) =>
      prev && prev.learner.id === learner.id && prev.domain === domain
        ? null // toggle the same cell closed
        : { learner, domain },
    );
  }

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id={headingId}
            className="text-lg font-semibold tracking-tight text-fg"
          >
            {t("institution.heatmap.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("institution.heatmap.subtitle")}
          </p>
        </div>
        <div
          role="group"
          aria-label={t("institution.heatmap.viewToggleLabel")}
          className="inline-flex shrink-0 items-center rounded-control border border-border bg-bg-subtle p-0.5"
        >
          <button
            type="button"
            onClick={() => setView("matrix")}
            aria-pressed={view === "matrix"}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-3 text-xs font-semibold transition-colors focus-visible:outline-none",
              view === "matrix"
                ? "bg-surface text-fg shadow-soft"
                : "text-muted hover:text-fg",
            )}
          >
            <GridFour weight="bold" className="h-4 w-4" aria-hidden />
            {t("institution.heatmap.viewMatrix")}
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-3 text-xs font-semibold transition-colors focus-visible:outline-none",
              view === "table"
                ? "bg-surface text-fg shadow-soft"
                : "text-muted hover:text-fg",
            )}
          >
            <TableIcon weight="bold" className="h-4 w-4" aria-hidden />
            {t("actions.viewAsTable")}
          </button>
        </div>
      </div>

      {/* Role-gated note: dean sees aggregate + drill to evidence, never private ego-data */}
      <div className="flex items-start gap-2 rounded-control bg-bg-subtle px-3 py-2">
        <Lock
          weight="bold"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
          aria-hidden
        />
        <p className="text-xs text-muted">
          {t("institution.heatmap.roleGatedNote")}
        </p>
      </div>

      {view === "matrix" ? (
        <>
          <MatrixView drill={drill} onDrill={openDrill} />
          <Legend />
          {drill ? (
            <DrillPanel
              drill={drill}
              onSelectDomain={(domain) =>
                setDrill((prev) =>
                  prev ? { learner: prev.learner, domain } : prev,
                )
              }
              onClose={() => setDrill(null)}
            />
          ) : (
            <p className="text-xs text-muted">
              {t("institution.heatmap.drill.openHint")}
            </p>
          )}
        </>
      ) : (
        <TableView />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={t("institution.heatmap.frameworkTip")}>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted">
            {t("institution.heatmap.frameworkChip")}
          </span>
        </Tooltip>
        <Button size="sm" variant="secondary">
          {t("institution.heatmap.switchFramework")}
        </Button>
      </div>
    </Card>
  );
}

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GridFour,
  Table as TableIcon,
  Lock,
  CaretRight,
  Info,
} from "@phosphor-icons/react";
import { Card, Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/useLang";
import {
  cohortLearners,
  HEATMAP_DOMAINS,
  type CohortLearner,
  type HeatmapCell,
} from "@/data/institution";
import type { Band } from "@/data/mock";
import {
  BAND_RANK,
  BAND_CELL_TINT,
  BAND_CELL_TEXT,
  bandCode,
} from "./bandMeta";

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
  onDrill,
}: {
  cell: HeatmapCell;
  learner: CohortLearner;
  domainName: string;
  onDrill: () => void;
}) {
  const { t } = useTranslation();
  const bandWord = t(`bands.${cell.band}`);

  if (cell.band === "withheld") {
    return (
      <td className="p-1">
        <div
          className="flex h-full min-h-14 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border bg-bg-subtle px-1 py-1.5 text-center"
          aria-label={t("institution.heatmap.cellWithheldAria", {
            learner: learner.handle,
            domain: domainName,
          })}
        >
          <Lock
            weight="bold"
            className="h-3 w-3 text-muted"
            aria-hidden
          />
          <span className="text-[10px] font-medium leading-tight text-muted">
            {bandWord}
          </span>
        </div>
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
        )}
        style={{ backgroundColor: tint, color: text }}
      >
        <span className="font-mono text-xs font-semibold leading-none">
          {bandCode(cell.band)}
        </span>
        {/* Ordinal fill bar — the shape/position channel (not colour-only) */}
        <span
          className="flex items-end gap-[2px]"
          aria-hidden
        >
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
  onDrill,
}: {
  onDrill: (learner: CohortLearner) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto" role="region" aria-label={t("institution.heatmap.matrixLabel")} tabIndex={0}>
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{t("institution.heatmap.tableCaption")}</caption>
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
          {cohortLearners.map((learner) => (
            <tr key={learner.id} className="group/row">
              <th
                scope="row"
                className="sticky left-0 z-10 min-w-[9.5rem] bg-surface py-1 pr-2 text-left"
              >
                <button
                  type="button"
                  onClick={() => onDrill(learner)}
                  className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                  onDrill={() => onDrill(learner)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table equivalent (the non-graphical alternative, always available)         */
/* -------------------------------------------------------------------------- */

function TableView() {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          {t("institution.heatmap.tableEquivCaption")}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-3 font-semibold text-fg">
              {t("institution.heatmap.learnerCol")}
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold text-fg">
              {t("institution.heatmap.sectionCol")}
            </th>
            {HEATMAP_DOMAINS.map((d) => (
              <th
                key={d.key}
                scope="col"
                className="py-2 pr-3 font-semibold text-fg"
              >
                {t(`feedback.domains.${d.key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohortLearners.map((learner) => (
            <tr key={learner.id} className="border-b border-border/60">
              <th scope="row" className="py-2 pr-3 font-mono text-xs font-medium text-fg">
                {learner.handle}
                {learner.atRisk ? (
                  <span className="ml-1.5 text-[color:var(--state-warning)]">
                    ({t("institution.heatmap.atRiskTag")})
                  </span>
                ) : null}
              </th>
              <td className="py-2 pr-3 text-xs text-muted">
                {t(`institution.section.${learner.sectionKey}`)}
                {" · "}
                {learner.locale.toUpperCase()}
              </td>
              {HEATMAP_DOMAINS.map((d) => {
                const cell = learner.cells[d.key];
                return (
                  <td key={d.key} className="py-2 pr-3 text-xs text-fg">
                    {t(`bands.${cell.band}`)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
/* Drill-down callout (cohort -> learner -> evidence span)                     */
/* -------------------------------------------------------------------------- */

function DrillCallout({ learner }: { learner: CohortLearner }) {
  const { t } = useTranslation();
  const lang = useLang();
  // The widest gap for this learner drives the illustrative evidence span.
  const weakest = HEATMAP_DOMAINS.map((d) => ({
    key: d.key,
    rank: BAND_RANK[learner.cells[d.key].band],
  }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank)[0];

  const evidenceQuote =
    lang === "tr"
      ? "\"Göğüs ağrısı iki saat önce başladı, sanırım kas ağrısı, EKG'ye gerek yok.\""
      : "\"The chest pain started two hours ago, I think it is muscular, no need for an ECG.\"";

  return (
    <div
      role="status"
      className="mt-3 flex flex-col gap-2.5 rounded-control border border-border bg-bg-subtle p-4"
    >
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        <p className="text-sm font-semibold text-fg">
          {t("institution.heatmap.drillTitle", { learner: learner.handle })}
        </p>
      </div>
      <p className="text-xs text-muted">
        {t("institution.heatmap.drillPath", {
          domain: weakest ? t(`feedback.domains.${weakest.key}`) : "—",
        })}
      </p>
      <figure className="rounded-control border-l-2 border-brand bg-surface px-3 py-2">
        <blockquote className="text-sm italic text-fg">{evidenceQuote}</blockquote>
        <figcaption className="mt-1 text-[11px] text-muted">
          {t("institution.heatmap.evidenceCaption")}
        </figcaption>
      </figure>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

/** CohortHeatmap — learners x 6 domains, accessible band cells, table twin, drill-down (IN-1). */
export function CohortHeatmap() {
  const { t } = useTranslation();
  const [view, setView] = useState<"matrix" | "table">("matrix");
  const [drilled, setDrilled] = useState<CohortLearner | null>(null);
  const headingId = useId();

  return (
    <Card padding="lg" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-lg font-semibold tracking-tight text-fg">
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
        <Lock weight="bold" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <p className="text-xs text-muted">{t("institution.heatmap.roleGatedNote")}</p>
      </div>

      {view === "matrix" ? (
        <>
          <MatrixView onDrill={setDrilled} />
          <Legend />
          {drilled ? <DrillCallout learner={drilled} /> : null}
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

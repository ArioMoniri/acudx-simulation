import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  GridFour,
  Table as TableIcon,
  Lock,
  CaretRight,
  Info,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  Card,
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
import { useProgressRecords } from "@/state/progressStore";
import {
  deriveEncounterRows,
  HEATMAP_DOMAINS,
  FRAMEWORK_DOMAIN_TAG,
  type EncounterRow,
  type DomainReadout,
} from "@/data/institution";
import type { Band, FeedbackDomainKey } from "@/data/mock";
import {
  BAND_RANK,
  BAND_CELL_TINT,
  BAND_CELL_TEXT,
  bandCode,
} from "./bandMeta";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

interface DrillTarget {
  row: EncounterRow;
  domain: FeedbackDomainKey;
}

/** The encounter's widest gap (lowest reliable band), the default drill domain. */
function weakestDomain(row: EncounterRow): FeedbackDomainKey {
  const ranked = HEATMAP_DOMAINS.map((d) => ({
    key: d.key,
    rank: BAND_RANK[row.readouts[d.key].band],
  }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  return ranked[0]?.key ?? HEATMAP_DOMAINS[0].key;
}

function shortDate(at: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === "tr" ? "tr" : "en", {
      day: "numeric",
      month: "short",
    }).format(new Date(at));
  } catch {
    return "";
  }
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
  readout,
  encounterHandle,
  domainName,
  active,
  onDrill,
}: {
  readout: DomainReadout;
  encounterHandle: string;
  domainName: string;
  active: boolean;
  onDrill: () => void;
}) {
  const { t } = useTranslation();
  const bandWord = t(`bands.${readout.band}`);

  if (readout.band === "withheld") {
    return (
      <td className="p-1">
        <button
          type="button"
          onClick={onDrill}
          aria-pressed={active}
          aria-label={t("institution.heatmap.cellWithheldAria", {
            learner: encounterHandle,
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

  const rank = BAND_RANK[readout.band];
  const tint = BAND_CELL_TINT[readout.band as Exclude<Band, "withheld">];
  const text = BAND_CELL_TEXT[readout.band as Exclude<Band, "withheld">];

  return (
    <td className="p-1">
      <button
        type="button"
        onClick={onDrill}
        aria-pressed={active}
        aria-label={t("institution.heatmap.cellReadoutAria", {
          learner: encounterHandle,
          domain: domainName,
          band: bandWord,
          defaultValue: "{{learner}}, {{domain}}: {{band}}. Activate to inspect.",
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
          {bandCode(readout.band)}
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
  rows,
  drill,
  onDrill,
}: {
  rows: EncounterRow[];
  drill: DrillTarget | null;
  onDrill: (row: EncounterRow, domain: FeedbackDomainKey) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();

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
              className="sticky left-0 z-10 min-w-[10.5rem] bg-surface px-2 pb-2 text-left align-bottom"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t("institution.heatmap.encounterCol", {
                  defaultValue: "Encounter",
                })}
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
          {rows.map((row) => {
            const rowActive = drill?.row.id === row.id;
            return (
              <tr key={row.id} className="group/row">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[10.5rem] bg-surface py-1 pr-2 text-left"
                >
                  <button
                    type="button"
                    onClick={() => onDrill(row, weakestDomain(row))}
                    aria-pressed={rowActive}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      rowActive && "bg-bg-subtle",
                    )}
                    aria-label={t("institution.heatmap.drillLearnerAria", {
                      learner: row.handle,
                    })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-fg">
                        {row.title[lang]}
                      </span>
                      <span className="block font-mono text-[10px] text-muted">
                        {row.handle}
                        {" · "}
                        {shortDate(row.at, lang)}
                      </span>
                    </span>
                    {row.safetyMiss ? (
                      <span
                        className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--state-warning)]"
                        style={{
                          backgroundColor:
                            "color-mix(in srgb, var(--state-warning) 16%, transparent)",
                        }}
                      >
                        {t("institution.heatmap.safetyTag", {
                          defaultValue: "Safety",
                        })}
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
                    readout={row.readouts[d.key]}
                    encounterHandle={row.handle}
                    domainName={t(`feedback.domains.${d.key}`)}
                    active={rowActive && drill?.domain === d.key}
                    onDrill={() => onDrill(row, d.key)}
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

function TableView({ rows }: { rows: EncounterRow[] }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <TableWrap>
      <Table>
        <caption className="sr-only">
          {t("institution.heatmap.tableEquivCaption")}
        </caption>
        <THead>
          <Tr>
            <Th>
              {t("institution.heatmap.encounterCol", {
                defaultValue: "Encounter",
              })}
            </Th>
            <Th>
              {t("institution.heatmap.dateCol", { defaultValue: "Recorded" })}
            </Th>
            {HEATMAP_DOMAINS.map((d) => (
              <Th key={d.key}>{t(`feedback.domains.${d.key}`)}</Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td>
                <span className="flex items-center gap-2">
                  <span className="max-w-[12rem] truncate text-xs font-semibold text-fg">
                    {row.title[lang]}
                  </span>
                  {row.safetyMiss ? (
                    <Badge tone="warning" dot>
                      {t("institution.heatmap.safetyTag", {
                        defaultValue: "Safety",
                      })}
                    </Badge>
                  ) : null}
                </span>
              </Td>
              <Td className="whitespace-nowrap text-xs text-muted">
                {shortDate(row.at, lang)}
              </Td>
              {HEATMAP_DOMAINS.map((d) => (
                <Td key={d.key}>
                  <BandTag
                    band={row.readouts[d.key].band}
                    label={t(`bands.${row.readouts[d.key].band}`)}
                  />
                </Td>
              ))}
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
/* Drill-down panel — real per-domain readout for one recorded encounter       */
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

  const { row, domain } = drill;
  const readout = row.readouts[domain];
  const domainName = t(`feedback.domains.${domain}`);
  const bandWord = t(`bands.${readout.band}`);
  const acgmeTag = FRAMEWORK_DOMAIN_TAG.acgme[domain];

  useEffect(() => {
    headingRef.current?.focus();
  }, [row.id]);

  return (
    <motion.div
      {...reveal}
      role="region"
      aria-label={t("institution.heatmap.drill.regionLabel", {
        learner: row.handle,
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
            {t("institution.heatmap.drillTitle", { learner: row.handle })}
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          aria-label={t("institution.heatmap.drill.closeAria", {
            learner: row.handle,
          })}
        >
          <X weight="bold" className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Breadcrumb: encounter title + date */}
      <p className="text-[11px] text-muted">
        {row.title[lang]}
        {" · "}
        {shortDate(row.at, lang)}
      </p>

      {/* Domain selector */}
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

      {/* Band + real readout for the selected domain */}
      <div aria-live="polite" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{domainName}</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            {t("institution.heatmap.drill.bandLabel")}: {bandWord}
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

        {readout.scored ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-control bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t("institution.heatmap.drill.competence", {
                  defaultValue: "Measured competence",
                })}
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-fg">
                {Math.round(readout.competence * 100)}%
              </p>
            </div>
            <div className="rounded-control bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {t("institution.heatmap.drill.confidence", {
                  defaultValue: "Decisiveness",
                })}
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-fg">
                {Math.round(readout.confidence * 100)}%
              </p>
            </div>
            {readout.direction ? (
              <div className="rounded-control bg-surface px-3 py-2 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {t("institution.heatmap.drill.calibration", {
                    defaultValue: "Calibration",
                  })}
                </p>
                <p className="mt-1 text-sm text-fg">
                  {t(`institution.calibration.direction.${readout.direction}`)}
                  {readout.gapPp != null ? (
                    <span className="ml-1.5 font-mono text-xs text-muted">
                      ({readout.gapPp > 0 ? "+" : ""}
                      {readout.gapPp} {t("institution.calibration.ppShort")})
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
          </div>
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
                {t("institution.heatmap.drill.withheldReadout", {
                  defaultValue:
                    "This encounter produced too little evidence to score this domain.",
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
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

function EmptyHeatmap() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-control border border-dashed border-border bg-bg-subtle px-4 py-10 text-center">
      <GridFour weight="bold" className="h-6 w-6 text-muted" aria-hidden />
      <p className="text-sm font-semibold text-fg">
        {t("institution.heatmap.empty.title", {
          defaultValue: "No recorded encounters yet",
        })}
      </p>
      <p className="max-w-md text-xs text-muted">
        {t("institution.heatmap.empty.body", {
          defaultValue:
            "Complete an encounter and your competency map fills in from your own earned evidence. Multi-learner cohort analytics need a connected institution data source.",
        })}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

/** CohortHeatmap — the learner's OWN encounters x 6 domains, accessible band cells, table twin, drill-down (IN-1). */
export function CohortHeatmap() {
  const { t } = useTranslation();
  const records = useProgressRecords();
  const rows = deriveEncounterRows(records);
  const [view, setView] = useState<"matrix" | "table">("matrix");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const headingId = useId();

  function openDrill(row: EncounterRow, domain: FeedbackDomainKey) {
    setDrill((prev) =>
      prev && prev.row.id === row.id && prev.domain === domain
        ? null // toggle the same cell closed
        : { row, domain },
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
            {t("institution.heatmap.ownTitle", {
              defaultValue: "Your encounters by domain",
            })}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("institution.heatmap.ownSubtitle", {
              defaultValue:
                "Each recorded encounter, banded across the six competency domains. Bands are reliability-gated; select a row or cell to inspect the real readout.",
            })}
          </p>
        </div>
        {rows.length > 0 ? (
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
        ) : null}
      </div>

      {/* Honest single-user framing */}
      <div className="flex items-start gap-2 rounded-control bg-bg-subtle px-3 py-2">
        <WarningCircle
          weight="bold"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted"
          aria-hidden
        />
        <p className="text-xs text-muted">
          {t("institution.heatmap.singleUserNote", {
            defaultValue:
              "Single-user view: your own recorded encounters on this device. This is not a multi-learner cohort — that needs a connected institution data source.",
          })}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyHeatmap />
      ) : view === "matrix" ? (
        <>
          <MatrixView rows={rows} drill={drill} onDrill={openDrill} />
          <Legend />
          {drill ? (
            <DrillPanel
              drill={drill}
              onSelectDomain={(domain) =>
                setDrill((prev) => (prev ? { row: prev.row, domain } : prev))
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
        <TableView rows={rows} />
      )}
    </Card>
  );
}

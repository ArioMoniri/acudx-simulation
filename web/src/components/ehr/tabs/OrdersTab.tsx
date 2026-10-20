import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Flask,
  Drop,
  Virus,
  Scan,
  Pulse,
  Syringe,
  Timer,
  CheckCircle,
  Plus,
  ArrowClockwise,
  MagnifyingGlass,
  X,
  ClipboardText,
  type Icon,
} from "@phosphor-icons/react";

import { useReveal } from "@/lib/motion";
import {
  Badge,
  Button,
  Card,
  SectionLabel,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextInput,
  Select,
  Table,
  TableWrap,
  THead,
  TBody,
  Tr,
  Th,
  Td,
} from "@/components/ui";
import { orderTiming, serialInfo } from "@/domain/orderCatalog";
import { TREATMENT_CATALOG, type TreatmentOption } from "@/domain/treatments";
import { formularyFor, ROUTE_LABEL, type Route } from "@/domain/formulary";
import type { MedicationAdministrationRecord } from "@/domain/medicationSafety";
import {
  ORDERABLES_BY_GROUP,
  ORDER_GROUPS,
  getOrderableByCode,
  type Orderable,
  type OrderCategory,
} from "@/domain/orderables";
import {
  administerMedication,
  getEncounterClockMs,
  placeOrder,
  useEncounterState,
} from "@/state/encounterStore";
import type { PlacedOrder } from "@/state/encounterStore";
import { minutesOf, pick } from "../labels";
import type { Bilingual, Lang } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";

export interface OrdersTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

const GROUP_ICON: Record<OrderCategory, Icon> = {
  labs: Flask,
  bloodgas: Drop,
  micro: Virus,
  imaging: Scan,
  poc: Pulse,
};

/** Local 1 Hz tick so pending countdowns advance + synthetic orders flip live. */
function useSecondTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/** Realistic turnaround label for an orderable (the "sense of time"). */
function turnaround(o: Orderable, lang: Lang): string {
  const timing = orderTiming(o.code, o.kind === "imaging" ? "imaging" : "laboratory", o.label);
  return pick(timing.clinicalLabel, lang);
}

/**
 * OrdersTab — an Epic/AMBOSS-style order-entry surface (docs §2.2). A searchable,
 * categorised catalog lets the student order ANY lab, blood gas, culture,
 * imaging or point-of-care test — not just the case's expected work-up — each
 * showing its realistic turnaround so cultures visibly take 36–48 h while a POC
 * glucose is minutes. Placing an order schedules a timed result and moves it to
 * the live tracker (countdown → resulted). A Treatments section, grouped by
 * class, administers agents that drive the live vitals course. Indicated vs
 * low-value orders are flagged from the case rubric, but anything is orderable.
 */
export function OrdersTab({ caseInstance, lang }: OrdersTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"diagnostics" | "treatments">("diagnostics");

  const summaryReveal = useReveal();

  // Indicated / low-value flags from the case rubric (ordering stays unlimited).
  const rubric = useMemo(() => {
    const m = new Map<string, "indicated" | "lowValue">();
    for (const w of caseInstance.expectedWorkup) {
      const code = w.code.coding[0]?.code;
      if (!code) continue;
      m.set(code, w.lowValue ? "lowValue" : "indicated");
    }
    return m;
  }, [caseInstance]);

  // The catalog, plus any case-specific lab/imaging codes not already listed so
  // the indicated order is always present and flaggable.
  const groups = useMemo<Record<OrderCategory, Orderable[]>>(() => {
    const out = {
      labs: [...ORDERABLES_BY_GROUP.labs],
      bloodgas: [...ORDERABLES_BY_GROUP.bloodgas],
      micro: [...ORDERABLES_BY_GROUP.micro],
      imaging: [...ORDERABLES_BY_GROUP.imaging],
      poc: [...ORDERABLES_BY_GROUP.poc],
    } satisfies Record<OrderCategory, Orderable[]>;
    for (const w of caseInstance.expectedWorkup) {
      const code = w.code.coding[0]?.code;
      if (!code || getOrderableByCode(code)) continue;
      if (w.kind === "imaging") {
        out.imaging.push({ code, label: w.label, kind: "imaging", category: "imaging" });
      } else if (w.kind === "laboratory") {
        out.labs.push({ code, label: w.label, kind: "laboratory", category: "labs" });
      }
    }
    return out;
  }, [caseInstance]);

  const q = query.trim().toLowerCase();
  const matches = (o: Orderable) =>
    q === "" ||
    o.label.en.toLowerCase().includes(q) ||
    o.label.tr.toLowerCase().includes(q) ||
    o.code.toLowerCase().includes(q);

  const placedCodes = new Set(state.orders.map((o) => o.code));
  const orderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of state.orders) m.set(o.code, (m.get(o.code) ?? 0) + 1);
    return m;
  }, [state.orders]);
  const givenCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const tr of state.treatments) m.set(tr.code, (m.get(tr.code) ?? 0) + 1);
    return m;
  }, [state.treatments]);

  const anyMatch = ORDER_GROUPS.some((g) => groups[g].some(matches));

  const nowMs = getEncounterClockMs(state);
  const isResulted = (o: PlacedOrder) => o.resolved || nowMs >= o.resultsReadyAt;
  const pending = state.orders.filter((o) => !isResulted(o));
  const resulted = state.orders.filter(isResulted);
  useSecondTick(pending.length > 0);

  const treatmentGroups = useMemo(() => groupTreatments(TREATMENT_CATALOG), []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,340px)]">
      {/* Catalog + treatments */}
      <div className="flex min-w-0 flex-col gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList variant="underline">
            <TabsTrigger value="diagnostics">{t("orders2.tab.diagnostics")}</TabsTrigger>
            <TabsTrigger value="treatments">
              {t("orders2.tab.treatments")}
              {state.treatments.length > 0 ? (
                <span className="ms-1.5 rounded-pill bg-brand-tint px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-brand">
                  {state.treatments.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* --- Diagnostics --- */}
          <TabsContent value="diagnostics" className="flex flex-col gap-4">
            {/* Search across every group */}
            <div className="relative">
              <MagnifyingGlass
                weight="bold"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <label htmlFor="order-search" className="sr-only">
                {t("orders2.search.label")}
              </label>
              <TextInput
                id="order-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("orders2.search.placeholder")}
                className="ps-9 pe-9"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("orders2.search.clear")}
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-subtle transition-colors duration-150 hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>

            {!anyMatch ? (
              <div className="rounded-card border border-border bg-surface px-4 py-8 text-center">
                <p className="text-sm text-muted">{t("orders2.search.noMatches")}</p>
              </div>
            ) : null}

            {ORDER_GROUPS.map((group) => {
              const items = groups[group].filter(matches);
              if (items.length === 0) return null;
              const GroupIcon = GROUP_ICON[group];
              return (
                <Card key={group} padding="sm">
                  <SectionLabel
                    icon={<GroupIcon weight="bold" className="h-4 w-4" aria-hidden />}
                    trailing={
                      <span className="font-mono text-[11px] tabular-nums text-subtle">
                        {t("orders2.order.itemsCount", { count: items.length })}
                      </span>
                    }
                    className="mb-2"
                  >
                    {t(`orders2.group.${group}`)}
                  </SectionLabel>
                  <ul className="flex flex-col divide-y divide-border">
                    {items.map((o) => (
                      <OrderRow
                        key={o.code}
                        orderable={o}
                        lang={lang}
                        placed={placedCodes.has(o.code)}
                        count={orderCounts.get(o.code) ?? 0}
                        rubric={rubric.get(o.code)}
                      />
                    ))}
                  </ul>
                </Card>
              );
            })}
          </TabsContent>

          {/* --- Treatments --- */}
          <TabsContent value="treatments" className="flex flex-col gap-4">
            <p className="text-xs text-muted">{t("orders2.treatments.subtitle")}</p>
            {treatmentGroups.map(({ klass, items }) => (
              <Card key={klass.en} padding="sm">
                <SectionLabel
                  icon={<Syringe weight="bold" className="h-4 w-4" aria-hidden />}
                  className="mb-2"
                >
                  {pick(klass, lang)}
                </SectionLabel>
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((tx) => (
                    <TreatmentRow
                      key={tx.code}
                      option={tx}
                      lang={lang}
                      given={givenCounts.get(tx.code) ?? 0}
                      weightKg={caseInstance.patient.weightKg}
                    />
                  ))}
                </ul>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>

      {/* Live order worklist */}
      <motion.aside
        {...summaryReveal}
        className="flex h-max min-w-0 flex-col gap-2 lg:sticky lg:top-[calc(3rem+var(--banner-h,7.5rem))]"
      >
        <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
          <h3 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
            <ClipboardText weight="bold" className="h-4 w-4 text-muted" aria-hidden />
            {t("orders2.tracker.heading")}
          </h3>
          {state.orders.length > 0 ? (
            <p className="font-mono text-[0.6875rem] tabular-nums text-muted">
              {t("orders2.tracker.summary", {
                placed: state.orders.length,
                pending: pending.length,
                resulted: resulted.length,
              })}
            </p>
          ) : null}
        </div>

        {state.orders.length === 0 ? (
          <p className="py-2 text-xs text-muted">{t("orders2.tracker.empty")}</p>
        ) : (
          <TableWrap>
            <Table className="min-w-[300px]">
              <caption className="sr-only">{t("orders2.tracker.heading")}</caption>
              <THead>
                <Tr>
                  <Th>{t("orders2.tracker.orderCol", { defaultValue: "Order" })}</Th>
                  <Th>{t("orders2.tracker.statusCol", { defaultValue: "Status" })}</Th>
                </Tr>
              </THead>
              <TBody>
                {pending.map((o, i) => (
                  <TrackerRow key={`p-${o.code}-${i}`} order={o} lang={lang} nowMs={nowMs} />
                ))}
                {resulted.map((o, i) => (
                  <TrackerRow key={`r-${o.code}-${i}`} order={o} lang={lang} nowMs={nowMs} />
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}

        <p className="text-[0.6875rem] text-muted">{t("orders2.tracker.hint")}</p>
      </motion.aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One catalog order: name, turnaround, indicated/low-value flag, Order button.
 * A serial-capable test (troponin, lactate, gas, POC — see orderCatalog
 * `serialInfo`) stays orderable AFTER it is first placed: it shows a repeat
 * count + realistic cadence hint and a Repeat button, so the learner can trend
 * it and the Results surface renders the serial trend. Non-serial tests keep the
 * single "Ordered" state to discourage duplicate CTs / cultures.
 */
function OrderRow({
  orderable,
  lang,
  placed,
  count,
  rubric,
}: {
  orderable: Orderable;
  lang: Lang;
  placed: boolean;
  count: number;
  rubric?: "indicated" | "lowValue";
}) {
  const { t } = useTranslation();
  const name = pick(orderable.label, lang);
  const eta = turnaround(orderable, lang);
  const serial = serialInfo(orderable.code, orderable.kind === "imaging" ? "imaging" : "laboratory", orderable.label);
  const place = () => placeOrder(orderable.code, { en: orderable.label.en, tr: orderable.label.tr });
  const canRepeat = placed && serial.repeatable;

  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0 text-[0.8125rem] text-fg">{name}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" icon={<Timer weight="bold" className="h-3 w-3" aria-hidden />}>
            {eta}
          </Badge>
          {placed && count > 1 ? (
            <Badge tone="brand" dot aria-label={t("orders2.order.timesOrderedAria", { count, defaultValue: "ordered {{count}} times" })}>
              {t("orders2.order.timesOrdered", { count, defaultValue: "×{{count}}" })}
            </Badge>
          ) : null}
          {placed && serial.repeatable && serial.cadence ? (
            <Badge tone="neutral" variant="outline">
              {pick(serial.cadence, lang)}
            </Badge>
          ) : null}
          {rubric === "indicated" ? (
            <Badge
              tone="normal"
              dot
              aria-label={t("orders2.flag.indicatedAria")}
            >
              {t("orders2.flag.indicated")}
            </Badge>
          ) : null}
          {rubric === "lowValue" ? (
            <Badge
              tone="caution"
              dot
              aria-label={t("orders2.flag.lowValueAria")}
            >
              {t("orders2.flag.lowValue")}
            </Badge>
          ) : null}
        </span>
      </div>
      <Button
        size="sm"
        variant={placed && !canRepeat ? "ghost" : "secondary"}
        disabled={placed && !canRepeat}
        onClick={place}
        leadingIcon={
          canRepeat ? (
            <ArrowClockwise weight="bold" className="h-3.5 w-3.5" aria-hidden />
          ) : placed ? (
            <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Plus weight="bold" className="h-3.5 w-3.5" aria-hidden />
          )
        }
        aria-label={
          canRepeat
            ? t("orders2.order.repeatAria", { name, defaultValue: "Repeat {{name}}" })
            : placed
              ? t("orders2.order.orderedAria", { name })
              : t("orders2.order.placeAria", { name })
        }
        className="shrink-0"
      >
        {canRepeat
          ? t("orders2.order.repeat", { defaultValue: "Repeat" })
          : placed
            ? t("orders2.order.ordered")
            : t("orders2.order.place")}
      </Button>
    </li>
  );
}

/**
 * One treatment: name, default dose + route, and an Administer control that
 * opens a small dose / route / indication form prefilled from the formulary.
 *
 * Review 02 finding 9 (critical): a medication is never given by a bare click.
 * Submitting runs the five-rights + allergy check in the encounter store; the
 * resulting MAR line (given / flagged / blocked) is shown inline so the learner
 * sees WHY an order was refused (documented allergy, dose above the ceiling,
 * missing route) and can practise the nurse's core safety behaviour.
 */
function TreatmentRow({
  option,
  lang,
  given,
  weightKg,
}: {
  option: TreatmentOption;
  lang: Lang;
  given: number;
  weightKg?: number;
}) {
  const { t } = useTranslation();
  const name = pick(option.label, lang);
  const entry = formularyFor(option.code);
  const [open, setOpen] = useState(false);
  const [dose, setDose] = useState<string>(entry ? String(entry.dose.default) : "");
  const [route, setRoute] = useState<Route>(entry?.defaultRoute ?? option.routeCode ?? "IV");
  const [indication, setIndication] = useState<string>(entry ? pick(entry.indication, lang) : "");
  const [last, setLast] = useState<MedicationAdministrationRecord | null>(null);

  const submit = () => {
    const amount = Number(dose);
    const rec = administerMedication(
      {
        drug: option.code,
        dose: amount,
        unit: entry?.dose.unit ?? option.defaultDose?.unit ?? "",
        route,
        frequency: entry ? entry.frequency.en : "",
        indication,
        ...(weightKg != null ? { weightKg } : {}),
      },
      { label: { en: option.label.en, tr: option.label.tr } },
    );
    setLast(rec);
    if (rec && rec.outcome !== "blocked") setOpen(false);
  };

  const unit = entry?.dose.unit ?? option.defaultDose?.unit ?? "";
  const formId = `med-${option.code}`;

  return (
    <li className="flex flex-col gap-2 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 text-[0.8125rem] text-fg">{name}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {option.defaultDose ? (
              <Badge tone="neutral" variant="outline">
                {t("orders2.treatments.dose")}: {option.defaultDose.amount} {option.defaultDose.unit}
              </Badge>
            ) : null}
            {option.route ? (
              <Badge tone="neutral" variant="outline">
                {t("orders2.treatments.route")}: {pick(option.route, lang)}
              </Badge>
            ) : null}
            {entry?.highAlert ? (
              <Badge tone="caution" dot>
                {t("orders2.treatments.highAlert")}
              </Badge>
            ) : null}
            {given > 0 ? (
              <Badge tone="brand" dot>
                {t("orders2.treatments.givenCount", { count: given })}
              </Badge>
            ) : null}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen((o) => !o)}
          leadingIcon={<Syringe weight="bold" className="h-3.5 w-3.5" aria-hidden />}
          aria-label={t("orders2.treatments.administerAria", { name })}
          aria-expanded={open}
          aria-controls={formId}
          className="shrink-0"
        >
          {t("orders2.treatments.administer")}
        </Button>
      </div>

      {open ? (
        <form
          id={formId}
          className="grid gap-2 rounded-control border border-border bg-bg-subtle p-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("orders2.treatments.dose")} ({unit})
            <TextInput
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={dose}
              onChange={(e) => setDose(e.target.value)}
              aria-label={t("orders2.treatments.doseAria", { name, unit })}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("orders2.treatments.route")}
            <Select value={route} onChange={(e) => setRoute(e.target.value as Route)} aria-label={t("orders2.treatments.routeAria", { name })}>
              {(entry?.routes ?? [route]).map((r) => (
                <option key={r} value={r}>
                  {pick(ROUTE_LABEL[r], lang)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t("orders2.treatments.indication")}
            <TextInput value={indication} onChange={(e) => setIndication(e.target.value)} aria-label={t("orders2.treatments.indicationAria", { name })} />
          </label>
          <div className="flex items-end">
            <Button size="sm" type="submit" aria-label={t("orders2.treatments.confirmAria", { name })}>
              {t("orders2.treatments.confirm")}
            </Button>
          </div>
          {entry ? (
            <p className="text-[11px] text-muted sm:col-span-4">
              {t("orders2.treatments.range", { min: entry.dose.min, max: entry.dose.max, unit: entry.dose.unit })}
              {entry.maxPerDay != null ? ` · ${t("orders2.treatments.maxDay", { max: entry.maxPerDay, unit: entry.dose.unit })}` : ""}
              {" · "}
              <a href={entry.sources[0]?.url} target="_blank" rel="noreferrer" className="underline">
                {entry.sources[0]?.title}
              </a>
            </p>
          ) : null}
        </form>
      ) : null}

      {last ? (
        <p
          role="status"
          className={
            last.outcome === "blocked"
              ? "text-xs text-[color:var(--state-critical)]"
              : last.outcome === "flagged"
                ? "text-xs text-[color:var(--state-caution)]"
                : "text-xs text-[color:var(--state-normal)]"
          }
        >
          {t(`orders2.mar.outcome.${last.outcome}`)}
          {last.checks.failures.length > 0
            ? `: ${last.checks.failures.map((f) => t(`orders2.mar.failure.${f.code}`, { defaultValue: f.detail })).join("; ")}`
            : ""}
        </p>
      ) : null}
    </li>
  );
}

/**
 * One worklist row: the order, its status chip (pending with a live
 * progress bar, or resulted), and the turnaround column (clinical ETA, the
 * live countdown while pending, the resulted time once done).
 */
function TrackerRow({
  order,
  lang,
  nowMs,
}: {
  order: PlacedOrder;
  lang: Lang;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const name = lang === "tr" ? order.labelTr : order.labelEn;
  const clinicalEta = lang === "tr" ? order.clinicalLabelTr : order.clinicalLabelEn;
  const done = order.resolved || nowMs >= order.resultsReadyAt;

  const total = Math.max(1, order.resultsReadyAt - order.placedAt);
  const elapsed = Math.min(total, Math.max(0, nowMs - order.placedAt));
  const pct = done ? 100 : Math.round((elapsed / total) * 100);
  const etaSec = Math.max(0, Math.ceil((order.resultsReadyAt - nowMs) / 1000));

  return (
    <Tr>
      <Td className="max-w-[200px]">
        <span className="block truncate font-medium text-fg">{name}</span>
        <span className="block font-mono text-[0.6875rem] text-subtle">
          {t("orders2.tracker.orderedAt", { min: minutesOf(order.placedAt) })}
          {" · "}
          {t("orders2.tracker.eta", { eta: clinicalEta })}
        </span>
      </Td>
      <Td className="w-[7.5rem]">
        {done ? (
          <div className="flex flex-col gap-0.5">
            <StatusDot tone="normal" label={t("orders2.tracker.resultedTag")} size="sm" />
            <span className="font-mono text-[0.6875rem] text-subtle">
              {t("orders2.tracker.resultedAt", { min: minutesOf(nowMs) })}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Badge
              tone="caution"
              icon={<Timer weight="fill" className="h-3 w-3" aria-hidden />}
              className="w-max"
            >
              {t("orders2.tracker.pending")}
            </Badge>
            <div
              className="h-1 w-20 overflow-hidden rounded-chip bg-bg-inset"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={t("orders2.tracker.progressAria", { name })}
            >
              <div
                className="h-full bg-brand motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[0.6875rem] text-subtle" aria-live="off">
              {etaSec > 0 ? t("orders2.tracker.readyIn", { sec: etaSec }) : t("orders2.tracker.readyNow")}
            </span>
          </div>
        )}
      </Td>
    </Tr>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Group the treatment catalog by pharmacologic class, preserving order. */
function groupTreatments(
  catalog: TreatmentOption[],
): Array<{ klass: Bilingual; items: TreatmentOption[] }> {
  const groups: Array<{ klass: Bilingual; items: TreatmentOption[] }> = [];
  const index = new Map<string, number>();
  for (const tx of catalog) {
    const key = tx.klass.en;
    let i = index.get(key);
    if (i === undefined) {
      i = groups.length;
      index.set(key, i);
      groups.push({ klass: tx.klass, items: [] });
    }
    groups[i].items.push(tx);
  }
  return groups;
}

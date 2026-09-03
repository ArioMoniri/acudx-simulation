import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import {
  Flask,
  Broadcast,
  Pill,
  UsersThree,
  Plus,
  Timer,
  CheckCircle,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { useReveal, useStagger } from "@/lib/motion";
import { LOINC, type Coding, type ServiceRequestKind } from "@/domain/fhir";
import { conceptCode, minutesOf, pick } from "../labels";
import {
  getEncounterClockMs,
  placeOrder,
  useEncounterState,
} from "@/state/encounterStore";
import type { PlacedOrder } from "@/state/encounterStore";
import type { Lang, Bilingual } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface OrdersTabProps {
  caseInstance: CaseInstance;
  lang: Lang;
}

type OrderCategory = "laboratory" | "imaging" | "medication" | "consult";

interface Orderable {
  code: string;
  label: Bilingual;
  category: OrderCategory;
}

/* -------------------------------------------------------------------------- */
/* Standard order set (always offered, alongside the case-specific orders)    */
/* -------------------------------------------------------------------------- */

const STANDARD_LABS: { code: Coding; label: Bilingual }[] = [
  { code: LOINC.wbc, label: { en: "Full blood count", tr: "Tam kan sayımı" } },
  { code: LOINC.crp, label: { en: "C-reactive protein", tr: "C-reaktif protein" } },
  { code: LOINC.creatinine, label: { en: "Renal function", tr: "Böbrek fonksiyonu" } },
  { code: LOINC.troponinHs, label: { en: "High-sensitivity troponin", tr: "Yüksek duyarlıklı troponin" } },
  { code: LOINC.dDimer, label: { en: "D-dimer", tr: "D-dimer" } },
  { code: LOINC.lactate, label: { en: "Lactate", tr: "Laktat" } },
];

const STANDARD_IMAGING: { code: string; label: Bilingual }[] = [
  { code: LOINC.ecg12.code, label: { en: "12-lead ECG", tr: "12 derivasyonlu EKG" } },
  { code: "cxr", label: { en: "Chest X-ray", tr: "Akciğer grafisi" } },
];

const STANDARD_MEDS: { code: string; label: Bilingual }[] = [
  { code: "med-aspirin", label: { en: "Aspirin 300 mg PO", tr: "Aspirin 300 mg PO" } },
  { code: "med-analgesia", label: { en: "Analgesia (titrated)", tr: "Analjezi (titre edilerek)" } },
  { code: "med-antiemetic", label: { en: "Antiemetic", tr: "Antiemetik" } },
];

const STANDARD_CONSULTS: { code: string; label: Bilingual }[] = [
  { code: "consult-cardiology", label: { en: "Cardiology consult", tr: "Kardiyoloji konsültasyonu" } },
  { code: "consult-surgery", label: { en: "General surgery consult", tr: "Genel cerrahi konsültasyonu" } },
  { code: "consult-neurology", label: { en: "Neurology consult", tr: "Nöroloji konsültasyonu" } },
];

function kindToCategory(kind: ServiceRequestKind): OrderCategory {
  switch (kind) {
    case "imaging":
      return "imaging";
    case "consult":
      return "consult";
    case "procedure":
      return "medication";
    case "laboratory":
    default:
      return "laboratory";
  }
}

const CATEGORY_META: Record<
  OrderCategory,
  { icon: React.ReactNode; key: string }
> = {
  laboratory: { icon: <Flask weight="bold" className="h-4 w-4" />, key: "labs" },
  imaging: { icon: <Broadcast weight="bold" className="h-4 w-4" />, key: "imaging" },
  medication: { icon: <Pill weight="bold" className="h-4 w-4" />, key: "meds" },
  consult: { icon: <UsersThree weight="bold" className="h-4 w-4" />, key: "consults" },
};

/** Local 1 Hz tick so pending-order countdowns advance between store events. */
function useSecondTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/**
 * OrdersTab — the CPOE (docs §2.2). Categories Labs / Imaging / Meds / Consults;
 * items come from the case's expected workup (so the indicated orders are
 * present) merged with a standard set (so over-ordering is possible and
 * measurable, docs §4). A search box narrows the catalog across categories.
 * placeOrder logs an event and schedules a simulated result; the tracker splits
 * placed orders into in-progress (with a live turnaround countdown driven by the
 * store timer) and resulted, so the pending -> resulted transition is legible.
 */
export function OrdersTab({ caseInstance, lang }: OrdersTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();
  const [query, setQuery] = useState("");

  const summaryReveal = useReveal();

  // Merge case-specific orderables with the standard set (dedupe by code).
  const orderables = useMemo<Orderable[]>(() => {
    const map = new Map<string, Orderable>();

    // Case-specific first (from expected workup + result codes).
    for (const w of caseInstance.expectedWorkup) {
      map.set(conceptCode(w.code), {
        code: conceptCode(w.code),
        label: w.label,
        category: kindToCategory(w.kind),
      });
    }
    for (const im of caseInstance.groundTruth.imaging) {
      if (!map.has(im.orderCode)) {
        map.set(im.orderCode, {
          code: im.orderCode,
          label: im.modality,
          category: "imaging",
        });
      }
    }

    const add = (code: string, label: Bilingual, category: OrderCategory) => {
      if (!map.has(code)) map.set(code, { code, label, category });
    };
    STANDARD_LABS.forEach((o) => add(o.code.code, o.label, "laboratory"));
    STANDARD_IMAGING.forEach((o) => add(o.code, o.label, "imaging"));
    STANDARD_MEDS.forEach((o) => add(o.code, o.label, "medication"));
    STANDARD_CONSULTS.forEach((o) => add(o.code, o.label, "consult"));

    return Array.from(map.values());
  }, [caseInstance]);

  const q = query.trim().toLowerCase();
  const matches = (o: Orderable) =>
    q === "" ||
    pick(o.label, lang).toLowerCase().includes(q) ||
    o.label.en.toLowerCase().includes(q) ||
    o.code.toLowerCase().includes(q);

  const byCategory = (cat: OrderCategory) =>
    orderables.filter((o) => o.category === cat && matches(o));

  const placedCodes = new Set(state.orders.map((o) => o.code));
  const expectedCodes = new Set(
    caseInstance.expectedWorkup
      .filter((w) => !w.lowValue)
      .map((w) => conceptCode(w.code)),
  );

  const categories: OrderCategory[] = [
    "laboratory",
    "imaging",
    "medication",
    "consult",
  ];

  const anyMatch = categories.some((cat) => byCategory(cat).length > 0);

  const pending = state.orders.filter((o) => !o.resolved);
  const resulted = state.orders.filter((o) => o.resolved);
  useSecondTick(pending.length > 0);
  const nowMs = getEncounterClockMs(state);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,320px)]">
      {/* Order catalog */}
      <div className="flex flex-col gap-4">
        {/* Search across every category */}
        <div className="relative">
          <MagnifyingGlass
            weight="bold"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <label htmlFor="order-search" className="sr-only">
            {t("ehr2.orders.searchLabel")}
          </label>
          <input
            id="order-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("ehr2.orders.searchPlaceholder")}
            className="w-full rounded-control border border-border bg-surface py-2 pl-9 pr-9 text-sm text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors duration-200 ease-out hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              aria-label={t("ehr2.orders.clearSearch")}
            >
              <X weight="bold" className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {!anyMatch ? (
          <div className="rounded-card border border-dashed border-border bg-bg-subtle px-4 py-8 text-center">
            <p className="text-sm text-muted">{t("ehr2.orders.noMatches")}</p>
          </div>
        ) : null}

        {categories.map((cat) => {
          const items = byCategory(cat);
          if (items.length === 0) return null;
          const meta = CATEGORY_META[cat];
          const placedInCat = items.filter((o) => placedCodes.has(o.code)).length;
          return (
            <section
              key={cat}
              className="rounded-card border border-border bg-surface p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <span aria-hidden className="text-muted">
                    {meta.icon}
                  </span>
                  {t(`ehr.orders.category.${meta.key}`)}
                </h3>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {placedInCat > 0
                    ? `${placedInCat}/${items.length}`
                    : t("ehr2.orders.itemsCount", { count: items.length })}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {items.map((o) => {
                  const placed = placedCodes.has(o.code);
                  return (
                    <li
                      key={o.code}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="min-w-0 text-sm text-fg">
                        {pick(o.label, lang)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          placeOrder(o.code, { en: o.label.en, tr: o.label.tr })
                        }
                        disabled={placed}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                          "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
                          placed
                            ? "cursor-default border-transparent bg-bg-subtle text-muted"
                            : "border-border bg-surface text-brand hover:bg-brand-tint",
                        )}
                        aria-label={
                          placed
                            ? t("ehr.orders.ordered", { name: pick(o.label, lang) })
                            : t("ehr.orders.place", { name: pick(o.label, lang) })
                        }
                      >
                        {placed ? (
                          <>
                            <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
                            {t("ehr.orders.orderedShort")}
                          </>
                        ) : (
                          <>
                            <Plus weight="bold" className="h-3.5 w-3.5" aria-hidden />
                            {t("ehr.orders.order")}
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Placed orders tracker (in progress / resulted) */}
      <motion.aside
        {...summaryReveal}
        className="flex h-max flex-col gap-3 rounded-card border border-border bg-surface p-3"
      >
        <div>
          <h3 className="text-sm font-semibold text-fg">
            {t("ehr.orders.placedHeading")}
          </h3>
          {state.orders.length > 0 ? (
            <p className="mt-0.5 text-[11px] text-muted">
              {t("ehr2.orders.summary", {
                placed: state.orders.length,
                pending: pending.length,
                resulted: resulted.length,
              })}
            </p>
          ) : null}
        </div>

        {state.orders.length === 0 ? (
          <p className="text-xs italic text-muted">
            {t("ehr.orders.placedEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.length > 0 ? (
              <PlacedGroup
                heading={t("ehr2.orders.inProgressHeading")}
                orders={pending}
                lang={lang}
                nowMs={nowMs}
              />
            ) : null}
            {resulted.length > 0 ? (
              <PlacedGroup
                heading={t("ehr2.orders.resultedHeading")}
                orders={resulted}
                lang={lang}
                nowMs={nowMs}
              />
            ) : null}
          </div>
        )}

        <p className="mt-1 border-t border-border pt-3 text-[11px] text-muted">
          {t("ehr2.orders.resultsHint")}
        </p>
      </motion.aside>

      {/* sr-only appropriateness note for the expected set */}
      <span className="sr-only">
        {t("ehr.orders.expectedNote", { count: expectedCodes.size })}
      </span>
    </div>
  );
}

/** A titled group of placed orders (either all pending or all resulted). */
function PlacedGroup({
  heading,
  orders,
  lang,
  nowMs,
}: {
  heading: string;
  orders: PlacedOrder[];
  lang: Lang;
  nowMs: number;
}) {
  const { container, item } = useStagger();
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {heading}
      </h4>
      <motion.ul {...container} className="flex flex-col gap-2">
        {orders.map((o, i) => (
          <motion.li key={`${o.code}-${i}`} {...item}>
            <PlacedOrderRow order={o} lang={lang} nowMs={nowMs} />
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}

/** One placed order: label, status, and a live turnaround bar while pending. */
function PlacedOrderRow({
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

  const total = Math.max(1, order.resultsReadyAt - order.placedAt);
  const elapsed = Math.min(total, Math.max(0, nowMs - order.placedAt));
  const pct = order.resolved ? 100 : Math.round((elapsed / total) * 100);
  const etaSec = Math.max(0, Math.ceil((order.resultsReadyAt - nowMs) / 1000));

  return (
    <div className="rounded-control border border-border bg-bg-subtle px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-fg">{name}</span>
        {order.resolved ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[color:var(--state-normal)]">
            <CheckCircle weight="fill" className="h-3.5 w-3.5" aria-hidden />
            {t("ehr.orders.resulted")}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[color:var(--state-caution)]">
            <Timer weight="bold" className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden />
            {t("ehr.orders.pending")}
          </span>
        )}
      </div>

      {order.resolved ? (
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
          {t("ehr.orders.placedAt", { min: minutesOf(order.placedAt) })}
        </p>
      ) : (
        <>
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={t("ehr2.orders.progressLabel", { name })}
          >
            <div
              className="h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-muted">
            <span>{t("ehr.orders.placedAt", { min: minutesOf(order.placedAt) })}</span>
            <span aria-live="off">
              {etaSec > 0
                ? t("ehr2.orders.readyIn", { sec: etaSec })
                : t("ehr2.orders.readyNow")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Flask,
  Broadcast,
  Pill,
  UsersThree,
  Plus,
  Timer,
  CheckCircle,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { LOINC, type Coding, type ServiceRequestKind } from "@/domain/fhir";
import { conceptCode, minutesOf, pick } from "../labels";
import { placeOrder, useEncounterState } from "@/state/encounterStore";
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

/**
 * OrdersTab — the CPOE (docs §2.2). Categories Labs / Imaging / Meds / Consults;
 * items come from the case's expected workup (so the indicated orders are
 * present) merged with a standard set (so over-ordering is possible and
 * measurable, docs §4). placeOrder logs an event and schedules a simulated
 * result; placed orders show as pending until the store timer resolves them.
 */
export function OrdersTab({ caseInstance, lang }: OrdersTabProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

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

  const byCategory = (cat: OrderCategory) =>
    orderables.filter((o) => o.category === cat);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,300px)]">
      {/* Order catalog */}
      <div className="flex flex-col gap-4">
        {categories.map((cat) => {
          const items = byCategory(cat);
          if (items.length === 0) return null;
          const meta = CATEGORY_META[cat];
          return (
            <section
              key={cat}
              className="rounded-card border border-border bg-surface p-3"
            >
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <span aria-hidden className="text-muted">
                  {meta.icon}
                </span>
                {t(`ehr.orders.category.${meta.key}`)}
              </h3>
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
                          "transition-colors duration-200 ease-out focus-visible:outline-none active:scale-[0.98]",
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

      {/* Placed orders (pending / resulted) */}
      <aside className="rounded-card border border-border bg-surface p-3">
        <h3 className="mb-2 text-sm font-semibold text-fg">
          {t("ehr.orders.placedHeading")}
        </h3>
        {state.orders.length === 0 ? (
          <p className="text-xs italic text-muted">
            {t("ehr.orders.placedEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.orders.map((o, i) => (
              <li
                key={`${o.code}-${i}`}
                className="rounded-control border border-border bg-bg-subtle px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-fg">
                    {lang === "tr" ? o.labelTr : o.labelEn}
                  </span>
                  {o.resolved ? (
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
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">
                  {t("ehr.orders.placedAt", { min: minutesOf(o.placedAt) })}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted">
          {t("ehr.orders.footnote")}
        </p>
      </aside>

      {/* sr-only appropriateness note for the expected set */}
      <span className="sr-only">
        {t("ehr.orders.expectedNote", { count: expectedCodes.size })}
      </span>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardText,
  ChatCircleText,
  ChartLine,
  Flask,
  FileText,
  ListChecks,
  Monitor as MonitorIcon,
  Lightbulb,
  type Icon,
} from "@phosphor-icons/react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ChartReviewTab } from "./tabs/ChartReviewTab";
import { InterviewTab } from "./tabs/InterviewTab";
import { FlowsheetTab } from "./tabs/FlowsheetTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { ResultsTab } from "./tabs/ResultsTab";
import { ProblemListTab } from "./tabs/ProblemListTab";
import { LiveVitalsMonitor, TrendMonitor } from "@/components/monitor";
import { RealtimeGuidance, AttendingTips } from "@/components/guidance";
import { setStage, useEncounterState } from "@/state/encounterStore";
import type { EncounterStage } from "@/state/encounterStore";
import type { Lang } from "@/data/schema";
import type { CaseInstance } from "@/domain/case";

export interface ActivityTabsProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
  guidanceOn: boolean;
  onGuidanceChange: (on: boolean) => void;
  /**
   * Optional controlled active tab. When provided, the parent owns tab state
   * (e.g. the command palette / number hotkeys). Absent → the component stays
   * fully uncontrolled and manages its own tab as before.
   */
  activeTab?: string;
  /**
   * Notified whenever the active tab changes — from a click, a number hotkey,
   * or the store-stage follow-sync. Pair with `activeTab` for a controlled tab.
   */
  onActiveTabChange?: (id: string) => void;
}

type TabKey =
  | "chart-review"
  | "interview"
  | "flowsheets"
  | "monitor"
  | "orders"
  | "results"
  | "guidance"
  | "problem-list";

/** The tab id union, exposed so owners can build navigation without magic strings. */
export type ActivityTabKey = TabKey;

// `stage` is optional: the Monitor and Guidance tabs are always-available views
// that must NOT advance the clinical stage when opened (they are reference
// surfaces, not steps in the workup).
const TABS: { key: TabKey; icon: Icon; stage?: EncounterStage }[] = [
  { key: "chart-review", icon: ClipboardText, stage: "chart-review" },
  { key: "interview", icon: ChatCircleText, stage: "interview" },
  { key: "flowsheets", icon: ChartLine, stage: "results" },
  { key: "monitor", icon: MonitorIcon },
  { key: "orders", icon: Flask, stage: "orders" },
  { key: "results", icon: FileText, stage: "results" },
  { key: "guidance", icon: Lightbulb },
  { key: "problem-list", icon: ListChecks, stage: "assessment" },
];

/**
 * The tab ids in strip order, exposed so owners (the command palette / number
 * hotkeys) can enumerate tabs without re-declaring the list.
 */
export const ACTIVITY_TAB_KEYS: readonly TabKey[] = TABS.map((tab) => tab.key);

/** The i18n key for a tab's label (`ehr.tabs.<camelKey>`), shared with the strip. */
export function activityTabLabelKey(key: string): string {
  return `ehr.tabs.${camel(key)}`;
}

/** Map the store's canonical stage to the tab that best represents it. */
export function stageToTab(stage: EncounterStage): TabKey {
  switch (stage) {
    case "chart-review":
      return "chart-review";
    case "interview":
    case "exam":
      return "interview";
    case "orders":
      return "orders";
    case "results":
      return "results";
    case "assessment":
    case "closed":
      return "problem-list";
    default:
      return "interview";
  }
}

/**
 * ActivityTabs — the core EHR navigation the student is being taught (docs §2.2).
 * Radix Tabs give roving-tabindex keyboard support and aria-selected out of the
 * box; we add aria-current on the active trigger and a badge count so the tabs
 * read as the chart's primary nav. Switching a tab advances the store stage,
 * which also drives ProgressStages.
 */
export function ActivityTabs({
  caseInstance,
  lang,
  affectLabel,
  guidanceOn,
  onGuidanceChange,
  activeTab: controlledTab,
  onActiveTabChange,
}: ActivityTabsProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

  // The active tab is student-controlled (so any tab is clickable), seeded from
  // the store stage on mount. When the parent passes `activeTab` the component
  // is controlled and defers to that value; otherwise it owns local state — the
  // original, uncontrolled behavior. It is kept in sync two ways:
  //  - the student clicking a tab sets it and advances the store stage;
  //  - an action that moves the store stage on its own (e.g. a result returns)
  //    follows along, without trapping the student on a tab they left.
  const [uncontrolledTab, setUncontrolledTab] = useState<TabKey>(() =>
    stageToTab(state.stage),
  );
  const isControlled = controlledTab !== undefined;
  const activeTab: TabKey = isControlled
    ? (controlledTab as TabKey)
    : uncontrolledTab;

  // Commit a tab change to whichever party owns the state, and always notify.
  const commitTab = useCallback(
    (next: TabKey) => {
      if (!isControlled) setUncontrolledTab(next);
      onActiveTabChange?.(next);
    },
    [isControlled, onActiveTabChange],
  );

  const prevStageRef = useRef(state.stage);
  // Marks a controlled-tab change as originating from the store→tab sync below,
  // so the controlled-only effect knows not to push the stage back (some stages
  // — e.g. exam — legitimately map onto a tab whose own stage differs).
  const syncingFromStageRef = useRef(false);
  // The store stage moves on its own when a result lands (orders -> results).
  // That used to pull the learner off the tab they were working in (typing in
  // Interview, placing orders). The strip now follows the stage ONLY while the
  // learner is idle on Chart Review; everywhere else the landing result is
  // announced (badge + polite live region) and the learner switches themselves.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    if (state.stage !== prevStageRef.current) {
      prevStageRef.current = state.stage;
      if (activeTabRef.current !== "chart-review") return;
      syncingFromStageRef.current = true;
      commitTab(stageToTab(state.stage));
    }
  }, [state.stage, commitTab]);

  // Results the learner has not opened the Results tab for since they landed.
  // The seen count resets whenever Results is the active tab, so the badge and
  // the announcement only ever describe results that arrived while they were away.
  const [seenResults, setSeenResults] = useState(state.results.length);
  useEffect(() => {
    if (activeTab === "results") setSeenResults(state.results.length);
  }, [activeTab, state.results.length]);
  const unseenResults =
    activeTab === "results" ? 0 : Math.max(0, state.results.length - seenResults);

  // Controlled-only: when the parent drives the tab (palette / number hotkeys),
  // advance the store stage to match — mirroring a click — guarded by the same
  // prevStageRef so the follow-effect above never bounces us off the new tab.
  // prevControlledTabRef suppresses the effect on mount (and no-op re-renders)
  // so seeding the controlled tab never nudges the stage; syncingFromStageRef
  // skips changes the store sync itself produced. Only real navigation acts.
  const prevControlledTabRef = useRef(controlledTab);
  useEffect(() => {
    if (!isControlled) return;
    if (prevControlledTabRef.current === controlledTab) return;
    prevControlledTabRef.current = controlledTab;
    if (syncingFromStageRef.current) {
      syncingFromStageRef.current = false;
      return;
    }
    const tab = TABS.find((x) => x.key === controlledTab);
    if (tab?.stage && tab.stage !== prevStageRef.current) {
      prevStageRef.current = tab.stage;
      setStage(tab.stage);
    }
    // Runs on external tab changes only; store-stage sync is handled above.
  }, [controlledTab, isControlled]);

  // Small live counts for the nav (results returned, orders placed, problems).
  const counts = useMemo(
    () => ({
      results: state.results.length,
      orders: state.orders.length,
      "problem-list": state.problemList.length,
    }),
    [state.results.length, state.orders.length, state.problemList.length],
  );

  // Scroll shadows: the six-tab strip overflows on narrow viewports, so a soft
  // fade at each end signals there is more to reach. Opacity only (no layout),
  // and reduced-motion collapses the fade transition at the CSS level.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const syncEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft < max - 1;
    setEdges((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, []);
  useEffect(() => {
    syncEdges();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges]);
  // Re-measure when tab widths change (a new count badge appears / active tab).
  useEffect(() => {
    syncEdges();
  }, [syncEdges, activeTab, counts]);

  function handleValueChange(value: string) {
    const tab = TABS.find((x) => x.key === value);
    if (!tab) return;
    commitTab(tab.key);
    // Reflect the navigation in the store stage (drives ProgressStages), but do
    // not let the follow-effect above bounce us off the tab we just chose.
    // Reference tabs (Monitor / Guidance) carry no stage and never advance it.
    if (tab.stage) {
      prevStageRef.current = tab.stage;
      setStage(tab.stage);
    }
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleValueChange}
      className="flex flex-col gap-4"
    >
      {/* Chart nav: a flat Epic-like activity strip. Dense icon+label tabs on a
          hairline baseline, a 2 px accent underline on the active tab, mono
          counts, and soft scroll fades when the strip overflows. */}
      <div className="relative -mx-4 border-b border-border bg-surface px-4 md:-mx-6 md:px-6">
        <div
          ref={scrollRef}
          onScroll={syncEdges}
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <TabsList
            aria-label={t("ehr.tabs.navLabel")}
            variant="underline"
            className="w-max min-w-full gap-0 border-b-0"
          >
            {TABS.map(({ key, icon: TabIcon }) => {
              const count = (counts as Record<string, number>)[key];
              const isActive = key === activeTab;
              return (
                <TabsTrigger
                  key={key}
                  value={key}
                  aria-current={isActive ? "page" : undefined}
                  className="group relative whitespace-nowrap px-2.5 pb-2 pt-2.5 text-muted data-[state=inactive]:hover:text-fg data-[state=active]:text-fg"
                >
                  <TabIcon
                    weight="bold"
                    className="h-4 w-4 text-subtle transition-colors duration-[120ms] ease-out group-data-[state=active]:text-brand"
                    aria-hidden
                  />
                  {t(`ehr.tabs.${camel(key)}`)}
                  {key === "results" && unseenResults > 0 ? (
                    <span className="ms-1 inline-flex min-w-4 items-center justify-center rounded-chip bg-brand px-1 font-mono text-[0.625rem] font-semibold leading-4 text-white">
                      {t("ehr.tabs.unseenBadge", { count: unseenResults })}
                    </span>
                  ) : typeof count === "number" && count > 0 ? (
                    <span className="ms-1 inline-flex min-w-4 items-center justify-center rounded-chip bg-bg-inset px-1 font-mono text-[0.625rem] font-semibold leading-4 text-muted group-data-[state=active]:bg-brand-tint group-data-[state=active]:text-brand">
                      {count}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        {/* Non-stealing notification: a landing result is announced here instead
            of moving the tab strip. Always mounted so the change is spoken. A
            plain polite live region, not role=status: RouteFallback's status
            spinner is what "the route has settled" checks wait on. */}
        <span aria-live="polite" aria-atomic="true" className="sr-only">
          {unseenResults > 0 ? t("ehr.tabs.newResults", { count: unseenResults }) : ""}
        </span>
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-px left-0 w-6 bg-surface transition-opacity duration-[120ms] [mask-image:linear-gradient(to_right,black,transparent)]",
            edges.start ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-px right-0 w-6 bg-surface transition-opacity duration-[120ms] [mask-image:linear-gradient(to_left,black,transparent)]",
            edges.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      <TabsContent value="chart-review">
        <ChartReviewTab caseInstance={caseInstance} lang={lang} />
      </TabsContent>
      <TabsContent value="interview">
        <InterviewTab
          caseInstance={caseInstance}
          lang={lang}
          affectLabel={affectLabel}
          guidanceOn={guidanceOn}
          onGuidanceChange={onGuidanceChange}
        />
      </TabsContent>
      <TabsContent value="flowsheets">
        <FlowsheetTab caseInstance={caseInstance} lang={lang} affectLabel={affectLabel} />
      </TabsContent>
      <TabsContent value="monitor">
        <div className="flex flex-col gap-4">
          <LiveVitalsMonitor />
          <TrendMonitor />
        </div>
      </TabsContent>
      <TabsContent value="orders">
        <OrdersTab caseInstance={caseInstance} lang={lang} guidanceOn={guidanceOn} />
      </TabsContent>
      <TabsContent value="results">
        <ResultsTab lang={lang} guidanceOn={guidanceOn} />
      </TabsContent>
      <TabsContent value="guidance">
        {/* Reference reading layout: two 68ch columns on wide screens. */}
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          <RealtimeGuidance className="reference" />
          <AttendingTips defaultOpen className="reference" />
        </div>
      </TabsContent>
      <TabsContent value="problem-list">
        <ProblemListTab caseInstance={caseInstance} lang={lang} />
      </TabsContent>
    </Tabs>
  );
}

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

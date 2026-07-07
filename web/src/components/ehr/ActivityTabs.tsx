import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardText,
  ChatCircleText,
  ChartLine,
  Flask,
  FileText,
  ListChecks,
  type Icon,
} from "@phosphor-icons/react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui";
import { ChartReviewTab } from "./tabs/ChartReviewTab";
import { InterviewTab } from "./tabs/InterviewTab";
import { FlowsheetTab } from "./tabs/FlowsheetTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { ResultsTab } from "./tabs/ResultsTab";
import { ProblemListTab } from "./tabs/ProblemListTab";
import { setStage, useEncounterState } from "@/state/encounterStore";
import type { EncounterStage } from "@/state/encounterStore";
import type { Lang } from "@/data/mock";
import type { CaseInstance } from "@/domain/case";

export interface ActivityTabsProps {
  caseInstance: CaseInstance;
  lang: Lang;
  affectLabel: string;
  guidanceOn: boolean;
  onGuidanceChange: (on: boolean) => void;
}

type TabKey =
  | "chart-review"
  | "interview"
  | "flowsheets"
  | "orders"
  | "results"
  | "problem-list";

const TABS: { key: TabKey; icon: Icon; stage: EncounterStage }[] = [
  { key: "chart-review", icon: ClipboardText, stage: "chart-review" },
  { key: "interview", icon: ChatCircleText, stage: "interview" },
  { key: "flowsheets", icon: ChartLine, stage: "results" },
  { key: "orders", icon: Flask, stage: "orders" },
  { key: "results", icon: FileText, stage: "results" },
  { key: "problem-list", icon: ListChecks, stage: "assessment" },
];

/** Map the store's canonical stage to the tab that best represents it. */
function stageToTab(stage: EncounterStage): TabKey {
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
}: ActivityTabsProps) {
  const { t } = useTranslation();
  const state = useEncounterState();

  // The active tab is student-controlled local state (so any tab is clickable),
  // seeded from the store stage on mount. It is kept in sync two ways:
  //  - the student clicking a tab sets it and advances the store stage;
  //  - an action that moves the store stage on its own (e.g. a result returns)
  //    follows along, without trapping the student on a tab they left.
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    stageToTab(state.stage),
  );
  const prevStageRef = useRef(state.stage);
  useEffect(() => {
    if (state.stage !== prevStageRef.current) {
      prevStageRef.current = state.stage;
      setActiveTab(stageToTab(state.stage));
    }
  }, [state.stage]);

  // Small live counts for the nav (results returned, orders placed, problems).
  const counts = useMemo(
    () => ({
      results: state.results.length,
      orders: state.orders.length,
      "problem-list": state.problemList.length,
    }),
    [state.results.length, state.orders.length, state.problemList.length],
  );

  function handleValueChange(value: string) {
    const tab = TABS.find((x) => x.key === value);
    if (!tab) return;
    setActiveTab(tab.key);
    // Reflect the navigation in the store stage (drives ProgressStages), but do
    // not let the follow-effect above bounce us off the tab we just chose.
    prevStageRef.current = tab.stage;
    setStage(tab.stage);
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleValueChange}
      className="flex flex-col gap-4"
    >
      <div className="overflow-x-auto">
        <TabsList className="w-max min-w-full">
          {TABS.map(({ key, icon: TabIcon }) => {
            const count = (counts as Record<string, number>)[key];
            const isActive = key === activeTab;
            return (
              <TabsTrigger
                key={key}
                value={key}
                aria-current={isActive ? "page" : undefined}
                className="gap-1.5 whitespace-nowrap"
              >
                <TabIcon weight="bold" className="h-4 w-4" aria-hidden />
                {t(`ehr.tabs.${camel(key)}`)}
                {typeof count === "number" && count > 0 ? (
                  <span className="ml-0.5 rounded-full bg-brand-tint px-1.5 text-[10px] font-semibold text-brand">
                    {count}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
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
      <TabsContent value="orders">
        <OrdersTab caseInstance={caseInstance} lang={lang} />
      </TabsContent>
      <TabsContent value="results">
        <ResultsTab lang={lang} />
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

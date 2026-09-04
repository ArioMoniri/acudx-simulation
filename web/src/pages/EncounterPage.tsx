import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { List, X } from "@phosphor-icons/react";
import type { StartSelection } from "./StartPage";

import { PageContainer } from "@/components/shell";
import { ProgressStages } from "@/components";
import {
  PatientBanner,
  Storyboard,
  ActivityTabs,
  EncounterClock,
  NewCaseMenu,
  SimBadge,
} from "@/components/ehr";
import {
  ACTIVITY_TAB_KEYS,
  activityTabLabelKey,
  stageToTab,
} from "@/components/ehr/ActivityTabs";
import { CommandPalette, type Command } from "@/components/ehr/CommandPalette";
import { PatientViewer } from "@/components/PatientViewer";
import { cn } from "@/lib/cn";
import { useHotkeys } from "@/lib/useHotkeys";
import { useLang } from "@/lib/useLang";
import { useReveal } from "@/lib/motion";
import { chestPainNstemiCase, getSeedCase } from "@/data/seedCases";
import { generateCase, type ChiefComplaintFamily } from "@/domain/caseGen";
import { signsFromVitals } from "@/components/ehr";
import type { CaseInstance } from "@/domain/case";
import {
  resetEncounter,
  startEncounter,
  useEncounterState,
} from "@/state/encounterStore";
import type { EncounterStage as StoreStage } from "@/state/encounterStore";
import type { EncounterStageMeta } from "@/data/mock";
import { useLiveBackend } from "@/lib/liveBackend";
import { fetchGeneratedCase } from "@/lib/liveCaseGen";
import { recordFromEncounter } from "@/state/progressStore";

/* -------------------------------------------------------------------------- */
/* Progress stages derived from the store stage                                */
/* -------------------------------------------------------------------------- */

/**
 * The linear teaching path shown in the stepper. `key` reuses the mock stage
 * union (ProgressStages only uses it as a React key + for the label lookup),
 * `stages` maps the store's canonical stages onto each step.
 */
const PROGRESS_STAGES: {
  key: EncounterStageMeta["key"];
  stages: StoreStage[];
  label: EncounterStageMeta["label"];
}[] = [
  { key: "history", stages: ["chart-review"], label: { en: "Chart review", tr: "Kart incelemesi" } },
  { key: "exam", stages: ["interview", "exam"], label: { en: "Interview and exam", tr: "Anamnez ve muayene" } },
  { key: "tests", stages: ["orders"], label: { en: "Orders", tr: "İstemler" } },
  { key: "diagnosis", stages: ["results"], label: { en: "Results", tr: "Sonuçlar" } },
  { key: "management", stages: ["assessment", "closed"], label: { en: "A and P", tr: "Değerlendirme ve plan" } },
];

const PROGRESS_META: EncounterStageMeta[] = PROGRESS_STAGES.map((s) => ({
  key: s.key,
  label: s.label,
}));

function progressIndexFor(stage: StoreStage): number {
  const idx = PROGRESS_STAGES.findIndex((s) => s.stages.includes(stage));
  return idx < 0 ? 1 : idx;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * EncounterPage — the EHR workspace (docs §2). PatientBanner (sticky) + the
 * Storyboard rail + ActivityTabs, on a clean white workspace with the one dark
 * vitals panel inside Flowsheets. startEncounter runs on mount with a case; a
 * New case control regenerates random / constrained cases or loads a seed. The
 * rail collapses to a drawer on mobile; the tab strip scrolls.
 */
export function EncounterPage() {
  const { t } = useTranslation();
  const lang = useLang();
  // Shared motion vocabulary (web/src/lib/motion.ts): a gentle fade-up cascade,
  // collapsing to no motion under prefers-reduced-motion.
  const top = useReveal();
  const body = useReveal(0.06);

  const location = useLocation();
  // Session setup handed over from the Start page (docs/design/01 Journey 1.5).
  // A "Surprise me" pick (or no chief complaint) yields a random draw; a family
  // pick constrains the generator; guidance seeds the drawer's initial state.
  // The Case Library can also hand over a fully built CaseInstance directly
  // ("Start this case"), which takes precedence over a generator selection.
  const routeState = location.state as
    | { start?: StartSelection; caseInstance?: CaseInstance }
    | null;
  const startSelection = routeState?.start;
  const providedCase = routeState?.caseInstance;

  const state = useEncounterState();
  const { available: backendAvailable } = useLiveBackend();
  const [guidanceOn, setGuidanceOn] = useState(startSelection?.guidance ?? true);
  const [railOpen, setRailOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Command palette (⌘K) + the tab it steers, lifted here so the palette and
  // number hotkeys can drive ActivityTabs. Seeded from the store stage so the
  // controlled tab matches ActivityTabs' own initial pick.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() =>
    stageToTab(state.stage),
  );

  // Latest store snapshot for the unmount recorder (the mount-only cleanup would
  // otherwise capture the initial, empty state).
  const latestRef = useRef(state);
  latestRef.current = state;

  // Keep a local reference to the active case so the page can render the banner
  // even during a stage transition. Source of truth is the store.
  const caseInstance = state.caseInstance;

  // On mount, start the encounter. If the learner arrived from the Start page
  // with constraints, generate a matching case; otherwise open the curated ACS
  // seed. Reset on unmount so the store + its pending timers are cleared when
  // leaving the workspace. Runs on every mount (including the StrictMode dev
  // double-invoke) so the store is never left empty by a cleanup that outran
  // its start.
  useEffect(() => {
    if (providedCase) {
      // Exact case chosen from the Case Library.
      startEncounter(providedCase);
    } else if (startSelection) {
      startEncounter(
        startSelection.chiefComplaint
          ? generateCase({
              seedMode: "constrained",
              chiefComplaint: startSelection.chiefComplaint,
              difficulty: startSelection.difficulty,
              locale: lang,
            })
          : generateCase({ seedMode: "random", locale: lang }),
      );
    } else {
      startEncounter(chestPainNstemiCase);
    }
    return () => {
      // Record a COMPLETED encounter (a diagnosis was committed) into the
      // per-user progress store before the log is cleared, so calibration /
      // mastery plots fill from real work rather than fabricated data.
      const s = latestRef.current;
      if (s.caseInstance && s.committedDiagnosis && s.startTs != null) {
        try {
          recordFromEncounter(s.events, s.caseInstance, s.startTs);
        } catch {
          /* recording is best-effort; never block teardown */
        }
      }
      resetEncounter();
    };
    // Intentionally mount-only: the selection is captured at arrival and a
    // language change mid-encounter must not silently regenerate the case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCase = useCallback((next: CaseInstance) => {
    startEncounter(next);
    setRailOpen(false);
  }, []);

  // "New random case" defaults to the pod's unlimited ICD/DSM generator when the
  // backend is reachable (truly endless, realtime), and falls back instantly to
  // the on-device generator when offline or on any error.
  const handleRandom = useCallback(() => {
    if (backendAvailable) {
      setGenerating(true);
      fetchGeneratedCase({ locale: lang })
        .then(loadCase)
        .catch(() => loadCase(generateCase({ seedMode: "random", locale: lang })))
        .finally(() => setGenerating(false));
    } else {
      loadCase(generateCase({ seedMode: "random", locale: lang }));
    }
  }, [backendAvailable, loadCase, lang]);

  const handleConstrained = useCallback(
    (chiefComplaint: ChiefComplaintFamily, difficulty: 1 | 2 | 3 | 4 | 5) => {
      loadCase(
        generateCase({
          seedMode: "constrained",
          chiefComplaint,
          difficulty,
          locale: lang,
        }),
      );
    },
    [loadCase, lang],
  );

  const handleLoadSeed = useCallback(
    (id: string) => {
      const seed = getSeedCase(id);
      if (seed) loadCase(seed);
    },
    [loadCase],
  );

  // Affect label for the avatar/portrait, derived from the triage sign channel.
  const affectLabel = useMemo(() => {
    if (!caseInstance) return t("encounter.affect.distress");
    const signs = signsFromVitals(caseInstance.triageVitals);
    if (signs.some((s) => s.sign === "respiratory-distress" && s.intensity > 0.3)) {
      return t("encounter.affect.distress");
    }
    if (signs.length === 0) return t("encounter.affect.relieved");
    return t("encounter.affect.distress");
  }, [caseInstance, t]);

  const selectTab = useCallback((key: string) => setActiveTab(key), []);

  // ⌘K / Ctrl-K toggles the palette — allowed to fire even while typing in the
  // chart so it is always reachable.
  useHotkeys(
    [
      {
        combo: "mod+k",
        whenTyping: true,
        handler: (e) => {
          e.preventDefault();
          setPaletteOpen((o) => !o);
        },
      },
    ],
    true,
  );
  // Number keys jump directly to a chart tab; "?" opens the palette. Suspended
  // while the palette is open, so its search field owns the keyboard then.
  useHotkeys(
    [
      ...ACTIVITY_TAB_KEYS.slice(0, 9).map((key, i) => ({
        combo: String(i + 1),
        handler: () => selectTab(key),
      })),
      { combo: "?", handler: () => setPaletteOpen(true) },
    ],
    !paletteOpen,
  );

  // Palette commands: one "go to" per chart tab, plus the workspace actions.
  const commands = useMemo<Command[]>(() => {
    const sectionNav = t("commandPalette.sectionNav", { defaultValue: "Navigate" });
    const sectionActions = t("commandPalette.sectionActions", {
      defaultValue: "Actions",
    });
    const nav: Command[] = ACTIVITY_TAB_KEYS.map((key, i) => {
      const label = t(activityTabLabelKey(key));
      return {
        id: `nav:${key}`,
        label,
        hint: i < 9 ? String(i + 1) : undefined,
        section: sectionNav,
        keywords: `go to open switch tab ${label}`,
        run: () => selectTab(key),
      };
    });
    const actions: Command[] = [
      {
        id: "action:enlarge",
        label: t("commandPalette.enlarge", { defaultValue: "Enlarge patient view" }),
        section: sectionActions,
        keywords: "patient photo zoom enlarge portrait",
        run: () => setViewerOpen(true),
      },
      {
        id: "action:new-case",
        label: t("commandPalette.newCase", { defaultValue: "New random case" }),
        section: sectionActions,
        keywords: "generate random new case",
        run: handleRandom,
      },
    ];
    return [...nav, ...actions];
  }, [t, selectTab, handleRandom]);

  const currentIndex = progressIndexFor(state.stage);

  if (!caseInstance) {
    return (
      <PageContainer width="wide">
        <p className="text-sm text-muted">{t("common.loading")}</p>
      </PageContainer>
    );
  }

  const toolbar = (
    <>
      <EncounterClock variant="chip" className="hidden sm:inline-flex" />
      {generating ? (
        <span
          role="status"
          className="inline-flex items-center rounded-control border border-border bg-surface px-2.5 py-1 text-xs text-muted"
        >
          {t("ehr.generatingCase", { defaultValue: "Generating a case…" })}
        </span>
      ) : null}
      <NewCaseMenu
        lang={lang}
        onRandom={handleRandom}
        onConstrained={handleConstrained}
        onLoadSeed={handleLoadSeed}
      />
      {/* Rail toggle on mobile */}
      <button
        type="button"
        onClick={() => setRailOpen(true)}
        aria-label={t("ehr.storyboard.open")}
        className="inline-flex h-9 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-sm font-medium text-fg lg:hidden"
      >
        <List weight="bold" className="h-4 w-4" aria-hidden />
        {t("ehr.storyboard.chart")}
      </button>
    </>
  );

  return (
    <PageContainer width="wide" className="flex flex-col gap-4">
      <motion.div {...top}>
        <PatientBanner caseInstance={caseInstance} lang={lang} toolbar={toolbar} />
      </motion.div>

      {/* Progress stages (wired to the store stage) + case meta line */}
      <motion.div
        {...top}
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <ProgressStages
          stages={PROGRESS_META}
          currentIndex={currentIndex}
          lang={lang}
          ariaLabel={t("encounter.stageLabel")}
        />
        <p className="text-xs text-muted">
          {t("ehr.workspace.caseMeta", {
            difficulty: caseInstance.difficulty,
            provenance: t(`ehr.provenance.${caseInstance.provenance}`),
          })}
        </p>
      </motion.div>

      {/* Workspace: rail + main */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        {/* Rail (desktop) */}
        <motion.div {...body} className="hidden lg:block">
          <Storyboard caseInstance={caseInstance} lang={lang} affectLabel={affectLabel} />
        </motion.div>

        {/* Main activity area */}
        <motion.div {...body} className="min-w-0">
          <ActivityTabs
            caseInstance={caseInstance}
            lang={lang}
            affectLabel={affectLabel}
            guidanceOn={guidanceOn}
            onGuidanceChange={setGuidanceOn}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
          />
        </motion.div>
      </div>

      {/* Persistent education-only footnote (interaction dock strip) */}
      <SimBadge variant="bar" />

      {/* Mobile rail drawer */}
      {railOpen ? (
        <MobileRailDrawer onClose={() => setRailOpen(false)} title={t("ehr.storyboard.chart")}>
          <Storyboard caseInstance={caseInstance} lang={lang} affectLabel={affectLabel} />
        </MobileRailDrawer>
      ) : null}

      {/* ⌘K command palette + the enlarged patient view it can open */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <PatientViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        caseInstance={caseInstance}
        affectLabel={affectLabel}
      />
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile rail drawer                                                          */
/* -------------------------------------------------------------------------- */

function MobileRailDrawer({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape to dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the background from scrolling behind the sheet, move focus into it, and
  // return focus to the control that opened it on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-black/40 motion-safe:animate-[fade-up_0.2s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-[85%] max-w-sm flex-col gap-3 overflow-y-auto",
          "border-r border-border bg-bg p-4 shadow-soft-md",
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("actions.close")}
            className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none"
          >
            <X weight="bold" className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { List, X, Brain, Warning } from "@phosphor-icons/react";
import type { StartSelection } from "./StartPage";

import { PageContainer } from "@/components/shell";
import { ProgressStages } from "@/components";
import { Skeleton } from "@/components/ui";
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
import {
  CaseGenProgress,
  EMPTY_PROGRESS,
  advanceProgress,
  type GenFailure,
  type GenProgress,
} from "@/components/ehr/CaseGenProgress";
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
  getDirector,
  resetEncounter,
  setLiveEnabled,
  startEncounter,
  useEncounterSelector,
  useEncounterState,
} from "@/state/encounterStore";
import type { EncounterStage as StoreStage } from "@/state/encounterStore";
import type { EncounterStageMeta } from "@/data/schema";
import { useLiveBackend } from "@/lib/liveBackend";
import {
  streamCaseGenV2,
  templateCaseV2,
  v2SpecToCaseInstance,
  type CaseGenV2Meta,
  type CaseGenV2Request,
} from "@/lib/caseGenV2";
import type { CaseGenerationMeta } from "@/lib/liveEncounter";
import { noteServedCase } from "@/domain/caseGen";
import { recordFromEncounter } from "@/state/progressStore";

/* -------------------------------------------------------------------------- */
/* Progress stages derived from the store stage                                */
/* -------------------------------------------------------------------------- */

/**
 * The linear teaching path shown in the stepper. `key` reuses the schema stage
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
/* Case provenance helpers                                                     */
/* -------------------------------------------------------------------------- */

/** Provenance record for a v2 spec (model or template), from its meta block. */
function generationFromMeta(meta: CaseGenV2Meta, threadId: string | null): CaseGenerationMeta {
  return {
    source: meta.source === "template" ? "template" : "model",
    threadId: meta.thread_id ?? threadId,
    council: meta.council
      ? { decision: meta.council.decision, vetoed: meta.council.vetoed, repairs: meta.council.repairs }
      : null,
    degraded: Boolean(meta.degraded) || meta.source === "template",
    model: Array.isArray(meta.model) ? meta.model.join(", ") : meta.model ?? null,
    note: meta.note ?? null,
  };
}

/** Provenance for the on-device generator (gateway unreachable). */
const OFFLINE_GENERATION: CaseGenerationMeta = {
  source: "offline",
  threadId: null,
  council: null,
  degraded: false,
  model: null,
  note: null,
};

interface GenState {
  progress: GenProgress;
  failure: GenFailure | null;
  busy: boolean;
  /** The request behind the last run, for Retry / Use template. */
  request: CaseGenV2Request | null;
}

const GEN_IDLE: GenState = { progress: EMPTY_PROGRESS, failure: null, busy: false, request: null };

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
  const { available: backendAvailable, checking: backendChecking } = useLiveBackend();
  const director = useEncounterSelector(getDirector);
  const [guidanceOn, setGuidanceOn] = useState(startSelection?.guidance ?? true);
  const [railOpen, setRailOpen] = useState(false);
  const [gen, setGen] = useState<GenState>(GEN_IDLE);
  const genAbortRef = useRef<AbortController | null>(null);

  // Live mode follows gateway reachability: the store resolves orders through
  // the results engine and steps the Clinical Director only while it is on.
  useEffect(() => {
    setLiveEnabled(backendAvailable);
  }, [backendAvailable]);
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

  const loadCase = useCallback((next: CaseInstance, generation?: CaseGenerationMeta) => {
    genAbortRef.current?.abort();
    genAbortRef.current = null;
    setGen(GEN_IDLE);
    startEncounter(next, generation ? { generation } : {});
    setRailOpen(false);
  }, []);

  const v2Locale = lang === "tr" ? "tr" : "en";

  /**
   * Run the v2 generator over SSE with a stage-by-stage progress view. A
   * finished spec becomes the running case with its provenance (model, council
   * verdict, degraded flag). On 503 (model unreachable), a 502, a timeout or a
   * broken stream the real error is shown and the learner chooses between the
   * labelled template and a retry; nothing falls back silently.
   */
  const runLiveGeneration = useCallback(
    (req: CaseGenV2Request) => {
      genAbortRef.current?.abort();
      const controller = new AbortController();
      genAbortRef.current = controller;
      setGen({ progress: EMPTY_PROGRESS, failure: null, busy: true, request: req });
      void streamCaseGenV2(req, {
        signal: controller.signal,
        onEvent: (ev) => {
          if (controller.signal.aborted) return;
          if (ev.event === "start") {
            setGen((g) => ({ ...g, progress: { ...g.progress, threadId: ev.thread_id } }));
          } else if (ev.event === "node") {
            setGen((g) => ({ ...g, progress: advanceProgress(g.progress, ev.node) }));
          }
        },
      }).then((res) => {
        if (controller.signal.aborted) return;
        genAbortRef.current = null;
        if (res.ok && res.data.spec) {
          const spec = res.data.spec;
          const adapted = v2SpecToCaseInstance(spec);
          noteServedCase(adapted.case.correctDiagnosis.code.coding[0]?.code, adapted.case.patient.name);
          startEncounter(adapted.case, { generation: generationFromMeta(spec.meta, res.data.thread_id) });
          setRailOpen(false);
          setGen(GEN_IDLE);
          return;
        }
        const code = res.ok ? "no_spec" : res.error;
        const status = res.ok ? undefined : res.status;
        setGen((g) => ({ ...g, busy: false, failure: { code, ...(status ? { status } : {}) } }));
      });
    },
    [],
  );

  /** The deterministic template, labelled as such (meta.source = "template"). */
  const useTemplateCase = useCallback(() => {
    const req = gen.request ?? { locale: v2Locale };
    setGen((g) => ({ ...g, busy: true, failure: null }));
    void templateCaseV2(req).then((res) => {
      if (res.ok) {
        const adapted = v2SpecToCaseInstance(res.data.spec);
        loadCase(adapted.case, generationFromMeta(res.data.spec.meta, null));
        return;
      }
      // Even the template route is unreachable: the on-device generator is the
      // only path left, and the banner says so.
      loadCase(
        generateCase(
          req.complaint
            ? { seedMode: "constrained", chiefComplaint: req.complaint as ChiefComplaintFamily, difficulty: req.difficulty ?? undefined, locale: lang }
            : { seedMode: "random", locale: lang },
        ),
        { ...OFFLINE_GENERATION, note: res.error },
      );
    });
  }, [gen.request, v2Locale, loadCase, lang]);

  const retryGeneration = useCallback(() => {
    runLiveGeneration(gen.request ?? { locale: v2Locale });
  }, [gen.request, runLiveGeneration, v2Locale]);

  const cancelGeneration = useCallback(() => {
    genAbortRef.current?.abort();
    genAbortRef.current = null;
    setGen((g) => ({ ...g, busy: false, failure: g.request ? { code: "cancelled" } : null }));
  }, []);

  // Record a COMPLETED encounter (a diagnosis was committed) into the per-user
  // progress store before the log is cleared on unmount, so calibration /
  // mastery plots fill from real work rather than fabricated data. Mount-only.
  useEffect(() => {
    return () => {
      const s = latestRef.current;
      if (s.caseInstance && s.committedDiagnosis && s.startTs != null) {
        try {
          recordFromEncounter(s.events, s.caseInstance, s.startTs);
        } catch {
          /* recording is best-effort; never block teardown */
        }
      }
      genAbortRef.current?.abort();
      resetEncounter();
      // Together with the store reset so StrictMode's double-invoke (and a real
      // remount) starts a fresh encounter exactly once.
      startedRef.current = false;
    };
  }, []);

  // Start the encounter once the gateway probe has answered. A case handed over
  // by the Case Library starts at once (it needs no generator). Otherwise the
  // Start page constraints (or a random draw) go to the v2 generator when the
  // gateway is reachable, and to the on-device generator, labelled "offline",
  // when it is not. Runs on the probe's single checking -> answered transition
  // only: a later change in reachability (a flapping probe) must never restart
  // a running encounter, so `backendAvailable` is read through a ref here.
  const startedRef = useRef(false);
  const availableRef = useRef(backendAvailable);
  availableRef.current = backendAvailable;
  useEffect(() => {
    if (startedRef.current) return;
    if (providedCase) {
      startedRef.current = true;
      startEncounter(providedCase, {
        generation: {
          ...OFFLINE_GENERATION,
          source: providedCase.provenance === "seed" ? "seed" : "published",
        },
      });
      return;
    }
    if (backendChecking) return;
    startedRef.current = true;
    if (availableRef.current) {
      runLiveGeneration({
        locale: v2Locale,
        ...(startSelection?.chiefComplaint ? { complaint: startSelection.chiefComplaint } : {}),
        ...(startSelection?.difficulty ? { difficulty: startSelection.difficulty } : {}),
      });
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
        { generation: OFFLINE_GENERATION },
      );
    } else {
      startEncounter(chestPainNstemiCase, { generation: { ...OFFLINE_GENERATION, source: "seed" } });
    }
    // The selection is captured at arrival; a language change mid-encounter must
    // not regenerate the case, so only the probe's checking flag re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendChecking]);

  // "New random case" runs the v2 generator (SSE, with the stage view) when the
  // gateway is reachable, and the on-device generator, labelled "offline", when
  // it is not. A model failure is never papered over: see runLiveGeneration.
  const handleRandom = useCallback(() => {
    if (backendAvailable) {
      runLiveGeneration({ locale: v2Locale });
    } else {
      loadCase(generateCase({ seedMode: "random", locale: lang }), OFFLINE_GENERATION);
    }
  }, [backendAvailable, runLiveGeneration, v2Locale, loadCase, lang]);

  const handleConstrained = useCallback(
    (chiefComplaint: ChiefComplaintFamily, difficulty: 1 | 2 | 3 | 4 | 5) => {
      if (backendAvailable) {
        runLiveGeneration({ locale: v2Locale, complaint: chiefComplaint, difficulty });
        return;
      }
      loadCase(
        generateCase({
          seedMode: "constrained",
          chiefComplaint,
          difficulty,
          locale: lang,
        }),
        OFFLINE_GENERATION,
      );
    },
    [backendAvailable, runLiveGeneration, v2Locale, loadCase, lang],
  );

  const handleLoadSeed = useCallback(
    (id: string) => {
      const seed = getSeedCase(id);
      if (seed) loadCase(seed, { ...OFFLINE_GENERATION, source: "seed" });
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

  if (!caseInstance && (gen.busy || gen.failure)) {
    return (
      <PageContainer width="wide" className="flex flex-col gap-4">
        <CaseGenProgress
          progress={gen.progress}
          failure={gen.failure}
          busy={gen.busy}
          onRetry={retryGeneration}
          onUseTemplate={useTemplateCase}
          onCancel={cancelGeneration}
        />
        <SimBadge variant="bar" />
      </PageContainer>
    );
  }

  if (!caseInstance) {
    return (
      <PageContainer
        width="wide"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{t("common.loading")}</span>
        <div aria-hidden="true">
          {/* Progress + patient-banner strip */}
          <div className="space-y-3">
            <Skeleton className="h-4 w-40 rounded-control" />
            <Skeleton className="h-16 w-full rounded-card" />
          </div>
          {/* Workspace split: storyboard rail + main tabs (matches the live grid) */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
            <Skeleton className="h-[520px] w-full rounded-card" />
            <div className="space-y-4">
              <Skeleton className="h-10 w-full rounded-card" />
              <Skeleton className="h-[460px] w-full rounded-card" />
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  const toolbar = (
    <>
      <EncounterClock variant="chip" className="hidden sm:inline-flex" />
      {state.liveEnabled ? (
        <span
          role="status"
          data-testid="director-chip"
          className="hidden items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1 text-xs text-muted md:inline-flex"
          title={
            director.status === "error"
              ? t("live2.director.errorHint", { reason: director.error ?? "" })
              : t("live2.director.hint")
          }
        >
          {director.status === "error" ? (
            <Warning weight="fill" className="h-3.5 w-3.5 text-[color:var(--state-caution)]" aria-hidden />
          ) : (
            <Brain weight="bold" className="h-3.5 w-3.5" aria-hidden />
          )}
          {director.status === "error"
            ? t("live2.director.error")
            : director.status === "busy"
              ? t("live2.director.busy")
              : t("live2.director.steps", { count: director.steps })}
        </span>
      ) : null}
      {gen.busy ? (
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

      {/* A generator run in progress (or one that failed) while a case is open:
          the stage view and the explicit template / retry choice. */}
      {gen.busy || gen.failure ? (
        <CaseGenProgress
          progress={gen.progress}
          failure={gen.failure}
          busy={gen.busy}
          onRetry={retryGeneration}
          onUseTemplate={useTemplateCase}
          onCancel={cancelGeneration}
        />
      ) : null}

      {/* Workflow ribbon — the stage stepper (wired to the store stage) + the
          case-meta line, framed as one dense chrome bar under the banner. */}
      <motion.div
        {...top}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0 sm:flex-1">
          <ProgressStages
            stages={PROGRESS_META}
            currentIndex={currentIndex}
            lang={lang}
            ariaLabel={t("encounter.stageLabel")}
          />
        </div>
        <p className="shrink-0 text-xs text-muted">
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

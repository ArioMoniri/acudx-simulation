import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Path,
  X,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Circle,
  Lightbulb,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { tourStops } from "@/data/landing";

/* -------------------------------------------------------------------------- */
/* Per-route contextual help                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Screen-specific "what to do here" content, keyed by tour-stop key. This is
 * what makes the tour a real HELP mode rather than a bare route-walker: for the
 * route the reviewer is actually on, the panel explains the screen's purpose and
 * the concrete next steps. Strings are English defaults surfaced through i18n
 * (`tour.help.<key>.*`), so a locale can override them without a code change.
 */
interface StopHelp {
  body: string;
  steps: readonly string[];
}

const STOP_HELP: Record<string, StopHelp> = {
  welcome: {
    body: "The overview. Skim what AcuDx does — the roleplay → guidance → feedback loop — then start a session or jump straight to a case.",
    steps: [
      "Read the overview to see how an encounter is scored.",
      "Use Next below to walk every screen in order.",
      "Press Start when you're ready to choose a case.",
    ],
  },
  start: {
    body: "Set up a session before the encounter begins: your language, your training level, and how hard the case should be.",
    steps: [
      "Pick the interface language and the case language.",
      "Choose your role and a difficulty tier.",
      "Turn on live guidance if you want attending-style coaching.",
    ],
  },
  cases: {
    body: "Browse recommended cases or generate a fresh one. Each row shows the chief complaint, the setting, and the guideline it's anchored to.",
    steps: [
      "Scan the recommended rail for a complaint to practise.",
      "Generate a new case for a unique presentation.",
      "Open a case to launch the encounter in the EHR.",
    ],
  },
  encounter: {
    body: "Work the patient up in the EHR: take a history, examine, order investigations, then reason to a differential and a plan.",
    steps: [
      "Interview the patient in your own words on the Interview tab.",
      "Examine and place orders from their tabs.",
      "Watch Attending tips for the next best action and timing.",
      "Enter your differential and diagnosis when you're ready.",
    ],
  },
  feedback: {
    body: "Read the graded report. Bands are evidence-anchored and cite the guideline behind each judgement — no black-box scores.",
    steps: [
      "Review each domain band and the gaps it flags.",
      "Open a gap to see the exact utterance it's anchored to.",
      "Follow the cited remediation before your next case.",
    ],
  },
  rooms: {
    body: "Run a case as a team. The shared floor shows a running transcript and closed-loop communication between roles.",
    steps: [
      "Join or create a room and take a role.",
      "Use closed-loop read-back for orders and results.",
      "Watch the shared vitals respond to the team's actions.",
    ],
  },
  progress: {
    body: "Track competence over time. The charts are drawn from your real earned sessions, not sample data, so a new account starts empty.",
    steps: [
      "Review the trend for each domain across sessions.",
      "Spot the weakest domain the case rail weights toward.",
      "Return to Cases to target that gap next.",
    ],
  },
  authoring: {
    body: "Author and sign off cases. A credentialed clinician must co-sign before anything publishes, and every fact carries provenance.",
    steps: [
      "Draft or review a case blueprint.",
      "Check the provenance and guideline citations.",
      "Clear the clinician sign-off gate to publish.",
    ],
  },
  institution: {
    body: "The cohort view. Aggregate competence and safety signals across a programme, kept privacy-preserving.",
    steps: [
      "Scan cohort-level competence and safety flags.",
      "Drill into a domain to see where learners struggle.",
      "Share the summary with faculty.",
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* GuidedTour                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * GuidedTour — a lightweight contextual-help mode in the shell. A small TopNav
 * button opens an accessible panel. For the route the reviewer is currently on,
 * the panel leads with real, screen-specific help ("On this screen": what it is
 * and the concrete next steps). Below that it lists every phase in order so the
 * reviewer can jump to any stop or step Previous / Next through the whole
 * product; visited stops are marked and the current one is highlighted.
 *
 * Built as a native disclosure (button + dialog panel) rather than a component-
 * library modal so it shares the app's single React instance and primitives. It
 * is keyboard reachable, closes on Escape and outside click, restores focus to
 * the trigger, and uses >=24px targets. Motion is a token-driven CSS transition
 * that collapses under prefers-reduced-motion.
 */
export function GuidedTour({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Index of the current route within the tour (or -1 if off-tour).
  const currentIndex = useMemo(
    () => tourStops.findIndex((s) => s.to === location.pathname),
    [location.pathname],
  );

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const go = useCallback(
    (to: string) => {
      navigate(to);
      close(false);
    },
    [navigate, close],
  );

  // Close on Escape and on outside click; move focus into the panel on open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: PointerEvent) {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        close(false);
      }
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    // Focus the first focusable control in the panel.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "button, a, [tabindex]",
    );
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, close]);

  // Step to the next / previous stop, wrapping from an off-tour route to the start.
  const nextIndex =
    currentIndex < 0 ? 0 : Math.min(currentIndex + 1, tourStops.length - 1);
  const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
  const atEnd = currentIndex === tourStops.length - 1;
  const atStart = currentIndex <= 0;

  // The current stop + its screen-specific help (null when off the tour path).
  const current = currentIndex >= 0 ? tourStops[currentIndex] : null;
  const currentHelp = current ? STOP_HELP[current.key] : undefined;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-control border border-border",
          "bg-surface px-2.5 text-[0.8125rem] font-medium text-fg",
          "transition-colors duration-[120ms] ease-out hover:bg-bg-subtle",
        )}
      >
        <Path weight="bold" className="h-4 w-4 text-brand" aria-hidden />
        <span className="hidden sm:inline">{t("tour.button")}</span>
        <span className="sm:hidden">{t("tour.buttonShort")}</span>
      </button>

      {open ? (
        <>
          {/* Click-catcher scrim; visual only, outside-click handled above. */}
          <div className="fixed inset-0 z-40 bg-fg/10" aria-hidden />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-label={t("tour.title")}
            className={cn(
              "absolute right-0 z-50 mt-2 w-[min(calc(100vw-2rem),24rem)]",
              "rounded-card border border-border bg-surface p-4 shadow-pop",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-fg">
                  {t("tour.title")}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {t("tour.description")}
                </p>
              </div>
              <button
                type="button"
                aria-label={t("actions.close")}
                onClick={() => close()}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-control border border-border bg-surface text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X weight="bold" className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Contextual help for the CURRENT screen (or an off-path nudge). */}
            {current && currentHelp ? (
              <div className="mt-4 rounded-control border border-brand/25 bg-brand-tint/40 p-3">
                <div className="flex items-center gap-2">
                  <Lightbulb weight="fill" className="h-4 w-4 text-brand" aria-hidden />
                  <span className="eyebrow text-brand">
                    {t("tour.onThisScreen", { defaultValue: "On this screen" })}
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-fg">
                  {t(`tour.stops.${current.key}.title`)}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {t(`tour.help.${current.key}.body`, {
                    defaultValue: currentHelp.body,
                  })}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {currentHelp.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-fg">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                        aria-hidden
                      />
                      <span>
                        {t(`tour.help.${current.key}.step${i}`, {
                          defaultValue: step,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 rounded-control border border-border bg-bg-subtle p-3 text-sm text-muted">
                {t("tour.offRoute", {
                  defaultValue:
                    "You're off the guided path — pick a stop below, or press Start to begin the walkthrough.",
                })}
              </p>
            )}

            {/* Ordered stop list */}
            <ol
              tabIndex={0}
              aria-label={t("tour.title")}
              className="mt-4 flex max-h-[min(50vh,22rem)] flex-col gap-1.5 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {tourStops.map((stop, i) => {
                const isCurrent = i === currentIndex;
                const isVisited = currentIndex >= 0 && i < currentIndex;
                return (
                  <li key={stop.key}>
                    <button
                      type="button"
                      onClick={() => go(stop.to)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-control border px-3 py-2 text-start",
                        "transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                        isCurrent
                          ? "border-brand bg-brand-tint"
                          : "border-border bg-surface hover:bg-bg-subtle",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold",
                          isCurrent
                            ? "bg-brand text-white"
                            : isVisited
                              ? "text-[color:var(--state-normal)]"
                              : "bg-bg-subtle text-muted",
                        )}
                        aria-hidden
                      >
                        {isVisited ? (
                          <CheckCircle weight="fill" className="h-4 w-4" />
                        ) : isCurrent ? (
                          String(i + 1)
                        ) : (
                          <Circle weight="bold" className="h-3 w-3" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">
                          {t(`tour.stops.${stop.key}.title`)}
                        </span>
                        <span className="block text-xs text-muted">
                          {t(`tour.stops.${stop.key}.hint`)}
                        </span>
                      </span>
                      {isCurrent ? (
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-brand">
                          {t("tour.here")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Sequential controls */}
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => go(tourStops[prevIndex].to)}
                disabled={atStart}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-40"
              >
                <ArrowLeft weight="bold" className="h-4 w-4" aria-hidden />
                {t("tour.previous")}
              </button>
              <span className="font-mono text-xs text-muted" aria-hidden>
                {Math.max(currentIndex + 1, 1)} / {tourStops.length}
              </span>
              <button
                type="button"
                onClick={() => go(tourStops[nextIndex].to)}
                disabled={atEnd}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-brand px-3 text-sm font-medium text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              >
                {currentIndex < 0 ? t("tour.start") : t("tour.next")}
                <ArrowRight weight="bold" className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

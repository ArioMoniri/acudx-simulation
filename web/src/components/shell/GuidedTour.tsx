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
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { tourStops } from "@/data/landing";

/**
 * GuidedTour — a lightweight "walk every phase" affordance in the shell. A small
 * TopNav button opens an accessible panel listing the demo screens in order. The
 * reviewer can jump to any stop or step Previous / Next sequentially through all
 * phases so they can walk the whole product. The panel tracks the current route
 * and marks visited stops.
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
          "inline-flex min-h-9 items-center gap-1.5 rounded-control border border-border",
          "bg-surface px-3 text-sm font-medium text-fg",
          "transition-colors duration-200 ease-out hover:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]",
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
              "rounded-card border border-border bg-surface p-4 shadow-soft-md",
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

            {/* Ordered stop list */}
            <ol className="mt-4 flex max-h-[min(60vh,26rem)] flex-col gap-1.5 overflow-y-auto">
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

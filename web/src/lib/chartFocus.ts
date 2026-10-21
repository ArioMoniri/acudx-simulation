/**
 * Chart focus: after a chat navigate action switches the chart tab, bring the
 * named item into view and flash it, so "View troponin" lands on the troponin
 * row rather than the top of a long Results tab.
 *
 * Items opt in with `data-chart-ref="<order code>"` (Results panels, pending
 * results, the Orders tracker). When no item matches (or no ref was given) the
 * active tab panel itself takes focus, so a keyboard user still lands in the
 * right place. The flash uses the Web Animations API (no timers) and only
 * changes colour, so it is safe under prefers-reduced-motion; scrolling jumps
 * instead of animating when reduced motion is requested.
 */

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function escapeAttr(v: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(v);
  return v.replace(/["\\]/g, "\\$&");
}

/** Find the element for `ref` inside the active tab panel (or the document). */
export function findChartItem(ref: string, root: ParentNode = document): HTMLElement | null {
  const panel = root.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]') ?? root;
  return panel.querySelector<HTMLElement>(`[data-chart-ref="${escapeAttr(ref)}"]`);
}

/** Flash an element with the accent ring (colour only). */
export function flashElement(el: HTMLElement): void {
  if (typeof el.animate !== "function") return;
  el.animate(
    [
      { boxShadow: "0 0 0 2px var(--brand-600)", backgroundColor: "var(--brand-50)" },
      { boxShadow: "0 0 0 2px var(--brand-600)", backgroundColor: "var(--brand-50)", offset: 0.6 },
      { boxShadow: "0 0 0 2px transparent", backgroundColor: "transparent" },
    ],
    { duration: 2400, easing: "ease-out" },
  );
}

/**
 * Focus the chart item for `ref` once the tab has rendered (two animation
 * frames after the tab switch). Returns a cancel function.
 */
export function focusChartItem(ref: string | undefined, root: ParentNode = document): () => void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return () => {};
  let cancelled = false;
  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const target = ref ? findChartItem(ref, root) : null;
      const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.scrollIntoView?.({ block: "center", behavior });
        target.focus({ preventScroll: true });
        flashElement(target);
        return;
      }
      const panel = root.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
      if (panel) {
        panel.scrollIntoView?.({ block: "start", behavior });
        panel.focus({ preventScroll: true });
      }
    });
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

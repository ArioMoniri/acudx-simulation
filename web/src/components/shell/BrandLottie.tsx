import { useEffect, useRef, useState } from "react";
import lottie, { type AnimationItem } from "lottie-web/build/player/lottie_light";
import { cn } from "@/lib/cn";
import { AcuDxMark } from "./Wordmark";

/**
 * BrandLottie — the AcuDx pulse seal drawing itself in (each piece's outline
 * traces along the deflection first, then the solid fill settles in), from
 * `/brand/acudx-mark.lottie.json`.
 *
 * - Plays once with lottie-web's light SVG renderer (self-hosted, no CDN or
 *   WASM fetch, which keeps the on-prem / privacy stance of the design system).
 * - Honors `prefers-reduced-motion`: readers who opt out get the static inline
 *   SVG mark instead, so nothing moves. The static mark is also the fallback
 *   while the JSON loads and if the fetch fails.
 * - Recolours every fill and stroke to the current `--axis-clinical` token
 *   (brand blue on light, lightened blue on dark) and re-reads it when the
 *   `.dark` class flips.
 */
export function BrandLottie({
  className,
  size = 48,
  loop = false,
  title = "AcuDx",
  onComplete,
}: {
  className?: string;
  /** Rendered box in CSS px (the composition is square). */
  size?: number;
  loop?: boolean;
  title?: string;
  onComplete?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mql) return;
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced || !host.current) return;
    const el = host.current;
    let anim: AnimationItem | null = null;
    let cancelled = false;
    const ctrl = new AbortController();

    fetch("/brand/acudx-mark.lottie.json", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: unknown) => {
        if (cancelled) return;
        anim = lottie.loadAnimation({
          container: el,
          renderer: "svg",
          loop,
          autoplay: true,
          animationData: recolour(data, readStrokeColour()),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: false },
        });
        if (onComplete) anim.addEventListener("complete", onComplete);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    // Follow the theme: the token changes when `.dark` is toggled on <html>.
    const observer = new MutationObserver(() => {
      const svg = el.querySelector("svg");
      if (!svg) return;
      const colour = readStrokeColour();
      svg.querySelectorAll<SVGElement>("path").forEach((p) => {
        if (p.getAttribute("stroke") && p.getAttribute("stroke") !== "none") p.setAttribute("stroke", colour);
        if (p.getAttribute("fill") && p.getAttribute("fill") !== "none") p.setAttribute("fill", colour);
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelled = true;
      ctrl.abort();
      observer.disconnect();
      anim?.destroy();
    };
  }, [reduced, loop, onComplete]);

  if (reduced || failed) {
    return (
      <AcuDxMark
        className={cn("text-axis-clinical", className)}
        title={title}
      />
    );
  }

  return (
    <div
      ref={host}
      role="img"
      aria-label={title}
      className={cn("shrink-0 text-axis-clinical", className)}
      style={{ width: size, height: size }}
    />
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** The current `--axis-clinical` token as a CSS colour string (falls back to brand blue). */
function readStrokeColour(): string {
  if (typeof window === "undefined") return "#2563eb";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--axis-clinical").trim();
  return v || "#2563eb";
}

/** Set every fill and stroke in the Lottie document to `colour` before it is parsed. */
function recolour(data: unknown, colour: string): unknown {
  const rgb = hexToRgb01(colour);
  if (!rgb) return data;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if ((o.ty === "st" || o.ty === "fl") && o.c && typeof o.c === "object") {
        (o.c as Record<string, unknown>).k = [...rgb, 1];
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(data);
  return data;
}

function hexToRgb01(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

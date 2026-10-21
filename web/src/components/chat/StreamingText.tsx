import { useEffect, useRef, useState } from "react";

/** Characters revealed per animation frame (about 900 characters a second at 60 Hz). */
const CHARS_PER_FRAME = 15;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * StreamingText: reveals a reply progressively, word boundary by word boundary,
 * on animation frames (no timers). The full text is always in the accessibility
 * tree (sr-only) so a screen reader hears the reply once, not every frame; the
 * revealing copy is aria-hidden. Reduced motion, or `animate` false, renders the
 * whole text at once.
 */
export function StreamingText({
  text,
  animate,
  onDone,
}: {
  text: string;
  animate: boolean;
  onDone?: () => void;
}) {
  const shouldAnimate = animate && !prefersReducedMotion();
  const [shown, setShown] = useState(() => (shouldAnimate ? 0 : text.length));
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!shouldAnimate || typeof window.requestAnimationFrame !== "function") return;
    let n = 0;
    let frame = 0;
    const step = () => {
      n = Math.min(text.length, n + CHARS_PER_FRAME);
      // Extend to the end of the current word so words never appear half-typed.
      const space = text.indexOf(" ", n);
      const cut = space < 0 ? text.length : space;
      setShown(cut);
      if (cut < text.length) frame = window.requestAnimationFrame(step);
      else doneRef.current?.();
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [text, shouldAnimate]);

  const visible = shouldAnimate && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" ? shown : text.length;
  if (visible >= text.length) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, visible)}
        <span className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-muted/70" />
      </span>
    </>
  );
}

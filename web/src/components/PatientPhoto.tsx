import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowsOutSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import {
  pickPatientPhoto,
  patientPhotoUrl,
  hasPatientVideo,
  patientVideoUrl,
  type PhotoSex,
} from "@/data/patientPhotos";

/** Whether the viewer prefers reduced motion (SSR-safe, live-updating). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export interface ClinicalSignHint {
  sign: string;
  intensity: number;
}

export interface PatientPhotoProps {
  sex: PhotoSex;
  /** Patient age in years — drives which face is shown. */
  age: number;
  /** Stable seed so a given case keeps the same face across renders. */
  seed?: number;
  /** Accessible description (defaults to a synthetic-patient statement). */
  alt?: string;
  /** Physiology signs — apply a subtle clinical tint (pallor/cyanosis/sweat). */
  signs?: ClinicalSignHint[];
  /** Caption under the photo (e.g. the affect / clinical-sign summary). */
  caption?: ReactNode;
  className?: string;
  /**
   * Makes the whole photo a button. When provided, a click/Enter/Space fires it
   * (e.g. to open the enlarged PatientViewer) and — unless `expandable` is
   * explicitly false — a subtle "expand" affordance is shown in the top corner.
   */
  onClick?: () => void;
  /** Show the corner expand affordance. Defaults to true when `onClick` is set. */
  expandable?: boolean;
  /** Accessible label for the button when `onClick` is set (e.g. "Enlarge"). */
  expandLabel?: string;
}

/** Derive a subtle CSS filter + cyanosis overlay strength from the signs. */
function physiology(signs: ClinicalSignHint[] | undefined): {
  filter?: string;
  cyanosis: number;
} {
  let saturate = 1;
  let brightness = 1;
  let cyanosis = 0;
  for (const s of signs ?? []) {
    const k = s.sign.toLowerCase();
    if (k.includes("cyanos")) cyanosis = Math.max(cyanosis, s.intensity);
    if (k.includes("pallor") || k.includes("pale")) {
      saturate = Math.min(saturate, 1 - 0.45 * s.intensity);
      brightness = Math.min(1.08, brightness + 0.06 * s.intensity);
    }
    if (k.includes("diaphor") || k.includes("sweat"))
      brightness = Math.min(1.1, brightness + 0.05 * s.intensity);
  }
  const parts: string[] = [];
  if (saturate < 0.999) parts.push(`saturate(${saturate.toFixed(2)})`);
  if (Math.abs(brightness - 1) > 0.001) parts.push(`brightness(${brightness.toFixed(2)})`);
  return { filter: parts.length ? parts.join(" ") : undefined, cyanosis };
}

/**
 * A subtle, GPU-cheap "alive" idle for a STILL face: a slow breathing scale plus
 * a faint luminance breathe (~4s). Compositor-friendly (transform + filter on a
 * wrapper) and collapsed entirely under prefers-reduced-motion. The wrapper's
 * brightness composes with the img's physiology filter, so pallor/sweat tints
 * are preserved. Rendered once per photo; identical duplicate <style> tags are
 * harmless if several photos mount.
 */
const BREATHE_KEYFRAMES = `
@keyframes acudx-patient-breathe {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.015); filter: brightness(1.04); }
}`;

/**
 * PatientPhoto — the realistic synthetic patient face for a case, matched to the
 * demographic (sex + age). Physiology signs apply a subtle clinical tint. When a
 * face ships an "alive" idle loop it autoplays (muted/looping) so the patient
 * moves; otherwise the still gets a gentle breathing animation so it never looks
 * frozen. The visible "synthetic patient" label is carried by the surrounding
 * banner; here the synthetic nature stays in the accessible alt text. Static +
 * bundled: no runtime generation, air-gapped-safe.
 */
export function PatientPhoto({
  sex,
  age,
  seed = 0,
  alt,
  signs,
  caption,
  className,
  onClick,
  expandable,
  expandLabel,
}: PatientPhotoProps) {
  const photo = useMemo(() => pickPatientPhoto(sex, age, seed), [sex, age, seed]);
  const { filter, cyanosis } = useMemo(() => physiology(signs), [signs]);
  const reduced = usePrefersReducedMotion();
  // Play the "alive" idle loop when one exists for this face and motion is ok;
  // otherwise the still photo (also the video poster) stands in.
  const useVideo = hasPatientVideo(photo.id) && !reduced;
  // A still face breathes gently so it reads as alive rather than frozen.
  const breathe = !useVideo && !reduced;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Autoplay policies can leave a muted <video> paused after mount; nudge it.
  useEffect(() => {
    const v = videoRef.current;
    if (!useVideo || !v) return;
    const play = v.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
  }, [useVideo, photo.id]);

  const interactive = typeof onClick === "function";
  const showExpand = interactive && expandable !== false;

  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-control bg-monitor-border/40",
        className,
      )}
    >
      {breathe ? <style>{BREATHE_KEYFRAMES}</style> : null}
      {/* Breathing wrapper: transform/filter here compose with the media's own
          physiology filter and don't disturb the caption / overlays. */}
      <div
        className="h-full w-full"
        style={
          breathe
            ? {
                animation: "acudx-patient-breathe 4.2s ease-in-out infinite",
                willChange: "transform, filter",
                transformOrigin: "50% 40%",
              }
            : undefined
        }
      >
        {useVideo ? (
          <video
            ref={videoRef}
            src={patientVideoUrl(photo.id)}
            poster={patientPhotoUrl(photo.id)}
            aria-label={alt ?? "Synthetic patient — not a real individual"}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            className="h-full w-full object-cover"
            style={filter ? { filter } : undefined}
          />
        ) : (
          <img
            src={patientPhotoUrl(photo.id)}
            alt={alt ?? "Synthetic patient portrait — not a real individual"}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={filter ? { filter } : undefined}
            draggable={false}
          />
        )}
      </div>
      {/* Cyanosis overlay — a faint bluish cast when hypoxic (never sole cue). */}
      {cyanosis > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{
            backgroundColor: "#3b6ea5",
            opacity: Math.min(0.28, cyanosis * 0.34),
          }}
        />
      ) : null}
      {caption ? (
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-[11px] leading-tight text-white/90">
          {caption}
        </figcaption>
      ) : null}
      {/* Click-to-enlarge: the whole photo becomes a button with a subtle corner
          affordance. Keyboard operable and reduced-motion aware (no transition). */}
      {interactive ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={expandLabel ?? "Enlarge"}
          className="group absolute inset-0 z-20 flex cursor-zoom-in items-start justify-end rounded-[inherit] p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-0"
        >
          {showExpand ? (
            <span
              aria-hidden
              className="pointer-events-none inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-80 shadow-sm backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
            >
              <ArrowsOutSimple weight="bold" className="h-3 w-3" />
            </span>
          ) : null}
        </button>
      ) : null}
    </figure>
  );
}

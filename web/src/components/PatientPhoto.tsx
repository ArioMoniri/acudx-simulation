import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowsOutSimple, Waveform } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  PATIENT_PHOTOS,
  pickPatientPhoto,
  patientPhotoUrl,
  hasPatientVideo,
  patientVideoUrl,
  type PhotoSex,
} from "@/data/patientPhotos";
import { hasTalkVideo, talkVideoUrl } from "@/data/talkVideos";

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
  /**
   * Explicit portrait id (from `resolvePatientVisual`). When set it wins over the
   * sex/age/seed pick, so every surface renders the SAME unified face. Falls back
   * to the demographic pick when omitted or unknown.
   */
  photoId?: string;
  /** Accessible description (defaults to a synthetic-patient statement). */
  alt?: string;
  /** Physiology signs — apply the live clinical tint + overlays. */
  signs?: ClinicalSignHint[];
  /**
   * Live respiratory rate (breaths/min). Drives the breathing cadence so the
   * face visibly breathes faster under respiratory distress. Defaults to a calm
   * rate when omitted.
   */
  rr?: number;
  /**
   * True while the patient is speaking. Shows a clear "speaking" treatment (plays
   * the video when present, a small waveform pill, and a mouth-region shimmer).
   * A non-empty `utterance` implies speaking as well.
   */
  speaking?: boolean;
  /** The patient's current spoken line (implies speaking; used for the label). */
  utterance?: string;
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

interface Physiology {
  filter?: string;
  cyanosis: number;
  /** Diaphoresis (glossy sweat sheen) strength. */
  sweat: number;
  /** Fever flush (warm cheeks) strength. */
  flush: number;
  /** Reduced-LOC dimming/droop strength. */
  droop: number;
  /** Pallor strength (desaturate + lighten, already folded into `filter`). */
  pallor: number;
  /** Respiratory-distress strength (drives the labored breathing motion). */
  distress: number;
}

/** Max matching intensity for any of the given sign-name keywords (0..1). */
function signMax(
  signs: ClinicalSignHint[] | undefined,
  ...keywords: string[]
): number {
  let out = 0;
  for (const s of signs ?? []) {
    const k = s.sign.toLowerCase();
    if (keywords.some((w) => k.includes(w))) {
      out = Math.max(out, Math.max(0, Math.min(1, s.intensity)));
    }
  }
  return out;
}

/**
 * Derive the CSS filter + per-overlay strengths that make the live clinical
 * signs clearly VISIBLE on the face (and, unchanged, on the video). Pallor
 * desaturates + lightens; fever adds warmth + saturation; diaphoresis lifts
 * luminance under the sheen; reduced-LOC dims/flattens. Cyanosis, sweat, flush
 * and droop are also returned so the caller can paint the matching overlays.
 */
function physiology(signs: ClinicalSignHint[] | undefined): Physiology {
  const cyanosis = signMax(signs, "cyanos");
  const pallor = signMax(signs, "pallor", "pale");
  const sweat = signMax(signs, "diaphor", "sweat");
  const flush = signMax(signs, "fever", "febrile", "flush");
  const droop = signMax(signs, "loc", "droop", "drows", "responsive");
  const distress = signMax(signs, "distress", "respirat");

  let saturate = 1;
  let brightness = 1;
  let contrast = 1;
  // Pallor — wash out colour and clearly lift luminance (bloodless). Works on any
  // skin tone because it desaturates + brightens rather than tinting a colour.
  saturate -= 0.62 * pallor;
  brightness += 0.14 * pallor;
  // Fever — warmer, markedly more saturated flush across the face.
  saturate += 0.24 * flush;
  brightness += 0.03 * flush;
  // Diaphoresis — brighter under the sheen highlight (wet, glistening skin).
  brightness += 0.07 * sweat;
  // Reduced LOC — dimmer, flatter and ashen (desaturated), a less-responsive look.
  brightness -= 0.12 * droop;
  contrast -= 0.1 * droop;
  saturate -= 0.18 * droop;
  // Cyanosis — desaturate before the bluish lips/periphery overlay lands.
  saturate -= 0.14 * cyanosis;

  saturate = Math.max(0.28, Math.min(1.4, saturate));
  brightness = Math.max(0.78, Math.min(1.24, brightness));
  contrast = Math.max(0.8, Math.min(1.14, contrast));

  const parts: string[] = [];
  if (Math.abs(saturate - 1) > 0.01) parts.push(`saturate(${saturate.toFixed(2)})`);
  if (Math.abs(brightness - 1) > 0.01) parts.push(`brightness(${brightness.toFixed(2)})`);
  if (Math.abs(contrast - 1) > 0.01) parts.push(`contrast(${contrast.toFixed(2)})`);

  return {
    filter: parts.length ? parts.join(" ") : undefined,
    cyanosis,
    sweat,
    flush,
    droop,
    pallor,
    distress,
  };
}

/**
 * Subtle, GPU-cheap keyframes: a calm breathing scale, a deeper "labored" breathe
 * under respiratory distress (adds a faint shoulder lift), and a mouth-region
 * shimmer while speaking. Compositor-friendly (transform + filter) and all
 * collapsed under prefers-reduced-motion. Identical duplicate <style> tags are
 * harmless if several photos mount.
 */
const PHOTO_KEYFRAMES = `
@keyframes acudx-patient-breathe {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.024); filter: brightness(1.05); }
}
@keyframes acudx-patient-breathe-labored {
  0%, 100% { transform: scale(1) translateY(0); filter: brightness(0.99); }
  50% { transform: scale(1.042) translateY(-1.8%); filter: brightness(1.06); }
}
@keyframes acudx-patient-speak {
  0%, 100% { opacity: 0.28; transform: translateX(-50%) scaleY(0.85); }
  50% { opacity: 0.6; transform: translateX(-50%) scaleY(1.15); }
}
@keyframes acudx-patient-sheen {
  0%, 100% { opacity: calc(var(--acudx-sweat, 0.5) * 0.68); transform: translateY(0) scale(1); }
  50% { opacity: var(--acudx-sweat, 0.5); transform: translateY(-1.2%) scale(1.03); }
}`;

/** Breathing period (seconds) from the live RR, faster under distress. */
function breathePeriod(rr: number | undefined): number {
  const rrSafe = rr && rr > 0 ? Math.max(6, Math.min(45, rr)) : 16;
  return Math.max(1.3, Math.min(6, 60 / rrSafe));
}

/**
 * PatientPhoto — the realistic synthetic patient face for a case, matched to the
 * demographic (sex + age) or pinned to a unified `photoId`. The live clinical
 * signs are clearly visible: pallor / fever / diaphoresis / reduced-LOC tint the
 * face and a set of overlays paint cyanosis (bluish lips/periphery), a sweat
 * sheen, a warm fever flush and an ashen droop — on BOTH the still and the video.
 * The face breathes at the live RR (faster + labored under distress); when a face
 * ships an "alive" idle loop it autoplays, otherwise the still breathes so it is
 * never frozen. A speaking treatment (waveform pill + mouth shimmer) plays while
 * the patient talks. Static + bundled: no runtime generation, air-gapped-safe.
 */
export function PatientPhoto({
  sex,
  age,
  seed = 0,
  photoId,
  alt,
  signs,
  rr,
  speaking = false,
  utterance,
  caption,
  className,
  onClick,
  expandable,
  expandLabel,
}: PatientPhotoProps) {
  const { t } = useTranslation();
  const photo = useMemo(() => {
    if (photoId) {
      const found = PATIENT_PHOTOS.find((p) => p.id === photoId);
      if (found) return found;
    }
    return pickPatientPhoto(sex, age, seed);
  }, [photoId, sex, age, seed]);

  const physio = useMemo(() => physiology(signs), [signs]);
  const { filter, cyanosis, sweat, flush, droop, pallor, distress } = physio;
  const reduced = usePrefersReducedMotion();

  const isSpeaking = speaking || Boolean(utterance && utterance.trim().length > 0);

  // While the patient is speaking, play the photoreal talking-head loop (mouth
  // moves as if talking) when one exists for this face and motion is ok — it wins
  // over the idle loop and the still so the patient visibly talks. Reduced-motion
  // viewers keep the still with the speaking pill + shimmer instead of a clip.
  const useTalkVideo = isSpeaking && hasTalkVideo(photo.id) && !reduced;
  // Play the "alive" idle loop when one exists for this face and motion is ok;
  // otherwise the still photo (also the video poster) stands in.
  const useVideo = !useTalkVideo && hasPatientVideo(photo.id) && !reduced;
  // A still face breathes gently so it reads as alive rather than frozen.
  const breathe = !useTalkVideo && !useVideo && !reduced;
  const labored = distress > 0.35;
  const breatheAnim = breathe
    ? `${labored ? "acudx-patient-breathe-labored" : "acudx-patient-breathe"} ${breathePeriod(rr).toFixed(2)}s ease-in-out infinite`
    : undefined;

  // Diaphoresis sheen — strong enough to read as wet skin at ~0.4 intensity, and
  // gently animated so it glistens like sweat rather than sitting as a flat gloss.
  const sweatOpacity = Math.min(0.72, sweat * 0.95);
  const sheenAnimate = sweat > 0.05 && !reduced;
  // Custom property `--acudx-sweat` lets the sheen keyframe oscillate around the
  // JS-computed opacity. CSSProperties has no custom-property index signature, so
  // assert (the idiomatic pattern the React types recommend).
  const sweatStyle = {
    background:
      "radial-gradient(48% 30% at 50% 20%, rgba(255,255,255,0.72), transparent 72%), radial-gradient(32% 22% at 34% 40%, rgba(255,255,255,0.55), transparent 72%), radial-gradient(32% 22% at 66% 40%, rgba(255,255,255,0.55), transparent 72%), radial-gradient(30% 20% at 50% 58%, rgba(255,255,255,0.4), transparent 74%)",
    opacity: sweatOpacity,
    "--acudx-sweat": String(sweatOpacity),
    animation: sheenAnimate
      ? "acudx-patient-sheen 3.4s ease-in-out infinite"
      : undefined,
    willChange: sheenAnimate ? "opacity, transform" : undefined,
  } as CSSProperties;
  // Inject the shared keyframes whenever anything on the photo animates.
  const anyKeyframes = breathe || (isSpeaking && !reduced) || sheenAnimate;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Autoplay policies can leave a muted <video> paused after mount; nudge it
  // (for either the idle loop or the speaking talking-head loop).
  useEffect(() => {
    const v = videoRef.current;
    if ((!useVideo && !useTalkVideo) || !v) return;
    const play = v.play();
    if (play && typeof play.catch === "function") play.catch(() => {});
  }, [useVideo, useTalkVideo, photo.id, isSpeaking]);

  const interactive = typeof onClick === "function";
  const showExpand = interactive && expandable !== false;

  return (
    <figure
      className={cn(
        "relative overflow-hidden rounded-control bg-monitor-border/40",
        className,
      )}
    >
      {anyKeyframes ? <style>{PHOTO_KEYFRAMES}</style> : null}
      {/* Breathing wrapper: transform/filter here compose with the media's own
          physiology filter and don't disturb the caption / overlays. */}
      <div
        className="h-full w-full"
        style={
          breatheAnim
            ? {
                animation: breatheAnim,
                willChange: "transform, filter",
                transformOrigin: "50% 40%",
              }
            : undefined
        }
      >
        {useTalkVideo ? (
          <video
            key={`talk-${photo.id}`}
            ref={videoRef}
            src={talkVideoUrl(photo.id)}
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
        ) : useVideo ? (
          <video
            key={`idle-${photo.id}`}
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

      {/* Pallor — a cool, near-white glaze that lifts luminance on ANY skin tone
          (screen blend), reinforcing the desaturate/brighten filter above so the
          face reads clearly bloodless. Never the sole cue (the sign line carries it). */}
      {pallor > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={{
            background:
              "linear-gradient(to bottom, rgba(228,233,242,0.6), rgba(205,214,228,0.34))",
            opacity: Math.min(0.42, pallor * 0.52),
          }}
        />
      ) : null}

      {/* Cyanosis — full-face bluish cast plus a stronger perioral/periphery tint
          at the lower face (lips), never the sole cue. */}
      {cyanosis > 0.05 ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 mix-blend-multiply"
            style={{ backgroundColor: "#3b6ea5", opacity: Math.min(0.42, cyanosis * 0.48) }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 mix-blend-multiply"
            style={{
              background: "linear-gradient(to top, #234f86, transparent)",
              opacity: Math.min(0.72, cyanosis * 0.85),
            }}
          />
        </>
      ) : null}

      {/* Diaphoresis — a glossy, glistening sweat sheen (specular highlights on
          forehead/cheeks/upper lip) that subtly shimmers so it reads as wet skin. */}
      {sweat > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={sweatStyle}
        />
      ) : null}

      {/* Fever — a warm, saturated flush over the cheeks (and a lighter brow band). */}
      {flush > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-soft-light"
          style={{
            background:
              "radial-gradient(40% 30% at 33% 56%, rgba(226,72,58,0.95), transparent 70%), radial-gradient(40% 30% at 67% 56%, rgba(226,72,58,0.95), transparent 70%), radial-gradient(46% 20% at 50% 24%, rgba(226,96,72,0.6), transparent 74%)",
            opacity: Math.min(0.72, flush * 0.95),
          }}
        />
      ) : null}

      {/* Reduced LOC — an ashen, dimming veil weighted to the lower face. */}
      {droop > 0.05 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 mix-blend-multiply"
          style={{
            background: "linear-gradient(to bottom, rgba(44,48,58,0.18), rgba(16,18,26,0.56))",
            opacity: Math.min(0.64, droop * 0.85),
          }}
        />
      ) : null}

      {/* Speaking — mouth-region shimmer (subtle, reduced-motion-safe). */}
      {isSpeaking ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute mix-blend-soft-light"
          style={{
            left: "50%",
            bottom: "15%",
            width: "38%",
            height: "16%",
            transform: "translateX(-50%)",
            borderRadius: "9999px",
            background: "radial-gradient(closest-side, rgba(255,255,255,0.5), transparent)",
            animation: reduced ? undefined : "acudx-patient-speak 0.5s ease-in-out infinite",
            opacity: reduced ? 0.4 : undefined,
          }}
        />
      ) : null}

      {/* Speaking pill (top-left; the expand affordance owns the top-right). */}
      {isSpeaking ? (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-pill bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm">
          <Waveform weight="bold" className="h-3 w-3" aria-hidden />
          {t("avatar3d.speaking", { defaultValue: "Speaking" })}
        </span>
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

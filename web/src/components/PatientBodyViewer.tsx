/**
 * AcuDx — PatientBodyViewer: the photoreal, interactive full-body patient.
 *
 * A set of consistent photoreal images of the SAME patient at several angles
 * (front / right / back / left …) is presented as a draggable turntable: drag
 * left/right to turn the patient around, scroll or pinch to zoom in and pan, and
 * examine condition-specific FINDING markers pinned to the body. Live physiology
 * (pallor / cyanosis / diaphoresis) tints the skin so the picture matches the
 * clinical state. Photoreal (real generated photos, not a cartoon 3D mesh),
 * air-gapped (bundled images), education only. Synthetic patient.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsOutSimple,
  ArrowClockwise,
  ArrowCounterClockwise,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
} from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import type { ClinicalSignHint } from "@/components/PatientPhoto";

/** A finding pinned to one angle of the body. */
export interface BodyFinding {
  id: string;
  /** Which spin frame it's visible on (index into `frames`). */
  frame: number;
  /** Position on the image, 0..1 (x from left, y from top). */
  x: number;
  y: number;
  label: string;
  tone?: "finding" | "critical";
}

export interface PatientBodyViewerProps {
  /** Photoreal images of the SAME patient, in clockwise spin order. */
  frames: string[];
  /** Human labels per frame (e.g. Front / Right / Back / Left) for the readout. */
  frameLabels?: string[];
  signs?: ClinicalSignHint[];
  findings?: BodyFinding[];
  onFindingClick?: (id: string) => void;
  alt?: string;
  caption?: ReactNode;
  className?: string;
}

function signMax(signs: ClinicalSignHint[] | undefined, ...keys: string[]): number {
  let out = 0;
  for (const s of signs ?? []) {
    const k = s.sign.toLowerCase();
    if (keys.some((w) => k.includes(w))) out = Math.max(out, Math.max(0, Math.min(1, s.intensity)));
  }
  return out;
}

/** CSS filter that makes pallor / fever / diaphoresis / reduced-LOC read on the skin. */
function physioFilter(signs: ClinicalSignHint[] | undefined): string | undefined {
  const pallor = signMax(signs, "pallor", "pale");
  const cyanosis = signMax(signs, "cyanos");
  const fever = signMax(signs, "fever", "febrile", "flush");
  const droop = signMax(signs, "loc", "droop", "drows");
  const sweat = signMax(signs, "diaphor", "sweat");
  let sat = 1 - 0.6 * pallor - 0.14 * cyanosis + 0.22 * fever;
  let bri = 1 + 0.13 * pallor + 0.05 * sweat - 0.12 * droop;
  let con = 1 - 0.1 * droop;
  sat = Math.max(0.3, Math.min(1.3, sat));
  bri = Math.max(0.82, Math.min(1.22, bri));
  con = Math.max(0.82, Math.min(1.1, con));
  const parts: string[] = [];
  if (Math.abs(sat - 1) > 0.01) parts.push(`saturate(${sat.toFixed(2)})`);
  if (Math.abs(bri - 1) > 0.01) parts.push(`brightness(${bri.toFixed(2)})`);
  if (Math.abs(con - 1) > 0.01) parts.push(`contrast(${con.toFixed(2)})`);
  return parts.length ? parts.join(" ") : undefined;
}

const DRAG_STEP_PX = 42; // horizontal pixels per angle step

export function PatientBodyViewer({
  frames,
  frameLabels,
  signs,
  findings,
  onFindingClick,
  alt,
  caption,
  className,
}: PatientBodyViewerProps) {
  const { t } = useTranslation();
  const [frame, setFrame] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const drag = useRef<{ x: number; y: number; acc: number; panning: boolean } | null>(null);
  const n = frames.length || 1;

  const filter = useMemo(() => physioFilter(signs), [signs]);
  const cyan = signMax(signs, "cyanos");
  const sweat = signMax(signs, "diaphor", "sweat");

  const stepFrame = useCallback(
    (dir: number) => setFrame((f) => (((f + dir) % n) + n) % n),
    [n],
  );

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, acc: 0, panning: zoom > 1.02 };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.panning) {
      // Zoomed in → drag pans the image.
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    // Otherwise → drag spins the turntable.
    d.acc += dx;
    while (d.acc <= -DRAG_STEP_PX) { stepFrame(1); d.acc += DRAG_STEP_PX; }
    while (d.acc >= DRAG_STEP_PX) { stepFrame(-1); d.acc -= DRAG_STEP_PX; }
  };
  const onPointerUp = () => { drag.current = null; };

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(1, Math.min(3.5, z - e.deltaY * 0.0015)));
  };
  const zoomBy = (d: number) => setZoom((z) => {
    const nz = Math.max(1, Math.min(3.5, z + d));
    if (nz <= 1.02) setPan({ x: 0, y: 0 });
    return nz;
  });

  const label = frameLabels?.[frame] ?? `${frame * Math.round(360 / n)}°`;
  const shownFindings = (findings ?? []).filter((f) => f.frame === frame);

  return (
    <figure
      className={cn(
        "relative select-none overflow-hidden rounded-control bg-monitor-border/30",
        className,
      )}
    >
      <div
        className="h-full w-full touch-none"
        style={{ cursor: zoom > 1.02 ? "grab" : "ew-resize" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div
          className="h-full w-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: drag.current ? "none" : "transform 0.15s ease-out",
          }}
        >
          <img
            src={frames[frame]}
            alt={alt ?? "Synthetic patient — full body"}
            draggable={false}
            className="h-full w-full object-contain"
            style={filter ? { filter } : undefined}
          />
          {/* Cyanosis / diaphoresis tints ride the image so they scale with zoom. */}
          {cyan > 0.05 ? (
            <span aria-hidden className="pointer-events-none absolute inset-0 mix-blend-multiply"
              style={{ backgroundColor: "#3b6ea5", opacity: Math.min(0.28, cyan * 0.3) }} />
          ) : null}
          {sweat > 0.05 ? (
            <span aria-hidden className="pointer-events-none absolute inset-0 mix-blend-screen"
              style={{ background: "radial-gradient(45% 22% at 50% 16%, rgba(255,255,255,0.5), transparent 70%)", opacity: Math.min(0.5, sweat * 0.7) }} />
          ) : null}
          {/* Finding markers for this angle. */}
          {shownFindings.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); onFindingClick?.(f.id); }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm backdrop-blur-sm"
              style={{
                left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                borderColor: f.tone === "critical" ? "rgba(217,119,6,0.95)" : "rgba(45,212,191,0.95)",
                background: f.tone === "critical" ? "rgba(120,53,15,0.8)" : "rgba(6,60,55,0.8)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Angle readout + spin controls (top-left) */}
      <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 flex items-center gap-1">
        <button type="button" onClick={() => stepFrame(-1)} aria-label={t("bodyviewer.turnLeft", { defaultValue: "Turn left" })}
          className="pointer-events-auto grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70">
          <ArrowCounterClockwise weight="bold" className="h-3.5 w-3.5" />
        </button>
        <span className="rounded-pill bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">{label}</span>
        <button type="button" onClick={() => stepFrame(1)} aria-label={t("bodyviewer.turnRight", { defaultValue: "Turn right" })}
          className="pointer-events-auto grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70">
          <ArrowClockwise weight="bold" className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Zoom controls (top-right) */}
      <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1">
        <button type="button" onClick={() => zoomBy(-0.5)} aria-label={t("bodyviewer.zoomOut", { defaultValue: "Zoom out" })}
          className="grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70">
          <MagnifyingGlassMinus weight="bold" className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => zoomBy(0.5)} aria-label={t("bodyviewer.zoomIn", { defaultValue: "Zoom in" })}
          className="grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/70">
          <MagnifyingGlassPlus weight="bold" className="h-3.5 w-3.5" />
        </button>
      </div>

      <span className="pointer-events-none absolute bottom-1.5 right-1.5 z-20 inline-flex items-center gap-1 rounded-pill bg-black/50 px-1.5 py-0.5 text-[9px] font-medium text-white/90 backdrop-blur-sm">
        <ArrowsOutSimple weight="bold" className="h-3 w-3" aria-hidden />
        {t("bodyviewer.hint", { defaultValue: "Drag to turn · scroll to zoom" })}
      </span>

      {caption ? (
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-[11px] leading-tight text-white/90">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export default PatientBodyViewer;

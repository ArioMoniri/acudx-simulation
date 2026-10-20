import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, Scan, Warning } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import {
  ATLAS_ATTRIBUTION,
  atlasImageUrl,
  type AtlasOrgan,
  type AtlasSlice,
} from "@/data/anatomyAtlas";

/** The three radiological cutting planes, derived straight from the data. */
export type AtlasPlane = AtlasSlice["plane"];

const PLANES: readonly AtlasPlane[] = ["axial", "coronal", "sagittal"];

/**
 * Orientation markers per plane (radiological convention — the data was
 * rendered this way). Each entry is the single letter shown on that edge:
 *   axial    → A(nterior) top, P(osterior) bottom, R(ight) left, L(eft) right
 *   coronal  → S(uperior) top, I(nferior) bottom, R left, L right
 *   sagittal → S top, I bottom, A(nterior) left, P(osterior) right
 */
const ORIENTATION: Record<
  AtlasPlane,
  { top: string; bottom: string; left: string; right: string }
> = {
  axial: { top: "A", bottom: "P", left: "R", right: "L" },
  coronal: { top: "S", bottom: "I", left: "R", right: "L" },
  sagittal: { top: "S", bottom: "I", left: "A", right: "P" },
};

/* Shared dark "PACS toolbar" segmented styling, reused by the plane selector
   (Radix Tabs) and the window-preset group so both read as one control set. */
const SEG_LIST =
  "inline-flex items-center gap-1 rounded-control border border-monitor-border " +
  "bg-[color-mix(in_srgb,var(--monitor-fg)_5%,transparent)] p-1";
const SEG_ITEM =
  "inline-flex min-h-8 items-center justify-center rounded-chip px-3 py-1.5 " +
  "text-xs font-medium uppercase tracking-wide transition-colors duration-150 " +
  "ease-out focus-visible:outline-none text-monitor-dim hover:text-monitor-fg";
const SEG_ITEM_ON =
  "bg-[color-mix(in_srgb,var(--monitor-fg)_15%,transparent)] text-monitor-fg";

export interface CrossSectionViewerProps {
  /** The slice currently on screen (already resolved for plane + level). */
  slice: AtlasSlice;
  plane: AtlasPlane;
  /** 0-based position within the current plane's sorted slice stack. */
  levelIndex: number;
  /** Number of slices in the current plane (scrubber range). */
  sliceCount: number;
  /** Active window preset id (e.g. "abdomen" | "bone"). */
  preset: string;
  /** Available window presets, in order. */
  presets: readonly string[];
  organs: readonly AtlasOrgan[];
  /** Organ ids whose overlay is currently switched on. */
  visibleOrgans: ReadonlySet<string>;
  /** Organ highlighted right now (hover wins over the sticky selection). */
  activeOrgan: string | null;
  onPlaneChange: (plane: AtlasPlane) => void;
  onLevelChange: (index: number) => void;
  onPresetChange: (preset: string) => void;
  onHoverOrgan: (id: string | null) => void;
  onSelectOrgan: (id: string) => void;
  className?: string;
}

/**
 * CrossSectionViewer — a dark, PACS-style teaching viewer for real segmented
 * CT cross-sections. The frame stays dark in both themes via the `--monitor-*`
 * tokens (matching {@link ConditionImage}). It layers an absolutely-positioned
 * SVG overlay — one contour per organ, stroked in the organ's own color — over
 * the windowed slice PNG, with orientation markers correct per plane and a
 * permanent education-only / attribution footer.
 *
 * All state is owned by the page; this component is presentational + emits
 * intent through its callbacks, so the legend and lessons can drive it too.
 */
export function CrossSectionViewer({
  slice,
  plane,
  levelIndex,
  sliceCount,
  preset,
  presets,
  organs,
  visibleOrgans,
  activeOrgan,
  onPlaneChange,
  onLevelChange,
  onPresetChange,
  onHoverOrgan,
  onSelectOrgan,
  className,
}: CrossSectionViewerProps) {
  const { t } = useTranslation();

  const organById = useMemo(
    () => new Map(organs.map((o) => [o.id, o] as const)),
    [organs],
  );

  const planeLabels: Record<AtlasPlane, string> = {
    axial: t("atlas.plane.axial", { defaultValue: "Axial" }),
    coronal: t("atlas.plane.coronal", { defaultValue: "Coronal" }),
    sagittal: t("atlas.plane.sagittal", { defaultValue: "Sagittal" }),
  };

  const presetLabel = (id: string): string =>
    t(`atlas.window.${id}`, {
      defaultValue: id.charAt(0).toUpperCase() + id.slice(1),
    });

  const dirTitle: Record<string, string> = {
    A: t("atlas.dir.A", { defaultValue: "Anterior" }),
    P: t("atlas.dir.P", { defaultValue: "Posterior" }),
    R: t("atlas.dir.R", { defaultValue: "Right" }),
    L: t("atlas.dir.L", { defaultValue: "Left" }),
    S: t("atlas.dir.S", { defaultValue: "Superior" }),
    I: t("atlas.dir.I", { defaultValue: "Inferior" }),
  };

  const marks = ORIENTATION[plane];
  const src =
    slice.src[preset] ?? slice.src.abdomen ?? Object.values(slice.src)[0] ?? "";

  const overlayLabel = t("atlas.overlayLabel", {
    defaultValue:
      "{{plane}} CT cross-section, slice {{n}} of {{total}}, with organ segmentation overlays",
    plane: planeLabels[plane],
    n: levelIndex + 1,
    total: sliceCount,
  });

  return (
    <figure
      className={cn(
        "flex flex-col overflow-hidden rounded-card border bg-monitor-bg text-monitor-fg",
        "border-monitor-border shadow-soft-md",
        className,
      )}
    >
      {/* Viewer chrome header */}
      <div className="flex items-center gap-2 border-b border-monitor-border px-4 py-2.5">
        <Scan
          weight="duotone"
          className="h-4 w-4 shrink-0 text-monitor-online"
          aria-hidden
        />
        <span className="truncate font-mono text-xs uppercase tracking-wide text-monitor-fg">
          {t("atlas.viewerTitle", { defaultValue: "Cross-section viewer" })}
        </span>
        <span className="ms-auto inline-flex items-center gap-1 rounded-chip bg-[color-mix(in_srgb,var(--monitor-fg)_8%,transparent)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-monitor-dim">
          {t("atlas.teachingTag", { defaultValue: "Teaching CT" })}
        </span>
      </div>

      {/* Controls: plane selector + window preset */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-monitor-border px-4 py-3">
        {/* Plane selector: a pressed-button group (not Radix Tabs) because the
            planes switch the slice in place and have no tab panels of their own;
            a tablist whose triggers control nothing fails aria-valid-attr-value. */}
        <div
          role="group"
          aria-label={t("atlas.planeGroup", {
            defaultValue: "Cross-section plane",
          })}
          className={SEG_LIST}
        >
          {PLANES.map((p) => {
            const on = p === plane;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => onPlaneChange(p)}
                className={cn(SEG_ITEM, on && SEG_ITEM_ON)}
              >
                {planeLabels[p]}
              </button>
            );
          })}
        </div>

        <div
          role="group"
          aria-label={t("atlas.windowGroup", { defaultValue: "Window preset" })}
          className={SEG_LIST}
        >
          {presets.map((p) => {
            const on = p === preset;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                title={t(`atlas.window.${p}.hint`, {
                  defaultValue:
                    p === "bone"
                      ? "Bone window — brightens the skeleton"
                      : "Soft-tissue window — organs read clearly",
                })}
                onClick={() => onPresetChange(p)}
                className={cn(SEG_ITEM, on && SEG_ITEM_ON)}
              >
                {presetLabel(p)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Image stage — dark bezel gives the orientation markers room */}
      <div className="relative bg-monitor-bg p-8 sm:p-10">
        <div
          className="relative mx-auto w-full"
          style={{
            maxWidth: "40rem",
            aspectRatio: `${slice.width} / ${slice.height}`,
          }}
        >
          <img
            src={atlasImageUrl(src)}
            alt={t("atlas.imageAlt", {
              defaultValue: "Cross-sectional CT teaching image",
            })}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain"
          />

          <svg
            role="img"
            aria-label={overlayLabel}
            viewBox={`0 0 ${slice.width} ${slice.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full"
          >
            {slice.contours.map((contour, i) => {
              const organ = organById.get(contour.organId);
              if (!organ || !visibleOrgans.has(contour.organId)) return null;
              const isActive = activeOrgan === contour.organId;
              const dimmed = activeOrgan != null && !isActive;
              return (
                <path
                  key={`${contour.organId}-${i}`}
                  d={contour.path}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer transition-[fill-opacity,stroke-opacity,stroke-width] duration-150 ease-out [outline:none]"
                  style={{
                    fill: organ.color,
                    stroke: organ.color,
                    fillOpacity: isActive ? 0.42 : dimmed ? 0.05 : 0.16,
                    strokeOpacity: dimmed ? 0.4 : 1,
                    strokeWidth: isActive ? 2.25 : 1.5,
                  }}
                  onMouseEnter={() => onHoverOrgan(contour.organId)}
                  onMouseLeave={() => onHoverOrgan(null)}
                  onClick={() => onSelectOrgan(contour.organId)}
                />
              );
            })}
          </svg>

          {/* Orientation markers, centered on the image edges, sitting in the
              bezel gap via a self-sized translate so they track any width. */}
          <OrientationMark
            className="left-1/2 top-0 -translate-x-1/2 -translate-y-[150%]"
            letter={marks.top}
            title={dirTitle[marks.top]}
          />
          <OrientationMark
            className="bottom-0 left-1/2 -translate-x-1/2 translate-y-[150%]"
            letter={marks.bottom}
            title={dirTitle[marks.bottom]}
          />
          <OrientationMark
            className="left-0 top-1/2 -translate-x-[150%] -translate-y-1/2"
            letter={marks.left}
            title={dirTitle[marks.left]}
          />
          <OrientationMark
            className="right-0 top-1/2 translate-x-[150%] -translate-y-1/2"
            letter={marks.right}
            title={dirTitle[marks.right]}
          />
        </div>
      </div>

      {/* Level scrubber */}
      <div className="flex items-center gap-3 border-t border-monitor-border px-4 py-3">
        <span className="eyebrow shrink-0 text-monitor-dim">
          {t("atlas.level", { defaultValue: "Level" })}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, sliceCount - 1)}
          step={1}
          value={levelIndex}
          onChange={(e) => onLevelChange(Number(e.target.value))}
          aria-label={t("atlas.levelSlider", {
            defaultValue: "Slice level",
          })}
          aria-valuetext={t("atlas.levelValue", {
            defaultValue: "Slice {{n}} of {{total}}",
            n: levelIndex + 1,
            total: sliceCount,
          })}
          className="h-4 min-w-0 flex-1 cursor-pointer"
          style={{ accentColor: "var(--monitor-online)" }}
        />
        <span className="shrink-0 font-mono text-xs tabular-nums text-monitor-fg">
          {levelIndex + 1} / {sliceCount}
        </span>
      </div>

      {/* Mandatory education-only + attribution footer (always visible) */}
      <figcaption className="space-y-1.5 border-t border-monitor-border px-4 py-3">
        <p className="flex items-center gap-1.5 font-mono text-[11px] leading-tight text-monitor-dim">
          <Warning weight="fill" className="h-3 w-3 shrink-0" aria-hidden />
          {t("atlas.disclaimer", {
            defaultValue:
              "Teaching image — synthetic, education only. Not a real patient study.",
          })}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-monitor-dim">
          <span className="min-w-0 max-w-full truncate">
            <span className="text-monitor-dim">
              {t("atlas.attribution", { defaultValue: "Source" })}:
            </span>{" "}
            <span className="text-monitor-fg">{ATLAS_ATTRIBUTION.author}</span>
          </span>
          <span>
            <span className="text-monitor-dim">
              {t("atlas.license", { defaultValue: "License" })}:
            </span>{" "}
            <span className="text-monitor-fg">{ATLAS_ATTRIBUTION.license}</span>
          </span>
          <a
            href={ATLAS_ATTRIBUTION.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-chip text-monitor-online underline decoration-dotted underline-offset-2 hover:text-monitor-fg"
          >
            {t("atlas.viewSource", { defaultValue: "View source" })}
            <ArrowSquareOut className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </figcaption>
    </figure>
  );
}

/** A single orientation letter, positioned on the bezel by the caller. */
function OrientationMark({
  letter,
  title,
  className,
}: {
  letter: string;
  title: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "pointer-events-none absolute grid h-5 w-5 place-items-center rounded-chip",
        "font-mono text-[11px] font-semibold leading-none text-monitor-dim",
        className,
      )}
    >
      {letter}
    </span>
  );
}

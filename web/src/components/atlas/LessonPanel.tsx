import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Compass, GraduationCap, Sliders, Target } from "@phosphor-icons/react";

import { cn } from "@/lib/cn";
import { Card, SectionLabel } from "@/components/ui";
import type { AtlasOrgan } from "@/data/anatomyAtlas";
import type { AtlasPlane } from "./CrossSectionViewer";

const PLANES: readonly AtlasPlane[] = ["axial", "coronal", "sagittal"];
/** Organs the "find the organs" lesson offers as locate targets. */
const LOCATE_IDS: readonly string[] = [
  "liver",
  "spleen",
  "kidney_left",
  "aorta",
];

export interface LessonPanelProps {
  organs: readonly AtlasOrgan[];
  plane: AtlasPlane;
  selectedOrgan: string | null;
  onSelectPlane: (plane: AtlasPlane) => void;
  /** Jump the viewer to a slice that shows the organ + highlight it. */
  onFocusOrgan: (id: string) => void;
  className?: string;
}

/**
 * LessonPanel — a few short, self-contained guided lessons that turn the viewer
 * into a lesson surface rather than a passive picture. Each lesson is real and
 * interactive: switching planes, or locating a named organ. No external content,
 * no back-end — just the reasoning a first radiology session needs.
 */
export function LessonPanel({
  organs,
  plane,
  selectedOrgan,
  onSelectPlane,
  onFocusOrgan,
  className,
}: LessonPanelProps) {
  const { t } = useTranslation();

  const planeLabels: Record<AtlasPlane, string> = {
    axial: t("atlas.plane.axial", { defaultValue: "Axial" }),
    coronal: t("atlas.plane.coronal", { defaultValue: "Coronal" }),
    sagittal: t("atlas.plane.sagittal", { defaultValue: "Sagittal" }),
  };

  const locateOrgans = LOCATE_IDS.map((id) =>
    organs.find((o) => o.id === id),
  ).filter((o): o is AtlasOrgan => Boolean(o));

  return (
    <Card padding="sm" className={cn("flex flex-col gap-4", className)}>
      <SectionLabel icon={<GraduationCap weight="duotone" className="h-4 w-4" />}>
        {t("atlas.lessons.title", { defaultValue: "Guided lessons" })}
      </SectionLabel>

      {/* Lesson 1 — cross-section directions */}
      <Lesson
        icon={<Compass weight="duotone" className="h-4 w-4 text-brand" />}
        title={t("atlas.lesson.directions.title", {
          defaultValue: "Cross-section directions",
        })}
        body={t("atlas.lesson.directions.body", {
          defaultValue:
            "Radiology cuts the body three ways. Axial slices across it (as if looking up from the feet), coronal separates front from back, and sagittal separates left from right. The letters around the frame — R/L, A/P, S/I — mark right/left, anterior/posterior and superior/inferior.",
        })}
      >
        <div className="flex flex-wrap gap-1.5">
          {PLANES.map((p) => {
            const on = p === plane;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => onSelectPlane(p)}
                className={cn(
                  "rounded-control border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none",
                  on
                    ? "border-brand bg-brand-tint text-brand"
                    : "border-border bg-surface text-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                {planeLabels[p]}
              </button>
            );
          })}
        </div>
      </Lesson>

      {/* Lesson 2 — find the organs */}
      <Lesson
        icon={<Target weight="duotone" className="h-4 w-4 text-brand" />}
        title={t("atlas.lesson.locate.title", {
          defaultValue: "Find the organs",
        })}
        body={t("atlas.lesson.locate.body", {
          defaultValue:
            "Pick an organ below — the viewer jumps to a slice where it appears and highlights its outline. Try to trace its shape yourself before you check the legend.",
        })}
      >
        <div className="flex flex-wrap gap-1.5">
          {locateOrgans.map((organ) => {
            const label = t(organ.labelKey, { defaultValue: organ.label });
            const on = selectedOrgan === organ.id;
            return (
              <button
                key={organ.id}
                type="button"
                aria-pressed={on}
                onClick={() => onFocusOrgan(organ.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none",
                  on
                    ? "border-brand bg-brand-tint text-brand"
                    : "border-border bg-surface text-muted hover:bg-bg-subtle hover:text-fg",
                )}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-black/15"
                  style={{ backgroundColor: organ.color }}
                />
                {label}
              </button>
            );
          })}
        </div>
      </Lesson>

      {/* Lesson 3 — reading windows */}
      <Lesson
        icon={<Sliders weight="duotone" className="h-4 w-4 text-brand" />}
        title={t("atlas.lesson.windows.title", {
          defaultValue: "Reading windows",
        })}
        body={t("atlas.lesson.windows.body", {
          defaultValue:
            "The same scan can be shown with different windows. The abdomen (soft-tissue) window makes organs like the liver and spleen readable; the bone window brightens the skeleton so you can study the vertebra. Switch the window above the image to compare the two.",
        })}
      />
    </Card>
  );
}

function Lesson({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        {title}
      </h3>
      <p className="text-[13px] leading-snug text-muted">{body}</p>
      {children}
    </section>
  );
}

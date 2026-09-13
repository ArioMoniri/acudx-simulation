import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageContainer, PageHeader } from "@/components/shell";
import {
  CrossSectionViewer,
  LessonPanel,
  OrganLegend,
  type AtlasPlane,
} from "@/components/atlas";
import {
  ATLAS_ORGANS,
  ATLAS_PRESETS,
  ATLAS_SLICES,
} from "@/data/anatomyAtlas";

const PLANE_ORDER: readonly AtlasPlane[] = ["axial", "coronal", "sagittal"];

/**
 * AtlasPage — the Anatomy Atlas learning section. A cross-sectional CT viewer
 * with per-organ segmentation overlays, framed like a radiology teaching tool.
 *
 * This page owns all shared state (plane, per-plane level, window preset, organ
 * visibility, and the highlighted organ) so the three panels stay in lock-step:
 * a LessonPanel that can drive the viewer, the CrossSectionViewer itself, and an
 * OrganLegend that toggles overlays and reflects what the current slice shows.
 */
export function AtlasPage() {
  const { t } = useTranslation();

  const [plane, setPlane] = useState<AtlasPlane>("axial");
  const [levelByPlane, setLevelByPlane] = useState<Record<AtlasPlane, number>>({
    axial: 0,
    coronal: 0,
    sagittal: 0,
  });
  const [preset, setPreset] = useState<string>(ATLAS_PRESETS[0] ?? "abdomen");
  const [visibleOrgans, setVisibleOrgans] = useState<Set<string>>(
    () => new Set(ATLAS_ORGANS.map((o) => o.id)),
  );
  const [selectedOrgan, setSelectedOrgan] = useState<string | null>(null);
  const [hoverOrgan, setHoverOrgan] = useState<string | null>(null);

  /** Hover wins over the sticky selection for the on-screen highlight. */
  const activeOrgan = hoverOrgan ?? selectedOrgan;

  /** Slices for the current plane, sorted by their acquisition index. */
  const planeSlices = useMemo(
    () =>
      ATLAS_SLICES.filter((s) => s.plane === plane).sort(
        (a, b) => a.index - b.index,
      ),
    [plane],
  );

  const levelIndex = Math.min(
    levelByPlane[plane],
    Math.max(0, planeSlices.length - 1),
  );
  const slice = planeSlices[levelIndex] ?? planeSlices[0];

  const presentOrganIds = useMemo(
    () => new Set(slice?.organs ?? []),
    [slice],
  );

  const handleLevelChange = useCallback(
    (index: number) => {
      setLevelByPlane((prev) => ({ ...prev, [plane]: index }));
    },
    [plane],
  );

  const toggleOrgan = useCallback((id: string) => {
    setVisibleOrgans((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectOrgan = useCallback((id: string) => {
    setSelectedOrgan((current) => (current === id ? null : id));
  }, []);

  const showAll = useCallback(() => {
    setVisibleOrgans(new Set(ATLAS_ORGANS.map((o) => o.id)));
  }, []);

  const hideAll = useCallback(() => {
    setVisibleOrgans(new Set());
  }, []);

  /**
   * Locate an organ for a lesson: make sure it's overlaid, then move the viewer
   * to a plane + slice where it actually appears, and highlight it.
   */
  const focusOrgan = useCallback(
    (id: string) => {
      setVisibleOrgans((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      setSelectedOrgan(id);

      const currentHasOrgan = planeSlices.some((s) => s.organs.includes(id));
      const targetPlane = currentHasOrgan
        ? plane
        : PLANE_ORDER.find((p) =>
            ATLAS_SLICES.some((s) => s.plane === p && s.organs.includes(id)),
          ) ?? plane;

      const targetSlices = ATLAS_SLICES.filter(
        (s) => s.plane === targetPlane,
      ).sort((a, b) => a.index - b.index);
      const targetIndex = Math.max(
        0,
        targetSlices.findIndex((s) => s.organs.includes(id)),
      );

      setPlane(targetPlane);
      setLevelByPlane((prev) => ({ ...prev, [targetPlane]: targetIndex }));
    },
    [plane, planeSlices],
  );

  if (!slice) return null;

  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t("atlas.eyebrow", { defaultValue: "Learn · Radiology" })}
        title={t("atlas.title", { defaultValue: "Anatomy atlas" })}
        description={t("atlas.description", {
          defaultValue:
            "Step through real segmented CT cross-sections, switch planes and windows, and toggle organ overlays to learn how the abdomen looks slice by slice.",
        })}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)_16rem]">
        <div className="order-3 lg:order-1 lg:self-start">
          <LessonPanel
            organs={ATLAS_ORGANS}
            plane={plane}
            selectedOrgan={selectedOrgan}
            onSelectPlane={setPlane}
            onFocusOrgan={focusOrgan}
          />
        </div>

        <div className="order-1 min-w-0 lg:order-2">
          <CrossSectionViewer
            slice={slice}
            plane={plane}
            levelIndex={levelIndex}
            sliceCount={planeSlices.length}
            preset={preset}
            presets={ATLAS_PRESETS}
            organs={ATLAS_ORGANS}
            visibleOrgans={visibleOrgans}
            activeOrgan={activeOrgan}
            onPlaneChange={setPlane}
            onLevelChange={handleLevelChange}
            onPresetChange={setPreset}
            onHoverOrgan={setHoverOrgan}
            onSelectOrgan={selectOrgan}
          />
        </div>

        <div className="order-2 lg:order-3 lg:self-start">
          <OrganLegend
            organs={ATLAS_ORGANS}
            visibleOrgans={visibleOrgans}
            presentOrganIds={presentOrganIds}
            activeOrgan={activeOrgan}
            selectedOrgan={selectedOrgan}
            onToggle={toggleOrgan}
            onSelect={selectOrgan}
            onHover={setHoverOrgan}
            onShowAll={showAll}
            onHideAll={hideAll}
          />
        </div>
      </div>
    </PageContainer>
  );
}

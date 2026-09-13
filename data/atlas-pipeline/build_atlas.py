#!/usr/bin/env python3
"""
Offline atlas builder — turns one REAL segmented CT (TotalSegmentator example,
CC-BY-4.0) into the AcuDx anatomy-atlas assets: windowed PNG cross-sections in
axial/coronal/sagittal + per-organ SVG contour overlays, emitted as
web/public/atlas/*.png + web/src/data/anatomyAtlas.ts.

Run once (venv with numpy/pillow/nibabel/scikit-image); commit the outputs.
No model / torch — it only reslices + windows + traces existing masks.
"""
from __future__ import annotations
import json, pathlib
import numpy as np
import nibabel as nib
from PIL import Image
from skimage import measure

HERE = pathlib.Path(__file__).parent
RAW = HERE / "raw"
REPO = HERE.parent.parent  # acudx-simulation/
OUT_PNG = REPO / "web" / "public" / "atlas"
OUT_TS = REPO / "web" / "src" / "data" / "anatomyAtlas.ts"
OUT_PNG.mkdir(parents=True, exist_ok=True)

TARGET = 480  # px on the larger physical dimension (isotropic display)
LEVELS_PER_PLANE = 9

# mask filename(s) -> (organ id, English label, hex color). Lobes/vertebrae merged.
ORGANS: list[tuple[list[str], str, str, str]] = [
    (["liver"], "liver", "Liver", "#c1666b"),
    (["spleen"], "spleen", "Spleen", "#8e6cb0"),
    (["pancreas"], "pancreas", "Pancreas", "#e0913a"),
    (["stomach"], "stomach", "Stomach", "#2a9d8f"),
    (["kidney_left"], "kidney_left", "Left kidney", "#3d7ea6"),
    (["kidney_right"], "kidney_right", "Right kidney", "#5aa9d6"),
    (["gallbladder"], "gallbladder", "Gallbladder", "#3fae6b"),
    (["aorta"], "aorta", "Aorta", "#c0392b"),
    (["inferior_vena_cava"], "ivc", "Inferior vena cava", "#34568b"),
    (["adrenal_gland_left", "adrenal_gland_right"], "adrenals", "Adrenal glands", "#d97b29"),
    (["esophagus"], "esophagus", "Esophagus", "#9b6dd0"),
    (["duodenum"], "duodenum", "Duodenum", "#e6a532"),
    (["colon"], "colon", "Colon", "#8a8f98"),
    (["lung_upper_lobe_left", "lung_lower_lobe_left", "lung_upper_lobe_right",
      "lung_middle_lobe_right", "lung_lower_lobe_right"], "lungs", "Lungs", "#5dade2"),
    (["vertebrae_T12", "vertebrae_L1", "vertebrae_L2", "vertebrae_L3"], "vertebra", "Vertebra", "#9aa3ad"),
]

# HU window presets (label, level, width).
PRESETS = {"abdomen": (50, 400), "bone": (400, 1800)}


def load_canonical(path: pathlib.Path) -> nib.Nifti1Image:
    return nib.as_closest_canonical(nib.load(str(path)))


def display_2d(vol: np.ndarray, plane: str, idx: int) -> np.ndarray:
    """Extract a slice in radiological display orientation (A up, patient-R left
    for axial/coronal; S up, A left for sagittal)."""
    if plane == "axial":      # fix Z; rows=Y(anterior top), cols=X(right left)
        s = vol[:, :, idx]                     # (X, Y)
        return np.flipud(np.fliplr(s.T))       # (Y, X)
    if plane == "coronal":    # fix Y; rows=Z(sup top), cols=X(right left)
        s = vol[:, idx, :]                     # (X, Z)
        return np.flipud(np.fliplr(s.T))       # (Z, X)
    # sagittal: fix X; rows=Z(sup top), cols=Y(anterior left)
    s = vol[idx, :, :]                          # (Y, Z)
    return np.flipud(np.fliplr(s.T))           # (Z, Y)


def plane_spacing(zooms: tuple, plane: str) -> tuple[float, float]:
    """(col_mm, row_mm) physical spacing for the displayed 2D slice."""
    zx, zy, zz = zooms[:3]
    if plane == "axial":   return zx, zy   # cols=X, rows=Y
    if plane == "coronal": return zx, zz   # cols=X, rows=Z
    return zy, zz                          # sagittal: cols=Y, rows=Z


def resize_to(arr: np.ndarray, size: tuple[int, int], nearest: bool) -> np.ndarray:
    img = Image.fromarray(arr)
    img = img.resize(size, Image.NEAREST if nearest else Image.BILINEAR)
    return np.asarray(img)


def window_png(ct2d: np.ndarray, level: float, width: float) -> Image.Image:
    lo, hi = level - width / 2, level + width / 2
    a = np.clip((ct2d - lo) / (hi - lo), 0, 1)
    return Image.fromarray((a * 255).astype(np.uint8), mode="L")


def contour_paths(mask2d: np.ndarray) -> list[str]:
    """SVG path(s) for a boolean mask, in the slice's pixel coordinates."""
    paths = []
    for c in measure.find_contours(mask2d.astype(float), 0.5):
        c = measure.approximate_polygon(c, tolerance=1.2)
        if len(c) < 3:
            continue
        pts = " ".join(f"{x:.1f},{y:.1f}" for y, x in c)  # (row,col)->(x,y)
        paths.append("M" + pts + "Z")
    return paths


def main() -> None:
    ct_img = load_canonical(RAW / "example_ct_sm.nii.gz")
    ct = ct_img.get_fdata().astype(np.float32)
    zooms = ct_img.header.get_zooms()
    shape = ct.shape
    print("CT", shape, "zooms", tuple(round(z, 2) for z in zooms[:3]))

    # Load organ masks (co-registered), merge groups.
    organ_defs, masks = [], {}
    for files, oid, label, color in ORGANS:
        vol = np.zeros(shape, dtype=bool)
        present = False
        for f in files:
            p = RAW / "seg" / f"{f}.nii.gz"
            if p.exists():
                m = load_canonical(p).get_fdata() > 0.5
                if m.shape == shape:
                    vol |= m
                    present = present or bool(m.any())
        if present:
            masks[oid] = vol
            organ_defs.append({"id": oid, "label": label,
                               "labelKey": f"atlas.organ.{oid}", "color": color})
    print("organs:", [o["id"] for o in organ_defs])

    any_mask = np.zeros(shape, dtype=bool)
    for v in masks.values():
        any_mask |= v

    slices = []
    for plane, axis in (("axial", 2), ("coronal", 1), ("sagittal", 0)):
        # index range where any target organ appears
        axes = tuple(a for a in (0, 1, 2) if a != axis)
        present = np.where(any_mask.any(axis=axes))[0]
        if len(present) == 0:
            continue
        lo, hi = int(present.min()), int(present.max())
        idxs = np.unique(np.linspace(lo, hi, LEVELS_PER_PLANE).round().astype(int))
        col_mm, row_mm = plane_spacing(zooms, plane)
        for n, idx in enumerate(idxs):
            ct2d = display_2d(ct, plane, idx)
            rows, cols = ct2d.shape
            pw, ph = cols * col_mm, rows * row_mm
            scale = TARGET / max(pw, ph)
            size = (max(1, round(cols * col_mm * scale / col_mm * col_mm) or cols),)  # placeholder
            W, H = max(1, round(pw * scale)), max(1, round(ph * scale))
            ct_rs = resize_to(ct2d, (W, H), nearest=False)
            entry = {"plane": plane, "index": n,
                     "level": round((idx - lo) / max(1, (hi - lo)), 3),
                     "width": W, "height": H, "src": {}, "organs": [], "contours": []}
            for preset, (lv, wd) in PRESETS.items():
                fn = f"{plane}_{n:02d}_{preset}.png"
                window_png(ct_rs.astype(np.float32), lv, wd).save(OUT_PNG / fn)
                entry["src"][preset] = fn
            for oid, vol in masks.items():
                m2d = display_2d(vol.astype(np.uint8), plane, idx)
                m_rs = resize_to(m2d, (W, H), nearest=True) > 0
                if not m_rs.any():
                    continue
                paths = contour_paths(m_rs)
                if paths:
                    entry["organs"].append(oid)
                    for pth in paths:
                        entry["contours"].append({"organId": oid, "path": pth})
            slices.append(entry)
        print(f"  {plane}: {len(idxs)} levels")

    attribution = {
        "title": "TotalSegmentator example CT + organ segmentations",
        "author": "Wasserthal et al. (TotalSegmentator)",
        "license": "CC BY 4.0",
        "sourceUrl": "https://github.com/wasserth/TotalSegmentator",
    }

    ts = []
    ts.append("/**")
    ts.append(" * AcuDx anatomy atlas — GENERATED by data/atlas-pipeline/build_atlas.py.")
    ts.append(" * Real segmented CT cross-sections (TotalSegmentator example, CC BY 4.0):")
    ts.append(" * windowed PNG slices + per-organ SVG contour overlays. Do not edit by hand.")
    ts.append(" */")
    ts.append('import type { Bilingual } from "@/data/mock";')
    ts.append("")
    ts.append("export interface AtlasOrgan { id: string; label: string; labelKey: string; color: string; }")
    ts.append("export interface AtlasContour { organId: string; path: string; }")
    ts.append("export interface AtlasSlice {")
    ts.append('  plane: "axial" | "coronal" | "sagittal";')
    ts.append("  index: number; level: number; width: number; height: number;")
    ts.append("  src: Record<string, string>; organs: string[]; contours: AtlasContour[];")
    ts.append("}")
    ts.append("export interface AtlasAttribution { title: string; author: string; license: string; sourceUrl: string; }")
    ts.append("")
    ts.append("const BASE = import.meta.env.BASE_URL;")
    ts.append("/** Public URL for an atlas slice PNG. */")
    ts.append("export const atlasImageUrl = (file: string): string => `${BASE}atlas/${file}`;")
    ts.append("")
    ts.append(f"export const ATLAS_ORGANS: AtlasOrgan[] = {json.dumps(organ_defs, ensure_ascii=False)};")
    ts.append("")
    ts.append(f"export const ATLAS_PRESETS: string[] = {json.dumps(list(PRESETS.keys()))};")
    ts.append("")
    ts.append(f"export const ATLAS_ATTRIBUTION: AtlasAttribution = {json.dumps(attribution, ensure_ascii=False)};")
    ts.append("")
    ts.append(f"export const ATLAS_SLICES: AtlasSlice[] = {json.dumps(slices, ensure_ascii=False)};")
    ts.append("")
    # silence an unused-import if Bilingual ends unused
    ts.append("export type { Bilingual };")
    ts.append("")
    OUT_TS.write_text("\n".join(ts), encoding="utf-8")

    n_png = len(list(OUT_PNG.glob("*.png")))
    print(f"\nwrote {len(slices)} slices, {n_png} PNGs -> {OUT_PNG}")
    print(f"wrote {OUT_TS} ({OUT_TS.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

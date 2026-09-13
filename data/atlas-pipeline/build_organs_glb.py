#!/usr/bin/env python3
"""
build_organs_glb.py — generate a real 3D organ model (GLB) from the SAME
expert-segmented CT the cross-section atlas uses (TotalSegmentator example,
CC-BY-4.0). Marching cubes per organ mask -> light Taubin smoothing -> per-organ
PBR colour -> one combined GLB in real anatomical (RAS, mm) space.

Never generated/invented: the surfaces come straight from the segmentation
labels, so the 3D organs match the 2D slices voxel-for-voxel.

Output: web/public/atlas/organs.glb  (+ prints the bounding box for the viewer).
Run:  ./venv/bin/python build_organs_glb.py
"""
import os
import numpy as np
import nibabel as nib
from nibabel.affines import apply_affine
from skimage import measure
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(HERE, "raw", "seg")
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "web", "public", "atlas", "organs.glb"))

# organ id -> (list of mask files, hex colour [matches ATLAS_ORGANS], alpha)
ORGANS = {
    "liver": (["liver"], "#c1666b", 1.0),
    "spleen": (["spleen"], "#8e6cb0", 1.0),
    "pancreas": (["pancreas"], "#e0913a", 1.0),
    "stomach": (["stomach"], "#2a9d8f", 1.0),
    "kidney_left": (["kidney_left"], "#3d7ea6", 1.0),
    "kidney_right": (["kidney_right"], "#5aa9d6", 1.0),
    "gallbladder": (["gallbladder"], "#3fae6b", 1.0),
    "aorta": (["aorta"], "#c0392b", 1.0),
    "ivc": (["inferior_vena_cava"], "#34568b", 1.0),
    "adrenals": (["adrenal_gland_left", "adrenal_gland_right"], "#d97b29", 1.0),
    "duodenum": (["duodenum"], "#e6a532", 1.0),
    "colon": (["colon"], "#8a8f98", 1.0),
    "lungs": (
        ["lung_lower_lobe_left", "lung_lower_lobe_right", "lung_middle_lobe_right",
         "lung_upper_lobe_left", "lung_upper_lobe_right"],
        "#5dade2", 0.35,
    ),
    "vertebra": (["vertebrae_T12", "vertebrae_L1", "vertebrae_L2", "vertebrae_L3"], "#9aa3ad", 1.0),
}


def hex_rgba(h, a):
    h = h.lstrip("#")
    return [int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, a]


def organ_mesh(files, affine_ref):
    """Union the mask files, marching-cubes to a smoothed surface in RAS mm."""
    vol = None
    affine = affine_ref
    for name in files:
        path = os.path.join(SEG, name + ".nii.gz")
        if not os.path.exists(path):
            continue
        img = nib.as_closest_canonical(nib.load(path))
        data = np.asarray(img.dataobj) > 0.5
        affine = img.affine
        vol = data if vol is None else (vol | data)
    if vol is None or vol.sum() < 20:
        return None
    # Pad so surfaces at the volume edge close cleanly.
    vol = np.pad(vol.astype(np.uint8), 1, mode="constant")
    try:
        verts, faces, _, _ = measure.marching_cubes(vol, level=0.5, step_size=2)
    except (ValueError, RuntimeError):
        return None
    verts = verts - 1.0  # undo pad
    verts = apply_affine(affine, verts)  # voxel index -> RAS mm
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    if mesh.is_empty:
        return None
    trimesh.smoothing.filter_taubin(mesh, iterations=10)
    mesh.update_faces(mesh.nondegenerate_faces())
    return mesh


def main():
    ref = nib.as_closest_canonical(nib.load(os.path.join(SEG, "liver.nii.gz"))).affine
    scene = trimesh.Scene()
    total_tris = 0
    for oid, (files, color, alpha) in ORGANS.items():
        mesh = organ_mesh(files, ref)
        if mesh is None:
            print(f"  skip {oid} (no/too-small mask)")
            continue
        mesh.visual = trimesh.visual.TextureVisuals(
            material=trimesh.visual.material.PBRMaterial(
                name=oid,
                baseColorFactor=hex_rgba(color, alpha),
                metallicFactor=0.0,
                roughnessFactor=0.65,
                alphaMode="BLEND" if alpha < 1.0 else "OPAQUE",
                doubleSided=True,
            )
        )
        scene.add_geometry(mesh, geom_name=oid, node_name=oid)
        total_tris += len(mesh.faces)
        print(f"  {oid:14s} {len(mesh.faces):6d} tris")

    # Centre the scene on the origin so the viewer orbits the anatomy midpoint.
    c = scene.bounds.mean(axis=0)
    scene.apply_translation(-c)
    b = scene.bounds
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    scene.export(OUT)
    size = os.path.getsize(OUT) / 1024
    print(f"\n  organs: {len(scene.geometry)}  tris: {total_tris}  size: {size:.0f} KB")
    print(f"  bounds (mm, centred): min={b[0].round(1).tolist()} max={b[1].round(1).tolist()}")
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()

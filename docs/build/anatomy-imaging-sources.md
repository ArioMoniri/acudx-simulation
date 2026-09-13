# "Japanese-style" anatomy / imaging — reference tool & open data sources

Captured for future work: the user wants the **"Japanese-style"** anatomy +
imaging experience — a navigable 3D body with axial/coronal/sagittal
cross-sections and per-organ overlays — extended to **all imaging in every
case**. This records the exact reference tool and the open-licensed data we can
actually build from.

## 1. The reference tool (design only — NOT usable data)

**teamLabBody / teamLabBody Pro** — https://www.teamlabbody.com/
- Japanese interactive 3D human-anatomy app: navigable 3D body + cross-sectional
  views in all three planes (横断面/縦断面/前額面 = axial/sagittal/coronal) from
  **real CT/MRI** data, plus freeform sectioning (ultrasound-style).
- By **teamLab** with **Dr. Kazuomi Sugamoto** (former professor of orthopaedic
  surgery, Osaka University), from 10+ years of live-subject CT/MRI.
- **Proprietary, subscription** (¥4,900 / ¥9,800 per year). **No source code, no
  downloadable data.** → We can mimic the *interaction/design*, but cannot bundle
  its models. This is the look the user is pointing at.

## 2. The open, reusable source (what to build from)

**BodyParts3D / Anatomography** — DBCLS (Database Center for Life Science,
University of Tokyo). The canonical **open** Japanese 3D-anatomy dataset: ~3,200
named organ/bone/vessel/nerve/muscle meshes covering the **whole body**.
- Web viewer (the "Japanese style" reference itself is basically this):
  https://lifesciencedb.jp/ag/ · https://en.wikipedia.org/wiki/Anatomography
- **License: CC-BY-SA 2.1 Japan** for the 3D data (© DBCLS). **ShareAlike /
  copyleft** — attribute DBCLS/BodyParts3D and keep derivatives under the same
  licence. Fine to bundle with attribution; note the SA obligation.

### Repos
- **`dbcls/bp3d`** — https://github.com/dbcls/bp3d — the *official* DBCLS
  development framework (editor/browser/renderer), not the mesh files.
- **`Kevin-Mattheus-Moerman/BodyParts3D`** —
  https://github.com/Kevin-Mattheus-Moerman/BodyParts3D — a clone of the 3D model
  files (CC-BY-SA 2.1 JP content; code MIT).
- **`olivercase/body_parts_3d_api`** ← **most useful** —
  https://github.com/olivercase/body_parts_3d_api — the complete full-resolution
  **BodyParts3D/Anatomography 4.3 mesh set: 3,210 verified `.obj` meshes** (Git
  LFS) with a downloader + named-subset selector (brain, heart, lungs, gut,
  spine, …). Code MIT; data CC-BY-SA 2.1 JP (attribute DBCLS + cite the tool's
  Zenodo DOI).

## 3. How this powers "Japanese style for all imaging, per case"

Today AcuDx's 3D atlas (`/atlas` → **3D organs**) is built by marching cubes from
**one ~90 mm abdominal TotalSegmentator subject** (CC-BY-4.0), so it's abdomen-
only. To reach the teamLabBody-style *whole-body, per-case* experience:

1. Pull the **BodyParts3D 4.3 mesh set** (`olivercase/body_parts_3d_api`), which
   already covers the whole body, and convert the named `.obj` subsets a case
   needs into a compact GLB (same `Organ3DViewer` pipeline as `build_organs_glb.py`).
2. Per case, **highlight the case-relevant organs/region** in the 3D view and
   open the matching cross-section (drive the existing atlas viewer + the new
   `StudyViewer`), so ordered imaging and the atlas share one anatomy.
3. Keep **CT/MRI cross-sections from real, open segmented volumes**
   (TotalSegmentator, AMOS22 for MRI) — never generated.
4. Respect **CC-BY-SA** (attribution + share-alike) when bundling BodyParts3D
   meshes.

This is a data-scale + wiring effort (no new blocker), tracked as the atlas's
next growth step.

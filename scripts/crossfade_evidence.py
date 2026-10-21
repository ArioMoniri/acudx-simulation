"""Cross-fade evidence from a prod-path-v2 capture (docs/media/live-avatar/prod-path-v2/<lang>/crossfade/).

For every recorded switch: the ghost score between the first and the last frame (the two pictures'
framing, 0 = the same frame; a misregistered edit scored 0.83 to 0.91 in test_avatar_register.py),
the largest ghost score of any frame against the nearer end of the fade, and a contact sheet of the
frames around the fade. The raw PNG frames are replaced by every 4th frame as JPEG.

    python scripts/crossfade_evidence.py docs/media/live-avatar/prod-path-v2/tr
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import cv2
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]


def _register():
    files = yaml.safe_load((ROOT / "infra/gpu-worker/cloud-init.yaml").read_text(encoding="utf-8"))["write_files"]
    src = next(f["content"] for f in files if f["path"].endswith("/acudx_register.py"))
    mod = types.ModuleType("acudx_register")
    exec(compile(src, "acudx_register.py", "exec"), mod.__dict__)
    return mod


def main(out_dir: str) -> int:
    R = _register()
    base = Path(out_dir) / "crossfade"
    report = {}
    for sw in sorted(p for p in base.iterdir() if p.is_dir()):
        pngs = sorted(sw.glob("*.png"))
        if not pngs:
            continue
        frames = [cv2.imread(str(p)) for p in pngs]
        first, last = frames[0], frames[-1]
        diffs = [float(np.abs(f.astype(int) - first.astype(int)).mean()) for f in frames]
        changed = [i for i, d in enumerate(diffs) if d > 1.0]
        worst = 0.0
        for f in frames:
            worst = max(worst, min(R.ghost_score(f, first), R.ghost_score(f, last)))
        report[sw.name] = {"frames": len(frames), "ghost_first_vs_last": R.ghost_score(first, last),
                           "worst_frame_ghost": round(worst, 4),
                           "fade_frames": [changed[0], changed[-1]] if changed else None}
        keep = frames[::4][:16]
        h = 180
        thumbs = [cv2.resize(f, (int(f.shape[1] * h / f.shape[0]), h)) for f in keep]
        sheet = np.concatenate(thumbs, axis=1)
        cv2.imwrite(str(base / f"{sw.name}-sheet.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
        for i, (p, f) in enumerate(zip(pngs, frames)):
            if i % 4 == 0 and i // 4 < 16:
                cv2.imwrite(str(sw / (p.stem + ".jpg")), f, [cv2.IMWRITE_JPEG_QUALITY, 88])
            p.unlink()
    (base / "ghost.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

#!/usr/bin/env python3
"""Crop and optimise the README images into docs/media/readme/.

Sources are real captures of the running app: the chapter stills that
`node scripts/record-walkthrough.mjs --debug` writes to out/record-debug/
(cursor hidden), the redesign captures in docs/design/redesign-shots/after/,
and out/poster-v2.png from Remotion. Each output is a palette-quantised PNG
(no dithering, so UI text stays crisp) under 350 KB.

    python3 scripts/readme-images.py
"""
import glob
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEO)
OUT = os.path.join(ROOT, "docs", "media", "readme")
DEBUG = os.path.join(VIDEO, "out", "record-debug")
AFTER = os.path.join(ROOT, "docs", "design", "redesign-shots", "after")
LIMIT = 350 * 1024


def still(name: str) -> str:
    hits = sorted(glob.glob(os.path.join(DEBUG, f"*-{name}.png")))
    if not hits:
        sys.exit(f"missing still {name}: run the recorder with --debug first")
    return hits[-1]


# (output, source, crop box in 1920 x 1080 pixels or None, output width)
JOBS = [
    ("feature-generator.png", still("generated"), (294, 200, 1846, 1075), 760),
    ("feature-interview.png", still("interview"), (560, 150, 1850, 1000), 760),
    ("feature-orders.png", still("orders"), (560, 220, 1860, 1010), 760),
    ("feature-results.png", still("ecg"), (560, 140, 1860, 860), 760),
    ("feature-guidance.png", still("guidance"), (560, 280, 1840, 1075), 760),
    ("feature-feedback.png", still("calibration"), (520, 50, 1620, 900), 760),
    ("panel-student.png", still("home"), None, 960),
    ("panel-faculty.png", os.path.join(AFTER, "faculty-1920.png"), (0, 0, 1920, 1080), 960),
    ("panel-dean.png", still("dean"), None, 960),
    ("panel-admin.png", still("admin"), None, 960),
    ("walkthrough-poster.png", os.path.join(VIDEO, "out", "poster-v2.png"), None, 1280),
]


def save(img: Image.Image, path: str) -> int:
    for colors in (256, 192, 128, 96, 64):
        q = img.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        q.save(path, optimize=True)
        size = os.path.getsize(path)
        if size <= LIMIT:
            return size
    return size


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for name, src, box, width in JOBS:
        img = Image.open(src)
        if box:
            img = img.crop(box)
        h = round(img.height * width / img.width)
        img = img.resize((width, h), Image.Resampling.LANCZOS)
        size = save(img, os.path.join(OUT, name))
        flag = "" if size <= LIMIT else "  OVER LIMIT"
        print(f"{name:28s} {width}x{h}  {size / 1024:6.1f} KB{flag}")


if __name__ == "__main__":
    main()

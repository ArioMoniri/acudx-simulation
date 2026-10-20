#!/usr/bin/env python3
"""Build the README media in docs/media/readme/ from the raw captures.

    node scripts/design/capture-readme.mjs      # raw 2x PNGs into docs/media/readme/raw/
    python3 scripts/design/readme-media.py      # this script

1. Writes the README lockups (lockup-light.svg, lockup-dark.svg) from the brand
   master in web/public/brand/acudx-lockup-horizontal.svg, recoloured to the
   v4 renewal palette (Pulse cobalt on warm ink, light cobalt on paper white).
2. Renders the walkthrough poster from poster.html (a real capture of the
   renewed encounter beside the lockup) with the Playwright Chromium.
3. Takes the live video call card from a frame of the real live capture
   (docs/media/live-avatar/frames).
4. Resizes and palette-quantises every image (no dithering, so UI text stays
   crisp) and checks each is under 350 KB.

No crop cuts text: features are element captures of whole panels, panels and
the hero are full viewports.
"""
import glob
import os
import re
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "docs", "media", "readme")
RAW = os.path.join(OUT, "raw")
BRAND = os.path.join(ROOT, "web", "public", "brand", "acudx-lockup-horizontal.svg")
LIMIT = 350 * 1024

# (output, raw source, output width)
JOBS = [
    ("hero-encounter.png", "hero-encounter.png", 1760),
    ("feature-generator.png", "feature-generator.png", 1100),
    ("feature-director.png", "feature-director.png", 900),
    ("feature-interview.png", "feature-interview.png", 900),
    ("feature-orders.png", "feature-orders.png", 900),
    ("feature-results.png", "feature-results.png", 900),
    ("feature-guidance.png", "feature-guidance.png", 900),
    ("feature-feedback.png", "feature-feedback.png", 900),
    ("panel-student.png", "panel-student.png", 1120),
    ("panel-faculty.png", "panel-faculty.png", 1120),
    ("panel-dean.png", "panel-dean.png", 1120),
    ("panel-admin.png", "panel-admin.png", 1120),
]

PALETTE = {
    "light": {"mark": "#2450c8", "acu": "#1a1916"},
    "dark": {"mark": "#9db0ff", "acu": "#ece9e2"},
}


def chromium() -> str:
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    dirs = sorted(d for d in os.listdir(root) if re.match(r"^chromium-\d+$", d))
    return os.path.join(root, dirs[-1], "chrome-linux", "chrome")


def lockups() -> None:
    src = open(BRAND).read()
    for scheme, c in PALETTE.items():
        svg = src.replace('fill="#2563eb"', f'fill="{c["mark"]}"').replace('fill="#0f172a"', f'fill="{c["acu"]}"')
        assert c["mark"] in svg and c["acu"] in svg
        with open(os.path.join(OUT, f"lockup-{scheme}.svg"), "w") as f:
            f.write(svg)
        print(f"lockup-{scheme}.svg")


def poster() -> None:
    html = os.path.join(HERE, "poster.html")
    target = os.path.join(RAW, "walkthrough-poster.png")
    subprocess.run(
        [
            chromium(),
            "--headless",
            "--no-sandbox",
            "--disable-gpu",
            "--allow-file-access-from-files",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--screenshot={target}",
            "--window-size=1280,720",
            f"file://{html}",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    JOBS.append(("walkthrough-poster.png", "walkthrough-poster.png", 1280))


def call_frame() -> None:
    """The live video call card: one frame of the real live capture in
    docs/media/live-avatar (MuseTalk lip-sync on the GPU worker), the head and
    shoulders only (the bottom rows of that frame carry the blending seam)."""
    src = os.path.join(ROOT, "docs", "media", "live-avatar", "frames", "talk_05.png")
    img = Image.open(src).convert("RGB")
    img.crop((0, 0, img.width, 600)).save(os.path.join(RAW, "feature-call.png"))
    JOBS.append(("feature-call.png", "feature-call.png", 566))


def save(img: Image.Image, path: str) -> int:
    size = 0
    for colors in (256, 224, 192, 160, 128):
        q = img.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        q.save(path, optimize=True)
        size = os.path.getsize(path)
        if size <= LIMIT:
            return size
    return size


def landing() -> None:
    """The landing page figure (web/public/media/screens): the same renewed
    encounter at 1280 x 800, light and (if captured) dark."""
    screens = os.path.join(ROOT, "web", "public", "media", "screens")
    for src, name in (("hero-encounter.png", "encounter-1280-light.png"), ("hero-encounter-dark.png", "encounter-1280-dark.png")):
        path = os.path.join(RAW, src)
        if not os.path.exists(path):
            print(f"skip {name}: no {src} (run capture-readme.mjs with SCHEME=dark)")
            continue
        img = Image.open(path).resize((1280, 800), Image.Resampling.LANCZOS)
        size = save(img, os.path.join(screens, name))
        print(f"{name:28s} 1280x800  {size / 1024:6.1f} KB")


def main() -> None:
    if not os.path.isdir(RAW):
        sys.exit("missing raw captures: run node scripts/design/capture-readme.mjs first")
    lockups()
    poster()
    call_frame()
    over = 0
    for name, src, width in JOBS:
        img = Image.open(os.path.join(RAW, src))
        if img.width > width:
            h = round(img.height * width / img.width)
            img = img.resize((width, h), Image.Resampling.LANCZOS)
        size = save(img, os.path.join(OUT, name))
        flag = "" if size <= LIMIT else "  OVER LIMIT"
        over += bool(flag)
        print(f"{name:28s} {img.width}x{img.height}  {size / 1024:6.1f} KB{flag}")
    landing()
    stale = os.path.join(OUT, "hero-encounter.webp")
    if os.path.exists(stale):
        os.remove(stale)
        print("removed hero-encounter.webp (the old cropped hero)")
    if over:
        sys.exit(f"{over} image(s) over 350 KB")


if __name__ == "__main__":
    main()

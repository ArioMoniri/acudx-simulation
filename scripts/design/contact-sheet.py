#!/usr/bin/env python3
"""Side-by-side before and after contact sheets for the visual renewal.

    python3 scripts/design/contact-sheet.py

Reads docs/design/renewal-shots/{before,after}/<screen>-<width>.png and writes
contact-sheet-1280.png (12 rows, before | after at half scale) and
contact-sheet-390.png (two bands of six screens, before over after) into
docs/design/renewal-shots/. Palette-quantised; labels are drawn in the margin,
never over a capture.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, "docs", "design", "renewal-shots")
SCREENS = [
    "landing",
    "home",
    "start",
    "cases",
    "encounter",
    "encounter-interview",
    "encounter-orders",
    "encounter-results",
    "encounter-guidance",
    "feedback",
    "dean",
    "admin",
]
BG = (245, 243, 238)
INK = (26, 25, 22)
MUTED = (95, 90, 81)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"]
    for d in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def load(kind: str, screen: str, width: int, scale: float) -> Image.Image:
    img = Image.open(os.path.join(SHOTS, kind, f"{screen}-{width}.png")).convert("RGB")
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    path = os.path.join(SHOTS, name)
    img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print(f"{name}  {img.width}x{img.height}  {os.path.getsize(path) / 1024:.0f} KB")


def sheet_desktop() -> None:
    scale, gap, label_w, head = 0.5, 24, 190, 64
    cell_w, cell_h = round(1280 * scale), round(800 * scale)
    w = label_w + cell_w * 2 + gap * 3
    h = head + len(SCREENS) * (cell_h + gap) + gap
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((label_w + gap, 22), "Before (v3)", fill=INK, font=font(22, True))
    d.text((label_w + gap * 2 + cell_w, 22), "After (v4 Ward ink)", fill=INK, font=font(22, True))
    for i, s in enumerate(SCREENS):
        y = head + i * (cell_h + gap)
        d.text((gap, y + 6), s, fill=MUTED, font=font(16, True))
        d.text((gap, y + 30), "1280 x 800", fill=MUTED, font=font(13))
        for j, kind in enumerate(("before", "after")):
            x = label_w + gap + j * (cell_w + gap)
            img.paste(load(kind, s, 1280, scale), (x, y))
            d.rectangle([x - 1, y - 1, x + cell_w, y + cell_h], outline=(201, 193, 179))
    save(img, "contact-sheet-1280.png")


def sheet_phone() -> None:
    scale, gap, head = 0.5, 18, 56
    cell_w, cell_h = round(390 * scale), round(844 * scale)
    per_band = 6
    bands = [SCREENS[:per_band], SCREENS[per_band:]]
    band_h = 2 * (cell_h + 34) + gap
    w = 120 + per_band * (cell_w + gap) + gap
    h = head + len(bands) * (band_h + gap)
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    d.text((gap, 18), "390 x 844: before (upper row) and after (lower row)", fill=INK, font=font(20, True))
    for b, screens in enumerate(bands):
        y0 = head + b * (band_h + gap)
        for r, kind in enumerate(("before", "after")):
            y = y0 + r * (cell_h + 34)
            d.text((gap, y + 30), kind, fill=MUTED, font=font(16, True))
            for c, s in enumerate(screens):
                x = 120 + c * (cell_w + gap)
                d.text((x, y), s, fill=MUTED, font=font(12))
                img.paste(load(kind, s, 390, scale), (x, y + 18))
                d.rectangle([x - 1, y + 17, x + cell_w, y + 18 + cell_h], outline=(201, 193, 179))
    save(img, "contact-sheet-390.png")


if __name__ == "__main__":
    sheet_desktop()
    sheet_phone()

#!/usr/bin/env python3
"""Before and after sheets for renewal 2 (docs/design/06-renewal-2.md).

    python3 scripts/design/contact-sheet-2.py

Reads docs/design/renewal-2-shots/{before,after}/ and writes:
  sheet-avatars.png   every patient photo surface, before | after
  sheet-1280.png      key screens at 1280 px, before | after at half scale
  sheet-375.png       key screens at 375 px, before over after
then palette-quantises every PNG in the folder. Labels sit in the margin,
never over a capture.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, "docs", "design", "renewal-2-shots")
BG = (245, 243, 238)
INK = (26, 25, 22)


def font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def load(side, name):
    p = os.path.join(SHOTS, side, name)
    return Image.open(p).convert("RGB") if os.path.exists(p) else None


def pair_rows(names, scale, out, gap=24, label_h=28):
    rows = []
    for n in names:
        b, a = load("before", n), load("after", n)
        if not b or not a:
            continue
        b = b.resize((int(b.width * scale), int(b.height * scale)))
        a = a.resize((int(a.width * scale), int(a.height * scale)))
        rows.append((n, b, a))
    if not rows:
        return
    w = max(r[1].width for r in rows) + max(r[2].width for r in rows) + gap * 3
    h = sum(max(r[1].height, r[2].height) + label_h + gap for r in rows) + gap
    sheet = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(sheet)
    f = font(14)
    y = gap
    colw = max(r[1].width for r in rows)
    for n, b, a in rows:
        d.text((gap, y), f"{n}   before", fill=INK, font=f)
        d.text((gap * 2 + colw, y), "after", fill=INK, font=f)
        y += label_h
        sheet.paste(b, (gap, y))
        sheet.paste(a, (gap * 2 + colw, y))
        y += max(b.height, a.height) + gap
    sheet.save(os.path.join(SHOTS, out))


def stacked(names, scale, out, gap=16, label_h=26):
    pairs = [(n, load("before", n), load("after", n)) for n in names]
    pairs = [p for p in pairs if p[1] and p[2]]
    if not pairs:
        return
    cw = int(max(p[1].width for p in pairs) * scale)
    ch = int(max(max(p[1].height, p[2].height) for p in pairs) * scale)
    w = gap + len(pairs) * (cw + gap)
    h = gap + 2 * (label_h + ch + gap)
    sheet = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(sheet)
    f = font(13)
    for i, (n, b, a) in enumerate(pairs):
        x = gap + i * (cw + gap)
        for j, (tag, im) in enumerate((("before", b), ("after", a))):
            y = gap + j * (label_h + ch + gap)
            d.text((x, y), f"{n} {tag}", fill=INK, font=f)
            sheet.paste(im.resize((int(im.width * scale), int(im.height * scale))), (x, y + label_h))
    sheet.save(os.path.join(SHOTS, out))


avatars = [
    "avatar-flowsheet-dark-1280.png",
    "avatar-flowsheet-light-1280.png",
    "avatar-flowsheet-dark-375.png",
    "avatar-storyboard-light-1280.png",
    "avatar-banner-dark-1280.png",
]
pair_rows(avatars, 2.0, "sheet-avatars.png")
pair_rows(
    [f"{n}-1280.png" for n in ("encounter", "home", "rooms", "authoring", "welcome", "institution")],
    0.5,
    "sheet-1280.png",
)
stacked([f"{n}-375.png" for n in ("encounter", "rooms", "home", "authoring", "welcome")], 0.6, "sheet-375.png")

for side in ("", "before", "after"):
    folder = os.path.join(SHOTS, side)
    for name in os.listdir(folder):
        if name.endswith(".png"):
            p = os.path.join(folder, name)
            im = Image.open(p).convert("RGB")
            im.quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(p, optimize=True)
print("sheets written to", SHOTS)

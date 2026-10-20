#!/usr/bin/env python3
"""Build every AcuDx brand SVG from the geometric construction + the self-hosted
Manrope variable font (wght 800) outlined to paths.

Round two mark ("pulse seal"): a rounded tile split in two by one acute (60 degree)
deflection of a monitor trace. The trace is real negative space: the two pieces of the
tile are drawn as explicit outlines (offset polylines with a mitred apex), so the one
colour files have no fake white cut-out and the mark works on any background.

Writes into web/public/brand/. Raster files (PNG, ICO) are produced afterwards with
the logo-design skill's render_png.py (see docs/design/brand-src/render_kit.sh).

Needs: fonttools, brotli, uharfbuzz (pip) and web/node_modules (for Manrope).

usage: python3 docs/design/brand-src/build_brand.py
"""
import io, math, os, re
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FONT = os.path.join(ROOT, "web/node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2")
OUT = os.path.join(ROOT, "web/public/brand")

# ---- Colour tokens (mirror web/src/index.css) ------------------------------
BRAND = "#2563eb"       # --brand-600, the one locked blue
BRAND_DARK = "#60a5fa"  # --axis-clinical on dark surfaces (lightened for contrast)
INK = "#0f172a"         # --fg light
INK_DARK = "#e2e8f0"    # --fg dark
GRAD = ("#2dd4bf", "#3b82f6", "#f472b6")  # --grad-teal / blue / pink
BLACK, WHITE = "#000000", "#ffffff"

WEIGHT = 800
TRACK_EM = -0.035
PAIR_KERN = {("D", "x"): -0.012, ("A", "c"): -0.006}


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


# ---- The mark: a rounded tile split by one acute deflection ------------------
# Master: tile 12..244 (rx 58, 25 percent), trace centreline flat at y 172 with a 60 degree
# spike to y 72, channel width 28. Small cut (favicon, at or below 32 px): channel 38, apex 86.
MASTER = dict(y_base=172, y_apex=72, w=28)
SMALL = dict(y_base=176, y_apex=86, w=38)


def seal_pieces(small=False, inset=12, rx=58):
    """Return (upper, lower) path data for the two pieces of the tile."""
    g = SMALL if small else MASTER
    y_base, y_apex, w = g["y_base"], g["y_apex"], g["w"]
    h = w / 2
    half = (y_base - y_apex) * math.tan(math.radians(30))   # spike half-width at the baseline
    xl, xr = 128 - half, 128 + half
    miter = h / math.sin(math.radians(30))                   # 2h: mitre of a 60 degree apex
    tx = h * math.tan(math.radians(30))                      # shift where a flat meets a leg
    L, R, T, B = inset, 256 - inset, inset, 256 - inset
    up = (f"M{L} {f(y_base-h)} H{f(xl-tx)} L128 {f(y_apex-miter)} L{f(xr+tx)} {f(y_base-h)} H{R} "
          f"V{T+rx} A{rx} {rx} 0 0 0 {R-rx} {T} H{L+rx} A{rx} {rx} 0 0 0 {L} {T+rx} Z")
    low = (f"M{L} {f(y_base+h)} H{f(xl+tx)} L128 {f(y_apex+miter)} L{f(xr-tx)} {f(y_base+h)} H{R} "
           f"V{B-rx} A{rx} {rx} 0 0 1 {R-rx} {B} H{L+rx} A{rx} {rx} 0 0 1 {L} {B-rx} Z")
    return up, low


def mark_paths(color, small=False, inset=12, rx=58):
    up, low = seal_pieces(small, inset, rx)
    return (f'  <g fill="{color}">\n'
            f'    <path id="upper" d="{up}"/>\n'
            f'    <path id="lower" d="{low}"/>\n'
            f'  </g>\n')


def svg(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" '
            f'role="img" aria-labelledby="t">\n  <title id="t">{title}</title>\n{body}</svg>\n')


# ---- Wordmark from Manrope 800, outlined --------------------------------------
def load_font():
    fnt = TTFont(FONT)
    inst = instancer.instantiateVariableFont(fnt, {"wght": WEIGHT})
    inst.flavor = None
    bio = io.BytesIO(); inst.save(bio)
    return inst, bio.getvalue()


def shape(text, inst, blob):
    font = hb.Font(hb.Face(blob))
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    order = inst.getGlyphOrder()
    return [(order[i.codepoint], p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def layout(text, inst, blob, scale, x0, baseline):
    """Yield (char, glyphName, originX, originY) for each glyph."""
    upem = inst["head"].unitsPerEm
    x = 0.0
    for k, (name, adv, xo, yo) in enumerate(shape(text, inst, blob)):
        yield text[k], name, x0 + (x + xo) * scale, baseline - yo * scale
        x += adv + TRACK_EM * upem
        if k + 1 < len(text):
            x += PAIR_KERN.get((text[k], text[k + 1]), 0.0) * upem


def wordmark(inst, blob, cap, baseline, x0, acu, dx):
    gs = inst.getGlyphSet()
    scale = cap / inst["OS/2"].sCapHeight
    paths, xmin, xmax = [], 1e9, -1e9
    for ch, name, ox, oy in layout("AcuDx", inst, blob, scale, x0, baseline):
        pen = SVGPathPen(gs, ntos=f)
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, ox, oy)))
        bp = BoundsPen(gs); gs[name].draw(bp)
        xmin, xmax = min(xmin, ox + bp.bounds[0] * scale), max(xmax, ox + bp.bounds[2] * scale)
        paths.append(pen.getCommands())
    body = (f'  <g id="acu" fill="{acu}">\n' + "".join(f'    <path d="{d}"/>\n' for d in paths[:3]) + "  </g>\n"
            f'  <g id="dx" fill="{dx}">\n' + "".join(f'    <path d="{d}"/>\n' for d in paths[3:]) + "  </g>\n")
    return body, xmin, xmax


def wordmark_file(inst, blob, acu, dx, cap=180, pad=8):
    baseline = 128 + cap / 2
    _, x0, x1 = wordmark(inst, blob, cap, baseline, 0, acu, dx)
    body, _, x1b = wordmark(inst, blob, cap, baseline, pad - x0, acu, dx)
    return svg(round(x1b + pad, 1), 256, "AcuDx", body)


# Lockup: the seal keeps its 12 unit margin, so its visible tile is 232 tall. The wordmark cap
# height is 200 (tile = 1.16 x cap, centred on the tile), gap 40 from the tile's edge: the
# flat of the trace (y 172) runs through the lower third of the letters, like a baseline rule.
LOCKUP_CAP, LOCKUP_GAP = 200, 40


def lockup_file(inst, blob, mark_color, acu, dx, cap=LOCKUP_CAP, gap=LOCKUP_GAP):
    baseline = 128 + cap / 2
    _, x0, _ = wordmark(inst, blob, cap, baseline, 0, acu, dx)
    body, _, x1 = wordmark(inst, blob, cap, baseline, 244 + gap - x0, acu, dx)
    W = round(x1, 1)
    return svg(W, 256, "AcuDx", f'  <g id="symbol">\n{mark_paths(mark_color)}  </g>\n  <g id="wordmark">\n{body}  </g>\n')


def stacked_file(inst, blob, mark_color, acu, dx, cap=120, gap=48):
    """Symbol over wordmark, for square avatars. Canvas 512 wide; the seal is 256 tall."""
    _, x0, x1 = wordmark(inst, blob, cap, 0, 0, acu, dx)
    w = x1 - x0
    body, _, _ = wordmark(inst, blob, cap, 256 + gap + cap, 256 - w / 2 - x0, acu, dx)
    H = 256 + gap + cap + 24
    return svg(512, round(H, 1), "AcuDx",
               f'  <g id="symbol" transform="translate(128 0)">\n{mark_paths(mark_color)}  </g>\n  <g id="wordmark">\n{body}  </g>\n')


def gradient_defs(gid="g", x2=256, y2=256):
    g0, g1, g2 = GRAD
    return (f'  <defs>\n    <linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{x2}" y2="{y2}">\n'
            f'      <stop offset="0" stop-color="{g0}"/>\n      <stop offset="0.5" stop-color="{g1}"/>\n      <stop offset="1" stop-color="{g2}"/>\n'
            f'    </linearGradient>\n  </defs>\n')


def app_icon_file():
    """The seal itself is the app icon: the gradient fills the two pieces edge to edge (rx 56,
    22 percent, the platform radius) and the channel shows the white ground. The mark's own
    silhouette is the icon, so there is no tile inside a tile."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="t">\n'
            f'  <title id="t">AcuDx app icon</title>\n{gradient_defs()}'
            f'  <rect width="256" height="256" rx="56" fill="{WHITE}"/>\n'
            f'{mark_paths("url(#g)", small=True, inset=0, rx=56)}</svg>\n')


def favicon_file():
    # Brand blue by default; lightened blue when the browser UI is dark (SVG favicons honour media queries).
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">\n'
            f'  <style>path{{fill:{BRAND}}}@media (prefers-color-scheme:dark){{path{{fill:{BRAND_DARK}}}}}</style>\n'
            f'{mark_paths(BRAND, small=True, inset=4, rx=60)}</svg>\n')


def og_image_file(inst, blob):
    lock = lockup_file(inst, blob, BRAND, INK, BRAND)
    W = float(re.search(r'viewBox="0 0 ([\d.]+) 256"', lock).group(1))
    inner = re.search(r"</title>\n(.*)</svg>", lock, re.S).group(1)
    s = 760 / W
    tx, ty = round((1200 - W * s) / 2, 1), round((630 - 256 * s) / 2 - 10, 1)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">\n'
            f'{gradient_defs(x2=1200, y2=0)}'
            f'  <rect width="1200" height="630" fill="{WHITE}"/>\n'
            f'  <g transform="translate({tx} {ty}) scale({s:.4f})">\n{inner}  </g>\n'
            f'  <rect x="0" y="622" width="1200" height="8" fill="url(#g)"/>\n</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    inst, blob = load_font()
    files = {
        "acudx-mark.svg": svg(256, 256, "AcuDx", mark_paths(BRAND)),
        "acudx-mark-dark.svg": svg(256, 256, "AcuDx", mark_paths(BRAND_DARK)),
        "acudx-mark-mono.svg": svg(256, 256, "AcuDx", mark_paths(BLACK)),
        "acudx-mark-mono-white.svg": svg(256, 256, "AcuDx", mark_paths(WHITE)),
        "acudx-mark-small.svg": svg(256, 256, "AcuDx", mark_paths(BRAND, small=True)),
        "acudx-wordmark.svg": wordmark_file(inst, blob, INK, BRAND),
        "acudx-wordmark-dark.svg": wordmark_file(inst, blob, INK_DARK, BRAND_DARK),
        "acudx-wordmark-mono.svg": wordmark_file(inst, blob, BLACK, BLACK),
        "acudx-wordmark-mono-white.svg": wordmark_file(inst, blob, WHITE, WHITE),
        "acudx-lockup-horizontal.svg": lockup_file(inst, blob, BRAND, INK, BRAND),
        "acudx-lockup-horizontal-dark.svg": lockup_file(inst, blob, BRAND_DARK, INK_DARK, BRAND_DARK),
        "acudx-lockup-horizontal-mono.svg": lockup_file(inst, blob, BLACK, BLACK, BLACK),
        "acudx-lockup-horizontal-mono-white.svg": lockup_file(inst, blob, WHITE, WHITE, WHITE),
        "acudx-lockup-stacked.svg": stacked_file(inst, blob, BRAND, INK, BRAND),
        "acudx-lockup-stacked-dark.svg": stacked_file(inst, blob, BRAND_DARK, INK_DARK, BRAND_DARK),
        "acudx-app-icon.svg": app_icon_file(),
        "favicon.svg": favicon_file(),
        "og-image.svg": og_image_file(inst, blob),
    }
    for name, content in files.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            fh.write(content)
        print("wrote", name)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build every AcuDx brand SVG from the geometric construction + the self-hosted
Manrope variable font (wght 800) outlined to paths.

Writes into web/public/brand/. Raster files (PNG, ICO) are produced afterwards
with the logo-design skill's render_png.py (see docs/design/02-brand-identity.md).

Needs: fonttools, brotli, uharfbuzz (pip) and web/node_modules (for Manrope).

usage: python3 docs/design/brand-src/build_brand.py
"""
import io, os, re
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


# ---- The mark: one acute deflection on a calm baseline ----------------------
def mark_paths(color, small=False):
    """Stroke 32 master; the small cut (favicon 16-32 px) uses stroke 40 and a wider counter."""
    if not small:
        legs, trace, w = "M31 212 L128 44 L225 212", "M14 158 H242", 32
    else:
        legs, trace, w = "M34.5 214 L128 52 L221.5 214", "M26 164 H230", 40
    return (f'  <g fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round">\n'
            f'    <path d="{legs}" stroke-linejoin="miter" stroke-miterlimit="4"/>\n'
            f'    <path d="{trace}"/>\n'
            f'  </g>\n')


def svg(w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}" '
            f'role="img" aria-labelledby="t">\n  <title id="t">{title}</title>\n{body}</svg>\n')


# ---- Wordmark from Manrope 800, outlined --------------------------------------
def load_font():
    f = TTFont(FONT)
    inst = instancer.instantiateVariableFont(f, {"wght": WEIGHT})
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
    fmt = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")
    paths, xmin, xmax = [], 1e9, -1e9
    for ch, name, ox, oy in layout("AcuDx", inst, blob, scale, x0, baseline):
        pen = SVGPathPen(gs, ntos=fmt)
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


def lockup_file(inst, blob, mark_color, acu, dx, cap=164, gap=52):
    baseline = 122 + cap / 2
    _, x0, _ = wordmark(inst, blob, cap, baseline, 0, acu, dx)
    body, _, x1 = wordmark(inst, blob, cap, baseline, 256 + gap - x0, acu, dx)
    W = round(x1, 1)
    return svg(W, 256, "AcuDx", f'  <g id="symbol">\n{mark_paths(mark_color)}  </g>\n  <g id="wordmark">\n{body}  </g>\n')


def app_icon_file():
    g0, g1, g2 = GRAD
    s = 0.69
    tx, ty = round(128 - 128 * s, 2), round(128 - 123 * s - 0.02 * 256, 2)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="t">\n'
            f'  <title id="t">AcuDx app icon</title>\n'
            f'  <defs>\n    <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="256" y2="256">\n'
            f'      <stop offset="0" stop-color="{g0}"/>\n      <stop offset="0.5" stop-color="{g1}"/>\n      <stop offset="1" stop-color="{g2}"/>\n'
            f'    </linearGradient>\n  </defs>\n'
            f'  <rect width="256" height="256" rx="56" fill="url(#g)"/>\n'
            f'  <g transform="translate({tx} {ty}) scale({s})">\n{mark_paths(WHITE, small=True)}  </g>\n</svg>\n')


def favicon_file():
    # Brand blue by default; lightened blue when the browser UI is dark (SVG favicons honour media queries).
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">\n'
            f'  <style>path{{stroke:{BRAND}}}@media (prefers-color-scheme:dark){{path{{stroke:{BRAND_DARK}}}}}</style>\n'
            f'{mark_paths(BRAND, small=True)}</svg>\n')


def og_image_file(inst, blob):
    lock = lockup_file(inst, blob, BRAND, INK, BRAND)
    W = float(re.search(r'viewBox="0 0 ([\d.]+) 256"', lock).group(1))
    inner = re.search(r"</title>\n(.*)</svg>", lock, re.S).group(1)
    s = 760 / W
    tx, ty = round((1200 - W * s) / 2, 1), round((630 - 256 * s) / 2 - 10, 1)
    g0, g1, g2 = GRAD
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">\n'
            f'  <defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1200" y2="0">\n'
            f'    <stop offset="0" stop-color="{g0}"/><stop offset="0.5" stop-color="{g1}"/><stop offset="1" stop-color="{g2}"/>\n'
            f'  </linearGradient></defs>\n'
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

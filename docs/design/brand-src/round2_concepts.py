#!/usr/bin/env python3
"""Round two concept builds for the AcuDx mark (black on white, 256 canvas).

Four geometric constructions, one per candidate family from the round-two brief:
  A  pulse-seal      negative-space emblem: a rounded tile split by one acute deflection
  B  dx-monogram     solid D whose counter is the x of Dx
  C  differential    solid inverted triangle, three strands narrowing to one point
  D  apex            abstract: the spike of a trace as one solid shape on a baseline bar

Writes web/public/brand/concepts/round2/src/<concept>.svg plus a lockup per concept
(wordmark outlined from Manrope 800 via build_brand.py).

usage: python3 docs/design/brand-src/round2_concepts.py
"""
import math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_brand as bb  # noqa: E402

OUT = os.path.join(bb.ROOT, "web/public/brand/concepts/round2/src")


def f(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def path(d, color="#000"):
    return f'  <path fill="{color}" fill-rule="evenodd" d="{d}"/>\n'


# ---- A: pulse seal ------------------------------------------------------------
def pulse_seal(color="#000", small=False):
    """Rounded tile (12..244, rx 58) split in two by a channel that follows one 60 degree
    deflection: flat at y_base, apex at y_apex. Channel width w. The two pieces are drawn
    as explicit outlines (offset polylines), so there is no fake white cut-out."""
    y_base, y_apex, w = (172, 72, 28) if not small else (176, 86, 38)
    h = w / 2
    rise = y_base - y_apex
    half = rise * math.tan(math.radians(30))        # half-width of the spike at the baseline
    xl, xr = 128 - half, 128 + half
    miter = h / math.sin(math.radians(30))          # mitre of a 60 degree apex: 2h along the vertical
    tx = h * math.tan(math.radians(30))             # horizontal shift where a flat meets a leg
    up = (f"M12 {f(y_base-h)} H{f(xl-tx)} L128 {f(y_apex-miter)} L{f(xr+tx)} {f(y_base-h)} H244 "
          f"V70 A58 58 0 0 0 186 12 H70 A58 58 0 0 0 12 70 Z")
    low = (f"M12 {f(y_base+h)} H{f(xl+tx)} L128 {f(y_apex+miter)} L{f(xr-tx)} {f(y_base+h)} H244 "
           f"V186 A58 58 0 0 1 186 244 H70 A58 58 0 0 1 12 186 Z")
    return path(up, color) + path(low, color)


# ---- B: Dx monogram -------------------------------------------------------------
def dx_monogram(color="#000", small=False):
    """Solid D (stem x 40, bowl centre (120,128) r 96) with an x-shaped counter: two bars of
    half-length L and width w at 45 degrees, centred at (124,128)."""
    L, w = (54, 30) if not small else (50, 40)
    h = w / 2
    plus = [(L, h), (h, h), (h, L), (-h, L), (-h, h), (-L, h), (-L, -h), (-h, -h), (-h, -L), (h, -L), (h, -h), (L, -h)]
    c, s = math.cos(math.radians(45)), math.sin(math.radians(45))
    pts = [(124 + x * c - y * s, 128 + x * s + y * c) for x, y in plus]
    x_path = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"
    d_path = "M40 32 H120 A96 96 0 0 1 120 224 H40 Z"
    return path(d_path + " " + x_path, color)


# ---- C: differential ------------------------------------------------------------
def differential(color="#000", small=False):
    """Inverted 60 degree triangle, apex at (128, 232), top edge at y 40, two slits from the
    top edge divide it into three strands that merge into the single point."""
    w, y_end = (26, 150) if not small else (34, 146)
    H = 232 - 40
    half = H * math.tan(math.radians(30))
    xl, xr = 128 - half, 128 + half
    tri = f"M{f(xl)} 40 H{f(xr)} L128 232 Z"
    slits = ""
    for cx in (128 - 37, 128 + 37):
        slits += f" M{f(cx-w/2)} 40 H{f(cx+w/2)} V{y_end} H{f(cx-w/2)} Z"
    return path(tri + slits, color)


# ---- D: apex --------------------------------------------------------------------
def apex(color="#000", small=False):
    """Baseline bar (y 160..192, round ends) with one solid spike rising from it: vertical
    upstroke at x 96 to the apex (96, 40), then a 30 degree fall back to the bar. The shape of
    an action potential: fast rise, measured return."""
    if not small:
        x0, top, bar_t, bar_b = 96, 40, 160, 192
    else:
        x0, top, bar_t, bar_b = 92, 44, 156, 196
    r = (bar_b - bar_t) / 2
    hit = x0 + (bar_t - top) * math.tan(math.radians(30))
    d = (f"M32 {bar_t} H{x0} V{top} L{f(hit)} {bar_t} H224 A{r} {r} 0 0 1 224 {bar_b} "
         f"H32 A{r} {r} 0 0 1 32 {bar_t} Z")
    return path(d, color)


def round1_mark(color="#000"):
    """Round one: one acute deflection on a calm baseline (stroke 32, round caps, mitred apex)."""
    return (f'  <g fill="none" stroke="{color}" stroke-width="32" stroke-linecap="round">\n'
            f'    <path d="M31 212 L128 44 L225 212" stroke-linejoin="miter" stroke-miterlimit="4"/>\n'
            f'    <path d="M14 158 H242"/>\n  </g>\n')


CONCEPTS = {
    "a-pulse-seal": pulse_seal,
    "b-dx-monogram": dx_monogram,
    "c-differential": differential,
    "d-apex": apex,
}


def lockup(inst, blob, body, cap=164, gap=52, ink="#000", acc="#000"):
    baseline = 122 + cap / 2
    _, x0, _ = bb.wordmark(inst, blob, cap, baseline, 0, ink, acc)
    wm, _, x1 = bb.wordmark(inst, blob, cap, baseline, 256 + gap - x0, ink, acc)
    return bb.svg(round(x1, 1), 256, "AcuDx", f'  <g id="symbol">\n{body}  </g>\n  <g id="wordmark">\n{wm}  </g>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    inst, blob = bb.load_font()
    for name, fn in CONCEPTS.items():
        with open(os.path.join(OUT, f"concept-{name}-v1.svg"), "w") as fh:
            fh.write(bb.svg(256, 256, "AcuDx concept " + name, fn()))
        with open(os.path.join(OUT, f"concept-{name}-v1-small.svg"), "w") as fh:
            fh.write(bb.svg(256, 256, "AcuDx concept " + name + " small", fn(small=True)))
        with open(os.path.join(OUT, f"concept-{name}-lockup-v1.svg"), "w") as fh:
            fh.write(lockup(inst, blob, fn()))
        print("wrote", name)
    # round one's A for the side-by-side (geometry frozen here; build_brand.py now builds the seal)
    with open(os.path.join(OUT, "round1-a-acute-trace.svg"), "w") as fh:
        fh.write(bb.svg(256, 256, "AcuDx round 1 A", round1_mark()))
    with open(os.path.join(OUT, "round1-a-lockup.svg"), "w") as fh:
        fh.write(lockup(inst, blob, round1_mark(), gap=52))


if __name__ == "__main__":
    main()

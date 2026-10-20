#!/usr/bin/env python3
"""Generate web/public/brand/acudx-mark.lottie.json: the AcuDx pulse seal drawing in.

Two layers (the upper and the lower piece of the tile) on a 256 x 256 composition at 60 fps:
  1. each piece's outline draws along its edge with a trim path (upper frames 0-48, lower 8-56),
     starting at the left end of the trace so the deflection is the first thing seen,
  2. the solid fill fades in behind the outline (frames 30-66).
All easing is the AcuDx ease (cubic-bezier 0.16, 1, 0.3, 1). Total 84 frames = 1.4 s, no loop.

The geometry is identical to acudx-mark.svg (build_brand.MASTER, inset 12, rx 58); the rounded
corners are quarter circles as cubic beziers (kappa 0.5523). BrandLottie.tsx recolours every
fill and stroke to the live --axis-clinical token.
usage: python3 docs/design/brand-src/make_lottie.py
"""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_brand import MASTER, ROOT  # noqa: E402

OUT = os.path.join(ROOT, "web/public/brand/acudx-mark.lottie.json")

BRAND = (0x25 / 255, 0x63 / 255, 0xEB / 255)  # #2563eb
FR, OP = 60, 84
K = 0.5523 * 58  # bezier handle for a 58 unit quarter circle
STROKE = 10


def static(v):
    return {"a": 0, "k": v}


def ease(t0, v0, t1, v1):
    return {"a": 1, "k": [
        {"t": t0, "s": [v0], "e": [v1], "i": {"x": [0.16], "y": [1]}, "o": {"x": [0.3], "y": [0]}},
        {"t": t1, "s": [v1]},
    ]}


def pieces():
    """Vertices (v), in-tangents (i) and out-tangents (o) of the two pieces, relative handles."""
    y_base, y_apex, w = MASTER["y_base"], MASTER["y_apex"], MASTER["w"]
    h = w / 2
    half = (y_base - y_apex) * math.tan(math.radians(30))
    xl, xr = 128 - half, 128 + half
    miter = h / math.sin(math.radians(30))
    tx = h * math.tan(math.radians(30))
    r2 = lambda v: round(v, 2)
    upper = [  # starts at the left end of the trace, runs along the deflection first
        ((12, y_base - h), (0, 0), (0, 0)),
        ((r2(xl - tx), y_base - h), (0, 0), (0, 0)),
        ((128, y_apex - miter), (0, 0), (0, 0)),
        ((r2(xr + tx), y_base - h), (0, 0), (0, 0)),
        ((244, y_base - h), (0, 0), (0, 0)),
        ((244, 70), (0, 0), (0, -K)),
        ((186, 12), (K, 0), (0, 0)),
        ((70, 12), (0, 0), (-K, 0)),
        ((12, 70), (0, -K), (0, 0)),
    ]
    lower = [
        ((12, y_base + h), (0, K), (0, 0)),
        ((r2(xl + tx), y_base + h), (0, 0), (0, 0)),
        ((128, y_apex + miter), (0, 0), (0, 0)),
        ((r2(xr - tx), y_base + h), (0, 0), (0, 0)),
        ((244, y_base + h), (0, 0), (0, K)),
        ((186, 244), (K, 0), (0, 0)),
        ((70, 244), (0, 0), (-K, 0)),
    ]
    return upper, lower


def shape(pts):
    return {"ty": "sh", "nm": "path", "ks": static({
        "c": True,
        "v": [list(p[0]) for p in pts],
        "i": [list(p[1]) for p in pts],
        "o": [list(p[2]) for p in pts],
    })}


def transform():
    return {"ty": "tr", "a": static([0, 0]), "p": static([0, 0]), "s": static([100, 100]), "r": static(0),
            "o": static(100), "sk": static(0), "sa": static(0)}


def layer(name, idx, pts, t_draw, t_fill):
    d0, d1 = t_draw
    f0, f1 = t_fill
    return {
        "ddd": 0, "ind": idx, "ty": 4, "nm": name, "sr": 1, "st": 0, "ip": 0, "op": OP, "bm": 0, "ao": 0,
        "ks": {"o": static(100), "r": static(0), "p": static([0, 0, 0]), "a": static([0, 0, 0]), "s": static([100, 100, 100])},
        "shapes": [
            {"ty": "gr", "nm": name + " fill", "it": [
                shape(pts),
                {"ty": "fl", "nm": "fill", "c": static([*BRAND, 1]), "o": ease(f0, 0, f1, 100), "r": 1},
                transform(),
            ]},
            {"ty": "gr", "nm": name + " outline", "it": [
                shape(pts),
                {"ty": "st", "nm": "stroke", "c": static([*BRAND, 1]), "o": ease(f0, 100, f1, 0), "w": static(STROKE),
                 "lc": 2, "lj": 1, "ml": 4},
                {"ty": "tm", "nm": "draw", "s": static(0), "e": ease(d0, 0, d1, 100), "o": static(0), "m": 1},
                transform(),
            ]},
        ],
    }


upper, lower = pieces()
anim = {
    "v": "5.12.2", "nm": "AcuDx mark", "fr": FR, "ip": 0, "op": OP, "w": 256, "h": 256, "ddd": 0,
    "assets": [], "markers": [],
    "layers": [
        layer("upper", 1, upper, (0, 48), (30, 66)),
        layer("lower", 2, lower, (8, 56), (30, 66)),
    ],
}

with open(OUT, "w") as fh:
    json.dump(anim, fh, separators=(",", ":"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")

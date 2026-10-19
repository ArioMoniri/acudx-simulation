#!/usr/bin/env python3
"""Generate web/public/brand/acudx-mark.lottie.json: the AcuDx mark drawing in.

Two stroke layers on a 256 x 256 composition at 60 fps:
  1. the baseline trace draws left to right (frames 0-40),
  2. the acute deflection draws up from the left leg, over the apex and down (frames 20-70).
Both use trim paths with the AcuDx ease (cubic-bezier 0.16, 1, 0.3, 1). Total 1.5 s, no loop.

The geometry is identical to acudx-mark.svg (stroke 32, round caps, mitred apex).
usage: python3 docs/design/brand-src/make_lottie.py
"""
import json, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "web/public/brand/acudx-mark.lottie.json")

BRAND = (0x25 / 255, 0x63 / 255, 0xEB / 255)  # #2563eb
FR, OP = 60, 90


def static(v):
    return {"a": 0, "k": v}


def trim_end(t0, t1):
    return {"a": 1, "k": [
        {"t": t0, "s": [0], "e": [100], "i": {"x": [0.16], "y": [1]}, "o": {"x": [0.3], "y": [0]}},
        {"t": t1, "s": [100]},
    ]}


def path_shape(points):
    n = len(points)
    return {"ty": "sh", "nm": "path", "ks": static({"c": False, "i": [[0, 0]] * n, "o": [[0, 0]] * n, "v": points})}


def layer(name, idx, points, lj, t0, t1):
    return {
        "ddd": 0, "ind": idx, "ty": 4, "nm": name, "sr": 1, "st": 0, "ip": 0, "op": OP, "bm": 0, "ao": 0,
        "ks": {"o": static(100), "r": static(0), "p": static([0, 0, 0]), "a": static([0, 0, 0]), "s": static([100, 100, 100])},
        "shapes": [{
            "ty": "gr", "nm": name, "it": [
                path_shape(points),
                {"ty": "st", "nm": "stroke", "c": static([*BRAND, 1]), "o": static(100), "w": static(32), "lc": 2, "lj": lj, "ml": 4},
                {"ty": "tm", "nm": "draw", "s": static(0), "e": trim_end(t0, t1), "o": static(0), "m": 1},
                {"ty": "tr", "a": static([0, 0]), "p": static([0, 0]), "s": static([100, 100]), "r": static(0),
                 "o": static(100), "sk": static(0), "sa": static(0)},
            ],
        }],
    }


anim = {
    "v": "5.12.2", "nm": "AcuDx mark", "fr": FR, "ip": 0, "op": OP, "w": 256, "h": 256, "ddd": 0,
    "assets": [], "markers": [],
    "layers": [
        layer("deflection", 1, [[31, 212], [128, 44], [225, 212]], 1, 20, 70),
        layer("trace", 2, [[14, 158], [242, 158]], 2, 0, 40),
    ],
}

with open(OUT, "w") as fh:
    json.dump(anim, fh, separators=(",", ":"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")

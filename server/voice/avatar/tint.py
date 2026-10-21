"""Fever flush as a deterministic, even warm tint of the face (never a model-drawn colour).

Live 2026-10-21 (FLUX.2 klein 4B on the worker): every wording that asked the image model for a
flush ("flushed red cheeks", "feverish redness", "an even pink-red tint", "a faint, even flush")
produced, on some faces or seeds, pink patches on the cheeks or forehead that read as a rash, a sign
the case does not have. The model now draws everything but the colour, and the gateway warms the
face here: a smooth elliptical mask over the face and neck (the bundled portraits are centred head
and shoulders shots), feathered, the same gain everywhere inside it, so the result can be strong or
faint but never blotchy.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageFilter

# Channel gains at full mask per fever level (1 mild, 2 marked).
GAINS = {1: (1.035, 0.995, 0.985), 2: (1.07, 0.99, 0.97)}


def face_mask(w: int, h: int) -> np.ndarray:
    """Soft ellipse over the face (and a fainter one over the neck), 0..1."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    face = ((xx - 0.5 * w) / (0.26 * w)) ** 2 + ((yy - 0.42 * h) / (0.30 * h)) ** 2
    neck = ((xx - 0.5 * w) / (0.17 * w)) ** 2 + ((yy - 0.74 * h) / (0.10 * h)) ** 2
    m = np.clip(1.25 - face, 0.0, 1.0) + 0.6 * np.clip(1.0 - neck, 0.0, 1.0)
    img = Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8))
    img = img.filter(ImageFilter.GaussianBlur(radius=max(4, w // 30)))
    return np.asarray(img, dtype=np.float32) / 255.0


def warm_flush(jpeg: bytes, level: int) -> bytes:
    """The picture with an even fever flush of ``level`` (0 returns it unchanged)."""
    if level <= 0:
        return jpeg
    im = Image.open(io.BytesIO(jpeg)).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    m = face_mask(im.width, im.height)[..., None]
    gains = np.asarray(GAINS[min(2, level)], dtype=np.float32)
    out = a * (1.0 + m * (gains - 1.0))
    buf = io.BytesIO()
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(buf, format="JPEG", quality=93)
    return buf.getvalue()

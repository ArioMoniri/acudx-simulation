"""The fever flush is an even, deterministic warm tint of the face, never a model-drawn colour."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from server.voice.avatar import appearance as ap
from server.voice.avatar.tint import warm_flush


def _jpeg(w=530, h=720, rgb=(170, 140, 120)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), rgb).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _arr(b: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(b)).convert("RGB"), dtype=np.float32)


def test_flush_warms_the_face_evenly_and_leaves_the_corners():
    src = _jpeg()
    a, b = _arr(src), _arr(warm_flush(src, 2))
    red = lambda x: x[..., 0] - (x[..., 1] + x[..., 2]) / 2  # noqa: E731
    d = red(b) - red(a)
    h, w = d.shape
    core = d[int(0.33 * h):int(0.5 * h), int(0.4 * w):int(0.6 * w)]
    assert core.mean() > 10                      # visibly warmer face
    assert core.std() < 2.0                      # the same everywhere: no patches
    assert abs(d[:20, :20].mean()) < 1.5 and abs(d[-20:, :20].mean()) < 1.5   # background untouched
    mild = red(_arr(warm_flush(src, 1))) - red(a)
    assert 0 < mild[int(0.4 * h), int(0.5 * w)] < core.mean()


def test_no_flush_without_fever():
    src = _jpeg()
    assert warm_flush(src, 0) == src


def test_the_model_is_never_asked_for_a_colour_change_for_fever():
    look = ap.Look(signs={"fever_flush": 2, "diaphoresis": 1}, phase="deteriorating", identity={"age": 50, "sex": "male"})
    p = ap.edit_prompt(look).lower()
    assert "flush" not in p and "redness" not in p and "pink" not in p
    assert "feverish" in p and "no rash" in p

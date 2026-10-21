"""Idle <-> state cross-fade without ghosting (docs/architecture/18 section 6.6.1).

Live 2026-10-21 (production): when the call switched from the plain portrait to an edited picture of
the patient, one or two frames showed two faces, because the edit (FLUX.2 klein) came back a little
shifted and scaled. The runner now registers every edit onto the base portrait
(``acudx_register.align_to``), reuses the base's crop, extension and face box, waits until the
patient is silent and fades on matched idle-loop frames. These tests run that runner code (from
cloud-init) on real portraits and on stand-ins for the LiveTalking session.
"""

from __future__ import annotations

import ast
import collections
import os
import queue
import time
import types
from pathlib import Path

import numpy as np
import pytest
import yaml

cv2 = pytest.importorskip("cv2")  # requirements-dev.txt: opencv-python-headless (the runner's own pin)

ROOT = Path(__file__).resolve().parents[2]
CLOUD_INIT = ROOT / "infra" / "gpu-worker" / "cloud-init.yaml"
PORTRAITS = sorted((ROOT / "web" / "public" / "patients").glob("p0*.jpg"))


def _written(suffix: str) -> str:
    files = yaml.safe_load(CLOUD_INIT.read_text(encoding="utf-8"))["write_files"]
    return next(f["content"] for f in files if f["path"].endswith(suffix))


def _register():
    mod = types.ModuleType("acudx_register")
    exec(compile(_written("/acudx_register.py"), "acudx_register.py", "exec"), mod.__dict__)
    return mod


def _runner_defs(*names: str) -> dict:
    """Only the named top-level functions and classes of the runner, with the stdlib they use."""
    src = _written("/acudx_avatar_server.py")
    tree = ast.parse(src)
    keep = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    assert {n.name for n in keep} == set(names)
    ns = {"cv2": cv2, "np": np, "time": time, "collections": collections, "queue": queue, "os": os,
          "QUIET_FRAMES": 12}
    exec(compile(ast.Module(body=keep, type_ignores=[]), "runner_part", "exec"), ns)
    return ns


def _edit_like_flux(img: np.ndarray, *, angle: float, scale: float, dx: float, dy: float) -> np.ndarray:
    """What the image edit server does to framing: a small similarity change, another output size
    (multiples of 16), and the face itself altered (here: a redder, darker centre)."""
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, scale)
    m[0, 2] += dx
    m[1, 2] += dy
    out = cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REFLECT_101)
    out = cv2.resize(out, (w // 16 * 16 + 16, h // 16 * 16), interpolation=cv2.INTER_CUBIC)
    hh, ww = out.shape[:2]
    face = out[int(hh * .3):int(hh * .62), int(ww * .33):int(ww * .67)].astype(np.float32)
    out[int(hh * .3):int(hh * .62), int(ww * .33):int(ww * .67)] = np.clip(face * np.array([0.85, 0.9, 1.2]), 0, 255)
    return out


@pytest.mark.parametrize("portrait", PORTRAITS[:4], ids=lambda p: p.stem)
def test_an_edit_is_registered_onto_its_base_portrait(portrait):
    R = _register()
    ref = cv2.imread(str(portrait))
    edit = _edit_like_flux(ref, angle=1.8, scale=1.06, dx=9, dy=-6)
    out, info = R.align_to(ref, edit)
    assert out.shape == ref.shape
    unaligned = R.fit_size(edit, ref.shape[1], ref.shape[0])
    # the background and shoulders (outer band) land where the base has them
    assert info["residual_before"] > 10 and info["residual_after"] < 2.0, info
    assert R.ghost_score(ref, unaligned) > 0.5 and R.ghost_score(ref, out) < 0.02
    assert info["method"] in ("orb+ecc", "orb", "ecc") and info["inliers"] >= 25
    # the face change is kept (registration moves pixels, it does not copy the base back)
    cy, cx = ref.shape[0] // 2, ref.shape[1] // 2
    assert np.abs(out[cy - 30:cy + 30, cx - 30:cx + 30].astype(int) - ref[cy - 30:cy + 30, cx - 30:cx + 30]).mean() > 5


def test_an_unrelated_picture_is_left_unwarped():
    R = _register()
    a = cv2.imread(str(PORTRAITS[0]))
    b = cv2.imread(str(PORTRAITS[3]))
    out, info = R.align_to(a, b)
    assert out.shape == a.shape
    assert abs(info["scale"] - 1.0) <= R.MAX_SCALE_DEV and abs(info["rotation_deg"]) <= R.MAX_ROT_DEG


def test_the_runner_prepares_a_variant_on_the_bases_frame_and_face_box():
    src = _written("/acudx_avatar_server.py")
    assert "def replay_steps(img: np.ndarray, steps: list) -> np.ndarray:" in src
    assert "img, registration = acudx_register.align_to(src, img)" in src
    assert 'coords = [int(v) for v in info["face_box"]]' in src
    assert 'steps.append(["extend", *sides])' in src and '"steps": steps, "ref": ref' in src
    assert 'ref = request.query.get("ref") or None' in src and '"ref_not_prepared"' in src
    # older prepared avatars (no source.png, no steps) are prepared again
    assert "PREP_VERSION = 3" in src
    # the mounted module is imported by the runner and listed for the container
    assert "import acudx_register" in src


def test_replaying_the_bases_steps_gives_the_bases_frame():
    ns = _runner_defs("replay_steps", "extend_portrait")
    img = cv2.imread(str(PORTRAITS[1]))
    steps = [["crop", img.shape[1], img.shape[0]], ["extend", 40, 0, 12, 12], ["crop", img.shape[1] + 24, img.shape[0] + 40]]
    a = ns["replay_steps"](img, steps)
    b = ns["replay_steps"](img.copy(), steps)
    assert a.shape == (img.shape[0] + 40, img.shape[1] + 24, 3) and np.array_equal(a, b)


class _Out:
    def __init__(self):
        self.sent: list = []

    def push_video_frame(self, frame) -> None:
        self.sent.append(frame)


def _session(cycle):
    s = types.SimpleNamespace(output=_Out(), speaking=False, _acudx_idx=0)
    s.frame_list_cycle, s.mask_list_cycle, s.coord_list_cycle, s.mask_coords_list_cycle, s.input_latent_list_cycle = (
        cycle, ["m"] * len(cycle), ["c"] * len(cycle), ["mc"] * len(cycle), ["l"] * len(cycle))
    return s


def _cycle(value: int, n: int = 6) -> list:
    return [np.full((8, 8, 3), value + i, np.uint8) for i in range(n)]


def test_a_switch_waits_for_silence_and_fades_on_matched_loop_frames():
    ns = _runner_defs("_install_crossfade", "_swap_cycles")
    old, new = _cycle(10), _cycle(200)
    sess = _session(old)
    ns["_install_crossfade"](sess)
    st = sess._acudx_fade
    sess.speaking = True
    for k in range(3):
        sess._acudx_idx = k
        sess.output.push_video_frame(old[k])
    st["pending"] = (tuple([new, ["m"] * 6, ["c"] * 6, ["mc"] * 6, ["l"] * 6]), 400, "acudx-p01-v")
    for k in range(20):  # still speaking: nothing changes mid-word
        sess._acudx_idx = k % 6
        sess.output.push_video_frame(old[k % 6])
    assert sess.frame_list_cycle is old and st["pending"] is not None
    sess.speaking = False
    for k in range(11):
        sess._acudx_idx = k % 6
        sess.output.push_video_frame(old[k % 6])
    assert sess.frame_list_cycle is old  # 11 silent frames: not yet
    sess._acudx_idx = 5
    sess.output.push_video_frame(old[5])   # the 12th silent frame applies it, at the frame boundary
    assert sess.frame_list_cycle is new and sess._acudx_avatar == "acudx-p01-v"
    # the next frames come from the new cycle; the fade blends the old cycle at the same index
    sess._acudx_idx = 0
    sess.output.push_video_frame(new[0])
    blended = sess.output.sent[-1]
    lo, hi = int(old[0][0, 0, 0]), int(new[0][0, 0, 0])
    assert lo <= int(blended[0, 0, 0]) <= hi
    # every blend is between the same pose of both pictures (never the last frame of another pose)
    sess._acudx_idx = 3
    sess.output.push_video_frame(new[3])
    b3 = int(sess.output.sent[-1][0, 0, 0])
    assert int(old[3][0, 0, 0]) <= b3 <= int(new[3][0, 0, 0])
    time.sleep(0.45)
    sess._acudx_idx = 4
    sess.output.push_video_frame(new[4])
    assert np.array_equal(sess.output.sent[-1], new[4]) and st["from"] is None


def test_the_video_delay_can_change_during_a_call_one_frame_at_a_time():
    ns = _runner_defs("_install_av_shift")
    sess = types.SimpleNamespace(output=_Out())
    ns["_install_av_shift"](sess, 160)  # 4 frames
    frames = list(range(40))
    for f in frames[:10]:
        sess.output.push_video_frame(f)
    assert sess.output.sent == [0, 0, 0, 0, 0, 1, 2, 3, 4, 5]
    sess._acudx_shift["n"] = 1   # shrink: one skipped frame per frame, never a jump of 3
    for f in frames[10:16]:
        sess.output.push_video_frame(f)
    lag = [f - sess.output.sent[f] for f in frames[10:16]]
    assert lag == [3, 2, 1, 1, 1, 1]
    sess._acudx_shift["n"] = 3   # grow: one repeated frame per frame
    for f in frames[16:22]:
        sess.output.push_video_frame(f)
    lag = [f - sess.output.sent[f] for f in frames[16:22]]
    assert lag == [1, 2, 3, 3, 3, 3]
    assert len(sess.output.sent) == 22  # exactly one frame out per frame in (audio pairing intact)

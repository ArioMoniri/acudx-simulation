"""The runner prepares a call's picture first and never twice (docs/architecture/18 6.8.1).

Live 2026-10-21 (A100 worker, warm): the voice click reached a first frame after 85 to 90 s. The gateway
log showed the case portrait prepared twice, one preparation after the other on the runner's single
lock: the case-start ladder's PUT and the call's own PUT, each about 42 s, with the session's 10 s wait
for the look before them. The runner's code ships inside cloud-init and imports torch and LiveTalking,
so the pieces are taken from its source with ``ast`` and run here on their own."""

from __future__ import annotations

import ast
import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra" / "gpu-worker"))
import worker_images  # noqa: E402

RUNNER = worker_images.written_files()["/opt/acudx/avatar/acudx_avatar_server.py"]
COMPOSE = worker_images.written_files()["/opt/acudx/docker-compose.yml"]


def _pieces(names: set[str], ns: dict) -> dict:
    tree = ast.parse(RUNNER)
    keep = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in names]
    assert {n.name for n in keep} == names
    exec(compile(ast.Module(body=keep, type_ignores=[]), "runner", "exec"), ns)  # noqa: S102
    return ns


def test_a_call_preparation_goes_ahead_of_the_queued_ladder():
    ns = _pieces({"PrepQueue"}, {"threading": threading})
    q = ns["PrepQueue"]()
    order: list[str] = []
    q.acquire(1)                                    # a ladder look is being prepared

    def job(name: str, prio: int) -> None:
        q.acquire(prio)
        order.append(name)
        time.sleep(0.01)
        q.release()

    ts = [threading.Thread(target=job, args=("look-2", 1)), threading.Thread(target=job, args=("look-3", 1))]
    for t in ts:
        t.start()
    time.sleep(0.05)
    call = threading.Thread(target=job, args=("call-portrait", 0))
    call.start()
    time.sleep(0.05)
    assert q.depth() == 4
    q.release()
    for t in (*ts, call):
        t.join(2)
    assert order == ["call-portrait", "look-2", "look-3"]
    assert q.depth() == 0


def test_the_content_key_follows_the_picture_and_its_base(tmp_path):
    root = tmp_path / "avatars"
    (root / "base").mkdir(parents=True)
    (root / "base" / "avator_info.json").write_text(json.dumps({"content_key": "k-base"}))

    def _avatar_dir(a: str) -> str:
        return str(root / a)

    def _base_info(a: str) -> dict:
        return json.loads(Path(_avatar_dir(a), "avator_info.json").read_text())

    ns = _pieces({"content_key"}, {"hashlib": hashlib, "PREP_VERSION": 3, "_base_info": _base_info})
    k = ns["content_key"]
    assert k(b"jpeg-1", None, 75) == k(b"jpeg-1", None, 75)
    assert k(b"jpeg-1", None, 75) != k(b"jpeg-2", None, 75)
    assert k(b"jpeg-1", None, 75) != k(b"jpeg-1", None, 1)
    before = k(b"edit", "base", 75)
    assert before != k(b"edit", None, 75)                          # an edit is keyed by its base too
    (root / "base" / "avator_info.json").write_text(json.dumps({"content_key": "k-base-2"}))
    assert k(b"edit", "base", 75) != before                        # a re-prepared base re-keys its edits


def test_the_runner_dedupes_caches_and_reports_its_queue():
    # A PUT of a picture already prepared under the same content key answers from disk ("cached": "local");
    # a preparation another worker saved on the filesystem is copied ("filesystem"); a new one is saved.
    src = RUNNER
    assert "if _prepared_key(avatar_id) == key:" in src and 'cached="local"' in src
    assert "_from_cache(avatar_id, key)" in src and 'cached="filesystem"' in src
    assert "threading.Thread(target=_to_cache" in src
    assert 'request.query.get("priority") == "call"' in src
    assert '"prep_queue": PREP_QUEUE.depth()' in src
    assert "PREP_LOCK" not in src
    assert "AVATAR_CACHE_DIR=/avatar-cache" in COMPOSE and "${AVATAR_CACHE:-/opt/acudx/avatar-cache}:/avatar-cache" in COMPOSE
    ci = Path(worker_images.CLOUD_INIT).read_text()
    assert 'AVATAR_CACHE=$FS/acudx-avatars' in ci


def test_the_cache_copy_round_trips(tmp_path, monkeypatch):
    import shutil

    root, cache = tmp_path / "avatars", tmp_path / "cache"
    ns: dict = {"os": os, "json": json, "threading": threading, "AVATAR_CACHE_DIR": str(cache),
                "log": type("L", (), {"info": staticmethod(lambda *a, **k: None)})()}
    ns["_avatar_dir"] = lambda a: str(root / a)
    ns["_is_prepared"] = lambda a: (root / a / "latents.pt").is_file()
    _pieces({"_from_cache", "_to_cache"}, ns)
    (root / "a1").mkdir(parents=True)
    (root / "a1" / "latents.pt").write_bytes(b"L")
    (root / "a1" / "avator_info.json").write_text(json.dumps({"avatar_id": "a1", "content_key": "K"}))
    ns["_to_cache"]("a1", "K")
    assert (cache / "K" / "latents.pt").read_bytes() == b"L"
    assert ns["_from_cache"]("a2", "K") is True
    assert json.loads((root / "a2" / "avator_info.json").read_text())["avatar_id"] == "a2"
    assert ns["_from_cache"]("a3", "other") is False
    shutil.rmtree(cache)


def test_detection_runs_on_one_canvas_size_and_maps_the_box_back(tmp_path):
    # MuseTalk's S3FD turns cudnn.benchmark on, so each new input size was autotuned (11.9 to 15.3 s live).
    import cv2
    import numpy as np

    seen: list[tuple[int, int]] = []
    ns = {"np": np, "cv2": cv2, "os": os, "DETECT_CANVAS": (720, 768), "STATE": {}}
    _pieces({"_canvas_for", "_detect_fixed"}, ns)

    def detect_face(img, mode=None):
        canvas, s = ns["_canvas_for"](img)
        seen.append(canvas.shape[:2])
        return [v / s for v in (100.0, 50.0, 300.0, 400.0)], {"mode": "fast"}

    ns["detect_face"] = detect_face
    box = ns["_detect_fixed"](np.zeros((720, 702, 3), np.uint8), str(tmp_path / "d.png"))
    assert box == [100.0, 50.0, 300.0, 400.0]
    big = ns["_detect_fixed"](np.zeros((1440, 1404, 3), np.uint8), str(tmp_path / "d.png"))
    assert big == [200.0, 100.0, 600.0, 800.0]                  # scaled down for detection, mapped back
    assert seen == [(720, 768), (720, 768)] and not (tmp_path / "d.png").exists()
    assert ns["STATE"]["last_detect"] == {"mode": "fast"}


def test_the_landmark_box_rule_is_musetalks():
    import numpy as np

    ns = {"np": np}
    _pieces({"_landmark_box"}, ns)
    lm = np.zeros((68, 2), np.int32)
    lm[:, 0] = np.linspace(100, 300, 68)
    lm[:, 1] = np.linspace(200, 400, 68)
    lm[29] = (200, 300)
    # nose bridge at y 300, chin at y 400: the box starts 100 px above the bridge
    assert tuple(int(v) for v in ns["_landmark_box"](lm, (1, 2, 3, 4))) == (100, 200, 300, 400)
    assert ns["_landmark_box"](np.zeros((68, 2), np.int32), (1, 2, 3, 4)) == (1, 2, 3, 4)   # unusable: S3FD box


def test_a_ladder_preparation_pauses_while_a_call_speaks_but_a_calls_own_does_not():
    src = RUNNER
    assert src.count("_yield_to_speech()") >= 2
    assert 'PREP_YIELDS["on"] = priority != PREP_PRIORITY_CALL' in src
    assert "raw_box = _detect_fixed(img" in src and "get_landmark_and_bbox([frame_path]" not in src


def test_the_idle_loops_latents_are_encoded_in_batches():
    # 2.5 s of a 6.1 s preparation on an idle A100 40 GB went to one VAE pass per frame (live 2026-10-22).
    src = RUNNER
    assert "latents.extend(vae_latents(crops[i:i + VAE_BATCH]))" in src
    assert "VAE.get_latents_for_unet(crop))" not in src
    assert "lm, lf = VAE.encode_latents(masked), VAE.encode_latents(full)" in src

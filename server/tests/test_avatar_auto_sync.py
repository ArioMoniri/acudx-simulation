"""Lip sync from the sender's own clock (docs/architecture/18 6.3.13).

Production 2026-10-22 (A100 40 GB, 0c2a6bc) showed the lips 320 to 520 ms ahead of the voice with the fixed
160 ms video delay that the H100 runs had settled on. The browser plays audio and video on one clock built
from the RTCP sender reports, and aiortc maps each RTP timestamp to the moment the packet was sent, so the
runner can read the offset the browser will see from its own send times. The runner's code ships inside
cloud-init and imports torch and LiveTalking, so the pieces are taken from its source with ``ast``."""

from __future__ import annotations

import ast
import collections
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra" / "gpu-worker"))
import worker_images  # noqa: E402

RUNNER = worker_images.written_files()["/opt/acudx/avatar/acudx_avatar_server.py"]


def _pieces(names: set[str], ns: dict) -> dict:
    tree = ast.parse(RUNNER)
    keep = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and n.name in names]
    assert {n.name for n in keep} == names
    exec(compile(ast.Module(body=keep, type_ignores=[]), "runner", "exec"), ns)  # noqa: S102
    return ns


class _Track:
    def __init__(self, offsets: list[float]):
        self._acudx_offsets = collections.deque(offsets, maxlen=100)


def _session(audio_offsets: list[float], video_offsets: list[float]):
    shown_v: list[int] = []
    sent_a: list[tuple[np.ndarray, object]] = []
    out = SimpleNamespace(push_video_frame=shown_v.append, push_audio_frame=lambda f, ev=None: sent_a.append((f, ev)))
    sess = SimpleNamespace(output=out, speaking=False)
    tracks = (_Track(audio_offsets), _Track(video_offsets))
    return sess, tracks, shown_v, sent_a


def _ns(tracks, auto: bool = True, receiver: bool = False) -> dict:
    ns = {"collections": collections, "np": np, "time": time, "AUTO_SYNC": auto, "MAX_SHIFT_FRAMES": 25, "RECEIVER_SYNC": receiver,
          "_tracks": lambda sess: tracks}
    return _pieces({"_median", "sender_sync", "_install_av_shift"}, ns)


def test_the_sender_skew_reads_the_lip_offset_the_browser_will_see():
    # Audio leaves 400 ms after its paired video (an audio sender behind real time): lips 400 ms early.
    sess, tracks, _, _ = _session([100.40] * 10, [100.00] * 10)
    ns = _ns(tracks)
    ns["_install_av_shift"](sess, 160)
    sync = ns["sender_sync"](sess)
    assert sync["video_minus_audio_ms"] == -400.0
    assert sync["delay_ms"] == 160
    assert sync["lag_ms"] == -240.0          # the fixed 160 ms covers part of it: lips still 240 ms early


def test_auto_sync_sets_the_video_delay_from_the_skew_with_the_right_sign():
    sess, tracks, shown, _ = _session([100.40] * 10, [100.00] * 10)
    ns = _ns(tracks)
    ns["_install_av_shift"](sess, 160)
    for k in range(25 * 12):                 # 12 s of frames: retarget once a second, one frame per frame
        sess.output.push_video_frame(k)
    st = sess._acudx_shift
    assert st["n"] == 10                     # 400 ms of video delay: video k - 10 with audio 2k
    assert shown[-1] == 25 * 12 - 1 - 10
    assert abs(ns["sender_sync"](sess)["lag_ms"]) <= 20


def test_lips_late_at_the_sender_delay_the_audio_on_silent_frames_only():
    # Video leaves 200 ms after its audio (a slow video encoder): lips late, so the audio waits 200 ms.
    sess, tracks, _, sent = _session([100.00] * 10, [100.20] * 10)
    ns = _ns(tracks)
    ns["_install_av_shift"](sess, 0)
    for k in range(25):
        sess.output.push_video_frame(k)
    assert sess._acudx_shift["n"] == -5      # 10 audio frames of 20 ms
    loud = np.full(320, 8000, dtype=np.int16)
    sess.speaking = True
    for _ in range(4):
        sess.output.push_audio_frame(loud, None)
    assert all(int(np.abs(f).max()) == 8000 for f, _ in sent)     # speech is never replaced by silence
    sess.speaking = False
    quiet = np.zeros(320, dtype=np.int16)
    for _ in range(30):
        sess.output.push_audio_frame(quiet, None)
    assert len(sent) == 34                    # one frame out for every frame in (the track paces by count)


def test_the_browser_residual_moves_the_bias_not_a_fixed_delay():
    sess, tracks, _, _ = _session([100.40] * 10, [100.00] * 10)
    ns = _ns(tracks)
    ns["_install_av_shift"](sess, 0)
    st = sess._acudx_shift
    st["bias_ms"] = 80.0                     # the browser measured lips 80 ms late with the delay set
    for k in range(50):
        sess.output.push_video_frame(k)
    assert st["n"] == 8                      # -( -400 + 80 ) / 40


def test_without_auto_sync_the_delay_stays_where_the_gateway_put_it():
    sess, tracks, shown, _ = _session([100.40] * 10, [100.00] * 10)
    ns = _ns(tracks, auto=False)
    ns["_install_av_shift"](sess, 160)
    for k in range(100):
        sess.output.push_video_frame(k)
    assert sess._acudx_shift["n"] == 4
    assert shown[-1] == 99 - 4


def test_the_browsers_receive_side_desync_adds_to_the_sender_skew():
    # Sender in step (skew 0), but the browser plays the picture 185 ms early (its A/V sync still converging
    # on the first line of a call): the video waits about 185 ms; a reading 15 s old no longer counts.
    sess, tracks, _, _ = _session([100.0] * 10, [100.0] * 10)
    ns = _ns(tracks, receiver=True)
    ns["_install_av_shift"](sess, 0)
    st = sess._acudx_shift
    st["recv_ms"], st["recv_at"] = -185.0, time.time()
    for k in range(25):
        sess.output.push_video_frame(k)
    assert st["n"] == 5
    st["recv_at"] = time.time() - 20
    for k in range(25):
        sess.output.push_video_frame(k)
    assert st["n"] == 0
    # A reading from a stalled runner (live: -1837 ms) never steers the delay.
    st["recv_ms"], st["recv_at"] = -1837.0, time.time()
    for k in range(25):
        sess.output.push_video_frame(k)
    assert st["n"] == 0


def test_the_receive_side_reading_is_telemetry_unless_switched_on():
    sess, tracks, _, _ = _session([100.0] * 10, [100.0] * 10)
    ns = _ns(tracks)
    ns["_install_av_shift"](sess, 0)
    st = sess._acudx_shift
    st["recv_ms"], st["recv_at"] = -185.0, time.time()
    for k in range(50):
        sess.output.push_video_frame(k)
    assert st["n"] == 0


def test_a_held_runner_pauses_its_preparations_before_any_audio_arrives():
    # Live 2026-10-22 (A100 40 GB): a look prepared while the first reply was synthesised took the runner to
    # 4 fps and the voice to 7.8 s; the gateway now holds the preparations when a voiced turn starts.
    state = {"hold_until": time.monotonic() + 0.3}
    ns = _pieces({"_yield_to_speech"}, {"time": time, "STATE": state, "PREP_YIELDS": {"on": True},
                                        "PREP_YIELD_MAX_S": 5.0,
                                        "session_manager": SimpleNamespace(sessions={"a": SimpleNamespace(speaking=False)})})
    t0 = time.monotonic()
    ns["_yield_to_speech"]()
    assert 0.25 <= time.monotonic() - t0 < 1.0
    state["hold_until"] = 0.0
    t0 = time.monotonic()
    ns["_yield_to_speech"]()
    assert time.monotonic() - t0 < 0.05
    assert 'app.router.add_post("/hold", hold)' in RUNNER


def test_the_sync_probe_marks_each_frame_with_its_own_audio_before_the_delay_line():
    ns = _pieces({"probe_rms", "_install_probe"}, {"np": np, "PROBE_PX": 8})
    shown: list = []
    sess = SimpleNamespace(output=SimpleNamespace(push_video_frame=shown.append), _acudx_probe=True,
                           _acudx_probe_rms=0.0)
    ns["_install_probe"](sess)
    quiet = np.zeros((32, 32, 3), dtype=np.uint8)
    sess._acudx_probe_rms = ns["probe_rms"]([SimpleNamespace(data=np.full(320, 0.1, dtype=np.float32))] * 2)
    assert abs(sess._acudx_probe_rms - 0.1) < 1e-6
    sess.output.push_video_frame(quiet)
    assert int(shown[-1][-1, -1, 0]) == 176 and int(quiet[-1, -1, 0]) == 0   # marked on a copy, never in place
    sess._acudx_probe = False
    sess.output.push_video_frame(quiet)
    assert shown[-1] is quiet


def test_an_image_edit_pauses_between_its_steps_while_a_reply_is_on_its_way():
    imagegen = worker_images.written_files()["/opt/acudx/imagegen/acudx_imagegen.py"]
    assert "callback_on_step_end=_pause_while_held" in imagegen and 'app.router.add_post("/hold", hold)' in imagegen
    gw = (Path(__file__).resolve().parents[1] / "voice" / "avatar" / "musetalk.py").read_text(encoding="utf-8")
    assert 'for path in ("/avatar/hold", "/imagegen/hold")' in gw


def test_the_sender_offsets_are_taken_per_encoded_frame_and_the_tuning_route_reports_them():
    assert "_aiortc_sender.RTCRtpSender._next_encoded_frame = _next_encoded" in RUNNER
    assert '"browser_lag_ms"' in RUNNER and '"sync": sender_sync(sess)' in RUNNER
    assert "CONNECT_DEADLINE_S" in RUNNER     # a call that never connects frees its slot

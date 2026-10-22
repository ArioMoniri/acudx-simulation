"""Keep the live call's face in step with the case: one story across video, voice, vitals and results.

At call start (:func:`start`) the gateway reads the case thread from the server store (never from
the browser), works out how the patient looks now (:mod:`appearance`), and asks the worker's image
edit server (FLUX.2 klein 4B) for the case portrait in that state, then a ladder of the other likely
states (worse, critical, improved, unresponsive). Each picture becomes a prepared MuseTalk avatar on
the same worker. After every Director step (:func:`on_director`, called by ``/v2/director/step``)
the live look is recomputed and the call is switched, with a crossfade, to the prepared picture that
matches it without showing anything the patient does not have; a look that is not prepared yet is
generated in the background and switched to when it is ready.

The voice follows the same look: :func:`voice_for` gives the TTS speed and the persona lines
(breathless phrasing, pain, cough, drowsy, silent in arrest).

When the worker has no image edit server (disabled for lack of VRAM, still loading) the call keeps
the case portrait and the session says so (``appearance.source: "portrait"`` with the reason), so the
tile and the capture can show that the face is not state-synced.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from server.voice.avatar import appearance as ap
from server.voice.avatar import musetalk as mt
from server.voice.avatar.tint import warm_flush

log = logging.getLogger("acudx.voice.avatar.state")

CROSSFADE_MS = 900


@dataclass
class Variant:
    name: str
    look: ap.Look
    avatar_id: str
    status: str = "pending"       # pending | generating | preparing | ready | failed
    gen_ms: float | None = None
    prepare_ms: float | None = None
    error: str | None = None
    mode: str | None = None
    image: bytes | None = None    # the generated JPEG (served to the call's owner, never persisted)
    prompt: str | None = None
    retryable: bool = False
    # How the runner registered the picture onto the base portrait (method, scale, shift, residuals).
    registration: dict[str, Any] | None = None

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "key": self.look.key, "avatar_id": self.avatar_id, "status": self.status,
                "prompt": self.prompt, "has_image": self.image is not None,
                "signs": self.look.public()["signs"], "gen_ms": self.gen_ms, "prepare_ms": self.prepare_ms,
                "error": self.error, "mode": self.mode, "registration": self.registration}


@dataclass
class Appearance:
    thread_id: str
    photo_id: str
    base_avatar_id: str
    variants: dict[str, Variant] = field(default_factory=dict)   # look key -> variant
    live: ap.Look | None = None
    current_key: str | None = None
    source: str = "portrait"         # portrait | generated
    reason: str | None = None
    switches: list[dict[str, Any]] = field(default_factory=list)
    # The worker whose image edit server makes the pictures (in a pool, the fastest one; the
    # pictures are then prepared on the call's own worker).
    gen_worker: Any = None
    gen_mode: str | None = None
    # The runner session of the connected call (set by /offer): a picture that becomes ready later
    # (the ladder in the background, a look generated on demand) is switched to at once.
    worker_session: str | None = None
    first_done: Any = None               # asyncio.Event: the presenting look is ready (or failed)
    worker_origin: str | None = None     # the runner the pictures are prepared on
    tasks: set[asyncio.Task[Any]] = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def public(self) -> dict[str, Any]:
        return {"thread_id": self.thread_id, "source": self.source, "reason": self.reason, "gen_mode": self.gen_mode,
                "gen_worker": getattr(self.gen_worker, "domain", None),
                "live": self.live.public() if self.live else None, "current_key": self.current_key,
                "variants": [v.public() for v in self.variants.values()], "switches": self.switches[-20:]}


# Bumped whenever the pictures for the same look change (prompts, the fever tint), so a worker never
# reuses a face it prepared from an older picture under the same id.
APPEARANCE_VERSION = 5  # 5: variants registered onto the base portrait


def variant_avatar_id(photo_id: str, thread_id: str, key: str) -> str:
    t = hashlib.sha256(f"{thread_id}:v{APPEARANCE_VERSION}".encode("utf-8")).hexdigest()[:8]
    return f"acudx-{photo_id}-{t}-{key}"


def seed_for(thread_id: str) -> int:
    """One seed per case: every state of the same patient starts from the same noise."""
    return int(hashlib.sha256(("acudx-look:" + thread_id).encode("utf-8")).hexdigest()[:8], 16)


async def case_view(app: Any, thread_id: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """(source spec, Director state) of a thread from the server store, or None."""
    rt = getattr(app.state, "orchestration", None)
    if rt is None or not thread_id:
        return None
    st = rt.cases.get(thread_id)
    if not st or not st.get("spec"):
        return None
    try:
        from server.orchestration.staged import source_spec  # noqa: PLC0415 - optional at import time

        spec = source_spec(st) if st.get("opening") and st.get("condition") else st["spec"]
    except Exception:  # noqa: BLE001 - a thread without the staged fields: the stored spec
        spec = st["spec"]
    director = st.get("director")
    if not isinstance(director, dict):
        try:
            from server.orchestration.director import CaseState  # noqa: PLC0415

            director = CaseState.from_spec(spec, case_id=thread_id).model_dump(mode="json")
        except Exception:  # noqa: BLE001
            director = {}
    return spec, director


def live_look(spec: dict[str, Any], director: dict[str, Any]) -> ap.Look:
    return ap.look_from_case(spec, director)


async def voice_lines_for_thread(app: Any, thread_id: str | None) -> list[str]:
    """Persona lines for the patient's voice right now, read from the server's case thread."""
    if not thread_id:
        return []
    view = await case_view(app, thread_id)
    if view is None:
        return []
    return list(ap.voice_style(live_look(*view))["persona_lines"])


def voice_for(app_state: Appearance | None) -> dict[str, Any]:
    if app_state is None or app_state.live is None:
        return {"speed": 1.0, "silent": False, "persona_lines": []}
    return ap.voice_style(app_state.live)


GEN_RETRIES = 2
GEN_RETRY_S = 15.0
# How often the pictures re-check a worker whose image edit server or runner is still coming up
# (imagegen.sh starts after the runner, several minutes after the worker's LLM answers).
SERVICES_POLL_S = 10.0
DEFAULT_SERVICES_WAIT_S = 1800.0


async def await_services(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, *,
                         wait_s: float = DEFAULT_SERVICES_WAIT_S, poll_s: float | None = None,
                         keepalive: Any = None) -> bool:
    """Wait until the image edit server (on ``a.gen_worker``) and the call's runner both answer.
    False after ``wait_s``, with the reason on ``a.reason``. Production 2026-10-21: a call that came
    in while the edit server was still loading kept the plain portrait for the whole case."""
    poll = SERVICES_POLL_S if poll_s is None else poll_s
    deadline = time.monotonic() + max(0.0, wait_s)
    while True:
        ig = await mt.imagegen_health(client, a.gen_worker or worker)
        if ig.get("ok"):
            a.gen_mode = ig.get("mode") or a.gen_mode
            h = await mt.health(client, worker)
            if h.get("ok"):
                return True
            why = f"avatar runner: {h.get('state')} {h.get('reason') or h.get('detail') or ''}".strip()
        else:
            why = f"image edit server: {ig.get('reason') or 'not ready'}"
        if time.monotonic() >= deadline:
            a.reason = f"{why}; gave up after {wait_s:.0f} s, the call keeps the case portrait"
            return False
        a.reason = f"{why}; the face switches to the patient's look when the pictures are ready"
        if keepalive is not None:
            keepalive()   # pictures on the way are use of the worker: keep it out of the idle reaper
        await asyncio.sleep(poll)


async def await_runner(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, *,
                       wait_s: float = DEFAULT_SERVICES_WAIT_S, poll_s: float | None = None,
                       keepalive: Any = None) -> bool:
    """Wait until the call's runner answers (the case portrait needs nothing else). False after ``wait_s``."""
    poll = SERVICES_POLL_S if poll_s is None else poll_s
    deadline = time.monotonic() + max(0.0, wait_s)
    while True:
        h = await mt.health(client, worker)
        if h.get("ok"):
            return True
        if time.monotonic() >= deadline:
            return False
        a.reason = (f"avatar runner: {h.get('state')} {h.get('reason') or h.get('detail') or ''}".strip()
                    + "; the face switches to the patient's look when the pictures are ready")
        if keepalive is not None:
            keepalive()
        await asyncio.sleep(poll)


async def _retrying(step: Any, v: Variant, retry_s: float | None) -> bool:
    for attempt in range(GEN_RETRIES + 1):
        ok = await step()
        if ok or attempt == GEN_RETRIES or not v.retryable:
            return ok
        await asyncio.sleep(GEN_RETRY_S if retry_s is None else retry_s)
    return False


async def _gen(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, v: Variant, portrait: bytes, *,
               seed: int, retry_s: float | None = None) -> bool:
    """Make the picture. A 5xx from the image edit server (live 2026-10-21: out of memory while the
    runner of a call held the rest of a 40 GB card) is retried after ``retry_s``, twice."""
    async def once() -> bool:
        from server.voice.avatar.turn_speech import wait_until_quiet  # noqa: PLC0415

        # A patient line being spoken on that GPU goes first (the edit would slow its TTS 2x).
        await wait_until_quiet(getattr(a.gen_worker or worker, "origin", ""))
        v.status, v.retryable = "generating", False
        try:
            v.prompt = ap.edit_prompt(v.look)
            img, meta = await mt.imagegen_edit(client, a.gen_worker or worker, portrait, v.prompt, seed=seed)
        except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
            _failed(a, v, exc)
            return False
        flush = ap.tint_level(v.look)
        if flush:
            try:
                img = warm_flush(img, flush)
            except Exception as exc:  # noqa: BLE001 - an undecodable picture keeps its model colours
                log.info("fever tint skipped: %s", type(exc).__name__)
        v.gen_ms, v.mode, v.image, v.status = meta.get("gen_ms"), meta.get("mode"), img, "generated"
        return True
    return await _retrying(once, v, retry_s)


async def _prep(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, v: Variant, *,
                retry_s: float | None = None, portrait: bytes | None = None) -> bool:
    """Prepare the generated picture as a MuseTalk avatar on the call's worker, registered onto the
    base portrait (prepared first when ``portrait`` is given), so base and variant share one frame."""
    async def once() -> bool:
        from server.voice.avatar.turn_speech import wait_until_quiet  # noqa: PLC0415

        # A patient line being spoken on that GPU goes first, as for the edits: since the call opens on
        # the portrait within seconds (6.8.1) the ladder's preparations run during the first lines, and
        # live 2026-10-22 (H100 SXM5) they starved the runner (64.7 fps, 88 underruns) and the voice.
        await wait_until_quiet(getattr(worker, "origin", ""))
        v.status, v.retryable = "preparing", False
        t = time.monotonic()
        try:
            if portrait:
                await mt.ensure_avatar(client, worker, a.base_avatar_id, portrait)
            v.registration = (await mt.ensure_avatar(client, worker, v.avatar_id, v.image or b"",
                                                     ref=a.base_avatar_id)).get("registration")
        except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
            _failed(a, v, exc)
            v.status = "generated" if v.image else "failed"
            return False
        v.prepare_ms = round((time.monotonic() - t) * 1000.0, 1)
        v.status = "ready"
        a.source = "generated"
        return True
    return await _retrying(once, v, retry_s)


def _failed(a: Appearance, v: Variant, exc: Exception) -> None:
    v.status = "failed"
    v.error = str(getattr(exc, "detail", None) or type(exc).__name__)[:200]
    v.retryable = isinstance(exc, httpx.HTTPError) or int(getattr(exc, "status", 0) or 0) >= 500
    log.info("appearance variant %s for %s failed: %s", v.name, a.thread_id[:8], v.error)


async def _make_variant(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, v: Variant,
                        portrait: bytes, *, seed: int, retry_s: float | None = None) -> bool:
    """Generate, then prepare, one picture (a look needed now that the ladder did not foresee)."""
    if v.image is None and not await _gen(client, worker, a, v, portrait, seed=seed, retry_s=retry_s):
        return False
    return await _prep(client, worker, a, v, retry_s=retry_s, portrait=portrait)


def _prepared(a: Appearance) -> dict[str, ap.Look]:
    out = {k: v.look for k, v in a.variants.items() if v.status == "ready"}
    return out


def new_appearance(*, thread_id: str, photo_id: str, spec: dict[str, Any], director: dict[str, Any],
                   worker: mt.WorkerAvatar, gen_worker: mt.WorkerAvatar | None = None) -> Appearance:
    a = Appearance(thread_id=thread_id, photo_id=photo_id, base_avatar_id=mt.avatar_id_for(photo_id),
                   gen_worker=gen_worker or worker)
    a.live = live_look(spec, director)
    for name, lk in ap.ladder(a.live, acuity_esi=int(spec.get("acuity_esi") or 3)):
        a.variants[lk.key] = Variant(name=name, look=lk, avatar_id=variant_avatar_id(photo_id, thread_id, lk.key))
    return a


def run_ladder(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, portrait: bytes, *,
               services_wait_s: float = DEFAULT_SERVICES_WAIT_S, keepalive: Any = None) -> asyncio.Event:
    """Make every picture first, then prepare them (presenting first), switching a connected call as each
    one lands. Pictures before preparations: the image edit server and the runner share a 40 GB card,
    and the runner's preparation buffers left the edits no room (live 2026-10-21). A worker whose edit
    server or runner is still starting is waited for (``services_wait_s``). Returns an event set once
    the presenting look is ready (or has failed)."""
    first_done = asyncio.Event()
    seed = seed_for(a.thread_id)
    first = a.variants.get(a.live.key) if a.live is not None else None
    order = ([first] if first is not None else []) + [v for v in a.variants.values() if v is not first]

    async def pipeline() -> None:
        try:
            deadline = time.monotonic() + max(0.0, services_wait_s)
            # The case portrait first, as soon as the runner answers: a call can then open at once on it and
            # crossfade into each look as it lands; the looks are registered onto it. It needs the runner
            # only. Production 2026-10-22 (5a9d68b): it waited for the image edit server, which a 40 GB
            # card has no room for (and a cold worker starts last), so the call prepared it on the click
            # (54.9 s from the click to live video on a warm worker).
            if await await_runner(client, worker, a, wait_s=services_wait_s, keepalive=keepalive):
                try:
                    await mt.ensure_avatar(client, worker, a.base_avatar_id, portrait)
                except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
                    log.info("base portrait for %s not prepared ahead: %s", a.thread_id[:8], type(exc).__name__)
            if not await await_services(client, worker, a, wait_s=max(0.0, deadline - time.monotonic()),
                                        keepalive=keepalive):
                return
            a.reason = None
            for v in order:
                if v.image is None and v.status != "ready":
                    await _gen(client, worker, a, v, portrait, seed=seed)
                    if keepalive is not None:
                        keepalive()
            for v in order:
                if v.status == "generated":
                    ok = await _prep(client, worker, a, v, portrait=portrait)
                    if ok and a.worker_session:
                        await _switch_to_best(client, worker, a, a.worker_session, reason="ladder_ready")
                if v is first:
                    first_done.set()
        finally:
            first_done.set()

    t = asyncio.get_running_loop().create_task(pipeline())
    a.tasks.add(t)
    t.add_done_callback(a.tasks.discard)
    return first_done


async def start(client: httpx.AsyncClient, worker: mt.WorkerAvatar, *, thread_id: str, photo_id: str,
                portrait: bytes, spec: dict[str, Any], director: dict[str, Any], wait_s: float = 45.0,
                gen_worker: mt.WorkerAvatar | None = None, existing: Appearance | None = None,
                services_wait_s: float = DEFAULT_SERVICES_WAIT_S, keepalive: Any = None) -> tuple[Appearance, str]:
    """The call's appearance: the one prepared at case start when there is one (``existing``), else a
    new ladder. Waits up to ``wait_s`` for the presenting look; returns the state and the avatar id the
    call should open with (the case portrait until the look is ready, then a crossfade to it)."""
    base = mt.avatar_id_for(photo_id)
    if existing is not None:
        a = existing
        a.live = live_look(spec, director)
        first_done = a.first_done or asyncio.Event()
        if a.first_done is None:
            first_done.set()
        if not first_done.is_set() and not _prepared(a):
            ig = await mt.imagegen_health(client, a.gen_worker or worker)
            if not ig.get("ok"):
                # The edit server is still loading (a cold worker: it starts after vLLM): do not hold the
                # call up to ``wait_s`` for pictures that cannot come yet. It opens on the portrait and
                # crossfades into the look when it lands (registered onto the portrait: no double image).
                a.reason = (f"image edit server: {ig.get('reason') or 'not ready'}; the face switches to the "
                            "patient's look when the pictures are ready")
                return a, base
            first = a.variants.get(a.live.key) if a.live is not None else None
            if first is None or first.status != "preparing":
                # The case-start ladder has not reached the runner with the presenting look yet (it is being
                # drawn, or queued behind the portrait): waiting would only delay the first frame (live
                # 2026-10-22: 6 s of the 34 s from the voice click). Open on the portrait, crossfade later.
                wait_s = 0.0
    else:
        a = new_appearance(thread_id=thread_id, photo_id=photo_id, spec=spec, director=director, worker=worker,
                           gen_worker=gen_worker)
        ig = await mt.imagegen_health(client, a.gen_worker)
        a.gen_mode = ig.get("mode")
        first_done = run_ladder(client, worker, a, portrait, services_wait_s=services_wait_s, keepalive=keepalive)
        a.first_done = first_done
        if not ig.get("ok"):
            # Still loading (or out of room): the call opens on the portrait now, the ladder waits for
            # the edit server and the live call crossfades into the look when it lands.
            a.reason = (f"image edit server: {ig.get('reason') or 'not ready'}; the face switches to the "
                        "patient's look when the pictures are ready")
            return a, base
    # At most ``wait_s`` (AVATAR_APPEARANCE_WAIT_S, 6 s) for the presenting look; after that the call
    # opens on the case portrait and crossfades into the look when it lands, so the voice click reaches
    # a first frame within about 10 s on a warm worker (docs/architecture/18 6.8.1).
    try:
        await asyncio.wait_for(first_done.wait(), timeout=wait_s)
    except asyncio.TimeoutError:
        pass
    pick = ap.choose_variant(a.live, _prepared(a)) if a.live is not None else None
    if pick is not None:
        a.current_key = pick.key
        a.reason = None if pick.key == a.live.key else "nearest prepared look while the exact one is made"
        return a, a.variants[pick.key].avatar_id
    a.reason = "presenting look not ready yet; the call opens on the case portrait and switches when it lands"
    return a, base


MODE_RANK = {"gpu": 0, "offload": 1, "sequential": 2}


async def pick_gen_worker(client: httpx.AsyncClient, wm: Any, call_worker: mt.WorkerAvatar) -> mt.WorkerAvatar:
    """The ready worker whose image edit server is fastest (the whole model on the GPU beats CPU
    offload); the call's own worker wins a tie. Falls back to the call's worker."""
    best: tuple[int, int, int, mt.WorkerAvatar] = (9, 0, 1, call_worker)
    eps = wm.endpoints() if wm is not None and hasattr(wm, "endpoints") else []
    for ep in eps:
        w = mt.worker_from_endpoint(ep)
        if w is None:
            continue
        h = await mt.imagegen_health(client, w)
        if not h.get("ok"):
            continue
        free = int((h.get("gpu") or {}).get("free_mb") or 0)
        # Fastest placement first, then the card with the most free memory (an idle worker of the pool
        # beats the call's own card, whose runner is busy), then the call's own worker.
        rank = (MODE_RANK.get(str(h.get("mode")), 5), -free, 0 if w.origin == call_worker.origin else 1, w)
        if rank[:3] < best[:3]:
            best = rank
    return best[3]


async def sync(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, *, worker_session: str | None,
               spec: dict[str, Any], director: dict[str, Any], portrait: bytes, reason: str = "director",
               ) -> dict[str, Any]:
    """Recompute the live look and switch the call to the best prepared picture. A missing exact look
    is generated in the background and switched to once ready."""
    async with a.lock:
        look = live_look(spec, director)
        a.live = look
        # Variants exist only when the worker's image edit server answered at call start.
        if look.key not in a.variants and a.variants:
            v = Variant(name="live", look=look, avatar_id=variant_avatar_id(a.photo_id, a.thread_id, look.key))
            a.variants[look.key] = v

            async def make_then_switch() -> None:
                if await _make_variant(client, worker, a, v, portrait, seed=seed_for(a.thread_id)):
                    await _switch_to_best(client, worker, a, a.worker_session or worker_session,
                                          reason=f"{reason}:generated")

            t = asyncio.get_running_loop().create_task(make_then_switch())
            a.tasks.add(t)
            t.add_done_callback(a.tasks.discard)
        return await _switch_to_best(client, worker, a, worker_session, reason=reason)


async def _switch_to_best(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance,
                          worker_session: str | None, *, reason: str) -> dict[str, Any]:
    if a.live is None:
        return {"switched": False, "why": "no_look"}
    pick = ap.choose_variant(a.live, _prepared(a))
    target_key = pick.key if pick is not None else None
    avatar_id = a.variants[target_key].avatar_id if target_key else a.base_avatar_id
    if target_key == a.current_key or (target_key is None and a.current_key is None):
        return {"switched": False, "why": "unchanged", "key": a.current_key}
    if not worker_session:
        a.current_key = target_key
        return {"switched": False, "why": "not_connected", "key": target_key}
    t = time.monotonic()
    try:
        res = await mt.switch(client, worker, worker_session, avatar_id, crossfade_ms=CROSSFADE_MS)
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        return {"switched": False, "why": f"switch_failed: {getattr(exc, 'detail', None) or type(exc).__name__}"}
    entry = {"at": time.time(), "reason": reason, "from": a.current_key, "to": target_key, "avatar_id": avatar_id,
             "live_key": a.live.key, "exact": target_key == a.live.key, "phase": a.live.phase,
             "switch_ms": round((time.monotonic() - t) * 1000.0, 1), "runner": res}
    a.current_key = target_key
    a.switches.append(entry)
    if entry["exact"]:
        a.reason = None   # the face shows the patient as they are now: no "not ready yet" note any more
    return {"switched": True, **entry}


async def cancel(a: Appearance | None) -> None:
    if a is None:
        return
    for t in list(a.tasks):
        t.cancel()

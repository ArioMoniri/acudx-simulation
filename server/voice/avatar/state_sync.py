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

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "key": self.look.key, "avatar_id": self.avatar_id, "status": self.status,
                "prompt": self.prompt, "has_image": self.image is not None,
                "signs": self.look.public()["signs"], "gen_ms": self.gen_ms, "prepare_ms": self.prepare_ms,
                "error": self.error, "mode": self.mode}


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
    tasks: set[asyncio.Task[Any]] = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def public(self) -> dict[str, Any]:
        return {"thread_id": self.thread_id, "source": self.source, "reason": self.reason, "gen_mode": self.gen_mode,
                "gen_worker": getattr(self.gen_worker, "domain", None),
                "live": self.live.public() if self.live else None, "current_key": self.current_key,
                "variants": [v.public() for v in self.variants.values()], "switches": self.switches[-20:]}


def variant_avatar_id(photo_id: str, thread_id: str, key: str) -> str:
    t = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:8]
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


async def _make_variant(client: httpx.AsyncClient, worker: mt.WorkerAvatar, a: Appearance, v: Variant,
                        portrait: bytes, *, seed: int) -> bool:
    v.status = "generating"
    try:
        v.prompt = ap.edit_prompt(v.look)
        img, meta = await mt.imagegen_edit(client, a.gen_worker or worker, portrait, v.prompt, seed=seed)
        v.gen_ms, v.mode, v.image = meta.get("gen_ms"), meta.get("mode"), img
        v.status = "preparing"
        t = time.monotonic()
        await mt.ensure_avatar(client, worker, v.avatar_id, img)
        v.prepare_ms = round((time.monotonic() - t) * 1000.0, 1)
        v.status = "ready"
        a.source = "generated"
        return True
    except (mt.AvatarWorkerError, httpx.HTTPError) as exc:
        v.status = "failed"
        v.error = (getattr(exc, "detail", None) or type(exc).__name__)[:200]
        log.info("appearance variant %s for %s failed: %s", v.name, a.thread_id[:8], v.error)
        return False


def _prepared(a: Appearance) -> dict[str, ap.Look]:
    out = {k: v.look for k, v in a.variants.items() if v.status == "ready"}
    return out


async def start(client: httpx.AsyncClient, worker: mt.WorkerAvatar, *, thread_id: str, photo_id: str,
                portrait: bytes, spec: dict[str, Any], director: dict[str, Any], wait_s: float = 45.0,
                gen_worker: mt.WorkerAvatar | None = None) -> tuple[Appearance, str]:
    """Generate and prepare the presenting look (waiting up to ``wait_s``), then the rest of the ladder
    in the background. Returns the appearance state and the avatar id the call should open with."""
    base = mt.avatar_id_for(photo_id)
    a = Appearance(thread_id=thread_id, photo_id=photo_id, base_avatar_id=base, gen_worker=gen_worker or worker)
    look = live_look(spec, director)
    a.live = look
    ig = await mt.imagegen_health(client, a.gen_worker)
    a.gen_mode = ig.get("mode")
    if not ig.get("ok"):
        a.reason = f"image edit server: {ig.get('reason') or 'not ready'}"
        return a, base
    seed = seed_for(thread_id)
    for name, lk in ap.ladder(look, acuity_esi=int(spec.get("acuity_esi") or 3)):
        a.variants[lk.key] = Variant(name=name, look=lk, avatar_id=variant_avatar_id(photo_id, thread_id, lk.key))
    first = a.variants[look.key]
    try:
        ok = await asyncio.wait_for(_make_variant(client, worker, a, first, portrait, seed=seed), timeout=wait_s)
    except asyncio.TimeoutError:
        ok = False
        first.status, first.error = "pending", f"not ready within {wait_s:.0f} s"
    rest = [v for v in a.variants.values() if v.status == "pending" and v is not first]

    async def ladder_rest() -> None:
        for v in rest:
            await _make_variant(client, worker, a, v, portrait, seed=seed)
        if first.status in ("pending", "failed"):
            await _make_variant(client, worker, a, first, portrait, seed=seed)

    t = asyncio.get_running_loop().create_task(ladder_rest())
    a.tasks.add(t)
    t.add_done_callback(a.tasks.discard)
    if ok:
        a.current_key = first.look.key
        return a, first.avatar_id
    a.reason = first.error or "presenting look not ready yet"
    return a, base


MODE_RANK = {"gpu": 0, "offload": 1, "sequential": 2}


async def pick_gen_worker(client: httpx.AsyncClient, wm: Any, call_worker: mt.WorkerAvatar) -> mt.WorkerAvatar:
    """The ready worker whose image edit server is fastest (the whole model on the GPU beats CPU
    offload); the call's own worker wins a tie. Falls back to the call's worker."""
    best: tuple[int, int, mt.WorkerAvatar] = (9, 1, call_worker)
    eps = wm.endpoints() if wm is not None and hasattr(wm, "endpoints") else []
    for ep in eps:
        w = mt.worker_from_endpoint(ep)
        if w is None:
            continue
        h = await mt.imagegen_health(client, w)
        if not h.get("ok"):
            continue
        rank = (MODE_RANK.get(str(h.get("mode")), 5), 0 if w.origin == call_worker.origin else 1, w)
        if rank[:2] < best[:2]:
            best = rank
    return best[2]


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
                    await _switch_to_best(client, worker, a, worker_session, reason=f"{reason}:generated")

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
    return {"switched": True, **entry}


async def cancel(a: Appearance | None) -> None:
    if a is None:
        return
    for t in list(a.tasks):
        t.cancel()

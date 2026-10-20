"""Background jobs for the provider registry and telemetry (docs/architecture/17).

A small periodic task closes the "manual today" items in doc 17 section 12:

* :class:`ProbeScheduler` runs :func:`server.registry.probe.probe_provider` for
  every **enabled** row every ``PROBE_INTERVAL_MINUTES`` (default 10, ``0``
  disables) and persists ``last_probe_*`` so the admin Providers table and
  ``/admin/health`` stay current without an operator clicking Probe.

It is built on :class:`PeriodicJob`: one asyncio task, an iteration that never kills
the loop (errors are logged and reported in :meth:`PeriodicJob.status`), and a
``stop`` that cancels and awaits the task. Started and stopped from the app
lifespan next to the GPU idle reaper.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

import httpx

from server.config import Settings
from server.registry.probe import probe_provider
from server.registry.store import RegistryStore

log = logging.getLogger("acudx.registry.jobs")


class PeriodicJob:
    """An asyncio loop that awaits :meth:`run_once` every ``interval_s`` seconds."""

    name = "job"

    def __init__(self, *, interval_minutes: float, clock: Callable[[], float] | None = None):
        self.interval_s = max(0.0, float(interval_minutes)) * 60.0
        self._clock = clock or time.time
        self._task: asyncio.Task[None] | None = None
        self.runs = 0
        self.last_run_at: float | None = None
        self.last_result: dict[str, Any] | None = None
        self.last_error: str | None = None

    @property
    def enabled(self) -> bool:
        return self.interval_s > 0

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def _run(self) -> dict[str, Any]:  # pragma: no cover - overridden
        raise NotImplementedError

    async def run_once(self) -> dict[str, Any] | None:
        """One recorded iteration: runs the job, updates the status counters, never raises."""
        self.runs += 1
        self.last_run_at = self._clock()
        try:
            self.last_result = await self._run()
            self.last_error = None
        except Exception as exc:  # noqa: BLE001 - the loop must survive one bad iteration
            self.last_error = f"{type(exc).__name__}: {exc}"
            log.exception("%s iteration failed", self.name)
        return self.last_result

    def start(self, interval_s: float | None = None) -> None:
        """Create the task on the running loop. No-op when disabled or already running."""
        if not self.enabled or self.running:
            return
        every = self.interval_s if interval_s is None else float(interval_s)

        async def loop() -> None:
            while True:
                await self.run_once()
                await asyncio.sleep(every)

        self._task = asyncio.get_running_loop().create_task(loop(), name=f"acudx-{self.name}")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        self._task = None

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "enabled": self.enabled,
            "interval_s": self.interval_s,
            "running": self.running,
            "runs": self.runs,
            "last_run_at": self.last_run_at,
            "last_result": self.last_result,
            "last_error": self.last_error,
        }


class ProbeScheduler(PeriodicJob):
    """Probe every enabled provider row on a schedule and persist the outcome."""

    name = "provider-probe"

    def __init__(self, store: RegistryStore, settings: Settings, *, client: httpx.AsyncClient | None,
                 interval_minutes: float | None = None, clock: Callable[[], float] | None = None):
        super().__init__(interval_minutes=settings.probe_interval_minutes if interval_minutes is None
                         else interval_minutes, clock=clock)
        self.store = store
        self.settings = settings
        self.client = client

    async def _run(self) -> dict[str, Any]:
        rows = self.store.list_providers()
        enabled = [r for r in rows if r.enabled]
        out = {"probed": 0, "ok": 0, "failed": 0, "skipped_disabled": len(rows) - len(enabled)}
        if not enabled:
            return out
        if self.client is not None:
            await self._probe_all(enabled, self.client, out)
        else:
            async with httpx.AsyncClient() as own:
                await self._probe_all(enabled, own, out)
        return out

    async def _probe_all(self, rows: list, client: httpx.AsyncClient, out: dict[str, Any]) -> None:
        for rec in rows:
            result = await probe_provider(rec, api_key=self.store.decrypt_key(rec), settings=self.settings,
                                          client=client, store=self.store)
            out["probed"] += 1
            out["ok" if result["ok"] else "failed"] += 1

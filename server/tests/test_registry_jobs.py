"""Background jobs: periodic provider probes and the telemetry retention purge
(architecture doc 17 section 12 open items)."""

from __future__ import annotations

import asyncio

import httpx
import pytest
import respx
from cryptography.fernet import Fernet

from server.config import Settings
from server.registry.jobs import ProbeScheduler, RetentionPurger, retention_days_from_settings
from server.registry.store import ProviderIn, RegistryStore
from server.telemetry.events import TelemetryRecorder

KEY = Fernet.generate_key().decode()


def _settings(tmp_path, **over) -> Settings:
    base = dict(airgapped=False, lambda_key=None, admin_token="adm-secret",
                acudx_db_path=str(tmp_path / "acudx.db"), acudx_secret_key=KEY, _env_file=None)
    base.update(over)
    return Settings(**base)


def _store(s: Settings) -> RegistryStore:
    return RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)


# --------------------------------------------------------------------------- #
# probe scheduler                                                             #
# --------------------------------------------------------------------------- #
@respx.mock
async def test_probe_run_once_probes_enabled_rows_only_and_persists(tmp_path):
    s = _settings(tmp_path)
    store = _store(s)
    ok = store.create_provider(ProviderIn(kind="llm", name="a", base_url="https://a.example/v1", model="m"))
    bad = store.create_provider(ProviderIn(kind="stt", name="dg", base_url="https://api.deepgram.com", api_key="dg-k"))
    off = store.create_provider(ProviderIn(kind="llm", name="off", base_url="https://off.example/v1", enabled=False))
    respx.get("https://a.example/v1/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "m"}]}))
    respx.get("https://api.deepgram.com/v1/projects").mock(side_effect=httpx.ConnectTimeout("slow"))
    off_route = respx.get("https://off.example/v1/models").mock(return_value=httpx.Response(200, json={}))

    async with httpx.AsyncClient() as client:
        job = ProbeScheduler(store, s, client=client, interval_minutes=10, clock=lambda: 1_800_000_000.0)
        result = await job.run_once()

    assert result == {"probed": 2, "ok": 1, "failed": 1, "skipped_disabled": 1}
    assert store.get_provider(ok.id).last_probe_ok is True
    assert store.get_provider(bad.id).last_probe_ok is False
    assert store.get_provider(bad.id).last_probe_error == "ConnectTimeout"
    assert store.get_provider(off.id).last_probe_ok is None and not off_route.called
    assert job.status() == {"name": "provider-probe", "enabled": True, "interval_s": 600.0, "running": False,
                            "runs": 1, "last_run_at": 1_800_000_000.0, "last_result": result, "last_error": None}


@respx.mock
async def test_probe_scheduler_loop_runs_and_stops(tmp_path):
    s = _settings(tmp_path)
    store = _store(s)
    pid = store.create_provider(ProviderIn(kind="llm", name="a", base_url="https://a.example/v1", model="m")).id
    route = respx.get("https://a.example/v1/models").mock(return_value=httpx.Response(200, json={"data": []}))
    async with httpx.AsyncClient() as client:
        job = ProbeScheduler(store, s, client=client, interval_minutes=10)
        job.start(interval_s=0.01)
        assert job.running
        for _ in range(200):
            if job.status()["runs"] >= 2:
                break
            await asyncio.sleep(0.01)
        await job.stop()
    assert not job.running
    assert route.call_count >= 2
    assert store.get_provider(pid).last_probe_ok is True
    # a second start after stop is allowed; a start while running is a no-op
    job.start(interval_s=60)
    task = job._task
    job.start(interval_s=60)
    assert job._task is task
    await job.stop()


async def test_probe_scheduler_interval_zero_is_disabled(tmp_path):
    s = _settings(tmp_path)
    store = _store(s)
    job = ProbeScheduler(store, s, client=None, interval_minutes=0)
    assert job.enabled is False
    job.start()
    assert not job.running
    assert job.status()["enabled"] is False


async def test_probe_scheduler_survives_a_failing_iteration(tmp_path):
    s = _settings(tmp_path)
    store = _store(s)
    job = ProbeScheduler(store, s, client=None, interval_minutes=10)

    async def boom() -> dict:
        raise RuntimeError("provider hiccup")

    job._run = boom  # type: ignore[method-assign]
    assert await job.run_once() is None   # a direct call never raises either
    job.start(interval_s=0.01)
    for _ in range(200):
        if job.status()["runs"] >= 3:
            break
        await asyncio.sleep(0.01)
    await job.stop()
    assert job.status()["runs"] >= 3
    assert job.status()["last_error"] == "RuntimeError: provider hiccup"


def test_probe_interval_setting_defaults_to_ten_minutes(tmp_path):
    assert _settings(tmp_path).probe_interval_minutes == 10
    assert _settings(tmp_path, probe_interval_minutes=0).probe_interval_minutes == 0
    with pytest.raises(ValueError):
        _settings(tmp_path, probe_interval_minutes=-1)


# --------------------------------------------------------------------------- #
# retention purge                                                             #
# --------------------------------------------------------------------------- #
def _fill(rec: TelemetryRecorder, clock: dict, days: list[float]) -> None:
    for d in days:
        clock["v"] = 1_800_000_000.0 - d * 86_400
        rec.record(kind="chat", provider="local", model="m", tokens_in=1, tokens_out=1, latency_ms=1.0, ok=True)


def test_retention_days_from_settings_accepts_nested_and_flat_keys(tmp_path):
    store = _store(_settings(tmp_path))
    assert retention_days_from_settings(store) is None
    store.set_setting("telemetry", {"retention_days": 30})          # the console's shape
    assert retention_days_from_settings(store) == 30
    store.set_setting("telemetry", {"retention_days": None})
    assert retention_days_from_settings(store) is None
    store.set_setting("telemetry.retention_days", "14")              # the flat key named in doc 17
    assert retention_days_from_settings(store) == 14
    store.set_setting("telemetry.retention_days", 0)                 # 0 keeps everything
    assert retention_days_from_settings(store) is None
    store.set_setting("telemetry.retention_days", "not-a-number")
    assert retention_days_from_settings(store) is None


async def test_retention_purge_honours_the_setting(tmp_path):
    s = _settings(tmp_path)
    store = _store(s)
    clock = {"v": 1_800_000_000.0}
    rec = TelemetryRecorder(s.acudx_db_path, clock=lambda: clock["v"])
    _fill(rec, clock, days=[0.5, 5, 29.9, 30.1, 90])
    clock["v"] = 1_800_000_000.0
    job = RetentionPurger(store, rec, interval_minutes=60, clock=lambda: clock["v"])

    # no setting: nothing is deleted, the run says so
    assert await job.run_once() == {"retention_days": None, "deleted": 0}
    assert len(rec.recent(limit=100)) == 5

    store.set_setting("telemetry", {"retention_days": 30})
    assert await job.run_once() == {"retention_days": 30, "deleted": 2}
    kept = rec.recent(limit=100)
    assert len(kept) == 3 and all(r["ts"] > clock["v"] - 30 * 86_400 for r in kept)
    assert job.status()["runs"] == 2 and job.status()["interval_s"] == 3600.0


def test_purge_older_than_returns_the_count_and_rejects_nonpositive(tmp_path):
    clock = {"v": 1_800_000_000.0}
    rec = TelemetryRecorder(str(tmp_path / "t.db"), clock=lambda: clock["v"])
    _fill(rec, clock, days=[1, 2, 3])
    clock["v"] = 1_800_000_000.0
    assert rec.purge_older_than(2.5, now=clock["v"]) == 1
    assert rec.purge_older_than(0, now=clock["v"]) == 0
    assert rec.purge_older_than(-3, now=clock["v"]) == 0
    assert len(rec.recent(limit=10)) == 2

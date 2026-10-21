"""Compressed encounter clock: defaults, real waits per turnaround class, the faculty course
setting, and the Director following the browser's sim clock (parity fixture shared with
web/src/domain/simClock.test.ts)."""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from server.case_generator import build_template_spec
from server.condition_catalog import CATALOG
from server.learning import sim_clock as SC
from server.orchestration import director as D
from server.tests.auth_harness import KeyPair, build_app, client_for

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "sim_clock_parity.json").read_text())
COND = {c["id"]: c for c in CATALOG}


@pytest.fixture(scope="module")
def keys() -> KeyPair:
    return KeyPair()


def test_defaults_bounds_and_classes_match_the_parity_fixture():
    assert SC.DEFAULTS.model_dump() == FIXTURE["defaults"]
    assert [SC.SCALE_MIN, SC.SCALE_MAX] == FIXTURE["bounds"]["scale"]
    assert [SC.WAIT_CAP_MIN_S, SC.WAIT_CAP_MAX_S] == FIXTURE["bounds"]["wait_cap_s"]
    assert SC.CLASS_OF == FIXTURE["class_of"]


@pytest.mark.parametrize("row", FIXTURE["waits"], ids=[w["name"] for w in FIXTURE["waits"]])
def test_every_routine_result_lands_within_its_real_wait(row):
    first, final = SC.real_waits_s(SC.DEFAULTS, row["category"], row["turnaround_min"], row["preliminary_min"])
    assert (first, final) == (row["first_report_s"], row["final_s"])
    # The user-facing promise: nothing routine waits more than about two real minutes for its first report.
    assert first <= 120


def test_real_time_scale_keeps_short_tests_at_their_clinical_time():
    s = SC.SimClockSettings(scale=1, wait_cap_s={"poc": 600, "lab": 600, "imaging": 600, "culture": 600})
    assert SC.real_waits_s(s, "poc", 5, None) == (300, 300)


def test_settings_are_validated():
    with pytest.raises(ValueError):
        SC.SimClockSettings(scale=0.5)
    with pytest.raises(ValueError):
        SC.SimClockSettings(scale=61)
    with pytest.raises(ValueError):
        SC.SimClockSettings(wait_cap_s={"poc": 1, "lab": 45, "imaging": 90, "culture": 120})
    with pytest.raises(ValueError):
        SC.SimClockSettings(wait_cap_s={"lab": 45})


def _spec(cond_id: str) -> dict:
    cond = COND[cond_id]
    spec = build_template_spec(cond, seed=3, locale="en", acuity=cond["typical_acuity"],
                               difficulty=cond["difficulty"], rng=random.Random(3))
    spec["meta"] = {"condition_id": cond_id}
    return spec


def test_director_follows_the_browser_sim_clock():
    """The Director's t_ms is the browser's sim clock when the step carries it (never rewinds)."""
    state = D.CaseState.from_spec(_spec("septic_shock"))
    for step in FIXTURE["director"]["steps"]:
        action = D.Action(kind=step["kind"], ref=step.get("ref", ""), sim_time_ms=step["sim_time_ms"])
        state, _visible, _ = D.next_state(state, action)
        assert state.t_ms == step["t_ms"], step


def test_director_without_a_clock_keeps_its_per_action_defaults():
    state = D.CaseState.from_spec(_spec("septic_shock"))
    state, _, _ = D.next_state(state, D.Action(kind="question", ref="onset"))
    assert state.t_ms == D.DEFAULT_ELAPSED_MS["question"]


def test_sim_time_wins_over_elapsed_ms():
    state = D.CaseState.from_spec(_spec("septic_shock"))
    state, _, _ = D.next_state(state, D.Action(kind="elapsed", elapsed_ms=3_600_000, sim_time_ms=120_000))
    assert state.t_ms == 120_000


def test_course_setting_routes(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    stu = client_for(app, token=keys.mint(sub="stu-1", roles=["student"]))
    fac = client_for(app, token=keys.mint(sub="fac-1", roles=["faculty"]))
    other = client_for(app, token=keys.mint(sub="stu-9", roles=["student"], org="other-uni"))

    assert client_for(app).get("/v1/me/sim-clock").status_code == 401  # OIDC: sign-in needed
    mine = stu.get("/v1/me/sim-clock")
    assert mine.status_code == 200, mine.text
    body = mine.json()
    assert body["settings"] == FIXTURE["defaults"] and body["source"] == "default"
    assert {w["class"] for w in body["preview"]} == {"poc", "lab", "imaging", "culture"}

    assert stu.put("/v1/faculty/sim-clock", json={"scale": 12}).status_code == 403
    bad = fac.put("/v1/faculty/sim-clock", json={"scale": 500})
    assert bad.status_code == 422

    put = fac.put("/v1/faculty/sim-clock", json={"scale": 12, "wait_cap_s": {"poc": 10, "lab": 30, "imaging": 60, "culture": 90}})
    assert put.status_code == 200, put.text
    assert put.json()["settings"]["scale"] == 12

    after = stu.get("/v1/me/sim-clock").json()
    assert after["settings"]["scale"] == 12 and after["settings"]["wait_cap_s"]["lab"] == 30
    assert after["source"] == "course" and after["updated_by"] == "fac-1"
    assert fac.get("/v1/faculty/sim-clock").json()["settings"]["scale"] == 12
    # Another course (org) keeps the defaults.
    assert other.get("/v1/me/sim-clock").json()["settings"] == FIXTURE["defaults"]

    reset = fac.delete("/v1/faculty/sim-clock")
    assert reset.status_code == 200 and reset.json()["source"] == "default"
    assert stu.get("/v1/me/sim-clock").json()["settings"] == FIXTURE["defaults"]

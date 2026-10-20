"""Event ingestion (hash chain per org, idempotency, flagging, assignment completion),
dean cohort / export / chain, and the faculty queue / review / assign / roster routes."""

from __future__ import annotations

import hashlib
import json

import pytest

from server.learning.routes import EncounterBatchIn
from server.learning.store import GENESIS, LearningStore, aggregate_cohort, band_from_competence, canonical, chain_next
from server.tests.auth_harness import KeyPair, build_app, client_for, sample_batch


@pytest.fixture(scope="module")
def keys() -> KeyPair:
    return KeyPair()


def _actors(app, keys):
    return {
        "s1": client_for(app, token=keys.mint(sub="stu-1", roles=["student"], name="Ayse Student")),
        "s2": client_for(app, token=keys.mint(sub="stu-2", roles=["resident"], name="Mehmet Resident")),
        "other": client_for(app, token=keys.mint(sub="stu-9", roles=["student"], org="other-uni")),
        "fac": client_for(app, token=keys.mint(sub="fac-1", roles=["faculty"], name="Prof Faculty")),
        "dean": client_for(app, token=keys.mint(sub="dean-1", roles=["dean"], name="Dean")),
    }


# --------------------------------------------------------------------------- #
# ingestion + chain                                                           #
# --------------------------------------------------------------------------- #
def test_ingest_chains_per_org_and_is_idempotent(tmp_path, keys):
    app, parts = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    b1 = sample_batch("enc-1")
    r1 = a["s1"].post("/v1/events/encounter", json=b1)
    assert r1.status_code == 201, r1.text
    d1 = r1.json()
    assert d1["stored"] is True and d1["prev_hash"] == GENESIS and d1["verified_identity"] is True
    parsed = EncounterBatchIn.model_validate(b1)
    body = {"encounter_id": "enc-1", "case_id": parsed.case_id, "started_at": parsed.started_at, "ended_at": parsed.ended_at,
            "events": [e.model_dump() for e in parsed.events], "summary": parsed.summary.model_dump()}
    expect_body = hashlib.sha256(canonical(body)).hexdigest()
    assert d1["body_sha256"] == expect_body
    assert d1["chain_hash"] == chain_next(GENESIS, expect_body)
    # second encounter links to the first
    d2 = a["s2"].post("/v1/events/encounter", json=sample_batch("enc-2", dx_ok=False)).json()
    assert d2["prev_hash"] == d1["chain_hash"] and d2["stored"] is True
    # another org starts its own chain
    d9 = a["other"].post("/v1/events/encounter", json=sample_batch("enc-1")).json()
    assert d9["prev_hash"] == GENESIS and d9["org"] == "other-uni"
    # re-submitting the same encounter is a no-op that returns the stored link
    again = a["s1"].post("/v1/events/encounter", json=b1).json()
    assert again["stored"] is False and again["chain_hash"] == d1["chain_hash"]
    chain = a["dean"].get("/v1/dean/chain").json()
    assert chain == {"org": "acme-med", "ok": True, "length": 2, "broken_at": None, "head": d2["chain_hash"]}
    # tamper with a stored body: verification pinpoints the row
    store: LearningStore = parts["learning"]
    store._conn().execute("UPDATE encounter_batches SET body = ? WHERE id = ?",
                          (json.dumps({**body, "summary": {**body["summary"], "safety_miss": True}}), d1["id"]))
    broken = a["dean"].get("/v1/dean/chain").json()
    assert broken["ok"] is False and broken["broken_at"] == d1["id"]


def test_ingest_validates_payload(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    bad = sample_batch("enc-x")
    bad["summary"]["domain_scores"][0]["key"] = "astrology"
    assert a["s1"].post("/v1/events/encounter", json=bad).status_code == 422
    bad2 = sample_batch("enc-y")
    bad2["summary"]["domain_scores"][0]["band"] = "legendary"
    assert a["s1"].post("/v1/events/encounter", json=bad2).status_code == 422
    assert a["s1"].post("/v1/events/encounter", json={"encounter_id": "e", "case_id": "c"}).status_code == 422


# --------------------------------------------------------------------------- #
# dean                                                                        #
# --------------------------------------------------------------------------- #
def test_cohort_aggregates_real_rows(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    a["s1"].post("/v1/events/encounter", json=sample_batch("e1", competence=0.9))
    a["s1"].post("/v1/events/encounter", json=sample_batch("e2", competence=0.75))
    a["s2"].post("/v1/events/encounter", json=sample_batch("e3", competence=0.3, dx_ok=False, safety_miss=True))
    a["s2"].post("/v1/events/encounter", json=sample_batch("e4", competence=0.4, dx_ok=False, safety_miss=True))
    a["other"].post("/v1/events/encounter", json=sample_batch("e5"))
    r = a["dean"].get("/v1/dean/cohort", params={"window": "7d"})
    assert r.status_code == 200
    c = r.json()
    assert c["org"] == "acme-med" and c["encounters"] == 4 and c["learner_count"] == 2
    assert c["kpis"] == {"dx_accuracy": 0.5, "safety_miss_rate": 0.5, "mean_brier": 0.01, "at_risk": 1}
    hist = c["bands_by_domain"]["history"]
    assert hist["strong"] == 2 and hist["developing"] == 2 and hist["withheld"] == 0
    assert c["bands_by_domain"]["professionalism"]["withheld"] == 4
    cal = {x["domain"]: x for x in c["calibration"]["by_domain"]}
    assert cal["history"]["n"] == 4 and cal["history"]["well"] == 4 and cal["professionalism"]["n"] == 0
    risk = [l for l in c["learners"] if l["at_risk"]]
    assert len(risk) == 1 and set(risk[0]["reasons"]) == {"safety", "competence", "diagnosis"}
    assert risk[0]["domains"]["history"]["band"] == band_from_competence(0.35) == "emerging"
    assert risk[0]["handle"] == risk[0]["user_hash"][:6].upper() and "sub" not in risk[0]
    assert c["learners"][0]["at_risk"] is True  # at-risk sorted first
    assert sum(b["encounters"] for b in c["activity"]) == 4 and len(c["activity"]) == 8
    assert c["chain"]["ok"] is True and c["chain"]["length"] == 4
    assert "stu-1" not in r.text  # no raw subs in dean output
    # windows
    assert a["dean"].get("/v1/dean/cohort", params={"window": "all"}).json()["encounters"] == 4
    assert a["dean"].get("/v1/dean/cohort", params={"window": "1y"}).status_code == 422


def test_export_is_deidentified_and_carries_chain(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    a["s1"].post("/v1/events/encounter", json=sample_batch("e1"))
    e = a["dean"].get("/v1/dean/export").json()
    assert e["deidentified"] is True and len(e["rows"]) == 1
    row = e["rows"][0]
    assert set(row) == {"handle", "encounter", "case_id", "received_at", "diagnosis_correct", "safety_miss", "brier", "bands",
                        "chain_hash"}
    assert row["bands"]["history"] == "strong" and row["chain_hash"] == e["chain"]["head"]
    assert "Ayse" not in json.dumps(e) and "stu-1" not in json.dumps(e)


def test_aggregate_handles_empty_input():
    out = aggregate_cohort([], now=1_800_000_000.0, window="30d")
    assert out["encounters"] == 0 and out["learner_count"] == 0 and out["kpis"]["dx_accuracy"] is None
    assert len(out["activity"]) == 31 and all(b["encounters"] == 0 for b in out["activity"])


# --------------------------------------------------------------------------- #
# faculty                                                                     #
# --------------------------------------------------------------------------- #
def test_queue_review_with_cosign_and_overrides(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    ok = a["s1"].post("/v1/events/encounter", json=sample_batch("good")).json()
    flagged = a["s2"].post("/v1/events/encounter", json=sample_batch("bad", dx_ok=False, safety_miss=True)).json()
    sub = a["fac"].post("/v1/faculty/cases/submit", json={"case_id": "case-new", "title": "Sepsis in the ED",
                                                          "payload": {"locale": "en"}})
    assert sub.status_code == 201 and sub.json()["status"] == "pending" and sub.json()["author_name"] == "Prof Faculty"
    q = a["fac"].get("/v1/faculty/queue").json()
    assert [c["case_id"] for c in q["cases"]] == ["case-new"]
    assert [e["batch_id"] for e in q["encounters"]] == [flagged["id"]]
    assert set(q["encounters"][0]["reasons"]) == {"safety_miss", "diagnosis_incorrect"}
    assert q["encounters"][0]["user_name"] == "Mehmet Resident"  # faculty see their own learners
    # co-sign is mandatory; an override needs content
    r = a["fac"].post(f"/v1/faculty/review/{flagged['id']}", json={"decision": "upheld", "cosigned": False})
    assert r.status_code == 422 and r.json()["detail"]["reason"] == "cosign_required"
    r = a["fac"].post(f"/v1/faculty/review/{flagged['id']}", json={"decision": "overridden", "cosigned": True})
    assert r.status_code == 422 and r.json()["detail"]["reason"] == "override_empty"
    r = a["fac"].post(f"/v1/faculty/review/{flagged['id']}", json={"decision": "overridden", "cosigned": True,
                                                                  "overrides": {"history": "cosmic"}})
    assert r.status_code == 422
    r = a["fac"].post(f"/v1/faculty/review/{flagged['id']}", json={
        "decision": "overridden", "cosigned": True, "overrides": {"reasoning": "proficient"}, "points": 62,
        "note": "Reasoning was sound; the order set was delayed by the interface."})
    assert r.status_code == 200, r.text
    rev = r.json()
    assert rev["status"] == "reviewed" and rev["cosigned"] is True and rev["overrides"] == {"reasoning": "proficient"}
    assert rev["points"] == 62 and rev["reviewer_name"] == "Prof Faculty"
    assert a["fac"].get("/v1/faculty/queue").json()["encounters"] == []
    assert a["fac"].get("/v1/faculty/queue").json()["recent_reviews"][0]["batch_id"] == flagged["id"]
    # reviewing an unflagged encounter creates the review row on the fly; another org's row is 404
    assert a["fac"].post(f"/v1/faculty/review/{ok['id']}", json={"decision": "upheld", "cosigned": True}).status_code == 200
    assert a["fac"].post("/v1/faculty/review/9999", json={"decision": "upheld", "cosigned": True}).status_code == 404
    # case decision
    dec = a["dean"].post(f"/v1/faculty/cases/{sub.json()['id']}/decide", json={"status": "approved", "note": "ok"})
    assert dec.status_code == 200 and dec.json()["status"] == "approved" and dec.json()["reviewer_sub"] == "dean-1"
    assert a["fac"].get("/v1/faculty/queue").json()["cases"] == []
    assert a["s1"].get("/v1/faculty/queue").status_code == 403


def test_assign_roster_and_completion(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    a = _actors(app, keys)
    a["s1"].post("/v1/events/encounter", json=sample_batch("e1"))
    a["s2"].get("/v1/auth/me")  # seen in the directory, no encounters yet
    r = a["fac"].post("/v1/faculty/assign", json={"case_id": "case-remed", "title": "Remediation: chest pain",
                                                  "assignees": ["stu-1"], "reason": "safety"})
    assert r.status_code == 201 and r.json()["assigned"] == 1
    r2 = a["fac"].post("/v1/faculty/assign", json={"case_id": "case-all", "all_learners": True})
    assert r2.status_code == 201 and r2.json()["assigned"] >= 2
    assert a["fac"].post("/v1/faculty/assign", json={"case_id": "case-none"}).status_code == 422
    # re-assigning an open assignment does not duplicate it
    assert a["fac"].post("/v1/faculty/assign", json={"case_id": "case-remed", "assignees": ["stu-1"]}).json()["assigned"] == 1
    mine = a["s1"].get("/v1/me/assignments").json()["assignments"]
    assert {m["case_id"] for m in mine} == {"case-remed", "case-all"} and all(m["completed_at"] is None for m in mine)
    # the learner completes the remediation case: the assignment closes on ingest
    a["s1"].post("/v1/events/encounter", json=sample_batch("e2", case_id="case-remed"))
    mine = {m["case_id"]: m for m in a["s1"].get("/v1/me/assignments").json()["assignments"]}
    assert mine["case-remed"]["completed_at"] is not None and mine["case-all"]["completed_at"] is None
    open_only = a["fac"].get("/v1/faculty/assignments", params={"open_only": True}).json()["assignments"]
    assert all(x["completed_at"] is None for x in open_only) and len(open_only) >= 2
    roster = a["fac"].get("/v1/faculty/roster").json()["roster"]
    by_sub = {x["sub"]: x for x in roster}
    assert by_sub["stu-1"]["encounters"] == 2 and by_sub["stu-1"]["name"] == "Ayse Student"
    assert by_sub["stu-1"]["open_assignments"] == 1 and by_sub["stu-2"]["encounters"] == 0
    assert by_sub["stu-2"]["name"] == "Mehmet Resident" and "stu-9" not in by_sub
    assert a["s1"].get("/v1/faculty/roster").status_code == 403

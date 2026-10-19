"""Routes: the results router mounts on the gateway app and answers with the
pydantic shapes mirrored in web/src/lib/resultsApi.ts."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from server.app import app

CASE = {
    "seed": 11,
    "condition": {"icd10": "J93.0", "label_en": "Tension pneumothorax", "label_tr": "x", "system": "pulmonology"},
    "demographics": {"age": 24, "sex": "male", "name_hint": "A"},
    "acuity_esi": 1, "difficulty": 3,
    "labs": [], "imaging": [],
    "triage_vitals": {"hr": 128, "systolic": 88, "diastolic": 60, "rr": 32, "spo2": 84, "tempC": 36.9},
    "vitals_trajectory": [],
    "treatments_given": [{"label": "Oxygen 15 L non-rebreather", "at_ms": 0}],
}


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_resolve_route_lab_and_imaging(client):
    r = client.post("/v1/results/resolve", json={"case_state": CASE, "order_code": "abg", "sim_time_ms": 600000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "lab" and body["narrative"] is None and body["meta"]["source"] == "engine"
    pao2 = next(o for o in body["observations"] if o["loinc"] == "2703-7")
    assert pao2["kinetics"] == "oxygenation" and pao2["source"].startswith("https://")
    assert body["treatments_applied"][0]["code"] == "oxygen"
    r = client.post("/v1/results/resolve", json={"case_state": CASE, "order_code": "cxr"})
    body = r.json()
    assert body["kind"] == "imaging" and body["report"]["image"]["id"] == "cxr-pneumothorax"
    assert body["report"]["provenance"]["attribution_text"].startswith("Image:")


def test_ecg_route_samples_and_svg(client):
    r = client.post("/v1/results/ecg", json={"pattern": "stemi_inferior", "rate_bpm": 58, "seed": 3, "include_svg": True})
    assert r.status_code == 200
    body = r.json()
    assert body["fs"] == 500 and len(body["leads"]["II"]) == 5000
    assert body["svg"].startswith("<svg") and body["is_synthetic"] is True
    r = client.post("/v1/results/ecg", json={"pattern": "nonsense"})
    assert r.status_code == 422
    r = client.post("/v1/results/ecg", json={"pattern": "normal", "include_samples": False})
    assert "leads" not in r.json()


def test_reference_ranges_route(client):
    r = client.get("/v1/results/reference-ranges")
    assert r.status_code == 200
    table = r.json()
    assert "analytes" in table and "sources" in table and "_by_loinc" not in table
    assert all(a["source"].startswith("https://") and a["reviewed_at"] for a in table["analytes"])
    r = client.get("/v1/results/reference-ranges", params={"loinc": "718-7", "sex": "female", "age": 30})
    assert r.json()["resolved_range"] == {"low": 12.0, "high": 16.0, "note": None}
    assert client.get("/v1/results/reference-ranges", params={"loinc": "0000-0"}).status_code == 404


def test_imaging_resolve_route(client):
    r = client.get("/v1/imaging/resolve", params={"order_code": "ct-head-noncon", "finding": "ischemic_infarct", "laterality": "left"})
    assert r.status_code == 200 and r.json()["status"] == "unavailable"
    r = client.get("/v1/imaging/resolve", params={"order_code": "ct-head-noncon", "finding": "ischemic_infarct", "laterality": "right"})
    assert r.json()["status"] == "ok" and r.json()["entry"]["laterality"] == "right"
    assert r.json()["provenance"]["is_synthetic"] is False

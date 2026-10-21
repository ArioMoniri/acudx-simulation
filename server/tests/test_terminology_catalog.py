"""Catalogue completeness and terminology (review 2026-10-21).

* every orderable (lab catalogue, imaging catalogue and every code the web order
  list offers) has a results-engine path: no orphan orders;
* every analyte has a source and a review date, every LOINC code in use was
  verified against LOINC 2.82 and is active;
* turnaround is realistic and sourced (stat chemistry about 50 min, cultures with
  a preliminary report, CT with a preliminary read);
* a live case whose spec carries strings in numeric fields still resolves (the
  LDH "offline synthetic normal" report);
* ICD-10-CM FY2027 and ICD-11 search, lookup and debrief relation work offline;
* no raw "code:" label reaches the learner UI.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from server.results import catalog, engine, imaging_bank
from server.terminology import icd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
H = 3_600_000

WELL = {"condition_id": "migraine", "demographics": {"age": 45, "sex": "female"}, "acuity_esi": 3, "seed": 5,
        "triage_vitals": {"hr": 78, "systolic": 122, "diastolic": 76, "rr": 14, "spo2": 98, "tempC": 36.8}}


# --------------------------------------------------------------------------- #
# Orderables resolve                                                           #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("orderable", catalog.lab_catalog()["orderables"], ids=lambda o: o["code"])
def test_every_lab_orderable_resolves_with_sourced_observations(orderable):
    r = engine.resolve_order(WELL, orderable["code"], 0)
    assert r["kind"] in ("lab", "micro"), orderable["code"]
    if r["status"] == "unavailable":
        # Only a fluid the patient does not have may be unavailable, and it says why.
        assert orderable["generator"] == "body_fluid" and r["reason"] == "no_specimen" and r["message"]
        return
    assert r["status"] == "ok" and r["observations"], orderable["code"]
    assert {o["loinc"] for o in r["observations"]} == {engine.canonical_loinc(m) for m in orderable["members"]}
    for o in r["observations"]:
        assert o["source"].startswith("https://") and o["reviewed_at"], (orderable["code"], o["loinc"])
        assert o["name"] and not o["name"].lower().startswith("code"), o
    assert r["turnaround"]["minutes"] == catalog.TURNAROUND[orderable["turnaround"]]["minutes"] or orderable["generator"] == "micro"


@pytest.mark.parametrize("proc", catalog.imaging_catalog()["procedures"], ids=lambda p: p["code"])
def test_every_imaging_procedure_resolves(proc):
    r = engine.resolve_order(WELL, proc["code"], 0)
    assert r["kind"] in ("imaging", "ecg"), proc["code"]
    assert r["turnaround"]["source"] and r["turnaround"]["basis"] in ("measured", "guideline", "convention")
    if r["kind"] == "imaging":
        assert r["report"]["modality"] == proc["modality"] and r["procedure"]["label_en"] == proc["label_en"]
        assert imaging_bank.ORDER_MODALITY[proc["code"]][:2] == (proc["modality"], proc["region"])
        if proc.get("loinc"):
            assert imaging_bank.ORDER_MODALITY[proc["loinc"]][0] == proc["modality"]


def _web_order_codes() -> set[str]:
    path = os.path.join(ROOT, "web", "src", "domain", "orderables.ts")
    text = open(path, encoding="utf-8").read()
    block = text[text.index("export const ORDERABLES_BY_GROUP"):text.index("/** Server catalogue section")]
    codes = set(re.findall(r'(?:lab|gas|micro|img)\("([^"]+)"', block))
    codes |= set(re.findall(r'\{ code: "([^"]+)"', block))
    with open(os.path.join(ROOT, "web", "src", "domain", "generated", "orderCatalog.generated.json"), encoding="utf-8") as fh:
        gen = json.load(fh)
    codes |= {o["code"] for o in gen["labs"]} | {p["code"] for p in gen["imaging"]}
    return codes


def test_no_orphan_orders_in_the_web_order_list():
    codes = _web_order_codes()
    assert len(codes) >= 140
    orphans = sorted(c for c in codes if not engine.resolvable(c))
    assert orphans == []


def test_web_catalogue_is_in_sync_and_loinc_verified():
    proc = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "terminology", "build_terminology.py"), "check"],
                          capture_output=True, text=True, cwd=ROOT, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr


# --------------------------------------------------------------------------- #
# Ranges and LOINC                                                             #
# --------------------------------------------------------------------------- #
def test_every_analyte_has_a_source_and_a_reference():
    data = engine.load_ranges()
    for a in data["analytes"]:
        assert a["source"].startswith("https://") and a["reviewed_at"], a["loinc"]
        assert a.get("source_key") in data["sources"], a["loinc"]
        assert a.get("qualitative") or a.get("ranges") or a.get("reference_text"), a["loinc"]
        for r in a.get("ranges", []):
            assert r.get("low") is not None or r.get("high") is not None, a["loinc"]


def test_loinc_codes_are_verified_and_active():
    with open(os.path.join(ROOT, "server", "terminology", "data", "loinc-verified.json"), encoding="utf-8") as fh:
        verified = json.load(fh)
    assert verified["loinc_version"]
    by = {c["code"]: c for c in verified["codes"]}
    used = {a["loinc"] for a in engine.load_ranges()["analytes"]}
    used |= {o["loinc"] for o in catalog.lab_catalog()["orderables"] if o.get("loinc")}
    used |= {p["loinc"] for p in catalog.imaging_catalog()["procedures"] if p.get("loinc")}
    missing = sorted(c for c in used if c not in by)
    assert missing == []
    assert all(by[c]["found"] and str(by[c].get("STATUS", "ACTIVE")).upper() in ("ACTIVE", "TRIAL") for c in used)


def test_retired_codes_still_resolve_to_their_replacement():
    # 53060-9 (BHB), 1841-5 (ammonia) and 5797-1 (urine ketones) do not exist in LOINC.
    for old, new in (("53060-9", "6873-4"), ("1841-5", "22763-7"), ("5797-1", "5797-6")):
        assert engine.canonical_loinc(old) == new
        r = engine.resolve_order(WELL, old, 0)
        assert r["status"] == "ok" and r["observations"][0]["loinc"] == new


# --------------------------------------------------------------------------- #
# Turnaround and preliminary reports                                           #
# --------------------------------------------------------------------------- #
def test_turnaround_is_realistic_per_test():
    tat = {code: engine.resolve_order(WELL, code, 0)["turnaround"] for code in ("ldh", "2160-0", "67151-1", "blood-culture", "ct-chest", "ct-head-noncon", "mri-brain", "cxr", "poc-glucose")}
    assert 45 <= tat["ldh"]["minutes"] <= 60 and 45 <= tat["2160-0"]["minutes"] <= 60
    assert tat["67151-1"]["minutes"] == 60
    assert tat["blood-culture"]["preliminary_minutes"] == 1440 and tat["blood-culture"]["minutes"] == 7200
    assert tat["ct-chest"]["preliminary_minutes"] < tat["ct-chest"]["minutes"]
    assert tat["poc-glucose"]["minutes"] < tat["cxr"]["minutes"] < tat["ct-head-noncon"]["minutes"] < tat["ct-chest"]["minutes"] < tat["mri-brain"]["minutes"]
    for t in tat.values():
        assert "PMC1282400" not in t["source"]  # the old, wrong Hawkins identifier


def test_culture_has_a_preliminary_report():
    pneumonia = {**WELL, "condition_id": "pneumonia_cap", "seed": 11}
    r = engine.resolve_order(pneumonia, "blood-culture", 2 * H)
    assert r["preliminary"]["available_at_ms"] == 2 * H + 24 * H
    assert r["available_at_ms"] > r["preliminary"]["available_at_ms"]
    neg = engine.resolve_order(WELL, "blood-culture", 0)
    assert "No growth to date" in neg["preliminary"]["text"] and neg["observations"][0]["value"] == "No growth at 5 days"


# --------------------------------------------------------------------------- #
# Physiology consistency in a well patient                                     #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("seed", range(12))
def test_well_patient_panels_are_normal_and_consistent(seed):
    case = {**WELL, "seed": seed, "demographics": {"age": 30 + seed * 3, "sex": "male" if seed % 2 else "female"}}
    for code in ("cmp", "6690-2", "electrolytes", "coag-inr", "lft"):
        r = engine.resolve_order(case, code, 0)
        flagged = [(o["short"], o["value"]) for o in r["observations"] if o["flag"] != "N"]
        assert flagged == [], (code, flagged)
    cmp = {o["loinc"]: o["value"] for o in engine.resolve_order(case, "cmp", 0)["observations"]}
    assert cmp["33037-3"] == pytest.approx(cmp["2951-2"] - cmp["2075-0"] - cmp["1963-8"], abs=1.0)
    assert cmp["10834-0"] == pytest.approx(10 * (cmp["2885-2"] - cmp["1751-7"]), abs=1.5)
    # LDL is a risk-based goal (under 100 mg/dL), not a normal range: a well adult may exceed it.
    lip = {o["loinc"]: o["value"] for o in engine.resolve_order(case, "lipid-panel", 0)["observations"]}
    assert lip["13457-7"] == pytest.approx(lip["2093-3"] - lip["2085-9"] - lip["2571-8"] / 5, abs=1.0)
    cbc = {o["loinc"]: o["value"] for o in engine.resolve_order(case, "6690-2", 0)["observations"]}
    assert cbc["786-4"] == pytest.approx(100 * cbc["718-7"] / cbc["4544-3"], abs=0.2)


def test_drug_levels_are_not_detected_unless_exposed():
    r = engine.resolve_order(WELL, "digoxin", 0)["observations"][0]
    assert r["value"] == "Not detected" and r["flag"] == "N"
    on_dig = {**WELL, "medications": [{"name": "Digoxin 125 micrograms daily"}]}
    v = engine.resolve_order(on_dig, "digoxin", 0)["observations"][0]["value"]
    assert isinstance(v, float) and 0.8 <= v <= 2.0


def test_fluid_needs_an_effusion():
    assert engine.resolve_order(WELL, "pleural-fluid", 0)["reason"] == "no_specimen"
    exudate = engine.resolve_order({**WELL, "condition_id": "pleural_effusion"}, "pleural-fluid", 0)
    assert exudate["status"] == "ok" and "Exudate by Light's criteria" in exudate["interpretation"]


# --------------------------------------------------------------------------- #
# The reported live failure: model-written strings in numeric fields           #
# --------------------------------------------------------------------------- #
def test_live_spec_with_strings_resolves_ldh_through_the_engine():
    from server.app import app

    spec = {"seed": "7", "condition": {"icd10": "I21.4", "label_en": "Non-ST elevation myocardial infarction"},
            "demographics": {"age": "58 years", "sex": "M", "weight_kg": "82 kg"}, "acuity_esi": "2",
            "triage_vitals": {"hr": "104", "systolic": 132, "diastolic": "80", "rr": 18, "spo2": "96%", "tempC": 37.0},
            "vitals_trajectory": [{"atMs": "0", "hr": 104}], "treatments_given": [{"label": "Aspirin 300 mg", "at_ms": "120000"}],
            "director": {"vitals": {"hr": "100", "systolic": "128"}, "severity": "0.4", "map": "88"}}
    with TestClient(app) as client:
        res = client.post("/v1/results/resolve", json={"case_state": spec, "order_code": "ldh", "sim_time_ms": 600000})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["meta"]["source"] == "engine" and body["kind"] == "lab"
    assert body["observations"][0]["name"] == "Lactate dehydrogenase" and body["turnaround"]["minutes"] == 50
    assert body["available_at_ms"] == 600000 + 50 * 60_000


def test_catalog_and_terminology_routes():
    from server.app import app

    with TestClient(app) as client:
        cat = client.get("/v1/results/catalog").json()
        assert len(cat["labs"]) >= 100 and len(cat["imaging"]) >= 40
        hits = client.get("/v1/terminology/icd10cm/search", params={"q": "heart attack"}).json()
        assert hits["available"] and hits["release"] == "FY2027"
        assert "I21.9" in [h["code"] for h in hits["results"][:5]]
        look = client.get("/v1/terminology/icd10cm/I21.09").json()
        assert look["billable"] is True and [a["code"] for a in look["ancestors"]] == ["I21.0", "I21"]
        assert client.get("/v1/terminology/icd10cm/Z99.999").status_code == 404
        rel = client.get("/v1/terminology/icd10cm/relate", params={"committed": "I21.09", "target": "I21.0"}).json()
        assert rel["relation"] == "more_specific" and rel["credit"] is True
        i11 = client.get("/v1/terminology/icd11/search", params={"q": "acute myocardial infarction"}).json()
        assert i11["available"] and any(r["code"].startswith("BA41") for r in i11["results"])
        assert i11["results"][0]["uri"].startswith("http://id.who.int/icd/release/11/mms/")


# --------------------------------------------------------------------------- #
# ICD data files                                                               #
# --------------------------------------------------------------------------- #
def test_icd10cm_release_is_complete():
    idx = icd.icd10cm()
    assert idx is not None and idx.meta["release"] == "FY2027"
    billable = sum(1 for r in idx.rows if r[2])
    assert billable > 74000 and len(idx.rows) > 95000
    for q, code in (("sepsis", "A41.9"), ("chest pain", "R07.9"), ("dka", "E10.10"), ("pulmonary embolism", "I26")):
        assert code in [h["code"] for h in idx.search(q, 8)], q


def test_terminology_outputs_match_the_manifest():
    with open(os.path.join(ROOT, "data", "terminology", "MANIFEST.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    for key in ("icd10cm", "icd11", "loinc_verified"):
        rec = manifest["outputs"][key]
        digest = hashlib.sha256(open(os.path.join(ROOT, rec["path"]), "rb").read()).hexdigest()
        assert digest == rec["sha256"], key
    for rec in manifest["files"].values():
        assert rec["sha256"] and rec["url"].startswith("https://") and rec["licence"]
    with gzip.open(os.path.join(ROOT, "server", "terminology", "data", "icd11-mms-2026-01.json.gz"), "rt", encoding="utf-8") as fh:
        meta = json.load(fh)
    assert "CC BY-ND 3.0 IGO" in meta["licence"] and meta["citation"]


# --------------------------------------------------------------------------- #
# No raw "code:" label in the learner UI                                       #
# --------------------------------------------------------------------------- #
def _strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, str):
        yield path, node


def test_no_code_colon_labels_in_learner_strings():
    i18n = os.path.join(ROOT, "web", "src", "i18n")
    files = [os.path.join(i18n, "locales", "en.json")] + [
        os.path.join(i18n, "features", f) for f in os.listdir(os.path.join(i18n, "features")) if f.endswith(".en.json")]
    bad = []
    for f in files:
        with open(f, encoding="utf-8") as fh:
            for key, value in _strings(json.load(fh)):
                if key.startswith("admin."):
                    continue  # operator console, not the learner UI
                if re.search(r"(^|\s)code\s*:", value, re.I) or value.strip().lower() in ("code", "full code"):
                    bad.append((os.path.basename(f), key, value))
    # The banner's code status now reads "Resuscitation status: Full resuscitation".
    allowed = {
        "ehr.banner.codeStatus", "ehr.codeStatus.full",  # legacy keys, no longer rendered (checked below)
        "ehrTerms.codeStatus.hint",  # the explanation of what "full code" means
        "rooms.card.code",  # a multiplayer room join code, not a clinical code
        "select2.cases.table.code",  # case catalogue column header (case id), not a clinical code
    }
    assert [b for b in bad if b[1] not in allowed] == []
    banner = open(os.path.join(ROOT, "web", "src", "components", "ehr", "PatientBanner.tsx"), encoding="utf-8").read()
    assert 't("ehr.banner.codeStatus")' not in banner and 't("ehr.codeStatus.full")' not in banner
    for tsx in ("ResultsTab.tsx", "OrdersTab.tsx", "ChartReviewTab.tsx", "ProblemListTab.tsx"):
        src = open(os.path.join(ROOT, "web", "src", "components", "ehr", "tabs", tsx), encoding="utf-8").read()
        assert not re.search(r">\s*[Cc]ode:\s*\{", src), tsx

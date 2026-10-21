from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from server.guidelines import tips as tips_mod
from server.guidelines.store import EXPORT_PATH, GuidelineStore, resolve_condition_codes

# The condition families the brief requires tips for (catalog ids -> ICD-10 via the catalog).
REQUIRED_FAMILIES = [
    "acs_stemi", "pulmonary_embolism", "aortic_dissection", "septic_shock", "dka", "ischemic_stroke",
    "subarachnoid_hemorrhage", "anaphylaxis", "asthma_exacerbation", "copd_exacerbation", "pneumonia_cap",
    "appendicitis", "cholecystitis", "pancreatitis", "upper_gi_bleed", "aki", "hyperkalemia", "paracetamol_od",
    "opioid_overdose", "status_epilepticus", "spontaneous_pneumothorax", "pph", "ectopic_pregnancy",
    "panic_disorder", "suicidal_ideation",
    # Acceptance 2026-10-20 D-24: every febrile family in the catalog has a verified tip.
    "sepsis_uncomplicated", "bacterial_meningitis", "pyelonephritis", "cellulitis", "ascending_cholangitis",
    "septic_arthritis", "malaria", "influenza", "covid19", "pid", "acute_prostatitis", "febrile_neutropenia",
]


def test_at_least_sixty_tips_with_valid_shape():
    tips = tips_mod.all_tips()
    assert len(tips) >= 60
    assert len({t.id for t in tips}) == len(tips)
    for t in tips:
        assert t.stage in tips_mod.STAGES, t.id
        assert t.tip_en and t.tip_tr and t.pitfall_en and t.pitfall_tr and t.timing_hint, t.id
        assert t.condition_codes and t.statement_ids, t.id


def test_every_tip_statement_exists_and_is_verified(evidence_store: GuidelineStore):
    missing, unverified = [], []
    for t in tips_mod.all_tips():
        for sid in t.statement_ids:
            row = evidence_store.get(sid)
            if row is None:
                missing.append((t.id, sid))
            elif row.status != "verified":
                unverified.append((t.id, sid, row.status))
    assert not missing, f"tips reference unknown statements: {missing}"
    assert not unverified, f"tips reference unverified statements: {unverified}"
    # And therefore the verified-only join returns every authored tip.
    assert len(tips_mod.list_tips(evidence_store)) == len(tips_mod.all_tips())


def test_tip_statements_share_a_condition_with_the_tip(evidence_store: GuidelineStore):
    from server.guidelines.store import code_matches

    for t in tips_mod.all_tips():
        for sid in t.statement_ids:
            row = evidence_store.get(sid)
            assert any(code_matches(a, b) for a in t.condition_codes for b in row.condition_codes), (t.id, sid)


@pytest.mark.parametrize("family", REQUIRED_FAMILIES)
def test_each_required_family_has_verified_tips(evidence_store: GuidelineStore, family: str):
    codes = resolve_condition_codes(family)
    assert codes, f"catalog id {family} did not resolve"
    found = tips_mod.list_tips(evidence_store, condition=family)
    assert found, f"no verified tips for {family} ({codes})"


def test_join_withholds_tips_whose_evidence_is_not_verified(seeded_store: GuidelineStore):
    # Drafts only: nothing verified -> no tips reach a learner.
    assert tips_mod.list_tips(seeded_store) == []
    seeded_store.set_verification("gs_nice_ng185_aspirin300", status="verified", verified_by="t", method="lexical",
                                  quote="q")
    shown = tips_mod.list_tips(seeded_store, condition="I21.3")
    assert [t.id for t in shown] == ["tip_acs_aspirin"]  # the only tip fully covered by that one statement


def test_stage_filter_and_statement_ids_for_stage(evidence_store: GuidelineStore):
    treat = tips_mod.list_tips(evidence_store, condition="I21.3", stage="treatment")
    assert treat and all(t.stage == "treatment" for t in treat)
    ids = tips_mod.statement_ids_for_stage(evidence_store, "treatment", condition="I21.3")
    assert "gs_nice_ng185_aspirin300" in ids
    assert tips_mod.list_tips(evidence_store, condition="I21.3", stage="disposition") == []
    groups = tips_mod.tips_by_stage(tips_mod.all_tips())
    assert set(groups) == set(tips_mod.STAGES) and all(groups[s] for s in tips_mod.STAGES)


# --------------------------------------------------------------------------- #
# Routes                                                                      #
# --------------------------------------------------------------------------- #
@pytest.fixture()
def client(isolated_db, monkeypatch):
    from server.app import app
    from server.guidelines import store as store_mod

    # Load the committed evidence into the isolated DB the routes read from.
    store = store_mod.get_store()
    store.import_json(EXPORT_PATH, replace=True)
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    with TestClient(app) as c:
        yield c


def test_tips_route_joins_verified_statements(client: TestClient):
    r = client.get("/v1/guidelines/tips", params={"condition": "I21.3", "locale": "tr"})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 3 and body["locale"] == "tr"
    for tip in body["tips"]:
        assert tip["stage"] in tips_mod.STAGES
        for sid in tip["statement_ids"]:
            s = body["statements"][sid]
            assert s["status"] == "verified" and s["source_url"] and s["verification_quote"]
            assert s["statement"] == s["statement_tr"]
    r = client.get("/v1/guidelines/tips", params={"condition": "acs_stemi", "stage": "treatment"})
    assert r.status_code == 200 and all(t["stage"] == "treatment" for t in r.json()["tips"])
    assert client.get("/v1/guidelines/tips", params={"stage": "bogus"}).status_code == 422


def test_statements_routes_serve_only_verified(client: TestClient):
    r = client.get("/v1/guidelines/statements", params={"condition": "I26.9"})
    assert r.status_code == 200
    ids = {s["id"] for s in r.json()["statements"]}
    assert "gs_nice_ng158_pe_wells" in ids and "gs_esc_pulmonary_embolism" not in ids
    one = client.get("/v1/guidelines/statements/gs_nice_ng158_pe_wells")
    assert one.status_code == 200 and one.json()["source_url"].startswith("https://www.nice.org.uk/guidance/ng158")
    failed = client.get("/v1/guidelines/statements/gs_esc23acs_reperfusion")
    assert failed.status_code == 404 and failed.json()["status"] == "failed"
    assert client.get("/v1/guidelines/statements/does_not_exist").status_code == 404
    staged = client.get("/v1/guidelines/statements", params={"condition": "I21.3", "stage": "treatment"}).json()
    assert {s["id"] for s in staged["statements"]} >= {"gs_nice_ng185_aspirin300"}


def test_admin_verify_is_token_gated(client: TestClient, monkeypatch):
    assert client.post("/admin/guidelines/verify").status_code == 503  # ADMIN_TOKEN unset
    monkeypatch.setenv("ADMIN_TOKEN", "s3cret")
    assert client.post("/admin/guidelines/verify", headers={"X-Admin-Token": "nope"}).status_code == 401
    assert client.post("/admin/guidelines/verify").status_code == 401
    # Correct token but AIRGAPPED (default settings): the verifier would egress -> refused.
    monkeypatch.delenv("ACUDX_VERIFIER_ALLOW_EGRESS", raising=False)
    r = client.post("/admin/guidelines/verify", headers={"X-Admin-Token": "s3cret"}, json={"ids": ["gs_nice_ng185_aspirin300"]})
    assert r.status_code == 409


def test_ground_uses_verified_store_only(client: TestClient):
    r = client.post("/v1/ground", json={"query": "two-level PE Wells score CTPA", "country": "UK", "k": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["grounded"] is True
    for p in body["passages"]:
        assert p["id"].startswith("gs_")
        assert p["citation"]["verified_at"], p["id"]
        assert p["citation"]["url"].startswith("https://")
    assert os.environ.get("ACUDX_DB_PATH")  # sanity: isolated DB in use


# --------------------------------------------------------------------------- #
# Condition-scoped grounding (live report 2026-10-21: "Rehberlik is not working") #
# --------------------------------------------------------------------------- #
def test_ground_without_embed_endpoint_is_degraded_and_refused_by_the_client(client: TestClient):
    """The production host has no embed / rerank side-car: an unscoped query degrades to the
    lexical hashing cosine, which the web refuses (it served stroke aspirin for chest pain)."""
    body = client.post("/v1/ground", json={"query": "Göğsümün sağ tarafına bıçak saplanmış gibi ağrı var. · Başlangıç",
                                           "locale": "tr"}).json()
    assert body["degraded"] is True and body["mode"] == "hashing-fallback"


@pytest.mark.parametrize("locale", ["en", "tr"])
def test_ground_scoped_to_the_case_condition_and_visible_stages(client: TestClient, locale: str):
    from server.guidelines.store import get_store

    stages = ["triage", "history"]
    allowed: set[str] = set()
    for st in stages:
        allowed |= tips_mod.statement_ids_for_stage(get_store(), st, condition="J93.1")
    assert allowed, "the pneumothorax family has triage / history tips"
    r = client.post("/v1/ground", json={"query": "chest pain · onset", "locale": locale, "condition": "J93.1",
                                        "stages": stages, "k": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["grounded"] is True and body["degraded"] is False
    assert body["mode"] == "condition-scope" and body["scope"] == "condition"
    assert body["passages"] and {p["id"] for p in body["passages"]} <= allowed
    for p in body["passages"]:
        assert p["citation"]["url"].startswith("https://") and p["statement"]


def test_ground_scope_never_reaches_a_later_stage(client: TestClient):
    from server.guidelines.store import get_store

    store = get_store()
    later = tips_mod.statement_ids_for_stage(store, "treatment", condition="J93.1") - tips_mod.statement_ids_for_stage(
        store, "triage", condition="J93.1")
    body = client.post("/v1/ground", json={"query": "chest drain aspiration", "condition": "J93.1",
                                           "stages": ["triage"], "k": 8}).json()
    assert body["mode"] == "condition-scope"
    assert not ({p["id"] for p in body["passages"]} & later)


def test_ground_with_an_unknown_condition_keeps_the_unscoped_behaviour(client: TestClient):
    body = client.post("/v1/ground", json={"query": "fever", "condition": "Z99.89", "stages": ["history"]}).json()
    assert body["mode"] == "hashing-fallback" and body["degraded"] is True

from __future__ import annotations

import json

import pytest

from server import guidelines_seed
from server.guidelines import seed_open
from server.guidelines.store import (
    GuidelineStatement,
    GuidelineStore,
    code_matches,
    legacy_to_statement,
    resolve_condition_codes,
    statement_to_legacy,
)


def _stmt(sid: str = "gs_test_one", **kw) -> GuidelineStatement:
    base = dict(
        id=sid, statement_en="Give 300 mg aspirin as soon as possible.", statement_tr="300 mg aspirin verin.",
        source_body="NICE", source_title="Acute coronary syndromes (NG185)",
        source_url="https://www.nice.org.uk/guidance/ng185/chapter/Recommendations",
        edition_or_version="NG185, 2020", published_date="2020-11-18", condition_codes=["I21.3"],
        topic="acs_test", status="draft",
    )
    base.update(kw)
    return GuidelineStatement(**base)


def test_schema_roundtrip(fresh_store: GuidelineStore):
    s = _stmt(scope={"countries": ["UK"], "specialties": ["cardiology"]})
    fresh_store.upsert(s)
    got = fresh_store.get("gs_test_one")
    assert got is not None
    assert got.model_dump() == s.model_dump()
    assert len(fresh_store) == 1
    assert fresh_store.count_by_status()["draft"] == 1


def test_every_legacy_seed_record_migrates_as_draft(fresh_store: GuidelineStore):
    written = fresh_store.seed(include_open=False)
    legacy_ids = {r["id"] for r in guidelines_seed.GUIDELINE_SEED}
    assert written == len(legacy_ids) == 50
    rows = fresh_store.list()
    assert {r.id for r in rows} == legacy_ids
    assert all(r.status == "draft" for r in rows)
    assert all(r.condition_codes for r in rows), "every migrated record carries ICD codes"
    assert all(r.source_url for r in rows)


def test_legacy_projection_refines_landing_page_urls():
    rec = next(r for r in guidelines_seed.GUIDELINE_SEED if r["id"] == "gs_nice_sah_ct6h")
    stmt = legacy_to_statement(rec)
    assert stmt.source_url == seed_open.URL_REFINEMENTS["gs_nice_sah_ct6h"]
    assert "refined from landing page" in stmt.verification_note
    assert stmt.condition_codes == ["I60.9", "R51"]
    # Round trip back to the legacy dict shape used by server.grounding.
    legacy = statement_to_legacy(stmt)
    assert legacy["citation"]["url"] == stmt.source_url
    assert legacy["statement"]["en"] == stmt.statement_en


def test_open_seed_has_exact_document_urls_and_codes():
    stmts = seed_open.open_statements()
    assert len(stmts) >= 60
    for s in stmts:
        assert s.statement_en and s.statement_tr, s.id
        assert s.condition_codes, s.id
        assert s.source_url.startswith("https://"), s.id
        # Never a bare homepage.
        from urllib.parse import urlparse

        assert urlparse(s.source_url).path.strip("/"), f"{s.id} points at a homepage"
    assert len({s.id for s in stmts}) == len(stmts), "statement ids are unique"


def test_seed_is_idempotent_and_preserves_verified_rows(fresh_store: GuidelineStore):
    fresh_store.seed()
    n = len(fresh_store)
    fresh_store.set_verification("gs_nice_ng185_aspirin300", status="verified", verified_by="test",
                                 method="lexical", quote="Offer ... 300 mg aspirin", note="score 1.00")
    assert fresh_store.seed() == 0  # nothing rewritten
    assert len(fresh_store) == n
    kept = fresh_store.get("gs_nice_ng185_aspirin300")
    assert kept is not None and kept.status == "verified" and kept.verification_quote


def test_add_draft_resets_evidence_when_text_changes(fresh_store: GuidelineStore):
    fresh_store.upsert(_stmt(status="verified", verification_quote="q", verified_at="2026-01-01T00:00:00+00:00"))
    changed = _stmt(statement_en="Different text.")
    assert fresh_store.add_draft(changed) is True
    got = fresh_store.get("gs_test_one")
    assert got is not None and got.status == "draft" and got.verification_quote == ""


def test_verified_filter_and_condition_join(fresh_store: GuidelineStore):
    fresh_store.upsert(_stmt("gs_a", condition_codes=["I21.3"], status="verified"))
    fresh_store.upsert(_stmt("gs_b", condition_codes=["K35.80"], status="verified"))
    fresh_store.upsert(_stmt("gs_c", condition_codes=["I21.4"], status="failed"))
    assert [s.id for s in fresh_store.verified()] == ["gs_a", "gs_b"]
    assert [s.id for s in fresh_store.verified(condition="I21")] == ["gs_a"]
    assert [s.id for s in fresh_store.verified(condition="acs_stemi")] == ["gs_a"]  # catalog id -> I21.3
    assert [s.id for s in fresh_store.verified(condition="appendicitis")] == ["gs_b"]
    assert fresh_store.get_verified("gs_c") is None


def test_code_matches_and_condition_resolution():
    assert code_matches("I21", "I21.3")
    assert code_matches("I21.3", "I21")
    assert code_matches("K35.80", "K35.8")
    assert not code_matches("I21.3", "I22.0")
    assert resolve_condition_codes("I63.9") == ["I63.9"]
    assert resolve_condition_codes("acs_stemi") == ["I21.3"]
    assert resolve_condition_codes("Pulmonary embolism") == ["I26.9"]
    assert resolve_condition_codes("") == []


def test_learner_view_localises(fresh_store: GuidelineStore):
    s = _stmt(status="verified", doi="10.1000/x", verified_at="2026-10-19T00:00:00+00:00")
    view_tr = s.learner_view("tr")
    assert view_tr["statement"] == "300 mg aspirin verin."
    assert s.learner_view("en")["statement"] == s.statement_en
    assert view_tr["doi"] == "10.1000/x" and view_tr["source_url"].startswith("https://")
    assert view_tr["verified_at"] == "2026-10-19T00:00:00+00:00"


def test_export_import_roundtrip(fresh_store: GuidelineStore, tmp_path):
    fresh_store.seed()
    fresh_store.set_verification("gs_nice_ng185_aspirin300", status="verified", verified_by="test",
                                 method="lexical", quote="q", note="n", verification_url="https://x")
    path = tmp_path / "export.json"
    payload = fresh_store.export_json(path)
    assert payload["schema"] == "acudx.GuidelineStatement/1"
    data = json.loads(path.read_text())
    assert data["counts"]["verified"] == 1
    other = GuidelineStore(":memory:")
    assert other.import_json(path) == len(fresh_store)
    assert other.get("gs_nice_ng185_aspirin300").status == "verified"
    other.close()


def test_committed_evidence_only_marks_verified_rows_with_quotes(evidence_store: GuidelineStore):
    verified = evidence_store.verified()
    assert len(verified) >= 100
    for s in verified:
        assert s.verification_quote, s.id
        assert s.verified_at and s.verified_by, s.id
        assert s.verification_url.startswith("https://"), s.id
        assert s.source_url.startswith("https://") or s.doi, s.id
    failed = evidence_store.list(status="failed")
    assert failed, "the export records failures with reasons"
    assert all(s.verification_note for s in failed)
    # Homepage-only Turkish / WHO landing records must be failed, never verified.
    for sid in ("gs_moh_tr_acs_ecg10min", "gs_tepdad_tr_sepsis_recognition", "gs_pancreatitis_fluids",
                "gs_moh_tr_anaphylaxis", "gs_tepdad_tr_stroke_pathway", "gs_sickle_acute_chest"):
        row = evidence_store.get(sid)
        assert row is not None and row.status == "failed", sid
        assert "homepage-only" in row.verification_note


@pytest.mark.parametrize("bad", ["", "nonsense"])
def test_set_verification_rejects_unknown_status(fresh_store: GuidelineStore, bad: str):
    fresh_store.upsert(_stmt())
    with pytest.raises(ValueError):
        fresh_store.set_verification("gs_test_one", status=bad)

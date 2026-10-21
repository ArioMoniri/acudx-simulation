"""Catalogue-wide attending-tip coverage, citation integrity, stage tags and the crosscheck pass.

Every condition in ``server.condition_catalog.CATALOG`` has at least
``MIN_TIPS_PER_CONDITION`` verified tips, or is listed in ``COVERAGE_GAPS`` with the reason.
Every statement a tip cites resolves to a verified, crosschecked row with an https source
and a verbatim quote, and is tagged with the stage the tip is shown at, so condition-scoped
grounding can never surface a later stage's evidence.
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.testclient import TestClient

from server.condition_catalog import CATALOG
from server.guidelines import crosscheck, seed_catalog, verifier
from server.guidelines import tips as tips_mod
from server.guidelines.store import GuidelineStatement, GuidelineStore, code_matches
from server.guidelines.tips_catalog import CATALOG_TIPS, COVERAGE_GAPS, MIN_TIPS_PER_CONDITION

CATALOG_IDS = [c["id"] for c in CATALOG]
REPO = Path(__file__).resolve().parents[2]
EM, ELL = chr(0x2014), chr(0x2026)  # em dash, ellipsis (kept out of the source text)


# ---- coverage -------------------------------------------------------------------------
@pytest.mark.parametrize("condition", CATALOG_IDS)
def test_each_catalogue_condition_has_tips_or_a_documented_gap(evidence_store: GuidelineStore, condition: str):
    n = len(tips_mod.list_tips(evidence_store, condition=condition))
    if condition in COVERAGE_GAPS:
        assert COVERAGE_GAPS[condition].strip(), f"{condition}: a coverage gap needs a reason"
        assert n < MIN_TIPS_PER_CONDITION, f"{condition} now has {n} tips: drop it from COVERAGE_GAPS"
    else:
        assert n >= MIN_TIPS_PER_CONDITION, f"{condition} has {n} verified tips and no COVERAGE_GAPS entry"


def test_coverage_gaps_name_real_catalogue_entries_and_stay_small():
    assert set(COVERAGE_GAPS) <= set(CATALOG_IDS)
    covered = len(CATALOG_IDS) - len(COVERAGE_GAPS)
    assert covered / len(CATALOG_IDS) >= 0.9, "coverage regressed below 90% of the catalogue"


def test_catalog_tips_are_registered_and_unique():
    ids = {t.id for t in tips_mod.all_tips()}
    assert {t.id for t in CATALOG_TIPS} <= ids
    assert len(ids) == len(tips_mod.all_tips())


# ---- citation integrity ---------------------------------------------------------------
def test_every_tip_citation_is_verified_crosschecked_and_quoted(evidence_store: GuidelineStore):
    bad = []
    for t in tips_mod.all_tips():
        for sid in t.statement_ids:
            row = evidence_store.get(sid)
            if row is None:
                bad.append((t.id, sid, "missing"))
                continue
            if row.status != "verified":
                bad.append((t.id, sid, row.status))
            if not row.source_url.startswith("https://"):
                bad.append((t.id, sid, f"source_url {row.source_url!r}"))
            if not row.verification_quote.strip():
                bad.append((t.id, sid, "no quote"))
            if crosscheck.CROSSCHECK_ID not in row.verified_by or "crosscheck ok" not in row.verification_note:
                bad.append((t.id, sid, "not crosschecked"))
    assert not bad, bad


def test_every_tip_number_is_in_the_quote_of_its_statements(evidence_store: GuidelineStore):
    """The crosscheck rule, re-applied offline to the committed evidence."""
    for t in tips_mod.all_tips():
        for sid in t.statement_ids:
            row = evidence_store.get(sid)
            assert not crosscheck.missing_numbers(row.statement_en, row.verification_quote), (t.id, sid)


def test_catalog_statements_carry_section_date_and_stage(evidence_store: GuidelineStore):
    for stmt in seed_catalog.catalog_statements():
        row = evidence_store.get(stmt.id)
        assert row is not None and row.status == "verified", stmt.id
        assert row.section and row.published_date and row.stages, stmt.id
        assert row.statement_tr.strip(), stmt.id
        assert set(row.stages) <= set(tips_mod.STAGES), stmt.id


def test_tip_codes_and_stage_match_their_statements(evidence_store: GuidelineStore):
    for t in tips_mod.all_tips():
        for sid in t.statement_ids:
            row = evidence_store.get(sid)
            assert any(code_matches(a, b) for a in t.condition_codes for b in row.condition_codes), (t.id, sid)
            assert t.stage in row.stages, (t.id, sid, t.stage, row.stages)


# ---- no later-stage leak through condition-scoped grounding ---------------------------
def _covered_conditions():
    return [c for c in CATALOG_IDS if c not in COVERAGE_GAPS]


@pytest.mark.parametrize("condition", _covered_conditions())
def test_ground_never_surfaces_a_later_stage_for_any_condition(client: TestClient, condition: str):
    from server.guidelines.store import get_store

    store = get_store()
    for i, stage in enumerate(tips_mod.STAGES[:-1]):
        visible = list(tips_mod.STAGES[: i + 1])
        allowed: set[str] = set()
        for st in visible:
            allowed |= tips_mod.statement_ids_for_stage(store, st, condition=condition)
        if not allowed:
            continue
        body = client.post("/v1/ground", json={"query": "next step management dose", "condition": condition,
                                               "stages": visible, "k": 8}).json()
        got = {p["id"] for p in body.get("passages", [])}
        assert got <= allowed, (condition, stage, sorted(got - allowed))


# ---- house style ----------------------------------------------------------------------
@pytest.mark.parametrize("rel", ["server/guidelines/tips_catalog.py", "server/guidelines/seed_catalog.py",
                                 "server/guidelines/crosscheck.py", "server/tests/test_tip_coverage.py"])
def test_no_em_dashes_in_new_files(rel: str):
    assert EM not in (REPO / rel).read_text(encoding="utf-8"), rel


def test_no_em_dashes_in_tip_or_catalog_statement_text():
    for t in tips_mod.all_tips():
        for txt in (t.tip_en, t.tip_tr, t.pitfall_en, t.pitfall_tr, t.timing_hint):
            assert EM not in txt, t.id
    for s in seed_catalog.catalog_statements():
        assert EM not in s.statement_en and EM not in s.statement_tr, s.id


# ---- crosscheck unit tests ------------------------------------------------------------
def test_quote_parts_and_presence_tolerate_markup_and_ellipses():
    doc = "<p>Give 1 g of tranexamic acid&nbsp;IV within 3 hours.</p> Other text. Then reassess."
    assert crosscheck.quote_parts(ELL + "Give 1 g of tranexamic acid IV [...] Then reassess.") == [
        "Give 1 g of tranexamic acid IV", "Then reassess."]
    assert crosscheck.quote_present("Give 1 g of tranexamic acid IV within 3 hours.", doc) == []
    assert crosscheck.quote_present("Give 2 g of tranexamic acid", doc) == ["Give 2 g of tranexamic acid"]


def test_missing_numbers_normalises_decimals_and_ranges():
    assert crosscheck.missing_numbers("Give 0.5 mg, then 10 to 15 minutes later", "0.5 mg ... 10-15 minutes") == []
    assert crosscheck.missing_numbers("Aim above 90% and 65 mmHg", "aim above 90%") == ["65"]


def test_focus_quote_keeps_the_numbers_a_head_cut_would_drop():
    filler = " ".join(["table row text"] * 120)
    passage = f"{filler} weight 70-79 kg gives 3.5 units per hour at 0.05 units/kg/hour"
    out = verifier.focus_quote(passage, "insulin 0.05 units/kg/hour gives 3.5 units for 70-79 kg", limit=200)
    assert len(out) <= 202 and "0.05" in out and "3.5" in out and out.startswith(ELL)
    assert verifier.focus_quote("short", "short") == "short"


SOURCE_HTML = """<!doctype html><html><body><main><h1>Recommendations</h1>
<p>1.1 Offer an alpha blocker to men for managing acute urinary retention before removal of the catheter.</p>
<p>1.2 Immediately catheterise men with acute retention.</p>
<p>1.3 Carry out a serum creatinine test in men with chronic urinary retention (residual volume greater than
1 litre).</p><p>1.4 Some unrelated recommendation about lifestyle and diet.</p>
<p>1.5 Another unrelated recommendation about follow-up.</p><p>1.6 More text to pass the length gate.</p>
</main></body></html>"""


def _source_app() -> FastAPI:
    app = FastAPI()

    @app.get("/robots.txt")
    def robots() -> PlainTextResponse:
        return PlainTextResponse("User-agent: *\nAllow: /\n")

    @app.get("/recs")
    def recs() -> HTMLResponse:
        return HTMLResponse(SOURCE_HTML * 3)

    return app


def _row(sid: str, text: str, quote: str) -> GuidelineStatement:
    return GuidelineStatement(id=sid, statement_en=text, source_body="FIX", source_title="Fixture",
                              source_url="http://fixture.test/recs", condition_codes=["R33.9"], status="verified",
                              verified_by="agent:acudx-guideline-verifier/0.1", verification_quote=quote,
                              verification_note="score 0.95")


def test_crosscheck_store_passes_supported_rows_and_fails_tampered_ones():
    store = GuidelineStore(":memory:")
    good = "Offer an alpha blocker to men for managing acute urinary retention before removal of the catheter."
    store.upsert(_row("gs_ok", good, good))
    store.upsert(_row("gs_bad_quote", good, "Catheterise everyone within 6 hours."))
    store.upsert(_row("gs_bad_number", "Carry out a serum creatinine test with a residual volume over 2 litres.",
                      "Carry out a serum creatinine test in men with chronic urinary retention"))

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_source_app()),
                                     base_url="http://fixture.test") as c:
            return await crosscheck.crosscheck_store(store, client=c)

    out = asyncio.run(run())
    assert out["checked"] == 3 and out["passed"] == 1, out
    ok = store.get("gs_ok")
    assert ok.status == "verified" and crosscheck.CROSSCHECK_ID in ok.verified_by and "crosscheck ok" in ok.verification_note
    assert store.get("gs_bad_quote").status == "failed" and "quote not found" in store.get("gs_bad_quote").verification_note
    assert store.get("gs_bad_number").status == "failed"
    assert "numbers" in store.get("gs_bad_number").verification_note
    store.close()


# ---- store migration ------------------------------------------------------------------
def test_store_migrates_a_database_without_section_and_stages(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE guideline_statement (id TEXT PRIMARY KEY, statement_en TEXT NOT NULL DEFAULT '', "
                "status TEXT NOT NULL DEFAULT '')")
    con.execute("INSERT INTO guideline_statement (id, statement_en, status) VALUES ('gs_old', 'Old row.', 'draft')")
    con.commit()
    con.close()
    store = GuidelineStore(str(db))
    cols = {r[1] for r in store._conn.execute("PRAGMA table_info(guideline_statement)")}
    assert {"section", "stages", "condition_codes", "verification_quote"} <= cols
    row = store.get("gs_old")
    assert row.statement_en == "Old row." and row.stages == [] and row.section == ""
    store.close()


def test_seed_tags_catalog_statements_with_the_stages_of_their_tips(seeded_store: GuidelineStore):
    for t in CATALOG_TIPS:
        for sid in t.statement_ids:
            assert t.stage in seeded_store.get(sid).stages, (t.id, sid)

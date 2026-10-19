"""Verifier tests against a local FastAPI fixture server (extraction + quote location),
plus one live test against a real NICE recommendations page."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi import FastAPI, Response
from fastapi.responses import HTMLResponse, PlainTextResponse

from server.guidelines import verifier
from server.guidelines.store import GuidelineStatement, GuidelineStore
from server.tests.conftest import skip_live

RECS_HTML = """<!doctype html><html><head><title>Fixture guideline</title>
<script>var x = 'noise that must not be extracted';</script></head>
<body><nav>Home | Guidance | Search</nav>
<main>
<h1>Recommendations</h1>
<p>1.1.1 Offer people with acute STEMI a single loading dose of 300 mg aspirin as soon as possible
unless there is clear evidence that they are allergic to it. [2010]</p>
<p>1.1.2 Do not offer routine glycoprotein inhibitors before arrival at the catheter laboratory. [2013]</p>
<p>1.1.3 Give controlled supplementary oxygen titrated to maintain an SpO2 level of 94-98%. [2019]</p>
<p>1.2.1 Deliver coronary reperfusion therapy as quickly as possible for eligible people. [2013]</p>
<p>1.2.2 Some unrelated recommendation about cardiac rehabilitation and lifestyle advice. [2013]</p>
<p>1.2.3 Make cardiac rehabilitation equally accessible and relevant to all people after an MI. [2013]</p>
<p>1.2.4 Encourage all people who smoke to stop smoking and offer support to do so. [2013]</p>
<p>1.2.5 Advise people to eat a Mediterranean-style diet and to be physically active. [2013]</p>
<p>1.2.6 Offer fibrinolysis if primary PCI cannot be delivered within 120 minutes of the time when
fibrinolysis could have been given. [2013]</p>
</main><footer>Footer links</footer></body></html>"""

LANDING_HTML = """<!doctype html><html><body><main><h1>Overview</h1>
<p>This guideline covers the early management of acute coronary syndromes.</p></main></body></html>"""

JS_WALL_HTML = """<!doctype html><html><body><p>Enable JavaScript and cookies to continue</p></body></html>"""

JATS_XML = """<?xml version="1.0"?><article><front><journal-meta><journal-title>Noise</journal-title></journal-meta></front>
<body><sec><title>Treatment</title><p>Intramuscular epinephrine is the first-line drug: the dose is 0.01 mg/kg of body
weight to a maximum total dose of 0.5 mg, repeated every 5-15 min if symptoms are refractory.</p>
<p>Most patients should be placed in a supine position unless there is respiratory distress, in which case a
sitting position may optimize respiratory effort.</p></sec></body>
<back><ref-list><ref>Reference noise 0.01 mg</ref></ref-list></back></article>"""


def fixture_app() -> FastAPI:
    app = FastAPI()

    @app.get("/robots.txt")
    def robots() -> PlainTextResponse:
        return PlainTextResponse("User-agent: *\nDisallow: /private/\n")

    @app.get("/guidance/ng185/chapter/Recommendations")
    def recs() -> HTMLResponse:
        return HTMLResponse(RECS_HTML)

    @app.get("/guidance/ng185")
    def landing() -> HTMLResponse:
        return HTMLResponse(LANDING_HTML)

    @app.get("/wall/article")
    def wall() -> HTMLResponse:
        return HTMLResponse(JS_WALL_HTML)

    @app.get("/epmc/PMC1/fullTextXML")
    def xml() -> Response:
        return Response(content=JATS_XML, media_type="application/xml")

    @app.get("/private/doc")
    def private() -> HTMLResponse:
        return HTMLResponse(RECS_HTML)

    @app.get("/missing")
    def missing() -> Response:
        return Response(status_code=404)

    return app


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fixture_app()), base_url="http://fixture.test")


def _stmt(sid: str, text: str, url: str, fetch_url: str = "") -> GuidelineStatement:
    return GuidelineStatement(id=sid, statement_en=text, source_body="FIX", source_title="Fixture guideline (NG185)",
                              source_url=url, fetch_url=fetch_url, condition_codes=["I21.3"], status="draft")


def _verify(stmt: GuidelineStatement, **kw) -> verifier.VerificationOutcome:
    async def run():
        async with _client() as client:
            return await verifier.verify_statement(stmt, client, limiter=verifier.RateLimiter(0.0), **kw)

    return asyncio.run(run())


RECS_URL = "http://fixture.test/guidance/ng185/chapter/Recommendations"


def test_extract_text_html_strips_scripts_and_prefers_full_body():
    text, kind = verifier.extract_text(RECS_HTML.encode(), "text/html; charset=utf-8", RECS_URL)
    assert kind == "html"
    assert "noise that must not be extracted" not in text
    assert "300 mg aspirin" in text and "120 minutes" in text


def test_extract_text_xml_drops_front_and_back_matter():
    text, kind = verifier.extract_text(JATS_XML.encode(), "application/xml", "http://x/full")
    assert kind == "xml"
    assert "Reference noise" not in text and "Noise" not in text
    assert "0.01 mg/kg" in text


def test_tokeniser_exposes_ranges_units_and_synonyms():
    toks = verifier.tokens("SpO2 94-98%; adrenaline 0.5 mg IM every 5-15 min")
    assert {"94", "98", "5", "15", "0.5"} <= set(toks)
    assert "epinephrine" in toks and "intramuscular" in toks
    terms = verifier.content_terms("Give 300 mg aspirin to the patient")
    assert terms["300"] == 2.0 and "patient" not in terms


def test_supported_statement_is_verified_with_quote():
    out = _verify(_stmt("gs_fix_aspirin",
                        "Offer people with acute STEMI a single loading dose of 300 mg aspirin as soon as possible "
                        "unless there is clear evidence that they are allergic to it.", RECS_URL))
    assert out.status == "verified", out.reason
    assert "300 mg aspirin" in out.quote
    assert out.verification_url == RECS_URL and out.method == "lexical"
    assert out.score >= 0.9


def test_statement_condensing_two_separated_recommendations_gets_composite_quote():
    out = _verify(_stmt("gs_fix_composite",
                        "Deliver coronary reperfusion therapy as quickly as possible for eligible people, and offer "
                        "fibrinolysis if primary PCI cannot be delivered within 120 minutes of the time when "
                        "fibrinolysis could have been given.", RECS_URL))
    assert out.status == "verified", out.reason
    assert "[...]" in out.quote and "120 minutes" in out.quote and "reperfusion" in out.quote
    assert "composite" in out.reason


def test_range_numbers_match_statement_numbers():
    out = _verify(_stmt("gs_fix_oxygen",
                        "Give controlled supplementary oxygen titrated to maintain an SpO2 level of 94 to 98%.", RECS_URL))
    assert out.status == "verified", out.reason
    assert "94-98%" in out.quote


def test_unsupported_statement_fails_with_reason():
    out = _verify(_stmt("gs_fix_unsupported",
                        "Give intravenous magnesium sulphate 2 g over 20 minutes to every patient with hyperkalaemia "
                        "and perform urgent haemodialysis within 6 hours.", RECS_URL))
    assert out.status == "failed"
    assert "below threshold" in out.reason or "numeric" in out.reason or "terms matched" in out.reason
    assert "best candidate" in out.reason


def test_landing_page_with_too_little_text_fails():
    out = _verify(_stmt("gs_fix_landing", "Offer 300 mg aspirin as soon as possible.", "http://fixture.test/guidance/ng185"))
    assert out.status == "failed" and "characters of text" in out.reason


def test_homepage_only_source_fails_without_fetching():
    for url in ("https://www.saglik.gov.tr", "https://www.tepdad.org.tr/", "https://www.who.int/emergencycare"):
        assert verifier.is_homepage_only(url), url
        out = _verify(_stmt("gs_fix_home", "Offer 300 mg aspirin as soon as possible.", url))
        assert out.status == "failed" and "homepage-only" in out.reason
    assert not verifier.is_homepage_only(RECS_URL)


def test_js_wall_robots_and_http_errors_are_reported():
    assert _verify(_stmt("gs_fix_wall", "Offer 300 mg aspirin as soon as possible.", "http://fixture.test/wall/article")).reason.startswith("source behind a JavaScript")
    assert "robots" in _verify(_stmt("gs_fix_private", "Offer 300 mg aspirin as soon as possible.", "http://fixture.test/private/doc")).reason
    assert _verify(_stmt("gs_fix_404", "Offer 300 mg aspirin as soon as possible.", "http://fixture.test/missing")).reason == "HTTP 404"


def test_fetch_url_mirror_is_used_for_an_unfetchable_doi():
    out = _verify(_stmt("gs_fix_xml",
                        "Intramuscular epinephrine (adrenaline) is the first-line drug: 0.01 mg/kg of body weight to a "
                        "maximum total dose of 0.5 mg, repeated every 5 to 15 min if symptoms are refractory.",
                        "https://doi.org/10.1016/j.example", fetch_url="http://fixture.test/epmc/PMC1/fullTextXML"))
    assert out.status == "verified", out.reason
    assert out.verification_url.endswith("/fullTextXML")


def test_embedding_adapter_blends_when_available():
    async def embed(texts):
        # A degenerate embedder: identical vectors => cosine 1.0 for every candidate.
        return [[1.0, 0.0] for _ in texts]

    out = _verify(_stmt("gs_fix_embed", "Offer people with acute STEMI a single loading dose of 300 mg aspirin "
                        "as soon as possible unless there is clear evidence that they are allergic to it.", RECS_URL),
                  embed_fn=embed)
    assert out.status == "verified" and out.method == "lexical+embedding"
    assert "embedding 1.00" in out.reason


def test_verify_store_writes_status_quote_and_summary(fresh_store: GuidelineStore, tmp_path):
    fresh_store.upsert(_stmt("gs_fix_ok", "Offer people with acute STEMI a single loading dose of 300 mg aspirin as "
                             "soon as possible unless there is clear evidence that they are allergic to it.", RECS_URL))
    fresh_store.upsert(_stmt("gs_fix_bad", "Perform urgent haemodialysis within 6 hours for every hyperkalaemic "
                             "patient after 2 g magnesium.", RECS_URL))
    fresh_store.upsert(_stmt("gs_fix_home", "Offer 300 mg aspirin.", "https://www.saglik.gov.tr"))

    async def run():
        async with _client() as client:
            return await verifier.verify_and_export(fresh_store, tmp_path / "out.json", client=client,
                                                    verified_by="agent:test")

    summary = asyncio.run(run())
    assert summary["checked"] == 3 and summary["verified"] == 1 and summary["failed"] == 2
    ok = fresh_store.get("gs_fix_ok")
    assert ok.status == "verified" and ok.verified_by == "agent:test" and ok.verification_quote and ok.verified_at
    assert ok.retrieved_at and ok.verification_url == RECS_URL
    bad = fresh_store.get("gs_fix_bad")
    assert bad.status == "failed" and bad.verification_note and bad.verified_at == ""
    assert "homepage-only" in fresh_store.get("gs_fix_home").verification_note
    assert (tmp_path / "out.json").exists()
    # A second run only touches drafts: nothing left to check.
    assert asyncio.run(verifier.verify_store(fresh_store))["checked"] == 0


@pytest.mark.live
def test_live_nice_recommendations_page_supports_a_seeded_statement():
    if skip_live():
        pytest.skip("ACUDX_SKIP_LIVE set")
    from server.guidelines import seed_open

    stmt = seed_open.by_id()["gs_nice_ng228_thunderclap"]

    async def run():
        async with httpx.AsyncClient(timeout=40) as client:
            return await verifier.verify_statement(stmt, client)

    try:
        out = asyncio.run(run())
    except Exception as exc:  # pragma: no cover - network dependent
        pytest.skip(f"network unavailable: {exc}")
    if out.status == "failed" and ("fetch error" in out.reason or "HTTP" in out.reason):
        pytest.skip(f"NICE unreachable from this sandbox: {out.reason}")
    assert out.status == "verified", out.reason
    assert "thunderclap" in out.quote.lower()
    assert out.verification_url.startswith("https://www.nice.org.uk/guidance/ng228")

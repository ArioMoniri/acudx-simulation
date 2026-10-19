"""Imaging bank: every entry is license-clean, attributed, verified, well-formed,
and the resolver never flips laterality or searches the web."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import pytest

from server.results import imaging_bank as ib

ALLOWED_LICENSE_RE = re.compile(r"^(CC BY(-SA)? \d\.\d|CC0( / Public domain)?|Public domain)$")
URL_RE = re.compile(r"^https://[A-Za-z0-9.-]+/[^\s]+$")


@pytest.fixture(scope="module")
def bank():
    return ib.load_bank()


def test_bank_size_and_policy(bank):
    assert len(bank["entries"]) >= 40
    assert any("No runtime web search" in p for p in bank["policy"])
    assert bank["banks"]["radiopaedia"]["status"] == "excluded"


def test_every_entry_has_license_attribution_and_provenance(bank):
    required = ("id", "modality", "region", "finding", "laterality", "view", "order_codes", "url", "license",
                "license_url", "attribution", "source_page", "source_bank", "verified_at", "is_synthetic", "caption_en")
    ids = set()
    for e in bank["entries"]:
        for k in required:
            assert k in e, (e.get("id"), k)
        assert e["id"] not in ids
        ids.add(e["id"])
        assert e["is_synthetic"] is False
        assert e["attribution"].strip()
        assert ALLOWED_LICENSE_RE.match(e["license"]), (e["id"], e["license"])
        assert "NC" not in e["license"] and "ND" not in e["license"]
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", e["verified_at"])
        assert e["laterality"] in ("left", "right", "bilateral", "none", "unspecified")
        assert e["modality"] in ("xr", "ct", "mri", "us", "echo", "ecg")


def test_urls_well_formed(bank):
    for e in bank["entries"]:
        for key in ("url", "source_page"):
            u = e[key]
            assert URL_RE.match(u), (e["id"], key, u)
            p = urlparse(u)
            assert p.scheme == "https" and p.netloc.endswith("wikimedia.org")
        assert "utm_" not in e["url"]
        if e["license_url"]:
            assert URL_RE.match(e["license_url"]) or e["license_url"].startswith("http://creativecommons.org/")
        if e.get("local_path"):
            assert e["local_path"].startswith("web/public/imaging/")


def test_normal_study_for_every_catalog_modality(bank):
    modalities = {e["modality"] for e in bank["entries"]}
    assert {"xr", "ct", "mri", "us", "echo", "ecg"} <= modalities
    cov = ib.catalog_coverage()
    assert all(v["modality_normal"] for v in cov.values()), [k for k, v in cov.items() if not v["modality_normal"]]
    for code in ("cxr", "ct-head-noncon", "ct-abdo-pelvis", "us-abdomen", "us-ruq", "us-renal", "echo", "mri-brain", "mri-lspine", "mri-mrcp", "11524-6", "xr-extremity"):
        assert cov[code]["region_normal"], code


def test_resolver_finds_condition_images():
    r = ib.resolve(order_code="cxr", finding="pneumothorax", laterality="left", condition_id="tension_pneumothorax")
    assert r["status"] == "ok" and r["entry"]["id"] == "cxr-pneumothorax"
    assert r["provenance"]["license"].startswith("CC BY-SA") and "Wikimedia Commons" in r["provenance"]["attribution_text"]
    assert r["provenance"]["is_synthetic"] is False
    r = ib.resolve(order_code="11524-6", finding="stemi_anterior", condition_id="acs_stemi")
    assert r["status"] == "ok" and r["entry"]["id"] == "ecg-anterior-stemi"
    r = ib.resolve(order_code="ctpa", finding="pulmonary_embolism")
    assert r["status"] == "ok" and r["entry"]["id"] == "ct-pulmonary-embolism"


def test_laterality_never_flips():
    # a right-sided infarct image must not be served for a left MCA stroke
    r = ib.resolve(order_code="ct-head-noncon", finding="ischemic_infarct", laterality="left")
    assert r["status"] == "unavailable" and r["reason"] == "laterality_mismatch"
    r = ib.resolve(order_code="ct-head-noncon", finding="ischemic_infarct", laterality="right")
    assert r["status"] == "ok" and r["entry"]["laterality"] == "right"
    # an image of unknown side is never served for a sided request
    r = ib.resolve(order_code="mri-brain", finding="ischemic_infarct", laterality="left")
    assert r["status"] == "unavailable"
    # but a bilateral or non-sided image is fine for a sided request
    assert ib.laterality_compatible("left", "bilateral") and ib.laterality_compatible("right", "none")
    assert not ib.laterality_compatible("left", "right") and not ib.laterality_compatible("left", "unspecified")
    # DVT: left and right images exist, each served only for its own side
    left = ib.resolve(order_code="us-dvt", finding="deep_vein_thrombosis", laterality="left")
    right = ib.resolve(order_code="us-dvt", finding="deep_vein_thrombosis", laterality="right")
    assert left["entry"]["laterality"] == "left" and right["entry"]["laterality"] == "right"


def test_unavailable_returns_structured_findings_only():
    findings = [{"finding": "ovarian_torsion", "laterality": "left"}]
    r = ib.resolve(order_code="us-pelvis", finding="ovarian_torsion", laterality="left", findings=findings)
    assert r["status"] == "unavailable"
    assert r["findings"] == findings
    assert "entry" not in r and "url" not in r


def test_resolver_is_deterministic_and_offline():
    a = ib.resolve(order_code="cxr", finding="normal")
    b = ib.resolve(order_code="cxr", finding="normal")
    assert a == b and a["entry"]["id"] == "cxr-normal"
    import inspect
    src = inspect.getsource(ib)
    assert "urllib" not in src and "requests" not in src and "httpx" not in src

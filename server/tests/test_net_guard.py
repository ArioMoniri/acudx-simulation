"""Review 04 O5: SSRF guard for the guideline verifier and provider probes, streamed size cap."""

from __future__ import annotations

import httpx
import pytest

from server import net_guard
from server.guidelines import verifier


def _resolver(table: dict[str, list[str]]):
    async def resolve(host: str) -> list[str]:
        if host not in table:
            raise OSError("NXDOMAIN")
        return table[host]

    return resolve


class _NoRobots(verifier.RobotsCache):
    async def allowed(self, client, url):  # noqa: D401 - robots are not under test here
        return True


def _fetch(url: str, handler, *, allow=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await verifier.fetch_document(url, client, robots=_NoRobots(),
                                                 limiter=verifier.RateLimiter(0), redirect_allowlist=allow)
    import asyncio

    return asyncio.run(run())


PAGE = "<html><body><main>" + "<p>Offer aspirin 300 mg as soon as possible to adults with STEMI.</p>" * 10 + "</main></body></html>"


def test_registrable_domain_handles_second_level_suffixes():
    assert net_guard.registrable_domain("www.nice.org.uk") == "nice.org.uk"
    assert net_guard.registrable_domain("files.saglik.gov.tr") == "saglik.gov.tr"
    assert net_guard.registrable_domain("pubmed.ncbi.nlm.nih.gov") == "nih.gov"
    assert net_guard.same_site_or_allowed("https://www.nice.org.uk/a", "https://cdn.nice.org.uk/b")
    assert not net_guard.same_site_or_allowed("https://www.nice.org.uk/a", "https://evil.co.uk/b")
    assert net_guard.same_site_or_allowed("https://doi.org/x", "https://www.ahajournals.org/y", [".ahajournals.org"])


@pytest.mark.parametrize("addr", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fc00::1",
                                  "::ffff:10.1.2.3", "100.64.0.1", "0.0.0.0"])
def test_verifier_refuses_hosts_that_resolve_to_non_public_addresses(monkeypatch, addr):
    monkeypatch.setattr(net_guard, "RESOLVER", _resolver({"guideline.example": [addr]}))
    called = []
    out = _fetch("https://guideline.example/doc", lambda r: called.append(r) or httpx.Response(200, text=PAGE))
    assert out.error.startswith("blocked destination") and not called


def test_verifier_follows_same_site_redirects_and_refuses_cross_site_or_private_hops(monkeypatch):
    monkeypatch.setattr(net_guard, "RESOLVER", _resolver({
        "www.nice.org.uk": ["93.184.215.14"], "cdn.nice.org.uk": ["93.184.215.15"],
        "attacker.example": ["93.184.215.16"], "rebind.nice.org.uk": ["10.0.0.7"]}))

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "www.nice.org.uk" and path == "/ok":
            return httpx.Response(302, headers={"location": "https://cdn.nice.org.uk/doc"})
        if request.url.host == "www.nice.org.uk" and path == "/away":
            return httpx.Response(301, headers={"location": "https://attacker.example/doc"})
        if request.url.host == "www.nice.org.uk" and path == "/rebind":
            return httpx.Response(302, headers={"location": "https://rebind.nice.org.uk/doc"})
        if request.url.host == "www.nice.org.uk" and path == "/loop":
            return httpx.Response(302, headers={"location": "/loop"})
        return httpx.Response(200, text=PAGE, headers={"content-type": "text/html"})

    ok = _fetch("https://www.nice.org.uk/ok", handler)
    assert ok.error == "" and ok.final_url == "https://cdn.nice.org.uk/doc"
    assert _fetch("https://www.nice.org.uk/away", handler).error.startswith("redirect to another domain refused")
    assert _fetch("https://www.nice.org.uk/away", handler, allow=["attacker.example"]).error == ""
    assert _fetch("https://www.nice.org.uk/rebind", handler).error.startswith("blocked destination")
    assert _fetch("https://www.nice.org.uk/loop", handler).error == "more than 3 redirects"


def test_verifier_streams_and_stops_at_the_25_mb_cap(monkeypatch):
    sent = {"bytes": 0}

    async def endless():
        chunk = b"x" * (1024 * 1024)
        for _ in range(100):                    # would be 100 MB
            sent["bytes"] += len(chunk)
            yield chunk

    out = _fetch("https://big.example/doc", lambda r: httpx.Response(200, content=endless(),
                                                                      headers={"content-type": "text/html"}))
    assert out.error == f"document larger than {verifier.MAX_BYTES} bytes"
    assert sent["bytes"] <= verifier.MAX_BYTES + 2 * 1024 * 1024, "the body is abandoned at the cap"
    declared = _fetch("https://big.example/doc", lambda r: httpx.Response(
        200, content=b"x", headers={"content-length": str(verifier.MAX_BYTES + 1)}))
    assert declared.error.startswith("document larger than")


async def test_probe_policy_allows_on_prem_literals_and_blocks_metadata_and_private_names(monkeypatch):
    monkeypatch.setattr(net_guard, "RESOLVER", _resolver({
        "llm.internal": ["10.0.0.9"], "meta.example": ["169.254.169.254"], "api.vendor.example": ["93.184.215.20"]}))
    await net_guard.check_probe_url("http://127.0.0.1:8000/v1")
    await net_guard.check_probe_url("http://10.0.0.9:8000/v1")
    await net_guard.check_probe_url("http://localhost:11434")
    await net_guard.check_probe_url("https://api.vendor.example")
    await net_guard.check_probe_url("http://llm.internal:8000", allow_private=["llm.internal"])
    with pytest.raises(net_guard.BlockedDestination):
        await net_guard.check_probe_url("http://169.254.169.254/latest/meta-data")
    with pytest.raises(net_guard.BlockedDestination):
        await net_guard.check_probe_url("http://meta.example/")
    with pytest.raises(net_guard.BlockedDestination):
        await net_guard.check_probe_url("http://llm.internal:8000")


async def test_registry_probe_refuses_a_metadata_target_without_a_request(tmp_path):
    from cryptography.fernet import Fernet

    from server.config import Settings
    from server.registry.probe import probe_provider
    from server.registry.store import ProviderIn, RegistryStore

    store = RegistryStore(str(tmp_path / "r.db"), secret_key=Fernet.generate_key().decode())
    rec = store.create_provider(ProviderIn(kind="llm", name="meta", base_url="http://169.254.169.254/v1"))
    calls = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200))) as c:
        out = await probe_provider(rec, api_key=None, settings=Settings(_env_file=None, airgapped=False),
                                   client=c, store=store)
    assert out["ok"] is False and out["error"] == "BlockedDestination" and not calls


async def test_identity_probe_reports_an_empty_audience_as_a_configuration_error(tmp_path):
    from cryptography.fernet import Fernet

    from server.config import Settings
    from server.registry.probe import probe_provider
    from server.registry.store import ProviderIn, RegistryStore

    store = RegistryStore(str(tmp_path / "r.db"), secret_key=Fernet.generate_key().decode())
    rec = store.create_provider(ProviderIn(kind="identity", name="kc", base_url="https://idp.example.edu/realms/a",
                                           extra={"audience": ""}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={}))) as c:
        out = await probe_provider(rec, api_key=None, settings=Settings(_env_file=None, airgapped=False),
                                   client=c, store=store)
    assert out["ok"] is False and out["error"] == "IdentityMisconfigured" and "audience" in out["detail"]

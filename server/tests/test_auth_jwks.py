"""JWKS verification with a locally generated RSA key pair: signature, issuer,
audience, exp, nbf, kid rotation, discovery and JWKS fetch over a respx double."""

from __future__ import annotations

import httpx
import pytest
import respx

from server.auth.jwks import Discovery, OidcVerifier, TokenInvalid
from server.tests.auth_harness import CLIENT_ID, ISSUER, KeyPair


@pytest.fixture(scope="module")
def keys() -> KeyPair:
    return KeyPair()


def _verifier(keys: KeyPair, **over) -> OidcVerifier:
    kw = dict(issuer=ISSUER, audience=CLIENT_ID, jwks=keys.jwks())
    kw.update(over)
    return OidcVerifier(**kw)


async def test_valid_token_returns_claims(keys):
    v = _verifier(keys)
    claims = await v.verify(keys.mint(sub="abc", roles=["faculty"]))
    assert claims["sub"] == "abc" and claims["realm_access"]["roles"] == ["faculty"]


@pytest.mark.parametrize(
    "kw, reason",
    [
        (dict(exp_in=-120), "expired"),
        (dict(nbf_in=600), "not_yet_valid"),
        (dict(iss="https://evil.example"), "bad_issuer"),
        (dict(aud="other-client"), "bad_audience"),
        (dict(aud=None), "missing_claim"),
    ],
)
async def test_claim_checks(keys, kw, reason):
    v = _verifier(keys)
    with pytest.raises(TokenInvalid) as exc:
        await v.verify(keys.mint(**kw))
    assert exc.value.reason == reason


async def test_audience_may_be_a_list(keys):
    v = _verifier(keys)
    claims = await v.verify(keys.mint(aud=["account", CLIENT_ID]))
    assert claims["sub"] == "u-1"


async def test_empty_audience_is_refused_not_a_disabled_check(keys):
    """Review 04 O9: a verifier without an audience refuses every token."""
    for aud in (None, ""):
        v = _verifier(keys, audience=aud)
        with pytest.raises(TokenInvalid) as exc:
            await v.verify(keys.mint(aud=None))
        assert exc.value.reason == "audience_not_configured"


async def test_wrong_key_is_rejected(keys):
    other = KeyPair(kid="k1")  # same kid, different key material
    v = _verifier(keys)
    with pytest.raises(TokenInvalid) as exc:
        await v.verify(other.mint())
    assert exc.value.reason == "invalid_signature"


async def test_unknown_kid_and_none_alg_rejected(keys):
    v = _verifier(keys)
    with pytest.raises(TokenInvalid) as exc:
        await v.verify(keys.mint(kid="rotated"))
    assert exc.value.reason == "unknown_kid"
    # an unsigned token (alg=none) never reaches the key lookup
    header = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0"
    payload = "eyJzdWIiOiJ4IiwiaXNzIjoiaHR0cHM6Ly9pZHAuZXhhbXBsZS5lZHUvcmVhbG1zL2FjdWR4In0"
    with pytest.raises(TokenInvalid) as exc2:
        await v.verify(f"{header}.{payload}.")
    assert exc2.value.reason == "alg_not_allowed"
    with pytest.raises(TokenInvalid) as exc3:
        await v.verify("not-a-jwt")
    assert exc3.value.reason == "malformed"


@respx.mock
async def test_discovery_and_jwks_are_fetched_and_cached(keys):
    disc = respx.get(f"{ISSUER}/.well-known/openid-configuration").mock(
        return_value=httpx.Response(200, json={
            "issuer": ISSUER, "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
            "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
            "token_endpoint": f"{ISSUER}/protocol/openid-connect/token"}))
    jwks = respx.get(f"{ISSUER}/protocol/openid-connect/certs").mock(return_value=httpx.Response(200, json=keys.jwks()))
    v = OidcVerifier(issuer=ISSUER, audience=CLIENT_ID)
    async with httpx.AsyncClient() as client:
        c1 = await v.verify(keys.mint(sub="one"), client)
        c2 = await v.verify(keys.mint(sub="two"), client)
        d = await v.discover(client)
    assert c1["sub"] == "one" and c2["sub"] == "two"
    assert disc.call_count == 1 and jwks.call_count == 1
    assert isinstance(d, Discovery) and d.token_endpoint.endswith("/token")
    assert d.public()["authorization_endpoint"].endswith("/auth")


@respx.mock
async def test_key_rotation_triggers_one_refresh(keys):
    rotated = KeyPair(kid="k2")
    respx.get(f"{ISSUER}/.well-known/openid-configuration").mock(
        return_value=httpx.Response(200, json={"issuer": ISSUER, "jwks_uri": f"{ISSUER}/certs"}))
    route = respx.get(f"{ISSUER}/certs")
    route.side_effect = [httpx.Response(200, json=keys.jwks()), httpx.Response(200, json=rotated.jwks()),
                         httpx.Response(200, json=rotated.jwks())]
    v = OidcVerifier(issuer=ISSUER, audience=CLIENT_ID)
    async with httpx.AsyncClient() as client:
        assert (await v.verify(keys.mint(), client))["sub"] == "u-1"
        assert (await v.verify(rotated.mint(), client))["sub"] == "u-1"
        with pytest.raises(TokenInvalid):
            await v.verify(keys.mint(), client)  # k1 no longer published after rotation
    assert route.call_count == 3

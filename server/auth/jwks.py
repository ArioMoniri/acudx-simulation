"""OIDC discovery + JWKS cache and bearer-token verification (PyJWT + cryptography).

``OidcVerifier`` is built from an identity-provider record (see :mod:`server.auth.config`)
and fetches ``<issuer>/.well-known/openid-configuration`` once, then the JWKS
document it names. Keys are cached by ``kid`` for ``jwks_ttl_s`` seconds; an
unknown ``kid`` triggers one refresh (key rotation) before the token is rejected.
Verification checks signature, ``iss``, ``aud`` (when configured), ``exp`` and
``nbf``. Nothing here trusts an unverified claim.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from jwt import PyJWK

log = logging.getLogger("acudx.auth")

ALLOWED_ALGS: tuple[str, ...] = ("RS256", "RS384", "RS512", "ES256", "ES384", "PS256")


class TokenInvalid(Exception):
    """A bearer token failed verification; ``reason`` is a short machine code."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(detail or reason)
        self.reason = reason
        self.detail = detail


@dataclass
class Discovery:
    issuer: str
    authorization_endpoint: str | None = None
    token_endpoint: str | None = None
    end_session_endpoint: str | None = None
    userinfo_endpoint: str | None = None
    jwks_uri: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "issuer": self.issuer,
            "authorization_endpoint": self.authorization_endpoint,
            "token_endpoint": self.token_endpoint,
            "end_session_endpoint": self.end_session_endpoint,
            "userinfo_endpoint": self.userinfo_endpoint,
        }


@dataclass
class OidcVerifier:
    issuer: str
    audience: str | None = None
    jwks_ttl_s: float = 600.0
    timeout_s: float = 5.0
    discovery_url: str | None = None
    # Pre-seeded keys / discovery (tests, air-gapped mirrors). When ``jwks`` is set the
    # verifier never performs a network fetch.
    jwks: dict[str, Any] | None = None
    discovery: Discovery | None = None
    _keys: dict[str, PyJWK] = field(default_factory=dict, init=False, repr=False)
    _fetched_at: float = field(default=0.0, init=False, repr=False)

    def __post_init__(self) -> None:
        self.issuer = self.issuer.rstrip("/")
        if self.jwks is not None:
            self._load_keys(self.jwks)
            self._fetched_at = time.monotonic()

    # -- discovery ------------------------------------------------------------- #
    async def discover(self, client: httpx.AsyncClient | None = None) -> Discovery:
        if self.discovery is not None:
            return self.discovery
        url = self.discovery_url or f"{self.issuer}/.well-known/openid-configuration"
        own = client is None
        client = client or httpx.AsyncClient(timeout=self.timeout_s)
        try:
            r = await client.get(url)
            r.raise_for_status()
            doc = r.json()
        finally:
            if own:
                await client.aclose()
        self.discovery = Discovery(
            issuer=str(doc.get("issuer") or self.issuer).rstrip("/"),
            authorization_endpoint=doc.get("authorization_endpoint"),
            token_endpoint=doc.get("token_endpoint"),
            end_session_endpoint=doc.get("end_session_endpoint"),
            userinfo_endpoint=doc.get("userinfo_endpoint"),
            jwks_uri=doc.get("jwks_uri"),
            raw=doc,
        )
        return self.discovery

    # -- keys ------------------------------------------------------------------ #
    def _load_keys(self, jwks: dict[str, Any]) -> None:
        keys: dict[str, PyJWK] = {}
        for k in jwks.get("keys", []):
            kid = k.get("kid")
            if not kid:
                continue
            try:
                keys[kid] = PyJWK.from_dict(k)
            except jwt.PyJWKError as exc:  # unsupported key type: skip, never crash
                log.warning("jwks: skipping key %s: %s", kid, exc)
        self._keys = keys

    async def refresh_keys(self, client: httpx.AsyncClient | None = None) -> None:
        if self.jwks is not None:
            return
        disc = await self.discover(client)
        if not disc.jwks_uri:
            raise TokenInvalid("jwks_unavailable", "discovery document has no jwks_uri")
        own = client is None
        client = client or httpx.AsyncClient(timeout=self.timeout_s)
        try:
            r = await client.get(disc.jwks_uri)
            r.raise_for_status()
            self._load_keys(r.json())
        finally:
            if own:
                await client.aclose()
        self._fetched_at = time.monotonic()

    async def key_for(self, kid: str | None, client: httpx.AsyncClient | None = None) -> PyJWK:
        stale = (time.monotonic() - self._fetched_at) > self.jwks_ttl_s
        if not self._keys or stale:
            await self.refresh_keys(client)
        if kid is None:
            if len(self._keys) == 1:
                return next(iter(self._keys.values()))
            raise TokenInvalid("kid_missing", "token header has no kid and the JWKS holds several keys")
        if kid not in self._keys and self.jwks is None:
            await self.refresh_keys(client)  # rotation: one retry
        try:
            return self._keys[kid]
        except KeyError:
            raise TokenInvalid("unknown_kid", f"no JWKS key with kid {kid!r}") from None

    # -- verification ---------------------------------------------------------- #
    async def verify(self, token: str, client: httpx.AsyncClient | None = None) -> dict[str, Any]:
        """Return the verified claims or raise :class:`TokenInvalid`."""
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise TokenInvalid("malformed", str(exc)) from exc
        alg = header.get("alg")
        if alg not in ALLOWED_ALGS:
            raise TokenInvalid("alg_not_allowed", f"alg {alg!r} is not accepted")
        if not self.audience:
            # Review 04 O9: an empty audience is a configuration error, never a disabled check.
            raise TokenInvalid("audience_not_configured", "the identity provider has no audience configured")
        key = await self.key_for(header.get("kid"), client)
        options: dict[str, Any] = {"require": ["exp", "iat", "iss", "sub"], "verify_aud": True}
        try:
            return jwt.decode(
                token,
                key.key,
                algorithms=[alg],
                issuer=self.issuer,
                audience=self.audience,
                options=options,
                leeway=30,
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenInvalid("expired", str(exc)) from exc
        except jwt.ImmatureSignatureError as exc:
            raise TokenInvalid("not_yet_valid", str(exc)) from exc
        except jwt.InvalidIssuerError as exc:
            raise TokenInvalid("bad_issuer", str(exc)) from exc
        except jwt.InvalidAudienceError as exc:
            raise TokenInvalid("bad_audience", str(exc)) from exc
        except jwt.MissingRequiredClaimError as exc:
            raise TokenInvalid("missing_claim", str(exc)) from exc
        except jwt.PyJWTError as exc:
            raise TokenInvalid("invalid_signature", str(exc)) from exc

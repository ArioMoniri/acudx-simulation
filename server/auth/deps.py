"""FastAPI dependencies: ``current_user``, role guards, and the auth service.

``AuthService`` (``app.state.auth``) resolves the effective mode and identity
provider from the registry on every request (cheap SQLite reads; the verifier
and its JWKS are cached per provider row version).

Modes
-----
``oidc``   a bearer JWT is required on every protected route; it is verified
           against the configured provider and the principal carries
           ``verified=True``.
``local``  the air-gapped default. A valid bearer is still honoured when a
           provider is configured, otherwise the principal is taken from the
           unverified ``X-User-Id`` / ``X-User-Role`` / ``X-User-Name`` /
           ``X-User-Email`` / ``X-Tenant`` headers the local-profile client
           sends, with ``verified=False``. Every response carries
           ``X-Auth-Mode: local`` (middleware in server/app.py).

           Fail closed (review 04 O2): a header principal holds at most
           ``resident``. ``faculty``, ``dean``, ``admin`` and ``super_admin``
           need a verified bearer JWT, or the request must also carry a valid
           ``X-Admin-Token`` (an operator seeding a classroom). A capped
           principal reports the role it asked for in ``role_capped_from``.

Guards
------
``require_role("dean")`` admits dean, admin and super_admin (precedence order,
see :mod:`server.auth.roles`). ``/admin/*`` additionally accepts the bootstrap
``X-Admin-Token`` (server/admin_routes.py).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

import httpx
from fastapi import Depends, HTTPException, Request

from server.auth.config import IdentityConfig, effective_auth_mode, identity_config
from server.auth.jwks import OidcVerifier, TokenInvalid
from server.auth.roles import DEFAULT_ROLE, at_least, claim_at_path, normalize_role, normalize_roles, primary_role, roles_from_claims
from server.auth.store import UserRoleStore
from server.registry.store import RegistryStore

log = logging.getLogger("acudx.auth")

LOCAL_ORG = "local"
# Highest role an unverified local-mode header principal may hold without X-Admin-Token.
LOCAL_HEADER_ROLE_CAP = "resident"


@dataclass
class Principal:
    sub: str
    email: str | None
    name: str | None
    roles: list[str]
    org: str
    verified: bool
    mode: str
    role_capped_from: str | None = None
    claims: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def primary_role(self) -> str:
        return primary_role(self.roles)

    @property
    def user_hash(self) -> str:
        return hashlib.sha256(self.sub.encode("utf-8")).hexdigest()[:16]

    def has(self, minimum: str) -> bool:
        return at_least(self.roles, minimum)

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("claims", None)
        if d.get("role_capped_from") is None:
            d.pop("role_capped_from", None)
        d["primary_role"] = self.primary_role
        return d


class AuthService:
    def __init__(self, registry: RegistryStore, users: UserRoleStore, *, env_mode: str = "local",
                 client: httpx.AsyncClient | None = None):
        self.registry = registry
        self.users = users
        self.env_mode = env_mode
        self._client = client
        self._verifier: OidcVerifier | None = None
        self._verifier_key: tuple[int, float] | None = None

    # -- configuration --------------------------------------------------------- #
    @property
    def mode(self) -> str:
        return effective_auth_mode(self.env_mode, self.registry)

    def provider(self) -> IdentityConfig | None:
        return identity_config(self.registry)

    def verifier_for(self, cfg: IdentityConfig) -> OidcVerifier:
        if self._verifier is None or self._verifier_key != cfg.cache_key:
            self._verifier = OidcVerifier(issuer=cfg.issuer, audience=cfg.audience, discovery_url=cfg.discovery_url)
            self._verifier_key = cfg.cache_key
        return self._verifier

    def install_verifier(self, cfg: IdentityConfig, verifier: OidcVerifier) -> None:
        """Tests and air-gapped mirrors: pre-seed the verifier (keys already loaded)."""
        self._verifier = verifier
        self._verifier_key = cfg.cache_key

    async def public_config(self) -> dict[str, Any]:
        cfg = self.provider()
        out: dict[str, Any] = {"mode": self.mode, "provider": None, "discovery": None, "configured": cfg is not None}
        if cfg is not None:
            out["provider"] = cfg.public()
            try:
                disc = await self.verifier_for(cfg).discover(self._client)
                out["discovery"] = disc.public()
            except (httpx.HTTPError, ValueError) as exc:
                out["discovery_error"] = f"{type(exc).__name__}: {exc}"
        return out

    # -- principals ------------------------------------------------------------ #
    def _principal_from_claims(self, cfg: IdentityConfig, claims: dict[str, Any]) -> Principal:
        sub = str(claims["sub"])
        claim_roles = roles_from_claims(claims, cfg.role_claim_path)
        granted = self.users.granted_roles(sub)
        roles = normalize_roles([*claim_roles, *granted]) or [DEFAULT_ROLE]
        org_raw = claim_at_path(claims, cfg.org_claim_path)
        if isinstance(org_raw, (list, tuple)) and org_raw:
            org_raw = org_raw[0]
        if isinstance(org_raw, dict):  # Keycloak Organizations: {"acme": {...}}
            org_raw = next(iter(org_raw), None)
        org = str(org_raw) if org_raw else LOCAL_ORG
        email = claims.get("email") if isinstance(claims.get("email"), str) else None
        name = claims.get("name") or claims.get("preferred_username")
        name = name if isinstance(name, str) else None
        self.users.touch(sub, org=org, email=email, name=name)
        return Principal(sub=sub, email=email, name=name, roles=roles, org=org, verified=True, mode=self.mode,
                         claims=claims)

    @staticmethod
    def _principal_from_headers(request: Request, mode: str) -> Principal | None:
        sub = (request.headers.get("x-user-id") or "").strip()
        if not sub:
            return None
        role = normalize_role(request.headers.get("x-user-role")) or DEFAULT_ROLE
        capped_from: str | None = None
        if at_least([role], "faculty") and not admin_token_presented(request):
            capped_from, role = role, LOCAL_HEADER_ROLE_CAP
        org = (request.headers.get("x-tenant") or "").strip() or LOCAL_ORG
        return Principal(
            sub=sub,
            email=(request.headers.get("x-user-email") or None),
            name=(request.headers.get("x-user-name") or None),
            roles=[role],
            org=org,
            verified=False,
            mode=mode,
            role_capped_from=capped_from,
        )

    async def authenticate(self, request: Request) -> Principal | None:
        """Principal for the request, None when anonymous. Raises 401 on a bad bearer, 503 when oidc has no IdP."""
        mode = self.mode
        auth = request.headers.get("authorization") or ""
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        cfg = self.provider()
        if token:
            if cfg is None:
                if mode == "oidc":
                    raise HTTPException(status_code=503, detail={"reason": "identity_not_configured",
                                                                 "message": "AUTH_MODE is oidc but no identity provider is enabled"})
                raise HTTPException(status_code=401, detail={"reason": "no_identity_provider",
                                                             "message": "a bearer token was sent but no identity provider is configured"})
            try:
                claims = await self.verifier_for(cfg).verify(token, self._client)
            except TokenInvalid as exc:
                raise HTTPException(status_code=401, detail={"reason": exc.reason, "message": exc.detail},
                                    headers={"WWW-Authenticate": "Bearer"}) from exc
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=503, detail={"reason": "jwks_unreachable",
                                                             "message": f"{type(exc).__name__}: {exc}"}) from exc
            return self._principal_from_claims(cfg, claims)
        if mode == "oidc":
            if cfg is None:
                raise HTTPException(status_code=503, detail={"reason": "identity_not_configured",
                                                             "message": "AUTH_MODE is oidc but no identity provider is enabled"})
            return None
        return self._principal_from_headers(request, mode)


def admin_token_presented(request: Request) -> bool:
    """True when ``X-Admin-Token`` matches the configured ``ADMIN_TOKEN`` (constant time)."""
    presented = request.headers.get("x-admin-token") or ""
    expected = getattr(getattr(request.app.state, "settings", None), "admin_token", None) or ""
    return bool(presented and expected and secrets.compare_digest(presented.encode(), expected.encode()))


def _service(request: Request) -> AuthService:
    svc = getattr(request.app.state, "auth", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="auth service not initialised")
    return svc


async def optional_user(request: Request) -> Principal | None:
    return await _service(request).authenticate(request)


async def current_user(request: Request) -> Principal:
    p = await optional_user(request)
    if p is None:
        raise HTTPException(status_code=401, detail={"reason": "unauthenticated",
                                                     "message": "sign in to use this route"},
                            headers={"WWW-Authenticate": "Bearer"})
    return p


def require_role(minimum: str) -> Callable[..., Any]:
    """Dependency factory: 403 unless the principal holds ``minimum`` or a higher role."""

    async def _guard(user: Principal = Depends(current_user)) -> Principal:
        if not user.has(minimum):
            raise HTTPException(status_code=403, detail={"reason": "forbidden", "required": minimum,
                                                         "roles": user.roles})
        return user

    return _guard


async def bearer_admin(request: Request) -> Principal | None:
    """A verified bearer principal holding admin or super_admin, else None (never raises)."""
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    svc = getattr(request.app.state, "auth", None)
    if svc is None:
        return None
    try:
        p = await svc.authenticate(request)
    except HTTPException:
        return None
    if p is not None and p.verified and p.has("admin"):
        return p
    return None

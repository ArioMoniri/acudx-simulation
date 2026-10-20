"""Identity-provider configuration read from the admin registry.

An identity provider is a registry row with ``kind="identity"``:

* ``base_url``   the OIDC issuer (Keycloak: ``https://idp.example.edu/realms/acudx``;
                 Supabase: ``https://<ref>.supabase.co/auth/v1``)
* ``model``      unused for identity; ``extra`` carries the OIDC settings:
  - ``client_id``        public PKCE client (default ``acudx-web``)
  - ``audience``         expected ``aud`` (default: the client id; ``""`` disables the check)
  - ``scopes``           space separated (default ``openid profile email``)
  - ``role_claim_path``  dotted path to the roles claim (Keycloak ``realm_access.roles``,
                         Supabase ``app_metadata.roles``; default ``roles``)
  - ``org_claim_path``   dotted path to the org / tenant claim (default ``org``)
  - ``flavor``           ``keycloak`` | ``supabase`` | ``oidc`` (UI hint only)
  - ``discovery_url``    override for ``<issuer>/.well-known/openid-configuration``

The registry ``settings`` table may carry ``auth_mode`` (``local`` | ``oidc``) which
overrides the ``AUTH_MODE`` environment default.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from server.registry.store import ProviderRecord, RegistryStore

AUTH_MODES: tuple[str, ...] = ("local", "oidc")
DEFAULT_SCOPES = "openid profile email"
DEFAULT_ROLE_CLAIM = "roles"
DEFAULT_ORG_CLAIM = "org"

_FLAVOR_DEFAULT_ROLE_PATH = {
    "keycloak": "realm_access.roles",
    "supabase": "app_metadata.roles",
}


@dataclass(frozen=True)
class IdentityConfig:
    provider_id: int
    name: str
    issuer: str
    client_id: str
    audience: str | None
    scopes: str
    role_claim_path: str
    org_claim_path: str
    flavor: str
    discovery_url: str | None
    updated_at: float

    @property
    def cache_key(self) -> tuple[int, float]:
        return (self.provider_id, self.updated_at)

    def public(self) -> dict[str, Any]:
        """What the browser needs to run PKCE. Never a secret (there is none: public client)."""
        return {
            "provider_id": self.provider_id,
            "name": self.name,
            "issuer": self.issuer,
            "client_id": self.client_id,
            "scopes": self.scopes,
            "role_claim_path": self.role_claim_path,
            "org_claim_path": self.org_claim_path,
            "flavor": self.flavor,
        }


def identity_config_from_record(rec: ProviderRecord) -> IdentityConfig:
    extra = rec.extra or {}
    flavor = str(extra.get("flavor") or "oidc").lower()
    client_id = str(extra.get("client_id") or "acudx-web")
    aud_raw = extra.get("audience", client_id)
    audience = None if aud_raw in ("", None) else str(aud_raw)
    role_path = str(extra.get("role_claim_path") or _FLAVOR_DEFAULT_ROLE_PATH.get(flavor, DEFAULT_ROLE_CLAIM))
    return IdentityConfig(
        provider_id=rec.id,
        name=rec.name,
        issuer=rec.base_url.rstrip("/"),
        client_id=client_id,
        audience=audience,
        scopes=str(extra.get("scopes") or DEFAULT_SCOPES),
        role_claim_path=role_path,
        org_claim_path=str(extra.get("org_claim_path") or DEFAULT_ORG_CLAIM),
        flavor=flavor,
        discovery_url=extra.get("discovery_url") or None,
        updated_at=rec.updated_at,
    )


def identity_config(registry: RegistryStore) -> IdentityConfig | None:
    """The enabled identity provider with the lowest priority, or None."""
    for rec in registry.list_providers(kind="identity"):
        if rec.enabled:
            return identity_config_from_record(rec)
    return None


def effective_auth_mode(env_mode: str, registry: RegistryStore) -> str:
    """Registry setting ``auth_mode`` wins over the environment; anything unknown is ``local``."""
    stored = registry.get_setting("auth_mode")
    mode = str(stored or env_mode or "local").lower()
    return mode if mode in AUTH_MODES else "local"

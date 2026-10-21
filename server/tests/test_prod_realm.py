"""The production realm rendered by deploy/keycloak/render-prod-realm.py."""

from __future__ import annotations

import runpy
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "keycloak" / "render-prod-realm.py"


def test_prod_realm_has_no_users_and_pins_the_domain():
    render = runpy.run_path(str(SCRIPT))["render"]
    realm = render("1.2.3.4.sslip.io")
    assert "users" not in realm
    web = next(c for c in realm["clients"] if c["clientId"] == "acudx-web")
    assert web["publicClient"] is True and web["attributes"]["pkce.code.challenge.method"] == "S256"
    assert web["redirectUris"] == ["https://1.2.3.4.sslip.io/auth/callback"]
    assert web["webOrigins"] == ["https://1.2.3.4.sslip.io"]
    assert {r["name"] for r in realm["roles"]["realm"]} == {
        "student", "resident", "nurse", "paramedic", "faculty", "dean", "admin", "super_admin"}
    assert "length(12)" in realm["passwordPolicy"]


def test_realm_keeps_keycloak_builtin_scopes():
    # Listing clientScopes in an import replaces the built-in profile/email/roles scopes and every
    # sign-in fails with "Invalid scopes: openid profile email" (production smoke, 2026-10-21).
    realm = runpy.run_path(str(SCRIPT))["render"]("x.example")
    assert "clientScopes" not in realm
    web = next(c for c in realm["clients"] if c["clientId"] == "acudx-web")
    assert "defaultClientScopes" not in web
    names = {m["name"] for m in web["protocolMappers"]}
    assert {"acudx-web audience", "acudx org attribute"} <= names

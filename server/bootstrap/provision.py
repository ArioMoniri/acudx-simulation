"""Provision exactly one Keycloak account per AcuDx role with a fresh temporary password.

Run on the server, inside the gateway container, by ``deploy/one-click.sh`` and
``deploy/rotate-bootstrap-code.sh --reset-passwords``::

    printf '%s' "$KC_ADMIN_PASSWORD" | docker compose exec -T server \\
        python -m server.bootstrap.provision --keycloak http://keycloak:8080/idp \\
        --admin-password-stdin --login-url https://<domain>/signin \\
        [--register-idp https://<domain>/idp/realms/acudx]

* usernames are ``acudx-<role>`` (``acudx-super-admin`` for ``super_admin``); each holds exactly
  one realm role (the realm's composites give the higher roles the lower ones);
* passwords are 24 random URL-safe characters, set with ``temporary: true`` so Keycloak adds the
  ``UPDATE_PASSWORD`` required action: the first sign-in sets a new password;
* the Keycloak admin password is read from stdin, never from argv or the environment of the
  gateway process; no password is ever printed or logged;
* the result is written to ``<BOOTSTRAP_DIR>/credentials.json`` with mode 0600, where the
  one-time handoff page (server/bootstrap/routes.py) reads it;
* ``--register-idp`` records the realm as the gateway's identity provider in the registry and
  sets ``auth_mode=oidc``.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import time
from pathlib import Path
from typing import Any

import httpx

from server.auth.roles import ROLES

ROLE_ORDER: tuple[str, ...] = ("student", "resident", "nurse", "paramedic", "faculty", "dean", "admin", "super_admin")
assert set(ROLE_ORDER) == set(ROLES)
PASSWORD_CHARS = 24
ORG = "acudx"
SERVICE_CLIENT_ID = "acudx-provisioner"
SERVICE_CLIENT_FILE = "kc-provisioner.json"


class ProvisionError(RuntimeError):
    """A Keycloak admin call failed (the message never carries a password)."""


def username_for(role: str) -> str:
    return "acudx-" + role.replace("_", "-")


def new_password() -> str:
    """24 URL-safe characters (about 143 bits)."""
    while True:
        pw = secrets.token_urlsafe(18)
        # Keep it unambiguous to copy: no leading dash, at least one digit and one letter.
        if not pw.startswith("-") and any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw):
            return pw


class KeycloakAdmin:
    def __init__(self, base: str, realm: str, client: httpx.Client):
        self.base = base.rstrip("/")
        self.realm = realm
        self.c = client
        self._token = ""

    def login(self, user: str, password: str) -> None:
        r = self.c.post(f"{self.base}/realms/master/protocol/openid-connect/token",
                        data={"grant_type": "password", "client_id": "admin-cli", "username": user,
                              "password": password})
        if r.status_code != 200:
            raise ProvisionError(f"keycloak admin login failed: HTTP {r.status_code}")
        self._token = r.json()["access_token"]

    def login_client(self, client_id: str, secret: str) -> None:
        """Client-credentials login of the realm's own service client (``acudx-provisioner``):
        enough to manage this realm's users, nothing in ``master``."""
        r = self.c.post(f"{self.base}/realms/{self.realm}/protocol/openid-connect/token",
                        data={"grant_type": "client_credentials", "client_id": client_id, "client_secret": secret})
        if r.status_code != 200:
            raise ProvisionError(f"keycloak service client login failed: HTTP {r.status_code}")
        self._token = r.json()["access_token"]

    def ensure_service_client(self, client_id: str = SERVICE_CLIENT_ID) -> dict[str, str]:
        """Confidential client with a service account holding only realm-management
        ``manage-users`` + ``view-users`` + ``view-realm`` in this realm. Returns {client_id, secret}
        (a fresh secret on every call; the caller stores it root-only)."""
        found = self.req("GET", "/clients", params={"clientId": client_id}).json()
        if not found:
            self.req("POST", "/clients", json={
                "clientId": client_id, "name": "AcuDx account provisioner", "enabled": True,
                "publicClient": False, "serviceAccountsEnabled": True, "standardFlowEnabled": False,
                "implicitFlowEnabled": False, "directAccessGrantsEnabled": False,
                "clientAuthenticatorType": "client-secret", "protocol": "openid-connect",
                "description": "Used by the gateway's /bootstrap/operator/reset-accounts (server/bootstrap)."})
            found = self.req("GET", "/clients", params={"clientId": client_id}).json()
        cid = found[0]["id"]
        sa = self.req("GET", f"/clients/{cid}/service-account-user").json()["id"]
        rm = self.req("GET", "/clients", params={"clientId": "realm-management"}).json()[0]["id"]
        want = [self.req("GET", f"/clients/{rm}/roles/{n}").json() for n in ("manage-users", "view-users", "view-realm")]
        have = {r["name"] for r in self.req("GET", f"/users/{sa}/role-mappings/clients/{rm}").json()}
        missing = [r for r in want if r["name"] not in have]
        if missing:
            self.req("POST", f"/users/{sa}/role-mappings/clients/{rm}", json=missing)
        secret = self.req("POST", f"/clients/{cid}/client-secret").json()["value"]
        return {"client_id": client_id, "secret": secret}

    def _h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    def _url(self, path: str) -> str:
        return f"{self.base}/admin/realms/{self.realm}{path}"

    def req(self, method: str, path: str, **kw: Any) -> httpx.Response:
        r = self.c.request(method, self._url(path), headers=self._h(), **kw)
        if r.status_code >= 400:
            # Never echo a request body: it may carry a password.
            raise ProvisionError(f"keycloak {method} {path.split('?')[0]} failed: HTTP {r.status_code}")
        return r

    def allow_admin_attributes(self) -> None:
        """Keep the ``org`` attribute (Keycloak 24+ drops unmanaged attributes by default)."""
        prof = self.req("GET", "/users/profile").json()
        if prof.get("unmanagedAttributePolicy") not in ("ADMIN_EDIT", "ADMIN_VIEW", "ENABLED"):
            prof["unmanagedAttributePolicy"] = "ADMIN_EDIT"
            self.req("PUT", "/users/profile", json=prof)

    def drop_default_acudx_roles(self) -> None:
        """No AcuDx role in the realm's default roles: each account holds exactly the one role it
        was given (a default ``student`` made every nurse and paramedic a student first)."""
        name = f"default-roles-{self.realm}"
        comps = self.req("GET", f"/roles/{name}/composites").json()
        stray = [r for r in comps if r.get("name") in ROLE_ORDER]
        if stray:
            self.req("DELETE", f"/roles/{name}/composites", json=stray)

    def ensure_user(self, role: str) -> str:
        uname = username_for(role)
        rep = {"username": uname, "enabled": True, "email": f"{uname}@accounts.acudx.invalid",
               "emailVerified": True, "firstName": "AcuDx", "lastName": role.replace("_", " ").title(),
               "attributes": {"org": [ORG]}}
        found = self.req("GET", "/users", params={"username": uname, "exact": "true"}).json()
        if found:
            uid = found[0]["id"]
            self.req("PUT", f"/users/{uid}", json=rep)
        else:
            r = self.req("POST", "/users", json=rep)
            uid = r.headers.get("location", "").rstrip("/").rsplit("/", 1)[-1]
            if not uid:
                uid = self.req("GET", "/users", params={"username": uname, "exact": "true"}).json()[0]["id"]
        role_rep = self.req("GET", f"/roles/{role}").json()
        current = {r["name"] for r in self.req("GET", f"/users/{uid}/role-mappings/realm").json()}
        stray = [self.req("GET", f"/roles/{r}").json() for r in current if r in ROLE_ORDER and r != role]
        if stray:
            self.req("DELETE", f"/users/{uid}/role-mappings/realm", json=stray)
        if role not in current:
            self.req("POST", f"/users/{uid}/role-mappings/realm", json=[role_rep])
        return uid

    def sync_web_client(self, origin: str, client_id: str = "acudx-web") -> None:
        """Point the public PKCE client at ``origin`` (a realm imported for an older domain is not
        re-imported, so a domain change has to be applied through the admin API)."""
        found = self.req("GET", "/clients", params={"clientId": client_id}).json()
        if not found:
            raise ProvisionError(f"keycloak client {client_id} not found in realm {self.realm}")
        rep = found[0]
        origin = origin.rstrip("/")
        rep["rootUrl"] = origin
        rep["redirectUris"] = [f"{origin}/auth/callback"]
        rep["webOrigins"] = [origin]
        rep.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{origin}/*"
        self.req("PUT", f"/clients/{rep['id']}", json=rep)

    def set_temporary_password(self, uid: str, password: str) -> None:
        self.req("PUT", f"/users/{uid}/reset-password", json={"type": "password", "value": password,
                                                               "temporary": True})
        self.req("POST", f"/users/{uid}/logout")


def write_credentials(directory: Path, payload: dict[str, Any]) -> Path:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    path = directory / "credentials.json"
    tmp = directory / "credentials.json.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return path


def provision(kc: KeycloakAdmin, *, login_url: str, realm_admin: bool = True) -> dict[str, Any]:
    """One account per role with a fresh temporary password. ``realm_admin=False`` (the service
    client of /bootstrap/operator/reset-accounts) skips the realm-level fixes it may not make."""
    if realm_admin:
        kc.allow_admin_attributes()
        kc.drop_default_acudx_roles()
    users = []
    for role in ROLE_ORDER:
        uid = kc.ensure_user(role)
        # temporary=True makes Keycloak attach the UPDATE_PASSWORD required action.
        pw = new_password()
        kc.set_temporary_password(uid, pw)
        users.append({"username": username_for(role), "role": role, "password": pw})
    return {"realm": kc.realm, "login_url": login_url, "created_at": time.time(), "users": users}


def write_private_json(directory: Path, name: str, payload: dict[str, Any]) -> Path:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / name
    tmp = directory / (name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)
    return path


def register_idp(issuer: str) -> None:
    from server.config import get_settings  # noqa: PLC0415
    from server.registry.store import ProviderIn, RegistryStore  # noqa: PLC0415

    s = get_settings()
    reg = RegistryStore(s.acudx_db_path, secret_key=s.acudx_secret_key)
    extra = {"client_id": "acudx-web", "flavor": "keycloak", "role_claim_path": "realm_access.roles",
             "org_claim_path": "org", "audience": "acudx-web"}
    existing = [r for r in reg.list_providers(kind="identity") if r.name == "keycloak"]
    if existing:
        reg.update_provider(existing[0].id, {"base_url": issuer, "extra": extra, "enabled": True})
    else:
        reg.create_provider(ProviderIn(kind="identity", name="keycloak", base_url=issuer, priority=0, extra=extra))
    reg.set_setting("auth_mode", "oidc")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Provision one Keycloak account per AcuDx role")
    p.add_argument("--keycloak", required=True, help="Keycloak base URL incl. relative path, e.g. http://keycloak:8080/idp")
    p.add_argument("--realm", default="acudx")
    p.add_argument("--admin-user", default="admin")
    p.add_argument("--admin-password-stdin", action="store_true", required=True)
    p.add_argument("--bootstrap-dir", default=os.environ.get("BOOTSTRAP_DIR") or "/run/acudx-bootstrap")
    p.add_argument("--login-url", default=None)
    p.add_argument("--register-idp", default=None, help="issuer URL to register as the gateway identity provider")
    p.add_argument("--wait-s", type=float, default=300.0, help="wait this long for Keycloak to answer")
    p.add_argument("--sync-client-origin", default=None,
                   help="also point the acudx-web client at this origin (https://<domain>)")
    p.add_argument("--no-accounts", action="store_true",
                   help="skip the accounts (only sync the client / register the identity provider)")
    a = p.parse_args(argv)
    admin_pw = sys.stdin.read().strip()
    if not admin_pw:
        print("empty Keycloak admin password on stdin", file=sys.stderr)
        return 2
    with httpx.Client(timeout=30.0, trust_env=False) as client:
        deadline = time.time() + a.wait_s
        while True:
            try:
                if client.get(f"{a.keycloak.rstrip('/')}/realms/{a.realm}").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.time() > deadline:
                print(f"keycloak realm {a.realm} not reachable at {a.keycloak}", file=sys.stderr)
                return 3
            time.sleep(3)
        kc = KeycloakAdmin(a.keycloak, a.realm, client)
        try:
            kc.login(a.admin_user, admin_pw)
        except ProvisionError as exc:
            print(str(exc), file=sys.stderr)
            return 4
        kc.drop_default_acudx_roles()
        # The realm's own service client lets the gateway reset the accounts over HTTPS
        # (/bootstrap/operator/reset-accounts) without ever holding the master admin password.
        write_private_json(Path(a.bootstrap_dir), SERVICE_CLIENT_FILE, kc.ensure_service_client())
        if a.sync_client_origin:
            kc.sync_web_client(a.sync_client_origin)
            print(f"acudx-web client points at {a.sync_client_origin}")
        payload = None
        if not a.no_accounts:
            if not a.login_url:
                print("--login-url is required unless --no-accounts", file=sys.stderr)
                return 2
            payload = provision(kc, login_url=a.login_url)
    if payload is not None:
        path = write_credentials(Path(a.bootstrap_dir), payload)
        print(f"provisioned {len(payload['users'])} accounts ({', '.join(u['username'] for u in payload['users'])}); "
              f"temporary passwords written to {path} (0600)")
    if a.register_idp:
        register_idp(a.register_idp)
        print(f"identity provider registered: {a.register_idp} (auth_mode=oidc)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

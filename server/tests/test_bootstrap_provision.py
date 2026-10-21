"""Account provisioning against an in-process Keycloak admin API double."""

from __future__ import annotations

import json
import os
import stat
import uuid

import httpx

from server.bootstrap.provision import KeycloakAdmin, ROLE_ORDER, provision, username_for, write_credentials


class KeycloakDouble:
    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.roles: dict[str, set[str]] = {}
        self.passwords: dict[str, dict] = {}
        self.profile: dict = {"attributes": []}
        self.calls: list[tuple[str, str, bytes]] = []
        self.default_roles: set[str] = {"student", "offline_access", "uma_authorization"}
        self.client: dict = {"id": "c1", "clientId": "acudx-web", "redirectUris": ["https://old.example/auth/callback"],
                             "attributes": {"pkce.code.challenge.method": "S256"}}

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append((req.method, req.url.path, req.content))
        p = req.url.path
        if p.endswith("/protocol/openid-connect/token"):
            return httpx.Response(200, json={"access_token": "adm"})
        assert req.headers.get("authorization") == "Bearer adm"
        base = "/idp/admin/realms/acudx"
        sub = p[len(base):]
        if sub == "/clients" and req.method == "GET":
            return httpx.Response(200, json=[self.client])
        if sub.startswith("/clients/") and req.method == "PUT":
            self.client = json.loads(req.content)
            return httpx.Response(204)
        if sub == "/users/profile":
            if req.method == "PUT":
                self.profile = json.loads(req.content)
            return httpx.Response(200, json=self.profile)
        if sub == "/users" and req.method == "GET":
            name = req.url.params["username"]
            return httpx.Response(200, json=[u for u in self.users.values() if u["username"] == name])
        if sub == "/users" and req.method == "POST":
            uid = str(uuid.uuid4())
            self.users[uid] = {**json.loads(req.content), "id": uid}
            self.roles[uid] = {"default-roles-acudx"}
            return httpx.Response(201, headers={"location": f"http://kc{base}/users/{uid}"})
        if sub == "/roles/default-roles-acudx/composites":
            if req.method == "GET":
                return httpx.Response(200, json=[{"name": n} for n in sorted(self.default_roles)])
            self.default_roles -= {r["name"] for r in json.loads(req.content)}
            return httpx.Response(204)
        if sub.startswith("/roles/"):
            return httpx.Response(200, json={"name": sub.split("/")[-1], "id": sub})
        parts = sub.strip("/").split("/")
        uid = parts[1]
        if len(parts) == 2 and req.method == "PUT":
            self.users[uid].update(json.loads(req.content))
            return httpx.Response(204)
        if parts[2:] == ["role-mappings", "realm"]:
            if req.method == "GET":
                return httpx.Response(200, json=[{"name": r} for r in self.roles[uid]])
            names = {r["name"] for r in json.loads(req.content)}
            if req.method == "POST":
                self.roles[uid] |= names
            else:
                self.roles[uid] -= names
            return httpx.Response(204)
        if parts[2:] == ["reset-password"]:
            self.passwords[uid] = json.loads(req.content)
            return httpx.Response(204)
        if parts[2:] == ["logout"]:
            return httpx.Response(204)
        return httpx.Response(404)


def _kc(double: KeycloakDouble) -> KeycloakAdmin:
    kc = KeycloakAdmin("http://kc/idp", "acudx", httpx.Client(transport=httpx.MockTransport(double)))
    kc.login("admin", "pw")
    return kc


def test_one_user_per_role_with_temporary_random_passwords(tmp_path):
    kc_double = KeycloakDouble()
    out = provision(_kc(kc_double), login_url="https://h.example/signin")
    assert [u["role"] for u in out["users"]] == list(ROLE_ORDER)
    assert [u["username"] for u in out["users"]] == [
        "acudx-student", "acudx-resident", "acudx-nurse", "acudx-paramedic", "acudx-faculty",
        "acudx-dean", "acudx-admin", "acudx-super-admin"]
    assert all("demo" not in u["username"] for u in out["users"])
    pws = [u["password"] for u in out["users"]]
    assert len(set(pws)) == 8 and all(len(p) >= 20 for p in pws)
    assert len(kc_double.users) == 8
    for uid, user in kc_double.users.items():
        role = next(r for r in ROLE_ORDER if username_for(r) == user["username"])
        assert kc_double.roles[uid] & set(ROLE_ORDER) == {role}  # exactly one AcuDx role
        assert kc_double.passwords[uid]["temporary"] is True
    assert kc_double.profile["unmanagedAttributePolicy"] == "ADMIN_EDIT"
    assert kc_double.default_roles == {"offline_access", "uma_authorization"}  # no default AcuDx role


def test_rerun_is_idempotent_and_rotates_passwords(tmp_path):
    kc_double = KeycloakDouble()
    first = provision(_kc(kc_double), login_url="x")
    second = provision(_kc(kc_double), login_url="x")
    assert len(kc_double.users) == 8
    assert {u["password"] for u in first["users"]}.isdisjoint({u["password"] for u in second["users"]})


def test_credentials_file_is_root_only(tmp_path):
    path = write_credentials(tmp_path / "b", {"users": []})
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(tmp_path / "b").st_mode) == 0o700


def test_sync_web_client_follows_a_domain_change():
    kc_double = KeycloakDouble()
    _kc(kc_double).sync_web_client("https://1.2.3.4.sslip.io/")
    c = kc_double.client
    assert c["redirectUris"] == ["https://1.2.3.4.sslip.io/auth/callback"]
    assert c["webOrigins"] == ["https://1.2.3.4.sslip.io"]
    assert c["attributes"]["post.logout.redirect.uris"] == "https://1.2.3.4.sslip.io/*"
    assert c["attributes"]["pkce.code.challenge.method"] == "S256"

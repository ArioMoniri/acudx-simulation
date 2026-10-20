"""Route guards: 401/403 per role, local mode header and header principals, admin
bearer vs X-Admin-Token, /v1/auth/config and the user_roles admin surface."""

from __future__ import annotations

import pytest

from server.tests.auth_harness import ADMIN_HDR, CLIENT_ID, ISSUER, KeyPair, build_app, client_for, sample_batch


@pytest.fixture(scope="module")
def keys() -> KeyPair:
    return KeyPair()


# --------------------------------------------------------------------------- #
# oidc mode                                                                   #
# --------------------------------------------------------------------------- #
def test_config_is_public_and_describes_the_idp(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    r = client_for(app).get("/v1/auth/config")
    assert r.status_code == 200 and r.headers["x-auth-mode"] == "oidc"
    body = r.json()
    assert body["mode"] == "oidc" and body["configured"] is True
    assert body["provider"]["client_id"] == CLIENT_ID and body["provider"]["issuer"] == ISSUER
    assert body["provider"]["role_claim_path"] == "realm_access.roles"
    assert body["discovery"]["token_endpoint"].endswith("/token")
    assert "secret" not in r.text.lower()
    assert body["roles"][-1] == "super_admin" and body["precedence"]["dean"] > body["precedence"]["faculty"]


def test_unauthenticated_is_401_in_oidc_mode(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    c = client_for(app)
    assert c.get("/v1/auth/me").status_code == 401
    assert c.post("/v1/events/encounter", json=sample_batch()).status_code == 401
    assert c.get("/v1/dean/cohort").status_code == 401
    # local-profile headers do not count in oidc mode
    assert client_for(app, **{"X-User-Id": "someone", "X-User-Role": "dean"}).get("/v1/dean/cohort").status_code == 401


def test_bad_tokens_are_401_with_reason(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    r = client_for(app, token=keys.mint(exp_in=-60)).get("/v1/auth/me")
    assert r.status_code == 401 and r.json()["detail"]["reason"] == "expired"
    r = client_for(app, token=KeyPair().mint()).get("/v1/auth/me")
    assert r.status_code == 401 and r.json()["detail"]["reason"] == "invalid_signature"


def test_me_maps_claims_to_principal(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    r = client_for(app, token=keys.mint(sub="s-1", roles=["faculty", "offline_access", "uma_authorization"])).get("/v1/auth/me")
    assert r.status_code == 200
    me = r.json()
    assert me == {"sub": "s-1", "email": "person@example.edu", "name": "Dr Person", "roles": ["faculty"],
                  "org": "acme-med", "verified": True, "mode": "oidc", "primary_role": "faculty"}


def test_role_guards_follow_precedence(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    student = client_for(app, token=keys.mint(sub="st", roles=["student"]))
    faculty = client_for(app, token=keys.mint(sub="fa", roles=["faculty"]))
    dean = client_for(app, token=keys.mint(sub="de", roles=["dean"]))
    admin = client_for(app, token=keys.mint(sub="ad", roles=["admin"]))
    # learner route: anyone authenticated
    assert student.post("/v1/events/encounter", json=sample_batch()).status_code == 201
    # faculty routes
    assert student.get("/v1/faculty/queue").status_code == 403
    assert faculty.get("/v1/faculty/queue").status_code == 200
    assert dean.get("/v1/faculty/queue").status_code == 200
    # dean routes
    assert faculty.get("/v1/dean/cohort").status_code == 403
    assert dean.get("/v1/dean/cohort").status_code == 200
    assert admin.get("/v1/dean/cohort").status_code == 200
    # cross-org read only for admins
    assert dean.get("/v1/dean/cohort", params={"org": "other"}).status_code == 403
    assert admin.get("/v1/dean/cohort", params={"org": "other"}).status_code == 200
    detail = student.get("/v1/faculty/queue").json()["detail"]
    assert detail["required"] == "faculty" and detail["roles"] == ["student"]


def test_no_roles_claim_defaults_to_student(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    me = client_for(app, token=keys.mint(sub="plain", roles=None)).get("/v1/auth/me").json()
    assert me["roles"] == ["student"] and me["primary_role"] == "student"


def test_user_roles_table_is_unioned_with_claims(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    admin = client_for(app, **ADMIN_HDR)
    r = admin.put("/admin/users/plain/roles", json={"roles": ["dean", "bogus"], "org": "acme-med"})
    assert r.status_code == 200 and r.json()["roles"] == ["dean"]
    me = client_for(app, token=keys.mint(sub="plain", roles=["student"])).get("/v1/auth/me").json()
    assert me["roles"] == ["dean", "student"] and me["primary_role"] == "dean"
    assert client_for(app, token=keys.mint(sub="plain", roles=["student"])).get("/v1/dean/cohort").status_code == 200
    users = admin.get("/admin/users", params={"org": "acme-med"}).json()["users"]
    plain = next(u for u in users if u["sub"] == "plain")
    assert plain["email"] == "person@example.edu" and plain["name"] == "Dr Person" and plain["last_seen_at"]
    assert admin.put("/admin/users/x/roles", json={"roles": ["nothing"]}).status_code == 422
    assert admin.delete("/admin/users/plain").status_code == 204
    assert admin.delete("/admin/users/plain").status_code == 404


def test_admin_routes_accept_admin_bearer_or_bootstrap_token(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys)
    assert client_for(app).get("/admin/providers").status_code == 401
    assert client_for(app, **ADMIN_HDR).get("/admin/providers").status_code == 200
    assert client_for(app, token=keys.mint(sub="ad", roles=["admin"])).get("/admin/providers").status_code == 200
    assert client_for(app, token=keys.mint(sub="sa", roles=["super-admin"])).get("/admin/providers").status_code == 200
    assert client_for(app, token=keys.mint(sub="de", roles=["dean"])).get("/admin/providers").status_code == 401
    assert client_for(app, token=keys.mint(sub="ad", roles=["admin"], exp_in=-120)).get("/admin/providers").status_code == 401
    # no bootstrap token but an IdP: the surface stays available to admin bearers
    app2, _ = build_app(tmp_path / "b", keys=keys, admin_token=None)
    assert client_for(app2, **ADMIN_HDR).get("/admin/providers").status_code == 401
    assert client_for(app2, token=keys.mint(sub="ad", roles=["admin"])).get("/admin/providers").status_code == 200
    # neither configured: 503 as before
    app3, _ = build_app(tmp_path / "c", with_idp=False, admin_token=None, auth_mode="local")
    assert client_for(app3, **ADMIN_HDR).get("/admin/providers").status_code == 503


def test_oidc_mode_without_idp_is_503(tmp_path):
    app, _ = build_app(tmp_path, with_idp=False, auth_mode="oidc")
    r = client_for(app, **{"X-User-Id": "x"}).get("/v1/auth/me")
    assert r.status_code == 503 and r.json()["detail"]["reason"] == "identity_not_configured"
    assert client_for(app).get("/v1/auth/config").json() == {
        **client_for(app).get("/v1/auth/config").json(), "mode": "oidc", "configured": False, "provider": None}


# --------------------------------------------------------------------------- #
# local mode                                                                  #
# --------------------------------------------------------------------------- #
def test_local_mode_marks_every_response_and_accepts_header_profiles(tmp_path):
    app, _ = build_app(tmp_path, with_idp=False, auth_mode="local")
    anon = client_for(app)
    r = anon.get("/v1/auth/config")
    assert r.headers["x-auth-mode"] == "local" and r.json()["mode"] == "local" and r.json()["configured"] is False
    assert anon.get("/v1/auth/me").status_code == 401
    assert anon.get("/v1/auth/me").headers["x-auth-mode"] == "local"
    dean_hdr = {"X-User-Id": "local-1", "X-User-Role": "dean", "X-User-Name": "Local Dean", "X-Tenant": "demo-org"}
    local = client_for(app, **dean_hdr, **ADMIN_HDR)
    me = local.get("/v1/auth/me")
    assert me.status_code == 200 and me.headers["x-auth-mode"] == "local"
    assert me.json()["verified"] is False and me.json()["roles"] == ["dean"] and me.json()["org"] == "demo-org"
    assert local.get("/v1/dean/cohort").status_code == 200
    assert local.get("/v1/dean/cohort").json()["verified_identity"] is False
    # without the admin token the same headers are capped at resident (review 04 O2)
    capped = client_for(app, **dean_hdr).get("/v1/auth/me").json()
    assert capped["roles"] == ["resident"] and capped["role_capped_from"] == "dean"
    # an unknown self-declared role falls back to student; a bearer with no IdP is refused
    weird = client_for(app, **{"X-User-Id": "l2", "X-User-Role": "chancellor"})
    assert weird.get("/v1/auth/me").json()["roles"] == ["student"]
    assert client_for(app, token="abc.def.ghi").get("/v1/auth/me").status_code == 401


def test_local_mode_still_verifies_a_bearer_when_an_idp_exists(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys, auth_mode="local")
    verified = client_for(app, token=keys.mint(sub="v", roles=["faculty"])).get("/v1/auth/me")
    assert verified.status_code == 200 and verified.json()["verified"] is True and verified.headers["x-auth-mode"] == "local"
    assert client_for(app, token=keys.mint(sub="v", roles=["faculty"], exp_in=-120)).get("/v1/auth/me").status_code == 401


def test_registry_setting_overrides_env_mode(tmp_path, keys):
    app, parts = build_app(tmp_path, keys=keys, auth_mode="local")
    assert client_for(app).get("/v1/auth/config").json()["mode"] == "local"
    parts["registry"].set_setting("auth_mode", "oidc")
    r = client_for(app).get("/v1/auth/config")
    assert r.json()["mode"] == "oidc" and r.headers["x-auth-mode"] == "oidc"
    assert client_for(app, **{"X-User-Id": "l"}).get("/v1/auth/me").status_code == 401
    parts["registry"].set_setting("auth_mode", "banana")
    assert client_for(app).get("/v1/auth/config").json()["mode"] == "local"


# --------------------------------------------------------------------------- #
# review 04 O2: local-mode header principals fail closed at resident          #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("role", ["faculty", "dean", "admin", "super_admin"])
def test_local_header_principals_above_resident_need_the_admin_token(tmp_path, role):
    app, _ = build_app(tmp_path, with_idp=False, auth_mode="local")
    hdr = {"X-User-Id": "peer-1", "X-User-Role": role}
    spoofed = client_for(app, **hdr)
    me = spoofed.get("/v1/auth/me").json()
    assert me["roles"] == ["resident"] and me["role_capped_from"] == role and me["verified"] is False
    assert spoofed.get("/v1/dean/cohort").status_code == 403
    assert spoofed.get("/v1/faculty/queue").status_code == 403
    wrong = client_for(app, **hdr, **{"X-Admin-Token": "not-the-token"})
    assert wrong.get("/v1/faculty/queue").status_code == 403
    seeded = client_for(app, **hdr, **ADMIN_HDR)
    assert seeded.get("/v1/auth/me").json()["roles"] == [role]
    assert seeded.get("/v1/faculty/queue").status_code == 200


def test_local_header_learner_roles_are_unchanged_and_no_admin_token_means_no_escalation(tmp_path):
    app, _ = build_app(tmp_path, with_idp=False, auth_mode="local", admin_token=None)
    for role in ("student", "nurse", "paramedic", "resident"):
        me = client_for(app, **{"X-User-Id": "l", "X-User-Role": role}).get("/v1/auth/me").json()
        assert me["roles"] == [role] and "role_capped_from" not in me
    # ADMIN_TOKEN unset: an X-Admin-Token header can never lift the cap.
    me = client_for(app, **{"X-User-Id": "l", "X-User-Role": "dean", "X-Admin-Token": ""}).get("/v1/auth/me").json()
    assert me["roles"] == ["resident"]


def test_local_mode_verified_bearer_keeps_its_faculty_role(tmp_path, keys):
    app, _ = build_app(tmp_path, keys=keys, auth_mode="local")
    c = client_for(app, token=keys.mint(sub="f", roles=["faculty"]))
    assert c.get("/v1/auth/me").json()["roles"] == ["faculty"]
    assert c.get("/v1/faculty/queue").status_code == 200

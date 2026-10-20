"""Role precedence and claim -> role mapping (server/auth/roles.py)."""

from __future__ import annotations

from server.auth.roles import PRECEDENCE, ROLES, at_least, claim_at_path, normalize_roles, primary_role, roles_from_claims


def test_precedence_is_documented_and_total():
    assert set(ROLES) == set(PRECEDENCE)
    assert PRECEDENCE["super_admin"] > PRECEDENCE["admin"] > PRECEDENCE["dean"] > PRECEDENCE["faculty"]
    assert PRECEDENCE["faculty"] > PRECEDENCE["resident"] > PRECEDENCE["student"]
    assert PRECEDENCE["student"] == PRECEDENCE["nurse"] == PRECEDENCE["paramedic"]


def test_normalize_roles_maps_aliases_dedupes_and_orders_by_precedence():
    assert normalize_roles(["student", "Educator", "super-admin", "student", "nonsense", 42]) == [
        "super_admin", "faculty", "student"]
    assert normalize_roles([]) == []


def test_primary_role_defaults_to_student():
    assert primary_role([]) == "student"
    assert primary_role(["nurse", "dean"]) == "dean"
    assert primary_role(["paramedic"]) == "paramedic"


def test_at_least_follows_precedence():
    assert at_least(["dean"], "faculty")
    assert at_least(["admin"], "dean")
    assert at_least(["super_admin"], "admin")
    assert not at_least(["faculty"], "dean")
    assert not at_least(["resident"], "faculty")
    assert at_least(["nurse"], "student")


def test_claim_path_walks_nested_objects():
    claims = {"realm_access": {"roles": ["faculty", "offline_access"]}, "app_metadata": {"roles": "dean student"}}
    assert claim_at_path(claims, "realm_access.roles") == ["faculty", "offline_access"]
    assert claim_at_path(claims, "missing.path") is None
    assert claim_at_path(claims, None) is None
    assert roles_from_claims(claims, "realm_access.roles") == ["faculty"]
    assert roles_from_claims(claims, "app_metadata.roles") == ["dean", "student"]
    assert roles_from_claims({"roles": {"admin": True, "dean": False}}, "roles") == ["admin"]
    assert roles_from_claims({}, "roles") == []

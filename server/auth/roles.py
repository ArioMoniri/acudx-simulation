"""AcuDx roles, their precedence, and the claim -> role mapping.

Precedence (highest first)::

    super_admin > admin > dean > faculty > resident > nurse = paramedic = student

``student``, ``nurse`` and ``paramedic`` are learner tracks at the same level;
``resident`` is a learner with advanced cases; ``faculty`` authors and reviews;
``dean`` sees org-wide analytics; ``admin`` manages the org; ``super_admin`` is
platform-wide. A route guard that asks for ``dean`` admits every role at or above
dean (dean, admin, super_admin). ``primary_role`` is the highest role a principal
holds; it is what the web client shows and gates on.
"""

from __future__ import annotations

from typing import Any, Iterable

ROLES: tuple[str, ...] = ("student", "nurse", "paramedic", "resident", "faculty", "dean", "admin", "super_admin")

PRECEDENCE: dict[str, int] = {
    "student": 10,
    "nurse": 10,
    "paramedic": 10,
    "resident": 20,
    "faculty": 30,
    "dean": 40,
    "admin": 50,
    "super_admin": 60,
}

# Spellings seen in IdP tokens (Keycloak realm roles, Supabase app_metadata,
# legacy AcuDx profiles) mapped onto the canonical role names.
_ALIASES: dict[str, str] = {
    "super-admin": "super_admin",
    "superadmin": "super_admin",
    "platform_admin": "super_admin",
    "educator": "faculty",
    "teacher": "faculty",
    "academician": "faculty",
    "administrator": "admin",
    "learner": "student",
    "medical_student": "student",
}

DEFAULT_ROLE = "student"


def normalize_role(value: Any) -> str | None:
    """Canonical role name for a raw claim value, or None when it is not an AcuDx role."""
    if not isinstance(value, str):
        return None
    v = value.strip().lower().replace(" ", "_")
    v = _ALIASES.get(v, v)
    return v if v in PRECEDENCE else None


def normalize_roles(values: Iterable[Any]) -> list[str]:
    """Canonical, de-duplicated roles ordered by descending precedence."""
    seen: dict[str, None] = {}
    for v in values:
        r = normalize_role(v)
        if r is not None:
            seen.setdefault(r, None)
    return sorted(seen, key=lambda r: (-PRECEDENCE[r], ROLES.index(r)))


def primary_role(roles: Iterable[str]) -> str:
    """The highest-precedence role, or ``student`` when none is held."""
    ordered = normalize_roles(roles)
    return ordered[0] if ordered else DEFAULT_ROLE


def at_least(roles: Iterable[str], minimum: str) -> bool:
    """True when any held role has precedence >= ``minimum``'s."""
    need = PRECEDENCE[minimum]
    return any(PRECEDENCE.get(r, -1) >= need for r in normalize_roles(roles))


def claim_at_path(claims: dict[str, Any], path: str | None) -> Any:
    """Walk a dotted path (``realm_access.roles``) through the claims; None when absent."""
    if not path:
        return None
    node: Any = claims
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def roles_from_claims(claims: dict[str, Any], path: str | None) -> list[str]:
    """Roles found at ``path`` (a list, a space/comma separated string, or a dict of flags)."""
    raw = claim_at_path(claims, path)
    if raw is None:
        return []
    if isinstance(raw, str):
        return normalize_roles(p for p in raw.replace(",", " ").split())
    if isinstance(raw, dict):
        return normalize_roles(k for k, v in raw.items() if v)
    if isinstance(raw, (list, tuple, set)):
        return normalize_roles(raw)
    return []

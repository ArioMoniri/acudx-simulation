"""Every privileged HTTP path on the real gateway app carries its guard dependency.

The app in server/app.py is enumerated (routers included via include_router are
walked recursively), and each route whose path falls under a privileged prefix
must declare, directly or through its router, one of the guard dependencies:

* ``/admin/*``                 require_admin (bootstrap token or admin bearer) or the
                               guideline verifier's require_guidelines_admin (same contract)
* ``/v1/dean/*``               require_role("dean")
* ``/v1/faculty/*``            require_role("faculty")
* ``/v1/voice/room``           current_user (a room token is a credential)
* ``/v1/events/encounter``     current_user
* ``/v1/me/*``                 current_user

A new privileged route that forgets its guard fails this test instead of shipping.
"""

from __future__ import annotations

import inspect
from typing import Any, Iterator

import pytest
from fastapi.routing import APIRoute

from server.app import app

PRIVILEGED: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/admin/", ("require_admin", "require_guidelines_admin")),
    ("/v1/dean/", ("require_role:dean",)),
    ("/v1/faculty/", ("require_role:faculty",)),
    ("/v1/voice/room", ("current_user",)),
    ("/v1/events/encounter", ("current_user",)),
    ("/v1/me/", ("current_user",)),
)


def _api_routes(routes: list[Any]) -> Iterator[APIRoute]:
    """Walk app.routes recursively. FastAPI >= 0.150 mounts an included router lazily as an
    ``_IncludedRouter`` wrapper whose routes live on ``original_router``."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield r
        inner = getattr(r, "routes", None)
        if inner is None:
            inner = getattr(getattr(r, "original_router", None), "routes", None)
        if inner:
            yield from _api_routes(list(inner))


def _guard_names(route: APIRoute) -> set[str]:
    """Names of every dependency callable on the route, including a nested require_role."""
    names: set[str] = set()

    def walk(dependant: Any) -> None:
        for d in dependant.dependencies:
            call = d.call
            name = getattr(call, "__name__", "")
            if name == "_guard":
                # require_role(minimum) returns a closure named _guard; recover the minimum.
                minimum = inspect.getclosurevars(call).nonlocals.get("minimum")
                names.add(f"require_role:{minimum}")
            elif name:
                names.add(name)
            walk(d)

    walk(route.dependant)
    return names


ROUTES = list(_api_routes(list(app.routes)))


def _privileged() -> list[tuple[APIRoute, tuple[str, ...]]]:
    out = []
    for r in ROUTES:
        for prefix, guards in PRIVILEGED:
            if r.path == prefix.rstrip("/") or r.path.startswith(prefix):
                out.append((r, guards))
                break
    return out


def test_app_mounts_every_privileged_surface():
    paths = {r.path for r in ROUTES}
    for must in ("/admin/gpu/status", "/admin/providers", "/admin/users", "/admin/guidelines/verify",
                 "/admin/voice/agent-config", "/v1/dean/cohort", "/v1/faculty/queue", "/v1/voice/room"):
        assert must in paths, f"{must} is no longer mounted"


@pytest.mark.parametrize("route,guards", _privileged(), ids=lambda x: x.path if isinstance(x, APIRoute) else "")
def test_privileged_route_declares_its_guard(route: APIRoute, guards: tuple[str, ...]):
    names = _guard_names(route)
    assert names & set(guards), f"{sorted(route.methods)} {route.path} has guards {sorted(names)}; needs one of {guards}"


def test_role_guards_admit_higher_roles_only():
    from server.auth.roles import at_least

    assert at_least(["admin"], "dean") and at_least(["super_admin"], "faculty")
    assert not at_least(["faculty"], "dean") and not at_least(["student"], "faculty")

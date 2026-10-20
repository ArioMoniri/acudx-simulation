"""Identity routes.

GET  /v1/auth/config              public: mode, provider (client id, scopes, claim paths), discovery endpoints
GET  /v1/auth/me                  the verified principal (401 when anonymous)
GET  /admin/users[?org=]          user_roles directory (admin token or admin bearer)
PUT  /admin/users/{sub}/roles     {roles: [...], org?} server-side grant (unioned with claim roles)
DELETE /admin/users/{sub}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from server.admin_routes import require_admin
from server.auth.deps import AuthService, Principal, current_user
from server.auth.roles import PRECEDENCE, ROLES, normalize_roles

router = APIRouter(prefix="/v1/auth", tags=["auth"])
admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _svc(request: Request) -> AuthService:
    svc = getattr(request.app.state, "auth", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="auth service not initialised")
    return svc


@router.get("/config")
async def auth_config(request: Request) -> dict[str, Any]:
    out = await _svc(request).public_config()
    out["roles"] = list(ROLES)
    out["precedence"] = PRECEDENCE
    return out


@router.get("/me")
async def me(user: Principal = Depends(current_user)) -> dict[str, Any]:
    return user.public()


class RolesBody(BaseModel):
    roles: list[str] = Field(default_factory=list)
    org: str | None = None


@admin_router.get("/users")
async def list_users(request: Request, org: str | None = None) -> dict[str, Any]:
    return {"users": _svc(request).users.list(org=org), "roles": list(ROLES)}


@admin_router.put("/users/{sub}/roles")
async def put_roles(request: Request, sub: str, body: RolesBody) -> dict[str, Any]:
    clean = normalize_roles(body.roles)
    unknown = [r for r in body.roles if r not in ROLES and r.lower() not in ROLES]
    if unknown and not clean and body.roles:
        raise HTTPException(status_code=422, detail={"reason": "unknown_roles", "roles": unknown})
    granted_by = request.headers.get("x-user-id") or ("admin-token" if request.headers.get("x-admin-token") else None)
    return _svc(request).users.set_roles(sub, clean, org=body.org, granted_by=granted_by)


@admin_router.delete("/users/{sub}", status_code=204, response_class=Response)
async def delete_user(request: Request, sub: str) -> Response:
    if not _svc(request).users.delete(sub):
        raise HTTPException(status_code=404, detail="user not found")
    return Response(status_code=204)

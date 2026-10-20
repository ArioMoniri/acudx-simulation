"""Shared harness for the identity tests: a local RSA key pair, a JWKS built from it,
a token minter, and a FastAPI app wired like server/app.py (auth + learning routers,
registry-backed identity provider, X-Auth-Mode middleware)."""

from __future__ import annotations

import time
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from server.admin_routes import router as gpu_router
from server.auth.config import identity_config
from server.auth.deps import AuthService
from server.auth.jwks import Discovery, OidcVerifier
from server.auth.routes import admin_router as auth_admin_router
from server.auth.routes import router as auth_router
from server.auth.store import UserRoleStore
from server.config import Settings
from server.learning.routes import router as learning_router
from server.learning.store import LearningStore
from server.providers.gpu_worker import WorkerManager, WorkerStore
from server.registry.routes import router as registry_router
from server.registry.store import ProviderIn, RegistryStore
from server.telemetry.events import TelemetryRecorder
from server.tests.conftest import CLOUD_INIT

ISSUER = "https://idp.example.edu/realms/acudx"
CLIENT_ID = "acudx-web"
ADMIN_TOKEN = "adm-secret"
ADMIN_HDR = {"X-Admin-Token": ADMIN_TOKEN}


class KeyPair:
    def __init__(self, kid: str = "k1"):
        self.kid = kid
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.public_pem = self.private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.private_pem = self.private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())

    def jwk(self) -> dict[str, Any]:
        d = jwt.algorithms.RSAAlgorithm.to_jwk(self.private.public_key(), as_dict=True)
        d.update({"kid": self.kid, "alg": "RS256", "use": "sig"})
        return d

    def jwks(self) -> dict[str, Any]:
        return {"keys": [self.jwk()]}

    def mint(self, *, sub: str = "u-1", roles: list[str] | None = None, org: str | None = "acme-med",
             aud: str | list[str] | None = CLIENT_ID, iss: str = ISSUER, exp_in: int = 600, nbf_in: int | None = None,
             email: str | None = "person@example.edu", name: str | None = "Dr Person",
             role_path: str = "realm_access.roles", extra: dict[str, Any] | None = None,
             alg: str = "RS256", kid: str | None = None) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {"sub": sub, "iss": iss, "iat": now, "exp": now + exp_in, "jti": uuid.uuid4().hex}
        if aud is not None:
            claims["aud"] = aud
        if nbf_in is not None:
            claims["nbf"] = now + nbf_in
        if email:
            claims["email"] = email
        if name:
            claims["name"] = name
        if org is not None:
            claims["org"] = org
        if roles is not None:
            node = claims
            parts = role_path.split(".")
            for p in parts[:-1]:
                node = node.setdefault(p, {})
            node[parts[-1]] = roles
        if extra:
            claims.update(extra)
        return jwt.encode(claims, self.private_pem, algorithm=alg, headers={"kid": kid or self.kid})


def build_app(tmp_path, *, auth_mode: str = "oidc", keys: KeyPair | None = None, with_idp: bool = True,
              admin_token: str | None = ADMIN_TOKEN, idp_extra: dict[str, Any] | None = None,
              **over) -> tuple[FastAPI, dict[str, Any]]:
    base = dict(airgapped=False, lambda_key=None, admin_token=admin_token, auth_mode=auth_mode,
                acudx_db_path=str(tmp_path / "acudx.db"), acudx_secret_key=None, _env_file=None)
    base.update(over)
    s = Settings(**base)
    registry = RegistryStore(s.acudx_db_path, secret_key=None)
    users = UserRoleStore(s.acudx_db_path)
    learning = LearningStore(s.acudx_db_path)
    auth = AuthService(registry, users, env_mode=s.auth_mode)
    if with_idp:
        extra = {"client_id": CLIENT_ID, "flavor": "keycloak", "role_claim_path": "realm_access.roles", "org_claim_path": "org"}
        extra.update(idp_extra or {})
        registry.create_provider(ProviderIn(kind="identity", name="keycloak-dev", base_url=ISSUER, extra=extra))
        cfg = identity_config(registry)
        assert cfg is not None
        if keys is not None:
            verifier = OidcVerifier(issuer=cfg.issuer, audience=cfg.audience, jwks=keys.jwks(),
                                    discovery=Discovery(issuer=ISSUER, authorization_endpoint=f"{ISSUER}/protocol/openid-connect/auth",
                                                        token_endpoint=f"{ISSUER}/protocol/openid-connect/token",
                                                        jwks_uri=f"{ISSUER}/protocol/openid-connect/certs"))
            auth.install_verifier(cfg, verifier)
    app = FastAPI()
    app.state.settings = s
    app.state.registry = registry
    app.state.telemetry = TelemetryRecorder(s.acudx_db_path)
    app.state.worker_manager = WorkerManager(s, store=WorkerStore(s.acudx_db_path), template_path=CLOUD_INIT)
    app.state.auth = auth
    app.state.learning = learning
    app.include_router(gpu_router)
    app.include_router(registry_router)
    app.include_router(auth_router)
    app.include_router(auth_admin_router)
    app.include_router(learning_router)

    @app.middleware("http")
    async def _mode_header(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers["X-Auth-Mode"] = request.app.state.auth.mode
        return response

    return app, {"settings": s, "registry": registry, "users": users, "learning": learning, "auth": auth}


def client_for(app: FastAPI, token: str | None = None, **headers: str) -> TestClient:
    h = dict(headers)
    if token:
        h["Authorization"] = f"Bearer {token}"
    return TestClient(app, headers=h)


def sample_batch(encounter_id: str = "enc-1", *, case_id: str = "case-chest-pain", dx_ok: bool = True,
                 safety_miss: bool = False, competence: float = 0.7, n_events: int = 4) -> dict[str, Any]:
    events = [{"seq": i, "type": "question", "ref": f"intent-{i}", "at": 1000 * i, "meta": None} for i in range(n_events)]
    events.append({"seq": n_events, "type": "diagnosis", "ref": "I21.0", "at": 1000 * (n_events + 1), "meta": {"correct": dx_ok}})
    domains = []
    for key in ("history", "exam", "reasoning", "communication", "management"):
        domains.append({"key": key, "axis": "clinical", "band": "strong" if competence >= 0.68 else "developing",
                        "competence": competence, "confidence": min(1.0, competence + 0.1), "scored": True})
    domains.append({"key": "professionalism", "axis": "communication", "band": "withheld", "competence": 0.0,
                    "confidence": 0.0, "scored": False})
    return {
        "encounter_id": encounter_id,
        "case_id": case_id,
        "started_at": 1_700_000_000_000,
        "ended_at": 1_700_000_600_000,
        "events": events,
        "summary": {"title": {"en": "Chest pain", "tr": "Gogus agrisi"}, "domain_scores": domains,
                    "calibration": [], "overall_gap": 0.1, "brier": 0.01, "diagnosis_correct": dx_ok,
                    "safety_miss": safety_miss, "expected_intent_count": 8},
    }

"""Typed async client for the Lambda Cloud public API.

Verified against https://docs.lambda.ai/api/cloud and against live ``GET``
responses captured into ``server/tests/fixtures/lambda/`` (Oct 2026):

* base URL ``https://cloud.lambda.ai/api/v1``
* HTTP basic auth, API key as the username and an empty password
* every success body is ``{"data": ...}``; every error body is
  ``{"error": {"code", "message", "suggestion"?, "request_id"?}}``
* ``PUT /firewall-rules`` **replaces** the whole rule set, so callers must
  ``GET`` first and append (see :func:`merge_firewall_rules`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Sequence

import httpx
from pydantic import BaseModel, ConfigDict, Field

LAMBDA_API_BASE = "https://cloud.lambda.ai/api/v1"

InstanceStatus = Literal["booting", "active", "unhealthy", "terminated", "terminating", "preempted"]


# --------------------------------------------------------------------------- #
# Response models (field names exactly as the API returns them)               #
# --------------------------------------------------------------------------- #
class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Region(_Model):
    name: str
    description: str = ""


class InstanceSpecs(_Model):
    vcpus: int
    memory_gib: int
    storage_gib: int
    gpus: int


class InstanceType(_Model):
    name: str
    description: str = ""
    gpu_description: str = ""
    price_cents_per_hour: int
    specs: InstanceSpecs
    architecture: str | None = None


class InstanceTypeOffer(_Model):
    """One entry of ``GET /instance-types`` (keyed by instance type name)."""

    instance_type: InstanceType
    regions_with_capacity_available: list[Region] = Field(default_factory=list)


class Tag(_Model):
    key: str
    value: str


class Instance(_Model):
    id: str
    name: str | None = None
    ip: str | None = None
    private_ip: str | None = None
    status: InstanceStatus
    ssh_key_names: list[str] = Field(default_factory=list)
    file_system_names: list[str] = Field(default_factory=list)
    region: Region
    instance_type: InstanceType
    hostname: str | None = None
    first_healthy: str | None = None
    tags: list[Tag] = Field(default_factory=list)


class SshKey(_Model):
    id: str
    name: str
    public_key: str


class FirewallRule(_Model):
    protocol: Literal["tcp", "udp", "icmp", "all"]
    port_range: list[int] = Field(default_factory=list)   # [from, to]; empty for icmp/all
    source_network: str
    description: str = ""

    def key(self) -> tuple[str, tuple[int, ...], str]:
        return (self.protocol, tuple(self.port_range), self.source_network)


# Inbound rules the sslip.io worker needs: Caddy's ACME challenge + TLS.
WORKER_FIREWALL_RULES: list[FirewallRule] = [
    FirewallRule(protocol="tcp", port_range=[80, 80], source_network="0.0.0.0/0",
                 description="acudx gpu-worker: ACME http-01 for Caddy"),
    FirewallRule(protocol="tcp", port_range=[443, 443], source_network="0.0.0.0/0",
                 description="acudx gpu-worker: HTTPS (LLM/TTS/STT behind bearer token)"),
]


class LambdaCloudError(RuntimeError):
    """A non-2xx response. ``code`` is the stable machine-readable error code."""

    def __init__(self, status_code: int, code: str, message: str, suggestion: str | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.suggestion = suggestion
        text = f"Lambda Cloud {status_code} {code}: {message}"
        if suggestion:
            text += f" ({suggestion})"
        super().__init__(text)


# --------------------------------------------------------------------------- #
# Client                                                                       #
# --------------------------------------------------------------------------- #
class LambdaCloudClient:
    """Thin, typed wrapper. One ``httpx.AsyncClient`` per instance; call ``aclose``."""

    def __init__(self, api_key: str, *, base_url: str = LAMBDA_API_BASE, timeout_s: float = 30.0,
                 client: httpx.AsyncClient | None = None):
        if not api_key:
            raise ValueError("Lambda Cloud API key is required")
        self.base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            auth=httpx.BasicAuth(api_key, ""), timeout=httpx.Timeout(timeout_s, connect=10.0),
            headers={"accept": "application/json"},
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # -- transport ---------------------------------------------------------- #
    async def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> Any:
        resp = await self._client.request(method, f"{self.base_url}{path}", json=json)
        if resp.status_code >= 400:
            try:
                err = resp.json().get("error") or {}
            except ValueError:
                err = {}
            raise LambdaCloudError(
                resp.status_code, str(err.get("code") or f"http/{resp.status_code}"),
                str(err.get("message") or resp.text[:200] or resp.reason_phrase),
                err.get("suggestion"),
            )
        body = resp.json()
        return body.get("data") if isinstance(body, dict) else body

    # -- instance types / instances ----------------------------------------- #
    async def list_instance_types(self) -> dict[str, InstanceTypeOffer]:
        data = await self._request("GET", "/instance-types")
        return {name: InstanceTypeOffer.model_validate(v) for name, v in (data or {}).items()}

    async def list_instances(self) -> list[Instance]:
        data = await self._request("GET", "/instances")
        return [Instance.model_validate(i) for i in (data or [])]

    async def get_instance(self, instance_id: str) -> Instance:
        return Instance.model_validate(await self._request("GET", f"/instances/{instance_id}"))

    async def launch(self, *, region_name: str, instance_type_name: str, ssh_key_name: str,
                     name: str | None = None, user_data: str | None = None,
                     tags: Sequence[dict[str, str]] | None = None,
                     file_system_names: Sequence[str] | None = None) -> list[str]:
        """``POST /instance-operations/launch``; returns the new instance ids."""
        if user_data is not None and len(user_data.encode("utf-8")) > 1_000_000:
            raise ValueError("user_data exceeds the 1 MB cloud-init limit")
        body: dict[str, Any] = {
            "region_name": region_name,
            "instance_type_name": instance_type_name,
            "ssh_key_names": [ssh_key_name],   # the API accepts exactly one
        }
        if name:
            body["name"] = name
        if user_data is not None:
            body["user_data"] = user_data
        if tags:
            body["tags"] = [dict(t) for t in tags]
        if file_system_names:
            body["file_system_names"] = list(file_system_names)
        data = await self._request("POST", "/instance-operations/launch", json=body)
        return [str(i) for i in (data or {}).get("instance_ids", [])]

    async def terminate(self, instance_ids: Sequence[str]) -> list[Instance]:
        data = await self._request("POST", "/instance-operations/terminate",
                                   json={"instance_ids": list(instance_ids)})
        return [Instance.model_validate(i) for i in (data or {}).get("terminated_instances", [])]

    # -- ssh keys / firewall -------------------------------------------------- #
    async def list_ssh_keys(self) -> list[SshKey]:
        data = await self._request("GET", "/ssh-keys")
        return [SshKey.model_validate(k) for k in (data or [])]

    async def get_firewall_rules(self) -> list[FirewallRule]:
        data = await self._request("GET", "/firewall-rules")
        return [FirewallRule.model_validate(r) for r in (data or [])]

    async def put_firewall_rules(self, rules: Sequence[FirewallRule]) -> list[FirewallRule]:
        """Replaces ALL rules. Always merge with :func:`merge_firewall_rules` first."""
        payload = {"data": [r.model_dump() for r in rules]}
        data = await self._request("PUT", "/firewall-rules", json=payload)
        return [FirewallRule.model_validate(r) for r in (data or [])]


# --------------------------------------------------------------------------- #
# Pure helpers                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Choice:
    instance_type_name: str
    region_name: str
    price_cents_per_hour: int


def pick_cheapest(offers: dict[str, InstanceTypeOffer], allowlist: Sequence[str],
                  region_preference: Sequence[str] = ()) -> Choice | None:
    """Cheapest allow-listed type that has capacity now.

    ``region_preference`` (ordered) restricts and ranks regions when given;
    otherwise the first region with capacity is taken. Ties on price keep the
    allowlist order.
    """
    best: Choice | None = None
    for rank, name in enumerate(allowlist):
        offer = offers.get(name)
        if offer is None or not offer.regions_with_capacity_available:
            continue
        available = [r.name for r in offer.regions_with_capacity_available]
        if region_preference:
            region = next((r for r in region_preference if r in available), None)
            if region is None:
                continue
        else:
            region = available[0]
        price = offer.instance_type.price_cents_per_hour
        if best is None or price < best.price_cents_per_hour:
            best = Choice(name, region, price)
    return best


def merge_firewall_rules(existing: Sequence[FirewallRule],
                         required: Sequence[FirewallRule]) -> tuple[list[FirewallRule], bool]:
    """Existing rules verbatim + any required rule not already present (by protocol/ports/source)."""
    merged = list(existing)
    have = {r.key() for r in existing}
    changed = False
    for rule in required:
        if rule.key() not in have:
            merged.append(rule)
            have.add(rule.key())
            changed = True
    return merged, changed

"""Contract tests for the typed Lambda Cloud client (respx against captured bodies)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from server.providers.lambda_cloud import (
    LAMBDA_API_BASE,
    WORKER_FIREWALL_RULES,
    FirewallRule,
    Instance,
    InstanceTypeOffer,
    LambdaCloudClient,
    LambdaCloudError,
    merge_firewall_rules,
    pick_cheapest,
)

API_KEY = "secret_test_key"


@pytest.fixture
async def client():
    c = LambdaCloudClient(API_KEY)
    yield c
    await c.aclose()


@respx.mock
async def test_list_instance_types_parses_real_shape(client, instance_types_body):
    route = respx.get(f"{LAMBDA_API_BASE}/instance-types").mock(
        return_value=httpx.Response(200, json=instance_types_body)
    )
    offers = await client.list_instance_types()
    assert route.called
    # HTTP basic auth with the API key as the username and an empty password.
    sent = route.calls.last.request
    assert sent.headers["authorization"].startswith("Basic ")
    a10 = offers["gpu_1x_a10"]
    assert a10.instance_type.price_cents_per_hour == 129
    assert a10.instance_type.specs.gpus == 1
    assert [r.name for r in a10.regions_with_capacity_available] == ["us-east-1", "us-west-1"]
    assert offers["gpu_1x_h100_pcie"].regions_with_capacity_available == []


@respx.mock
async def test_list_instances_parses_real_shape(client, instances_body):
    respx.get(f"{LAMBDA_API_BASE}/instances").mock(return_value=httpx.Response(200, json=instances_body))
    instances = await client.list_instances()
    assert len(instances) == 2
    inst = instances[1]
    assert isinstance(inst, Instance)
    assert inst.id == "ea19e031f2c7406c821a88f077d96d9b"
    assert inst.status == "active"
    assert inst.ip == "150.136.117.213"
    assert inst.region.name == "us-east-1"
    assert inst.instance_type.name == "gpu_1x_a10"
    assert inst.instance_type.price_cents_per_hour == 129


@respx.mock
async def test_get_instance_and_booting_without_ip(client):
    body = {"data": {"id": "abc", "status": "booting", "ip": None, "ssh_key_names": ["k"],
                     "file_system_names": [], "region": {"name": "us-east-1", "description": "Virginia, USA"},
                     "instance_type": {"name": "gpu_1x_a10", "description": "1x A10 (24 GB PCIe)",
                                       "gpu_description": "A10 (24 GB PCIe)", "price_cents_per_hour": 129,
                                       "specs": {"vcpus": 30, "memory_gib": 200, "storage_gib": 1400, "gpus": 1}},
                     "first_healthy": None, "actions": {}}}
    respx.get(f"{LAMBDA_API_BASE}/instances/abc").mock(return_value=httpx.Response(200, json=body))
    inst = await client.get_instance("abc")
    assert inst.status == "booting" and inst.ip is None


@respx.mock
async def test_launch_sends_documented_body_and_returns_ids(client):
    route = respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        return_value=httpx.Response(200, json={"data": {"instance_ids": ["new-id-1"]}})
    )
    ids = await client.launch(
        region_name="us-east-1", instance_type_name="gpu_1x_a10", ssh_key_name="acudx-claude-mac",
        name="acudx-worker", user_data="#cloud-config\n", tags=[{"key": "app", "value": "acudx"}],
    )
    assert ids == ["new-id-1"]
    sent = json.loads(route.calls.last.request.content)
    assert sent["region_name"] == "us-east-1"
    assert sent["instance_type_name"] == "gpu_1x_a10"
    assert sent["ssh_key_names"] == ["acudx-claude-mac"]   # exactly one key
    assert sent["name"] == "acudx-worker"
    assert sent["user_data"].startswith("#cloud-config")
    assert sent["tags"] == [{"key": "app", "value": "acudx"}]
    assert "file_system_names" not in sent


@respx.mock
async def test_terminate_returns_terminated_instances(client, instances_body):
    term = dict(instances_body["data"][1])
    term["status"] = "terminating"
    route = respx.post(f"{LAMBDA_API_BASE}/instance-operations/terminate").mock(
        return_value=httpx.Response(200, json={"data": {"terminated_instances": [term]}})
    )
    out = await client.terminate(["ea19e031f2c7406c821a88f077d96d9b"])
    assert json.loads(route.calls.last.request.content) == {"instance_ids": ["ea19e031f2c7406c821a88f077d96d9b"]}
    assert out[0].status == "terminating"


@respx.mock
async def test_api_error_is_typed(client):
    respx.post(f"{LAMBDA_API_BASE}/instance-operations/launch").mock(
        return_value=httpx.Response(400, json={"error": {"code": "instance-operations/launch/insufficient-capacity",
                                                        "message": "Not enough capacity", "suggestion": "Try later"}})
    )
    with pytest.raises(LambdaCloudError) as ei:
        await client.launch(region_name="us-east-1", instance_type_name="gpu_1x_a10", ssh_key_name="k")
    assert ei.value.code == "instance-operations/launch/insufficient-capacity"
    assert ei.value.status_code == 400
    assert "Not enough capacity" in str(ei.value)


@respx.mock
async def test_ssh_keys_and_firewall_rules_parse(client, ssh_keys_body, firewall_rules_body):
    respx.get(f"{LAMBDA_API_BASE}/ssh-keys").mock(return_value=httpx.Response(200, json=ssh_keys_body))
    respx.get(f"{LAMBDA_API_BASE}/firewall-rules").mock(return_value=httpx.Response(200, json=firewall_rules_body))
    keys = await client.list_ssh_keys()
    assert {k.name for k in keys} >= {"acudx-claude-mac", "Liver"}
    rules = await client.get_firewall_rules()
    assert len(rules) == 11
    assert rules[0] == FirewallRule(protocol="tcp", port_range=[22, 22], source_network="0.0.0.0/0",
                                    description="mgpu-study: ssh from owner")


@respx.mock
async def test_put_firewall_rules_sends_full_list(client, firewall_rules_body):
    route = respx.put(f"{LAMBDA_API_BASE}/firewall-rules").mock(
        return_value=httpx.Response(200, json=firewall_rules_body)
    )
    rules = [FirewallRule.model_validate(r) for r in firewall_rules_body["data"]]
    await client.put_firewall_rules(rules)
    sent = json.loads(route.calls.last.request.content)
    assert list(sent) == ["data"] and len(sent["data"]) == 11
    assert sent["data"][0]["port_range"] == [22, 22]


# --- pure helpers ---------------------------------------------------------- #

def _offers(body):
    return {k: InstanceTypeOffer.model_validate(v) for k, v in body["data"].items()}


def test_pick_cheapest_prefers_lowest_price_with_capacity(instance_types_body):
    offers = _offers(instance_types_body)
    allow = ["gpu_1x_a100_sxm4", "gpu_1x_a10", "gpu_1x_a100", "gpu_1x_h100_pcie"]
    choice = pick_cheapest(offers, allow)
    # a10 (129c) is cheaper than a100_sxm4 (199c); a100 / h100_pcie have no capacity in the capture.
    assert choice is not None
    assert choice.instance_type_name == "gpu_1x_a10"
    assert choice.region_name == "us-east-1"
    assert choice.price_cents_per_hour == 129


def test_pick_cheapest_skips_types_without_capacity(instance_types_body):
    offers = _offers(instance_types_body)
    assert pick_cheapest(offers, ["gpu_1x_h100_pcie", "gpu_1x_a100"]) is None
    assert pick_cheapest(offers, ["gpu_1x_h100_pcie", "gpu_1x_a100_sxm4"]).instance_type_name == "gpu_1x_a100_sxm4"


def test_pick_cheapest_honours_region_preference(instance_types_body):
    offers = _offers(instance_types_body)
    choice = pick_cheapest(offers, ["gpu_1x_a10"], region_preference=["us-west-1", "us-east-1"])
    assert choice.region_name == "us-west-1"
    # Preference restricts: a preferred region with no capacity means no choice.
    assert pick_cheapest(offers, ["gpu_1x_a10"], region_preference=["eu-central-1"]) is None


def test_merge_firewall_rules_keeps_existing_and_appends_missing(firewall_rules_body):
    existing = [FirewallRule.model_validate(r) for r in firewall_rules_body["data"]]
    merged, changed = merge_firewall_rules(existing, WORKER_FIREWALL_RULES)
    assert changed is True
    assert merged[:11] == existing
    assert len(merged) == 15
    assert {(r.protocol, tuple(r.port_range), r.source_network) for r in merged[11:]} == {
        ("tcp", (80, 80), "0.0.0.0/0"), ("tcp", (443, 443), "0.0.0.0/0"),
        ("udp", (3478, 3478), "0.0.0.0/0"), ("tcp", (3478, 3478), "0.0.0.0/0")}
    # Idempotent: a second merge adds nothing.
    again, changed2 = merge_firewall_rules(merged, WORKER_FIREWALL_RULES)
    assert changed2 is False and again == merged

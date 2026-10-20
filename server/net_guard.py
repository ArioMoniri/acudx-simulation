"""Outbound URL guard against SSRF (review 04 O5).

Two consumers:

* the guideline verifier (``server/guidelines/verifier.py``) fetches public documents; every
  hop (the first URL and each redirect) must resolve to public addresses only, and a redirect
  may only go to the same registrable domain as the original URL or to a host on
  ``GUIDELINE_REDIRECT_ALLOWLIST``;
* registry provider probes (``server/registry/probe.py``) may legitimately target on-prem
  hosts (vLLM on loopback, an in-VPC GPU pool), so a literal private or loopback IP, the name
  ``localhost`` and any ``LOCAL_ALLOWLIST`` entry are an explicit operator choice. What is
  refused is a host NAME that resolves into a private range (DNS rebinding, internal names)
  and, always, link-local and metadata addresses (169.254.0.0/16, fe80::/10, fd00:ec2::254).

Resolution goes through :data:`RESOLVER` (``loop.getaddrinfo``), which tests replace.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from typing import Awaitable, Callable, Iterable
from urllib.parse import urlparse

Resolver = Callable[[str], Awaitable[list[str]]]

# Multi-label public suffixes seen in the guideline sources (gov.tr, nhs.uk, ...). A full
# Public Suffix List is not vendored; for anything else the last two labels are the domain.
_SECOND_LEVEL = {
    "ac.uk", "co.uk", "gov.uk", "nhs.uk", "org.uk", "com.tr", "edu.tr", "gov.tr", "org.tr", "gen.tr",
    "av.tr", "k12.tr", "com.au", "edu.au", "gov.au", "org.au", "co.jp", "ac.jp", "go.jp", "or.jp",
    "co.nz", "govt.nz", "org.nz", "com.br", "gov.br", "org.br", "co.in", "gov.in", "nic.in", "ac.in",
}

_METADATA = {ipaddress.ip_address("169.254.169.254"), ipaddress.ip_address("fd00:ec2::254")}


class BlockedDestination(ValueError):
    """The URL points at an address the gateway must not dial."""


async def _getaddrinfo(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return sorted({str(info[4][0]) for info in infos})


RESOLVER: Resolver = _getaddrinfo


def _ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    ip = ipaddress.ip_address(value.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def is_link_local_or_metadata(value: str) -> bool:
    ip = _ip(value)
    return ip in _METADATA or ip.is_link_local


def is_non_public(value: str) -> bool:
    """Private, loopback, link-local, multicast, reserved or unspecified (anything not global)."""
    ip = _ip(value)
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
            or ip.is_unspecified or not ip.is_global)


def registrable_domain(host: str) -> str:
    labels = [p for p in host.lower().rstrip(".").split(".") if p]
    if len(labels) <= 2:
        return ".".join(labels)
    if ".".join(labels[-2:]) in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        raise BlockedDestination(f"no host in {url!r}")
    return host


def _listed(host: str, allow: Iterable[str]) -> bool:
    for entry in allow:
        e = entry.strip().lower()
        if not e:
            continue
        if host == e or (e.startswith(".") and host.endswith(e)):
            return True
        try:
            if ipaddress.ip_address(host) in ipaddress.ip_network(e, strict=False):
                return True
        except ValueError:
            continue
    return False


def env_list(name: str) -> list[str]:
    return [p.strip() for p in (os.environ.get(name) or "").split(",") if p.strip()]


async def check_public_url(url: str, *, allow_private: Iterable[str] = ()) -> list[str]:
    """Raise :class:`BlockedDestination` unless every address ``url``'s host resolves to is public.

    ``allow_private`` (host names, ``.suffix`` entries or CIDRs) exempts a host explicitly.
    Returns the resolved addresses.
    """
    scheme = urlparse(url).scheme.lower()
    if scheme not in ("http", "https"):
        raise BlockedDestination(f"scheme {scheme!r} is not fetched")
    host = _host(url)
    if _listed(host, allow_private):
        return []
    try:
        addrs = [host] if _is_ip_literal(host) else await RESOLVER(host)
    except OSError as exc:
        raise BlockedDestination(f"{host} does not resolve: {exc}") from exc
    if not addrs:
        raise BlockedDestination(f"{host} does not resolve")
    bad = [a for a in addrs if is_non_public(a)]
    if bad:
        raise BlockedDestination(f"{host} resolves to a non-public address ({', '.join(bad)})")
    return addrs


async def check_probe_url(url: str, *, allow_private: Iterable[str] = ()) -> None:
    """Provider-probe policy: literal private IPs and ``localhost`` are allowed (operator intent),
    link-local and metadata addresses never are, and a NAME resolving to a private range is
    refused unless allow-listed."""
    host = _host(url)
    if _is_ip_literal(host):
        if is_link_local_or_metadata(host):
            raise BlockedDestination(f"{host} is a link-local or metadata address")
        return
    if host == "localhost" or _listed(host, allow_private):
        return
    try:
        addrs = await RESOLVER(host)
    except OSError:
        return  # unresolvable: the probe itself reports the connect error
    for a in addrs:
        if is_link_local_or_metadata(a):
            raise BlockedDestination(f"{host} resolves to a link-local or metadata address ({a})")
    bad = [a for a in addrs if is_non_public(a)]
    if bad:
        raise BlockedDestination(f"{host} resolves to a private address ({', '.join(bad)}); "
                                 "use the IP literal or add the host to LOCAL_ALLOWLIST")


def _is_ip_literal(host: str) -> bool:
    try:
        _ip(host)
        return True
    except ValueError:
        return False


def same_site_or_allowed(original: str, target: str, allow: Iterable[str] = ()) -> bool:
    """A redirect target is followed only within the original registrable domain or to an allow-listed host."""
    o, t = _host(original), _host(target)
    return registrable_domain(o) == registrable_domain(t) or _listed(t, allow)

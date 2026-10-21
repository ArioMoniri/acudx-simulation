#!/usr/bin/env python3
"""Render the production realm import from the development realm (stdlib only, runs on the host).

    python3 deploy/keycloak/render-prod-realm.py --domain sim.example.edu --out /var/lib/acudx/keycloak-import/realm-acudx.json

Keeps roles, the public PKCE client, the audience mapper and the ``acudx-org`` scope; drops
every development user (accounts are provisioned at deploy time by server/bootstrap/provision.py
with random temporary passwords); pins the client's redirect, web origin and logout URIs to
``https://<domain>``; adds a password policy for the password each person sets on first sign-in.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent


def render(domain: str) -> dict:
    realm = json.loads((HERE / "realm-acudx.json").read_text(encoding="utf-8"))
    origin = f"https://{domain}"
    realm["displayName"] = "AcuDx"
    realm.pop("users", None)
    realm["sslRequired"] = "external"
    realm["bruteForceProtected"] = True
    realm["passwordPolicy"] = "length(12) and notUsername and notEmail and passwordHistory(3)"
    for client in realm.get("clients", []):
        if client.get("clientId") != "acudx-web":
            continue
        client["rootUrl"] = origin
        client["redirectUris"] = [f"{origin}/auth/callback"]
        client["webOrigins"] = [origin]
        client.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{origin}/*"
    return realm


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--domain", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(render(a.domain), indent=1), encoding="utf-8")
    os.chmod(out, 0o644)  # read by the Keycloak container user; holds no secret
    print(f"rendered realm for https://{a.domain} -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

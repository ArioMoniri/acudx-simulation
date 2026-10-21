"""Mint a single-use retrieval code for the credential handoff (run on the server only).

    python -m server.bootstrap.mint [--dir DIR] [--ttl-hours 72] [--code-file PATH]

Prints the code once on stdout (unless ``--code-file`` is given, in which case it is written
there with mode 0600 and only the expiry is printed). Any earlier code stops working.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

from server.bootstrap.handoff import DEFAULT_TTL_HOURS, BootstrapHandoff, format_code


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dir", default=os.environ.get("BOOTSTRAP_DIR") or "/run/acudx-bootstrap")
    p.add_argument("--ttl-hours", type=float, default=DEFAULT_TTL_HOURS)
    p.add_argument("--code-file", default=None)
    p.add_argument("--actor", default="cli")
    p.add_argument("--provision-token-stdin", action="store_true",
                   help="store the hash of the PROVISION_TOKEN read from stdin (SSH-free deploy) and exit")
    a = p.parse_args(argv)
    h = BootstrapHandoff(a.dir)
    if a.provision_token_stdin:
        from server.bootstrap.tokens import PROVISION_TTL_H, provision_secret  # noqa: PLC0415

        tok = sys.stdin.read().strip()
        if len(tok) < 24:
            print("provision token on stdin is missing or too short", file=sys.stderr)
            return 2
        sec = provision_secret(h)
        if sec.state() != "absent":
            print(f"provision token already {sec.state()}; not replaced", file=sys.stderr)
            return 0
        _, expires = sec.store(tok, ttl_hours=PROVISION_TTL_H, actor=a.actor)
        when = datetime.fromtimestamp(expires, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"provision token armed (single use, expires {when})")
        return 0
    if not h.credentials_path.exists():
        print(f"no {h.credentials_path}: provision the accounts first", file=sys.stderr)
        return 2
    code, expires = h.mint(a.ttl_hours, actor=a.actor)
    when = datetime.fromtimestamp(expires, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    if a.code_file:
        fd = os.open(a.code_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(format_code(code) + "\n")
        print(f"retrieval code written to {a.code_file}; expires {when}")
    else:
        print(format_code(code))
        print(f"expires {when}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

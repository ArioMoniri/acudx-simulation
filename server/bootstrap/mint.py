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
    a = p.parse_args(argv)
    h = BootstrapHandoff(a.dir)
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

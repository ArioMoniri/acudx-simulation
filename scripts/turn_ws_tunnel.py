"""TURN-over-TCP through a WebSocket: a harness for networks that only allow HTTPS egress.

Browsers on an ordinary network reach the GPU worker's TURN server directly
(``turn:<worker>:3478`` over UDP or TCP). A sandbox whose only egress is an HTTPS proxy
cannot, so this script listens on a local TCP port and carries each connection as a
binary WebSocket to the worker runner's ``/avatar/turn`` bridge (behind the worker
bearer, through ``HTTPS_PROXY``); the runner pipes it to coturn's TCP listener. Point the
gateway at it with ``AVATAR_TURN_URLS=turn:127.0.0.1:<port>?transport=tcp`` and the
browser's relay candidates flow through the tunnel. TURN over TCP is a plain byte stream
(RFC 6062 framing is inside the stream), so a byte pipe is all it needs.

usage: python scripts/turn_ws_tunnel.py --url wss://<ip>.sslip.io/avatar/turn --listen 127.0.0.1:3478
       (the bearer is read from the WORKER_TOKEN environment variable, never from argv)
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import urllib.request
from urllib.parse import urlparse

import websockets


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, url: str, token: str) -> None:
    peer = writer.get_extra_info("peername")
    # HTTPS_PROXY for the worker; a NO_PROXY host (a local runner) is dialled directly.
    kw = {"proxy": None} if urllib.request.proxy_bypass(urlparse(url).hostname or "") else {}
    try:
        async with websockets.connect(url, additional_headers={"Authorization": f"Bearer {token}"},
                                      max_size=1 << 20, ping_interval=20, **kw) as ws:
            async def up() -> None:
                while True:
                    data = await reader.read(65536)
                    if not data:
                        break
                    await ws.send(data)
                await ws.close()

            async def down() -> None:
                async for msg in ws:
                    if isinstance(msg, bytes):
                        writer.write(msg)
                        await writer.drain()

            await asyncio.gather(up(), down())
    except Exception as exc:  # noqa: BLE001 - one connection failing must not stop the listener
        print(f"tunnel {peer}: {type(exc).__name__}: {exc}", file=sys.stderr)
    finally:
        writer.close()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--listen", default="127.0.0.1:3478")
    args = ap.parse_args()
    token = os.environ.get("WORKER_TOKEN", "")
    host, port = args.listen.rsplit(":", 1)
    server = await asyncio.start_server(lambda r, w: pipe(r, w, args.url, token), host, int(port))
    print(f"turn tunnel listening on {args.listen} -> {args.url}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())

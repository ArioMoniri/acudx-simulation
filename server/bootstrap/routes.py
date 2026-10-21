"""``/bootstrap/credentials``: the one-time credential handoff page (server/bootstrap/handoff.py).

GET   form (200), or 404 when nothing was provisioned, 410 once the code is burned or expired.
POST  ``code=<retrieval code>`` (form-encoded). 200 with the table exactly once; 401 wrong code,
      429 rate limited or locked (``Retry-After``), 410 burned / expired, 403 over plain HTTP.

The page is self-contained HTML with a strict CSP, ``no-store`` caching and no third-party
asset. It is served by the gateway behind Caddy, which terminates TLS and sets
``X-Forwarded-Proto``; any request that did not arrive over HTTPS is refused.
"""

from __future__ import annotations

import hashlib
import html
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from server.bootstrap.handoff import BootstrapHandoff, Outcome

router = APIRouter(prefix="/bootstrap", tags=["bootstrap"])

_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": ("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; "
                                "frame-ancestors 'none'; base-uri 'none'"),
}

_STYLE = """
:root{color-scheme:light dark;--bg:#f7f8fa;--fg:#14171f;--muted:#5b6475;--card:#fff;--line:#d9dde5;--brand:#0f6e6e;--warn:#8a4b00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--fg:#e8ebf1;--muted:#9aa3b5;--card:#171b23;--line:#2a303c;--brand:#4fc1c1;--warn:#f0b35a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:1.4rem;margin:0 0 8px}p{margin:0 0 12px;color:var(--muted)}
label{display:block;font-weight:600;margin:16px 0 6px}
input{width:100%;font:inherit;font-family:ui-monospace,Menlo,monospace;letter-spacing:.06em;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
button{margin-top:16px;font:inherit;font-weight:600;padding:10px 18px;border:0;border-radius:8px;background:var(--brand);color:#fff;cursor:pointer}
.err{color:var(--warn);font-weight:600}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;margin-top:16px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
td code{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
"""


def _page(title: str, body: str, status: int = 200, extra_headers: dict[str, str] | None = None) -> HTMLResponse:
    doc = (f"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
           f"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
           f"<meta name=\"robots\" content=\"noindex,nofollow\"><title>{html.escape(title)}</title>"
           f"<style>{_STYLE}</style></head><body><main><div class=\"card\">{body}</div></main></body></html>")
    return HTMLResponse(doc, status_code=status, headers={**_HEADERS, **(extra_headers or {})})


def _form(message: str | None = None) -> str:
    err = f"<p class=\"err\" role=\"alert\">{html.escape(message)}</p>" if message else ""
    return ("<h1>AcuDx account handoff</h1>"
            "<p>Enter the single-use retrieval code you received with this deployment. The code works once: "
            "after it is accepted the accounts are shown one time and this page is closed for good.</p>"
            f"{err}<form method=\"post\" action=\"/bootstrap/credentials\" autocomplete=\"off\">"
            "<label for=\"code\">Retrieval code</label>"
            "<input id=\"code\" name=\"code\" required minlength=\"16\" maxlength=\"80\" spellcheck=\"false\" "
            "autocapitalize=\"characters\" autocomplete=\"one-time-code\">"
            "<button type=\"submit\">Show accounts once</button></form>")


def _gone(reason: str | None) -> HTMLResponse:
    why = {"expired": "The retrieval code expired.",
           "too_many_failures": "The retrieval code was disabled after too many wrong attempts."}.get(
        reason or "", "The retrieval code was already used.")
    return _page("Handoff closed", f"<h1>Handoff closed</h1><p>{why} Ask the operator to mint a new code on the "
                 "server with <code>deploy/rotate-bootstrap-code.sh</code>.</p>", status=410)


def _handoff(request: Request) -> BootstrapHandoff | None:
    return getattr(request.app.state, "bootstrap", None)


def _is_https(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return proto == "https" or request.url.scheme == "https"


def _client_ip(request: Request) -> str:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "unknown")


def _insecure() -> HTMLResponse:
    return _page("HTTPS required", "<h1>HTTPS required</h1><p>This page is only served over HTTPS.</p>", status=403)


def _table(creds: dict[str, Any]) -> str:
    rows = "".join(
        f"<tr><td><code>{html.escape(str(u.get('username', '')))}</code></td>"
        f"<td>{html.escape(str(u.get('role', '')))}</td>"
        f"<td><code>{html.escape(str(u.get('password', '')))}</code></td></tr>"
        for u in creds.get("users") or []
    )
    login = html.escape(str(creds.get("login_url") or "/signin"))
    return ("<h1>AcuDx accounts</h1>"
            "<p class=\"err\">Shown once. Copy these now: reloading this page will not show them again.</p>"
            f"<p>Sign in at <a href=\"{login}\">{login}</a>. Every password is temporary: the first sign-in asks "
            "for a new password.</p>"
            "<div class=\"tbl\"><table><thead><tr><th scope=\"col\">Username</th><th scope=\"col\">Role</th>"
            f"<th scope=\"col\">Temporary password</th></tr></thead><tbody>{rows}</tbody></table></div>")


@router.get("/credentials")
async def credentials_form(request: Request) -> HTMLResponse:
    h = _handoff(request)
    if h is None:
        return _page("Not found", "<h1>Not found</h1>", status=404)
    if getattr(request.app.state.settings, "bootstrap_require_https", True) and not _is_https(request):
        return _insecure()
    st = h.status()
    if st["state"] == "not_provisioned":
        return _page("Not found", "<h1>Not found</h1><p>No handoff is provisioned on this server.</p>", status=404)
    if st["state"] in ("burned", "expired"):
        return _gone(st.get("reason") or st["state"])
    if st["state"] == "locked":
        return _page("AcuDx account handoff", _form("Too many wrong codes. Try again later."),
                     extra_headers={"Retry-After": str(st["retry_after_s"])})
    return _page("AcuDx account handoff", _form())


@router.post("/credentials")
async def credentials_redeem(request: Request) -> HTMLResponse:
    h = _handoff(request)
    if h is None:
        return _page("Not found", "<h1>Not found</h1>", status=404)
    if getattr(request.app.state.settings, "bootstrap_require_https", True) and not _is_https(request):
        h.audit("redeem", outcome="insecure_transport", status=403, ip=_client_ip(request))
        return _insecure()
    raw = (await request.body())[:4096].decode("utf-8", "replace")
    from urllib.parse import parse_qs  # noqa: PLC0415 - tiny form, no multipart dependency needed

    code = (parse_qs(raw).get("code") or [""])[0]
    ua = hashlib.sha256((request.headers.get("user-agent") or "").encode("utf-8")).hexdigest()[:12]
    out: Outcome = h.redeem(code, ip=_client_ip(request), ua_hash=ua)
    if out.status == 200 and out.credentials is not None:
        return _page("AcuDx accounts", _table(out.credentials))
    if out.status == 410:
        return _gone(out.reason)
    if out.status == 429:
        return _page("AcuDx account handoff", _form("Too many attempts. Try again later."), status=429,
                     extra_headers={"Retry-After": str(out.retry_after_s or 60)})
    if out.status == 401:
        return _page("AcuDx account handoff", _form("That code is not valid."), status=401)
    if out.status == 404:
        return _page("Not found", "<h1>Not found</h1>", status=404)
    return _page("Unavailable", "<h1>Unavailable</h1><p>The handoff is not ready on this server.</p>",
                 status=out.status)

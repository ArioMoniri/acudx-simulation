"""Server-verified identity (docs/architecture/19-identity-roles-and-panels.md).

An OIDC identity provider is configured in the admin registry (``kind="identity"``):
``base_url`` is the issuer, ``extra`` carries the client id, scopes and the claim
paths. The server fetches the discovery document and the JWKS, verifies every
bearer token (issuer, audience, exp, nbf, signature) and maps the claims onto the
AcuDx roles. ``AUTH_MODE=local`` keeps the air-gapped local-profile behaviour and
tags every response with ``X-Auth-Mode: local`` so the UI shows it is unverified.
"""

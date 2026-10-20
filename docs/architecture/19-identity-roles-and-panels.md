# 19 - Identity, roles and the institutional panels

**Status:** implemented (server + web), October 2026. **Owners:** `server/auth`, `server/learning`, `web/src/lib/auth.ts`, `web/src/lib/panelsApi.ts`, `web/src/pages/{DeanPage,FacultyPage,SignInPage,AuthCallbackPage}.tsx`.
**Supersedes:** the self-chosen roles described in `docs/review/00-codebase-audit-2026-10-19.md` section 4. **Builds on:** `08-data-model-and-multitenancy.md` (event sourcing, hash chaining, RBAC), `16-agent-orchestration-identity-deploy-oct-2026.md` section 3 (IdP choice and role model), `17-provider-registry-admin-telemetry.md` (registry, admin token).

## 1. What changed

Before this wave the role was a value the person picked on the profile screen, so the dean and authoring gates meant nothing and every "institution" number came from the browser's own localStorage. Now:

- the identity provider is a **registry row** (`kind=identity`) configured in the admin console; the server fetches its discovery document and JWKS and verifies every bearer token (signature, `iss`, `aud`, `exp`, `nbf`);
- the role is derived from **verified claims**, unioned with a server-side **`user_roles`** table admins edit, with a documented precedence;
- every protected route is guarded on the server (`/admin/*`, `/v1/dean/*`, `/v1/faculty/*`, learner routes);
- finished encounters are **ingested** (`POST /v1/events/encounter`) and **hash-chained per org**, so the dean and faculty panels aggregate real server data;
- the web app signs in with **OIDC Authorization Code + PKCE** (public client, token in memory, refresh token tab-scoped), shows "Sign in with your institution" when a provider exists and keeps the local profile only in `AUTH_MODE=local`, visibly badged as unverified.

## 2. Modes

| Mode | How it is set | Behaviour |
|---|---|---|
| `local` (default) | `AUTH_MODE=local` env, or registry setting `auth_mode` | Air-gapped demos. Identity comes from the unverified headers the local profile sends (`X-User-Id`, `X-User-Role`, `X-User-Name`, `X-User-Email`, `X-Tenant`). A valid bearer is still honoured when a provider is configured. **Every response carries `X-Auth-Mode: local`** and the UI shows a "Local, unverified" badge on the sign-in screen, the profile and the panels. |
| `oidc` | `AUTH_MODE=oidc` or registry setting `auth_mode=oidc` | A verified bearer JWT is required on every protected route; header identities are ignored (401). Without an enabled identity provider the server answers 503 `identity_not_configured` so the misconfiguration is loud. |

The registry setting wins over the environment so an admin can flip modes from the console without a redeploy (`PUT /admin/settings {"settings":{"auth_mode":"oidc"}}`).

## 3. Identity provider configuration

`POST /admin/providers` with `kind: "identity"`:

| Field | Meaning | Keycloak 26 (open default) | Supabase Auth (managed) |
|---|---|---|---|
| `base_url` | OIDC issuer | `https://idp.example.edu/realms/acudx` | `https://<ref>.supabase.co/auth/v1` |
| `extra.client_id` | public PKCE client | `acudx-web` | the project's anon key id is not needed; use the configured client id |
| `extra.audience` | expected `aud` (default = client id; `""` disables) | `acudx-web` via an audience mapper (shipped in `deploy/keycloak/realm-acudx.json`) | `authenticated` |
| `extra.scopes` | space separated | `openid profile email` | `openid profile email` |
| `extra.role_claim_path` | dotted path to roles | `realm_access.roles` (flavor default) | `app_metadata.roles` (flavor default) |
| `extra.org_claim_path` | dotted path to the tenant | `org` (user attribute mapped by the `acudx-org` scope) | `app_metadata.org` |
| `extra.flavor` | UI hint and defaults | `keycloak` | `supabase`; any other OIDC IdP uses `oidc` |
| `extra.discovery_url` | override for `<issuer>/.well-known/openid-configuration` | optional | optional |

Any OIDC-compliant IdP works (authentik, ZITADEL, Entra ID) with the same fields. `GET /v1/auth/config` publishes the non-secret part (client id, scopes, claim paths, discovery endpoints) so the browser never performs discovery itself. There is no client secret anywhere: the browser is a public client and the server only holds the IdP's public keys.

### Verification (`server/auth/jwks.py`)

`OidcVerifier` caches discovery and JWKS keys by `kid` (TTL 600 s), refreshes once on an unknown `kid` (rotation), accepts only asymmetric algorithms (`RS256/384/512`, `ES256/384`, `PS256`; `alg=none` and HMAC are rejected), requires `exp`, `iat`, `iss`, `sub`, checks `nbf` and allows 30 s of clock skew. PyJWT + cryptography; no network call happens when the keys are pre-seeded (tests, air-gapped mirrors).

## 4. Roles and precedence

```
super_admin (60) > admin (50) > dean (40) > faculty (30) > resident (20) > nurse = paramedic = student (10)
```

- `student`, `nurse`, `paramedic` are learner tracks at the same level; `resident` adds advanced cases.
- `faculty` authors and reviews cases, grades with co-sign, sees its roster.
- `dean` sees org-wide analytics and the accreditation export.
- `admin` manages the org: identity provider, user roles, settings.
- `super_admin` is platform-wide (any org via `?org=`).

`primary_role` is the highest role held and is what the web app displays and gates on. Aliases are normalised (`educator` -> `faculty`, `super-admin` -> `super_admin`). Effective roles = roles found at the claim path **union** roles granted in `user_roles`; when neither yields a role the principal is a `student`.

### Route guard matrix

| Route | Requirement |
|---|---|
| `/admin/*` | `X-Admin-Token` (bootstrap) **or** a verified bearer holding `admin`/`super_admin`. 503 only when neither an admin token nor an identity provider is configured. |
| `/v1/dean/*` | `dean` or higher (dean, admin, super_admin); `?org=` other than the caller's org needs `admin`. |
| `/v1/faculty/*` | `faculty` or higher. |
| `/v1/events/encounter`, `/v1/me/*`, `/v1/auth/me` | any authenticated principal. |
| `/v1/auth/config` | public. |

Failures: 401 `unauthenticated` / token reason (`expired`, `bad_issuer`, `bad_audience`, `invalid_signature`, `unknown_kid`, ...), 403 `forbidden` with the required role and the roles held.

### `user_roles` (server/auth/store.py)

Keyed by the IdP `sub`; holds granted roles, org, `granted_by`, and the email / name last seen in a verified token (so rosters show people, not subs). Admin API: `GET /admin/users[?org=]`, `PUT /admin/users/{sub}/roles {roles, org}`, `DELETE /admin/users/{sub}`. Web: Admin console -> Users tab (`web/src/components/admin/UsersSection.tsx`).

## 5. Event ingestion and hash chain (server/learning)

`POST /v1/events/encounter` stores one finished encounter per user and org:

```json
{ "encounter_id": "enc-1729...", "case_id": "case-chest-pain", "started_at": 1729..., "ended_at": 1729...,
  "events": [{"seq": 0, "type": "question", "ref": "intent-onset", "at": 1200, "meta": null}, ...],
  "summary": { "domain_scores": [{"key": "history", "band": "strong", "competence": 0.74, "confidence": 0.8, "scored": true}, ...],
               "overall_gap": 0.08, "brier": 0.01, "diagnosis_correct": true, "safety_miss": false } }
```

- `body_sha256 = sha256(canonical_json(body))`, `chain_hash = sha256(prev_hash + body_sha256)` where `prev_hash` is the previous row of the **same org** (genesis `0 * 64`). `GET /v1/dean/chain` recomputes every link and names the first broken row.
- Idempotent on `(org, user_sub, encounter_id)`: a re-submission returns the stored link with `stored: false`.
- Side effects inside the same transaction: a safety miss or a wrong diagnosis **flags** the encounter for faculty review; an open assignment for `(org, user, case_id)` is **completed**.
- The web app posts automatically: `progressStore.onEncounterRecorded` -> `lib/eventSync.ts` -> `panelsApi.postEncounter`, with retry on the next record or after sign-in.

### Dean API

`GET /v1/dean/cohort?org=&window=7d|30d|90d|all` returns `learner_count`, `encounters`, `kpis` (diagnostic accuracy, safety-miss rate, mean Brier, at-risk count), `bands_by_domain`, `calibration.by_domain` (mean gap, over/well/under counts), `learners[]` (masked handle, per-domain mean competence banded with the same thresholds as `progressStore`, at-risk reasons: `safety`, `competence`, `diagnosis`, `calibration`), `activity[]` buckets and the chain status. `GET /v1/dean/export` returns the de-identified accreditation rows (handle, bands, outcome flags, chain hash). No name or `sub` ever leaves the dean endpoints (INV-4).

### Faculty API

`GET /v1/faculty/queue` (authored cases pending + flagged encounters + recent reviews), `POST /v1/faculty/review/{batch_id}` (`decision` upheld|overridden, per-domain band `overrides`, optional `points` 0..100, `note`; **`cosigned: true` is mandatory**, an override needs content), `POST /v1/faculty/cases/submit`, `POST /v1/faculty/cases/{id}/decide`, `POST /v1/faculty/assign` (explicit subs or `all_learners`), `GET /v1/faculty/assignments`, `GET /v1/faculty/roster` (directory union learners seen, with encounter counts, safety misses, open assignments). Learners read their own assignments at `GET /v1/me/assignments`.

## 6. Web flow (web/src/lib/auth.ts)

1. On boot `bootstrapAuth()` loads `/v1/auth/config`, and if a refresh token survives in **sessionStorage** (tab-scoped) it mints a new access token and loads `/v1/auth/me`; the verified principal is mirrored into `profileStore.applyVerifiedIdentity`.
2. `beginSignIn(cfg)` creates a 43-char verifier and S256 challenge, stores `{verifier, state, nonce, redirectUri, returnTo}` in sessionStorage for the duration of the redirect, and navigates to the authorization endpoint (`response_type=code`, `code_challenge_method=S256`; `extra.kc_idp_hint` routes to a university IdP).
3. `/auth/callback` -> `completeSignIn(search)`: state check, code exchange with the verifier, `/v1/auth/me`, then back to `returnTo`.
4. The **access token lives in module memory only**; `ensureAccessToken()` refreshes 20 s before expiry; `signOutOidc()` clears memory and the refresh token and can call the IdP end-session endpoint.
5. `panelsApi.identityHeaders()` sends the bearer when present, otherwise the unverified local headers; it surfaces the server's `X-Auth-Mode` as `authMode` so every panel can badge itself.

Gating in `App.tsx`: `AuthGate` admits a signed-in profile, and once the server reports `oidc` it also requires `profile.verified`; `RoleGate` reads `profile.role` (derived from the verified principal in oidc mode) and never admits an unverified profile to a privileged route in oidc mode. `ProfilePage` locks name, role and institution on a verified profile, and offers privileged roles on a local profile only while the gateway runs `AUTH_MODE=local`. `viewAs` keeps "View as" a preview WITHIN the permitted vantages of the verified role.

## 7. Panels

- `/dean` (alias `/institution`): KPIs, at-risk list with the remediation loop (assign a `remediation-<domain>` case; the assignment closes when the learner's next encounter for it is ingested), cohort competency grid (learner x domain, band word + fill level), band distribution (evilcharts stacked bars), activity series (evilcharts area), aggregate calibration table, server accreditation export, chain badge. When the gateway is unreachable or the identity lacks the role, the page says so and falls back to the on-device, single-user components (`components/institution/*`).
- `/faculty`: review queue (authored cases + flagged encounters), grading override with per-domain bands and `MAX_POINTS_PER_CASE` points (`domain/summative.ts`), mandatory co-sign bound to the credentialed reviewer identity (`data/authoring.reviewerFromProfile`), roster, assignments.
- `/admin` -> Users: grant or remove roles by `sub`, add a user before their first login.
- Nav entries per vantage (`components/shell/TopNav.tsx`): educator gets Faculty, dean gets Institution (`/dean`) + Faculty, admin gets Admin + Institution + Faculty.
- Strings: `web/src/i18n/features/identity.{en,tr}.json`, `panels.{en,tr}.json`.

## 8. Keycloak dev realm and university SSO

`deploy/keycloak/realm-acudx.json` + `docker-compose.keycloak.yml` (Keycloak 26.4, `start-dev --import-realm`): realm `acudx`, public PKCE client `acudx-web` with an audience mapper and the `acudx-org` scope, the eight roles as composites (`faculty` includes `resident` includes `student`), one throwaway test user per role (passwords in `deploy/keycloak/README.md`, dev only). The README documents mapping university SAML IdPs through Keycloak identity brokering (metadata import, eduPersonAffiliation -> role mapper, schacHomeOrganization -> `org`, Organizations per-domain routing or `kc_idp_hint`) and the LTI 1.3 next step (ltijs service for launches, Deep Linking and AGS grade passback fed by the same encounter summaries).

## 9. Security notes

- No key ships to the browser: the client is public; the server only caches the IdP's public JWKS.
- Tokens: access token in memory; refresh token in sessionStorage (tab-scoped, cleared on sign-out and on a failed refresh); PKCE material removed on return; nothing in localStorage.
- Local mode is honest: `X-Auth-Mode: local` on every response, `verified: false` in the principal, `verified_identity: false` in dean reports, visible badges.
- Cross-org reads need `admin`; dean payloads carry masked handles only; faculty payloads carry names of their own org's learners (they teach them).
- The chain is per org and verifiable; tampering with a stored body is detected and reported with the row id.

## 10. Tests

- `server/tests/test_auth_roles.py` precedence, aliases, claim paths.
- `server/tests/test_auth_jwks.py` RSA key pair generated in the test; valid token, expired, nbf, issuer, audience (string, list, disabled), wrong key, unknown kid, alg=none, malformed; discovery + JWKS fetch cached (respx); key rotation triggers one refresh.
- `server/tests/test_auth_routes.py` 401/403 per role, cross-org, default student, user_roles union and admin surface, admin bearer vs bootstrap token (incl. 503 when neither), oidc without IdP 503, local mode header + header principals, bearer still verified in local mode, registry setting overrides env.
- `server/tests/test_dean_faculty_routes.py` chain linking per org, idempotency, tamper detection, payload validation, cohort aggregates, de-identified export, empty aggregate, queue/review with co-sign and overrides, case decisions, assign/roster/completion.
- `web/src/lib/auth.test.ts` PKCE (RFC 7636 vector), authorize URL, callback parsing, JWT decode, role derivation, config load, code exchange with verifier (token never in storage), state mismatch, refresh success/failure.

## 11. Open items

- Playwright screenshots at 390/768/1280/1920 for `/dean` and `/faculty` (layouts use the same responsive grids as the former InstitutionPage and the admin console; not yet captured in CI).
- A `/v1/faculty/cases/submit` call from `AuthoringPage` on publish (the API exists; the authoring flow still keeps drafts locally).
- SAML partner onboarding runbook per university and the ltijs service itself.
